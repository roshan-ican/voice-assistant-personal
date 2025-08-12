// Updated VoiceQueryController.ts with auto-create GTD database
import { FastifyRequest, FastifyReply } from 'fastify';
import { GeminiService } from '../services/geminiService.js';
import { NotionService } from '../services/notionService.js';
import { ElevenLabsService } from '@/services/elevenLabs.js';
import { config } from '@/utils/config.js';


interface VoiceQueryRequest {
    text?: string;
    audioBuffer?: string;
    language?: string;
    currentPageId?: string;
    returnAudio?: boolean;
    voiceId?: string;
    modelId?: string;
}

interface VoiceIntent {
    action: 'create' | 'complete' | 'update' | 'delete' | 'list' | 'unclear';
    todoText?: string;
    targetTodo?: string;
    newText?: string;
    confidence: number;
}

export class VoiceQueryController {

    private elevenLabsService: ElevenLabsService;
    private gtdDatabaseId: string | null = null;
    private FALLBACK_PAGE_ID = config.notion_db.uri; // Your fallback page

    constructor(
        private geminiService: GeminiService,
        private notionService: NotionService,
        elevenLabsApiKey: string
    ) {
        this.elevenLabsService = new ElevenLabsService(elevenLabsApiKey);
        console.log(config.notion_db.uri, "db______")
    }


    // Create or get GTD database
    // Create or get GTD database - Simplified schema
    private async ensureGTDDatabase(): Promise<string> {
        if (this.gtdDatabaseId) {
            return this.gtdDatabaseId;
        }

        try {
            // First, try to find existing GTD database
            const searchResponse = await (this.notionService as any).notion.search({
                query: 'Daily Tasks',
                filter: {
                    value: 'database',
                    property: 'object'
                }
            });

            if (searchResponse.results.length > 0) {
                this.gtdDatabaseId = searchResponse.results[0].id as string
                return this.gtdDatabaseId;
            }

            // Create a new simplified GTD database
            console.log('Creating new Daily Tasks database...');
            const newDatabase = await (this.notionService as any).notion.databases.create({
                parent: {
                    type: 'page_id',
                    page_id: this.FALLBACK_PAGE_ID
                },
                title: [
                    {
                        type: 'text',
                        text: {
                            content: 'Daily Tasks'
                        }
                    }
                ],
                properties: {
                    'Task': {  // Main task name
                        title: {}
                    },
                    'Status': {  // Simple status
                        select: {
                            options: [
                                { name: 'Todo', color: 'yellow' },
                                { name: 'Done', color: 'green' }
                            ]
                        }
                    },
                    'Priority': {  // Priority level
                        select: {
                            options: [
                                { name: 'High', color: 'red' },
                                { name: 'Medium', color: 'yellow' },
                                { name: 'Low', color: 'green' }
                            ]
                        }
                    },
                    'Category': {  // Simple categories
                        select: {
                            options: [
                                { name: 'Work', color: 'blue' },
                                { name: 'Personal', color: 'green' },
                                { name: 'Shopping', color: 'yellow' },
                                { name: 'Email', color: 'purple' },
                                { name: 'Other', color: 'gray' }
                            ]
                        }
                    },
                    'Date': {  // Date created/for
                        date: {}
                    }
                }
            });

            this.gtdDatabaseId = newDatabase.id as string
            console.log('Daily Tasks database created successfully:', this.gtdDatabaseId)
            return this.gtdDatabaseId;

        } catch (error) {
            console.error('Error creating/finding database:', error);
            throw new Error('Failed to setup database');
        }
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
                returnAudio = false,
                voiceId,
                modelId
            } = request.body;

            // 1. Get text from audio if needed
            let commandText = text;
            if (!commandText && audioBuffer) {
                const audio = Buffer.from(audioBuffer, 'base64');
                const transcription = await this.elevenLabsService.transcribeAudio(
                    audio,
                    { language }
                );
                commandText = transcription.text;
                request.log.info(`Transcription: ${commandText}`);
            }

            if (!commandText) {
                return reply.code(400).send({
                    success: false,
                    error: 'No command provided'
                });
            }

            // 2. Detect intent from text first (before using Gemini)


            // 3. Use Gemini for more complex parsing if needed
            let intent = await this.geminiService.parseVoiceCommand(commandText, {});

            console.log('Detected intent:', intent);

            // 4. Ensure database exists
            const databaseId = await this.ensureGTDDatabase();

            // 5. Execute the intent
            let result;
            switch (intent.action) {
                case 'create':
                    result = await this.handleCreateGTD(intent, commandText);
                    break;
                case 'complete':
                    result = await this.handleCompleteGTD(intent);
                    break;
                case 'update':
                    result = await this.handleUpdateGTD(intent);
                    break;
                case 'delete':
                    result = await this.handleDeleteGTD(intent);
                    break;
                case 'list':
                    result = await this.handleListGTD();
                    break;
                default:
                    result = {
                        success: false,
                        message: "I didn't understand. Try: 'buy milk', 'bought milk', or 'show tasks'."
                    };
            }

