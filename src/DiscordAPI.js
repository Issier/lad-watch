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

export async function sendPostGameUpdate(postGameInfo, postGameLadInfo, messageId, channelID, discordToken) {
    let gameDuration = `${Math.floor(postGameInfo.gameDuration / 60)}:${(postGameInfo.gameDuration % 60).toString().padStart(2, '0')}`;
    let gameVersion = postGameInfo.gameVersion.split('.').slice(0, 2).join('.');  
    
    let position = `${postGameLadInfo?.teamPosition?.slice(0, 1)}${postGameLadInfo?.teamPosition?.toLowerCase()?.slice(1)}`

    const rest = new REST({ version: '10', timeout: 20_000}).setToken(discordToken);
    const discordAPI = new API(rest);

    let content = `
                ${postGameLadInfo?.summonerName} ${postGameLadInfo?.win ? 'Won' : 'Lost'} a game on ${postGameLadInfo?.champion} in ${gameDuration}
                
                KDA: ${postGameLadInfo?.kills}/${postGameLadInfo?.deaths}/${postGameLadInfo?.assists}
                Level at end of Game: ${postGameLadInfo?.champLevel}
                Game Duration: ${gameDuration}
                Game Version: ${gameVersion}
                Position: ${position || 'Unknown'}

                ${postGameLadInfo?.doubleKills ? `${postGameLadInfo.doubleKills} Double Kills` : ''}
                ${postGameLadInfo?.tripleKills ? `${postGameLadInfo.tripleKills} Triple Kills` : ''}
                ${postGameLadInfo?.quadraKills ? `${postGameLadInfo.quadraKills} Quadra Kills` : ''}
                ${postGameLadInfo?.pentaKills  ? `${postGameLadInfo.pentaKills} Penta Kills` : ''}
    `;

    if (embeds.length > 0) {
        logger.log({
            level: 'info',
            message: `Sending Post Game Update with Content: ${content}`
        })

        return discordAPI.channels.createMessage(channelID, {
            content: content,
            message_reference: {
                message_id: messageId
            }
        }).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to send discord message for ${postGameLadInfo?.summonerName}, ${JSON.stringify(error)}`
            })
        });
    } 
}

export async function sendLeagueLadAlerts(dataEntries, channelID, discordToken) {
    const storage = new Storage();

    let embeds = [];
    let images = [];
    let summoners = [];
    let formattedGamesData = getGameNotificationData(dataEntries);
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
        return discordAPI.channels.createMessage(channelID, {
            embeds: embeds,
            files: images
        }).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to send discord message for ${summoners.join(',')}`
            })
        });
    }
}