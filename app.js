import { sendLeagueLadAlerts } from "./src/DiscordAPI.js";
import fetchLeagueLadGameData from "./src/LoLAPI.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Firestore } from "@google-cloud/firestore";
import { createRequire } from "module";
import { resolve } from "node:path";
import express from 'express';
import { logger } from './logger.js';
import { downloadAsJson } from "./src/utilities.js";
import dayjs from "dayjs";
const require = createRequire(import.meta.url);
const isDev = process.env.NODE_ENV === 'development';

function getSecretVal(secret) {
    return secret[0].payload.data.toString();
}

function trackSentGames(toSend) {
    toSend.forEach(async gameData => {
        const ladDocRef = db.collection('lads').doc(gameData.summonerId).collection('games').doc('' + gameData.gameId)
        const ladDoc = await ladDocRef.get();
        if (!ladDoc.exists) {
            ladDocRef.set({
                gameId: gameData.gameId,
                champion: gameData.champion,
                gameType: gameData.gameType
            })
        }
    });
}

export async function leagueLadCheck() {
    const client = new SecretManagerServiceClient();
    const db = new Firestore({
        projectId: 'lad-alert'
    })
    const riotAPI = isDev ? process.env.RIOT_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/RIOT_TOKEN/versions/latest' }));
    const discAPI = isDev ? process.env.DISCORD_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/DISCORD_TOKEN/versions/latest' }));
    const channelID = isDev ? process.env.CHANNEL_ID : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/CHANNEL_ID/versions/latest'}));
    const lads = isDev ? require(resolve(process.cwd(), "league_data", "lads.json")) : await downloadAsJson('league_data', 'lads.json');
    
    let toSend = (await lads.map(async lad => await fetchLeagueLadGameData(lad.gameName, lad.tagLine, riotAPI))).filter(game => !!game)
    if (!isDev) {
        trackSentGames(toSend);
        sendLeagueLadAlerts(toSend, channelID, discAPI);
    } else {
        logger.log({
            level: 'info',
            message: `${getGameNotificationData(toSend)}`
        });
    }
    return toSend;
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
      res.status(400).send(`Bad Request: ${msg}`);
      return;
    }
    if (!req.body.message) {
      const msg = 'invalid Pub/Sub message format';
      res.status(400).send(`Bad Request: ${msg}`);
      return;
    }
    
    try {
        leagueLadCheck()
    } catch (err) {
        logger.log({
            level: 'error',
            message: err
        })
    } 
    res.status(204).send('Found Lads');
  });