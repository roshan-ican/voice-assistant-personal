// src/websockets/enhancedVoiceHandler.ts
import { WebSocket } from 'ws';
import { logger } from '../utils/logger.js';
import { GeminiService } from '../services/geminiService.js';
import type {
    WebSocketMessage,
    WebSocketMessageType,
    LanguageCode
} from '../types/index.js';

export interface VoiceConnection {
    id: string;
    userId?: string;
    socket: WebSocket;
    isRecording: boolean;
    audioChunks: Buffer[];
    lastActivity: Date;
    language: LanguageCode;
    geminiService: GeminiService;
}

export class EnhancedVoiceWebSocketHandler {
    private connection: VoiceConnection;
    private audioBuffer: Buffer[] = [];
    private isProcessing = false;
    private recordingStartTime?: Date;
    private realtimeTranscriptionTimer?: NodeJS.Timeout | undefined;

    constructor(socket: WebSocket, connectionId: string) {
        this.connection = {
            id: connectionId,
            socket,
            isRecording: false,
            audioChunks: [],
            lastActivity: new Date(),
            language: 'en',
            geminiService: new GeminiService()
        };

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.connection.socket.on('message', this.handleMessage.bind(this));
        this.connection.socket.on('close', this.handleClose.bind(this));
        this.connection.socket.on('error', this.handleError.bind(this));
        this.connection.socket.on('pong', this.handlePong.bind(this));

        // Send enhanced welcome message
        this.sendMessage({
            type: 'connection',
            data: {
                connectionId: this.connection.id,
                status: 'connected',
                aiProvider: 'Google Gemini',
                features: {
                    realTimeTranscription: true,
                    multiLanguage: true,
                    voiceEnhancement: true,
                    intentDetection: true,
                    semanticSearch: true
                },
                supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'hi', 'ja', 'ko', 'zh', 'ar'],
                version: '2.0'
            },
            timestamp: new Date().toISOString()
        });

        logger.info(`🎤 Enhanced Voice WebSocket connected: ${this.connection.id}`);
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
                await this.handleBinaryAudio(data);
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
                    await this.setLanguage(message.data?.language || 'en');
                    break;

