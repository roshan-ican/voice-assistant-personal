// src/app.js
import Fastify from 'fastify';
import { config, validateConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

// Validate configuration first
validateConfig();

const fastify = Fastify({
  logger: {
    level: config.logging.level,
    transport: config.node_env === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      }
    } : undefined
  }
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

// Health check route
fastify.get('/health', async (request, reply) => {
  return { 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.node_env
  };
});

// Basic API routes
fastify.get('/api/v1/status', async (request, reply) => {
  return {
    message: 'Voice Todo API is running!',
    features: {
      voice_processing: 'enabled',
      multi_language: 'enabled',
      notion_integration: 'enabled',
      semantic_search: 'enabled'
    }
  };
});

// WebSocket route for voice processing (placeholder)
fastify.register(async function (fastify) {
  fastify.get('/ws/voice', { websocket: true }, (connection, req) => {
    logger.info('WebSocket connection established');
    
    connection.socket.on('message', message => {
      logger.info('Received message:', message.toString());
      
      // Echo back for now
      connection.socket.send(JSON.stringify({
        type: 'echo',
        message: 'Connection established, voice processing will be implemented next!',
        timestamp: new Date().toISOString()
      }));
    });

    connection.socket.on('close', () => {
      logger.info('WebSocket connection closed');
    });
  });
});

// Error handler
fastify.setErrorHandler((error, request, reply) => {
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
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  
  try {
    await fastify.close();
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
const start = async () => {
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
    
  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
};

start();

export default fastify;