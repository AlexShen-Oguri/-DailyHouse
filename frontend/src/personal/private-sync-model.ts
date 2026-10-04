export type SyncScope = 'todos' | 'reading' | 'ideas' | 'learning' | 'journal' | 'projects';
export const syncScopes: SyncScope[] = ['todos', 'reading', 'ideas', 'learning', 'journal', 'projects'];
export type SyncDevice = { id: string; name: string; revoked?: boolean; revokedAt?: string | null; administrator?: boolean; current?: boolean; createdAt?: string; lastSeenAt?: string | null };
export type SyncConflict = { id: string; key: string; kind: string; reason?: 'concurrent_edit' | 'same_source' | 'local_missing'; local: unknown; remote: unknown; title?: string };
export type SyncStatus = { mode: 'local_only' | 'preview_required' | 'offline' | 'pending' | 'synced' | 'conflict' | 'revoked'; device: SyncDevice; configured: boolean; paused?: boolean; pending: number; conflicts: SyncConflict[]; lastAttemptAt?: string | null; lastSyncedAt?: string | null; scopes: SyncScope[]; message?: string };
export type SyncPreview = { id: string; device: SyncDevice; createdAt: string; scopes: SyncScope[]; recordCount: number; uploadCount: number; downloadCount: number; conflictCount: number; emptyDevice: boolean; records: { kind: string; id: string; title: string; action: 'upload' | 'download' | 'conflict' | 'unchanged'; local?: unknown; remote?: unknown }[]; attachmentsExcluded: { name: string; size: number }[]; excluded: string[] };
export type DevelopmentToolId = 'codex' | 'claude';
export type DevelopmentTool = { id: DevelopmentToolId; state: 'not_installed' | 'signed_out' | 'unavailable' | 'authenticated'; installed: boolean; version?: string; authentication: 'detected' | 'missing' | 'unknown'; modelAccess: 'unchecked'; checkedAt: string; capabilities: { discussion: 'manual_only'; development: 'native_confirmation'; projectRead: boolean; threadRead: boolean; nativeResume: boolean }; reason?: string; message?: string };
export type ToolState = { checkedAt: string; deviceScope: 'current_device'; tools: DevelopmentTool[] };
export async function copySelectedText(text: string): Promise<boolean> {
  try { if (!navigator.clipboard?.writeText) return false; await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
