import axios from 'axios';
import { createRequire } from "module";
import { resolve } from "node:path";
import { downloadAsJson } from './utilities.js';
import { logger } from '../logger.js';
const require = createRequire(import.meta.url);
const isDev = process.env.NODE_ENV === 'development';

export default async function fetchLeagueLadGameData(ladName, ladTag, riotAPIToken) {
    const rankColors = {
        'DIAMOND': 0xb9f2ff,
        'EMERALD': 0x50C878,
        'PLATINUM': 0x0AC8B9,
        'GOLD': 0xFFD700,
        'SILVER': 0xC0C0C0,
        'BRONZE': 0xCD7F32,
        'IRON': 0x964B00
    }

    const gameTypes = isDev ? require(resolve(process.cwd(), "league_data", "queues.json")) : await downloadAsJson('league_data', 'queues.json')
    const champions = isDev ? require(resolve(process.cwd(), "league_data", "champion.json")) : await downloadAsJson('league_data', 'champion.json')

    const axiosInstance = axios.create({
        headers: {
            'X-Riot-Token': riotAPIToken
        }
    })

    try {
        /* Riot games account info */
        const riotInfo = (await axiosInstance.get(`https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${ladName}/${ladTag}`)).data;
        /* Summoner Info */
        const summInfo = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${riotInfo.puuid}`)).data;
        /* Summoner Ranked Data */
        const rankData = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summInfo.id}`)).data.filter(data => data.queueType === 'RANKED_SOLO_5x5')[0];
        /* Live Game Data */
        try {
            let liveGame = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${riotInfo.puuid}`)).data;
            const gameType = gameTypes.filter(val => val.queueId === liveGame.gameQueueConfigId)[0]

            const summChar = liveGame.participants.filter(participant => {
                return participant.puuid === riotInfo.puuid;
            })[0].championId;

            let champion = ""
            for (const champ in champions.data) {
                if (champions.data[champ].key == summChar) {
                    champion = champ;
                }
            }

            const gameTime = new Date(Date.now() - new Date(liveGame.gameStartTime));

            /* Live Game Champion Mastery for Summoner */
            const champMastery = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${riotInfo.puuid}/by-champion/${summChar}`)).data.championPoints;

            return {
                gameTime: `${gameTime.getMinutes()}:${gameTime.getSeconds().toString().padStart(2, '0')}`,
                champion: champion, 
                championMastery: `${champMastery.toLocaleString()}`,
                summonerId: summInfo.id,
                summonerName: riotInfo.gameName,
                summonerRank: !rankData ? 'Unranked' : `${rankData.tier} ${rankData.rank} ${rankData.leaguePoints}LP`,
                liveGamePages: `[u.gg](https://u.gg/lol/profile/na1/${encodeURIComponent(riotInfo.gameName)}-${ladTag}/live-game)` +  
                            `| [op.gg](https://www.op.gg/summoners/na/${encodeURIComponent(riotInfo.gameName)}-${ladTag}/ingame)`,
                gameType: gameType.description.replace(' games', ''),
                rankColorHex: rankData.tier in rankColors ? rankColors[rankData.tier] : 0xFFFFFF,
                gameId: liveGame.gameId,
                hotStreak: rankData.hotStreak,
                seasonWins: rankData.wins,
                seasonLosses: rankData.losses
            }
        } catch (error) {
            if (error.response.status === 404) {
                logger.log({
                    level: 'info',
                    message: `Summoner ${riotInfo.gameName} is not in a game`
                })
            }
            return null;
        }
    } catch (error) {
        if (error.response.status < 500) {
            logger.log({
                level: 'error',
                message: `Failed to fetch league lad data: ${JSON.stringify(error.response.data)}`
            })
        }
        return undefined;
    }
}