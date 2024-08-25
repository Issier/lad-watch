import winston from 'winston';
import { LoggingWinston } from '@google-cloud/logging-winston';
const isDev = process.env.NODE_ENV === 'development';

export const logger: winston.Logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'lad-watch' },
  transports: [
    isDev 
    ? new winston.transports.Console({
        format: winston.format.simple(),
    })
    : new LoggingWinston({ projectId: 'lad-alert' }),
  ],
});