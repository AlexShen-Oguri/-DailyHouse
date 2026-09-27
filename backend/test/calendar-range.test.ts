import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_DAYS, calendarProvider, calendarRange, parseCalendarEvents, validateCalendarUrl } from '../src/personal/calendar';

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//DailyHouse//EN\r\n${events}\r\nEND:VCALENDAR`;
const event = (id: string, start: string, end: string, rule = '') => `BEGIN:VEVENT\r\nUID:${id}\r\nDTSTAMP:20260901T000000Z\r\nDTSTART:${start}\r\nDTEND:${end}\r\n${rule ? `RRULE:${rule}\r\n` : ''}SUMMARY:Fixture lesson\r\nEND:VEVENT`;
afterEach(() => vi.useRealTimers());

describe('semester calendar loading', () => {
  it('includes December and January events instead of silently stopping after 31 days', async () => {
    const now = new Date('2026-09-27T12:00:00Z');
    const events = await parseCalendarEvents(calendar([
      event('december', '20261215T140000Z', '20261215T150000Z'),
      event('january', '20270122T140000Z', '20270122T150000Z'),
      event('too-far', '20270501T140000Z', '20270501T150000Z'),
    ].join('\r\n')), now);
    expect(events.map(value => value.start.slice(0, 10))).toEqual(['2026-12-15', '2027-01-22']);
    expect(CALENDAR_DAYS).toBe(180);
    expect(calendarRange(now).from.getHours()).toBe(0);
  });

  it('expands a semester recurrence through its actual end date', async () => {
    const body = calendar(event('weekly', '20260901T140000Z', '20260901T150000Z', 'FREQ=WEEKLY;UNTIL=20261215T235959Z'));
    const events = await parseCalendarEvents(body, new Date('2026-09-27T12:00:00Z'));
    expect(events.at(-1)?.start).toBe('2026-12-15T14:00:00.000Z');
    expect(events.some(value => value.start.startsWith('2026-11'))).toBe(true);
  });

  it('does not silently truncate a busy semester to the first thousand events', async () => {
    const events = await parseCalendarEvents(calendar(Array.from({ length: 8 }, (_, index) => event(`daily-${index}`, '20260927T140000Z', '20260927T150000Z', 'FREQ=DAILY;COUNT=150')).join('\r\n')), new Date('2026-09-27T12:00:00Z'));
    expect(events).toHaveLength(1200);
    expect(events.at(-1)?.start.startsWith('2027-02')).toBe(true);
  });

  it('accepts Google iCal feeds and preserves Apple subscriptions without permitting arbitrary targets', () => {
    const google = 'https://calendar.google.com/calendar/ical/example%40gmail.com/private-fixture-token/basic.ics';
    expect(validateCalendarUrl(google)).toBe(google);
    expect(validateCalendarUrl(google.replace('private-fixture-token', 'public'))).toContain('/public/basic.ics');
    expect(calendarProvider({ calendarFile: '', calendarUrl: google })).toBe('google');
    expect(calendarProvider({ calendarFile: 'C:\\fixtures\\calendar.ics', calendarUrl: '' })).toBe('file');
    expect(validateCalendarUrl('webcal://p01-caldav.icloud.com/published/2/test')).toMatch(/^https:/);
    for (const url of [google.replace('calendar.google.com', 'calendar.google.com.evil.example'), google.replace('https:', 'http:'), google.replace('calendar.google.com', 'calendar.google.com:444'), google.replace('calendar.google.com', 'user:pass@calendar.google.com'), 'https://calendar.google.com/calendar/u/0/r', 'https://google.com/calendar/ical/test/public/basic.ics']) expect(() => validateCalendarUrl(url)).toThrow();
  });
});
