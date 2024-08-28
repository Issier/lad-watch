import { RiotAPI, RiotAPITypes, PlatformId } from "@fightmegg/riot-api";
import { Firestore } from "@google-cloud/firestore";
import { downloadAsJson } from './utilities.js';
import { logger } from '../logger.js';
import { createCanvas, loadImage } from "canvas";
import { Storage } from "@google-cloud/storage";

export async function getRiotInfoWithCache(ladName, ladTag, riotAPIToken) {
    const db = new Firestore({
        projectId: 'lad-alert'
    });

    const riotAPI = new RiotAPI(riotAPIToken);

    const puuidDoc = db.collection('summoner').doc(ladName);
    const puuidData = await puuidDoc.get();
    if (!puuidData.exists) {
        logger.log({
            level: 'info',
            message: `Summoner ${ladName}#${ladTag} with not found in cache`
        })
        let riotInfo: RiotAPITypes.Account.AccountDTO = await riotAPI.account.getByRiotId({region: PlatformId.AMERICAS, gameName: ladName, tagLine: ladTag});
        let summInfo: RiotAPITypes.Summoner.SummonerDTO = await riotAPI.summoner.getByPUUID({region: PlatformId.NA1, puuid: riotInfo.puuid});

        puuidDoc.set({
            gameName: ladName,
            puuid: riotInfo.puuid,
            summId: summInfo.id
        })
        return {puuid: riotInfo.puuid, gameName: ladName, summId: summInfo.id}
    }
    return puuidData.data();
}

async function fetchKillImage(matchId: string, gameMode: string, puuid, riotAPIToken): Promise<Buffer> {
    if (!['ARAM', 'CLASSIC'].includes(gameMode)) {
        logger.log({
            level: 'info',
            message: `Game mode ${gameMode} is not supported for kill image`
        })
        return null
    }
    
    const riotAPI = new RiotAPI(riotAPIToken);

    const SCALER = 512/16000;

    try {
        const timelineData: RiotAPITypes.MatchV5.MatchTimelineDTO = await riotAPI.matchV5.getMatchTimelineById({cluster: PlatformId.AMERICAS, matchId: matchId});
        const summonerParticipantId = timelineData.info.participants.find(participant => participant.puuid === puuid).participantId;
        
        let frameWithPlayerEvent = timelineData.info.frames.map(frame => {
            let playerEvents = {kills: [], deaths: [], timestamp: frame.timestamp};
            frame.events.forEach(event => {
                if (event.type === 'CHAMPION_KILL') {
                    if (event.killerId === summonerParticipantId) {
                        logger.log({
                            level: 'info',
                            message: `${matchId} Summoner ${puuid} killed ${event.victimId} at ${event.position.x} (Scaled ${event.position.x * SCALER}), ${event.position.y} (Scaled ${event.position.y * SCALER})`
                        })
                        playerEvents.kills.push(event);
                    } else if (event.victimId === summonerParticipantId) {
                        logger.log({
                            level: 'info',
                            message: `${matchId} Summoner ${puuid} was killed by ${event.killerId} at ${event.position.x} (Scaled ${event.position.x * SCALER}), ${event.position.y} (Scaled ${event.position.y * SCALER})`
                        })
                        playerEvents.deaths.push(event);
                    }
                }
            });
            return playerEvents;
        });

        const canvas = createCanvas(512, 512);
        const ctx = canvas.getContext('2d');

        const storage = new Storage();

        const map = await storage
            .bucket('league_data')
            .file(gameMode === 'CLASSIC' ? 'map.png' : 'map_aram.png')
            .download();

        await loadImage(map[0]).then(image => {
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        });

        ctx.translate(0,canvas.height);
        ctx.scale(1,-1); 

        for (const event of frameWithPlayerEvent) {
            for (const kill of event.kills) {
                ctx.beginPath();
                ctx.fillStyle = '#00A36C';
                ctx.arc(kill.position.x * SCALER, kill.position.y * SCALER, 10, 0, 2 * Math.PI);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fill();
            }
            for (const death of event.deaths) {
                ctx.beginPath();
                ctx.fillStyle = '#EE4B2B';
                ctx.arc(death.position.x * SCALER, death.position.y * SCALER, 10, 0, 2 * Math.PI);
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fill();
            }
        }

        return canvas.toBuffer();
    } catch (error) {
        logger.log({
            level: 'error',
            message: `Failed to fetch timeline data for ${matchId}`
        })
        return null;
    }
}

