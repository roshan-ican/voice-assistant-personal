// src/data/repositories/todoRepository.ts
import { Todo } from '@/data/models/todo.js';
import { logger } from '@/utils/logger.js';
import mongoose from 'mongoose';
import type { 
  ITodo, 
  FindTodoOptions, 
  UserStats, 
  TodoStatus,
  DeepPartial 
} from '@/types/index.js';

export class TodoRepository {

  async create(todoData: Partial<ITodo>): Promise<ITodo> {
    try {
      const todo = new Todo(todoData);
      const savedTodo = await todo.save();
      logger.info(` Todo created: ${savedTodo._id}`);
      return savedTodo;
    } catch (error) {
      logger.error('Error creating todo:', error);
      throw error;
    }
  }

  async findById(todoId: string): Promise<ITodo | null> {
    try {
      const todo = await Todo.findById(todoId).populate('user_id', 'name email');
      return todo;
    } catch (error) {
      logger.error('Error finding todo by ID:', error);
      throw error;
    }
  }

  async findByUserId(userId: string, options: FindTodoOptions = {}): Promise<ITodo[]> {
    try {
      const {
        status,
        priority,
        tags,
        limit = 50,
        skip = 0,
        sortBy = 'createdAt',
        sortOrder = -1
      } = options;

      const query: Record<string, any> = { 
        user_id: new mongoose.Types.ObjectId(userId) 
      };
      
      if (status) query.status = status;
      if (priority) query.priority = priority;
      if (tags && tags.length > 0) query.tags = { $in: tags };

      const todos = await Todo.find(query)
        .sort({ [sortBy]: sortOrder })
        .limit(limit)
        .skip(skip)
        .populate('user_id', 'name email');

      return todos;
    } catch (error) {
      logger.error('Error finding todos by user ID:', error);
      throw error;
    }
  }

  async searchTodos(userId: string, searchTerm: string, options: { limit?: number } = {}): Promise<ITodo[]> {
    try {
      const { limit = 20 } = options;
      
      const todos = await Todo.find({
        user_id: new mongoose.Types.ObjectId(userId),
        $text: { $search: searchTerm }
      })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit);

      return todos;
    } catch (error) {
      logger.error('Error searching todos:', error);
      throw error;
    }
  }

  async updateStatus(
    todoId: string, 
    status: TodoStatus, 
    additionalData: Record<string, any> = {}
  ): Promise<ITodo | null> {
    try {
      const updateData: Record<string, any> = { 
        status,
        ...additionalData
      };

      if (status === 'completed') {
        updateData.completed_at = new Date();
      }

      const todo = await Todo.findByIdAndUpdate(
        todoId,
        { $set: updateData },
        { new: true }
      );

      if (todo) {
        logger.info(` Todo ${todoId} status updated to: ${status}`);
      }
      return todo;
    } catch (error) {
      logger.error('Error updating todo status:', error);
      throw error;
    }
  }

  async updateNotionData(
    todoId: string, 
    notionData: DeepPartial<ITodo['notion_data']>
  ): Promise<ITodo | null> {
    try {
      const todo = await Todo.findByIdAndUpdate(
        todoId,
        { 
          $set: { 
            'notion_data': notionData,
            'processing_status.notion_created': true
          }
        },
        { new: true }
      );
      return todo;
    } catch (error) {
      logger.error('Error updating Notion data:', error);
      throw error;
    }
  }

  async updateEmbeddingStatus(
    todoId: string, 
    embeddingData: DeepPartial<ITodo['embedding']>
  ): Promise<ITodo | null> {
    try {
      const todo = await Todo.findByIdAndUpdate(
        todoId,
        { 
          $set: { 
            'embedding': embeddingData,
            'processing_status.embedding_generated': true
          }
        },
        { new: true }
      );
      return todo;
    } catch (error) {
      logger.error('Error updating embedding status:', error);
      throw error;
    }
  }

  async getPendingEmbeddings(limit = 10): Promise<ITodo[]> {
    try {
      const todos = await Todo.find({
        'processing_status.embedding_generated': false,
        status: { $in: ['created', 'completed'] }
      })
      .limit(limit)
      .sort({ createdAt: 1 }); // Oldest first

      return todos;
    } catch (error) {
      logger.error('Error getting pending embeddings:', error);
      throw error;
    }
  }

  async getTodosByTags(userId: string, tags: string[], limit = 20): Promise<ITodo[]> {
    try {
      const todos = await Todo.find({
        user_id: new mongoose.Types.ObjectId(userId),
        tags: { $in: tags }
      })
      .sort({ createdAt: -1 })
      .limit(limit);

      return todos;
    } catch (error) {
      logger.error('Error getting todos by tags:', error);
      throw error;
    }
  }

  async getUpcomingTodos(userId: string, days = 7): Promise<ITodo[]> {
    try {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);

      const todos = await Todo.find({
        user_id: new mongoose.Types.ObjectId(userId),
        due_date: {
          $gte: new Date(),
          $lte: endDate
        },
        status: { $ne: 'completed' }
      })
      .sort({ due_date: 1 });

      return todos;
    } catch (error) {
      logger.error('Error getting upcoming todos:', error);
      throw error;
    }
  }

  async getOverdueTodos(userId: string): Promise<ITodo[]> {
    try {
      const todos = await Todo.find({
        user_id: new mongoose.Types.ObjectId(userId),
        due_date: { $lt: new Date() },
        status: { $ne: 'completed' }
      })
      .sort({ due_date: 1 });

      return todos;
    } catch (error) {
      logger.error('Error getting overdue todos:', error);
      throw error;
    }
  }

  async getUserStats(userId: string): Promise<UserStats> {
    try {
      const stats = await Todo.aggregate([
        { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            pending: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
            },
            high_priority: {
              $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
            }
          }
        }
      ]);

      return stats[0] || {
        total: 0,
        completed: 0,
        pending: 0,
        high_priority: 0
      };
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw error;
    }
  }

  async deleteTodo(todoId: string, userId: string): Promise<ITodo | null> {
    try {
      const todo = await Todo.findOneAndDelete({
        _id: todoId,
        user_id: userId
      });

      if (todo) {
        logger.info(`️ Todo deleted: ${todoId}`);
        return todo;
      }
      return null;
    } catch (error) {
      logger.error('Error deleting todo:', error);
      throw error;
    }
  }
}