            const response: any = {
                success: true,
                transcribedText: commandText,
                intent,
                result,
                databaseId
            };

            // 6. Generate audio response if requested
            // if (returnAudio && result.message) {
            //     response.audioResponse = await this.generateAudioResponse(
            //         result.message,
            //         { voiceId, modelId }
            //     );
            // }
            if (returnAudio) {
                response.audioResponse = await this.generateAudioResponse(result.message, {
                    ...(voiceId ? { voiceId } : {}),
                    ...(modelId ? { modelId } : {})
                });
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


    private async handleCreateGTD(intent: VoiceIntent, originalText: string) {
        if (!intent.todoText) {
            return { success: false, message: "I didn't catch what task you want to add." };
        }

        try {
            const databaseId = await this.ensureGTDDatabase();

            // Extract priority and category from text
            const priority = this.extractPriority(originalText);
            const category = this.extractCategory(originalText);


            const newTask = await (this.notionService as any).notion.pages.create({
                parent: {
                    database_id: databaseId
                },
                properties: {
                    'Task': {
                        title: [
                            {
                                text: {
                                    content: intent.todoText
                                }
                            }
                        ]
                    },
                    'Status': {
                        select: {
                            name: 'Todo'
                        }
                    },
                    'Priority': {
                        select: {
                            name: priority
                        }
                    },
                    'Category': {
                        select: {
                            name: category
                        }
                    },
                }
            });

            return {
                success: true,
                message: `✅ Added "${intent.todoText}" to your tasks`,
                taskId: newTask.id
            };
        } catch (error) {
            console.error('Error creating task:', error);
            return { success: false, message: 'Failed to add task' };
        }
    }

    private async handleCompleteGTD(intent: VoiceIntent) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which task do you want to complete?" };
        }

