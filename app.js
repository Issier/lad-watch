import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import axios from 'axios';
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const gameTypes = require("./queues.json");

const rest = new REST({ version: '10'}).setToken(process.env.DISCORD_TOKEN);

const api = new API(rest);

const summInfo = (await axios.get('https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-name/One%20Cappuccino', {
    headers: {
        "X-Riot-Token": process.env.RIOT_TOKEN
    }
})).data;

const name = summInfo.name;

axios.get(`https://na1.api.riotgames.com/lol/spectator/v4/active-games/by-summoner/${summInfo.id}`, {
    headers: {
        "X-Riot-Token": process.env.RIOT_TOKEN
    }
}).then(response => {
    let gameType = gameTypes.filter(val => val.queueId === response.data.gameQueueConfigId)[0]
    console.log(`${name} is in a game, playing ${gameType.description}`)
}).catch(error => {
    if (error.response && error.response.status === 404) {
        console.log('Not in a game')
    }
})