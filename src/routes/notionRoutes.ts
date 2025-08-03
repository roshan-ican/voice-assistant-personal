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

    // Get a specific page
    fastify.get('/notes/:id', {
        schema: {
            // params: {
            //     type: 'object',
            //     properties: {
            //         id: { type: 'string' }
            //     },
            //     required: ['id']
            // },

        }
    }, getPage);

    // Get all recent pages
    fastify.get('/notes', {
        schema: {
            // querystring: {
            //     type: 'object',
            //     properties: {
            //         limit: { type: 'number', default: 10 },
            //         offset: { type: 'number', default: 0 }
            //     }
            // },
            // response: {
            //     200: {
            //         type: 'object',
            //         properties: {
            //             success: { type: 'boolean' },
            //             endpoint: { type: 'string' },
            //             count: { type: 'number' },
            //             notes: {
            //                 type: 'array',
            //                 items: {
            //                     type: 'object',
            //                     properties: {
            //                         id: { type: 'string' },
            //                         title: { type: 'string' },
            //                         language: { type: 'string' },
            //                         createdAt: { type: 'string' },
            //                         url: { type: ['string', 'null'] }
            //                     }
            //                 }
            //             }
            //         }
            //     }
            // }
        }
    }, getRecentPages);

    // Add todo to existing page
    fastify.post('/notes/:id/todos', {
        schema: {
            params: {
                type: 'object',
                properties: {
                    id: { type: 'string' }
                },
                required: ['id']
            },
            body: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                    checked: { type: 'boolean', default: false }
                },
                required: ['text']
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
                                pageId: { type: 'string' },
                                todoText: { type: 'string' },
                                checked: { type: 'boolean' },
                                blockId: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    }, addTodoToPage);

    // Create new page with todos
    fastify.post('/create-todo-page', {
        // schema: {
        //     body: {
        //         type: 'object',
        //         properties: {
        //             title: { type: 'string' },
        //             todos: {
        //                 type: 'array',
        //                 items: {
        //                     type: 'object',
        //                     properties: {
        //                         text: { type: 'string' },
        //                         checked: { type: 'boolean', default: false }
        //                     },
        //                     required: ['text']
        //                 },
        //                 default: []
        //             },
        //             language: { type: 'string', default: 'en' }
        //         }
        //     },
         
        // }
    }, createTodoPage);

    // Delete a page
    fastify.delete('/notes/:id', {
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
                        message: { type: 'string' }
                    }
                }
            }
        }
    }, deletePage);
}

export default notionRoutes;