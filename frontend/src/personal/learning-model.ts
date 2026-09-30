export type LearningStatus = 'active' | 'paused' | 'done';
export type LearningKind = 'initial' | 'progress' | 'question' | 'milestone' | 'resource';
export type LearningLink = { id: string; title: string; url: string };
export type LearningEntry = { id: string; kind: LearningKind; content: string; links: LearningLink[]; nextStep: string; nextStepId: string; createdAt: string; updatedAt: string; removedAt?: string; expiresAt?: string };
export type LearningPlan = { id: string; title: string; course: string; goal: string; nextStep: string; nextStepId: string; dueDate: string | null; status: LearningStatus; createdAt: string; updatedAt: string; revision: number; entries: LearningEntry[]; removedEntries: LearningEntry[] };
export type LearningSummary = Omit<LearningPlan, 'entries' | 'removedEntries'> & { entryCount: number; preview: string };
export type LearningRemoved = LearningSummary & { removedAt: string; expiresAt: string };
