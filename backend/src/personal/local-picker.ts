import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { safeLocalPath, verifyCalendarFile } from './files';
import { PersonalError } from './types';

export type PickerKind = 'calendar' | 'vault' | 'readingTech' | 'readingAesthetic';
export type PickerResult = { cancelled: true } | { path: string };
type PickerRunner = (script: string, signal: AbortSignal) => Promise<string>;
const labels: Record<PickerKind, [string, string]> = {
  calendar: ['选择日历 ICS 文件', 'Choose a calendar ICS file'],
  vault: ['选择 Obsidian 仓库文件夹', 'Choose your Obsidian vault folder'],
  readingTech: ['选择科技日报文件夹', 'Choose the technology reports folder'],
  readingAesthetic: ['选择审美日报文件夹', 'Choose the aesthetics reports folder'],
};

// All script fragments come from fixed application constants, never a path or
// command supplied by a page. Output uses ASCII base64 to survive PowerShell 5.
export function pickerScript(kind: PickerKind, english = false): string {
  const title = labels[kind][english ? 1 : 0];
  return `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
${kind === 'calendar' ? `$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '${title}'
$dialog.Filter = 'iCalendar (*.ics)|*.ics'
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false
$dialog.RestoreDirectory = $true` : `$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${title}'
$dialog.ShowNewFolderButton = $false`}
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    $result = @{path = $dialog.${kind === 'calendar' ? 'FileName' : 'SelectedPath'}}
  } else { $result = @{cancelled = $true} }
  $json = $result | ConvertTo-Json -Compress
  [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)))
} finally { $dialog.Dispose(); $owner.Dispose() }`;
}

const runWindowsPicker: PickerRunner = (script, signal) => new Promise((resolve, reject) => {
  const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  execFile(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024, signal },
    (error, stdout) => error ? reject(error) : resolve(stdout));
});

export class LocalPicker {
  private active = false;
  constructor(private options: { platform?: NodeJS.Platform; run?: PickerRunner; timeoutMs?: number } = {}) {}
  async choose(value: unknown, english = false, signal?: AbortSignal): Promise<PickerResult> {
    const fail = (zh: string, en: string, status = 400) => new PersonalError(english ? en : zh, status);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'kind') || !Object.hasOwn(labels, String((value as { kind?: unknown }).kind))) {
      throw fail('请选择有效的文件来源', 'Choose a valid file source.');
    }
    if ((this.options.platform ?? process.platform) !== 'win32') throw fail('当前系统暂不支持目录弹窗，请填写路径；书架文件仍可直接选择导入。', 'The native folder picker currently supports Windows. Enter the path here; shelf file uploads remain available.', 501);
    if (this.active) throw fail('已有一个文件选择窗口，请先完成或取消它。', 'A file picker is already open. Complete or cancel it first.', 409);
    this.active = true;
    const combined = AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs ?? 120000), ...(signal ? [signal] : [])]);
    try {
      const kind = (value as { kind: PickerKind }).kind;
      const encoded = (await (this.options.run ?? runWindowsPicker)(pickerScript(kind, english), combined)).trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid picker output');
      const result = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { path?: unknown; cancelled?: unknown };
      if (result.cancelled === true) return { cancelled: true };
      if (typeof result.path !== 'string' || !result.path || result.path.length > 4096) throw new Error('Invalid picker path');
      const path = safeLocalPath(result.path, english ? 'file' : '文件');
      if (kind === 'calendar') verifyCalendarFile(path);
      else if (!statSync(path).isDirectory()) throw new Error('Expected folder');
      return { path };
    } catch (error) {
      if (combined.aborted) throw fail('选择已取消或超时，原设置未改变。', 'Selection was cancelled or timed out. Existing settings are unchanged.', signal?.aborted ? 499 : 408);
      if (error instanceof PersonalError) throw error;
      throw fail('无法完成文件选择，请重试或手动填写路径。', 'Unable to select a file. Retry or enter the path manually.', 503);
    } finally { this.active = false; }
  }
}
