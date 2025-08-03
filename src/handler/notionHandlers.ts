// controllers/notionController.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { NotionService } from '../services/notionService.js';
import { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints.js';

interface GetPageParams {
    id: string;
}

interface CreateTodoBody {
    text: string;
    checked?: boolean;
}

interface CreateTodoPageBody {
    title?: string;
    todos?: { text: string; checked?: boolean }[];
    language?: string;
    parentPageId?: string;        // ← add
    parentDatabaseId?: string;    // ← add
}

interface UpdateTodoBody {
    checked?: boolean;
    text?: string;
}
export class NotionController {
    constructor(private notionService: NotionService) { }

    // Helper method to clean page IDs
    private cleanPageId(id: string): string {
        let cleanId = id;
        if (id.includes('Voice-Roshan-Notes-')) {
            cleanId = id.replace('Voice-Roshan-Notes-', '');
        }

        if (cleanId.length === 32 && !cleanId.includes('-')) {
            cleanId = [
                cleanId.slice(0, 8),
                cleanId.slice(8, 12),
                cleanId.slice(12, 16),
                cleanId.slice(16, 20),
                cleanId.slice(20, 32)
            ].join('-');
        }

        return cleanId;
    }

    // Get a specific page by ID
    async getPage(request: FastifyRequest<{ Params: GetPageParams }>, reply: FastifyReply) {
        try {
            const { id } = request.params;

            // Clean the ID - remove any 'Voice-Roshan-Notes-' prefix if present
            let cleanId = id;
            if (id.includes('Voice-Roshan-Notes-')) {
                cleanId = id.replace('Voice-Roshan-Notes-', '');
            }

            // If it's 32 characters without dashes, format it as UUID
            if (cleanId.length === 32 && !cleanId.includes('-')) {
                cleanId = [
                    cleanId.slice(0, 8),
                    cleanId.slice(8, 12),
                    cleanId.slice(12, 16),
                    cleanId.slice(16, 20),
                    cleanId.slice(20, 32)
                ].join('-');
            }

            const note = await this.notionService.getPage(cleanId);

            console.log(note, "____note__")

            return {
                success: true,
                note
            };

        } catch (error) {
            request.log.error('Error getting note:', error);
            reply.code(404).send({
                success: false,
                error: 'Note not found',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // Get all recent pages
    async getRecentPages(request: FastifyRequest, reply: FastifyReply) {
        try {
            const { limit = 10, offset = 0 } = request.query as { limit?: number; offset?: number };

            const notes = await this.notionService.getRecentPages(limit, offset);

            return {
                success: true,
                endpoint: 'get-all-notes',
                count: notes.length,
                notes: notes.map(note => ({
                    id: note.id,
                    title: note.title,
                    language: note.language,
                    createdAt: note.createdAt,
                    url: note.url
                }))
            };
        } catch (error) {
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch notes'
            });
        }
    }

    // Add a todo to an existing page
    async addTodoToPage(
        request: FastifyRequest<{ Params: GetPageParams; Body: CreateTodoBody }>,
        reply: FastifyReply
    ) {
        try {
            const { id } = request.params;
            const { text, checked = false } = request.body;

            // Clean and format the page ID
            let cleanId = id;
            if (id.includes('Voice-Roshan-Notes-')) {
                cleanId = id.replace('Voice-Roshan-Notes-', '');
            }

            if (cleanId.length === 32 && !cleanId.includes('-')) {
                cleanId = [
                    cleanId.slice(0, 8),
                    cleanId.slice(8, 12),
                    cleanId.slice(12, 16),
                    cleanId.slice(16, 20),
                    cleanId.slice(20, 32)
                ].join('-');
            }

            // Access the Notion client directly from the service
            const response = await (this.notionService as any).notion.blocks.children.append({
                block_id: cleanId,
                children: [
                    {
                        object: 'block',
                        type: 'to_do',
                        to_do: {
                            rich_text: [
                                {
                                    type: 'text',
                                    text: {
                                        content: text
                                    }
                                }
                            ],
                            checked: checked,
                            color: 'default'
                        }
                    }
                ]
            });

            return {
                success: true,
                message: 'Todo added successfully',
                data: {
                    pageId: cleanId,
                    todoText: text,
                    checked: checked,
                    blockId: response.results[0].id
                }
            };

        } catch (error) {
            request.log.error('Error adding todo:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to add todo'
            });
        }
    }

    // Create a new page with todos
    async createTodoPage(
        request: FastifyRequest<{ Body: CreateTodoPageBody }>,
        reply: FastifyReply
    ) {
        try {
            /************ 1. Read body with defaults ************/
            const {
                title = `Todo List - ${new Date().toLocaleDateString()}`,
                todos = [],
                language = 'en',
                parentPageId,
                parentDatabaseId,
            } = request.body as CreateTodoPageBody;

            /************ 2. Build children ************/
            const children: BlockObjectRequest[] = todos.map(todo => ({
                object: 'block',
                type: 'to_do',
                to_do: {
                    rich_text: [{ type: 'text', text: { content: todo.text } }],
                    checked: todo.checked ?? false
                }
            }));

            if (todos.length) {
                children.unshift({
                    object: 'block',
                    type: 'heading_2',
                    heading_2: {
                        rich_text: [
                            { type: 'text', text: { content: 'Todo List' } }
                        ]
                    }
                });
            }

            /************ 3. Decide the parent ************/
            const FALLBACK_PAGE_ID = '23f0030a44018099b5d8e1239eadee83';

            const parent = parentPageId
                ? { page_id: parentPageId }
                : parentDatabaseId
                    ? { database_id: parentDatabaseId }
                    : { page_id: FALLBACK_PAGE_ID };

            /************ 4. Create the Notion page ************/
            const properties =
                (parent as any).database_id
                    ? {
                        // Parent is a DATABASE → use its schema fields
                        Name: {
                            title: [{ text: { content: title } }],
                        },
                        Language: {
                            select: { name: language },
                        },
                    }
                    : {
                        // Parent is a PAGE → only the built‑in "title" property is allowed
                        title: [
                            {
                                text: { content: title },
                            },
                        ],
                    };

            const { id: notionPageId } = await (this.notionService as any).notion.pages.create({
                parent,
                properties,
                children: children.length ? children : undefined,
            });

            /************ 5. Success payload ************/
            return {
                success: true,
                message: 'Todo page created successfully',
                data: {
                    notionPageId,
                    title,
                    todosCount: todos.length
                }
            };

        } catch (error) {
            console.error('Error creating todo page:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create todo page'
            });
        }
    }

    // Delete a page
    async deletePage(request: FastifyRequest<{ Params: GetPageParams }>, reply: FastifyReply) {
        try {
            const { id } = request.params;

            await this.notionService.deletePage(id);

            return {
                success: true,
                message: 'Page deleted successfully'
            };
        } catch (error) {
            request.log.error('Error deleting page:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete page'
            });
        }
    }

    // Update/toggle a todo
    // Update/toggle a todo
    async updateTodo(
        request: FastifyRequest<{ Params: { blockId: string }; Body: UpdateTodoBody }>,
        reply: FastifyReply
    ) {
        try {
            const { blockId } = request.params;
            const { checked, text } = request.body;

            // First, let's verify this is actually a todo block
            const block = await (this.notionService as any).notion.blocks.retrieve({
                block_id: blockId
            });
            console.log(block, "___block")

            if (block.type !== 'to_do') {
                return reply.code(400).send({
                    success: false,
                    error: 'Block is not a todo item',
                    blockType: block.type
                });
            }

            const updateData: any = {
                to_do: {}
            };

            if (checked !== undefined) {
                updateData.to_do.checked = checked;
            }

            if (text !== undefined) {
                updateData.to_do.rich_text = [
                    {
                        type: 'text',
                        text: {
                            content: text
                        }
                    }
                ];
            }

            await (this.notionService as any).notion.blocks.update({
                block_id: blockId,
                ...updateData
            });

            return {
                success: true,
                message: 'Todo updated successfully',
                data: {
                    blockId,
                    checked,
                    text,
                    previousChecked: block.to_do.checked
                }
            };

        } catch (error) {
            request.log.error('Error updating todo:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to update todo'
            });
        }
    }

    // Get all todos from a page (including child pages)
    async getPageTodos(request: FastifyRequest<{ Params: GetPageParams }>, reply: FastifyReply) {
        try {
            const { id } = request.params;
            const cleanId = this.cleanPageId(id);

            // Get all blocks from the page
            const blocks = await (this.notionService as any).notion.blocks.children.list({
                block_id: cleanId,
                page_size: 100
            });

            // Filter only todo blocks
            const todos = blocks.results
                .filter((block: any) => block.type === 'to_do')
                .map((block: any) => ({
                    id: block.id,
                    text: block.to_do.rich_text[0]?.plain_text || '',
                    checked: block.to_do.checked,
                    createdTime: block.created_time,
                    lastEditedTime: block.last_edited_time
                }));

            // Also get child pages
            const childPages = blocks.results
                .filter((block: any) => block.type === 'child_page')
                .map((block: any) => ({
                    id: block.id,
                    title: block.child_page.title,
                    type: 'child_page'
                }));

            return {
                success: true,
                pageId: cleanId,
                todos,
                childPages,
                totalTodos: todos.length,
                completedTodos: todos.filter((t: any) => t.checked).length,
                message: todos.length === 0 && childPages.length > 0
                    ? 'No todos found in this page. Todos might be in child pages listed above.'
                    : undefined
            };

        } catch (error) {
            request.log.error('Error getting todos:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get todos'
            });
        }
    }

    // Get all todos recursively (including from child pages)
    async getAllTodosRecursive(request: FastifyRequest<{ Params: GetPageParams }>, reply: FastifyReply) {
        try {
            const { id } = request.params;
            const cleanId = this.cleanPageId(id);

            const allTodos: any[] = [];

            // Recursive function to get todos
            const getTodosFromPage = async (pageId: string, pagePath: string = '') => {
                const blocks = await (this.notionService as any).notion.blocks.children.list({
                    block_id: pageId,
                    page_size: 100
                });

                for (const block of blocks.results) {
                    if (block.type === 'to_do') {
                        allTodos.push({
                            id: block.id,
                            text: block.to_do.rich_text[0]?.plain_text || '',
                            checked: block.to_do.checked,
                            createdTime: block.created_time,
                            lastEditedTime: block.last_edited_time,
                            parentPage: pagePath || 'Main Page',
                            parentPageId: pageId
                        });
                    } else if (block.type === 'child_page') {
                        // Recursively get todos from child pages
                        const childPageTitle = block.child_page.title;
                        await getTodosFromPage(block.id, pagePath ? `${pagePath} > ${childPageTitle}` : childPageTitle);
                    }
                }
            };

            await getTodosFromPage(cleanId);

            return {
                success: true,
                pageId: cleanId,
                todos: allTodos,
                totalTodos: allTodos.length,
                completedTodos: allTodos.filter(t => t.checked).length
            };

        } catch (error) {
            request.log.error('Error getting todos recursively:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get todos'
            });
        }
    }

    // Debug endpoint to check block type
    async getBlockInfo(request: FastifyRequest<{ Params: { blockId: string } }>, reply: FastifyReply) {
        try {
            const { blockId } = request.params;

            const block = await (this.notionService as any).notion.blocks.retrieve({
                block_id: blockId
            });

            return {
                success: true,
                blockInfo: {
                    id: block.id,
                    type: block.type,
                    hasChildren: block.has_children,
                    createdTime: block.created_time,
                    lastEditedTime: block.last_edited_time,
                    content: block[block.type] || null
                }
            };

        } catch (error) {
            request.log.error('Error getting block info:', error);
            reply.code(500).send({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get block info'
            });
        }
    }

}