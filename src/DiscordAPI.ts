import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import { Storage } from "@google-cloud/storage";
import { logger } from '../logger.js';
import { RiotAPITypes } from '@fightmegg/riot-api';

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

export async function sendPostGameUpdate(postGameInfo: RiotAPITypes.MatchV5.MatchInfoDTO, postGameLadInfo: RiotAPITypes.MatchV5.ParticipantDTO, killImage: Promise<Buffer>, messageId, channelID, discordToken) {
    let gameDuration = `${Math.floor(postGameInfo.gameDuration / 60)}:${(postGameInfo.gameDuration % 60).toString().padStart(2, '0')}`;
    let gameVersion = postGameInfo.gameVersion.split('.').slice(0, 2).join('.');  
    
    let position = `${postGameLadInfo?.teamPosition?.slice(0, 1)}${postGameLadInfo?.teamPosition?.toLowerCase()?.slice(1)}`

    const rest = new REST({ version: '10', timeout: 30_000}).setToken(discordToken);
    const discordAPI = new API(rest);

    let content = `
                ## ${postGameLadInfo?.summonerName} ${postGameLadInfo?.win ? 'Won' : 'Lost'} a game on ${postGameLadInfo?.championName} in ${gameDuration}
                
                >>> KDA: ${postGameLadInfo?.kills}/${postGameLadInfo?.deaths}/${postGameLadInfo?.assists}
            Level at end of Game: ${postGameLadInfo?.champLevel}
            Game Duration: ${gameDuration}
            Game Version: [${gameVersion}](${`https://www.leagueoflegends.com/en-us/news/game-updates/patch-${gameVersion.split('.')[0]}-${gameVersion.split('.')[1]}-notes/`})
            Position: ${position || 'Unknown'}

            ${postGameLadInfo?.doubleKills ? `⚔️ ${postGameLadInfo.doubleKills} Double Kill${postGameLadInfo.doubleKills > 1 ? 's' : ''}` : ''}
            ${postGameLadInfo?.tripleKills ? `⚔️ ${postGameLadInfo.tripleKills} Triple Kill${postGameLadInfo.tripleKills > 1 ? 's' : ''}` : ''}
            ${postGameLadInfo?.quadraKills ? `⚔️ ${postGameLadInfo.quadraKills} Quadra Kill${postGameLadInfo.quadraKills > 1 ? 's' : ''}` : ''}
            ${postGameLadInfo?.pentaKills  ? `⚔️ ${postGameLadInfo.pentaKills} Penta Kill${postGameLadInfo.pentaKills > 1 ? 's' : ''}` : ''}
    `;

    logger.log({
        level: 'info',
        message: `Sending Post Game Update with Content: ${content}`
    })

    if (!messageId) {
        throw new Error('No Message ID provided for Post Game Update');
    }

    let embed = new EmbedBuilder()
        .setColor(postGameLadInfo?.win ? 0x00FF00 : 0xFF0000)
        .setTitle(`${postGameLadInfo?.win ? '🟩' : '🟥'} ${postGameLadInfo?.summonerName} as ${postGameLadInfo?.championName}`)
        .setDescription(content);

    if (killImage) {
        embed = embed.setImage(`attachment://kill.png`);
    }

    const message = await discordAPI.channels.getMessage(channelID, messageId);

    if (message.thread) {
        const map: Buffer = await killImage;
        return discordAPI.channels.createMessage(message.thread.id, {
            embeds: [embed.toJSON()],
            files: [map ? {contentType: 'image/png', data: map, name: 'kill.png'} : null].filter(Boolean)
        }).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to send discord message for ${postGameLadInfo?.summonerName}, ${JSON.stringify(error)}`
            })
        });

    } else {
        return discordAPI.channels.createThread(channelID,{
            name: `${postGameLadInfo?.win ? '🟩' : '🟥'} ${postGameLadInfo?.summonerName} as ${postGameLadInfo?.championName}`,
            auto_archive_duration: 1440,
        }, messageId).then(async thread => {
            const map: Buffer = await killImage;
            return discordAPI.channels.createMessage(thread.id, {
                embeds: [embed.toJSON()],
                files: [killImage ? {contentType: 'image/png', data: map, name: 'kill.png'} : null].filter(Boolean)    
            }).catch(error => {
                logger.log({
                    level: 'error',
                    message: `Failed to send discord message for ${postGameLadInfo?.summonerName}, ${JSON.stringify(error)}`
                })
            });
        }).catch(error => {
            logger.log({
                level: 'error',
                message: `Failed to create thread for ${postGameLadInfo?.summonerName}, ${JSON.stringify(error)}`
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
                message: `Failed to send discord message for ${summoners.join(',')}, ${channelID}: ${JSON.stringify(error)}`
            })
        });
    }
}