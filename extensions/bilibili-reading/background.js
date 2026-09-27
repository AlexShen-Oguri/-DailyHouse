const BASE = 'http://127.0.0.1:3456/api/reading-bridge';
const HISTORY = 'https://www.bilibili.com/history';
const ALARM = 'dailyhouse-manual-reading';
let polling = false;
async function api(path, body = {}) {
  const response = await fetch(BASE + path, { method: 'POST', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-DailyHouse-Extension': chrome.runtime.id }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`bridge:${response.status}`);
  return response.json();
}
async function active() { return (await chrome.storage.session.get('active')).active; }
async function clearActive(id) { if ((await active())?.id === id) await chrome.storage.session.remove('active'); }
async function ensureAlarm() { if (!await chrome.alarms.get(ALARM)) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 }); }
async function poll() {
  if (polling) return;
  polling = true;
  let claimed;
  try {
    const response = await api('/poll');
    if (!response.job) return;
    claimed = await api(`/${response.job.id}/claim`);
    // Bilibili defers loading further history while its tab is hidden. Use a
    // separate visible tab without replacing the user's filters or video page.
    const tab = await chrome.tabs.create({ url: HISTORY, active: true });
    // An active tab does not focus its browser window. Bring this user-requested
    // history page forward once; restore only a minimized window's state.
    const window = await chrome.windows.get(tab.windowId);
    const focused = await chrome.windows.update(tab.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) });
    if (!focused.focused) throw new Error('history window could not be focused');
    await chrome.storage.session.set({ active: { id: claimed.job.id, job: claimed.job, token: claimed.token, tabId: tab.id } });
    // Handles the small race where document_idle occurred before storage was saved.
    await chrome.tabs.sendMessage(tab.id, { type: 'start', job: claimed.job }).catch(() => {});
  } catch {
    // Once claimed, tab/storage failure is actionable; do not leave the user
    // waiting for a lease timeout. A disconnected backend still expires safely.
    if (claimed?.job?.id) {
      await api(`/${claimed.job.id}/fail`, { token: claimed.token, issue: 'page_unavailable' }).catch(() => {});
      await clearActive(claimed.job.id).catch(() => {});
    }
  }
  finally { polling = false; }
}
function historySender(sender, current) {
  try { const url = new URL(sender.url); return sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab?.id === current?.tabId && url.origin === 'https://www.bilibili.com' && /^\/history\/?$/.test(url.pathname); } catch { return false; }
}
async function message(message, sender) {
  const current = await active();
  if (!message || typeof message !== 'object' || !historySender(sender, current)) return { stop: true };
  if (message.type === 'ready') return { job: current.job };
  if (message.id !== current.id || !['progress', 'submit', 'fail'].includes(message.type)) return { stop: true };
  try {
    const body = { token: current.token };
    if (message.type === 'progress') body.scanned = message.scanned;
    if (message.type === 'submit') Object.assign(body, { items: message.items, coverage: message.coverage, scanned: message.scanned });
    if (message.type === 'fail') body.issue = message.issue;
    await api(`/${current.id}/${message.type}`, body);
    if (message.type !== 'progress') await clearActive(current.id);
    return { ok: true };
  } catch (error) {
    if (/bridge:(403|404|409|410)/.test(error.message)) { await clearActive(current.id); return { stop: true }; }
    return { stop: true, unavailable: true };
  }
}
chrome.runtime.onMessage.addListener((value, sender, respond) => { void message(value, sender).then(respond, () => respond({ stop: true })); return true; });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void poll(); });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm().then(poll); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().then(poll); });
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: 'http://127.0.0.1:3456/#/reading' }); void poll(); });
void ensureAlarm();
