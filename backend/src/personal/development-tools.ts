import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { CodexProjectClient, findCodexExecutable, type ProjectRpc } from './codex-project-client';
import { PersonalError, type Idea } from './types';

export type DevelopmentTool = 'codex' | 'claude';
export interface ToolCommand { file: string; args: string[] }
export interface ToolProcessResult { stdout: string; exitCode: number }
export type ToolProcessRunner = (command: ToolCommand, args: string[]) => Promise<ToolProcessResult>;
export interface DevelopmentToolStatus {
  id: DevelopmentTool;
  state: 'not_installed' | 'signed_out' | 'unavailable' | 'authenticated';
  installed: boolean;
  version?: string;
  authentication: 'detected' | 'missing' | 'unknown';
  modelAccess: 'unchecked';
  checkedAt: string;
  capabilities: { discussion: 'manual_only'; development: 'native_confirmation'; projectRead: boolean; threadRead: boolean; nativeResume: boolean };
  reason: 'not_installed' | 'login_required' | 'probe_failed' | 'unsupported_strict_isolation';
  message: string;
}
export interface DevelopmentToolsState { checkedAt: string; deviceScope: 'current_device'; tools: DevelopmentToolStatus[] }
export interface NativeHandoffRecipe {
  cwd: string;
  executable: DevelopmentTool;
  args: string[];
  contextPath?: string;
  started: false;
  nativeSessionRestored: false;
}
export interface DevelopmentToolsOptions {
  resolveCommand?: (tool: DevelopmentTool) => ToolCommand | undefined;
  run?: ToolProcessRunner;
  rpcFactory?: () => ProjectRpc;
  now?: () => Date;
}

function executable(path: string) { try { return existsSync(path) && statSync(path).isFile(); } catch { return false; } }
function pathCommand(name: string) {
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const path = join(directory.replace(/^"|"$/g, ''), name);
    if (executable(path)) return path;
  }
  return undefined;
}
export function resolveDevelopmentTool(tool: DevelopmentTool): ToolCommand | undefined {
  if (tool === 'codex') {
    const configured = findCodexExecutable();
    const path = executable(configured) ? configured : pathCommand(process.platform === 'win32' ? 'codex.exe' : 'codex');
    return path ? { file: path, args: [] } : undefined;
  }
  const native = pathCommand(process.platform === 'win32' ? 'claude.exe' : 'claude') || join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  if (executable(native)) return { file: native, args: [] };
  // Windows npm wrappers require a shell. Invoke their actual Node entry point
  // with argv instead; no user content is interpolated into a shell command.
  if (process.platform === 'win32') {
    const npmRoots = [...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []), ...(process.env.PATH || '').split(delimiter).filter(Boolean)];
    for (const root of npmRoots) {
      const entry = join(root.replace(/^"|"$/g, ''), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (executable(entry)) return { file: process.execPath, args: [entry] };
    }
  }
  return undefined;
}
export const runToolProbe: ToolProcessRunner = (command, args) => new Promise((resolve, reject) => {
  execFile(command.file, [...command.args, ...args], { windowsHide: true, shell: false, timeout: 8000, maxBuffer: 128 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    // stderr can contain local paths, account details or diagnostics. Never
    // persist it, forward it to the UI, or use it as a public error message.
    if (error && (typeof error.code !== 'number' || error.killed)) { reject(new Error('Tool status probe unavailable.')); return; }
    // Codex prints its status to stderr. Extract only known fixed status text;
    // do not return the surrounding diagnostics or account information.
    const authText = args[0] === 'login' && args[1] === 'status' ? `${stdout}\n${stderr}`.match(/Logged in using (?:ChatGPT|an API key|API key|workload identity)|Not logged in/i)?.[0] || '' : stdout;
    resolve({ stdout: authText, exitCode: error && typeof error.code === 'number' ? error.code : 0 });
  });
});
export function developmentTool(value: unknown, legacyDefault = false): DevelopmentTool {
  if (legacyDefault && value === undefined) return 'codex';
  if (value !== 'codex' && value !== 'claude') throw new PersonalError('请选择 Codex 或 Claude Code');
  return value;
}
export function nativeHandoffRecipe(tool: DevelopmentTool, cwd: string, contextPath?: string, sessionId?: string): NativeHandoffRecipe {
  developmentTool(tool);
  if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(cwd) || cwd.startsWith('//') || cwd.startsWith('\\\\') || /[\x00-\x1f]/.test(cwd)) throw new PersonalError('继续工作目录必须是当前设备的明确本机目录');
  if (contextPath !== undefined && (!contextPath || /[\x00-\x1f]/.test(contextPath) || /^(?:[A-Za-z]:|[\\/])/.test(contextPath) || contextPath.split(/[\\/]/).includes('..'))) throw new PersonalError('交接上下文必须在已确认的项目目录内');
  if (sessionId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) throw new PersonalError('原生对话 ID 必须是当前设备明确关联的 UUID');
  return { cwd, executable: tool, args: sessionId ? [tool === 'claude' ? '--resume' : 'resume', sessionId] : [], ...(contextPath ? { contextPath } : {}), started: false, nativeSessionRestored: false };
}

