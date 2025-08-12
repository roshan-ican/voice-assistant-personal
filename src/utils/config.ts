// src/utils/config.ts
import dotenv from 'dotenv';
import type { AppConfig } from '@/types/index.js';

dotenv.config();

export const config: AppConfig = {
    // Server
    node_env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000'),
    host: 'localhost',

    // Database
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-todo-app'
    },

    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD })
    },

    // API Keys
    apis: {
        gemini: process.env.GEMINI_API_KEY || '',
        elevenlabs: process.env.ELEVENLABS_API_KEY || '',
        notion: process.env.NOTION_API_KEY || '',
        pinecone: {
            apiKey: process.env.PINECONE_API_KEY || '',
            environment: "us-west1-gcp-free",
            index: "notion-todos"
        }
    },

    // JWT
    jwt: {
        secret: process.env.JWT_SECRET || 'fallback-secret-key',
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    },

    // Logging
    logging: {
        level: process.env.LOG_LEVEL || 'info'
    },

    // Rate Limiting
    rateLimit: {
        max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
        window: parseInt(process.env.RATE_LIMIT_WINDOW || '900000') // 15 minutes
    },

    // File Upload
    upload: {
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB
        uploadDir: process.env.UPLOAD_DIR || './uploads'
    },
    notion_db: {
        uri: process.env.NOTION_DB_ID || 'no notion db id provided' // Fallback if not set
    }
};


// Validation
const requiredEnvVars = [
    'GEMINI_API_KEY',
    'ELEVENLABS_API_KEY',
    'NOTION_API_KEY',
    'PINECONE_API_KEY',
] as const;

export const validateConfig = (): boolean => {
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    console.log('✅ Configuration validated successfully');
    return true;
};