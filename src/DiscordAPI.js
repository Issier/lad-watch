import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import { Storage } from "@google-cloud/storage";
import { logger } from '../logger';

export async function sendLeagueLadAlerts(dataEntries, channelID, discordToken) {
    const storage = new Storage();

    let embeds = [];
    let images = []
    for (const gameData of dataEntries) {
        embeds.push(new EmbedBuilder()
            .setColor(gameData.rankColorHex)
            .setTitle(`LadWatch: ${gameData.summonerName}`)
            .setDescription(`Playing ${bold(gameData.champion)} in ${gameData.gameType}`)
            .setThumbnail(`attachment://${gameData.champion}.png`)
            .setFields(
                {name: '\u200B', value: '\u200B'},
                {name: 'Champion Mastery', value: gameData.championMastery, inline: true},
                {name: 'Current Solo Queue Rank', value: gameData.summonerRank, inline: true},
                {name: 'Game Time', value: gameData.gameTime, inline: true},    
                {name : 'Live Game Pages', value: gameData.liveGamePages}
            ));
        
        if (process.env.NODE_ENV === 'development') {
            images.push({contentType: 'image/png', data: champImage[0], name: `${gameData.champion}.png`})
        }
        const champImage = await storage
             .bucket('lad-alert-champions')
             .file(`champion/${gameData.champion}.png`)
             .download()
        images.push({contentType: 'image/png', data: champImage[0], name: `${gameData.champion}.png`})
    }
    const rest = new REST({ version: '10', timeout: 20_000}).setToken(discordToken);
    const discordAPI = new API(rest);
    if (embeds.length > 0) {
        discordAPI.channels.createMessage(channelID, {
            embeds: embeds,
            files: images
        }).then(value => {
            logger.log({
                level: 'info',
                message: `Created discord message for ${gameData.summonerName}`
            })
        }).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to send discord message for ${gameData.summonerName}`
            })
        });
    }
}