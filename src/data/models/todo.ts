import mongoose, { Schema, Document, Model } from 'mongoose';
import type {
    ITodo,
    ITodoMethods,
    Priority,
    TodoStatus,
    AudioFormat,
    SyncStatus,
    LanguageCode
} from '@/types/index.js';

type TodoDocument = Document & ITodo & ITodoMethods;

const todoSchema = new Schema<TodoDocument>({
    user_id: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Content & Processing
    content: {
        original_transcript: {
            type: String,
            required: true
        },
        cleaned_text: {
            type: String,
            required: true
        },
        confidence_score: {
            type: Number,
            min: 0,
            max: 1
        },
        detected_language: {
            type: String,
            default: 'en' as LanguageCode
        },
        translated_content: {
            type: Map,
            of: String,
            default: new Map()
        }
    },

    // Audio Metadata
    audio_metadata: {
        duration: Number, // in seconds
        file_path: String,
        file_size: Number, // in bytes
        processing_time: Number, // in milliseconds
        language_detected: String,
        voice_response_generated: {
            type: Boolean,
            default: false
        },
        elevenlabs_audio_url: String,
        audio_format: {
            type: String,
            enum: ['wav', 'mp3', 'webm', 'ogg'] as AudioFormat[],
            default: 'webm' as AudioFormat
        }
    },

    // Notion Integration
    notion_data: {
        page_id: String,
        page_url: String,
        database_id: String,
        created_time: Date,
        last_edited_time: Date,
        sync_status: {
            type: String,
            enum: ['pending', 'synced', 'failed', 'manual'] as SyncStatus[],
            default: 'pending' as SyncStatus
        }
    },

    // Embedding & Search
    embedding: {
        pinecone_id: String,
        vector_generated: {
            type: Boolean,
            default: false
        },
        embedding_model: {
            type: String,
            default: 'text-embedding-004'
        },
        language_context: String,
        embedding_dimensions: {
            type: Number,
            default: 768
        }
    },

    // Todo Properties
    title: {
        type: String,
        required: true,
        maxlength: 200
    },
    description: String,

    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'] as Priority[],
        default: 'medium' as Priority,
        index: true
    },

    status: {
        type: String,
        enum: ['pending', 'processing', 'created', 'completed', 'cancelled', 'failed'] as TodoStatus[],
        default: 'pending' as TodoStatus,
        index: true
    },

    due_date: {
        type: Date,
        index: true
    },

    completed_at: Date,

    tags: [{
        type: String,
        lowercase: true,
        trim: true,
        maxlength: 50
    }],

    // Smart Features
    context: {
        location: String,
        time_context: String, // "morning", "afternoon", "evening"
        related_todos: [{
            type: Schema.Types.ObjectId,
            ref: 'Todo'
        }],
        project: String,
        estimated_duration: Number, // in minutes
        actual_duration: Number // in minutes
    },

    // Processing Status
    processing_status: {
        voice_processed: {
            type: Boolean,
            default: false
        },
        notion_created: {
            type: Boolean,
            default: false
        },
        embedding_generated: {
            type: Boolean,
            default: false
        },
        voice_response_sent: {
            type: Boolean,
            default: false
        }
    }
}, {
    timestamps: true,
    toJSON: {
        transform: function (_doc, ret: any) {
            delete ret.__v;
            return ret;
        }
    }
});

// Compound indexes for common queries
todoSchema.index({ user_id: 1, status: 1 });
todoSchema.index({ user_id: 1, createdAt: -1 });
todoSchema.index({ user_id: 1, due_date: 1 });
todoSchema.index({ user_id: 1, priority: 1 });
todoSchema.index({ user_id: 1, tags: 1 });
todoSchema.index({ 'content.detected_language': 1 });
todoSchema.index({ 'notion_data.sync_status': 1 });

// Text search index
todoSchema.index({
    'content.cleaned_text': 'text',
    'title': 'text',
    'description': 'text',
    'tags': 'text'
});

// Update completion status
todoSchema.methods.markCompleted = async function (): Promise<TodoDocument> {
    this.status = 'completed';
    this.completed_at = new Date();
    return this.save();
};

// Get related todos (placeholder for AI implementation)
todoSchema.methods.getRelatedTodos = async function (limit = 5): Promise<TodoDocument[]> {
    return Todo.find({
        user_id: this.user_id,
        _id: { $ne: this._id },
        tags: { $in: this.tags }
    }).limit(limit);
};

export const Todo: Model<TodoDocument> = mongoose.model<TodoDocument>('Todo', todoSchema);
