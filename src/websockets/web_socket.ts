// backend/plugins/websocket.ts
import { FastifyInstance } from 'fastify';
import { VoiceQueryController } from '@/handler/voiceQueryController';


async function registerWebsocket(fastify: FastifyInstance) {  // ← Renamed function
    // Register the WebSocket plugin


    const controller = new VoiceQueryController(
        fastify.geminiService,
        fastify.notionService,
        process.env.ELEVENLABS_API_KEY!
    );

    // WebSocket route for voice communication
    fastify.get('/ws/voice', { websocket: true }, (connection, req) => {
        const { socket } = connection;
        let audioChunks: string[] = [];

        console.log('Client connected via WebSocket');

        // Send initial connection confirmation
        socket.send(JSON.stringify({
            type: 'connected',
            message: 'WebSocket connection established'
        }));

        socket.on('message', async (message: any) => {
            try {
                const data = JSON.parse(message.toString());
                console.log('Received message type:', data.type);

                switch (data.type) {
                    case 'voice_command':
                        const mockRequest: any = {
                            body: data.payload,
                            log: fastify.log
                        };

                        const mockReply: any = {
                            code: (status: number | string) => mockReply,
                            send: (response: any) => {
                                if (response.error) {
                                    socket.send(JSON.stringify({
                                        type: 'error',
                                        message: response.error
                                    }));
                                }
                                return mockReply;
                            }
                        };

                        const response = await controller.processVoiceCommand(mockRequest, mockReply);

                        if (response) {
                            if (response.transcribedText) {
                                socket.send(JSON.stringify({
                                    type: 'transcription',
                                    text: response.transcribedText
                                }));
                            }

                            if (response.intent) {
                                socket.send(JSON.stringify({
                                    type: 'intent',
                                    intent: response.intent
                                }));
                            }

                            socket.send(JSON.stringify({
                                type: 'result',
                                success: response.success,
                                result: response.result,
                                pageId: response.pageId,
                                needsSetup: response.needsSetup
                            }));

                            if (response.audioResponse) {
                                socket.send(JSON.stringify({
                                    type: 'audio',
                                    audio: response.audioResponse
                                }));
                            }
                        }
                        break;

                    case 'ping':
                        socket.send(JSON.stringify({ type: 'pong' }));
                        break;

                    default:
                        socket.send(JSON.stringify({
                            type: 'error',
                            message: `Unknown message type: ${data.type}`
                        }));
                }
            } catch (error: any) {
                console.error('WebSocket error:', error);
                socket.send(JSON.stringify({
                    type: 'error',
                    message: error.message || 'An error occurred'
                }));
            }
        });

        socket.on('close', () => {
            console.log('Client disconnected');
        });
    });
}

export default registerWebsocket;  // ← Export with new name