export class DevelopmentToolsService {
  private cache?: DevelopmentToolsState;
  private checking?: Promise<DevelopmentToolsState>;
  private run: ToolProcessRunner;
  private resolveCommand: NonNullable<DevelopmentToolsOptions['resolveCommand']>;
  private rpcFactory: NonNullable<DevelopmentToolsOptions['rpcFactory']>;
  private now: NonNullable<DevelopmentToolsOptions['now']>;
  constructor(options: DevelopmentToolsOptions = {}) {
    this.run = options.run || runToolProbe;
    this.resolveCommand = options.resolveCommand || resolveDevelopmentTool;
    this.rpcFactory = options.rpcFactory || (() => new CodexProjectClient(undefined, 5000));
    this.now = options.now || (() => new Date());
  }
  status(options: { refresh?: boolean } = {}): Promise<DevelopmentToolsState> {
    if (!options.refresh && this.cache) return Promise.resolve(structuredClone(this.cache));
    if (!this.checking) this.checking = this.check().finally(() => { this.checking = undefined; });
    return this.checking.then(value => structuredClone(value));
  }
  async requireAuthenticated(tool: DevelopmentTool) {
    const status = (await this.status({ refresh: true })).tools.find(item => item.id === tool)!;
    if (status.state !== 'authenticated' || !status.capabilities.nativeResume) throw new PersonalError(`${tool === 'claude' ? 'Claude Code' : 'Codex'} 尚未检测到可用的本机安装、登录与原生继续工作接口，请在对应工具中检查后重试`, 503);
    return status;
  }
  private async check() {
    const checkedAt = this.now().toISOString();
    const tools = await Promise.all((['codex', 'claude'] as const).map(tool => this.probe(tool, checkedAt)));
    this.cache = { checkedAt, deviceScope: 'current_device', tools };
    return this.cache;
  }
  private async probe(id: DevelopmentTool, checkedAt: string): Promise<DevelopmentToolStatus> {
    const status: DevelopmentToolStatus = { id, state: 'not_installed', installed: false, authentication: 'unknown', modelAccess: 'unchecked', checkedAt,
      capabilities: { discussion: 'manual_only', development: 'native_confirmation', projectRead: false, threadRead: false, nativeResume: false }, reason: 'not_installed', message: '当前设备未检测到此工具，未发送任何内容。' };
    try {
      const command = this.resolveCommand(id);
      if (!command) return status;
      const version = await this.run(command, ['--version']);
      const versionMatch = version.stdout.match(id === 'codex' ? /codex-cli\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?)/ : /([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?)\s*\(Claude Code\)/);
      if (version.exitCode !== 0 || !versionMatch) throw new Error('Invalid version probe.');
      status.installed = true; status.version = versionMatch[1];
      const [auth, help] = await Promise.all([this.run(command, id === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json']), this.run(command, ['--help'])]);
      if (help.exitCode !== 0) throw new Error('Unavailable CLI help.');
      status.capabilities.nativeResume = id === 'codex' ? /\bresume\b/.test(help.stdout) : /--resume\b/.test(help.stdout);
      let authenticated = false;
      if (id === 'codex') {
        authenticated = auth.exitCode === 0 && /Logged in using (?:ChatGPT|an API key|API key|workload identity)/i.test(auth.stdout);
        if (!authenticated && !/not logged in/i.test(auth.stdout)) throw new Error('Unverifiable authentication.');
      } else {
        const parsed = JSON.parse(auth.stdout);
        if (typeof parsed.loggedIn !== 'boolean' || ![0, 1].includes(auth.exitCode) || parsed.loggedIn === true && auth.exitCode !== 0) throw new Error('Unverifiable authentication.');
        authenticated = parsed.loggedIn === true && auth.exitCode === 0;
      }
      status.authentication = authenticated ? 'detected' : 'missing';
      status.state = authenticated ? 'authenticated' : 'signed_out';
      status.reason = authenticated ? 'unsupported_strict_isolation' : 'login_required';
      status.message = authenticated ? '本机凭证与接口已检测；模型访问未验证。灵感讨论仅准备选中内容的手动交接，不自动运行工具。' : '本机工具已安装，尚未检测到登录。请在工具自身完成登录后刷新。';
      if (authenticated && id === 'codex') {
        const rpc = this.rpcFactory();
        try {
          const account = await rpc.call<{ account?: unknown; requiresOpenaiAuth?: boolean }>('account/read', { refreshToken: false });
          if (account?.requiresOpenaiAuth === true && !account.account) {
            status.authentication = 'missing'; status.state = 'signed_out'; status.reason = 'login_required';
            status.message = 'Codex 本机服务未检测到需要的登录，请在原生工具中完成登录后刷新。';
            return status;
          }
          const checks = await Promise.allSettled([rpc.call('project/list', { limit: 1 }), rpc.call('thread/list', { limit: 1, useStateDbOnly: true })]);
          status.capabilities.projectRead = checks[0].status === 'fulfilled' && Array.isArray((checks[0].value as { data?: unknown })?.data);
          status.capabilities.threadRead = checks[1].status === 'fulfilled' && Array.isArray((checks[1].value as { data?: unknown })?.data);
        } catch { status.message = '本机登录已检测，但项目服务暂不可验证。仅可在工具自身手动继续；模型访问未验证。'; }
        finally { rpc.close(); }
      }
      return status;
    } catch {
      return { ...status, state: 'unavailable', reason: 'probe_failed', message: '当前设备的安装、登录或接口无法验证；未发送任何内容。' };
    }
  }
}

export interface DiscussionIdeaReader { idea(id: string): Idea }
export function discussionPreview(reader: DiscussionIdeaReader, value: unknown, language: 'zh' | 'en' = 'zh') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PersonalError('请求必须是对象');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['tool', 'ideaId', 'revision', 'includeTitle', 'entryIds', 'question'].includes(key))) throw new PersonalError('请求包含不支持的字段');
  const tool = developmentTool(body.tool);
  if (typeof body.ideaId !== 'string' || !body.ideaId || body.ideaId.length > 150 || typeof body.includeTitle !== 'boolean' || !Number.isInteger(body.revision)) throw new PersonalError('请选择灵感和需要交接的内容');
  if (!Array.isArray(body.entryIds) || body.entryIds.length > 50 || body.entryIds.some(id => typeof id !== 'string' || !id || id.length > 150) || new Set(body.entryIds).size !== body.entryIds.length) throw new PersonalError('时间线选择无效');
  if (typeof body.question !== 'string' || body.question.length > 8000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.question)) throw new PersonalError('讨论问题无效或过长');
  const idea = reader.idea(body.ideaId);
  if (idea.revision !== body.revision) throw new PersonalError('灵感已变化，请刷新后重新选择交接内容', 409);
  const entryIds = body.entryIds as string[];
  if (entryIds.some(id => !idea.entries.some(entry => entry.id === id))) throw new PersonalError('所选时间线更新不存在，请重新选择', 409);
  const selectedEntries = idea.entries.filter(entry => entryIds.includes(entry.id));
  if (!body.includeTitle && !selectedEntries.length && !body.question.trim()) throw new PersonalError('请至少选择一项内容或填写问题');
  const en = language === 'en';
  const text = [en ? 'DailyHouse selected discussion context' : '日常小院 · 已选讨论上下文', ...(body.includeTitle ? [`${en ? 'Idea' : '想法'}: ${idea.title}`] : []),
    ...selectedEntries.map(entry => `[${entry.kind} · ${entry.createdAt}]\n${entry.content}`), ...(body.question.trim() ? [`${en ? 'Question' : '问题'}: ${body.question.trim()}`] : [])].join('\n\n');
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw new PersonalError('所选上下文超过 64 KB，请减少选择');
  return { tool, text, selected: { ideaId: idea.id, revision: idea.revision, includeTitle: body.includeTitle, entryIds: selectedEntries.map(entry => entry.id) }, delivery: 'clipboard_only' as const, sent: false, createdAt: new Date().toISOString() };
}
