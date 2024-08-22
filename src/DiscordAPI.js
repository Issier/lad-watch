import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import { Storage } from "@google-cloud/storage";
import { logger } from '../logger.js';

export function getGameNotificationData(dataEntries) {
    let notificationData = dataEntries.map(gameData => {
        return {
            summonerName: gameData.summonerName,
            rankColor: gameData.rankColorHex,
            title: `LadWatch: ${gameData.summonerName}`,
            champImagePath: `champion/${gameData.champion}.png`,
            champImageFileName: `${gameData.champion}.png`,
            description: `Playing ${bold(gameData.champion)} in ${gameData.gameType}`,
            thumbnail: `attachment://${gameData.champion}.png`,
            fields: [
                {name: '\u200B', value: '\u200B'},
                {name: 'Champion Mastery', value: gameData.championMastery, inline: true},
                {name: 'Current Solo Queue Rank', value: gameData.summonerRank, inline: true},
                {name: 'Game Time', value: gameData.gameTime, inline: true},    
                {name : 'Live Game Pages', value: gameData.liveGamePages}
            ]
        }
    })

    logger.log({
        level: 'info',
        message: `Notification Data: ${JSON.stringify(notificationData)}`
    })

    return notificationData
}

export async function sendLeagueLadAlerts(dataEntries, channelID, discordToken) {
    const storage = new Storage();

    let embeds = [];
    let images = [];
    let summoners = [];
    formattedGamesData = getGameNotificationData(dataEntries);
    for(const formattedGameData of formattedGamesData) {

        embeds.push(new EmbedBuilder()
            .setColor(formattedGameData.rankColor)
            .setTitle(formattedGameData.title)
            .setDescription(formattedGameData.description)
            .setThumbnail(formattedGameData.thumbnail)
            .setFields(...formattedGameData.fields));
        
        const champImage = await storage
             .bucket('lad-alert-champions')
             .file(formattedGameData.champImagePath)
             .download()
        
        logger.log({
            level: 'info',
            message: `Loaded Discord Embed with Data: ${JSON.stringify(formattedGameData)} with image having byte length of ${champImage[0].byteOffset}`
        })

        images.push({contentType: 'image/png', data: champImage[0], name: formattedGameData.champImageFileName});
        summoners.push(formattedGameData.summonerName);
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
                message: `Created discord message for ${summoners.join(',')}`
            })
            logger.log({
                level: 'info',
                message: `Discord Message Response: ${JSON.stringify(value)}`
            })
        }).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to send discord message for ${summoners.join(',')}`
            })
        });
    }
}