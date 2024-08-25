FROM node:20-bookworm-slim

WORKDIR /DiscBot/

COPY package*.json /DiscBot/
RUN npm install

COPY app.ts /DiscBot/
COPY logger.ts /DiscBot/
COPY src/ /DiscBot/src

EXPOSE 8080
CMD ["npm", "start"]
