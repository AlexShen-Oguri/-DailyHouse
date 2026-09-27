export interface PersonalTodo {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  dueDate: string | null;
}

export type IdeaStatus = 'growing' | 'parked' | 'done';
export type IdeaEntryKind = 'initial' | 'note' | 'progress' | 'decision' | 'question';

export interface IdeaEntry {
  id: string;
  kind: IdeaEntryKind;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Idea {
  id: string;
  title: string;
  status: IdeaStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
  entries: IdeaEntry[];
}

export interface IdeaSummary extends Omit<Idea, 'entries'> {
  preview: string;
  entryCount: number;
}

export interface IdeaTrashEntry {
  idea: Idea;
  deletedAt: string;
  expiresAt: string;
}

export interface PersonalSettings {
  vaultPath: string;
  calendarFile: string;
  calendarUrl: string;
  animationEnabled: boolean;
  readingTechPath: string;
  readingAestheticPath: string;
}

export type ReadingType = 'book' | 'video' | 'course' | 'tutorial' | 'github' | 'article';
export type ReadingStatus = 'unread' | 'reading' | 'done';
export type ReadingCategory = 'programming_ai' | 'technology' | 'design' | 'science' | 'humanities' | 'language' | 'business' | 'career' | 'life' | 'other';
export type ReportSourceId = 'tech' | 'aesthetic';

export interface ReadingItem {
  id: string;
  title: string;
  type: ReadingType;
  url: string;
  notes: string;
  status: ReadingStatus;
  category: ReadingCategory;
  finishedAt?: string;
  sourceKey?: string;
  importBatchId?: string;
  addedAt: string;
  updatedAt: string;
  origin: 'manual' | 'report';
  reportSource?: ReportSourceId;
  reportDate?: string;
  coverageDate?: string;
  updatedSinceRead?: boolean;
  pdfUrl?: string;
  coverUrl?: string;
  coverCheckedAt?: string;
}

export interface ReportReadingState {
  status: ReadingStatus;
  lastReadVersion: string | null;
  hidden?: boolean;
  category?: ReadingCategory;
  finishedAt?: string;
}

export interface ReadingTrashEntry {
  item: ReadingItem;
  deletedAt: string;
  expiresAt: string;
  batchId: string;
  reportState?: ReportReadingState;
}

export interface ReadingImportCounts {
  total: number;
  accepted: number;
  excluded: number;
  review: number;
  duplicates: number;
  suppressed: number;
}

export interface ReadingImportCandidate {
  index: number;
  title: string;
  url: string;
  notes: string;
  coverUrl?: string;
  viewedAt: string;
  progress: number | null;
  sourceKey: string;
  category: ReadingCategory;
  reason: string;
  decision: 'import' | 'duplicate' | 'suppressed' | 'excluded' | 'review';
}

export interface ReadingImportBatch {
  id: string;
  createdAt: string;
  coverage?: { from: string; to: string; complete: boolean };
  counts: ReadingImportCounts;
  addedCount: number;
  duplicateCount: number;
  excludedCount: number;
  reviewCount: number;
  suppressedCount: number;
  itemIds: string[];
  candidates: ReadingImportCandidate[];
  canUndo: boolean;
  undoneAt?: string;
  undoResult?: { removedCount: number; conflictCount: number; skippedCount: number };
}

export interface ReadingRemovalResult {
  removedIds: string[];
}

export interface ReadingSource {
  id: ReportSourceId;
  label: string;
  path: string;
  status: 'ready' | 'missing' | 'error';
  count: number;
  message: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
}

export interface CalendarState {
  status: 'unconfigured' | 'ready' | 'error';
  events: CalendarEvent[];
  updatedAt: string | null;
  message: string;
  provider?: 'file' | 'google' | 'apple';
  range?: { from: string; to: string; days: number };
}

export class PersonalError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
