import { WebSocket } from 'ws';
import { VoiceWebSocketHandler } from './voiceHandler.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

export class WebSocketManager {
    private connections: Map<string, VoiceWebSocketHandler> = new Map();
    private heartbeatInterval?: NodeJS.Timeout;

    constructor() {
        this.startHeartbeat();
    }

    public handleConnection(socket: WebSocket): string {
        const connectionId = uuidv4();
        const handler = new VoiceWebSocketHandler(socket, connectionId);

        this.connections.set(connectionId, handler);

        // Setup cleanup on disconnect
        socket.on('close', () => {
            this.removeConnection(connectionId);
        });

        logger.info(`🔗 New WebSocket connection: ${connectionId}, Total: ${this.connections.size}`);
        return connectionId;
    }

    public removeConnection(connectionId: string): void {
        const handler = this.connections.get(connectionId);
        if (handler) {
            handler.cleanup();
            this.connections.delete(connectionId);
            logger.info(`🗑️ Connection removed: ${connectionId}, Remaining: ${this.connections.size}`);
        }
    }

    public getConnection(connectionId: string): VoiceWebSocketHandler | undefined {
        return this.connections.get(connectionId);
    }

    public getActiveConnections(): number {
        return this.connections.size;
    }

    public broadcastMessage(message: any): void {
        this.connections.forEach((handler, connectionId) => {
            try {
                const connection = handler.getConnectionInfo();
                if (connection.socket.readyState === WebSocket.OPEN) {
                    connection.socket.send(JSON.stringify(message));
                }
            } catch (error) {
                logger.error(`Error broadcasting to ${connectionId}:`, error);
            }
        });
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.connections.forEach((handler, connectionId) => {
                try {
                    const connection = handler.getConnectionInfo();
                    const timeSinceLastActivity = Date.now() - connection.lastActivity.getTime();

                    // Remove stale connections (inactive for 5 minutes)
                    if (timeSinceLastActivity > 5 * 60 * 1000) {
                        logger.warn(`🚨 Removing stale connection: ${connectionId}`);
                        this.removeConnection(connectionId);
                        return;
                    }

                    // Send ping to active connections
                    if (connection.socket.readyState === WebSocket.OPEN) {
                        connection.socket.ping();
                    }
                } catch (error) {
                    logger.error(`Heartbeat error for ${connectionId}:`, error);
                    this.removeConnection(connectionId);
                }
            });
        }, 30000); // Every 30 seconds
    }

    public shutdown(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.connections.forEach((handler, connectionId) => {
            console.log(handler, "_h")
            this.removeConnection(connectionId);
        });

        logger.info('🛑 WebSocket Manager shutdown complete');
    }
}

// Export singleton instance
export const wsManager = new WebSocketManager();