import { describe, expect, it, vi } from 'vitest';
import { LocalReadingClassifier, READING_CLASSIFICATION_SCHEMA, type ReadingClassificationInput } from '../src/personal/reading-ai';

const inputs: ReadingClassificationInput[] = [{ id: 'reading:fixture-a', title: 'Python 数据分析入门', type: 'video', url: 'https://www.bilibili.com/video/BV1xx411c7mD/', notes: '收藏的课程' }, { id: 'reading:fixture-b', title: '随手收集的材料', type: 'book', excerpt: '内容暂未整理' }];
const suggestions = [{ id: inputs[0].id, category: 'programming_ai', confidence: 'high', reason: '标题明确介绍 Python 数据分析。' }, { id: inputs[1].id, category: 'other', confidence: 'low', reason: '标题和摘录缺乏主题信息。' }];
const response = (rows: unknown = suggestions) => Response.json({ message: { content: JSON.stringify({ suggestions: rows }) }, done: true });

describe('local Qwen reading classification', () => {
  it('uses only local structured inference and keeps IDs, categories, confidence and review intent', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response([...suggestions].reverse()));
    const result = await new LocalReadingClassifier({ model: 'fixture:4b', request }).classify(inputs);
    expect(result).toMatchObject({ provider: 'ollama', model: 'fixture:4b', status: 'classified', suggestions: [{ ...suggestions[0], needsReview: false }, { ...suggestions[1], needsReview: true }] });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat'); expect(options?.redirect).toBe('error');
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ think: false, stream: false, format: READING_CLASSIFICATION_SCHEMA, options: { temperature: 0, num_ctx: 8192 } });
    expect(body.messages[0].content).toContain('untrusted source data');
    expect(body.messages[0].content).toContain('never claim you watched a video');
    expect(JSON.parse(body.messages[1].content).items[0].id).toBe(inputs[0].id);
  });

  it('samples long context, never fetches source URLs, and marks medium confidence for review', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response([{ ...suggestions[0], confidence: 'medium' }]));
    const result = await new LocalReadingClassifier({ request }).classify([{ ...inputs[0], url: 'http://internal.invalid/private', excerpt: '测试'.repeat(2000), notes: 'n'.repeat(5000) }]);
    expect(result.suggestions[0].needsReview).toBe(true);
    const payload = JSON.parse(JSON.parse(String(request.mock.calls[0][1]?.body)).messages[1].content).items[0];
    expect(payload.excerptSample.length).toBeLessThanOrEqual(1400); expect(payload.notes.length).toBeLessThanOrEqual(80);
    expect(request.mock.calls.every(([url]) => url === 'http://127.0.0.1:11434/api/chat')).toBe(true);
  });

  it('rejects invalid input and cloud/remote configuration before any request', async () => {
    const request = vi.fn<typeof fetch>();
    for (const invalid of [[], Array.from({ length: 9 }, (_, i) => ({ ...inputs[0], id: String(i) })), [inputs[0], inputs[0]], [{ ...inputs[0], title: '' }], [{ ...inputs[0], notes: 'x'.repeat(10001) }]]) {
      await expect(new LocalReadingClassifier({ request }).classify(invalid)).rejects.toMatchObject({ code: 'invalid_input', status: 400 });
    }
    for (const config of [{ model: 'qwen:cloud' }, { model: '../../external' }, { port: NaN }, { port: 80 }]) {
      await expect(new LocalReadingClassifier({ request, ...config }).classify(inputs)).rejects.toMatchObject({ code: 'unavailable', status: 503 });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects changed, missing and duplicate IDs, invalid topics, injected fields and overlong reasons', async () => {
    const invalids = [[suggestions[0]], [suggestions[0], suggestions[0]], [{ ...suggestions[0], id: 'other-id' }, suggestions[1]], [{ ...suggestions[0], category: 'entertainment' }, suggestions[1]], [{ ...suggestions[0], execute: 'do it' }, suggestions[1]], [{ ...suggestions[0], reason: 'x'.repeat(241) }, suggestions[1]]];
    for (const invalid of invalids) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response(invalid));
      await expect(new LocalReadingClassifier({ request }).classify(inputs)).rejects.toMatchObject({ code: 'invalid_output' });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects malformed, truncated and oversized responses without pretending a rules fallback is Qwen', async () => {
    for (const invalid of [Response.json({ message: { content: '{' } }), Response.json({ done_reason: 'length', message: { content: JSON.stringify({ suggestions }) } }), new Response('x'.repeat(64001))]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(invalid);
      await expect(new LocalReadingClassifier({ request }).classify(inputs)).rejects.toMatchObject({ code: 'invalid_output', status: 502 });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it('distinguishes missing model, offline runtime, timeout and user cancellation', async () => {
    await expect(new LocalReadingClassifier({ request: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })) }).classify(inputs)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(new LocalReadingClassifier({ request: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')) }).classify(inputs)).rejects.toMatchObject({ code: 'unavailable' });
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
      if (options?.signal?.aborted) reject(options.signal.reason);
      else options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    await expect(new LocalReadingClassifier({ request, timeoutMs: 5 }).classify(inputs)).rejects.toMatchObject({ code: 'timeout', status: 504 });
    const controller = new AbortController(); controller.abort();
    await expect(new LocalReadingClassifier({ request }).classify(inputs, controller.signal)).rejects.toMatchObject({ code: 'cancelled', status: 499 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
