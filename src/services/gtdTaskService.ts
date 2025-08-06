// GTD Notion Database Structure & Voice Integration

import { GeminiService } from "./geminiService";
import { NotionService } from "./notionService";

// 1. GTD NOTION DATABASE SCHEMA
interface GTDTask {
    // Core GTD Properties
    id: string;
    title: string;
    description?: string;
    status: 'inbox' | 'next_action' | 'waiting_for' | 'someday_maybe' | 'done';
    context: string[]; // @calls, @computer, @errands, @home, @office
    project?: string;
    area_of_focus?: string; // Health, Work, Personal, etc.

    // Priority & Time Management
    priority: 'low' | 'medium' | 'high' | 'urgent';
    energy_level: 'low' | 'medium' | 'high'; // For context switching
    time_estimate: number; // in minutes
    due_date?: string;
    defer_until?: string; // Tickler file concept

    // GTD Workflow
    is_actionable: boolean;
    next_action?: string; // If part of multi-step project
    waiting_for_person?: string;
    review_date?: string; // For weekly/monthly reviews

    // Metadata
    created_date: string;
    completed_date?: string;
    tags: string[];
    source: 'voice' | 'manual' | 'email' | 'other';
}

// 2. ENHANCED VOICE COMMAND PARSING FOR GTD
class GTDVoiceService {
    private geminiService: GeminiService;
    private notionService: NotionService;

    constructor(geminiService: GeminiService, notionService: NotionService) {
        this.geminiService = geminiService;
        this.notionService = notionService;
    }

    async parseGTDVoiceCommand(text: string): Promise<GTDVoiceIntent> {
        const prompt = `
            Analyze this voice command for a GTD (Getting Things Done) task management system.
            
            Command: "${text}"
            
            Extract and determine:
            
            1. ACTION TYPE:
               - capture: Add new item to inbox
               - clarify: Define what something means/requires
               - organize: Move items between GTD categories
               - review: Show/filter tasks
               - engage: Mark as doing/complete
            
            2. GTD CATEGORIES:
               - inbox: Unsorted, needs processing
               - next_action: Ready to do now
               - waiting_for: Blocked by someone else  
               - someday_maybe: Future possibilities
               - projects: Multi-step outcomes
            
            3. CONTEXTS (where/how to do it):
               - @calls, @computer, @errands, @home, @office, @online, @anywhere
            
            4. DETAILS:
               - Task title/description
               - Project name (if mentioned)
               - Priority level
               - Time estimate
               - Energy level needed
               - Due date/deadline
               - Person to wait for
            
            EXAMPLES:
            - "Add call mom to my phone calls list" → capture, context: @calls
            - "I need to someday learn Spanish" → capture, status: someday_maybe
            - "Move grocery shopping to next actions" → organize, status: next_action, context: @errands
            - "Mark the presentation as waiting for John's feedback" → organize, status: waiting_for, waiting_for: John
            - "Show me all my computer tasks" → review, filter: context @computer
            - "Add quick 15 minute task to update website" → capture, time_estimate: 15, context: @computer
            
            Return JSON:
            {
                "action": "capture|clarify|organize|review|engage",
                "task_title": "...",
                "status": "inbox|next_action|waiting_for|someday_maybe|projects",
                "context": ["@context1", "@context2"],
                "project": "project name or null",
                "priority": "low|medium|high|urgent",
                "energy_level": "low|medium|high",
                "time_estimate": minutes or null,
                "due_date": "YYYY-MM-DD or null",
                "waiting_for_person": "person name or null",
                "tags": ["tag1", "tag2"],
                "confidence": 0.0-1.0
            }
        `;

        try {
            const result = await this.geminiService.textModel.generateContent(prompt);
            const response = result.response.text();
            const jsonMatch = response.match(/\{[\s\S]*\}/);

            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            // Fallback parsing
            return this.fallbackGTDParsing(text);
        }
    }

