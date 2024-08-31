import { createThread, sendLeagueLadAlert, sendPostGameUpdate } from "./src/DiscordAPI.js";
import { fetchLeagueLadGameData, fetchMostRecentCompletedGame, fetchMostRecentMatchId, LeagueLadGameData } from "./src/LoLAPI.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { DocumentData, DocumentReference, Firestore } from "@google-cloud/firestore";
import express from 'express';
import { logger } from './logger.js';
import { downloadAsJson } from "./src/utilities.js";

type GameRecord = { ref: DocumentReference, champion: string, gameId: string, gameType: string, messageId: string, sentPostGame: boolean }

async function getSecretVal(secret): Promise<string> {
    return (await secret)[0].payload.data.toString();
}

const db = new Firestore({
    projectId: 'lad-alert'
})
const client = new SecretManagerServiceClient();

async function sendGameInfoAlert(gameData: LeagueLadGameData[], channelID, discAPI) {
    let ladRefs: { [gameId: string]: { docRef: DocumentReference<DocumentData, DocumentData>, summonerName: string, gameData: LeagueLadGameData }[] } = {}

    gameData.forEach((game) => {
        const ladDocRef = db.collection('lads').doc(game.summonerId).collection('games').doc('' + game.gameId)
        Object.keys(ladRefs).includes(game.gameId.toString()) ?
            ladRefs[game.gameId].push({ docRef: ladDocRef, summonerName: game.summonerName, gameData: game }) :
            ladRefs[game.gameId] = [{ docRef: ladDocRef, summonerName: game.summonerName, gameData: game }];
    });

    return (await Promise.all(Object.keys(ladRefs).map(game => {
        return sendLeagueLadAlert(game, ladRefs[game].map(ref => ref.gameData), ladRefs[game].map(ref => ref.docRef), channelID, discAPI)
    }))).filter((message) => !!message);
}

async function sendPostGameUpdateAlert(riotAPI, discAPI, channelID, gameData: GameRecord) {
    let summonerId = gameData.ref.parent.parent.id;
    let summInfo = await db.collection('summoner').where('summId', '==', summonerId).get();
    let puuid = summInfo.docs[0].data().puuid;
    let matchId = await fetchMostRecentMatchId(puuid, riotAPI);
    if (!!matchId && matchId.split('_')[1] == gameData.gameId) {
        let postGameData = await fetchMostRecentCompletedGame(matchId, puuid, riotAPI);
        return sendPostGameUpdate(
            postGameData.matchData.info,
            postGameData.matchData.info.participants.find(participant => participant.summonerId === summonerId),
            postGameData.killImage,
            gameData.messageId,
            channelID,
            discAPI
        ).then(message => {
            if (!!message) {
                gameData.ref.update({ sentPostGame: true, postGameUpdateId: message.id })
            };
        });
    } else if (!!matchId) {
        logger.info(`${summInfo.docs[0].data().gameName} has a new game, but it is not the most recent game (${matchId.split('_')[1]} vs ${gameData.gameId})`)
    } else {
        logger.info(`No Post Game for ${summonerId}`)
    }
}

async function sendPostGameUpdateAlerts(riotAPI, discAPI, channelID) {
    let unsentPostGames = await db.collectionGroup('games').where('sentPostGame', '==', false).get();

    let unsentByMessageId: { [messageId: string]: GameRecord[] } = {}
    unsentPostGames.docs.forEach(game => {
        const data = game.data();
        const gameRecord: GameRecord = {ref: game.ref, champion: data.champion, gameId: data.gameId, gameType: data.gameType, messageId: data.messageId, sentPostGame: data.sentPostGame};
        game.data()
        if (!unsentByMessageId[gameRecord.messageId]) {
            unsentByMessageId[gameRecord.messageId] = [gameRecord]
        } else {
            unsentByMessageId[gameRecord.messageId].push(gameRecord)
        }
    })

    const updatesByMessageId = []
    for (const messageId of Object.keys(unsentByMessageId)) {
        const thread = await createThread(messageId, channelID, discAPI, unsentByMessageId[messageId][0].gameType);
        
        if (thread)
            updatesByMessageId.push(Promise.all(unsentByMessageId[messageId].map(gameRecord => {
                return sendPostGameUpdateAlert(riotAPI, discAPI, channelID, gameRecord);
            })));
    }
    return await Promise.all(updatesByMessageId);
}

export async function leagueLadCheck(riotTokenPromise, discAPI, channelID) {
    const [riotToken, lads] = await Promise.all([
        riotTokenPromise,
        downloadAsJson('league_data', 'lads.json'),
    ]);

    let activeGames = (await Promise.all(lads.map(lad => fetchLeagueLadGameData(lad.gameName, lad.tagLine, riotToken)))).filter(gameData => !!gameData);
    logger.info(JSON.stringify(activeGames));
    const [discToken, channel] = await Promise.all([
        discAPI,
        channelID
    ]);
    return await Promise.all([
        sendGameInfoAlert(activeGames, channel, discToken),
        sendPostGameUpdateAlerts(riotToken, discToken, channel)
    ])
}

const app = express();
app.use(express.json())

const port = parseInt(process.env.PORT) || 8080;
app.listen(port, () => {
    logger.info('LadWatch listening')
})

app.post('/', async (req, res) => {
    if (!req.body) {
        const msg = 'no Pub/Sub message received';
        logger.info(`${msg} ${req.body}`);
        res.status(400).send(`Bad Request: ${msg}`);
        return;
    }
    if (!req.body.message) {
        const msg = 'invalid Pub/Sub message format';
        logger.info(`${msg} ${req.body}`);
        res.status(400).send(`Bad Request: ${msg}`);
        return;
    }

    logger.info("Loading Secrets")
    const riotAPI = getSecretVal(client.accessSecretVersion({ name: 'projects/lad-alert/secrets/RIOT_TOKEN/versions/latest' })); 
    const discAPI = getSecretVal(client.accessSecretVersion({ name: 'projects/lad-alert/secrets/DISCORD_TOKEN/versions/latest' }));
    const channelID = getSecretVal(client.accessSecretVersion({ name: 'projects/lad-alert/secrets/CHANNEL_ID/versions/latest' }));

    logger.info("Beginning League Lad Check")
    leagueLadCheck(riotAPI, discAPI, channelID).then(() => {
        logger.info('Completed Lad Run Check');
        res.status(204).send('Found Lads');
    });
});