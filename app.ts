import { sendLeagueLadAlerts, sendPostGameUpdate } from "./src/DiscordAPI.js";
import { fetchLeagueLadGameData, fetchMostRecentCompletedGame, fetchMostRecentMatchId, LeagueLadGameData } from "./src/LoLAPI.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { DocumentData, DocumentReference, DocumentSnapshot, Firestore } from "@google-cloud/firestore";
import express from 'express';
import { logger } from './logger.js';
import { downloadAsJson } from "./src/utilities.js";

async function getSecretVal(secret): Promise<string> {
    return (await secret)[0].payload.data.toString();
}

const db = new Firestore({
    projectId: 'lad-alert'
})
const client = new SecretManagerServiceClient();

async function sendGameInfoAlert(gameData: LeagueLadGameData[], channelID, discAPI) {
    let ladRefs: { [gameId: string]: {docRef: DocumentReference<DocumentData, DocumentData>, summonerName: string }[]} = {}
    let gameDataToSend: { [gameId: string]: LeagueLadGameData[] } = {}
    await Promise.all(gameData.map(async (game): Promise<DocumentSnapshot<DocumentData, DocumentData>> => {
        const ladDocRef = db.collection('lads').doc(game.summonerId).collection('games').doc('' + game.gameId)
        return ladDocRef.get().then(ladDoc => {
            if (!ladDoc.exists) {
                Object.keys(ladRefs).includes(game.gameId.toString()) ?
                    ladRefs[game.gameId].push({docRef: ladDocRef, summonerName: game.summonerName}) :
                    ladRefs[game.gameId] = [{docRef: ladDocRef, summonerName: game.summonerName}];

                Object.keys(gameDataToSend).includes(game.gameId.toString()) ?
                    gameDataToSend[game.gameId].push(game) :
                    gameDataToSend[game.gameId] = [game];
            }
            return ladDoc;
        });
    }));

    let apiMessage: { [gameId: string]: {messageId: string, summonerNames: string[]} }[] = await sendLeagueLadAlerts(Object.values(gameDataToSend).flat(), channelID, discAPI);

    if (apiMessage) {
        for (const sentGame of apiMessage) {
            for (const gameId of Object.keys(sentGame)) {
                for(const player of sentGame[gameId].summonerNames) {
                    ladRefs[gameId].find(ladRef => ladRef.summonerName === player).docRef.set({
                        gameId: gameId,
                        champion: gameDataToSend[gameId].find(game => game.summonerName === player).champion,
                        gameType: gameDataToSend[gameId].find(game => game.summonerName === player).gameType,
                        messageId: sentGame[gameId].messageId,
                        sentPostGame: false
                    })
                }
            }
        }
    }
}

async function sendPostGameUpdateAlerts(riotAPI, discAPI, channelID) {
    let unsentPostGames = await db.collectionGroup('games').where('sentPostGame', '==', false).get();
    unsentPostGames.forEach(async game => {
        let gameData = game.data();
        let summonerId = game.ref.parent.parent.id;
        let summInfo = await db.collection('summoner').where('summId', '==', summonerId).get();
        let puuid = summInfo.docs[0].data().puuid;
        let matchId = await fetchMostRecentMatchId(puuid, riotAPI);
        if (!!matchId && matchId.split('_')[1] == gameData.gameId) {
            let postGameData = await fetchMostRecentCompletedGame(matchId, puuid, riotAPI);
            sendPostGameUpdate(
                postGameData.matchData.info, 
                postGameData.matchData.info.participants.find(participant => participant.summonerId === summonerId), 
                postGameData.killImage,
                gameData.messageId, 
                channelID, 
                discAPI
            ).then(message => {
                if (!!message) {
                    game.ref.update({sentPostGame: true, postGameUpdateId: message.id})
                };
            });
        } else if (!!matchId) {
            logger.log({
                level: 'info',
                message: `${summInfo.docs[0].data().gameName} has a new game, but it is not the most recent game (${matchId.split('_')[1]} vs ${gameData.gameId})`
            })
        } else {
            logger.log({
                level: 'info',
                message: `No Post Game for ${summonerId}`
            })
        }
    });
}

export async function leagueLadCheck(riotAPI, discAPI, channelID) {
    const lads = await downloadAsJson('league_data', 'lads.json');

    let activeGames = (await Promise.all(lads.map(async lad => fetchLeagueLadGameData(lad.gameName, lad.tagLine, riotAPI)))).filter(gameData => !!gameData);
    logger.log({ level: 'info', message: JSON.stringify(activeGames) });
    sendGameInfoAlert(activeGames, channelID, discAPI),
    sendPostGameUpdateAlerts(riotAPI, discAPI, channelID)
 }

const app = express();
app.use(express.json())

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
    logger.log({
        level: 'info',
        message: 'LadWatch listening'
    })
})

app.post('/', async (req, res) => {
    if (!req.body) {
        const msg = 'no Pub/Sub message received';
        logger.log({
            level: 'error',
            message: `${msg} ${req.body}`
        });
        res.status(400).send(`Bad Request: ${msg}`);
        return;
    }
    if (!req.body.message) {
        const msg = 'invalid Pub/Sub message format';
        logger.log({
            level: 'error',
            message: `${msg} ${req.body}`
        });
        res.status(400).send(`Bad Request: ${msg}`);
        return;
    }

    const [riotAPI, discAPI, channelID] = await Promise.all([
        getSecretVal(client.accessSecretVersion({ name: 'projects/lad-alert/secrets/RIOT_TOKEN/versions/latest' })),
        getSecretVal(client.accessSecretVersion({ name: 'projects/lad-alert/secrets/DISCORD_TOKEN/versions/latest' })),
        getSecretVal(client.accessSecretVersion({ name: 'projects/lad-alert/secrets/CHANNEL_ID/versions/latest' }))
    ]);

    leagueLadCheck(riotAPI, discAPI, channelID).then(() => {
        logger.log({
            level: 'info',
            message: 'Completed Lad Run Check'
        });
        res.status(204).send('Found Lads');
    });
});