    private fallbackGTDParsing(text: string): GTDVoiceIntent {
        const lowerText = text.toLowerCase();

        // Detect action type
        let action: 'capture' | 'organize' | 'review' | 'engage' = 'capture';
        if (lowerText.includes('show') || lowerText.includes('list')) action = 'review';
        if (lowerText.includes('move') || lowerText.includes('change')) action = 'organize';
        if (lowerText.includes('complete') || lowerText.includes('done')) action = 'engage';

        // Detect context
        const contexts: string[] = [];
        if (lowerText.includes('call') || lowerText.includes('phone')) contexts.push('@calls');
        if (lowerText.includes('computer') || lowerText.includes('online')) contexts.push('@computer');
        if (lowerText.includes('home')) contexts.push('@home');
        if (lowerText.includes('office') || lowerText.includes('work')) contexts.push('@office');
        if (lowerText.includes('errand') || lowerText.includes('shopping')) contexts.push('@errands');

        // Detect status
        let status: GTDStatus = 'inbox';
        if (lowerText.includes('next action')) status = 'next_action';
        if (lowerText.includes('waiting for')) status = 'waiting_for';
        if (lowerText.includes('someday') || lowerText.includes('maybe')) status = 'someday_maybe';

        return {
            action,
            task_title: text,
            status,
            context: contexts.length > 0 ? contexts : ['@anywhere'],
            confidence: 0.6
        };
    }

    // GTD-specific handlers
    async handleGTDCapture(intent: GTDVoiceIntent, userId: string): Promise<any> {
        const taskData: Partial<GTDTask> = {
            title: intent.task_title,
            status: intent.status || 'inbox',
            context: intent.context || ['@anywhere'],
            project: intent.project || "",
            priority: intent.priority || 'medium',
            energy_level: intent.energy_level || 'medium',
            time_estimate: intent.time_estimate,
            due_date: intent.due_date,
            waiting_for_person: intent.waiting_for_person,
            tags: intent.tags || [],
            source: 'voice',
            is_actionable: intent.status !== 'someday_maybe',
            created_date: new Date().toISOString()
        };

        return await this.notionService.createGTDTask(taskData);
    }

    async handleGTDReview(intent: GTDVoiceIntent): Promise<any> {
        const filters: any = {};

        if (intent.context && intent.context.length > 0) {
            filters.context = intent.context;
        }

        if (intent.status) {
            filters.status = intent.status;
        }

        if (intent.project) {
            filters.project = intent.project;
        }

        return await this.notionService.getGTDTasks(filters);
    }
}

// 3. NOTION SERVICE EXTENSIONS FOR GTD
class GTDNotionService extends NotionService {

    async createGTDDatabase(): Promise<string> {
        const databaseProperties = {
            "Title": { title: {} },
            "Status": {
                select: {
                    options: [
                        { name: "📥 Inbox", color: "gray" },
                        { name: "⚡ Next Action", color: "green" },
                        { name: "⏳ Waiting For", color: "yellow" },
                        { name: "🔮 Someday/Maybe", color: "blue" },
                        { name: "✅ Done", color: "green" }
                    ]
                }
            },
            "Context": {
                multi_select: {
                    options: [
                        { name: "@calls", color: "blue" },
                        { name: "@computer", color: "purple" },
                        { name: "@errands", color: "orange" },
                        { name: "@home", color: "green" },
                        { name: "@office", color: "red" },
                        { name: "@online", color: "blue" },
                        { name: "@anywhere", color: "gray" }
                    ]
                }
            },
            "Project": {
                relation: {
                    database_id: "projects_database_id",
                    single_property: {}
                }
            },
            "Priority": {
                select: {
                    options: [
                        { name: "🔥 Urgent", color: "red" },
                        { name: "⚠️ High", color: "orange" },
                        { name: "📋 Medium", color: "yellow" },
                        { name: "🌱 Low", color: "green" }
                    ]
                }
            },
            "Energy Level": {
                select: {
                    options: [
                        { name: "🔋 High", color: "green" },
                        { name: "⚡ Medium", color: "yellow" },
                        { name: "🪫 Low", color: "red" }
                    ]
                }
            },
            "Time Estimate": { number: { format: "number" } },
            "Due Date": { date: {} },
            "Defer Until": { date: {} },
            "Waiting For": { rich_text: {} },
            "Area of Focus": {
                select: {
                    options: [
                        { name: "💼 Work", color: "blue" },
                        { name: "🏠 Personal", color: "green" },
                        { name: "💪 Health", color: "red" },
                        { name: "📚 Learning", color: "purple" },
                        { name: "💰 Finance", color: "orange" }
                    ]
                }
            },
            "Tags": { multi_select: { options: [] } },
            "Created": { created_time: {} },
            "Last Modified": { last_edited_time: {} },
            "Source": {
                select: {
                    options: [
                        { name: "🎤 Voice", color: "purple" },
                        { name: "✍️ Manual", color: "blue" },
                        { name: "📧 Email", color: "orange" },
                        { name: "🔗 Import", color: "gray" }
                    ]
                }
            }
        };

        // Create the database
        const response = await this.notion.databases.create({
            parent: { page_id: "parent_page_id" },
            title: [{ text: { content: "GTD Task Management" } }],
            properties: databaseProperties
        });

        return response.id;
    }

