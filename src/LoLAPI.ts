import { RiotAPI, RiotAPITypes, PlatformId } from "@fightmegg/riot-api";
import { Firestore } from "@google-cloud/firestore";
import { downloadAsJson } from './utilities.js';
import { logger } from '../logger.js';
import { Canvas, createCanvas, loadImage, CanvasRenderingContext2D } from "canvas";
import { Storage } from "@google-cloud/storage";

export type LeagueLadGameData = {
    gameTime: string,
    champion: string,
    summonerId: string,
    summonerName: string,
    summonerRank: string,
    liveGamePages: string,
    gameType: string,
    rankColorHex: string,
    gameId: number,
    hotStreak: boolean,
    seasonWins: number,
    seasonLosses: number
}

export async function getRiotInfoWithCache(ladName, ladTag, riotAPIToken) {
    const db = new Firestore({
        projectId: 'lad-alert'
    });

    const riotAPI = new RiotAPI(riotAPIToken);

    const puuidDoc = db.collection('summoner').doc(ladName);
    const puuidData = await puuidDoc.get();
    if (!puuidData.exists) {
        logger.info(`Summoner ${ladName}#${ladTag} with not found in cache`)
        let riotInfo: RiotAPITypes.Account.AccountDTO = await riotAPI.account.getByRiotId({ region: PlatformId.AMERICAS, gameName: ladName, tagLine: ladTag });
        let summInfo: RiotAPITypes.Summoner.SummonerDTO = await riotAPI.summoner.getByPUUID({ region: PlatformId.NA1, puuid: riotInfo.puuid });

        puuidDoc.set({
            gameName: ladName,
            puuid: riotInfo.puuid,
            summId: summInfo.id
        })
        return { puuid: riotInfo.puuid, gameName: ladName, summId: summInfo.id }
    }
    return puuidData.data();
}

function drawCircle(ctx: CanvasRenderingContext2D, color: string, x: number, y: number) {
    const SCALER = 512 / 16000;

    ctx.beginPath();
    ctx.fillStyle = color;
    let scaledX = (x * SCALER)
    ctx.arc(scaledX + (scaledX < 256 ? 0 : 25), y * SCALER, 10, 0, 2 * Math.PI);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
}

async function paintMap(mapImage: any, framesWithPlayerEvent: { kills: RiotAPITypes.MatchV5.EventDTO[], deaths: RiotAPITypes.MatchV5.EventDTO[], timestamp: number }[]) {
    const canvas: Canvas = createCanvas(512, 512);
    const ctx: CanvasRenderingContext2D = canvas.getContext('2d');

    return loadImage(mapImage).then(image => {
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);

        for (const event of framesWithPlayerEvent) {
            for (const kill of event.kills) {
                drawCircle(ctx, '#00A36C', kill.position.x, kill.position.y)
            }
            for (const death of event.deaths) {
                drawCircle(ctx, '#EE4B2B', death.position.x, death.position.y)
            }
        }
        return canvas.toBuffer();
    });
}

async function fetchKillImage(matchId: string, gameMode: string, puuid, riotAPIToken): Promise<Buffer> {
    if (!['ARAM', 'CLASSIC'].includes(gameMode)) {
        logger.info(`Game mode ${gameMode} is not supported for kill image`)
        return null
    }

    const riotAPI = new RiotAPI(riotAPIToken);

    try {
        const storage = new Storage();
        const [mapImage, timelineData] = await Promise.all([
            storage.bucket('league_data').file(gameMode === 'CLASSIC' ? 'map.png' : 'map_aram.png').download(),
            riotAPI.matchV5.getMatchTimelineById({ cluster: PlatformId.AMERICAS, matchId: matchId })
        ]);
        const summonerParticipantId = timelineData.info.participants.find(participant => participant.puuid === puuid).participantId;

        let framesWithPlayerEvent = timelineData.info.frames.map(frame => {
            let playerEvents = { kills: [], deaths: [], timestamp: frame.timestamp };
            frame.events.forEach((event: RiotAPITypes.MatchV5.EventDTO) => {
                if (event.type === 'CHAMPION_KILL') {
                    if (event.killerId === summonerParticipantId) {
                        logger.info(`${matchId} Summoner ${puuid} killed ${event.victimId} at (${event.position.x}, ${event.position.y})`)
                        playerEvents.kills.push(event);
                    } else if (event.victimId === summonerParticipantId) {
                        logger.info(`${matchId} Summoner ${puuid} was killed by ${event.killerId} at (${event.position.x}, ${event.position.y})`)
                        playerEvents.deaths.push(event);
                    }
                }
            });
            return playerEvents;
        });

        return await paintMap(mapImage[0], framesWithPlayerEvent);
    } catch (error) {
        logger.error(`Failed to fetch timeline data for ${matchId}`)
        return null;
    }
}

