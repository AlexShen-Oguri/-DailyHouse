export interface PersonalTodo {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  dueDate: string | null;
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
export type ReportSourceId = 'tech' | 'aesthetic';

export interface ReadingItem {
  id: string;
  title: string;
  type: ReadingType;
  url: string;
  notes: string;
  status: ReadingStatus;
  addedAt: string;
  updatedAt: string;
  origin: 'manual' | 'report';
  reportSource?: ReportSourceId;
  reportDate?: string;
  coverageDate?: string;
  updatedSinceRead?: boolean;
  pdfUrl?: string;
}

export interface ReportReadingState {
  status: ReadingStatus;
  lastReadVersion: string | null;
  hidden?: boolean;
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

export interface DesktopFile {
  id: string;
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  modifiedAt: string;
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
}

export class PersonalError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
