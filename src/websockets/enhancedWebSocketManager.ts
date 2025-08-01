// src/websockets/enhancedWebSocketManager.ts
import { WebSocket } from 'ws';
import { EnhancedVoiceWebSocketHandler } from './enhancedVoiceHandler.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export class EnhancedWebSocketManager {
  private connections: Map<string, EnhancedVoiceWebSocketHandler> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;
  private stats = {
    totalConnections: 0,
    activeConnections: 0,
    totalMessages: 0,
    totalTranscriptions: 0,
    totalTodosCreated: 0
  };

  constructor() {
    this.startHeartbeat();
    this.startStatsLogging();
  }

  public handleConnection(socket: WebSocket, userInfo?: { userId?: string; userAgent?: string }): string {
    const connectionId = uuidv4();
    const handler = new EnhancedVoiceWebSocketHandler(socket, connectionId);
    
    this.connections.set(connectionId, handler);
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    // Setup cleanup on disconnect
    socket.on('close', () => {
      this.removeConnection(connectionId);
    });

    // Enhanced logging with user info
    logger.info(`🔗 Enhanced WebSocket connection established`, {
      connectionId,
      userId: userInfo?.userId || 'anonymous',
      userAgent: userInfo?.userAgent || 'unknown',
      totalActive: this.connections.size,
      totalEver: this.stats.totalConnections
    });

    return connectionId;
  }

  public removeConnection(connectionId: string): void {
    const handler = this.connections.get(connectionId);
    if (handler) {
      handler.cleanup();
      this.connections.delete(connectionId);
      this.stats.activeConnections--;
      
      logger.info(`🗑️ Connection removed: ${connectionId}`, {
        remaining: this.connections.size
      });
    }
  }

  public getConnection(connectionId: string): EnhancedVoiceWebSocketHandler | undefined {
    return this.connections.get(connectionId);
  }

  public getActiveConnections(): number {
    return this.connections.size;
  }

  public getStats(): typeof this.stats {
    return { ...this.stats };
  }

  public async getDetailedStats(): Promise<{
    connections: number;
    totalEver: number;
    healthStatus: string;
    connectionDetails: Array<{
      id: string;
      isRecording: boolean;
      language: string;
      lastActivity: string;
      healthStatus: string;
    }>;
  }> {
    const connectionDetails = [];
    
    for (const [id, handler] of this.connections) {
      try {
        const info = handler.getConnectionInfo();
        const health = await handler.healthCheck();
        
        connectionDetails.push({
          id,
          isRecording: info.isRecording,
          language: info.language,
          lastActivity: info.lastActivity.toISOString(),
          healthStatus: health.status
        });
      } catch (error) {
        connectionDetails.push({
          id,
          isRecording: false,
          language: 'unknown',
          lastActivity: 'unknown',
          healthStatus: 'error'
        });
      }
    }

    return {
      connections: this.connections.size,
      totalEver: this.stats.totalConnections,
      healthStatus: this.connections.size > 0 ? 'active' : 'idle',
      connectionDetails
    };
  }

  public broadcastMessage(message: any, excludeConnectionId?: string): void {
    let successCount = 0;
    let errorCount = 0;

    this.connections.forEach((handler, connectionId) => {
      if (excludeConnectionId && connectionId === excludeConnectionId) {
        return;
      }

      try {
        const connection = handler.getConnectionInfo();
        if (connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            ...message,
            broadcast: true,
            timestamp: new Date().toISOString()
          }));
          successCount++;
        }
      } catch (error) {
        logger.error(`Error broadcasting to ${connectionId}:`, error);
        errorCount++;
      }
    });

    logger.info(`📡 Broadcast completed: ${successCount} sent, ${errorCount} failed`);
  }

  public async broadcastSystemUpdate(update: {
    type: 'maintenance' | 'feature_update' | 'system_alert';
    message: string;
    severity: 'info' | 'warning' | 'critical';
    data?: any;
  }): Promise<void> {
    const systemMessage = {
      type: 'system_update',
      data: {
        ...update,
        timestamp: new Date().toISOString(),
        affectedConnections: this.connections.size
      }
    };

    this.broadcastMessage(systemMessage);
    
    logger.info(`🚨 System update broadcasted: ${update.type} - ${update.message}`);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      const staleConnections: string[] = [];
      const healthChecks: Promise<void>[] = [];

      this.connections.forEach((handler, connectionId) => {
        const healthCheck = this.performConnectionHealthCheck(connectionId, handler);
        healthChecks.push(healthCheck);
      });

      // Wait for all health checks to complete
      await Promise.allSettled(healthChecks);

      // Remove any stale connections that were identified
      staleConnections.forEach(connectionId => {
        this.removeConnection(connectionId);
      });

      // Log heartbeat status
      if (this.connections.size > 0) {
        logger.debug(`💓 Heartbeat: ${this.connections.size} active connections`);
      }

    }, 30000); // Every 30 seconds
  }

  private async performConnectionHealthCheck(
    connectionId: string, 
    handler: EnhancedVoiceWebSocketHandler
  ): Promise<void> {
    try {
      const connection = handler.getConnectionInfo();
      const timeSinceLastActivity = Date.now() - connection.lastActivity.getTime();
      
      // Remove stale connections (inactive for 10 minutes)
      if (timeSinceLastActivity > 10 * 60 * 1000) {
        logger.warn(`🚨 Removing stale connection: ${connectionId} (inactive for ${Math.round(timeSinceLastActivity / 1000)}s)`);
        this.removeConnection(connectionId);
        return;
      }

      // Send ping to active connections
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.ping();
        
        // Perform AI service health check occasionally
        if (Math.random() < 0.1) { // 10% chance each heartbeat
          const health = await handler.healthCheck();
          if (health.status === 'error') {
            logger.warn(`⚠️ AI service degraded for connection: ${connectionId}`);
          }
        }
      } else {
        // Connection is not open, remove it
        this.removeConnection(connectionId);
      }

    } catch (error) {
      logger.error(`Heartbeat error for ${connectionId}:`, error);
      this.removeConnection(connectionId);
    }
  }

  private startStatsLogging(): void {
    // Log stats every 5 minutes
    setInterval(() => {
      if (this.stats.activeConnections > 0) {
        logger.info('📊 WebSocket Stats:', {
          active: this.stats.activeConnections,
          totalEver: this.stats.totalConnections,
          messages: this.stats.totalMessages,
          transcriptions: this.stats.totalTranscriptions,
          todosCreated: this.stats.totalTodosCreated
        });
      }
    }, 5 * 60 * 1000);
  }

  public incrementStat(stat: keyof typeof this.stats): void {
    if (stat in this.stats) {
      (this.stats[stat] as number)++;
    }
  }

  public async performSystemHealthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'error';
    connections: number;
    services: {
      websockets: string;
      gemini: string;
      connections: string;
    };
    details: any;
  }> {
    try {
      // Check WebSocket server health
      const wsHealth = this.connections.size >= 0 ? 'healthy' : 'error';
      
      // Sample Gemini health from one connection
      let geminiHealth = 'unknown';
      if (this.connections.size > 0) {
        const firstConnection = this.connections.values().next().value;
        if (firstConnection) {
          const health = await firstConnection.healthCheck();
          geminiHealth = health.status;
        }
      }

      // Overall connection health
      const connectionHealth = this.connections.size > 0 ? 'active' : 'idle';

      const overallStatus = 
        geminiHealth === 'error' ? 'error' :
        geminiHealth === 'degraded' || wsHealth === 'degraded' ? 'degraded' :
        'healthy';

      return {
        status: overallStatus,
        connections: this.connections.size,
        services: {
          websockets: wsHealth,
          gemini: geminiHealth,
          connections: connectionHealth
        },
        details: {
          stats: this.stats,
          uptime: process.uptime(),
          memory: process.memoryUsage()
        }
      };

    } catch (error) {
      logger.error('System health check failed:', error);
      return {
        status: 'error',
        connections: this.connections.size,
        services: {
          websockets: 'error',
          gemini: 'error',
          connections: 'error'
        },
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }

  public shutdown(): void {
    logger.info('🛑 Shutting down Enhanced WebSocket Manager...');

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections gracefully
    const shutdownPromises: Promise<void>[] = [];
    
    this.connections.forEach((handler, connectionId) => {
      const shutdownPromise = new Promise<void>((resolve) => {
        try {
          const connection = handler.getConnectionInfo();
          
          // Send shutdown notice
          if (connection.socket.readyState === WebSocket.OPEN) {
            connection.socket.send(JSON.stringify({
              type: 'system_shutdown',
              data: {
                message: 'Server is shutting down gracefully',
                timestamp: new Date().toISOString()
              }
            }));
            
            // Give clients time to receive the message
            setTimeout(() => {
              connection.socket.close(1001, 'Server shutdown');
              resolve();
            }, 1000);
          } else {
            resolve();
          }
        } catch (error) {
          logger.error(`Error during shutdown for ${connectionId}:`, error);
          resolve();
        }
      });
      
      shutdownPromises.push(shutdownPromise);
    });

    // Wait for all connections to close gracefully
    Promise.allSettled(shutdownPromises).then(() => {
      this.connections.clear();
      logger.info('✅ Enhanced WebSocket Manager shutdown complete');
    });
  }
}

// Export singleton instance
export const enhancedWsManager = new EnhancedWebSocketManager();