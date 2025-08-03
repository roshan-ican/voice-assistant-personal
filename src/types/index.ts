// src/types/index.ts
import { Document, ObjectId } from 'mongoose';

// User Types
export interface IUser {
    _id: string | ObjectId;
    email: string;
    password: string;
    name: string;
    notion_integration: {
        access_token?: string;
        workspace_id?: string;
        default_database_id?: string;
        connected_at?: Date;
        last_sync?: Date;
    };
    voice_preferences: {
        language: LanguageCode;
        voice_id?: string;
        confidence_threshold: number;
        auto_create_todos: boolean;
        voice_response_enabled: boolean;
        preferred_accent: string;
    };
    usage_stats: {
        total_todos_created: number;
        voice_minutes_processed: number;
        last_active?: Date;
        total_searches: number;
    };
    is_active: boolean;
    email_verified: boolean;
    subscription_tier: SubscriptionTier;
    createdAt: Date;
    updatedAt: Date;
}

export interface IUserMethods {
    comparePassword(candidatePassword: string): Promise<boolean>;
    updateLastActive(): Promise<IUser>;
}

// Todo Types
export interface ITodo {
    _id: string | ObjectId;
    user_id: ObjectId | string;
    content: {
        original_transcript: string;
        cleaned_text: string;
        confidence_score?: number;
        detected_language: string;
        translated_content: Map<string, string>;
    };
    audio_metadata: {
        duration?: number;
        file_path?: string;
        file_size?: number;
        processing_time?: number;
        language_detected?: string;
        voice_response_generated: boolean;
        elevenlabs_audio_url?: string;
        audio_format: AudioFormat;
    };
    notion_data: {
        page_id?: string;
        page_url?: string;
        database_id?: string;
        created_time?: Date;
        last_edited_time?: Date;
        sync_status: SyncStatus;
    };
    embedding: {
        pinecone_id?: string;
        vector_generated: boolean;
        embedding_model: string;
        language_context?: string;
        embedding_dimensions: number;
    };
    title: string;
    description?: string;
    priority: Priority;
    status: TodoStatus;
    due_date?: Date;
    completed_at?: Date;
    tags: string[];
    context: {
        location?: string;
        time_context?: string;
        related_todos: ObjectId[];
        project?: string;
        estimated_duration?: number;
        actual_duration?: number;
    };
    processing_status: {
        voice_processed: boolean;
        notion_created: boolean;
        embedding_generated: boolean;
        voice_response_sent: boolean;
    };
    createdAt: Date;
    updatedAt: Date;
}

export interface ITodoMethods {
    markCompleted(): Promise<ITodo>;
    getRelatedTodos(limit?: number): Promise<ITodo[]>;
}

// Enums and Union Types
export type LanguageCode =
    | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru'
    | 'ja' | 'ko' | 'zh' | 'hi' | 'ar';

export type SubscriptionTier = 'free' | 'premium' | 'enterprise';

export type AudioFormat = 'wav' | 'mp3' | 'webm' | 'ogg';

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'manual';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type TodoStatus =
    | 'pending' | 'processing' | 'created'
    | 'completed' | 'cancelled' | 'failed';

// API Types
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

// WebSocket Types
export interface WebSocketMessage {
    type: WebSocketMessageType;
    data?: any;
    timestamp: string;
    userId?: string;
}

export type WebSocketMessageType =
    | 'connection'
    | 'audio_chunk'
    | 'start_recording'
    | 'stop_recording'
    | 'partial_transcript'
    | 'final_transcript'
    | 'todo_created'
    | 'processing_started'
    | 'error'
    | 'voice_response'
    | 'set_language'
    | 'ping'
    | 'pong'
    | 'recording_started'
    | 'recording_stopped'
    | 'chunk_received'
    | 'audio_received'
    | 'language_changed'
    | 'cancel_recording'
    | 'recording_cancelled'
    | 'transcription_complete'
    | 'language_detected'
    | 'enhancement_complete'
    | 'intent_unclear'
    | 'realtime_transcript'
    | 'binary_audio_received';

// Queue Job Types
export interface TodoJobData {
    userId: string;
    rawTranscript: string;
    enhancedTodo: EnhancedTodoData;
    websocketId?: string;
    audioMetadata?: AudioMetadata;
}

export interface EmbeddingJobData {
    todoId: string;
    content: string;
    userId: string;
    language?: string;
}

export interface VoiceJobData {
    todoId: string;
    userId: string;
    text: string;
    language: LanguageCode;
    voiceId?: string;
}

export interface EnhancedTodoData {
    cleaned_text: string;
    priority: Priority;
    due_date?: Date;
    tags: string[];
    confidence: number;
    project?: string;
    estimated_duration?: number;
}

export interface AudioMetadata {
    duration: number;
    confidence: number;
    format: AudioFormat;
    size: number;
}

// External API Types
export interface GeminiTranscriptionResult {
    text: string;
    confidence: number;
    language: string;
}

export interface GeminiEmbeddingResult {
    embedding: number[];
    model: string;
    dimensions: number;
}

export interface ElevenLabsVoiceResponse {
    audioUrl: string;
    voiceId: string;
    text: string;
    language: LanguageCode;
}

export interface NotionPageResult {
    id: string;
    url: string;
    database_id: string;
    created_time: string;
    last_edited_time: string;
}

// Configuration Types
export interface AppConfig {
    node_env: string;
    port: number;
    host: string;
    mongodb: {
        uri: string;
    };
    redis: {
        host: string;
        port: number;
        password?: string;
    };
    apis: {
        gemini: string;
        elevenlabs: string;
        notion: string;
        pinecone: {
            apiKey: string;
            environment: string;
            index: string;
        };
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    logging: {
        level: string;
    };
    rateLimit: {
        max: number;
        window: number;
    };
    upload: {
        maxFileSize: number;
        uploadDir: string;
    };
}

// Repository Types
export interface FindTodoOptions {
    status?: TodoStatus;
    priority?: Priority;
    tags?: string[];
    limit?: number;
    skip?: number;
    sortBy?: string;
    sortOrder?: 1 | -1;
}

export interface UserStats {
    total: number;
    completed: number;
    pending: number;
    high_priority: number;
}

// Service Types
export interface SearchResult<T> {
    items: T[];
    total: number;
    query: string;
    processingTime: number;
}

export interface VoiceProcessingResult {
    transcript: string;
    confidence: number;
    language: LanguageCode;
    processingTime: number;
}

// Utility Types
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Database Health Check
export interface DatabaseHealth {
    status: string;
    database?: string;
    host?: string;
    port?: number;
    error?: string;
}

export interface NotionIntegration {
    access_token?: string;
    workspace_id?: string;
    default_database_id?: string;
    connected_at?: Date;
    last_sync?: Date;
}

export interface VoicePreferences {
    language: LanguageCode;
    voice_id?: string;
    confidence_threshold: number;
    auto_create_todos: boolean;
    voice_response_enabled: boolean;
    preferred_accent: string;
}

export interface UsageStats {
    total_todos_created: number;
    voice_minutes_processed: number;
    last_active?: Date;
    total_searches: number;
}

export interface UserDocument extends Document {
    email: string;
    password: string;
    name: string;

    // Notion
    notion_integration?: NotionIntegration;

    // Voice
    voice_preferences: VoicePreferences;

    // Usage
    usage_stats: UsageStats;

    // Status
    is_active: boolean;
    email_verified: boolean;
    subscription_tier: SubscriptionTier;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;

    // Methods
    comparePassword(candidatePassword: string): Promise<boolean>;
    updateLastActive(): Promise<UserDocument>;
}