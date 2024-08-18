import axios from 'axios';
import { createRequire } from "module";
import { Firestore } from "@google-cloud/firestore";
import { resolve } from "node:path";
import { downloadAsJson } from './utilities.js';
import { logger } from '../logger.js';
const require = createRequire(import.meta.url);
const isDev = process.env.NODE_ENV === 'development';

async function getRiotInfoWithCache(ladName) {
    const db = new Firestore({
        projectId: 'lad-alert'
    })

    try {
        const puuidDoc = db.collection('summoner').doc(ladName);
        const puuidData = await puuidDoc.get();
        if (!puuidData.exists) {
            puuid = (await axiosInstance.get(`https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${ladName}/${ladTag}`)).data.puuid
            summId = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${riotInfo.puuid}`)).data.id;
            puuidDoc.set({
                gameName: ladName,
                puuid: puuid,
                summId: summId
            })
            return {puuid: puuid, gameName: ladName, summId: summId}
        }
        return puuidData.data();
    } catch (error) {
        logger.log({
            level: 'error',
            message: `Failed to fetch riot info: ${JSON.stringify(error)}`
        })
        return undefined;
    }
}

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

    const db = new Firestore({
        projectId: 'lad-alert'
    })

    try {
        /* Riot games account info */
        const riotInfo = await getRiotInfoWithCache(ladName);
        /* Summoner Ranked Data */
        const rankData = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${riotInfo.summId}`)).data.filter(data => data.queueType === 'RANKED_SOLO_5x5')[0];
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
                summonerId: riotInfo.summId,
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
        if (error?.response && error.response.status < 500) {
            logger.log({
                level: 'error',
                message: `Failed to fetch league lad data: ${JSON.stringify(error?.response?.data)}`
            })
        } else {
            logger.log({
                level: 'error',
                message: `Failed to fetch league lad data: ${JSON.stringify(error)}`
            })
        }
        return undefined;
    }
}