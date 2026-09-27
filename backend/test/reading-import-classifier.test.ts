import { describe, expect, it } from 'vitest';
import { canonicalReadingSource, classifyReading, normalizedImportUrl, parseReadingImport, readingCategory } from '../src/personal/reading-import';

const videoUrl = 'https://www.bilibili.com/video/BV1LitP6GEm5/';
const candidate = (overrides: Record<string, unknown> = {}) => ({ title: 'Python 入门教程', url: videoUrl, viewedAt: '2026-09-26T09:00:00-04:00', progress: 0.1, ...overrides });

describe('explainable reading classification', () => {
  it.each([
    ['Python 数据结构实战', 'programming_ai'], ['A practical guide to React', 'programming_ai'],
    ['C++ 零基础课程', 'programming_ai'], ['Unity 游戏开发教程', 'programming_ai'],
    ['机器学习基础公开课', 'programming_ai'], ['Building AI agents: a tutorial', 'programming_ai'],
    ['Blender 建模入门', 'design'], ['字体排版设计原理', 'design'],
    ['MIT 线性代数公开课', 'science'], ['Physics explained', 'science'],
    ['西方哲学入门课程', 'humanities'], ['音乐理论与乐理基础', 'humanities'],
    ['雅思口语训练方法', 'language'], ['English pronunciation lesson', 'language'],
    ['Excel 办公自动化教程', 'career'], ['Obsidian 知识管理实践', 'career'],
    ['烘焙入门：面包制作步骤', 'life'], ['DIY woodworking tutorial', 'life'],
    ['健身训练基础', 'life'], ['家庭记账与预算入门', 'life'],
    ['宏观经济学基础课程', 'business'], ['Business model workshop', 'business'],
  ])('recognizes broader knowledge and practical content: %s', (title, category) => {
    expect(classifyReading(title)).toMatchObject({ category, decision: 'import' });
  });

  it.each(['AI 又炸了！颠覆设计师工作', 'Blender 作品展示', 'Python', '值得一看', 'AI 工具限时免费领取'])('keeps ambiguous, promotional and showcase entries for review: %s', title => {
    expect(classifyReading(title).decision).toBe('review');
  });

  it.each(['AI 搞笑鬼畜合集', '游戏实况精彩集锦', '明星八卦大盘点'])('excludes clearly entertainment-oriented entries: %s', title => {
    expect(classifyReading(title).decision).toBe('excluded');
  });

  it.each([
    '图一1：13！五万人看瓶子爽喷！我们要创造新的历史！LPL写歌每次只需要写一个队，你哪怕瓦这边真出个蔚蓝边际，你要怎么在一首歌里塞四个队呀',
    '【中立】锐评电竞队伍战胜对手，创造新的历史',
    '无畏契约上海冠军赛：这场比赛如何创造历史',
    'CS2 击杀集锦：创造新的历史',
    'LPL match highlights: history in the making',
  ])('excludes esports spectator titles despite incidental history or how-to words: %s', title => {
    expect(classifyReading(title).decision).toBe('excluded');
  });

  it.each([
    ['无畏契约关卡设计原理：观战地图的空间结构', 'design'],
    ['LPL 比赛历史数据：Python 数据分析教程', 'programming_ai'],
    ['Unity 游戏开发教程：制作电竞观战系统', 'programming_ai'],
    ['无畏契约冠军赛转播的交互设计原理', 'design'],
  ])('keeps actual game-design and technical lessons with esports examples: %s', (title, category) => {
    expect(classifyReading(title)).toMatchObject({ category, decision: 'import' });
  });

  it('does not exclude development or historical subjects from isolated game or competition words', () => {
    expect(classifyReading('一个视频搞懂整个游戏制作流程，架构级拆解梳理，看看那些3A工作室踩过哪些坑。').decision).toBe('review');
    expect(classifyReading('电竞历史').decision).toBe('review');
    expect(classifyReading('体育史公开课：冠军赛的发展历史')).toMatchObject({ category: 'humanities', decision: 'import' });
  });

  it.each([
    ['神器网站合集 推荐六个超酷效果一键生成网站', 'design'],
    ['300个珍藏网站 数字艺术风 用设计塑造现实', 'design'],
    ['完全开源 windows整理工具', 'programming_ai'],
    ['花束的代码', 'programming_ai'],
    ['编程代码示例', 'programming_ai'],
    ['设计网站资源合集', 'design'],
    ['可参考作品集', 'design'],
    ['可参考作品集展示', 'design'],
    ['Open source tools for Python developers', 'programming_ai'],
    ['React code snippets', 'programming_ai'],
  ])('includes useful resources and examples without requiring a teaching keyword: %s', (title, category) => {
    expect(classifyReading(title)).toMatchObject({ category, decision: 'import' });
  });

  it.each(['New keyboard unboxing', '游戏测评：值得买吗', '十款设计师好物推荐', 'Blender 实用设备种草'])('keeps product reviews without educational evidence for review: %s', title => {
    expect(classifyReading(title).decision).toBe('review');
  });

  it.each(['机械键盘开箱：轴体原理拆解', '游戏测评：关卡设计分析', 'Blender 设备种草和电路原理', 'Camera unboxing and engineering analysis'])('includes reviews with explicit analytical or practical knowledge: %s', title => {
    expect(classifyReading(title).decision).toBe('import');
  });

  it('includes technology news while still excluding entertainment', () => {
    expect(classifyReading('AI 最新新闻和开源工具合集')).toMatchObject({ category: 'technology', decision: 'import' });
    expect(classifyReading('代码整活搞笑合集').decision).toBe('excluded');
  });

  it.each(['AI 每日新闻', '最新大模型重磅发布：深度解析', 'iOS 新功能详解', '芯片科技资讯：本周技术进展', 'GPU hardware guide'])('classifies useful technology information separately: %s', title => {
    expect(classifyReading(title)).toMatchObject({ category: 'technology', decision: 'import' });
  });

  it('never uses notes as evidence of a topic or teaching intent', () => {
    expect(classifyReading('设计的一种可能', '详解如何用 Figma 制作交互原型')).toMatchObject({ category: 'design', decision: 'review' });
    expect(classifyReading('AI 模型')).toMatchObject({ category: 'programming_ai', decision: 'review' });
    expect(classifyReading('Blender 作品展示及制作教程')).toMatchObject({ category: 'design', decision: 'import' });
    expect(classifyReading('值得一看', 'Python 教程 / 历史公开课')).toMatchObject({ category: 'other', decision: 'review' });
    expect(classifyReading('新品开箱', '原理拆解和设计分析')).toMatchObject({ category: 'other', decision: 'review' });
  });

  it.each(['值得一看', '一次有趣的尝试', '做点不一样的', 'Python 入门教程', 'AI 每日新闻', '机械键盘开箱'])('ignores captured history and playback metadata for %s', title => {
    const metadata = '来源：B站历史页面（2026-09-26）。页面播放位置 00:12/03:20；仅当前分集，不代表整套课程完成率。';
    expect(classifyReading(title, metadata)).toEqual(classifyReading(title));
  });

  it.each([
    ['PPT-Master项目演示', 'career'],
    ['珍藏网站合集：怪诞复古文件夹', 'design'],
    ['多模态模型从零训', 'programming_ai'],
    ['显卡手搓实践', 'technology'],
    ['手搓一台笔电', 'technology'],
    ['Obsidian插件推荐阅读器', 'career'],
  ])('recognizes specific practical titles without relying on imported notes: %s', (title, category) => {
    expect(classifyReading(title)).toMatchObject({ category, decision: 'import' });
  });

  it('validates explicit categories without silently accepting misspellings', () => {
    expect(readingCategory(undefined)).toBe('other');
    expect(readingCategory('humanities')).toBe('humanities');
    expect(readingCategory('ai')).toBe('programming_ai');
    expect(readingCategory('programming')).toBe('programming_ai');
    expect(() => readingCategory('entertainment')).toThrow();
    expect(() => readingCategory(null)).toThrow();
  });
});

