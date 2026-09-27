/* Pure parsing plus visible DOM extraction. No cookies, storage or site APIs. */
(() => {
  const clock = value => {
    if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(value)) return null;
    const parts = value.split(':').map(Number);
    if (parts.slice(1).some(n => n > 59)) return null;
    return parts.reduce((total, n) => total * 60 + n, 0);
  };
  function progress(text) {
    if (/已看完/.test(text)) return 1;
    const pair = text.match(/(?:^|[^\d:])(\d{1,3}:\d{2}(?::\d{2})?)\s*\/\s*(\d{1,3}:\d{2}(?::\d{2})?)(?![\d:])/);
    if (!pair) return null;
    const played = clock(pair[1]), duration = clock(pair[2]);
    return played !== null && duration > 0 && played <= duration ? played / duration : null;
  }
  function viewedAt(text, now = new Date()) {
    const clean = text.replace(/\s+/g, '');
    const time = clean.match(/(\d{1,2}):(\d{2})$/);
    if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
    const date = clean.slice(0, time.index);
    let day = new Date(now);
    if (date === '今天' || date === '昨天' || date === '前天') {
      day.setDate(day.getDate() - (date === '昨天' ? 1 : date === '前天' ? 2 : 0));
    } else {
      const match = date.match(/^(?:(\d{4})[-年/.])?(\d{1,2})[-月/.](\d{1,2})日?$/);
      if (!match) return null;
      const month = Number(match[2]), d = Number(match[3]);
      let year = match[1] ? Number(match[1]) : now.getFullYear();
      if (!match[1] && new Date(year, month - 1, d) > now) year--;
      day = new Date(year, month - 1, d);
      if (day.getFullYear() !== year || day.getMonth() !== month - 1 || day.getDate() !== d) return null;
    }
    day.setHours(Number(time[1]), Number(time[2]), 0, 0);
    return day.getTime() <= now.getTime() + 60000 ? day.toISOString() : null;
  }
  function canonical(value) {
    try {
      const url = new URL(value, 'https://www.bilibili.com');
      const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/);
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'www.bilibili.com' || url.username || url.password || !match) return null;
      const part = url.searchParams.get('p');
      return `https://www.bilibili.com/video/${match[1]}/${part && /^[1-9]\d*$/.test(part) ? `?p=${part}` : ''}`;
    } catch { return null; }
  }
  function readCards(document, now = new Date()) {
    const rows = [];
    for (const card of document.querySelectorAll('.history-card')) {
      // Only real, rendered cards. Templates/hidden search alternatives are not evidence.
      if (!card.getClientRects().length) continue;
      const title = card.querySelector('.bili-video-card__title a');
      const url = canonical(title?.getAttribute('href') || '');
      if (!url) continue;
      const timeText = card.querySelector('.bili-video-card__corner')?.innerText?.trim() || '';
      const position = card.querySelector('.bili-cover-card__stats')?.innerText?.trim() || '';
      const cover = card.querySelector('.bili-cover-card__thumbnail img')?.getAttribute('src') || '';
      let coverUrl;
      try { const u = new URL(cover, 'https://www.bilibili.com'); if (u.protocol === 'https:' && /(^|\.)hdslb\.com$/.test(u.hostname)) coverUrl = u.href; } catch { /* Optional cover. */ }
      rows.push({ title: title.innerText.trim().slice(0, 300), url, viewedAt: viewedAt(timeText, now), progress: progress(position), notes: `B站历史页显示：${timeText}；${position || '播放进度未知'}。多 P 视频进度仅代表当前分集。`, ...(coverUrl ? { coverUrl } : {}) });
    }
    return rows;
  }
  globalThis.DailyHouseHistory = Object.freeze({ progress, viewedAt, canonical, readCards });
})();
