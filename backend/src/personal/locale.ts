// Translate only fixed service messages and generated report labels. Personal
// notes, titles, filenames and calendar content remain exactly as authored.
const EN: Record<string, string> = {
  '仅允许从本机工作台访问。': 'Open this service from the local workbench.',
  '请使用 JSON 请求。': 'Use a JSON request body.',
  '这个功能已移除或不存在。': 'This feature was removed or does not exist.',
  '请求内容不是有效 JSON。': 'The request body is not valid JSON.',
  '请求内容过大。': 'The request body is too large.',
  '本机操作未完成，请重试。': 'The local operation could not be completed. Please try again.',
  '请求内容必须是一个对象': 'The request body must be an object.',
  '请求包含不支持的字段': 'The request contains unsupported fields.',
  '待办标题应为 1–200 个字符': 'Task titles must contain 1–200 characters.',
  '到期日期无效': 'The due date is invalid.',
  '动画设置应为开启或关闭': 'Animation must be enabled or disabled.',
  '待办已达到 5000 条，请先删除不需要的事项': 'The 5,000-task limit has been reached. Remove unused tasks first.',
  '待办不存在': 'The task does not exist.',
  '完成状态无效': 'The completion status is invalid.',
  '尚未连接 Obsidian 仓库': 'No Obsidian vault is connected.',
  '请选择包含 .obsidian 文件夹的本机仓库根目录': 'Choose a local vault root containing an .obsidian folder.',
  '填写本机 Obsidian 仓库路径后，即可只读浏览 Markdown 笔记。': 'Enter your local Obsidian vault path to browse Markdown notes in read-only mode.',
  '仓库较大，已显示当前扫描范围内的笔记。按文件名或路径搜索。': 'This is a large vault. Notes within the scan limit are shown; search by filename or path.',
  '按文件名或路径搜索；笔记保留在你的 Obsidian 仓库中。': 'Search by filename or path. Notes stay in your Obsidian vault.',
  '仓库暂时无法读取。': 'The vault could not be read.',
  '笔记路径无效': 'The note path is invalid.',
  '只允许读取仓库内的 Markdown 笔记': 'Only Markdown notes inside the connected vault can be read.',
  '不读取符号链接中的笔记': 'Notes reached through symbolic links are not read.',
  '笔记必须位于已连接的仓库内': 'The note must be inside the connected vault.',
  '只预览不超过 1 MB 的 Markdown 笔记': 'Only Markdown notes up to 1 MB can be previewed.',
  '笔记不存在或暂时无法读取': 'The note does not exist or could not be read.',
  '请选择可读取、大小不超过 2 MB 的本机 .ics 日历文件': 'Choose a readable local .ics calendar file no larger than 2 MB.',
  '连接已有的 iCloud 日历订阅或本机 .ics 文件，只读取日程。': 'Connect an existing iCloud subscription or a local .ics file to read calendar events.',
  '本机日历快照 · 显示今天起 31 天内的日程。更新 .ics 文件后点击刷新。': 'Local calendar snapshot · Shows the next 31 days. Refresh after updating the .ics file.',
  'iCloud 只读日历 · 显示今天起 31 天内的日程。': 'Read-only iCloud calendar · Shows the next 31 days.',
  '日历读取失败，请检查文件或订阅地址。': 'The calendar could not be read. Check its file or subscription URL.',
  '日历订阅地址无效': 'The calendar subscription URL is invalid.',
  '请填写你已有的 iCloud HTTPS / webcal 日历订阅地址；也可以使用本机 .ics 文件': 'Enter an existing iCloud HTTPS / webcal subscription URL, or use a local .ics file.',
  '日历内容无效或超过 2 MB': 'The calendar is invalid or exceeds 2 MB.',
  '暂不支持按秒或分钟重复的日历事项': 'Events repeating every second or minute are not supported.',
  '单个日历最多支持 2000 个日程定义': 'A calendar can contain up to 2,000 event definitions.',
  'iCloud 日历未能读取，请检查订阅地址是否仍然有效': 'The iCloud calendar could not be read. Check that its subscription URL is still valid.',
  '日历内容超过 2 MB': 'The calendar exceeds 2 MB.',
  '当前工作台尚未取得你此前绑定的 Chase 授权。需要确认绑定所在的应用后，才能接入真实账户与交易。': 'This workbench does not yet have your existing Chase authorization. Confirm which app holds it before connecting real accounts and transactions.',
  '请选择有效的阅读类型': 'Choose a valid reading type.',
  '请选择有效的阅读状态': 'Choose a valid reading status.',
  '阅读标题应为 1–300 个字符': 'Reading titles must contain 1–300 characters.',
  '阅读笔记不能超过 10000 个字符': 'Reading notes cannot exceed 10,000 characters.',
  '请填写有效的 HTTP 或 HTTPS 链接': 'Enter a valid HTTP or HTTPS link without embedded credentials.',
  '只读取此文件夹根目录中的正式 PDF，不生成或修改汇报。': 'Reads final PDFs in this folder only. It does not generate or change reports.',
  '尚未找到汇报文件夹，请检查路径。': 'The report folder was not found. Check its path.',
  '汇报文件夹无法读取，或路径是符号链接。': 'The report folder cannot be read or is a symbolic link.',
  '汇报不存在或已经移走': 'The report does not exist or has moved.',
  '书架已达到 5000 项，请先移除不需要的内容': 'The 5,000-item shelf limit has been reached. Remove unused items first.',
  '这类内容需要填写链接': 'A link is required for this type of content.',
  '阅读内容不存在': 'This reading item does not exist.',
  '请选择 1–10000 项阅读内容，或明确移除全部内容': 'Select 1–10,000 reading items, or explicitly remove all items.',
  '部分阅读内容已不存在，请刷新书架后重试': 'Some reading items no longer exist. Refresh the shelf and try again.',
  '封面需要使用 B站视频对应的 HTTPS 图片链接': 'Use an HTTPS Bilibili image URL for a supported Bilibili video.',
  '请选择有效的阅读分类': 'Choose a valid reading category.',
  '书架中已有相同来源，请打开原条目': 'This source is already on your shelf. Open the existing item.',
  '请选择要恢复的阅读内容': 'Select the reading items to restore.',
  '这项内容已超过 30 天恢复期限': 'The 30-day recovery period has expired.',
  '回收站内容不存在，请刷新后重试': 'This item is no longer in the recycle bin. Refresh and try again.',
  '书架中已有相同来源，无法重复恢复': 'This source is already on your shelf and cannot be restored again.',
  '请提供最多 10000 个已移除的来源链接': 'Provide no more than 10,000 removed source links.',
  '已移除的来源需要有效链接': 'A removed source requires a valid link.',
  '导入批次不存在': 'This import batch does not exist.',
  '导入条目需要有效的 HTTP 或 HTTPS 链接': 'Imported items require valid HTTP or HTTPS links.',
  '导入数据包含未知字段，请检查字段名称': 'The import data contains unknown fields. Check the field names.',
  '观看时间和覆盖时间应为带时区的 ISO 日期时间': 'Watch times and coverage times must be ISO timestamps with a time zone.',
  '导入时间无效': 'The import timestamp is invalid.',
  '请提供阅读导入数据': 'Provide reading import data.',
  '导入 items 应为最多 1000 条的数组': 'The items field must be an array of no more than 1,000 items.',
  '每个导入条目应为对象': 'Each imported item must be an object.',
  '播放进度应为 0 到 1 的数值，未知时请留空': 'Playback progress must be a number from 0 to 1, or null when unknown.',
  '覆盖范围应为对象': 'Coverage must be an object.',
  '覆盖范围需要有序的起止时间及 complete 布尔值': 'Coverage requires ordered start/end timestamps and a complete boolean.',
  '确认或排除列表应为最多 1000 个链接的数组': 'Acceptance and exclusion lists must contain no more than 1,000 links.',
  '确认或排除的链接必须存在于本次导入条目中': 'Accepted or excluded links must appear in this import.',
  '同一条目不能同时确认收录和排除': 'An item cannot be both accepted and excluded.',
  '同一来源已经在书架中，保留现有进度与笔记。': 'This source is already on your shelf. Its progress and notes are preserved.',
  '同一来源出现多次，只使用最近一次观看记录。': 'This source appears more than once. Only the latest watch record is used.',
  '这个来源曾被移除或明确排除，不会自动重新收录。': 'This source was removed or explicitly excluded and will not be imported again automatically.',
  '你已在本次预览中排除此来源。': 'You excluded this source in the preview.',
  '观看时间不在最近 7 × 24 小时内。': 'The watch time is outside the last 7 × 24 hours.',
  '缺少可靠的播放进度，补充后才能收录。': 'Reliable playback progress is missing. Add it before importing.',
  '播放进度已达到 25%，不符合本次导入条件。': 'Playback progress is at least 25%, outside this import rule.',
  '你已确认这条内容适合学习或实践。': 'You confirmed this item is useful for learning or practice.',
  '标题明确属于搞笑、八卦或游戏实况等娱乐内容，未自动收录。': 'The title clearly indicates entertainment such as comedy, gossip or gameplay.',
  '标题可能是资讯或推广；需要确认是否包含可学习的知识或实践。': 'The title may indicate news or promotion. Confirm its learning or practical value.',
  '标题或说明包含产品拆解、原理或设计分析，可作为实践参考。': 'The title or description includes a teardown, principles or design analysis useful for practice.',
  '标题包含产品拆解、原理或设计分析，可作为实践参考。': 'The title includes a teardown, principles or design analysis useful for practice.',
  '标题涉及开箱、测评或推荐，需要确认是否有知识或实践价值。': 'The title describes an unboxing, review or recommendation. Confirm its practical value.',
  '标题主要描述作品或效果展示，需要确认是否包含教学或参考用途。': 'The title mainly describes a showcase. Confirm its teaching or reference value.',
  '标题明确标注课程或讲座，主题暂归其他，可手动调整分类。': 'The title identifies a course or lecture. Its category is Other until you choose one.',
  '主题或学习用途不明确，需要确认后再收录。': 'The topic or learning value is unclear. Confirm it before importing.',
};