export async function fetchLeagueLadGameData(ladName, ladTag, riotAPIToken): Promise<LeagueLadGameData> {
    const rankColors = {
        'DIAMOND': 0xb9f2ff,
        'EMERALD': 0x50C878,
        'PLATINUM': 0x0AC8B9,
        'GOLD': 0xFFD700,
        'SILVER': 0xC0C0C0,
        'BRONZE': 0xCD7F32,
        'IRON': 0x964B00
    }

    try {
        const riotAPI = new RiotAPI(riotAPIToken);
        /* Riot games account info */
        const [riotInfo, gameTypes, champions] = await Promise.all([
            getRiotInfoWithCache(ladName, ladTag, riotAPIToken).catch(error => {
                logger.error(`Failed to fetch riot info for ${ladName}#${ladTag}: ${JSON.stringify(error)}}`)
                throw error;
            }),
            downloadAsJson('league_data', 'queues.json'),
            downloadAsJson('league_data', 'champion.json')
        ])

        logger.info(`Summoner ${ladName} has info ${JSON.stringify(riotInfo)}`)

        const liveGame = await riotAPI
            .spectator
            .getBySummonerId({
                region: PlatformId.NA1,
                summonerId: riotInfo.puuid
            }).then(value => {
                logger.info(`Fetched live game data for ${ladName}#${ladTag}, ${riotInfo.summId}, ${JSON.stringify(value)}`);
                return value;
            }).catch(() => {
                logger.info(`Summoner ${riotInfo.gameName} is not in a game`);
                return null;
            })
        if (!liveGame) return;

        const rankData = await riotAPI
            .league
            .getEntriesBySummonerId({
                region: PlatformId.NA1,
                summonerId: riotInfo.summId
            }).catch(error => {
                logger.error(`Failed to fetch rank data: ${JSON.stringify(error)}}`)
                throw error;
            }).then((data) => {
                if (data.find(data => data.queueType === 'RANKED_SOLO_5x5'))
                    return data.filter(data => data.queueType === 'RANKED_SOLO_5x5')[0]
                return null;
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
            logger.error(`Failed to fetch league lad data: ${JSON.stringify(error?.response?.data)}`)
        }
        return undefined;
    }
}

export async function fetchMostRecentMatchId(puuid, riotAPIToken): Promise<string> {
    const riotAPI = new RiotAPI(riotAPIToken);

    try {
        const matchList = (await riotAPI.matchV5.getIdsByPuuid({ cluster: PlatformId.AMERICAS, puuid: puuid, params: { start: 0, count: 1 } }));

        return matchList[0];
    } catch (error) {
        logger.error(`Failed to fetch most recent game data for ${puuid}`)
        return null;
    }
}

export async function fetchMostRecentCompletedGame(matchId, puuid, riotAPIToken): Promise<{ matchData: RiotAPITypes.MatchV5.MatchDTO, killImage: Promise<Buffer> }> {
    const riotAPI = new RiotAPI(riotAPIToken);

    try {
        const matchData: RiotAPITypes.MatchV5.MatchDTO = await riotAPI.matchV5.getMatchById({ cluster: PlatformId.AMERICAS, matchId: matchId });
        const killImage = fetchKillImage(matchId, matchData.info.gameMode, puuid, riotAPIToken);

        return { matchData: matchData, killImage: killImage };
    } catch (error) {
        logger.error(`Failed to fetch most recent game data for ${puuid}, ${JSON.stringify(error)}`)
        return null;
    }
}