                case 'cancel_recording':
                    await this.cancelRecording();
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
            if (this.connection.isRecording) {
                this.sendError('Recording already in progress');
                return;
            }

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
                    aiProvider: 'Google Gemini',
                    features: ['real_time_transcription', 'intent_detection', 'voice_enhancement']
                },
                timestamp: new Date().toISOString()
            });

            // Start real-time transcription timer
            this.startRealtimeTranscription();

            logger.info(`🎙️ Enhanced recording started: ${this.connection.id} (${this.connection.language})`);

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
            this.clearRealtimeTranscription();

            const recordingEndTime = new Date();
            const duration = this.recordingStartTime
                ? recordingEndTime.getTime() - this.recordingStartTime.getTime()
                : 0;

            // Combine all audio chunks
            const fullAudio = Buffer.concat(this.audioBuffer);

            this.sendMessage({
                type: 'recording_stopped',
                data: {
                    duration: Math.round(duration / 1000),
                    audioSize: fullAudio.length,
                    chunksReceived: this.audioBuffer.length,
                    processingStatus: 'starting'
                },
                timestamp: new Date().toISOString()
            });

            // Process with real Gemini AI
            await this.processWithGemini(fullAudio, duration);

            logger.info(`🛑 Enhanced recording stopped: ${this.connection.id}, Duration: ${duration}ms, Size: ${fullAudio.length} bytes`);

        } catch (error) {
            logger.error('Error stopping recording:', error);
            this.sendError('Failed to stop recording');
        }
    }

    private async cancelRecording(): Promise<void> {
        this.connection.isRecording = false;
        this.clearRealtimeTranscription();
        this.audioBuffer = [];

        this.sendMessage({
            type: 'recording_cancelled',
            data: { message: 'Recording cancelled by user' },
            timestamp: new Date().toISOString()
        });

        logger.info(`❌ Recording cancelled: ${this.connection.id}`);
    }

    private async handleAudioChunk(audioData: string): Promise<void> {
        try {
            if (!this.connection.isRecording) {
                return;
            }

            // Convert base64 to buffer
            const audioBuffer = Buffer.from(audioData, 'base64');
            this.audioBuffer.push(audioBuffer);

            // Send acknowledgment with enhanced info
            this.sendMessage({
                type: 'chunk_received',
                data: {
                    chunkSize: audioBuffer.length,
                    totalChunks: this.audioBuffer.length,
                    totalSize: this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0),
                    quality: this.assessAudioQuality(audioBuffer)
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            logger.error('Error handling audio chunk:', error);
        }
    }

    private async handleBinaryAudio(binaryData: Buffer): Promise<void> {
        if (!this.connection.isRecording) return;

        this.audioBuffer.push(binaryData);

        this.sendMessage({
            type: 'binary_audio_received',
            data: {
                size: binaryData.length,
                totalSize: this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0)
            },
            timestamp: new Date().toISOString()
        });
    }

    private async processWithGemini(audioBuffer: Buffer, duration: number): Promise<void> {
        try {
            this.sendMessage({
                type: 'processing_started',
                data: {
                    message: '🤖 Processing with Google Gemini AI...',
                    estimatedTime: '3-8 seconds',
                    steps: ['transcription', 'enhancement', 'intent_detection']
                },
                timestamp: new Date().toISOString()
            });

            // Step 1: Transcription with Gemini
            const transcriptionResult = await this.connection.geminiService.transcribeAudio(
                audioBuffer,
                {
                    language: this.connection.language,
                    mimeType: 'audio/webm'
                }
            );

            // Send transcription result
            this.sendMessage({
                type: 'transcription_complete',
                data: {
                    text: transcriptionResult.text,
                    confidence: transcriptionResult.confidence,
                    language: transcriptionResult.language,
                    processingTime: transcriptionResult.processingTime,
                    detectedLanguage: transcriptionResult.language
                },
                timestamp: new Date().toISOString()
            });

            // Step 2: Language detection (if auto-detect enabled)
            const detectedLanguage = await this.connection.geminiService.detectLanguage(transcriptionResult.text);
            if (detectedLanguage !== this.connection.language) {
                this.sendMessage({
                    type: 'language_detected',
                    data: {
                        detected: detectedLanguage,
                        current: this.connection.language,
                        suggestion: `Detected ${detectedLanguage}, switch language?`
                    },
                    timestamp: new Date().toISOString()
                });
            }

            // Step 3: Enhancement and intent detection
            const enhancedResult = await this.connection.geminiService.enhanceTranscription(
                transcriptionResult.text,
                this.connection.language
            );

            // Send final enhanced result
            this.sendMessage({
                type: 'enhancement_complete',
                data: {
                    original: transcriptionResult.text,
                    enhanced: enhancedResult,
                    audioMetadata: {
                        duration: Math.round(duration / 1000),
                        size: audioBuffer.length,
                        quality: this.assessAudioQuality(audioBuffer),
                        language: this.connection.language
                    }
                },
                timestamp: new Date().toISOString()
            });

            // Step 4: Create todo if intent is detected
            if (enhancedResult.intent.action === 'create_todo' && enhancedResult.intent.confidence > 0.6) {
                await this.createTodoFromIntent(enhancedResult);
            } else {
                this.sendMessage({
                    type: 'intent_unclear',
                    data: {
                        message: 'Intent not clear enough for automatic todo creation',
                        suggestion: 'Try phrases like "Add task", "Create todo", or "Remind me to..."',
                        confidence: enhancedResult.intent.confidence
                    },
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            logger.error('❌ Gemini processing failed:', error);
            this.sendError(`AI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async createTodoFromIntent(enhancedResult: any): Promise<void> {
        try {
            // Simulate todo creation (you'll replace this with real database operations)
            await new Promise(resolve => setTimeout(resolve, 1000));

            const todo = {
                id: `todo_${Date.now()}`,
                title: enhancedResult.cleaned_text,
                priority: enhancedResult.priority,
                due_date: enhancedResult.due_date,
                tags: enhancedResult.tags,
                project: enhancedResult.project,
                estimated_duration: enhancedResult.estimated_duration,
                status: 'created',
                created_by: 'voice',
                ai_confidence: enhancedResult.confidence,
                createdAt: new Date().toISOString()
            };

            this.sendMessage({
                type: 'todo_created',
                data: {
                    message: `✅ Todo created: "${enhancedResult.cleaned_text}"`,
                    todo,
                    suggestions: [
                        { type: 'view_notion', label: 'View in Notion', url: '#' },
                        { type: 'edit_todo', label: 'Edit Details', id: todo.id },
                        { type: 'add_reminder', label: 'Set Reminder', id: todo.id }
                    ],
                    aiInsights: {
                        confidence: enhancedResult.confidence,
                        detected_intent: enhancedResult.intent.action,
                        priority_reasoning: `Set to ${enhancedResult.priority} based on voice analysis`
                    }
                },
                timestamp: new Date().toISOString()
            });

            logger.info(`✅ Todo created from voice: "${enhancedResult.cleaned_text}"`);

        } catch (error) {
            logger.error('Error creating todo:', error);
            this.sendError('Failed to create todo');
        }
    }

    private startRealtimeTranscription(): void {
        // Real-time transcription every 3 seconds during recording
        this.realtimeTranscriptionTimer = setInterval(async () => {
            if (!this.connection.isRecording || this.isProcessing || this.audioBuffer.length < 10) {
                return;
            }

            try {
                this.isProcessing = true;

                // Get recent audio chunks for real-time processing
                const recentChunks = this.audioBuffer.slice(-15); // Last 15 chunks
                const audioSegment = Buffer.concat(recentChunks);

                if (audioSegment.length < 1000) return; // Skip if too small

                // Quick transcription for real-time feedback
                const result = await this.connection.geminiService.transcribeAudio(
                    audioSegment,
                    {
                        language: this.connection.language,
                        mimeType: 'audio/webm'
                    }
                );

                this.sendMessage({
                    type: 'realtime_transcript',
                    data: {
                        text: result.text,
                        confidence: result.confidence,
                        isPartial: true,
                        timestamp: new Date().toISOString()
                    },
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                logger.error('Real-time transcription error:', error);
            } finally {
                this.isProcessing = false;
            }
        }, 3000);
    }

    private clearRealtimeTranscription(): void {
        if (this.realtimeTranscriptionTimer) {
            clearInterval(this.realtimeTranscriptionTimer);
            this.realtimeTranscriptionTimer = undefined;
        }
    }

    private async setLanguage(language: LanguageCode): Promise<void> {
        this.connection.language = language;

        this.sendMessage({
            type: 'language_changed',
            data: {
                language: language,
                message: `Language changed to ${language}`,
                aiModel: 'gemini-1.5-flash-flash'
            },
            timestamp: new Date().toISOString()
        });

        logger.info(`🌍 Language changed to ${language} for connection: ${this.connection.id}`);
    }

    private assessAudioQuality(audioBuffer: Buffer): 'excellent' | 'good' | 'fair' | 'poor' {
        const size = audioBuffer.length;

        if (size > 10000) return 'excellent';
        if (size > 5000) return 'good';
        if (size > 1000) return 'fair';
        return 'poor';
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
                timestamp: new Date().toISOString(),
                connectionId: this.connection.id
            },
            timestamp: new Date().toISOString()
        });
    }

    private handleClose(): void {
        this.clearRealtimeTranscription();
        logger.info(`🔌 Enhanced WebSocket connection closed: ${this.connection.id}`);
    }

    private handleError(error: Error): void {
        logger.error(`WebSocket error for connection ${this.connection.id}:`, error);
        this.clearRealtimeTranscription();
    }

    private handlePong(): void {
        this.connection.lastActivity = new Date();
    }

    // Public methods
    public getConnectionInfo(): VoiceConnection {
        return { ...this.connection };
    }

    public cleanup(): void {
        this.clearRealtimeTranscription();
        this.audioBuffer = [];
        this.isProcessing = false;
        this.connection.isRecording = false;
    }

    public async healthCheck(): Promise<{ status: string; features: string[] }> {
        try {
            const geminiHealth = await this.connection.geminiService.healthCheck();

            return {
                status: geminiHealth.status,
                features: [
                    'real_time_transcription',
                    'intent_detection',
                    'multi_language_support',
                    'voice_enhancement',
                    'gemini_ai'
                ]
            };
        } catch (error) {
            return {
                status: 'error',
                features: []
            };
        }
    }
}