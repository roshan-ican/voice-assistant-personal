import { VoiceQueryController } from '@/handler/voiceQueryController';
import { FastifyInstance } from 'fastify';
// import { VoiceQueryController } from '../controllers/voiceQueryController.js';

async function voiceRoutes(fastify: FastifyInstance) {
    const controller = new VoiceQueryController(
        fastify.geminiService,
        fastify.notionService,
        process.env.ELEVENLABS_API_KEY!
    );

    fastify.get('/test', (request, reply) => {
        reply.send({ message: 'Hello World' });
    });

    // Process voice command
    fastify.post('/command', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                    audioBuffer: { type: 'string' },
                    language: { type: 'string' },
                    currentPageId: { type: 'string' },
                    returnAudio: { type: 'boolean' },
                    voiceId: { type: 'string' },
                    modelId: { type: 'string' }
                }
            }
        }
    }, (request: any, reply) => controller.processVoiceCommand(request, reply));

    // Get available voices
    fastify.get('/voices', (request, reply) =>
        controller.getAvailableVoices(request, reply)
    );

    // Get usage info (check quota)
    fastify.get('/usage', (request, reply) =>
        controller.getUsageInfo(request, reply)
    );

    // Test TTS endpoint
    fastify.post('/tts', {
        schema: {
            body: {
                type: 'object',
                required: ['text'],
                properties: {
                    text: { type: 'string' },
                    voiceId: { type: 'string' },
                    modelId: { type: 'string' }
                }
            }
        }
    }, (request: any, reply) => controller.testTTS(request, reply));

    // Stream TTS endpoint for lower latency
    fastify.post('/tts/stream', {
        schema: {
            body: {
                type: 'object',
                required: ['text'],
                properties: {
                    text: { type: 'string' },
                    voiceId: { type: 'string' },
                    modelId: { type: 'string' }
                }
            }
        }
    }, (request: any, reply) => controller.streamTTS(request, reply));
}
export default voiceRoutes;