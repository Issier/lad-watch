# lad-watch
A NodeJS application to check a list of Summoner names from League of Legends and post to an indicated Discord channel if the user is currently in a game.

Details include summoner rank, champion being played, champion mastery, queue type and links to relevant u.gg and op.gg pages

## Setup
Lad watch requires three secrets:
- RIOT_TOKEN: A Riot Games API key
- DISCORD_TOKEN: A Discord API token configured for the bot
- CHANNEL_ID: The name of the Discord channel where the alert should be posted

The project is currently configured to require gcloud access as the champion images are stored in a private GCloud bucket.

LadWatch assumes a gcloud project named `lad-alert` with the above secret names.

### Setup and Run
Make sure you are setup locally with your gcloud credentials in Application Default Credentials:
- `gcloud auth application-default login`

It's also recommended to set up these credentials to impersonate the service account that will be used to serve the application:
- `gcloud auth application-default login --impersonate-service-acount={service account}`

See the [Google Cloud docs](https://cloud.google.com/docs/authentication/provide-credentials-adc) for more info

After gcloud credentials are ready, you can run against gcloud with: 
- `git clone git@github.com:Issier/lad-watch.git`
- `cd ./lad-watch`
- `npm install`
- `npm start`
    - Note: There is also a `npm start-dev` option that will use local evironment variables for your secrets. This is WIP at the moment as several resources that are required for LadWatch are currently configured in code to rely on google cloud services. 

### Sample Discord Output
![image](https://github.com/Issier/lad-watch/assets/23412323/19eb00a7-9e02-4479-b4a2-6d913e274a73)