export async function fetchLeagueLadGameData(ladName, ladTag, riotAPIToken) {
    const rankColors = {
        'DIAMOND': 0xb9f2ff,
        'EMERALD': 0x50C878,
        'PLATINUM': 0x0AC8B9,
        'GOLD': 0xFFD700,
        'SILVER': 0xC0C0C0,
        'BRONZE': 0xCD7F32,
        'IRON': 0x964B00
    }

    const [gameTypes, champions] = await Promise.all([
        downloadAsJson('league_data', 'queues.json'),
        downloadAsJson('league_data', 'champion.json')
    ]);

    try {
        const riotAPI = new RiotAPI(riotAPIToken);
        /* Riot games account info */
        const riotInfo = await getRiotInfoWithCache(ladName, ladTag, riotAPIToken).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to fetch riot info for ${ladName}#${ladTag}: ${JSON.stringify(error)}}`
            })
            throw error;
        });

        logger.log({
            level: 'info',
            message: `Summoner ${ladName} has info ${JSON.stringify(riotInfo)}`
        })
        /* Summoner Ranked Data */
        const rankData: RiotAPITypes.League.LeagueEntryDTO = (await riotAPI
            .league
            .getEntriesBySummonerId({
                region: PlatformId.NA1, 
                summonerId: riotInfo.summId
            }).catch(error => {
                logger.log({
                    level: 'error',
                    message: `Failed to fetch rank data: ${JSON.stringify(error)}}`
                })
                throw error;
            })).filter(data => data.queueType === 'RANKED_SOLO_5x5')[0];

        /* Live Game Data */
        logger.info(`Fetching live game data for ${ladName}#${ladTag}, ${riotInfo.summId}`)
        let liveGame: RiotAPITypes.Spectator.CurrentGameInfoDTO = await riotAPI
            .spectator
            .getBySummonerId({
                region: PlatformId.NA1, 
                summonerId: riotInfo.puuid
            }).then(value => {
                logger.info(`Fetched live game data for ${ladName}#${ladTag}, ${riotInfo.summId}, ${JSON.stringify(value)}`);
                return value;
            }).catch(error => {
                logger.log({
                    level: 'error',
                    message: `Failed to fetch live game data: ${JSON.stringify(error)}}`
                })
                throw error;
            });
        
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

        const gameTime = new Date(Date.now() - new Date(liveGame.gameStartTime).valueOf());

        return {
            gameTime: `${gameTime.getMinutes()}:${gameTime.getSeconds().toString().padStart(2, '0')}`,
            champion: champion, 
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
        if (error?.response && error.response.status < 500) {
            logger.log({
                level: 'error',
                message: `Failed to fetch league lad data: ${JSON.stringify(error?.response?.data)}`
            })
        }
        return undefined;
    }
}

export async function fetchMostRecentMatchId(puuid, riotAPIToken): Promise<string> {
    const riotAPI = new RiotAPI(riotAPIToken);

    try {
        const matchList = (await riotAPI.matchV5.getIdsByPuuid({cluster: PlatformId.AMERICAS, puuid: puuid, params: {start: 0, count: 1}}));        

        return matchList[0];
    } catch (error) {
        logger.log({
            level: 'error',
            message: `Failed to fetch most recent game data for ${puuid}`
        })
        return null;
    }
}

export async function fetchMostRecentCompletedGame(matchId, puuid, riotAPIToken): Promise<{matchData: RiotAPITypes.MatchV5.MatchDTO, killImage: Buffer}> {
    const riotAPI = new RiotAPI(riotAPIToken);

    try {
        const matchData: RiotAPITypes.MatchV5.MatchDTO = await riotAPI.matchV5.getMatchById({cluster: PlatformId.AMERICAS, matchId: matchId});
        const killImage = await fetchKillImage(matchId, matchData.info.gameMode, puuid, riotAPIToken);

        return { matchData: matchData, killImage: killImage };
    } catch (error) {
        logger.log({
            level: 'error',
            message: `Failed to fetch most recent game data for ${puuid}, ${JSON.stringify(error)}`
        })
        return null;
    }
}