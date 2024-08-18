import { sendLeagueLadAlerts, getGameNotificationData } from "./src/DiscordAPI.js";
import fetchLeagueLadGameData from "./src/LoLAPI.js";
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

async function checkSentGames(toSend) {
    const filteredSend = []
    const db = new Firestore({
        projectId: 'lad-alert'
    })

    for(const gameData of toSend) {
        const ladDocRef = db.collection('lads').doc(gameData.summonerId).collection('games').doc('' + gameData.gameId)
        const ladDoc = await ladDocRef.get();
        if (!ladDoc.exists) {
            filteredSend.push(gameData);
            ladDocRef.set({
                gameId: gameData.gameId,
                champion: gameData.champion,
                gameType: gameData.gameType
            })
        }
    }
    return filteredSend;
}

export async function leagueLadCheck() {
    const client = isDev ? null : new SecretManagerServiceClient();
    const riotAPI = isDev ? process.env.RIOT_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/RIOT_TOKEN/versions/latest' }));
    const discAPI = isDev ? process.env.DISCORD_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/DISCORD_TOKEN/versions/latest' }));
    const channelID = isDev ? process.env.CHANNEL_ID : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/CHANNEL_ID/versions/latest'}));
    const lads = isDev ? require(resolve(process.cwd(), "league_data", "lads.json")) : await downloadAsJson('league_data', 'lads.json');
    
    let toSend = (await Promise.all(lads.map(async lad => fetchLeagueLadGameData(lad.gameName, lad.tagLine, riotAPI)))).filter(gameData => !!gameData);
    logger.log({ level: 'info', message: JSON.stringify(toSend) });
    if (!isDev) {
        toSend = await checkSentGames(toSend);
        sendLeagueLadAlerts(toSend, channelID, discAPI);
    } else {
        logger.log({
            level: 'info',
            message: `${getGameNotificationData(toSend).map(data => JSON.stringify(data)).join('\n')}`
        });
    }
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