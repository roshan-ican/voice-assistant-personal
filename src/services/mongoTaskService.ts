// src/services/taskService.ts
import { Task, TaskDoc } from '@/schema/tasks';
import { toISODate, tomorrowISO } from '@/utils/helpers';

export class TaskService {
  async createTask(input: {
    title: string; notes?: string; priority?: TaskDoc['priority'];
    planDate?: string; dueDate?: string; project?: string; area?: string; userId?: string;
  }) {
    const doc = await Task.create({
      title: input.title.trim(),
      notes: input.notes,
      priority: input.priority ?? 'medium',
      status: 'pending',
      planDate: input.planDate ?? toISODate(),
      dueDate: input.dueDate,
      project: input.project,
      area: input.area,
      userId: input.userId
    });
    return doc.toObject();
  }

  async updateTask(id: string, patch: Partial<Pick<TaskDoc,
    'title' | 'notes' | 'priority' | 'status' | 'planDate' | 'dueDate' | 'project' | 'area' | 'archived'
  >>) {
    const doc = await Task.findByIdAndUpdate(
      id,
      { $set: patch },
      { new: true, runValidators: true }
    ).lean<TaskDoc | null>();
    return doc;
  }

  async setStatus(id: string, status: TaskDoc['status']) {
    return this.updateTask(id, { status });
  }

  async skipTask(id: string) {
    return this.updateTask(id, { status: 'skipped', planDate: tomorrowISO() });
  }

  async listByDate(date = toISODate(), userId?: string) {
    const q: any = { planDate: date, archived: { $ne: true } };
    if (userId) q.userId = userId;

    const tasks = await Task.find(q).sort({ priority: 1, createdAt: 1 }).lean<TaskDoc[]>();
    const stats = tasks.reduce(
      (a, t) => ({ ...a, total: a.total + 1, [t.status]: (a as any)[t.status] + 1 }),
      { total: 0, pending: 0, in_progress: 0, done: 0, skipped: 0 }
    );
    return { date, tasks, stats };
  }

  // move all not-done older than today to today
  async rolloverToToday(userId?: string) {
    const today = toISODate();
    const q: any = {
      planDate: { $lt: today },
      status: { $in: ['pending', 'in_progress', 'skipped'] },
      archived: { $ne: true }
    };
    if (userId) q.userId = userId;

    const res = await Task.updateMany(q, {
      $set: { planDate: today },
      $inc: { rolloverCount: 1 },
      $currentDate: { lastRolledOverAt: true }
    });
    return res.modifiedCount;
  }
}