    async createGTDTask(taskData: Partial<GTDTask>): Promise<any> {
        const properties: any = {
            "Title": {
                title: [{ text: { content: taskData.title || "Untitled Task" } }]
            },
            "Status": {
                select: { name: this.mapStatusToNotion(taskData.status || 'inbox') }
            },
            "Context": {
                multi_select: taskData.context?.map(ctx => ({ name: ctx })) || []
            },
            "Priority": {
                select: { name: this.mapPriorityToNotion(taskData.priority || 'medium') }
            },
            "Energy Level": {
                select: { name: this.mapEnergyToNotion(taskData.energy_level || 'medium') }
            },
            "Source": {
                select: { name: "🎤 Voice" }
            }
        };

        if (taskData.time_estimate) {
            properties["Time Estimate"] = { number: taskData.time_estimate };
        }

        if (taskData.due_date) {
            properties["Due Date"] = { date: { start: taskData.due_date } };
        }

        if (taskData.waiting_for_person) {
            properties["Waiting For"] = {
                rich_text: [{ text: { content: taskData.waiting_for_person } }]
            };
        }

        return await this.notion.pages.create({
            parent: { database_id: this.gtdDatabaseId },
            properties
        });
    }

    private mapStatusToNotion(status: string): string {
        const statusMap = {
            'inbox': '📥 Inbox',
            'next_action': '⚡ Next Action',
            'waiting_for': '⏳ Waiting For',
            'someday_maybe': '🔮 Someday/Maybe',
            'done': '✅ Done'
        };
        return statusMap[status as keyof typeof statusMap] || '📥 Inbox';
    }

    private mapPriorityToNotion(priority: string): string {
        const priorityMap = {
            'urgent': '🔥 Urgent',
            'high': '⚠️ High',
            'medium': '📋 Medium',
            'low': '🌱 Low'
        };
        return priorityMap[priority as keyof typeof priorityMap] || '📋 Medium';
    }

    private mapEnergyToNotion(energy: string): string {
        const energyMap = {
            'high': '🔋 High',
            'medium': '⚡ Medium',
            'low': '🪫 Low'
        };
        return energyMap[energy as keyof typeof energyMap] || '⚡ Medium';
    }
}

// 4. VOICE COMMAND EXAMPLES FOR GTD
const GTD_VOICE_EXAMPLES = [
    // Capture Commands
    "Add call dentist to schedule appointment",
    "Capture idea: create a mobile app for expense tracking",
    "Remember to buy groceries this weekend",
    "Add high priority task to finish quarterly report by Friday",
    "I need to someday learn photography",

    // Organize Commands  
    "Move email cleanup task to next actions",
    "Change presentation task to waiting for Sarah's feedback",
    "Mark website update as computer task",
    "Set grocery shopping as errands context",

    // Review Commands
    "Show me all my phone call tasks",
    "List everything I'm waiting for",
    "What are my next actions for today?",
    "Show high priority tasks",
    "Display all someday maybe items",

    // Engage Commands
    "Mark call mom as completed",
    "I finished the presentation task",
    "Done with grocery shopping"
];

// 5. TYPE DEFINITIONS
type GTDStatus = 'inbox' | 'next_action' | 'waiting_for' | 'someday_maybe' | 'done';
type GTDAction = 'capture' | 'clarify' | 'organize' | 'review' | 'engage';
type GTDContext = '@calls' | '@computer' | '@errands' | '@home' | '@office' | '@online' | '@anywhere';

interface GTDVoiceIntent {
    action: GTDAction;
    task_title: string;
    status?: GTDStatus;
    context?: string[];
    project?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    energy_level?: 'low' | 'medium' | 'high';
    time_estimate?: number;
    due_date?: string;
    waiting_for_person?: string;
    tags?: string[];
    confidence: number;
}