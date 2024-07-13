# lad-watch
A NodeJS application to check a list of Summoner names from League of Legends and post to an indicated Discord channel if the user is currently in a game.

Details include summoner rank, champion being played, champion mastery, queue type and links to relevant u.gg and op.gg pages

## Setup
### Local w/ Test Data
For local development, Lad watch requires one secret:
- RIOT_TOKEN: A Riot Games DevelopmentAPI key

NODE_ENV must be set to `development` to use local files / configs rather than reaching out to GCloud.

LadWatch running localy in `development` mode expects the following files to be present:
- league_data/champion.json
- league_data/queues.json:
    - Data representing champion and queue type information for League of Legends. This can be retrieved from Data Dragon, a CDN hosted by Riot Games that contains static files related to game patches.
- league_data/lads.json:
    - A list of objects representing a riot user name
    - Of the form [{"gameName": {Game Name},"tagLine": {Tag}}]

When in local development, sending a POST request with a body of {"message": {}} will trigger LadWatch to check for active games involving the riot users listed in lads.json (This request is required as it follows the structure that LadWatch expects to recieve from GCloud Scheduler when it's deployed as a Cloud Run project). 

The result will then be logged to console. Sending posts to Discord requires configuring the project to point at a properly configured GCloud environment. 

### Targeting GCloud Deploy
Lad watch requires three secrets:
- RIOT_TOKEN: A Riot Games API key
- DISCORD_TOKEN: A Discord API token configured for the bot
- CHANNEL_ID: The name of the Discord channel where the alert should be posted

The project is currently configured to require gcloud access as the champion images are stored in a private GCloud bucket.

#### Setup and Run
Make sure you are setup locally with your gcloud credentials in Application Default Credentials:
- `gcloud auth application-default login`

It's also recommended to set up these credentials to impersonate the service account that will be used to serve the application:
- `gcloud auth application-default login --impersonate-service-acount={service account}`

See the [Google Cloud docs](https://cloud.google.com/docs/authentication/provide-credentials-adc) for more info

After gcloud credentials are ready, the project can be built as a docker container:
- `docker build -t {image_name} .`

And then run the above docker container. 

The [Google Cloud Code VS Code Extension](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode) can be used to run this as a local container, using your ADC configured above (and optionally passing a service account as the agent)

To run locally with just gcloud credentials:
- `npm install`
- `npm start`

Once that is all up and running, LadWatch is currently configured to be triggered by a post request (like what would be expected by a Pub/Sub event in Google Cloud).

A curl command to test against the code is:
- `curl -H 'content-type: application/json' -H "Authorization: Bearer $ACCESS_TOKEN" -X POST --data $'{  "message": [{"data": "abcd"}]}' localhost:{PORT}`

With PORT likely being 8080 if you're running as is, typically 8081 by default if using Google CLoud Code extension or this can be set when running the docker image.

### Sample Discord Output
![image](https://github.com/Issier/lad-watch/assets/23412323/19eb00a7-9e02-4479-b4a2-6d913e274a73)

