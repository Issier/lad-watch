import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export default async function sendLeagueLadAlert(gameData, channelID, discordToken) {
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

    const rest = new REST({ version: '10'}).setToken(discordToken);
    const discordAPI = new API(rest);
    discordAPI.channels.createMessage(channelID, {
        embeds: [imageEmbed],
        files: [{contentType: 'image/png', data: readFileSync(resolve(process.cwd(), "champion", `${gameData.champion}.png`)), name: `${gameData.champion}.png`}]
    });
}