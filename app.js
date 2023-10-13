import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import axios from 'axios';
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const gameTypes = require("./queues.json");
const champions = require("./champion.json");

const rest = new REST({ version: '10'}).setToken(process.env.DISCORD_TOKEN);

const api = new API(rest);

const summInfo = (await axios.get(`https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-name/${process.env.SUMMONER_NAME}`, {
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

    let summChar = response.data.participants.filter(participant => {
        return participant.summonerName === name;
    })[0].championId;

    let champion = ""
    for (const champ in champions.data) {
        if (champions.data[champ].key == summChar) {
            champion = champ;
        }
    }

    axios.get(`https://na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-summoner/${summInfo.id}/by-champion/${summChar}`, {
        headers: {
            "X-Riot-Token": process.env.RIOT_TOKEN
        }
    }).then(async champMasteryResponse => {
        let champMastery = champMasteryResponse.data.championPoints

        let gameTime = new Date(Date.now() - new Date(response.data.gameStartTime));

        let rankData = await axios.get(`https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summInfo.id}`, {
            headers: {
                "X-Riot-Token": process.env.RIOT_TOKEN
            }
        });

        rankData = rankData.data.filter(data => data.queueType === 'RANKED_SOLO_5x5')[0]

        const liveGamePages = `[u.gg](https://u.gg/lol/profile/na1/${encodeURIComponent(name)}/live-game) | ` +
        `[op.gg](https://www.op.gg/summoners/na/${encodeURIComponent(name)}/ingame)`

        const imageEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle("LadWatch Alert")
            .setDescription(bold(`${name} is playing ${champion} in ${gameType.description.replace(' games', '')}`))
            .setThumbnail(`http://ddragon.leagueoflegends.com/cdn/13.20.1/img/champion/${champion}.png`)
            .setFields(
                {name: '\u200B', value: '\u200B'},
                {name: 'Game Time', value: `${gameTime.getMinutes()}:${gameTime.getSeconds().toString().padStart(2, '0')}`, inline: true},
                {name: 'Champion Mastery', value: `${champMastery.toLocaleString()}`, inline: true},
                {name: 'Current Solo Queue Rank', value: !rankData ? 'Unranked' : `${rankData.tier} ${rankData.rank} ${rankData.leaguePoints}LP`, inline: true},
                {name : 'Live Game Pages', value: liveGamePages}

            )

        api.channels.createMessage(process.env.CHANNEL_ID, {
            embeds: [imageEmbed]
        });
        console.log(`## ${name} is playing ${champion} in ${gameType.description}`)
    })
}).catch(error => {
    if (error.response && error.response.status === 404) {
        console.log('Not in a game')
    }
})