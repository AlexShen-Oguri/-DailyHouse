import { describe, expect, it, vi } from 'vitest';
import { LocalInspirationProvider, INSPIRATION_OUTPUT_SCHEMA } from '../src/personal/inspiration-ai';

const input = { title: 'Flower game', body: 'A small playable gift', sources: [], purpose: 'directions' as const, context: 'One weekend', language: 'en' as const };
const directions = ['Puzzle', 'Letter', 'Workshop'].map(title => ({ title, goal: 'A useful goal', mvp: ['One screen'], assumptions: ['One player'], risks: ['Needs playtesting'], acceptance: ['Finish unaided'], firstStep: 'Draw a screen' }));
const result = () => Response.json({ message: { content: JSON.stringify({ directions }) } });

describe('verified model availability', () => {
  it('distinguishes no service, a missing model, invalid configuration and a malformed listing', async () => {
    const request = vi.fn<typeof fetch>(); const provider = new LocalInspirationProvider({ model: 'qwen:fixture', request });
    request.mockRejectedValueOnce(new TypeError('offline')); expect(await provider.status()).toMatchObject({ configured: false, availability: 'service_unavailable' });
    request.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }))); expect(await provider.status()).toMatchObject({ configured: false, availability: 'model_missing' });
    request.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'qwen:fixture' }] }))); expect(await provider.status()).toMatchObject({ configured: true, availability: 'ready' });
    request.mockResolvedValueOnce(new Response('{}')); expect(await provider.status()).toMatchObject({ configured: false, availability: 'check_failed' });
    expect(await new LocalInspirationProvider({ model: '../bad', request }).status()).toMatchObject({ configured: false, availability: 'invalid_config' }); expect(request).toHaveBeenCalledTimes(4);
  });
});
describe('local inspiration inference', () => {
  it('uses only the fixed loopback chat endpoint with bounded local inference and structured output', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(result()), provider = new LocalInspirationProvider({ model: 'fixture:4b', request });
    expect(await provider.brainstorm(input)).toEqual({ model: 'fixture:4b', directions });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(options?.redirect).toBe('error'); expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ model: 'fixture:4b', think: false, stream: false, keep_alive: '5m', format: INSPIRATION_OUTPUT_SCHEMA, options: { num_ctx: 8192, num_predict: 2200 } });
    expect(body.messages[1].content).toBe(JSON.stringify(input));
  });
  it('reports ready only when the exact model is present in local tags', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ models: [] })).mockResolvedValueOnce(Response.json({ models: [{ name: 'fixture:4b' }] })).mockRejectedValueOnce(new TypeError('offline'));
    const provider = new LocalInspirationProvider({ model: 'fixture:4b', request });
    expect((await provider.status()).configured).toBe(false); expect((await provider.status()).configured).toBe(true); expect((await provider.status()).configured).toBe(false);
    expect(request.mock.calls.every(([url]) => url === 'http://127.0.0.1:11434/api/tags')).toBe(true);
  });
  it('rejects oversized context, malformed model configuration and network destinations before making a request', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(new LocalInspirationProvider({ request }).brainstorm({ ...input, body: 'x'.repeat(6000) })).rejects.toMatchObject({ status: 400 });
    await expect(new LocalInspirationProvider({ request, port: NaN }).brainstorm(input)).rejects.toMatchObject({ status: 503 });
    await expect(new LocalInspirationProvider({ request, model: '../../outside' }).brainstorm(input)).rejects.toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects incomplete, malformed and oversized output without automatic retries', async () => {
    for (const response of [Response.json({ message: { content: '{' } }), Response.json({ message: { content: JSON.stringify({ directions: [directions[0]] }) } }), new Response('x'.repeat(200001))]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(new LocalInspirationProvider({ request }).brainstorm(input)).rejects.toMatchObject({ status: 502 }); expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it('handles missing models, cancellation and timeout without cloud fallback', async () => {
    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(new LocalInspirationProvider({ request: missing }).brainstorm(input)).rejects.toMatchObject({ status: 503 }); expect(missing).toHaveBeenCalledTimes(1);
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
      if (options?.signal?.aborted) reject(options.signal.reason);
      else options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    const controller = new AbortController(); controller.abort();
    await expect(new LocalInspirationProvider({ request }).brainstorm(input, controller.signal)).rejects.toMatchObject({ status: 499 });
    await expect(new LocalInspirationProvider({ request, timeoutMs: 5 }).brainstorm(input)).rejects.toMatchObject({ status: 504 });
  });
});
