import { describe, expect, it } from 'vitest';
import { calendarMonths, eventInMonth } from './calendar-model';
import type { CalendarEvent } from './api';
const event: CalendarEvent = { id: 'fixture', title: 'Conference', start: '2026-11-30', end: '2026-12-02', allDay: true, location: '' };
describe('calendar month navigation', () => {
  it('offers all loaded months, including empty months, across a year boundary', () => {
    expect(calendarMonths([], { from: '2026-09-27T00:00:00', to: '2027-03-26T00:00:00' })).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  });
  it('finds December and cross-month events while respecting exclusive all-day ends', () => {
    expect(eventInMonth(event, '2026-12')).toBe(true);
    expect(eventInMonth(event, '2026-11')).toBe(true);
    expect(eventInMonth(event, '2027-01')).toBe(false);
    expect(eventInMonth({ ...event, end: '2026-12-01' }, '2026-12')).toBe(false);
    expect(eventInMonth(event, '')).toBe(true);
    expect(eventInMonth({ ...event, start: '2026-12-01', end: '2026-12-01' }, '2026-12')).toBe(true);
  });
});
