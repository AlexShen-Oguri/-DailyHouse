import { localDay, type CalendarEvent } from './api';

export function calendarMonths(events: CalendarEvent[], range?: { from: string; to: string }): string[] {
  if (range) {
    const date = new Date(range.from); date.setDate(1);
    const final = localDay(new Date(new Date(range.to).getTime() - 1)).slice(0, 7);
    const months: string[] = [];
    while (localDay(date).slice(0, 7) <= final && months.length < 12) {
      months.push(localDay(date).slice(0, 7)); date.setMonth(date.getMonth() + 1);
    }
    return months;
  }
  return [...new Set(events.map(event => event.allDay ? event.start.slice(0, 7) : localDay(new Date(event.start)).slice(0, 7)))].sort();
}

export function eventInMonth(event: CalendarEvent, month: string): boolean {
  if (!month) return true;
  const start = event.allDay ? event.start.slice(0, 7) : localDay(new Date(event.start)).slice(0, 7);
  // Calendar end dates are exclusive, including all-day spans.
  const endDate = event.allDay ? new Date(`${event.end}T00:00:00`) : new Date(event.end);
  const startDate = event.allDay ? new Date(`${event.start}T00:00:00`) : new Date(event.start);
  const end = localDay(new Date(Math.max(startDate.getTime(), endDate.getTime() - 1))).slice(0, 7);
  return start <= month && end >= month;
}
