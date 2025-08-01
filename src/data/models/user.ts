// src/data/models/user.js
import mongoose, { Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { LanguageCode, SubscriptionTier, UserDocument } from '@/types';

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    name: {
        type: String,
        required: true,
        trim: true
    },

    // Notion Integration
    notion_integration: {
        access_token: {
            type: String,
            select: false // Don't return in queries by default
        },
        workspace_id: String,
        default_database_id: String,
        connected_at: Date,
        last_sync: Date
    },

    // Voice Preferences
    voice_preferences: {
        language: {
            type: String,
            default: 'en' as LanguageCode,
            enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'hi', 'ar']
        },
        voice_id: {
            type: String,
            default: undefined
        },
        confidence_threshold: {
            type: Number,
            default: 0.8,
            min: 0.1,
            max: 1.0
        },
        auto_create_todos: {
            type: Boolean,
            default: true
        },
        voice_response_enabled: {
            type: Boolean,
            default: true
        },
        preferred_accent: {
            type: String,
            default: 'neutral'
        }
    },

    // Usage Statistics
    usage_stats: {
        total_todos_created: {
            type: Number,
            default: 0
        },
        voice_minutes_processed: {
            type: Number,
            default: 0
        },
        last_active: Date,
        total_searches: {
            type: Number,
            default: 0
        }
    },

    // User Status
    is_active: {
        type: Boolean,
        default: true
    },  
    email_verified: {
        type: Boolean,
        default: false
    },
    subscription_tier: {
        type: String,
        enum: ['free', 'premium', 'enterprise'] as SubscriptionTier[],
        default: 'free' as SubscriptionTier
    }
}, {
    timestamps: true,
    toJSON: {
        transform: function (_doc, ret) {
            const { password, __v, ...user } = ret;
            return user;
        }
    }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ 'usage_stats.last_active': -1 });
userSchema.index({ createdAt: -1 });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error instanceof Error ? error : new Error('Password hashing failed'));
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

// Update last active
userSchema.methods.updateLastActive = async function (): Promise<UserDocument> {
    this.usage_stats.last_active = new Date();
    return this.save();
};

export const User: Model<UserDocument> = mongoose.model<UserDocument>('User', userSchema);
