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
  '点击读取桌面，查看可以加入待办的文件。': 'Read your desktop to find files you can add as tasks.',
  '已读取前 500 项或达到扫描时间限制；只读取文件名称、大小和修改时间。': 'The scan reached its 500-file or time limit. Only names, sizes and modification times were read.',
  '仅查看桌面及两层子目录的文件信息，不读取正文、不移动文件。': 'Reads file information on the desktop and two folder levels. File contents are not read and files are not moved.',
  '无法读取桌面目录，请检查本机目录权限。': 'The desktop folder could not be read. Check its local permissions.',
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
};

function messageEnglish(value: string): string {
  if (EN[value]) return EN[value];
  if (value.endsWith('路径无效')) return 'The local folder or file path is invalid.';
  if (value.startsWith('请使用本机的') && value.endsWith('绝对路径')) return 'Use an absolute path on this computer.';
  return value;
}

export function englishPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(englishPayload);
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) output[key] = key === 'message' && typeof item === 'string' ? messageEnglish(item) : englishPayload(item);
  if ((object.id === 'tech' || object.id === 'aesthetic') && typeof object.label === 'string' && 'count' in object) output.label = object.id === 'tech' ? 'Daily AI & Technology' : 'Daily Aesthetic Atlas';
  if (object.origin === 'report' && typeof object.reportDate === 'string') output.title = `${object.reportSource === 'tech' ? 'Daily AI & Technology' : 'Daily Aesthetic Atlas'} · ${object.reportDate}`;
  return output;
}
