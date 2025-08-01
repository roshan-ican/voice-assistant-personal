
// src/data/database/mongodb.ts
import mongoose from 'mongoose';
import { config } from '@/utils/config.js';
import { logger } from '@/utils/logger.js';
import type { DatabaseHealth } from '@/types/index.js';

class DatabaseManager {
  private connection: typeof mongoose | null = null;

  async connect(): Promise<typeof mongoose> {
    try {
      // MongoDB connection options
      const options: mongoose.ConnectOptions = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false,
      };

      this.connection = await mongoose.connect(config.mongodb.uri, options);

      logger.info('🍃 MongoDB connected successfully');
      logger.info(`📊 Database: ${this.connection.connection.name}`);

      // Handle connection events
      mongoose.connection.on('error', (error: Error) => {
        logger.error('MongoDB connection error:', error);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('📡 MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('🔄 MongoDB reconnected');
      });

      return this.connection;
    } catch (error) {
      logger.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await mongoose.disconnect();
      logger.info('🍃 MongoDB disconnected gracefully');
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
    }
  }

  async healthCheck(): Promise<DatabaseHealth> {
    try {
      const state = mongoose.connection.readyState;
      const states: Record<number, string> = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };

      return {
        status: states[state] || 'unknown',
        database: mongoose.connection.name,
        host: mongoose.connection.host,
        port: mongoose.connection.port
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const dbManager = new DatabaseManager();