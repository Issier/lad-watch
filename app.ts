import { sendLeagueLadAlerts, sendPostGameUpdate } from "./src/DiscordAPI.js";
import { fetchLeagueLadGameData, fetchMostRecentCompletedGame, fetchMostRecentMatchId } from "./src/LoLAPI.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { DocumentData, DocumentSnapshot, Firestore } from "@google-cloud/firestore";
import express from 'express';
import { logger } from './logger.js';
import { downloadAsJson } from "./src/utilities.js";
import { APIMessage } from "@discordjs/core";

async function getSecretVal(secret): Promise<string> {
    return (await secret)[0].payload.data.toString();
}

const db = new Firestore({
    projectId: 'lad-alert'
})
const client = new SecretManagerServiceClient();

async function sendGameInfoAlert(gameData, channelID, discAPI) {
    let ladRefs = []
    let gameDataToSend = []
    await Promise.all(gameData.map(async (game): Promise<DocumentSnapshot<DocumentData, DocumentData>> => {
        const ladDocRef = db.collection('lads').doc(game.summonerId).collection('games').doc('' + game.gameId)
        return ladDocRef.get().then(ladDoc => {
            if (!ladDoc.exists) {
                ladRefs.push(ladDocRef);
                gameDataToSend.push(game);
            }
            return ladDoc;
        });
    }));

    let apiMessage: void | APIMessage = await sendLeagueLadAlerts(gameDataToSend, channelID, discAPI);

    if (apiMessage) {
        for (let i = 0; i < ladRefs.length; i++) {
            ladRefs[i].set({
                gameId: gameDataToSend[i].gameId,
                champion: gameDataToSend[i].champion,
                gameType: gameDataToSend[i].gameType,
                messageId: apiMessage.id,
                sentPostGame: false
            })
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
        if (!!matchId && matchId.split('_')[1] === gameData.gameId) {
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
        res.status(204).send('Found Lads');
    });
});