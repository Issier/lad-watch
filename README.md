# lad-watch
A NodeJS application to check a list of Summoner names from League of Legends and post to an indicated Discord channel if the user is currently in a game

# Local Setup
Lad watch requires three secrets:
RIOT_TOKEN: A Riot Games API key
DISCORD_TOKEN: A Discord API token
CHANNEL_ID: The name of the Discord channel where the alert should be posted

For local development (run with `npm start-dev`), these can be specified as environment variables.

For non-local development, Lad Watch is written to run on google cloud infrastructure and requires access to Google Cloud Storage and Secrets Manager

## Sample Discord Output
![image](https://github.com/Issier/lad-watch/assets/23412323/19eb00a7-9e02-4479-b4a2-6d913e274a73)

