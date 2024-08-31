import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';
import { bold } from '@discordjs/formatters';
import { EmbedBuilder } from '@discordjs/builders';
import { Storage } from "@google-cloud/storage";
import { logger } from '../logger.js';
import { RiotAPITypes } from '@fightmegg/riot-api';
import { LeagueLadGameData } from './LoLAPI.js';

type FormattedGameData = {
    summonerName: string,
    rankColor: number,
    title: string,
    champImagePath: string,
    champImageFileName: string,
    description: string,
    thumbnail: string,
    gameId: number,
    fields: { name: string, value: string, inline?: boolean }[],
    seasonWins: number,
    seasonLosses: number,
    winLossRatio: number
}

export function getGameNotificationData(dataEntries): FormattedGameData[] {
    let notificationData = dataEntries.map((gameData: LeagueLadGameData) => {
        return {
            seasonWins: gameData.seasonWins,
            seasonLosses: gameData.seasonLosses,
            winLossRatio: gameData.seasonWins / gameData.seasonLosses,
            summonerName: gameData.summonerName,
            rankColor: gameData.rankColorHex,
            title: `LadWatch: ${gameData.summonerName}`,
            champImagePath: `champion/${gameData.champion}.png`,
            champImageFileName: `${gameData.champion}.png`,
            description: `Playing ${bold(gameData.champion)} in ${gameData.gameType}`,
            thumbnail: `attachment://${gameData.champion}.png`,
            gameId: gameData.gameId,
            fields: [
                { name: '\u200B', value: '\u200B' },
                { name: 'Current Solo Queue Rank', value: gameData.summonerRank, inline: true },
                { name: 'Game Time', value: gameData.gameTime, inline: true },
                { name: 'Live Game Pages', value: gameData.liveGamePages }
            ]
        }
    })

    logger.info(`Notification Data: ${JSON.stringify(notificationData)}`)

    return notificationData
}

export async function createThread(messageId, channelID, discordToken, gameType) {
    const rest = new REST({ version: '10', timeout: 30_000 }).setToken(discordToken);
    const discordAPI = new API(rest);

    const message = await discordAPI.channels.getMessage(channelID, messageId);
    if (!message) {
        logger.error(`Game message ${messageId} doesn't exist`);
        return null;
    }
    if (!message.thread) {
        return discordAPI.channels.createThread(channelID, {
            name: `${gameType} Postgame`,
            auto_archive_duration: 1440,
        }, messageId).catch(() => {
            logger.error(`Failed to create thread for ${messageId}`)
            return null;
        });
    } else {
        return message.thread;
    }
}

export async function sendPostGameUpdate(postGameInfo: RiotAPITypes.MatchV5.MatchInfoDTO, postGameLadInfo: RiotAPITypes.MatchV5.ParticipantDTO, killImage: Promise<Buffer>, messageId, channelID, discordToken) {
    let gameDuration = `${Math.floor(postGameInfo.gameDuration / 60)}:${(postGameInfo.gameDuration % 60).toString().padStart(2, '0')}`;
    let gameVersion = postGameInfo.gameVersion.split('.').slice(0, 2).join('.');

    let position = `${postGameLadInfo?.teamPosition?.slice(0, 1)}${postGameLadInfo?.teamPosition?.toLowerCase()?.slice(1)}`

    const rest = new REST({ version: '10', timeout: 30_000 }).setToken(discordToken);
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
            ${postGameLadInfo?.pentaKills ? `⚔️ ${postGameLadInfo.pentaKills} Penta Kill${postGameLadInfo.pentaKills > 1 ? 's' : ''}` : ''}
    `;

    logger.info(`Sending Post Game Update with Content: ${content}`)

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
            files: [map ? { contentType: 'image/png', data: map, name: 'kill.png' } : null].filter(Boolean)
        }).catch(error => {
            logger.info(`Failed to send discord message for ${postGameLadInfo?.summonerName}, ${JSON.stringify(error)}`)
            return null;
        });
    } else {
        logger.error('Unable to find match thread')
        return null;
    }
}

export async function sendLeagueLadAlert(gameId, dataEntries, ladDocRefs, channelID, discordToken) {
    const storage = new Storage();

    let embeds: { embed: EmbedBuilder, summonerName: string }[] = [];
    let images: { contentType: string, data: Buffer, name: string }[] = [];
    let summoners = [];
    let sentRefs = [];
    let formattedGamesData = getGameNotificationData(dataEntries);
    for (let i = 0; i < formattedGamesData.length; i++) {
        const ladRefDoc = await ladDocRefs[i].get();
        if (ladRefDoc.exists) continue;
        else sentRefs.push(ladDocRefs[i]);

        embeds.push({
            embed: new EmbedBuilder()
                .setColor(formattedGamesData[i].rankColor)
                .setTitle(formattedGamesData[i].title)
                .setDescription(formattedGamesData[i].description)
                .setThumbnail(formattedGamesData[i].thumbnail)
                .setFields(...formattedGamesData[i].fields)
                .setFooter({
                    text: `Game ID: ${formattedGamesData[i].gameId} | W/L: ${formattedGamesData[i].winLossRatio?.toFixed(2) || 'Unknown'}%`
                }),
            summonerName: formattedGamesData[i].summonerName
        });
        summoners.push(formattedGamesData[i].summonerName);

        const champImage = await storage
            .bucket('lad-alert-champions')
            .file(formattedGamesData[i].champImagePath)
            .download()
        images.push({ contentType: 'image/png', data: champImage[0], name: formattedGamesData[i].champImageFileName });

        logger.info(`Loaded Discord Embed with Data: ${JSON.stringify(formattedGamesData[i])} with image having byte length of ${champImage[0].byteOffset}`)
    }

    if (embeds.length == 0)
        return null;

    const rest = new REST({ version: '10', timeout: 20_000 }).setToken(discordToken);
    const discordAPI = new API(rest);

    const message = await discordAPI.channels.createMessage(channelID, {
        embeds: embeds.map(embed => embed.embed.toJSON()),
        files: images,
    }).catch(error => {
        logger.error(`Failed to send discord message for ${summoners.join(',')}, ${channelID}: ${JSON.stringify(error)}`)
    })

    if (message) {
        for (let i = 0; i < sentRefs.length; i++) {
            sentRefs[i].set({
                gameId: gameId,
                champion: dataEntries.find(game => game.summonerName === summoners[i]).champion,
                gameType: dataEntries.find(game => game.summonerName === summoners[i]).gameType,
                messageId: message.id,
                sentPostGame: false
            })
        }
        return { messageId: message.id, summonerNames: summoners }; 
    }
}
