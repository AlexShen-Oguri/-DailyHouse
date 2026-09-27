import { LocalReadingClassifier, READING_CLASSIFICATION_BATCH_SIZE, ReadingClassificationError, type ReadingClassificationInput, type ReadingClassifier } from './reading-ai';
import type { ReadingCategory } from './types';

export interface PendingReadingClassification { input: ReadingClassificationInput; revision: number }
export interface ReadingClassificationUpdate {
  category?: ReadingCategory;
  reason?: string;
  model?: string;
  confidence?: 'high' | 'medium' | 'low';
  needsReview?: boolean;
  error?: string;
}
export interface ReadingClassificationStore {
  pendingReadingClassifications(ids?: string[]): PendingReadingClassification[];
  startReadingClassification(id: string): PendingReadingClassification;
  applyReadingClassification(id: string, expectedRevision: number, result: ReadingClassificationUpdate): unknown;
}

function safeFailure(error: unknown): string {
  if (error instanceof ReadingClassificationError) {
    if (error.code === 'timeout') return 'Qwen 分类超时，条目已保留，可重试或手动分类。';
    if (error.code === 'unavailable') return '本机 Qwen 尚未就绪，条目已保留；启动模型后可重试分类。';
    if (error.code === 'invalid_input') return '本次条目内容无法用于分类，请编辑标题或说明后重试。';
    if (error.code === 'cancelled') return '分类已取消，条目已保留，可重试。';
  }
  return 'Qwen 分类结果未通过校验，条目已保留，可重试或手动分类。';
}

/** One bounded worker. Failed work waits for an explicit retry; restart resumes only persisted pending items. */
export class ReadingClassificationService {
  private readonly queued = new Set<string>();
  private readonly controller = new AbortController();
  private worker: Promise<void> | undefined;
  private stopped = false;
  constructor(private readonly store: ReadingClassificationStore, private readonly classifier: ReadingClassifier = new LocalReadingClassifier(), private readonly onPersistenceError: () => void = () => console.error('Reading classification could not save its result. Pending items will resume after restart.')) {}

  enqueue(ids?: string[]): void {
    if (this.stopped) return;
    for (const snapshot of this.store.pendingReadingClassifications(ids)) this.queued.add(snapshot.input.id);
    this.startWorker();
  }
  schedule(ids: string[]): void { this.enqueue(ids); }
  resume(): void { this.enqueue(); }
  retry(id: string): { id: string; status: 'pending' } {
    if (this.stopped) throw new ReadingClassificationError('unavailable', '分类服务正在关闭，请稍后重试。', 'Classification is shutting down. Retry later.', 503);
    this.store.startReadingClassification(id);
    this.enqueue([id]);
    return { id, status: 'pending' };
  }
  /** Tests and controlled shutdown can wait without coupling requests to inference latency. */
  async idle(): Promise<void> { while (this.worker) await this.worker; }
  async stop(): Promise<void> { this.stopped = true; this.queued.clear(); this.controller.abort(); await this.idle(); }

  private startWorker(): void {
    if (this.worker || this.stopped || !this.queued.size) return;
    this.worker = Promise.resolve().then(() => this.drain()).catch(() => { this.queued.clear(); this.onPersistenceError(); }).finally(() => {
      this.worker = undefined;
      if (this.queued.size && !this.stopped) this.startWorker();
    });
  }
  private async drain(): Promise<void> {
    while (!this.stopped && this.queued.size) {
      const ids = [...this.queued].slice(0, READING_CLASSIFICATION_BATCH_SIZE);
      for (const id of ids) this.queued.delete(id);
      // Take a fresh revision snapshot immediately before inference. Removed/manual items vanish here.
      const snapshots = this.store.pendingReadingClassifications(ids);
      if (!snapshots.length) continue;
      let result;
      try { result = await this.classifier.classify(snapshots.map(row => row.input), this.controller.signal); }
      catch (error) {
        // Shutdown leaves pending state durable so the next launch can resume it.
        if (this.stopped) return;
        for (const row of snapshots) this.store.applyReadingClassification(row.input.id, row.revision, { error: safeFailure(error) });
        continue;
      }
      if (this.stopped) return;
      for (const row of snapshots) {
        const suggestion = result.suggestions.find(item => item.id === row.input.id);
        if (!suggestion) { this.store.applyReadingClassification(row.input.id, row.revision, { error: safeFailure(undefined) }); continue; }
        this.store.applyReadingClassification(row.input.id, row.revision, { category: suggestion.category, reason: suggestion.reason, confidence: suggestion.confidence, needsReview: suggestion.needsReview, model: result.model });
      }
    }
  }
}
