// src/websockets/voiceHandler.ts
import { WebSocket } from 'ws';
import { logger } from '@/utils/logger.js';
import type { 
  WebSocketMessage, 
  WebSocketMessageType, 
  LanguageCode 
} from '@/types/index.js';

export interface VoiceConnection {
  id: string;
  userId?: string;
  socket: WebSocket;
  isRecording: boolean;
  audioChunks: Buffer[];
  lastActivity: Date;
  language: LanguageCode;
}

export class VoiceWebSocketHandler {
  private connection: VoiceConnection;
  private audioBuffer: Buffer[] = [];
  private isProcessing = false;
  private recordingStartTime?: Date;

  constructor(socket: WebSocket, connectionId: string) {
    this.connection = {
      id: connectionId,
      socket,
      isRecording: false,
      audioChunks: [],
      lastActivity: new Date(),
      language: 'en'
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.connection.socket.on('message', this.handleMessage.bind(this));
    this.connection.socket.on('close', this.handleClose.bind(this));
    this.connection.socket.on('error', this.handleError.bind(this));
    this.connection.socket.on('pong', this.handlePong.bind(this));

    // Send welcome message
    this.sendMessage({
      type: 'connection',
      data: {
        connectionId: this.connection.id,
        status: 'connected',
        supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'hi', 'ja'],
        features: {
          realTimeTranscription: true,
          multiLanguage: true,
          voiceResponse: true
        }
      },
      timestamp: new Date().toISOString()
    });

    logger.info(` Voice WebSocket connected: ${this.connection.id}`);
  }

  private async handleMessage(data: Buffer): Promise<void> {
    try {
      this.connection.lastActivity = new Date();

      // Try to parse as JSON (control messages)
      let message: WebSocketMessage;
      try {
        message = JSON.parse(data.toString());
      } catch {
        // If not JSON, treat as binary audio data
        await this.handleAudioData(data);
        return;
      }

      // Handle control messages
      switch (message.type) {
        case 'start_recording':
          await this.startRecording(message.data);
          break;

        case 'stop_recording':
          await this.stopRecording();
          break;

        case 'audio_chunk':
          await this.handleAudioChunk(message.data);
          break;

        case 'set_language':
          this.setLanguage(message.data?.language || 'en');
          break;

        case 'ping':
          this.sendMessage({
            type: 'pong' as WebSocketMessageType,
            timestamp: new Date().toISOString()
          });
          break;

        default:
          logger.warn(`Unknown message type: ${message.type}`);
      }

    } catch (error) {
      logger.error('Error handling WebSocket message:', error);
      this.sendError('Message processing failed');
    }
  }

  private async startRecording(data?: any): Promise<void> {
    try {
      this.connection.isRecording = true;
      this.audioBuffer = [];
      this.recordingStartTime = new Date();

      // Set language if provided
      if (data?.language) {
        this.connection.language = data.language;
      }

      this.sendMessage({
        type: 'recording_started',
        data: {
          language: this.connection.language,
          maxDuration: 300, // 5 minutes max
          supportedFormats: ['webm', 'wav', 'mp3']
        },
        timestamp: new Date().toISOString()
      });

      logger.info(`️ Recording started for connection: ${this.connection.id}`);

    } catch (error) {
      logger.error('Error starting recording:', error);
      this.sendError('Failed to start recording');
    }
  }

  private async stopRecording(): Promise<void> {
    try {
      if (!this.connection.isRecording) {
        this.sendError('No active recording to stop');
        return;
      }

      this.connection.isRecording = false;
      const recordingEndTime = new Date();
      const duration = this.recordingStartTime 
        ? recordingEndTime.getTime() - this.recordingStartTime.getTime()
        : 0;

      // Combine all audio chunks
      const fullAudio = Buffer.concat(this.audioBuffer);
      
      this.sendMessage({
        type: 'recording_stopped',
        data: {
          duration: Math.round(duration / 1000), // in seconds
          audioSize: fullAudio.length,
          chunksReceived: this.audioBuffer.length
        },
        timestamp: new Date().toISOString()
      });

      // Process the complete audio
      await this.processCompleteAudio(fullAudio, duration);

      logger.info(` Recording stopped for connection: ${this.connection.id}, Duration: ${duration}ms`);

    } catch (error) {
      logger.error('Error stopping recording:', error);
      this.sendError('Failed to stop recording');
    }
  }

  private async handleAudioChunk(audioData: string): Promise<void> {
    try {
      if (!this.connection.isRecording) {
        return;
      }

      // Convert base64 to buffer
      const audioBuffer = Buffer.from(audioData, 'base64');
      this.audioBuffer.push(audioBuffer);

      // Send acknowledgment
      this.sendMessage({
        type: 'chunk_received',
        data: {
          chunkSize: audioBuffer.length,
          totalChunks: this.audioBuffer.length,
          totalSize: this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
        },
        timestamp: new Date().toISOString()
      });

      // Process in real-time every 20 chunks (approximately 2 seconds)
      if (this.audioBuffer.length % 20 === 0 && !this.isProcessing) {
        await this.processRealtimeAudio();
      }

    } catch (error) {
      logger.error('Error handling audio chunk:', error);
    }
  }