describe('reading source canonicalization', () => {
  it('deduplicates Bili by BV ID across parts, host variants and tracking while preserving a playable part URL', () => {
    const url = 'http://m.bilibili.com/video/BV1LitP6GEm5?p=2&spm_id_from=333.0&vd_source=test#reply';
    expect(canonicalReadingSource(url)).toBe('bilibili:BV1LitP6GEm5');
    expect(normalizedImportUrl(url)).toBe(`${videoUrl}?p=2`);
    expect(canonicalReadingSource(`${videoUrl}?p=3`)).toBe(canonicalReadingSource(url));
    expect(canonicalReadingSource(videoUrl.replace('GEm5', 'GEm6'))).not.toBe(canonicalReadingSource(url));
  });

  it('retains meaningful query values for generic HTTP links and strips only known tracking values', () => {
    expect(canonicalReadingSource('https://WWW.YouTube.com:443/watch?v=abc&list=course&utm_source=mail&fbclid=x#chapter')).toBe('https://www.youtube.com/watch?list=course&v=abc');
    expect(canonicalReadingSource('https://example.com/read?from=chapter2&ref=book')).toBe('https://example.com/read?from=chapter2&ref=book');
    expect(canonicalReadingSource('')).toBe('');
  });

  it('does not confuse look-alike hosts with Bilibili', () => {
    expect(canonicalReadingSource('https://www.bilibili.com.evil.example/video/BV1LitP6GEm5?p=2')).toBe('https://www.bilibili.com.evil.example/video/BV1LitP6GEm5?p=2');
    expect(() => canonicalReadingSource('javascript:alert(1)')).toThrow();
    expect(() => canonicalReadingSource('https://user:password@example.com')).toThrow();
  });
});

