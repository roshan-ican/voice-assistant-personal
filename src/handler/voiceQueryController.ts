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
                    'Task': {  // Main task name - FIXED: Using consistent naming
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
                    'Date': {  // Date created/for - FIXED: Added this property
                        date: {}
                    }
                }
            });

            this.gtdDatabaseId = newDatabase.id as string
            console.log('Daily Tasks database created successfully:', this.gtdDatabaseId)
            return this.gtdDatabaseId;

        } catch (error: any) {
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

            // 2. Enhanced intent detection
            let intent = this.detectIntentFromText(commandText);

            function omitUndefined<T extends Record<string, unknown>>(obj: T) {
                return Object.fromEntries(
                    Object.entries(obj).filter(([, v]) => v !== undefined)
                ) as { [K in keyof T]?: Exclude<T[K], undefined> };
            }

            // 3. If we didn't get a clear intent, use Gemini
            if (intent.action === "unclear") {
                const geminiIntent = await this.geminiService.parseVoiceCommand(commandText, {});
                intent = { ...intent, ...omitUndefined(geminiIntent) };
            }

            console.log('Final intent:', intent);

            // 4. Ensure database exists
            const databaseId = await this.ensureGTDDatabase();

            // 5. Execute the intent
            let result;
            switch (intent.action) {
                case 'create':
                    result = await this.handleCreateGTD(intent, commandText);
                    break;
                case 'complete':
                    result = await this.handleCompleteGTD(intent, commandText);
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
                        message: "I didn't understand. Try: 'add task', 'complete task', 'show tasks'."
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
            if (returnAudio && result.message) {
                response.audioResponse = await this.generateAudioResponse(
                    result.message,
                    {
                        ...(voiceId && { voiceId }),
                        ...(modelId && { modelId }),
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

    // FIXED: Update method with correct property names
    private async handleUpdateGTD(intent: VoiceIntent) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which task do you want to update?" };
        }

        try {
            // Find the task - FIXED: Using 'Task' instead of 'Name'
            const response = await (this.notionService as any).notion.databases.query({
                database_id: await this.ensureGTDDatabase(),
                filter: {
                    property: 'Task',  // FIXED: Changed from 'Name' to 'Task'
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

            // Update name if provided - FIXED: Using 'Task' property
            if (intent.newText) {
                updateProperties['Task'] = {  // FIXED: Changed from 'Name' to 'Task'
                    title: [{
                        text: { content: intent.newText }
                    }]
                };
            }

            // Update priority if mentioned
            // if (intent.priority) {
            //     updateProperties['Priority'] = {
            //         select: { name: intent.priority }
            //     };
            // }

            // // Update due date if mentioned
            // if (intent.dueDate) {
            //     updateProperties['Date'] = {  // FIXED: Using 'Date' instead of 'Due Date'
            //         date: { start: intent.dueDate }
            //     };
            // }

            await (this.notionService as any).notion.pages.update({
                page_id: targetTask.id,
                properties: updateProperties
            });

            return {
                success: true,
                message: `Updated "${intent.targetTodo}"${intent.newText ? ` to "${intent.newText}"` : ''}`,
                taskId: targetTask.id
            };
        } catch (error) {
            console.error('Error updating GTD task:', error);
            return { success: false, message: 'Failed to update task' };
        }
    }

    private detectIntentFromText(text: string): VoiceIntent {
        const lowerText = text.toLowerCase().trim();
        console.log('Detecting intent for:', lowerText);

        // COMPLETE patterns
        if (
            lowerText.includes('complete') ||
            lowerText.includes('finish') ||
            lowerText.includes('done') ||
            lowerText.includes('mark as done') ||
            lowerText.includes('check off') ||
            lowerText.includes('tick off')
        ) {
            let targetTodo: string | undefined = undefined;

            if (lowerText.includes('first')) {
                targetTodo = 'first';
            } else if (lowerText.includes('last')) {
                targetTodo = 'last';
            } else if (lowerText.includes('second')) {
                targetTodo = '2';
            } else if (lowerText.includes('third')) {
                targetTodo = '3';
            } else {
                const patterns = [
                    /complete\s+(.+)/i,
                    /finish\s+(.+)/i,
                    /done\s+with\s+(.+)/i,
                    /mark\s+(.+)\s+as\s+done/i,
                    /check\s+off\s+(.+)/i
                ];

                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match && match[1]) {
                        targetTodo = match[1].trim();
                        break;
                    }
                }
            }

            const result: VoiceIntent = {
                action: 'complete',
                confidence: 0.9
            };

            if (targetTodo) {
                result.targetTodo = targetTodo;
            }

            return result;
        }

        // DELETE patterns
        if (
            lowerText.includes('delete') ||
            lowerText.includes('remove') ||
            lowerText.includes('cancel') ||
            lowerText.includes('drop')
        ) {
            let targetTodo: string | undefined = undefined;

            if (lowerText.includes('first')) {
                targetTodo = 'first';
            } else if (lowerText.includes('last')) {
                targetTodo = 'last';
            } else {
                const patterns = [
                    /delete\s+(.+)/i,
                    /remove\s+(.+)/i,
                    /cancel\s+(.+)/i,
                    /drop\s+(.+)/i
                ];

                for (const pattern of patterns) {
                    const match = text.match(pattern);
                    if (match && match[1]) {
                        targetTodo = match[1].trim();
                        break;
                    }
                }
            }

            const result: VoiceIntent = {
                action: 'delete',
                confidence: 0.9
            };

            if (targetTodo) {
                result.targetTodo = targetTodo;
            }

            return result;
        }

        // UPDATE patterns
        if (
            lowerText.includes('update') ||
            lowerText.includes('change') ||
            lowerText.includes('modify') ||
            lowerText.includes('edit') ||
            lowerText.includes(' to ')
        ) {
            const patterns = [
                /update\s+(.+?)\s+to\s+(.+)/i,
                /change\s+(.+?)\s+to\s+(.+)/i,
                /modify\s+(.+?)\s+to\s+(.+)/i,
                /edit\s+(.+?)\s+to\s+(.+)/i
            ];

            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[1] && match[2]) {
                    const result: VoiceIntent = {
                        action: 'update',
                        targetTodo: match[1].trim(),
                        newText: match[2].trim(),
                        confidence: 0.9
                    };
                    return result;
                }
            }

            return {
                action: 'update',
                confidence: 0.3
            };
        }

        // LIST patterns
        if (
            lowerText.includes('show') ||
            lowerText.includes('list') ||
            lowerText.includes('what') ||
            lowerText.includes('display') ||
            lowerText.includes('my tasks') ||
            lowerText.includes('my todos') ||
            lowerText.includes('pending') ||
            lowerText === 'tasks' ||
            lowerText === 'todos'
        ) {
            return {
                action: 'list',
                confidence: 0.9
            };
        }

        // Past tense completion patterns
        const completionPatterns = [
            /^(bought|purchased|got)\s+(.+)$/i,
            /^(checked|reviewed|read)\s+(.+)$/i,
            /^(finished|completed|did)\s+(.+)$/i,
            /^(sent|replied to|responded to)\s+(.+)$/i,
        ];

        for (const pattern of completionPatterns) {
            const match = text.match(pattern);
            if (match && match[2]) {
                const result: VoiceIntent = {
                    action: 'complete',
                    targetTodo: match[2].trim(),
                    confidence: 0.8
                };
                return result;
            }
        }

        // CREATE patterns
        if (
            lowerText.startsWith('add') ||
            lowerText.startsWith('create') ||
            lowerText.startsWith('new') ||
            lowerText.startsWith('make')
        ) {
            const patterns = [
                /(?:add|create|new|make)\s+(.+)/i
            ];

            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    const result: VoiceIntent = {
                        action: 'create',
                        todoText: match[1].trim(),
                        confidence: 0.9
                    };
                    return result;
                }
            }
        }

        // Default to CREATE if text is long enough
        if (lowerText.length > 2) {
            return {
                action: 'create',
                todoText: text,
                confidence: 0.6
            };
        }

        return {
            action: 'unclear',
            confidence: 0.1
        };
    }

    // FIXED: Complete method with correct property names and better search
    private async handleCompleteGTD(intent: VoiceIntent, originalText: string) {
        try {
            const databaseId = await this.ensureGTDDatabase();
            const today = new Date().toISOString().split('T')[0];

            let searchText = intent.targetTodo || originalText;
            console.log('Searching for task to complete:', searchText);

            // If it's a positional reference
            if (searchText === 'first' || searchText === 'last' || !isNaN(Number(searchText))) {
                const allTasks = await (this.notionService as any).notion.databases.query({
                    database_id: databaseId,
                    filter: {
                        and: [
                            {
                                property: 'Status',
                                select: {
                                    equals: 'Todo'
                                }
                            },
                            {
                                property: 'Date',
                                date: {
                                    equals: today
                                }
                            }
                        ]
                    },
                    sorts: [
                        {
                            property: 'Priority',
                            direction: 'ascending'
                        }
                    ]
                });

                let targetTask = null;
                if (searchText === 'first' && allTasks.results.length > 0) {
                    targetTask = allTasks.results[0];
                } else if (searchText === 'last' && allTasks.results.length > 0) {
                    targetTask = allTasks.results[allTasks.results.length - 1];
                } else if (!isNaN(Number(searchText))) {
                    const index = Number(searchText) - 1;
                    if (index >= 0 && index < allTasks.results.length) {
                        targetTask = allTasks.results[index];
                    }
                }

                if (targetTask) {
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

                    const taskName = targetTask.properties.Task?.title[0]?.plain_text;
                    return {
                        success: true,
                        message: `✅ Completed "${taskName}"`,
                        taskId: targetTask.id
                    };
                }
            }

            // Search by text - FIXED: Better search logic
            const response = await (this.notionService as any).notion.databases.query({
                database_id: databaseId,
                filter: {
                    and: [
                        {
                            property: 'Status',
                            select: {
                                equals: 'Todo'
                            }
                        }
                        // FIXED: Removed date filter to search all tasks, not just today's
                    ]
                }
            });

            // Find best matching task
            let targetTask = null;
            const searchLower = searchText.toLowerCase();

            // Try exact match first
            targetTask = response.results.find((task: any) => {
                const taskName = task.properties.Task?.title[0]?.plain_text?.toLowerCase() || '';
                return taskName === searchLower;
            });

            // Then try contains
            if (!targetTask) {
                targetTask = response.results.find((task: any) => {
                    const taskName = task.properties.Task?.title[0]?.plain_text?.toLowerCase() || '';
                    return taskName.includes(searchLower) || searchLower.includes(taskName);
                });
            }

            // Try partial word match
            if (!targetTask) {
                const searchWords = searchLower.split(' ');
                targetTask = response.results.find((task: any) => {
                    const taskName = task.properties.Task?.title[0]?.plain_text?.toLowerCase() || '';
                    return searchWords.some(word => taskName.includes(word));
                });
            }

            if (!targetTask) {
                return {
                    success: false,
                    message: `Couldn't find "${searchText}" in your tasks. Try 'show tasks' to see what's available.`
                };
            }

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

            const taskName = targetTask.properties.Task?.title[0]?.plain_text;
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

    // FIXED: Create method with Date property
    // FIXED: Create method with better error handling and fallbacks
    private async handleCreateGTD(intent: VoiceIntent, originalText: string) {
        // Fallback: if no todoText in intent, use the original text
        const taskText = intent.todoText || originalText.replace(/^(add|create|new|make|remember|remind)\s+/i, '').trim();

        if (!taskText || taskText.length < 1) {
            return { success: false, message: "I didn't catch what task you want to add. Please try again." };
        }

        try {
            const databaseId = await this.ensureGTDDatabase();
            console.log('Creating task with text:', taskText);

            const priority = this.extractPriority(originalText);
            const category = this.extractCategory(originalText);

            console.log('Extracted priority:', priority, 'category:', category);

            // Create the task with proper error handling for each property
            const taskProperties: any = {
                'Task': {
                    title: [
                        {
                            type: 'text',
                            text: {
                                content: taskText
                            }
                        }
                    ]
                }
            };

            // Add Status - make sure it matches database options
            try {
                taskProperties['Status'] = {
                    select: {
                        name: 'Todo'
                    }
                };
            } catch (error) {
                console.warn('Status property failed, skipping:', error);
            }

            // Add Priority - with fallback
            try {
                if (priority && ['High', 'Medium', 'Low'].includes(priority)) {
                    taskProperties['Priority'] = {
                        select: {
                            name: priority
                        }
                    };
                }
            } catch (error) {
                console.warn('Priority property failed, skipping:', error);
            }

            // Add Category - with fallback
            try {
                if (category && ['Work', 'Personal', 'Shopping', 'Email', 'Other'].includes(category)) {
                    taskProperties['Category'] = {
                        select: {
                            name: category
                        }
                    };
                }
            } catch (error) {
                console.warn('Category property failed, skipping:', error);
            }

            // // Add Date
            // try {
            //     taskProperties['Date'] = {
            //         date: {
            //             start: new Date().toISOString().split('T')[0]
            //         }
            //     };
            // } catch (error) {
            //     console.warn('Date property failed, skipping:', error);
            // }

            console.log('Final task properties:', JSON.stringify(taskProperties, null, 2));

            const newTask = await (this.notionService as any).notion.pages.create({
                parent: {
                    database_id: databaseId
                },
                properties: taskProperties
            });

            console.log('Task created successfully:', newTask.id);

            return {
                success: true,
                message: `✅ Added "${taskText}" to your tasks`,
                taskId: newTask.id,
                taskText: taskText,
                priority: priority,
                category: category
            };

        } catch (error) {
            console.error('Error creating task:', error);

            // More specific error handling
            if (error instanceof Error) {
                if (error.message.includes('database_id')) {
                    return { success: false, message: 'Database not found. Please check your configuration.' };
                } else if (error.message.includes('properties')) {
                    return { success: false, message: 'Failed to set task properties. Database schema might be incorrect.' };
                } else if (error.message.includes('unauthorized')) {
                    return { success: false, message: 'Not authorized to create tasks. Check your Notion permissions.' };
                }
            }

            return {
                success: false,
                message: `Failed to add task: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // FIXED: Delete method with correct property names
    private async handleDeleteGTD(intent: VoiceIntent) {
        if (!intent.targetTodo) {
            return { success: false, message: "Which task do you want to delete?" };
        }

        try {
            const databaseId = await this.ensureGTDDatabase();
            let tasksToDelete;

            if (intent.targetTodo.toLowerCase() === "all") {
                const allTasksResponse = await (this.notionService as any).notion.databases.query({
                    database_id: databaseId,
                });
                tasksToDelete = allTasksResponse.results;
            } else {
                // FIXED: Using 'Task' instead of 'Name'
                const response = await (this.notionService as any).notion.databases.query({
                    database_id: databaseId,
                    filter: {
                        property: 'Task',  // FIXED: Changed from 'Name' to 'Task'
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

            const deletePromises = tasksToDelete.map((task: any) =>
                (this.notionService as any).notion.pages.update({
                    page_id: task.id,
                    archived: true
                })
            );

            await Promise.all(deletePromises);

            const message = intent.targetTodo.toLowerCase() === "all"
                ? `🗑️ Deleted all ${tasksToDelete.length} tasks`
                : `🗑️ Deleted "${tasksToDelete[0].properties.Task?.title[0]?.plain_text || intent.targetTodo}"`;

            return { success: true, message: message };

        } catch (error) {
            console.error('Error deleting task:', error);
            return { success: false, message: 'Failed to delete task' };
        }
    }

    // FIXED: List method with today's date filter option
    private async handleListGTD() {
        try {
            const databaseId = await this.ensureGTDDatabase();
            const today = new Date().toISOString().split('T')[0];

            // Get all tasks (not just today's) for better visibility
            const response = await (this.notionService as any).notion.databases.query({
                database_id: databaseId,
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
                category: page.properties.Category?.select?.name || '',
                date: page.properties.Date?.date?.start || ''
            }));

            const todoTasks = tasks.filter((t: any) => t.status === 'Todo');
            const doneTasks = tasks.filter((t: any) => t.status === 'Done');

            if (tasks.length === 0) {
                return {
                    success: true,
                    message: "📋 No tasks yet. Start by adding some!",
                    tasks: [],
                    stats: { total: 0, todo: 0, done: 0 }
                };
            }

            let message = `📋 Your tasks (${doneTasks.length}/${tasks.length} done):\n`;

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

    // Helper methods remain the same
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
        if (lowerText.includes('email') || lowerText.includes('reply') || lowerText.includes('send')) {
            return 'Email';
        }
        return 'Other';
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

