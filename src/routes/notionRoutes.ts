// routes/notionRoutes.ts

import { NotionController } from '@/handler/notionHandlers';
import { getAllTodosRecursiveSchema, getBlockInfoSchema, getPageTodosSchema, updateTodoSchema } from '@/schema/notionSchemas';
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

    fastify.patch('/todos/:blockId', { schema: updateTodoSchema }, updateTodo);

    fastify.get('/notes/:id/todos', { schema: getPageTodosSchema }, getPageTodos);

    fastify.get('/blocks/:blockId/info', { schema: getBlockInfoSchema }, getBlockInfo);

    fastify.get('/notes/:id/todos/all', { schema: getAllTodosRecursiveSchema }, getAllTodosRecursive);
}

export default notionRoutes;