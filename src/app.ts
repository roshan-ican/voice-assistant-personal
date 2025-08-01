// src/app.ts - Main Application File (Fixed with relative imports)
import Fastify from 'fastify';
import { config, validateConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { dbManager } from './data/database/mongodb.js';
import { UserRepository } from './data/repositories/userRepository.js';
import { TodoRepository } from './data/repositories/todoRepository.js';
import { wsManager } from './websockets/websocketManager.js';
import mongoose from 'mongoose';
import type { DatabaseHealth } from './types/index.js';

// Validate configuration first
validateConfig();

// Fix: Properly type the Fastify logger options
const loggerOptions = config.node_env === 'development' ? {
  level: config.logging.level,
  transport: {
    target: 'pino-pretty',
    options: {
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    }
  }
} : {
  level: config.logging.level
};

const fastify = Fastify({
  logger: loggerOptions
});

// Register plugins
await fastify.register(import('@fastify/helmet'));
await fastify.register(import('@fastify/cors'), {
  origin: config.node_env === 'development' ? true : ['http://localhost:3000'],
  credentials: true
});

await fastify.register(import('@fastify/rate-limit'), {
  max: config.rateLimit.max,
  timeWindow: config.rateLimit.window
});

await fastify.register(import('@fastify/websocket'));

// Initialize database connection
await dbManager.connect();

// Register repositories as decorators for easy access
fastify.decorate('userRepository', new UserRepository());
fastify.decorate('todoRepository', new TodoRepository());

// Declare the types for decorators
declare module 'fastify' {
  interface FastifyInstance {
    userRepository: UserRepository;
    todoRepository: TodoRepository;
  }
}

// ====== ROUTES ======

// Health check route
fastify.get('/health', async () => {

  const dbHealth: DatabaseHealth = await dbManager.healthCheck();

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.node_env,
    database: dbHealth,
    services: {
      mongodb: dbHealth.status === 'connected' ? '✅' : '❌',
      redis: '🔄', // Will add Redis health check later
      websockets: wsManager.getActiveConnections() > 0 ? '✅' : '⚪',
      active_connections: wsManager.getActiveConnections(),
      voice_processing: '🎤',
      embeddings: '🧠'
    }
  };
});

// API Status
fastify.get('/api/v1/status', async () => {

  return {
    message: 'Voice Todo API is running!',
    features: {
      voice_processing: 'enabled',
      multi_language: 'enabled',
      notion_integration: 'enabled',
      semantic_search: 'enabled'
    },
    uptime: process.uptime()
  };
});

// Database test route (FOR DEVELOPMENT ONLY)
fastify.get('/api/v1/db/test', async (request, reply) => {
  console.log(request)
  try {
    // Fix: Properly create test user
    const testUser = await fastify.userRepository.create({
      email: `test-${Date.now()}@example.com`,
      password: 'test123456',
      name: 'Test User',
      voice_preferences: {
        language: 'en',
        confidence_threshold: 0.8,
        auto_create_todos: true,
        voice_response_enabled: true,
        preferred_accent: 'neutral'
      },
      usage_stats: {
        total_todos_created: 0,
        voice_minutes_processed: 0,
        total_searches: 0
      },
      notion_integration: {},
      is_active: true,
      email_verified: false,
      subscription_tier: 'free'
    });

    // Fix: Convert string ID to ObjectId properly
    const userObjectId = new mongoose.Types.ObjectId(testUser._id.toString())

    // Fix: Create test todo with proper ObjectId
    const testTodo = await fastify.todoRepository.create({
      user_id: userObjectId as any,
      title: 'Test Voice Todo',
      content: {
        original_transcript: 'Create a test todo',
        cleaned_text: 'Create a test todo',
        confidence_score: 0.95,
        detected_language: 'en',
        translated_content: new Map()
      },
      audio_metadata: {
        voice_response_generated: false,
        audio_format: 'webm'
      },
      notion_data: {
        sync_status: 'pending'
      },
      embedding: {
        vector_generated: false,
        embedding_model: 'text-embedding-004',
        embedding_dimensions: 768
      },
      context: {
        related_todos: []
      },
      processing_status: {
        voice_processed: false,
        notion_created: false,
        embedding_generated: false,
        voice_response_sent: false
      },
      priority: 'medium',
      status: 'created',
      tags: []
    });

    return {
      message: 'Database test successful!',
      user: {
        id: testUser._id,
        email: testUser.email,
        name: testUser.name
      },
      todo: {
        id: testTodo._id,
        title: testTodo.title,
        status: testTodo.status
      }
    };
  } catch (error) {
    reply.status(500);
    return {
      error: 'Database test failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
});

// Serve the test HTML client
fastify.get('/', async (request, reply) => {
  reply.type('text/html');
  console.log(request, "req")
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Voice Todo App</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 600px; 
                margin: 50px auto; 
                padding: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                text-align: center;
            }
            .card {
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
            }
            .links { margin-top: 30px; }
            .links a {
                display: inline-block;
                margin: 10px;
                padding: 12px 24px;
                background: rgba(255,255,255,0.2);
                color: white;
                text-decoration: none;
                border-radius: 25px;
                transition: all 0.3s ease;
            }
            .links a:hover {
                background: rgba(255,255,255,0.3);
                transform: translateY(-2px);
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🎤 Voice Todo App</h1>
            <p>Your AI-powered voice todo assistant</p>
            <div class="links">
                <a href="/health">Health Check</a>
                <a href="/api/v1/status">API Status</a>
                <a href="/api/v1/db/test">Test Database</a>
            </div>
            <div style="margin-top: 30px;">
                <h3>🎙️ Voice Features</h3>
                <p>WebSocket endpoint: <code>ws://localhost:${config.port}/ws/voice</code></p>
                <p style="font-size: 14px; opacity: 0.8;">
                    Use the WebSocket endpoint to connect your voice client
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
});

// WebSocket route for voice processing
fastify.register(async function (fastify) {
  fastify.get('/ws/voice', { websocket: true }, (connection, req) => {
    // Use the WebSocket manager to handle the connection
    const connectionId = wsManager.handleConnection(connection.socket);

    logger.info(`🎤 Voice WebSocket established: ${connectionId}`);

    // Optional: Log user info if available
    const userAgent = req.headers['user-agent'] || 'Unknown';
    logger.info(`📱 Client: ${userAgent}`);
  });
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
  console.log(request, 'Request error:', error);
  logger.error('Request error:', error);

  reply.status(error.statusCode || 500).send({
    error: {
      message: error.message,
      statusCode: error.statusCode || 500,
      timestamp: new Date().toISOString()
    }
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    // Shutdown WebSocket manager first
    wsManager.shutdown();

    await fastify.close();
    await dbManager.disconnect();
    logger.info('Server closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const start = async (): Promise<void> => {
  try {
    const address = await fastify.listen({
      port: config.port,
      host: config.host
    });

    logger.info(`🚀 Voice Todo App server is running!`);
    logger.info(`📡 Server listening on ${address}`);
    logger.info(`🌍 Environment: ${config.node_env}`);
    logger.info(`🎤 WebSocket endpoint: ws://localhost:${config.port}/ws/voice`);
    logger.info(`💊 Health check: http://localhost:${config.port}/health`);
    logger.info(`🏠 Home page: http://localhost:${config.port}/`);

  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
};

start().catch(console.error);

export default fastify;