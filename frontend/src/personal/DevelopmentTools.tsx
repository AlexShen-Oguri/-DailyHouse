import { useEffect, useRef, useState } from 'react';
import { request, dateLabel } from './api';
import { usePreferences } from './Preferences';
import { Notice } from './shared';
import { type DevelopmentTool, type DevelopmentToolId, type ToolState } from './private-sync-model';
import '../styles/private-sync.css';

export function toolName(id: DevelopmentToolId) { return id === 'claude' ? 'Claude Code' : 'Codex'; }
function ToolRows({ state }: { state: ToolState }) {
  const { t, locale } = usePreferences();
  const stateLabel = (tool: DevelopmentTool) => ({ not_installed: t('未安装', 'Not installed'), signed_out: t('未登录', 'Signed out'), unavailable: t('暂不可用 / 未验证', 'Unavailable / unverified'), authenticated: t('已检测到登录', 'Login detected') }[tool.state]);
  return <ul className="development-tool-list">{state.tools.map(tool => <li key={tool.id}><div><strong>{toolName(tool.id)}</strong><span className="pw-status">{stateLabel(tool)}</span>{tool.version && <small>{tool.version}</small>}</div><p>{tool.message || tool.reason}</p><small>{t('检查时间：', 'Checked: ')}{dateLabel(tool.checkedAt, locale)} · {t('模型访问尚未探测', 'Model access has not been tested')}</small><p className="pw-footnote">{tool.capabilities.projectRead ? t('支持本机项目读取', 'Local project reading supported') : t('没有本机项目读取入口', 'No local project-reading entry')} · {tool.capabilities.threadRead ? t('支持本机对话读取', 'Local conversation reading supported') : t('不读取本机对话历史', 'Local conversation history is not read')} · {tool.capabilities.nativeResume ? t('可使用工具自身的继续入口', 'Native resume entry available') : t('仅能在原生工具中自行继续', 'Continue manually in the native tool')}</p></li>)}</ul>;
}
export default function DevelopmentTools() {
  const { t, language } = usePreferences(); const [state, setState] = useState<ToolState | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const alive = useRef(true);
  async function check(refresh = false) { setBusy(true); setError(''); try { const next = await request<ToolState>(refresh ? '/development-tools/refresh' : '/development-tools', refresh ? 'POST' : 'GET', refresh ? {} : undefined); if (alive.current) setState(next); } catch (err) { if (alive.current) setError((err as Error).message); } finally { if (alive.current) setBusy(false); } }
  useEffect(() => { alive.current = true; void check(); return () => { alive.current = false; }; }, [language]);
  return <section className="pw-setting-section development-tools" aria-labelledby="development-tools-title"><div><h2 id="development-tools-title">{t('本机开发工具', 'Tools on this device')}</h2><p>{t('Codex 与 Claude Code 的安装和登录只属于当前设备。', 'Codex and Claude Code installations and logins belong to this device.')}</p></div><div>{state && <ToolRows state={state}/>}<p className="pw-footnote">{t('检测到登录不保证订阅额度或模型调用可用。已有项目通过原生工具继续，保留工具自身的审批。账号和凭证不进入同步数据。', 'A detected login does not guarantee model access or subscription capacity. Continue existing projects in their native tool and retain its approvals. Accounts and credentials are excluded from sync.')}</p><button className="pw-button" disabled={busy} onClick={() => void check(true)}>{busy ? t('检查中…', 'Checking…') : t('重新检查安装与登录', 'Check installation & login')}</button>{error && <Notice error>{error}</Notice>}</div></section>;
}
