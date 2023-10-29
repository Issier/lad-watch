import { sendLeagueLadAlerts } from "./src/DiscordAPI.js";
import fetchLeagueLadGameData from "./src/LoLAPI.js";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { createRequire } from "module";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const lads = require(resolve(process.cwd(), "league_data", "lads.json"));
const isDev = process.env.NODE_ENV === 'development';

function getSecretVal(secret) {
    return secret[0].payload.data.toString();
}

export async function leagueLadCheck() {
    const client = new SecretManagerServiceClient();
    const riotAPI = isDev ? process.env.RIOT_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/RIOT_TOKEN/versions/latest' }));
    const discAPI = isDev ? process.env.DISCORD_TOKEN : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/DISCORD_TOKEN/versions/latest' }));
    const channelID = isDev ? process.env.CHANNEL_ID : getSecretVal(await client.accessSecretVersion({ name: 'projects/lad-alert/secrets/CHANNEL_ID/versions/latest'}));

    let toSend = [];
    for (const lad of lads) {
        const gameData = await fetchLeagueLadGameData(lad, riotAPI);
        if (!!gameData && !(lads[lad].has(gameData.gameId))) {
            toSend.push(gameData);
            lads[lad].add(gameData.gameId)
        }
    }
    sendLeagueLadAlerts(toSend, channelID, discAPI);
}             

leagueLadCheck();
