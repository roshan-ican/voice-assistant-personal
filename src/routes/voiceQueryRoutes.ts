import { VoiceQueryController } from '@/handler/voiceQueryController';
import { FastifyInstance } from 'fastify';


async function voiceQueryRoutes(fastify: FastifyInstance) {
    const voiceQueryController = new VoiceQueryController(
        fastify.geminiService,
        fastify.notionService
    );

    // Process voice command
    fastify.post('/voice/command', {
        
    }, voiceQueryController.processVoiceCommand.bind(voiceQueryController));
}

export default voiceQueryRoutes;