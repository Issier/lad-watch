FROM node:20-bookworm-slim

WORKDIR /DiscBot/

COPY package.json /DiscBot/
RUN npm install

COPY app.js /DiscBot/
COPY league_data/ /DiscBot/league_data
COPY src/ /DiscBot/src

EXPOSE 8080
CMD ["npm", "start"]
