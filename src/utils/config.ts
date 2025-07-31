// src/utils/config.js
import dotenv from 'dotenv';
dotenv.config();

// Helper function to safely parse integers
function parseEnvInt(value, fallback) {
    const parsed = parseInt(value);
    return isNaN(parsed) ? fallback : parsed;
}

export const config = {
    // Server
    node_env: process.env.NODE_ENV || 'development',
    port: parseEnvInt(process.env.PORT, 3000),
    host: process.env.HOST || '0.0.0.0',

    // Database
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-todo-app'
    },

    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseEnvInt(process.env.REDIS_PORT, 6379),
        password: process.env.REDIS_PASSWORD || null
    },

    // API Keys
    apis: {
        gemini: process.env.GEMINI_API_KEY || '',
        elevenlabs: process.env.ELEVENLABS_API_KEY || '',
        notion: process.env.NOTION_API_KEY || '',
        pinecone: {
            apiKey: process.env.PINECONE_API_KEY || '',
            environment: process.env.PINECONE_ENVIRONMENT || ''
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
        max: parseEnvInt(process.env.RATE_LIMIT_MAX, 100),
        window: parseEnvInt(process.env.RATE_LIMIT_WINDOW, 15 * 60 * 1000) // 15 minutes
    },

    // File Upload
    upload: {
        maxFileSize: parseEnvInt(process.env.MAX_FILE_SIZE, 10 * 1024 * 1024), // 10MB
        uploadDir: process.env.UPLOAD_DIR || './uploads'
    }
};