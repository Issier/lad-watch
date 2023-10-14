import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import sendLeagueLadAlert from "./src/DiscordAPI.js";
import fetchLeagueLadGameData from "./src/LoLAPI.js";
const env = parse(readFileSync(resolve(process.cwd(), ".env")));

const gameData = await fetchLeagueLadGameData(env.SUMMONER_NAME, env.RIOT_TOKEN);
gameData ? sendLeagueLadAlert(gameData, env.CHANNEL_ID, env.DISCORD_TOKEN) : console.log("Summoner not in game")