  private async handleAudioData(binaryData: Buffer): Promise<void> {
    try {
      if (!this.connection.isRecording) {
        return;
      }

      this.audioBuffer.push(binaryData);

      // Send progress update
      this.sendMessage({
        type: 'audio_received',
        data: {
          size: binaryData.length,
          totalSize: this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error handling binary audio data:', error);
    }
  }

  private async processRealtimeAudio(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) {
      return;
    }

    try {
      this.isProcessing = true;

      // Get last few chunks for real-time processing
      const recentChunks = this.audioBuffer.slice(-20);
      const audioSegment = Buffer.concat(recentChunks);

      // Simulate real-time transcription (we'll implement Gemini later)
      const mockTranscript = await this.simulateTranscription(audioSegment);

      this.sendMessage({
        type: 'partial_transcript',
        data: {
          text: mockTranscript,
          confidence: 0.85,
          language: this.connection.language,
          isPartial: true
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error in real-time audio processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processCompleteAudio(audioBuffer: Buffer, duration: number): Promise<void> {
    try {
      this.sendMessage({
        type: 'processing_started',
        data: {
          message: 'Processing your voice command...',
          estimatedTime: '2-5 seconds'
        },
        timestamp: new Date().toISOString()
      });

      // Simulate complete transcription
      const transcript = await this.simulateTranscription(audioBuffer);
      
      // Simulate intent detection
      const intent = await this.simulateIntentDetection(transcript);

      // Send final results
      this.sendMessage({
        type: 'final_transcript',
        data: {
          text: transcript,
          confidence: 0.92,
          language: this.connection.language,
          intent: intent,
          audioMetadata: {
            duration: Math.round(duration / 1000),
            size: audioBuffer.length,
            format: 'webm'
          }
        },
        timestamp: new Date().toISOString()
      });

      // If it's a todo command, simulate todo creation
      if (intent.action === 'create_todo') {
        await this.simulateTodoCreation(intent);
      }

    } catch (error) {
      logger.error('Error processing complete audio:', error);
      this.sendError('Audio processing failed');
    }
  }

  private async simulateTranscription(_audioBuffer: Buffer): Promise<string> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock transcriptions based on audio size (just for demo)
    const mockTranscripts = [
      "Add buy groceries to my todo list",
      "Create a reminder to call mom tomorrow",
      "Schedule a meeting with the team next week",
      "Add finish the project report as high priority",
      "Remind me to pay the electricity bill",
      "Create a todo to book dentist appointment"
    ];

    return mockTranscripts[Math.floor(Math.random() * mockTranscripts.length)] as any
  }

  private async simulateIntentDetection(transcript: string) {
    // Simple intent detection simulation
    const lowerText = transcript.toLowerCase();
    
    if (lowerText.includes('add') || lowerText.includes('create') || lowerText.includes('todo')) {
      return {
        action: 'create_todo',
        confidence: 0.9,
        entities: {
          task: transcript.replace(/add|create|todo|to my list/gi, '').trim(),
          priority: lowerText.includes('urgent') || lowerText.includes('high') ? 'high' : 'medium',
          dueDate: lowerText.includes('tomorrow') ? 'tomorrow' : 
                   lowerText.includes('next week') ? 'next_week' : null,
        }
      };
    }

    return {
      action: 'unknown',
      confidence: 0.5,
      entities: {}
    };
  }

  private async simulateTodoCreation(intent: any): Promise<void> {
    // Simulate todo creation delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    this.sendMessage({
      type: 'todo_created',
      data: {
        message: `Todo created: "${intent.entities.task}"`,
        todo: {
          id: `todo_${Date.now()}`,
          title: intent.entities.task,
          priority: intent.entities.priority,
          status: 'created',
          dueDate: intent.entities.dueDate?.toISOString() || '',
          createdAt: new Date().toISOString()
        },
        actions: [
          { type: 'view_notion', label: 'View in Notion', url: '#' },
          { type: 'edit_todo', label: 'Edit Todo', id: `todo_${Date.now()}` }
        ]
      },
      timestamp: new Date().toISOString()
    });
  }

  private setLanguage(language: LanguageCode): void {
    this.connection.language = language;
    this.sendMessage({
      type: 'language_changed',
      data: {
        language: language,
        message: `Language set to ${language}`
      },
      timestamp: new Date().toISOString()
    });
    
    logger.info(` Language changed to ${language} for connection: ${this.connection.id}`);
  }

  private sendMessage(message: WebSocketMessage): void {
    if (this.connection.socket.readyState === WebSocket.OPEN) {
      this.connection.socket.send(JSON.stringify(message));
    }
  }

  private sendError(errorMessage: string): void {
    this.sendMessage({
      type: 'error',
      data: {
        error: errorMessage,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  }

  private handleClose(): void {
    logger.info(` WebSocket connection closed: ${this.connection.id}`);
  }

  private handleError(error: Error): void {
    logger.error(`WebSocket error for connection ${this.connection.id}:`, error);
  }

  private handlePong(): void {
    this.connection.lastActivity = new Date();
  }

  // Public method to get connection info
  public getConnectionInfo(): VoiceConnection {
    return { ...this.connection };
  }

  // Public method to cleanup
  public cleanup(): void {
    this.audioBuffer = [];
    this.isProcessing = false;
    this.connection.isRecording = false;
  }
}