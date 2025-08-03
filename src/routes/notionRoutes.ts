// routes/notionRoutes.ts

import { NotionController } from '@/handler/notionHandlers';
import { FastifyInstance } from 'fastify';


async function notionRoutes(fastify: FastifyInstance) {
    // Create controller instance with the service
    const notionController = new NotionController(fastify.notionService);

    // Bind methods to maintain proper 'this' context
    const getPage = notionController.getPage.bind(notionController);
    const getRecentPages = notionController.getRecentPages.bind(notionController);
    const addTodoToPage = notionController.addTodoToPage.bind(notionController);
    const createTodoPage = notionController.createTodoPage.bind(notionController);
    const deletePage = notionController.deletePage.bind(notionController);
    const updateTodo = notionController.updateTodo.bind(notionController)
    const getPageTodos = notionController.getPageTodos.bind(notionController);
    const getBlockInfo = notionController.getBlockInfo.bind(notionController);
    const getAllTodosRecursive = notionController.getAllTodosRecursive.bind(notionController);

    // Get a specific page
    fastify.get('/notes/:id', {

    }, getPage);

    // Get all recent pages
    fastify.get('/notes', {

    }, getRecentPages);

    // Add todo to existing page
    fastify.post('/notes/:id/todos', {

    }, addTodoToPage);

    // Create new page with todos
    fastify.post('/create-todo-page', {

    }, createTodoPage);

    // Delete a page
    fastify.delete('/notes/:id', {
    }, deletePage);

    // Update a todo (mark as complete/incomplete)
    fastify.patch('/todos/:blockId', {
        schema: {
            params: {
                type: 'object',
                properties: {
                    blockId: { type: 'string' }
                },
                required: ['blockId']
            },
            body: {
                type: 'object',
                properties: {
                    checked: { type: 'boolean' },
                    text: { type: 'string' }
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                        data: {
                            type: 'object',
                            properties: {
                                blockId: { type: 'string' },
                                checked: { type: ['boolean', 'null'] },
                                text: { type: ['string', 'null'] }
                            }
                        }
                    }
                }
            }
        }
    }, updateTodo);

    // Get all todos from a page
    fastify.get('/notes/:id/todos', {
        schema: {
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                },
                required: ['id']
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        pageId: { type: 'string' },
                        todos: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    text: { type: 'string' },
                                    checked: { type: 'boolean' },
                                    createdTime: { type: 'string' },
                                    lastEditedTime: { type: 'string' }
                                }
                            }
                        },
                        totalTodos: { type: 'number' },
                        completedTodos: { type: 'number' }
                    }
                }
            }
        }
    }, getPageTodos);

    // Debug: Get block info
    fastify.get('/blocks/:blockId/info', {
        schema: {
            params: {
                type: 'object',
                properties: {
                    blockId: { type: 'string' }
                },
                required: ['blockId']
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        blockInfo: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                type: { type: 'string' },
                                hasChildren: { type: 'boolean' },
                                createdTime: { type: 'string' },
                                lastEditedTime: { type: 'string' },
                                content: { type: ['object', 'null'] }
                            }
                        }
                    }
                }
            }
        }
    }, getBlockInfo);

    // Get all todos recursively (including child pages)
    fastify.get('/notes/:id/todos/all', {
        schema: {
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                },
                required: ['id']
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        pageId: { type: 'string' },
                        todos: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string' },
                                    text: { type: 'string' },
                                    checked: { type: 'boolean' },
                                    createdTime: { type: 'string' },
                                    lastEditedTime: { type: 'string' },
                                    parentPage: { type: 'string' },
                                    parentPageId: { type: 'string' }
                                }
                            }
                        },
                        totalTodos: { type: 'number' },
                        completedTodos: { type: 'number' }
                    }
                }
            }
        }
    }, getAllTodosRecursive);
}

export default notionRoutes;