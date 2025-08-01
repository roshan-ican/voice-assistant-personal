import { User } from '@/data/models/user.js';
import { logger } from '@/utils/logger.js';
import type { IUser, DeepPartial } from '@/types/index.js';

export class UserRepository {

  async create(userData: Partial<IUser>): Promise<IUser> {
    try {
      const user = new User(userData);
      const savedUser = await user.save();
      logger.info(` User created: ${savedUser.email}`);
      return savedUser as any as IUser;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 11000) {
        throw new Error('User with this email already exists');
      }
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  async findById(userId: string): Promise<IUser | null> {
    try {
      const user = await User.findById(userId);
      return user as any as IUser || null;
    } catch (error) {
      logger.error('Error finding user by ID:', error);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<IUser | null> {
    try {
      const user = await User.findOne({ email: email.toLowerCase() })
        .select('+password'); // Include password for authentication
      return user as any as IUser || null;
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw error;
    }
  }

  async updateNotionIntegration(
    userId: string,
    notionData: DeepPartial<IUser['notion_integration']>
  ): Promise<IUser | null> {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            'notion_integration': {
              ...notionData,
              connected_at: new Date()
            }
          }
        },
        { new: true }
      );

      if (user) {
        logger.info(` Notion integration updated for user: ${user.email}`);
      }
      return user as any as IUser || null;
    } catch (error) {
      logger.error('Error updating Notion integration:', error);
      throw error;
    }
  }

  async updateVoicePreferences(
    userId: string,
    preferences: DeepPartial<IUser['voice_preferences']>
  ): Promise<IUser | null> {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { voice_preferences: preferences } },
        { new: true }
      );
      return user as any as IUser || null;
    } catch (error) {
      logger.error('Error updating voice preferences:', error);
      throw error;
    }
  }

  async updateUsageStats(
    userId: string,
    stats: Partial<IUser['usage_stats']>
  ): Promise<IUser | null> {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $inc: stats,
          $set: { 'usage_stats.last_active': new Date() }
        },
        { new: true }
      );
      return user as any as IUser || null;
    } catch (error) {
      logger.error('Error updating usage stats:', error);
      throw error;
    }
  }

  async getActiveUsers(limit = 100): Promise<IUser[]> {
    try {
      const users = await User.find({ is_active: true })
        .sort({ 'usage_stats.last_active': -1 })
        .limit(limit);
      return users.map(user => user as any as IUser);
    } catch (error) {
      logger.error('Error getting active users:', error);
      throw error;
    }
  }
}