        try {
            const databaseId = await this.ensureGTDDatabase();

            // Find the task
            const response = await (this.notionService as any).notion.databases.query({
                database_id: databaseId,
                filter: {
                    and: [
                        {
                            property: 'Task',
                            title: {
                                contains: intent.targetTodo
                            }
                        },
                        {
                            property: 'Status',
                            select: {
                                does_not_equal: 'Done'
                            }
                        }
                    ]
                }
            });

            if (response.results.length === 0) {
                return { success: false, message: `Couldn't find task "${intent.targetTodo}"` };
            }

            const targetTask = response.results[0];

            // Mark as done
            await (this.notionService as any).notion.pages.update({
                page_id: targetTask.id,
                properties: {
                    'Status': {
                        select: {
                            name: 'Done'
                        }
                    }
                }
            });

            const taskName = targetTask.properties.Task?.title[0]?.plain_text || intent.targetTodo;
            return {
                success: true,
                message: `✅ Completed "${taskName}"`,
                taskId: targetTask.id
            };
        } catch (error) {
            console.error('Error completing task:', error);
            return { success: false, message: 'Failed to complete task' };
        }
    }

    private async handleUpdateGTD(intent: VoiceIntent) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which task do you want to update?" };
        }

        try {
            const databaseId = await this.ensureGTDDatabase();

            // Find the task
            const response = await (this.notionService as any).notion.databases.query({
                database_id: databaseId,
                filter: {
                    property: 'Task',
                    title: {
                        contains: intent.targetTodo
                    }
                }
            });

            if (response.results.length === 0) {
                return { success: false, message: `Couldn't find task "${intent.targetTodo}"` };
            }

            const targetTask = response.results[0];
            const updateProperties: any = {};

            if (intent.newText) {
                updateProperties['Task'] = {
                    title: [{
                        text: { content: intent.newText }
                    }]
                };
            }

            await (this.notionService as any).notion.pages.update({
                page_id: targetTask.id,
                properties: updateProperties
            });

            return {
                success: true,
                message: `✏️ Updated "${intent.targetTodo}"${intent.newText ? ` to "${intent.newText}"` : ''}`,
                taskId: targetTask.id
            };
        } catch (error) {
            console.error('Error updating task:', error);
            return { success: false, message: 'Failed to update task' };
        }
    }

    private async handleDeleteGTD(intent: VoiceIntent) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which task do you want to delete?" };
        }

        try {
            const databaseId = await this.ensureGTDDatabase();
            let tasksToDelete;

            // Check if the user wants to delete all tasks
            if (intent.targetTodo.toLowerCase() === "all") {
                const allTasksResponse = await (this.notionService as any).notion.databases.query({
                    database_id: databaseId,
                    // No filter means it will get all tasks
                });
                tasksToDelete = allTasksResponse.results;
            } else {
                // Find a specific task
                const response = await (this.notionService as any).notion.databases.query({
                    database_id: databaseId,
                    filter: {
                        property: 'Task',
                        title: {
                            contains: intent.targetTodo
                        }
                    }
                });
                tasksToDelete = response.results;
            }

            if (tasksToDelete.length === 0) {
                return { success: false, message: `Couldn't find task "${intent.targetTodo}"` };
            }

            // Loop through and delete all the found tasks
            const deletePromises = tasksToDelete.map((task: any) =>
                (this.notionService as any).notion.pages.update({
                    page_id: task.id,
                    archived: true
                })
            );

            await Promise.all(deletePromises);

            // Customize the success message based on what was deleted
            const message = intent.targetTodo.toLowerCase() === "all"
                ? `🗑️ Deleted all ${tasksToDelete.length} tasks`
                : `🗑️ Deleted "${tasksToDelete[0].properties.Task?.title[0]?.plain_text || intent.targetTodo}"`;

            return { success: true, message: message };

        } catch (error) {
            console.error('Error deleting task:', error);
            return { success: false, message: 'Failed to delete task' };
        }
    }
    private async handleListGTD() {
        try {
            const databaseId = await this.ensureGTDDatabase();
            const today = new Date().toISOString().split('T')[0];

            // Query today's tasks
            const response = await (this.notionService as any).notion.databases.query({
                database_id: databaseId,
                filter: {
                    property: 'Date',
                    date: {
                        equals: today
                    }
                },
                sorts: [
                    {
                        property: 'Status',
                        direction: 'descending' // Todo first, then Done
                    },
                    {
                        property: 'Priority',
                        direction: 'ascending' // High, Medium, Low
                    }
                ]
            });

            const tasks = response.results.map((page: any) => ({
                id: page.id,
                task: page.properties.Task?.title[0]?.plain_text || '',
                status: page.properties.Status?.select?.name || 'Todo',
                priority: page.properties.Priority?.select?.name || 'Medium',
                category: page.properties.Category?.select?.name || ''
            }));

            const todoTasks = tasks.filter((t: any) => t.status === 'Todo');
            const doneTasks = tasks.filter((t: any) => t.status === 'Done');

            if (tasks.length === 0) {
                return {
                    success: true,
                    message: "📋 No tasks for today yet. Start by adding some!",
                    tasks: [],
                    stats: { total: 0, todo: 0, done: 0 }
                };
            }

            let message = `📋 Today's tasks (${doneTasks.length}/${tasks.length} done):\n`;

            // List todo tasks
            if (todoTasks.length > 0) {
                message += '\n📝 To do:\n';
                todoTasks.forEach((task: any, index: number) => {
                    const priority = task.priority === 'High' ? '🔴' : task.priority === 'Low' ? '🟢' : '🟡';
                    message += `${index + 1}. ${task.task} ${priority}\n`;
                });
            }

            // List completed tasks
            if (doneTasks.length > 0) {
                message += '\n✅ Completed:\n';
                doneTasks.forEach((task: any) => {
                    message += `• ${task.task}\n`;
                });
            }

            return {
                success: true,
                message,
                tasks,
                stats: {
                    total: tasks.length,
                    todo: todoTasks.length,
                    done: doneTasks.length
                }
            };
        } catch (error) {
            console.error('Error listing tasks:', error);
            return { success: false, message: 'Failed to list tasks' };
        }
    }

    // Helper methods
    private extractPriority(text: string): string {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('urgent') || lowerText.includes('high priority') || lowerText.includes('important')) {
            return 'High';
        }
        if (lowerText.includes('low priority') || lowerText.includes('not urgent')) {
            return 'Low';
        }
        return 'Medium';
    }

    private extractCategory(text: string): string {
        const lowerText = text.toLowerCase();
        if (lowerText.includes('work') || lowerText.includes('office') || lowerText.includes('meeting')) {
            return 'Work';
        }
        if (lowerText.includes('personal') || lowerText.includes('home') || lowerText.includes('family')) {
            return 'Personal';
        }
        if (lowerText.includes('buy') || lowerText.includes('shop') || lowerText.includes('purchase')) {
            return 'Shopping';
        }
        if (lowerText.includes('health') || lowerText.includes('doctor') || lowerText.includes('gym')) {
            return 'Health';
        }
        if (lowerText.includes('learn') || lowerText.includes('study') || lowerText.includes('course')) {
            return 'Learning';
        }
        if (lowerText.includes('email') || lowerText.includes('reply') || lowerText.includes('send')) {
            return 'Email';
        }
        return 'Other';
    }

    private extractDueDate(text: string): string | undefined {
        const today = new Date();
        const lowerText = text.toLowerCase();

        if (lowerText.includes('today')) {
            return today.toISOString().split('T')[0];
        }
        if (lowerText.includes('tomorrow')) {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.toISOString().split('T')[0];
        }
        if (lowerText.includes('next week')) {
            const nextWeek = new Date(today);
            nextWeek.setDate(nextWeek.getDate() + 7);
            return nextWeek.toISOString().split('T')[0];
        }
        if (lowerText.includes('next month')) {
            const nextMonth = new Date(today);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            return nextMonth.toISOString().split('T')[0];
        }

        return undefined;
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
            return audioBuffer.toString('base64');
        } catch (error) {
            console.error('Failed to generate audio response:', error);
            return '';
        }
    }

    // ... keep your other methods (getAvailableVoices, getUsageInfo, testTTS, streamTTS) as they are ...
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
}

