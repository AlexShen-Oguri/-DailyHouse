(() => {
  if (location.origin !== 'https://www.bilibili.com' || !/^\/history\/?$/.test(location.pathname)) return;
  let running = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const send = message => chrome.runtime.sendMessage(message);
  async function collect(job) {
    if (running) return;
    running = true;
    const records = new Map();
    const uncertainSources = new Set();
    let stopped = false, unknownDate = false, complete = false, errorCode = '', oldest = null;
    const now = new Date(job.to), pageDate = new Date(), cutoff = Date.parse(job.from), started = Date.now();
    const heartbeat = setInterval(() => { void send({ type: 'progress', id: job.id, scanned: records.size }).then(reply => { if (reply?.stop) stopped = true; }).catch(() => { stopped = true; }); }, 10000);
    try {
      let lastCount = 0, stalls = 0;
      // The normal page does its own loading; no private history API is called.
      while (!stopped && Date.now() - started < 180000 && records.size < 1000) {
        const rows = DailyHouseHistory.readCards(document, pageDate);
        for (const row of rows) {
          const source = row.url.split('?')[0];
          // Without a reliable time, an older same-video row must not stand in
          // for what may be the latest viewing. Keep that source out this run.
          if (!row.viewedAt) { unknownDate = true; uncertainSources.add(source); records.delete(source); continue; }
          const timestamp = Date.parse(row.viewedAt);
          if (timestamp > now.getTime()) { uncertainSources.add(source); records.delete(source); continue; }
          if (oldest === null || timestamp < oldest) oldest = timestamp;
          if (timestamp < cutoff) { complete = !unknownDate; continue; }
          if (uncertainSources.has(source)) continue;
          const previous = records.get(source);
          // Newest evidence wins; equal minute timestamps keep the first visible row.
          if (!previous || timestamp > Date.parse(previous.viewedAt)) records.set(source, row);
        }
        const text = document.body.innerText;
        if (!rows.length && /登录后(?:可)?查看|登录后.*历史|登录查看/.test(text)) { errorCode = 'needs_login'; break; }
        if (oldest !== null && oldest < cutoff) break;
        const end = document.querySelector('.history-end')?.innerText?.trim() || '';
        if (/没有更多|到底了|全部加载|已加载全部/.test(end)) { complete = !unknownDate; break; }
        if (!rows.length && !unknownDate && /暂无历史|还没有历史|没有历史记录/.test(text)) { complete = true; break; }
        const count = document.querySelectorAll('.history-card').length;
        stalls = count === lastCount ? stalls + 1 : 0; lastCount = count;
        if (stalls >= 6) { errorCode = records.size ? '' : 'unsupported_page'; break; }
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        await sleep(2000);
      }
      if (stopped) return;
      if (records.size >= 1000) complete = false;
      if (unknownDate && !records.size) errorCode = 'unsupported_page';
      if (errorCode) await send({ type: 'fail', id: job.id, issue: errorCode });
      else {
        const items = [...records.values()].sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt)).slice(0, 1000);
        // Partial coverage begins at the oldest actually observed in-window card.
        const from = complete ? job.from : items.at(-1)?.viewedAt || job.to;
        await send({ type: 'submit', id: job.id, items, scanned: items.length, coverage: { from, to: job.to, complete } });
      }
    } catch { if (!stopped) await send({ type: 'fail', id: job.id, issue: 'read_failed' }).catch(() => {}); }
    finally { clearInterval(heartbeat); running = false; }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== 'start' || !message.job) return;
    respond({ started: !running }); void collect(message.job);
  });
  void send({ type: 'ready' }).then(reply => { if (reply?.job) void collect(reply.job); }).catch(() => {});
})();
