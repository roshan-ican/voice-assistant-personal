import { FastifyRequest, FastifyReply } from 'fastify';
import { GeminiService } from '../services/geminiService.js';
import { NotionService } from '../services/notionService.js';
import { ElevenLabsService } from '@/services/elevenLabs.js';


interface VoiceQueryRequest {
    text?: string;
    audioBuffer?: string; // base64
    language?: string;
    userId?: string;
    currentPageId?: string;
    returnAudio?: boolean;
    voiceId?: string; // 11 Labs voice ID
    modelId?: string; // 11 Labs model ID
}

interface VoiceIntent {
    action: 'create' | 'complete' | 'update' | 'delete' | 'list' | 'unclear';
    todoText?: string;
    targetTodo?: string;
    newText?: string;
    pageHint?: string;
    confidence: number;
}

export class VoiceQueryController {
    private elevenLabsService: ElevenLabsService;

    constructor(
        private geminiService: GeminiService,
        private notionService: NotionService,
        elevenLabsApiKey: string
    ) {
        this.elevenLabsService = new ElevenLabsService(elevenLabsApiKey);
    }

    private isValidNotionId(id: string | undefined | null): boolean {
        return !!id && /^[0-9a-f]{32}$/i.test(id.replace(/-/g, ''));
    }

    async processVoiceCommand(
        request: FastifyRequest<{ Body: VoiceQueryRequest }>,
        reply: FastifyReply
    ) {
        try {
            const {
                text,
                audioBuffer,
                language = 'en',
                currentPageId,
                returnAudio = false,
                voiceId,
                modelId
            } = request.body;

            // 1. Get text from audio if needed using 11 Labs STT
            let commandText = text;
            if (!commandText && audioBuffer) {
                const audio = Buffer.from(audioBuffer, 'base64');

                const transcription = await this.elevenLabsService.transcribeAudio(
                    audio,
                    { language }
                );

                commandText = transcription.text;
                request.log.info(`11 Labs transcription: ${commandText}`);
            }

            if (!commandText) {
                return reply.code(400).send({
                    success: false,
                    error: 'No command provided'
                });
            }

            // 2. Parse intent using Gemini
            const intent = await this.geminiService.parseVoiceCommand(commandText, { currentPageId });

            let targetPageId: string | undefined;

            // For `create` intent, allow fallback logic — don't block on invalid page ID
            if (intent.action === 'create') {
                targetPageId = this.isValidNotionId(currentPageId) ? currentPageId : undefined;
            } else {
                // For other actions (like 'list', 'complete', etc), page ID is required
                if (!this.isValidNotionId(currentPageId)) {
                    const message = 'Invalid or missing todo list. Please create one first.';
                    const response: any = {
                        success: false,
                        needsSetup: true,
                        message,
                        intent,
                        transcribedText: commandText
                    };

                    if (returnAudio) {
                        response.audioResponse = await this.generateAudioResponse(message, {
                            ...(voiceId ? { voiceId } : {}),
                            ...(modelId ? { modelId } : {})
                        });
                    }

                    return response;
                }

                targetPageId = currentPageId;
            }

            // 4. Execute the intent
            let result;
            switch (intent.action) {
                case 'create':
                    result = await this.handleCreate(intent, targetPageId!);
                    break;
                case 'complete':
                    result = await this.handleComplete(intent, targetPageId!);
                    break;
                case 'update':
                    result = await this.handleUpdate(intent, targetPageId!);
                    break;
                case 'delete':
                    result = await this.handleDelete(intent, targetPageId!);
                    break;
                case 'list':
                    result = await this.handleList(targetPageId!);
                    break;
                default:
                    result = {
                        success: false,
                        message: "I didn't understand that command. Try saying 'add', 'complete', or 'show todos'."
                    };
            }

            const response: any = {
                success: true,
                transcribedText: commandText,
                intent,
                result,
                pageId: targetPageId
            };

            // 5. Generate audio response if requested
            if (returnAudio && result.message) {
                response.audioResponse = await this.generateAudioResponse(
                    result.message,
                    {
                        ...(voiceId ? { voiceId } : {}),
                        ...(modelId ? { modelId } : {})
                    }
                );
            }

            return response;

        } catch (error) {
            request.log.error('Voice command error:', error);
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to process command'
            });
        }
    }

    private async generateAudioResponse(
        text: string,
        options: { voiceId?: string; modelId?: string } = {}
    ): Promise<string> {
        try {
            const ttsOptions: any = {
                ...(options.voiceId ? { voiceId: options.voiceId } : {}),
                ...(options.modelId ? { modelId: options.modelId } : {}),
                stability: 0.5,
                similarityBoost: 0.75,
                style: 0.0,
                useSpeakerBoost: true
            };
            const { audioBuffer } = await this.elevenLabsService.synthesizeSpeech(text, ttsOptions);

            // Return as base64 for easy frontend consumption
            return audioBuffer.toString('base64');
        } catch (error) {
            console.error('Failed to generate audio response:', error);
            // Return empty string if TTS fails (graceful degradation)
            return '';
        }
    }

    // Get available voices from 11 Labs
    async getAvailableVoices(request: FastifyRequest, reply: FastifyReply) {
        try {
            const voices = await this.elevenLabsService.getVoices();
            return {
                success: true,
                voices: voices.map(v => ({
                    id: v.voice_id,
                    name: v.name,
                    category: v.category,
                    labels: v.labels
                }))
            };
        } catch (error) {
            return reply.code(500).send({
                success: false,
                error: 'Failed to fetch available voices'
            });
        }
    }

    // Get usage/quota information
    async getUsageInfo(request: FastifyRequest, reply: FastifyReply) {
        try {
            const usage = await this.elevenLabsService.getUsageInfo();
            return {
                success: true,
                usage
            };
        } catch (error) {
            return reply.code(500).send({
                success: false,
                error: 'Failed to fetch usage info'
            });
        }
    }

    // Test TTS endpoint
    async testTTS(request: FastifyRequest<{ Body: { text: string; voiceId?: string; modelId?: string } }>, reply: FastifyReply) {
        try {
            const { text, voiceId, modelId } = request.body;
            const ttsOptions: any = {
                ...(voiceId ? { voiceId } : {}),
                ...(modelId ? { modelId } : {})
            };
            const { audioBuffer } = await this.elevenLabsService.synthesizeSpeech(text, ttsOptions);

            return {
                success: true,
                audio: audioBuffer.toString('base64')
            };
        } catch (error) {
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'TTS failed'
            });
        }
    }

    // Stream TTS endpoint for lower latency
    async streamTTS(request: FastifyRequest<{ Body: { text: string; voiceId?: string; modelId?: string } }>, reply: FastifyReply) {
        try {
            const { text, voiceId, modelId } = request.body;
            const ttsOptions: any = {
                ...(voiceId ? { voiceId } : {}),
                ...(modelId ? { modelId } : {})
            };
            const stream = await this.elevenLabsService.synthesizeSpeechStream(text, ttsOptions);

            reply.type('audio/mpeg');
            return reply.send(stream);
        } catch (error) {
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'TTS stream failed'
            });
        }
    }

    // ... rest of the handler methods remain the same ...
    private async handleCreate(intent: VoiceIntent, pageId: string | null) {
        console.log(intent, "_intent");

        if (!intent.todoText) {
            return { success: false, message: "I didn't catch what you want to add." };
        }

        // NEW: move the validity check up front
        const hasValidPageId = this.isValidNotionId(pageId);

        try {
            if (!hasValidPageId) {
                // Create new Notion page (fallback)
                const FALLBACK_PAGE_ID = '23f0030a44018099b5d8e1239eadee83';

                const newPage = await (this.notionService as any).notion.pages.create({
                    parent: { page_id: FALLBACK_PAGE_ID },
                    properties: {
                        title: [
                            {
                                text: { content: `Todo List - ${new Date().toLocaleDateString()}` },
                            },
                        ],
                    },
                    children: [{
                        object: 'block',
                        type: 'to_do',
                        to_do: {
                            rich_text: [{
                                type: 'text',
                                text: { content: intent.todoText }
                            }],
                            checked: false
                        }
                    }]
                });

                return {
                    success: true,
                    message: `Created new list and added "${intent.todoText}"`,
                    todoId: newPage.id,
                    pageId: newPage.id
                };
            }

            // If we have a valid page ID, append to it
            const response = await (this.notionService as any).notion.blocks.children.append({
                block_id: pageId,
                children: [{
                    object: 'block',
                    type: 'to_do',
                    to_do: {
                        rich_text: [{
                            type: 'text',
                            text: { content: intent.todoText }
                        }],
                        checked: false
                    }
                }]
            });

            return {
                success: true,
                message: `Added "${intent.todoText}" to your list`,
                todoId: response.results[0].id
            };
        } catch (error) {
            console.error('Error in handleCreate:', error);
            return { success: false, message: 'Failed to add todo' };
        }
    }

    private async handleComplete(intent: VoiceIntent, pageId: string) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which todo do you want to complete?" };
        }

        try {
            const blocks = await (this.notionService as any).notion.blocks.children.list({
                block_id: pageId
            });

            const todos = blocks.results.filter((b: any) => b.type === 'to_do');
            const targetTodo = this.findTodo(todos, intent.targetTodo);

            if (!targetTodo) {
                return { success: false, message: `Couldn't find "${intent.targetTodo}"` };
            }

            await (this.notionService as any).notion.blocks.update({
                block_id: targetTodo.id,
                to_do: { checked: true }
            });

            return {
                success: true,
                message: `Completed "${targetTodo.to_do.rich_text[0]?.plain_text}"`,
                todoId: targetTodo.id
            };
        } catch (error) {
            return { success: false, message: 'Failed to complete todo' };
        }
    }

    private async handleUpdate(intent: VoiceIntent, pageId: string) {
        if (!intent.targetTodo || !intent.newText) {
            return { success: false, message: "What do you want to update?" };
        }

        try {
            const blocks = await (this.notionService as any).notion.blocks.children.list({
                block_id: pageId
            });

            const todos = blocks.results.filter((b: any) => b.type === 'to_do');
            const targetTodo = this.findTodo(todos, intent.targetTodo);

            if (!targetTodo) {
                return { success: false, message: `Couldn't find "${intent.targetTodo}"` };
            }

            await (this.notionService as any).notion.blocks.update({
                block_id: targetTodo.id,
                to_do: {
                    rich_text: [{
                        type: 'text',
                        text: { content: intent.newText }
                    }]
                }
            });

            return {
                success: true,
                message: `Updated to "${intent.newText}"`,
                todoId: targetTodo.id
            };
        } catch (error) {
            return { success: false, message: 'Failed to update todo' };
        }
    }

    private async handleDelete(intent: VoiceIntent, pageId: string) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which todo do you want to delete?" };
        }

        try {
            const blocks = await (this.notionService as any).notion.blocks.children.list({
                block_id: pageId
            });

            const todos = blocks.results.filter((b: any) => b.type === 'to_do');
            const targetTodo = this.findTodo(todos, intent.targetTodo);

            if (!targetTodo) {
                return { success: false, message: `Couldn't find "${intent.targetTodo}"` };
            }

            await (this.notionService as any).notion.blocks.delete({
                block_id: targetTodo.id
            });

            return {
                success: true,
                message: `Deleted "${targetTodo.to_do.rich_text[0]?.plain_text}"`,
                todoId: targetTodo.id
            };
        } catch (error) {
            return { success: false, message: 'Failed to delete todo' };
        }
    }

    private async handleList(pageId: string) {
        try {
            const blocks = await (this.notionService as any).notion.blocks.children.list({
                block_id: pageId
            });

            const todos = blocks.results
                .filter((b: any) => b.type === 'to_do')
                .map((t: any) => ({
                    id: t.id,
                    text: t.to_do.rich_text[0]?.plain_text || '',
                    checked: t.to_do.checked
                }));

            const incomplete = todos.filter((t: any) => !t.checked);
            const completed = todos.filter((t: any) => t.checked);

            return {
                success: true,
                message: `You have ${incomplete.length} todos to do`,
                todos,
                stats: {
                    total: todos.length,
                    completed: completed.length,
                    incomplete: incomplete.length
                }
            };
        } catch (error) {
            return { success: false, message: 'Failed to get todos' };
        }
    }

    private findTodo(todos: any[], identifier: string): any {
        const lower = identifier.toLowerCase();

        // Position based
        if (lower === 'first' && todos.length > 0) return todos[0];
        if (lower === 'last' && todos.length > 0) return todos[todos.length - 1];

        // Number position
        const num = parseInt(identifier);
        if (!isNaN(num) && num > 0 && num <= todos.length) {
            return todos[num - 1];
        }

        // Text match
        return todos.find(t => {
            const text = t.to_do.rich_text[0]?.plain_text || '';
            return text.toLowerCase().includes(lower);
        });
    }
}
