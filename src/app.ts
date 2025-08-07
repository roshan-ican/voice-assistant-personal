// src/app.ts - Enhanced with Real Gemini Integration
import Fastify from 'fastify';
import { config, validateConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { dbManager } from './data/database/mongodb.js';
import { UserRepository } from './data/repositories/userRepository.js';
import { TodoRepository } from './data/repositories/todoRepository.js';
import { enhancedWsManager } from './websockets/enhancedWebSocketManager.js';
import { GeminiService } from './services/geminiService.js';
import type { DatabaseHealth } from './types/index.js';
import { ElevenLabsService } from './services/elevenLabs.js';
import { NotionService } from './services/notionService.js';
import { PineconeService } from './services/pineconeService.js';
import { setupSimpleVoiceWebSocket } from './handler/simpleNotion.js';
import notionRoutes from './routes/notionRoutes.js';
import voiceRoutes from './routes/voiceQueryRoutes.js';


validateConfig();

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
const fastify = Fastify({ logger: loggerOptions });

const elevenLabsService = new ElevenLabsService(config.apis.elevenlabs);
const notionService = new NotionService(config.apis.notion, config.apis.notion);
const pineconeService = new PineconeService(
  config.apis.pinecone.apiKey,
  config.apis.pinecone.apiKey,
  config.apis.pinecone.index
);

// Initialize Gemini service
const geminiService = new GeminiService();

// Register plugins
await fastify.register(import('@fastify/helmet'));
await fastify.register(import('@fastify/cors'), {
  origin: config.node_env === 'development' ? true : ['http://localhost:3000'],
  credentials: true
});
await fastify.register(import('@fastify/websocket'));
fastify.register(async function (fastify) {
  setupSimpleVoiceWebSocket(fastify);
});


// Connect to database
await dbManager.connect();

// Decorate fastify instance with services
fastify.decorate('userRepository', new UserRepository());
fastify.decorate('todoRepository', new TodoRepository());
fastify.decorate('geminiService', geminiService);
fastify.decorate('elevenLabsService', elevenLabsService);
fastify.decorate('notionService', notionService);
fastify.decorate('pineconeService', pineconeService);

// Declare types for decorators
declare module 'fastify' {
  interface FastifyInstance {
    userRepository: UserRepository;
    todoRepository: TodoRepository;
    geminiService: GeminiService;
    elevenLabsService: ElevenLabsService;
    notionService: NotionService;
    pineconeService: PineconeService;
  }
}

// Enhanced Health Check with Gemini Status
fastify.get('/health', async () => {
  const dbHealth: DatabaseHealth = await dbManager.healthCheck();
  const wsHealth = await enhancedWsManager.performSystemHealthCheck();
  const geminiHealth = await geminiService.healthCheck();

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    environment: config.node_env,
    database: dbHealth,
    services: {
      mongodb: dbHealth.status === 'connected' ? '✅' : '❌',
      gemini: geminiHealth.status === 'healthy' ? '🤖✅' :
        geminiHealth.status === 'degraded' ? '🤖⚠️' : '🤖❌',
      websockets: wsHealth.services.websockets === 'healthy' ? '🎤✅' : '🎤❌',
      active_connections: enhancedWsManager.getActiveConnections(),
      ai_model: geminiHealth.model
    },
    features: {
      voice_processing: 'enabled',
      real_time_transcription: 'enabled',
      multi_language: 'enabled',
      intent_detection: 'enabled',
      ai_enhancement: 'enabled',
      semantic_search: 'ready'
    },
    stats: enhancedWsManager.getStats()
  };
});




await fastify.register(notionRoutes, { prefix: '/api/v1' });

await fastify.register(voiceRoutes, { prefix: 'api/v1' })



// Error handler
fastify.setErrorHandler((error, request, reply) => {
  logger.error('Request error:', error);

  reply.status(error.statusCode || 500).send({
    error: {
      message: error.message,
      statusCode: error.statusCode || 500,
      timestamp: new Date().toISOString(),
      ai_provider: 'Google Gemini'
    }
  });
});

// Enhanced graceful shutdown
const gracefulShutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    enhancedWsManager.shutdown();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await fastify.close();
    await dbManager.disconnect();

    logger.info('✅ Enhanced server shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const start = async (): Promise<void> => {
  try {
    const address = await fastify.listen({
      port: config.port,
      host: '127.0.0.1'
    });

    logger.info(`🚀 Enhanced Voice Todo App with AI is running!`);
    logger.info(`🤖 AI Provider: Google Gemini`);
    logger.info(`📡 Server listening on ${address}`);
    logger.info(`🌍 Environment: ${config.node_env}`);
    logger.info(`🎤 Enhanced WebSocket: ws://localhost:${config.port}/ws/voice`);
    logger.info(`💊 Health check: http://localhost:${config.port}/health`);
    logger.info(`🧠 AI Status: http://localhost:${config.port}/api/v1/ai/status`);
    logger.info(`🔍 Search: http://localhost:${config.port}/api/v1/search`);
    logger.info(`🏠 Home: http://localhost:${config.port}/`);

  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
};



start().catch(console.error);