import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import axios from 'axios';
import { createRequire } from "module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
const require = createRequire(import.meta.url);
const gameTypes = require("./queues.json");
const champions = require("./champion.json");
const env = parse(readFileSync(resolve(process.cwd(), ".env")));

async function fetchLeagueLadGameData(ladName) {
    const rankColors = {
        'DIAMOND': 0xb9f2ff,
        'EMERALD': 0x50C878,
        'PLATINUM': 0xE5E4E2,
        'GOLD': 0xFFD700,
        'SILVER': 0xC0C0C0,
        'BRONZE': 0xCD7F32,
        'IRON': 0x964B00
    }

    const axiosInstance = axios.create({
        headers: {
            'X-Riot-Token': env.RIOT_TOKEN
        }
    })

    /* Summoner Info */
    const summInfo = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-name/${ladName}`)).data;

    /* Summoner Ranked Data */
    const rankData = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summInfo.id}`)).data.filter(data => data.queueType === 'RANKED_SOLO_5x5')[0];

    try {
        /* Live Game Data */
        let liveGame = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/spectator/v4/active-games/by-summoner/${summInfo.id}`)).data;
        const gameType = gameTypes.filter(val => val.queueId === liveGame.gameQueueConfigId)[0]

        const summChar = liveGame.participants.filter(participant => {
            return participant.summonerName === summInfo.name;
        })[0].championId;

        let champion = ""
        for (const champ in champions.data) {
            if (champions.data[champ].key == summChar) {
                champion = champ;
            }
        }

        const gameTime = new Date(Date.now() - new Date(liveGame.gameStartTime));

        /* Live Game Champion Mastery for Summoner */
        const champMastery = (await axiosInstance.get(`https://na1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-summoner/${summInfo.id}/by-champion/${summChar}`)).data.championPoints;

        return {
            gameTime: `${gameTime.getMinutes()}:${gameTime.getSeconds().toString().padStart(2, '0')}`,
            champion: champion, 
            championMastery: `${champMastery.toLocaleString()}`,
            summonerName: summInfo.name,
            summonerRank: !rankData ? 'Unranked' : `${rankData.tier} ${rankData.rank} ${rankData.leaguePoints}LP`,
            liveGamePages: `[u.gg](https://u.gg/lol/profile/na1/${encodeURIComponent(summInfo.name)}/live-game)` +  
                           `| [op.gg](https://www.op.gg/summoners/na/${encodeURIComponent(summInfo.name)}/ingame)`,
            gameType: gameType.description.replace(' games', ''),
            rankColorHex: rankData.tier in rankColors ? rankColors[rankData.tier] : 0xFFFFFF
        }
        
    } catch (error) {
        return undefined;
    }
}

async function sendLeagueLadAlert(gameData) {
    const imageEmbed = new EmbedBuilder()
        .setColor(gameData.rankColorHex)
        .setTitle(`LadWatch: ${gameData.summonerName}`)
        .setDescription(`Playing ${bold(gameData.champion)} in ${gameData.gameType}`)
        .setThumbnail(`attachment://${gameData.champion}.png`)
        .setFields(
            {name: '\u200B', value: '\u200B'},
            {name: 'Game Time', value: gameData.gameTime, inline: true},
            {name: 'Champion Mastery', value: gameData.championMastery, inline: true},
            {name: 'Current Solo Queue Rank', value: gameData.summonerRank, inline: true},
            {name : 'Live Game Pages', value: gameData.liveGamePages}
        );

    const rest = new REST({ version: '10'}).setToken(env.DISCORD_TOKEN);
    const discordAPI = new API(rest);
    discordAPI.channels.createMessage(env.CHANNEL_ID, {
        embeds: [imageEmbed],
        files: [{contentType: 'image/png', data: readFileSync(resolve(process.cwd(), "champion", `${gameData.champion}.png`)), name: `${gameData.champion}.png`}]
    });
}

const gameData = await fetchLeagueLadGameData(env.SUMMONER_NAME);
gameData ? sendLeagueLadAlert(gameData) : console.log("Summoner not in game")