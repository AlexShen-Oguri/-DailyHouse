import { readFileSync } from 'node:fs';
import ical, { type DateWithTimeZone, type ParameterValue } from 'node-ical';
import { verifyCalendarFile } from './files';
import { PersonalError, type CalendarEvent, type PersonalSettings } from './types';

export function validateCalendarUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new PersonalError('日历订阅地址无效');
  if (!value.trim()) return '';
  try {
    const url = new URL(value.trim().replace(/^webcal:/i, 'https:'));
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !(url.hostname === 'icloud.com' || url.hostname.endsWith('.icloud.com'))) throw new Error();
    url.hash = '';
    return url.toString();
  } catch {
    throw new PersonalError('请填写你已有的 iCloud HTTPS / webcal 日历订阅地址；也可以使用本机 .ics 文件');
  }
}

function label(value: ParameterValue | undefined): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'val' in value) return String(value.val);
  return '';
}

function calendarDay(date: DateWithTimeZone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: date.tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(part => parts.find(value => value.type === part)?.value).join('-');
}

export async function parseCalendarEvents(body: string, now = new Date()): Promise<CalendarEvent[]> {
  if (Buffer.byteLength(body) > 2 * 1024 * 1024 || !body.includes('BEGIN:VCALENDAR') || !body.includes('END:VCALENDAR')) throw new PersonalError('日历内容无效或超过 2 MB');
  // Sub-hourly recurrence feeds are not useful for a personal agenda and could
  // expand millions of entries before the result limit can be applied.
  if (/^RRULE[^\r\n]*FREQ=(?:SECONDLY|MINUTELY)/im.test(body.replace(/\r?\n[ \t]/g, ''))) throw new PersonalError('暂不支持按秒或分钟重复的日历事项');
  if ((body.match(/BEGIN:VEVENT/g) || []).length > 2000) throw new PersonalError('单个日历最多支持 2000 个日程定义');
  const parsed = await ical.async.parseICS(body);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 31);
  const events: CalendarEvent[] = [];
  for (const event of Object.values(parsed)) {
    if (event?.type !== 'VEVENT' || !event.start || event.status === 'CANCELLED') continue;
    const instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true });
    for (const instance of instances) {
      if (instance.event.status === 'CANCELLED') continue;
      const start = instance.isFullDay ? calendarDay(instance.start) : instance.start.toISOString();
      const end = instance.isFullDay ? calendarDay(instance.end) : instance.end.toISOString();
      events.push({ id: `${event.uid}:${start}`, title: label(instance.summary).slice(0, 500) || '未命名日程', start, end, allDay: instance.isFullDay, location: label(instance.event.location).slice(0, 500) });
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 1000);
}

async function fetchCalendar(url: string): Promise<string> {
  // Only an explicitly supplied Apple-hosted feed is fetched. Redirects are
  // rejected so a remote feed cannot turn into access to localhost or a LAN.
  const response = await fetch(validateCalendarUrl(url), { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'text/calendar' } });
  if (!response.ok || !response.body) throw new PersonalError('iCloud 日历未能读取，请检查订阅地址是否仍然有效');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 2 * 1024 * 1024) throw new PersonalError('日历内容超过 2 MB');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function loadCalendar(settings: PersonalSettings): Promise<CalendarEvent[]> {
  if (settings.calendarFile) {
    verifyCalendarFile(settings.calendarFile);
    return parseCalendarEvents(readFileSync(settings.calendarFile, 'utf8'));
  }
  if (settings.calendarUrl) return parseCalendarEvents(await fetchCalendar(settings.calendarUrl));
  return [];
}
