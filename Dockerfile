FROM node:20-bookworm AS build

WORKDIR /DiscBot/

COPY package*.json /DiscBot/
RUN npm install

COPY app.ts /DiscBot/
COPY logger.ts /DiscBot/
COPY src/ /DiscBot/src
COPY tsconfig.json /DiscBot/
RUN npm run build-prod

FROM node:20-bookworm-slim AS production
COPY --from=build /DiscBot/dist /usr/src/DiscBot
COPY --from=build /DiscBot/node_modules /usr/src/DiscBot/node_modules
WORKDIR /usr/src/DiscBot
CMD ["app.js"]