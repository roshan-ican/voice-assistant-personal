// src/models/Task.ts
import mongoose, { Schema, InferSchemaType, model } from 'mongoose';

export const TaskStatus = ['pending', 'in_progress', 'done', 'skipped'] as const;
export const TaskPriority = ['low', 'medium', 'high'] as const;

const TaskSchema = new Schema(
  {
    userId: { type: String, index: true }, // keep for future multi-user
    title: { type: String, required: true, trim: true },
    notes: { type: String },

    status: { type: String, enum: TaskStatus, default: 'pending', index: true },
    priority: { type: String, enum: TaskPriority, default: 'medium', index: true },

    planDate: { type: String, required: true, index: true }, // 'YYYY-MM-DD' bucket
    dueDate: { type: String }, // optional deadline

    project: { type: String },
    area: { type: String },

    rolloverCount: { type: Number, default: 0 },
    lastRolledOverAt: { type: Date },

    archived: { type: Boolean, default: false, index: true }
  },
  { timestamps: true } // createdAt / updatedAt
);

// helpful compound indexes
TaskSchema.index({ userId: 1, planDate: 1, status: 1 });
TaskSchema.index({ planDate: 1, priority: 1, createdAt: -1 });

export type TaskDoc = InferSchemaType<typeof TaskSchema>;
export const Task = model<TaskDoc>('Task', TaskSchema);