import { bilibiliVideoId, readingCoverInput } from './covers';
import { readingNotes, readingTitle, readingUrl } from './reading';
import { PersonalError, type ReadingCategory } from './types';

export { READING_CATEGORIES, readingCategory } from './reading-categories';

interface CategoryRule { category: ReadingCategory; label: string; subject: RegExp }
const CATEGORY_RULES: CategoryRule[] = [
  { category: 'programming_ai', label: '编程 / AI', subject: /\b(?:ai|ml|llms?|agents?|rag|chatgpt|claude|transformers?|diffusion|pytorch|tensorflow)\b|人工智能|机器学习|深度学习|强化学习|神经网络|大(?:语言)?模型|多模态|提示词|智能体|计算机视觉|自然语言处理|扩散模型|生成式/u },
  { category: 'programming_ai', label: '编程 / AI', subject: /\b(?:python|javascript|typescript|java|golang|rust|react|vue|svelte|node(?:\.js)?|sql|git|github|linux|docker|kubernetes|unity|unreal|godot|api|html|css|leetcode|code|open.source|c\+\+|c#)\b|c\+\+|c#|编程|代码|开源|程序设计|软件(?:开发|工程)|算法|数据结构|数据库|前端|后端|计算机(?:网络|系统|组成)|操作系统|游戏开发|网络安全|数据分析|命令行/u },
  { category: 'design', label: '设计', subject: /\b(?:design|ui|ux|figma|blender|photoshop|illustrator|typography|portfolio|after effects|cinema 4d|c4d)\b|设计|作品集|数字艺术|排版|字体|配色|构图|绘画|素描|水彩|建模|雕刻|摄影|剪辑|动效|动画制作|交互|用户体验|像素画|插画|(?:效果|艺术|视觉).{0,20}网站|网站.{0,20}(?:效果|艺术|视觉)|(?:怪诞|复古).{0,30}(?:网站|文件夹)|(?:网站|文件夹).{0,30}(?:怪诞|复古)/u },
  { category: 'technology', label: '科技', subject: /\b(?:technology|hardware|gpu|cpu|nvidia|apple|iphone|android|ios|windows|robotics|semiconductor|smartphone)\b|科技|数码|芯片|半导体|机器人|智能手机|手机系统|操作系统|显卡|笔电|笔记本电脑|硬件|主板|机械键盘|智能设备|电子产品|性能评测/u },
  { category: 'science', label: '科学', subject: /\b(?:mathematics?|calculus|algebra|physics|chemistry|biology|astronomy|statistics|neuroscience)\b|数学|微积分|线性代数|概率|统计学|物理|化学|生物|天文|地质|科学|科普|神经科学|量子|力学|电路|电子工程/u },
  { category: 'business', label: '商业 / 经济', subject: /\b(?:economics?|business|entrepreneurship|marketing|economy|monetary|supply chain)\b|经济学|宏观经济|微观经济|商业|创业|商业模式|市场营销|供应链|货币政策|财政政策|商业分析/u },
  { category: 'humanities', label: '人文', subject: /\b(?:history|philosophy|literature|sociology|anthropology|archaeology|linguistics|psychology)\b|历史|哲学|文学|社会学|人类学|考古|语言学|心理学|艺术史|政治学|音乐理论|乐理/u },
  { category: 'language', label: '语言', subject: /\b(?:ielts|toefl|jlpt|grammar|vocabulary|pronunciation|english|japanese|french|spanish|german)\b|英语|日语|法语|西班牙语|德语|韩语|外语|雅思|托福|语法|词汇|口语|发音|听力|单词/u },
  { category: 'career', label: '职场', subject: /\b(?:excel|powerpoint|ppt|office|notion|obsidian|productivity|resume|interview|career|project management)\b|办公|表格|职场|职业|求职|面试|简历|项目管理|时间管理|知识管理|效率工具|演讲|沟通技巧|论文写作|学术写作|文献管理/u },
  { category: 'life', label: '生活实践', subject: /\b(?:cooking|baking|fitness|exercise|workout|diy|gardening|budgeting|finance|accounting|nutrition|sewing)\b|烹饪|做饭|菜谱|烘焙|厨艺|健身|锻炼|运动训练|瑜伽|拉伸|营养|园艺|种植|手工|维修|修理|木工|缝纫|理财|财务|会计|记账|预算|税务|保险|急救/u },
];
const TEACHING = /教程|课程|课堂|公开课|讲座|教学|入门|基础|原理|实践|实战|技巧|方法|指南|科普|讲解|详解|解析|拆解|设计分析|演示|案例|训练|步骤|从零|零基础|如何|怎么|怎样|教你|学习|自学|手搓|自制|\b(?:tutorials?|courses?|lessons?|lectures?|learn(?:ing)?|basics?|fundamentals?|principles?|explained|guide|how to|step.by.step|workshop|introduction|practice|training|masterclass|teardown|design analysis)\b/u;
const CLEAR_ENTERTAINMENT = /搞笑|鬼畜|整活|恶搞|沙雕|爆笑|搞怪|八卦|饭圈|综艺|追剧|电视剧|电影解说|影视剪辑|明星绯闻|娱乐盘点|游戏实况|游戏通关|游戏集锦|\b(?:prank|funny|memes?|gossip|reaction|gameplay|let'?s play|walkthrough)\b/u;
const ESPORTS_CONTEXT = /电竞|电子竞技|无畏契约|瓦罗兰特|英雄联盟|穿越火线|生化追击|\b(?:esports?|lpl|lck|vct(?:cn)?|valorant|cs2|cs:go)\b/u;
const SPECTATOR_CONTENT = /赛评|赛后锐评|观战|冠军赛|(?:比赛|对战|战胜).{0,20}(?:锐评|解说|主播|看)|(?:锐评|解说|主播|看).{0,20}(?:比赛|对战|战胜)|爽喷|破防|直播切片|击杀集锦|高光(?:集锦|时刻)|精彩集锦|\b(?:highlights?|match reactions?|watch party)\b/u;
// A game's name alone is not entertainment: retain explicit development,
// design and technical lessons even when their example is an esports match.
const TECHNICAL_SUBJECT = /编程|代码|算法|数据分析|游戏(?:开发|制作)|(?:关卡|交互|系统|角色|战斗|地图|界面|数值)设计|建模|视频剪辑|\b(?:python|javascript|typescript|unity|unreal|godot|blender|figma|ui|ux|programming|game design|game development)\b/u;
const CONSUMER_REVIEW = /游戏测评|开箱|好物推荐|种草|带货|\b(?:unboxing|haul|game review)\b/u;
const PRODUCT_ANALYSIS = /拆解|原理|设计分析|结构分析|工艺分析|\b(?:teardown|principles?|design analysis|engineering analysis)\b/u;
const PROMOTION = /(?:ai|模型|人工智能).{0,12}(?:来了|炸了|爆火|又火了|大事件)|(?:颠覆|取代|淘汰).{0,10}(?:程序员|设计师|工作)|限时免费|赶紧收藏|速来领取|免费领取|资料领取|带货|\bgiveaway\b/u;
const TECH_NEWS = /新闻|早报|资讯|发布会|新品发布|震撼发布|重磅发布|技术动态|科技进展|技术突破|新功能|\b(?:breaking news|weekly news|daily news|just released|new release|launch event|new features)\b/u;
const SHOW_ONLY = /纯展示|作品展示|效果展示|成果展示|视觉盛宴|作品集展示|电影级|概念片|预告片|炫技|\b(?:showcase|showreel|trailer|cinematic)\b/u;
const PRACTICAL_RESOURCE = /代码|\bcode (?:examples?|snippets?|samples?)\b|(?:开源|open.source).{0,30}(?:工具|软件|应用|项目|插件|tool|app|utility|project)|(?:网站|资源|素材|字体|图标|模板|作品集|插件|阅读器|tools?|resources?|portfolio|plugins?).{0,30}(?:合集|推荐|参考|精选|收藏|珍藏|汇总|collection|reference|curated)|(?:合集|推荐|参考|精选|收藏|珍藏|汇总|collection|reference|curated).{0,30}(?:网站|资源|素材|字体|图标|模板|作品集|插件|阅读器|tools?|resources?|portfolio|plugins?)/u;

/** Only titles are evidence: capture notes can contain unrelated source names and history metadata. */
export function classifyReading(title: string, _notes = ''): { category: ReadingCategory; reason: string; decision: 'import' | 'excluded' | 'review' } {
  const heading = title.normalize('NFKC').toLowerCase();
  const rule = CATEGORY_RULES.find(candidate => candidate.subject.test(heading));
  const techNews = !!rule && ['programming_ai', 'technology'].includes(rule.category) && TECH_NEWS.test(heading);
  const category = techNews ? 'technology' : rule?.category ?? 'other';
  if (CLEAR_ENTERTAINMENT.test(heading)) return { category, decision: 'excluded', reason: '标题明确属于搞笑、八卦或游戏实况等娱乐内容，未自动收录。' };
  if (ESPORTS_CONTEXT.test(heading) && SPECTATOR_CONTENT.test(heading) && !((category === 'design' || TECHNICAL_SUBJECT.test(heading)) && TEACHING.test(heading))) return { category, decision: 'excluded', reason: '标题明确指向电竞观赛、主播反应或比赛片段，未自动收录。' };
  if (PROMOTION.test(heading)) return { category, decision: 'review', reason: '标题含推广或夸张宣传，需要确认是否包含实用信息。' };
  if (techNews) return { category, decision: 'import', reason: '标题明确涉及科技资讯、产品技术或新功能，可作为科技信息收录。' };
  if (CONSUMER_REVIEW.test(heading)) return PRODUCT_ANALYSIS.test(heading)
    ? { category, decision: 'import', reason: '标题包含产品拆解、原理或设计分析，可作为实践参考。' }
    : { category, decision: 'review', reason: '标题涉及开箱、测评或推荐，需要确认是否有知识或实践价值。' };
  if (rule && PRACTICAL_RESOURCE.test(heading)) return { category, decision: 'import', reason: `标题包含${rule.label}主题的代码、实用工具、资源合集或参考作品，可留作实践使用。` };
  if (SHOW_ONLY.test(heading) && !TEACHING.test(heading)) return { category, decision: 'review', reason: '标题主要描述作品或效果展示，需要确认是否包含教学或参考用途。' };
  if (rule && TEACHING.test(heading)) return { category, decision: 'import', reason: `标题包含${rule.label}主题，以及教学、原理或实践线索。` };
  if (!rule && /公开课|讲座|大学课程|\b(?:lecture|university course|masterclass)\b/u.test(heading)) return { category, decision: 'import', reason: '标题明确标注课程或讲座，主题暂归其他，可手动调整分类。' };
  return { category, decision: 'review', reason: rule ? `发现${rule.label}主题，但教学或实践属性不明确，需要确认。` : '主题或学习用途不明确，需要确认后再收录。' };
}

const TRACKING_PARAMETERS = /^(?:utm_.+|spm|spm_id_from|from_spmid|vd_source|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref_src|ref_url|share_source|share_medium|share_plat|share_session_id|share_tag)$/i;

export function normalizedImportUrl(value: string): string {
  const validated = readingUrl(value);
  if (!validated) throw new PersonalError('导入条目需要有效的 HTTP 或 HTTPS 链接');
  const url = new URL(validated);
  const bvid = bilibiliVideoId({ type: 'video', url: validated });
  if (bvid) {
    const part = url.searchParams.get('p');
    return `https://www.bilibili.com/video/${bvid}/${part && /^[1-9]\d*$/.test(part) ? `?p=${part}` : ''}`;
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
  // Sorting query keys makes repeated captures stable while retaining meaningful values.
  url.searchParams.sort();
  return url.toString();
}

export function canonicalReadingSource(url: string): string {
  if (!url) return '';
  const normalized = normalizedImportUrl(url);
  const bvid = bilibiliVideoId({ type: 'video', url: normalized });
  return bvid ? `bilibili:${bvid}` : normalized;
}

export interface ReadingImportCandidate {
  title: string;
  url: string;
  notes: string;
  coverUrl?: string;
  viewedAt: string;
  progress: number | null;
  sourceKey: string;
}
export interface ReadingImportPayload {
  items: ReadingImportCandidate[];
  coverage?: { from: string; to: string; complete: boolean };
  acceptedUrls?: string[];
  excludedUrls?: string[];
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError(message);
  return value as Record<string, unknown>;
}

function knownFields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new PersonalError('导入数据包含未知字段，请检查字段名称');
}

function importDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) throw new PersonalError('观看时间和覆盖时间应为带时区的 ISO 日期时间');
  const timestamp = Date.parse(value);
  const calendarDate = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || !Number.isFinite(calendarDate) || new Date(calendarDate).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new PersonalError('导入时间无效');
  return new Date(timestamp).toISOString();
}

/** Parse every candidate before callers mutate data; one malformed item rejects the entire payload. */
export function parseReadingImport(value: unknown, _now = Date.now()): ReadingImportPayload {
  const body = record(value, '请提供阅读导入数据');
  knownFields(body, ['items', 'coverage', 'acceptedUrls', 'excludedUrls']);
  if (!Array.isArray(body.items) || body.items.length > 1000) throw new PersonalError('导入 items 应为最多 1000 条的数组');
  const items = body.items.map(value => {
    const candidate = record(value, '每个导入条目应为对象');
    knownFields(candidate, ['title', 'url', 'notes', 'coverUrl', 'viewedAt', 'progress']);
    const title = readingTitle(candidate.title);
    const url = normalizedImportUrl(readingUrl(candidate.url));
    const notes = readingNotes(candidate.notes);
    const viewedAt = importDate(candidate.viewedAt);
    const progress = candidate.progress === undefined || candidate.progress === null ? null : candidate.progress;
    if (progress !== null && (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1)) throw new PersonalError('播放进度应为 0 到 1 的数值，未知时请留空');
    const item: ReadingImportCandidate = { title, url, notes, viewedAt, progress, sourceKey: canonicalReadingSource(url) };
    if (candidate.coverUrl !== undefined) {
      const coverUrl = readingCoverInput(candidate.coverUrl, { type: 'video', url });
      if (coverUrl) item.coverUrl = coverUrl;
    }
    return item;
  });
  const result: ReadingImportPayload = { items };
  if (body.coverage !== undefined) {
    const coverage = record(body.coverage, '覆盖范围应为对象');
    knownFields(coverage, ['from', 'to', 'complete']);
    const from = importDate(coverage.from);
    const to = importDate(coverage.to);
    if (Date.parse(from) > Date.parse(to) || typeof coverage.complete !== 'boolean') throw new PersonalError('覆盖范围需要有序的起止时间及 complete 布尔值');
    result.coverage = { from, to, complete: coverage.complete };
  }
  const sourceKeys = new Set(items.map(item => item.sourceKey));
  const selections = new Set<string>();
  for (const field of ['acceptedUrls', 'excludedUrls'] as const) {
    if (body[field] === undefined) continue;
    if (!Array.isArray(body[field]) || body[field].length > 1000) throw new PersonalError('确认或排除列表应为最多 1000 个链接的数组');
    const seen = new Set<string>();
    result[field] = (body[field] as unknown[]).map(value => {
      const url = normalizedImportUrl(readingUrl(value));
      const key = canonicalReadingSource(url);
      if (!sourceKeys.has(key)) throw new PersonalError('确认或排除的链接必须存在于本次导入条目中');
      if (field === 'excludedUrls' && selections.has(key)) throw new PersonalError('同一条目不能同时确认收录和排除');
      if (seen.has(key)) return '';
      seen.add(key);
      if (field === 'acceptedUrls') selections.add(key);
      return url;
    }).filter(Boolean);
  }
  return result;
}
