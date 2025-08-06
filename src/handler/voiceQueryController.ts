// controllers/voiceQueryController.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { GeminiService } from '../services/geminiService.js';
import { NotionService } from '../services/notionService.js';
import { CLOSING } from 'ws';

interface VoiceQueryRequest {
    text: string;
    audioBuffer?: string; // base64
    language?: string;
    userId?: string;
    currentPageId?: string; // If user is on a specific page
}

interface VoiceIntent {
    action: 'create' | 'complete' | 'update' | 'delete' | 'list' | 'unclear';
    todoText?: string;
    targetTodo?: string; // What todo to act on
    newText?: string; // For updates
    pageHint?: string; // Which page/list
    confidence: number;
}

export class VoiceQueryController {
    constructor(
        private geminiService: GeminiService,
        private notionService: NotionService
    ) { }

    async processVoiceCommand(
        request: FastifyRequest<{ Body: VoiceQueryRequest }>,
        reply: FastifyReply
    ) {
        try {
            const { text, audioBuffer, language = 'en', currentPageId } = request.body;

            // 1. Get text from audio if needed
            let commandText = text;
            if (!commandText && audioBuffer) {
                const audio = Buffer.from(audioBuffer, 'base64');
                const transcription = await this.geminiService.transcribeAudio(audio, {
                    language: language as any,
                    mimeType: 'audio/webm'
                });
                console.log(transcription, "__ddd")
                commandText = transcription.text;
            }

            if (!commandText) {
                return reply.code(400).send({
                    success: false,
                    error: 'No command provided'
                });
            }

            request.log.info(`Processing voice command: ${commandText}`);

            // 2. Parse intent
            const intent = await this.geminiService.parseVoiceCommand(commandText, { currentPageId });
            console.log(intent, "_action")

            // 3. Get recent pages or use currentPageId
            let targetPageId = currentPageId;

            // If no currentPageId provided and action needs one, get recent pages
            if (!targetPageId && intent.action !== 'create') {
                const recentPages = await this.notionService.getRecentPages(5);
                targetPageId = recentPages[0]?.id;

                if (!targetPageId) {
                    return {
                        success: false,
                        needsSetup: true,
                        message: 'No todo list found. Please create one first.',
                        intent,
                        transcribedText: commandText
                    };
                }
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

            return {
                success: true,
                transcribedText: commandText,
                intent,
                result,
                pageId: targetPageId
            };

        } catch (error) {
            request.log.error('Voice command error:', error);
            return reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to process command'
            });
        }
    }


    private async getUserPages(userId?: string) {
        // For now, return all recent pages
        // In production, filter by userId
        try {
            const pages = await this.notionService.getRecentPages(5);
            return pages;
        } catch (error) {
            return [];
        }
    }

    private async handleCreate(intent: VoiceIntent, pageId: string | null) {
        console.log(intent, "_intent")
        if (!intent.todoText) {
            return { success: false, message: "I didn't catch what you want to add." };
        }

        try {
            if (!pageId) {
                // Create a new page using the same approach as createTodoPage
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

            // Add todo to existing page
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
            // Get todos from page
            const blocks = await (this.notionService as any).notion.blocks.children.list({
                block_id: pageId
            });

            const todos = blocks.results.filter((b: any) => b.type === 'to_do');
            const targetTodo = this.findTodo(todos, intent.targetTodo);

            if (!targetTodo) {
                return { success: false, message: `Couldn't find "${intent.targetTodo}"` };
            }

            // Update todo
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