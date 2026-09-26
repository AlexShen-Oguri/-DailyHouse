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
