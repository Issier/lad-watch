FROM node:20-bookworm-slim

WORKDIR /DiscBot/

COPY app.js /DiscBot/
COPY package.json /DiscBot/
COPY champion/ /DiscBot/champion
COPY league_data/ /DiscBot/league_data
COPY src/ /DiscBot/src

RUN npm install
CMD ["node", "app.js"]
