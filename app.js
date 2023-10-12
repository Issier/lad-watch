import { API } from '@discordjs/core';
import { REST } from '@discordjs/rest';

const rest = new REST({ version: '10'}).setToken(process.env.DISCORD_TOKEN);

const api = new API(rest);

const guild = await api.guilds.getChannels('872984504770392094')

console.log(guild)