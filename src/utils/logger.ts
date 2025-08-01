// / src/utils/logger.ts
import winston from 'winston';
import { config } from './config.js';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

// Custom format for development
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  simple()
);

// Custom format for production
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.node_env === 'production' ? prodFormat : devFormat,
  defaultMeta: { service: 'voice-todo-app' },
  transports: [
    new winston.transports.Console(),
    
    // File transports for production
    ...(config.node_env === 'production' ? [
      new winston.transports.File({ 
        filename: 'logs/error.log', 
        level: 'error' 
      }),
      new winston.transports.File({ 
        filename: 'logs/combined.log' 
      })
    ] : [])
  ]
});

// Create logs directory if it doesn't exist
if (config.node_env === 'production') {
  import('fs').then(fs => {
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }
  }).catch(console.error);
}

export default logger;