describe('atomic reading-import parsing', () => {
  it('normalizes timestamps, unknown progress, metadata and coverage without mutating the input', () => {
    const input = { items: [candidate({ progress: null, notes: '  A note  ', coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg' })], coverage: { from: '2026-09-13T00:00:00-04:00', to: '2026-09-26T12:00:00-04:00', complete: true } };
    const before = JSON.stringify(input);
    const parsed = parseReadingImport(input);
    expect(parsed.items[0]).toMatchObject({ title: 'Python 入门教程', notes: 'A note', viewedAt: '2026-09-26T13:00:00.000Z', progress: null, sourceKey: 'bilibili:BV1LitP6GEm5', coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg' });
    expect(parsed.coverage).toEqual({ from: '2026-09-13T04:00:00.000Z', to: '2026-09-26T16:00:00.000Z', complete: true });
    expect(JSON.stringify(input)).toBe(before);
    expect(parseReadingImport({ items: [candidate({ progress: undefined })] }).items[0].progress).toBeNull();
  });

  it.each(['2026-09-26T09:00:00.1234567-04:00', '2026-09-26T13:00:00.123456789Z'])('accepts ISO fractional seconds emitted by common capture tools: %s', viewedAt => {
    expect(parseReadingImport({ items: [candidate({ viewedAt })] }).items[0].viewedAt).toBe('2026-09-26T13:00:00.123Z');
  });

  it.each([
    { title: '' }, { title: 'a'.repeat(301) }, { url: '' }, { url: 'file:///secret' }, { notes: 'a'.repeat(10001) },
    { viewedAt: '2026-09-26' }, { viewedAt: '2026-09-26T09:00:00' }, { viewedAt: '2026-02-30T09:00:00Z' }, { viewedAt: '2026-09-26T24:00:00Z' }, { viewedAt: '2026-09-26T09:00:00.1234567890Z' },
    { progress: -0.01 }, { progress: 1.01 }, { progress: '0.2' }, { progress: NaN }, { progress: Infinity },
    { coverUrl: 'https://example.com/cover.jpg' },
  ])('rejects the whole batch if a later candidate is malformed: %j', bad => {
    const input = { items: [candidate(), candidate(bad)] };
    expect(() => parseReadingImport(input)).toThrow();
    expect(input.items).toHaveLength(2);
    expect(input.items[0]).toEqual(candidate());
  });

  it('validates shape and size before accepting a batch or coverage', () => {
    for (const body of [null, [], {}, { items: {} }, { items: Array(1001).fill(candidate()) }, { items: [null] }, { items: [], coverage: { from: '2026-09-26T00:00:00Z', to: '2026-09-13T00:00:00Z', complete: true } }, { items: [], coverage: { from: '2026-09-13T00:00:00Z', to: '2026-09-26T00:00:00Z', complete: 'yes' } }]) expect(() => parseReadingImport(body)).toThrow();
    expect(parseReadingImport({ items: [] }).items).toEqual([]);
  });

  it('leaves range/progress filtering to the caller so excluded entries can appear in a preview', () => {
    const parsed = parseReadingImport({ items: [candidate({ viewedAt: '2027-01-01T00:00:00Z', progress: 1 })] }, Date.parse('2026-09-26T00:00:00Z'));
    expect(parsed.items[0]).toMatchObject({ viewedAt: '2027-01-01T00:00:00.000Z', progress: 1 });
  });

  it('rejects unknown body, candidate and coverage fields instead of silently ignoring typos or status injection', () => {
    expect(() => parseReadingImport({ items: [candidate()], acceptedUrl: [videoUrl] })).toThrow('未知字段');
    expect(() => parseReadingImport({ items: [candidate({ progrees: 0.1 })] })).toThrow('未知字段');
    expect(() => parseReadingImport({ items: [candidate({ status: 'done' })] })).toThrow('未知字段');
    expect(() => parseReadingImport({ items: [candidate()], coverage: { from: '2026-09-13T00:00:00Z', to: '2026-09-26T00:00:00Z', complete: true, complet: false } })).toThrow('未知字段');
  });

  it('matches manual decisions to canonical identities in this batch and rejects conflicts', () => {
    const input = { items: [candidate()], acceptedUrls: [`${videoUrl}?p=2&utm_source=test`, videoUrl] };
    expect(parseReadingImport(input).acceptedUrls).toEqual([`${videoUrl}?p=2`]);
    expect(() => parseReadingImport({ ...input, excludedUrls: [videoUrl] })).toThrow('同一条目不能同时确认收录和排除');
    expect(() => parseReadingImport({ items: [candidate()], acceptedUrls: ['https://example.com/unknown'] })).toThrow('必须存在于本次');
    expect(() => parseReadingImport({ items: [candidate()], acceptedUrls: [null] })).toThrow();
    expect(parseReadingImport({ items: [candidate()], excludedUrls: [videoUrl] }).excludedUrls).toEqual([videoUrl]);
  });
});
