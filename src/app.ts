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

// Initialize Gemini service
const geminiService = new GeminiService();

await fastify.register(import('@fastify/helmet'));
await fastify.register(import('@fastify/cors'), {
  origin: config.node_env === 'development' ? true : ['http://localhost:3000'],
  credentials: true
});
await fastify.register(import('@fastify/websocket'));

await dbManager.connect();

fastify.decorate('userRepository', new UserRepository());
fastify.decorate('todoRepository', new TodoRepository());
fastify.decorate('geminiService', geminiService);

// Declare types for decorators
declare module 'fastify' {
  interface FastifyInstance {
    userRepository: UserRepository;
    todoRepository: TodoRepository;
    geminiService: GeminiService;
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

// Enhanced API Status
fastify.get('/api/v1/status', async () => {
  const wsStats = await enhancedWsManager.getDetailedStats();

  return {
    message: '🎤 Voice Todo API is running with AI!',
    version: '2.0.0',
    ai_provider: 'Google Gemini',
    features: {
      voice_processing: 'enabled',
      real_time_transcription: 'enabled',
      multi_language: 'enabled',
      intent_detection: 'enabled',
      voice_enhancement: 'enabled',
      notion_integration: 'ready',
      semantic_search: 'ready'
    },
    uptime: process.uptime(),
    connections: {
      active: wsStats.connections,
      total_ever: wsStats.totalEver,
      health: wsStats.healthStatus
    },
    supported_languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'hi', 'ja', 'ko', 'zh', 'ar']
  };
});

// AI Service Status Endpoint
fastify.get('/api/v1/ai/status', async () => {
  try {
    const geminiHealth = await geminiService.healthCheck();

    return {
      provider: 'Google Gemini',
      model: geminiHealth.model,
      status: geminiHealth.status,
      capabilities: [
        'speech_to_text',
        'text_enhancement',
        'intent_detection',
        'language_detection',
        'embedding_generation'
      ],
      error: geminiHealth.error || null,
      last_check: new Date().toISOString()
    };
  } catch (error) {
    return {
      provider: 'Google Gemini',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      last_check: new Date().toISOString()
    };
  }
});

// Test AI Transcription Endpoint
// Enhanced test endpoint in src/app.ts
fastify.post('/api/v1/ai/test-transcription', async (request, reply) => {
  try {
    // Get text from request body or use default
    const { text, language } = (request.body as any) || {};
    const testText = text || "Add buy groceries to my todo list for tomorrow";
    const testLanguage = language || 'en';

    // Test enhancement
    const enhanced = await geminiService.enhanceTranscription(testText, testLanguage);

    // Test language detection
    const detectedLang = await geminiService.detectLanguage(testText);

    return {
      success: true,
      original_text: testText,
      enhanced_result: enhanced,
      detected_language: detectedLang,
      processing_time: Date.now(),
      ai_provider: 'Google Gemini'
    };

  } catch (error) {
    reply.status(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI test failed',
      ai_provider: 'Google Gemini'
    };
  }
});

// Enhanced Home Page
fastify.get('/', async () => {
  const wsStats = enhancedWsManager.getStats();

  return {
    message: '🎤 Voice Todo App with AI is running!',
    version: '2.0.0',
    ai_powered: true,
    provider: 'Google Gemini',
    endpoints: {
      health: '/health',
      api_status: '/api/v1/status',
      ai_status: '/api/v1/ai/status',
      test_ai: '/api/v1/ai/test-transcription',
      websocket: 'ws://localhost:3000/ws/voice'
    },
    features: [
      '🎤 Real-time voice transcription',
      '🤖 AI-powered intent detection',
      '🌍 Multi-language support',
      '✨ Voice enhancement',
      '📝 Smart todo creation',
      '🔍 Semantic search (ready)'
    ],
    stats: {
      active_connections: wsStats.activeConnections,
      total_connections: wsStats.totalConnections,
      ai_transcriptions: wsStats.totalTranscriptions
    }
  };
});

// Enhanced WebSocket with Real Gemini AI
fastify.register(async function (fastify) {
  fastify.get('/ws/voice', { websocket: true }, (connection, req) => {
    // Extract user info from request
    const userInfo = {
      userAgent: req.headers['user-agent'] || 'Unknown',
      userId: req.headers['x-user-id'] as string || undefined,
      ip: req.ip
    } as any

    // Use enhanced WebSocket manager with Gemini integration
    const connectionId = enhancedWsManager.handleConnection(connection.socket, userInfo);

    logger.info(`🎤 Enhanced Voice WebSocket with AI established`, {
      connectionId,
      userAgent: userInfo.userAgent,
      activeConnections: enhancedWsManager.getActiveConnections()
    });
  });
});

// WebSocket Stats Endpoint
fastify.get('/api/v1/websocket/stats', async () => {
  const detailedStats = await enhancedWsManager.getDetailedStats();
  return {
    success: true,
    timestamp: new Date().toISOString(),
    ...detailedStats
  };
});

// System Update Broadcast Endpoint (for admin use)
fastify.post('/api/v1/admin/broadcast', async (request, reply) => {
  try {
    const { type, message, severity } = request.body as any;

    await enhancedWsManager.broadcastSystemUpdate({
      type: type || 'system_alert',
      message: message || 'System update',
      severity: severity || 'info'
    });

    return {
      success: true,
      message: 'Broadcast sent to all connected clients',
      connections: enhancedWsManager.getActiveConnections()
    };
  } catch (error) {
    reply.status(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Broadcast failed'
    };
  }
});

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
    // Shutdown WebSocket manager first (sends shutdown notices to clients)
    enhancedWsManager.shutdown();

    // Wait a bit for clients to disconnect gracefully
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
      host: config.host
    });

    logger.info(`🚀 Enhanced Voice Todo App with AI is running!`);
    logger.info(`🤖 AI Provider: Google Gemini`);
    logger.info(`📡 Server listening on ${address}`);
    logger.info(`🌍 Environment: ${config.node_env}`);
    logger.info(`🎤 Enhanced WebSocket: ws://localhost:${config.port}/ws/voice`);
    logger.info(`💊 Health check: http://localhost:${config.port}/health`);
    logger.info(`🧠 AI Status: http://localhost:${config.port}/api/v1/ai/status`);
    logger.info(`🏠 Home: http://localhost:${config.port}/`);

  } catch (error) {
    logger.error('Error starting server:', error);
    process.exit(1);
  }
};

start().catch(console.error);