function messageEnglish(value: string): string {
  if (EN[value]) return EN[value];
  if (value.endsWith('路径无效')) return 'The local folder or file path is invalid.';
  if (value.startsWith('请使用本机的') && value.endsWith('绝对路径')) return 'Use an absolute path on this computer.';
  if (/^标题包含.+主题的代码、实用工具、资源合集或参考作品，可留作实践使用。$/.test(value)) return 'The title identifies relevant code, tools, resources or reference work for practical use.';
  if (/^标题或说明包含.+主题，以及教学、原理或实践线索。$/.test(value)) return 'The title or description includes a relevant topic and teaching, principles or practical guidance.';
  if (/^标题包含.+主题，以及教学、原理或实践线索。$/.test(value)) return 'The title includes a relevant topic and teaching, principles or practical guidance.';
  if (/^发现.+主题，但教学或实践属性不明确，需要确认。$/.test(value)) return 'A relevant topic was found, but its learning or practical value needs confirmation.';
  return value;
}

export function englishPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(englishPayload);
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) output[key] = (key === 'message' || key === 'reason') && typeof item === 'string' ? messageEnglish(item) : englishPayload(item);
  if ((object.id === 'tech' || object.id === 'aesthetic') && typeof object.label === 'string' && 'count' in object) output.label = object.id === 'tech' ? 'Daily AI & Technology' : 'Daily Aesthetic Atlas';
  if (object.origin === 'report' && typeof object.reportDate === 'string') output.title = `${object.reportSource === 'tech' ? 'Daily AI & Technology' : 'Daily Aesthetic Atlas'} · ${object.reportDate}`;
  return output;
}
