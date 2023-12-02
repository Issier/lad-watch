import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';


export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'lad-watch' },
  transports: [
    new winston.transports.Console({
        format: winston.format.simple(),
    }),
    new LoggingWinston()
  ],
});