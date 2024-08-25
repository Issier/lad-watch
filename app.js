import { sendLeagueLadAlerts, getGameNotificationData, sendPostGameUpdate } from "./src/DiscordAPI.js";
import { fetchLeagueLadGameData, fetchMostRecentCompletedGame, getRiotInfoWithCache } from "./src/LoLAPI.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Firestore } from "@google-cloud/firestore";
import { createRequire } from "module";
import { resolve } from "node:path";
import express, { json } from 'express';
import { logger } from './logger.js';
import { downloadAsJson } from "./src/utilities.js";
const require = createRequire(import.meta.url);
const isDev = process.env.NODE_ENV === 'development';

function getSecretVal(secret) {
    return secret[0].payload.data.toString();
}

const db = new Firestore({
    projectId: 'lad-alert'
})
const client = isDev ? null : new SecretManagerServiceClient();
const riotAPI = isDev ? process.env.RIOT_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/RIOT_TOKEN/versions/latest' }));
const discAPI = isDev ? process.env.DISCORD_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/DISCORD_TOKEN/versions/latest' }));
const channelID = isDev ? process.env.CHANNEL_ID : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/CHANNEL_ID/versions/latest' }));

async function sendGameInfoAlert(gameData) {
    let ladRefs = []
    let gameDataToSend = []
    for (const game of gameData) {
        const ladDocRef = db.collection('lads').doc(game.summonerId).collection('games').doc('' + game.gameId)
        let ladDoc = await ladDocRef.get();
        if (!ladDoc.exists) {
            ladDocRef.set({
                gameId: game.gameId,
                champion: game.champion,
                gameType: game.gameType,
                sentPostGame: false
            })
            ladRefs.push(ladDocRef);
            gameDataToSend.push(game);
        } 
    }

    let apiMessage = await sendLeagueLadAlerts(gameDataToSend, channelID, discAPI);

    for (const ladRef of ladRefs) {
        ladRef.update({messageId: apiMessage.id});
    }
}

async function sendPostGameUpdateAlerts(lads) {
    let unsentPostGames = await db.collectionGroup('games').where('sentPostGame', '==', false).get();
    unsentPostGames.forEach(async game => {
        let gameData = await game.data();
        let summonerId = game.ref.parent.parent.id;
        let summInfo = await db.collection('summoner').where('summId', '==', summonerId).get();
        let puuid = summInfo.docs[0].data().puuid;
        let postGameData = await fetchMostRecentCompletedGame(puuid, riotAPI);
        if (!!postGameData && postGameData.gameId === gameData.gameId) {
            let postGameMessage = await sendPostGameUpdate(
                postGameData.info, 
                postGameData.info.participants.find(participant => participant.summonerId === summonerId), 
                gameData.messageId, 
                channelID, 
                discAPI);
            game.ref.update({sentPostGame: true, postGameUpdateId: postGameMessage.id});
        } else if (!!postGameData) {
            logger.log({
                level: 'info',
                message: `${summInfo.docs[0].data().gameName} has a new game, but it is not the most recent game (${postGameData.gameId} vs ${gameData.gameId})`
            })
        } else {
            logger.log({
                level: 'info',
                message: `No Post Game for ${summonerId}`
            })
        }
    });
}

export async function leagueLadCheck() {
    const lads = isDev ? require(resolve(process.cwd(), "league_data", "lads.json")) : await downloadAsJson('league_data', 'lads.json');

    let activeGames = (await Promise.all(lads.map(async lad => fetchLeagueLadGameData(lad.gameName, lad.tagLine, riotAPI)))).filter(gameData => !!gameData);
    logger.log({ level: 'info', message: JSON.stringify(activeGames) });
    if (!isDev) {
        sendGameInfoAlert(activeGames);
     } else {
        logger.log({
            level: 'info',
            message: `${getGameNotificationData(activeGames).map(data => JSON.stringify(data)).join('\n')}`
        });
    }

    sendPostGameUpdateAlerts(lads);
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

    await leagueLadCheck();
    res.status(204).send('Found Lads');
});