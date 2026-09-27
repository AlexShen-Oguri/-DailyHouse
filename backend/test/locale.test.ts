import { describe, expect, it } from 'vitest';
import { englishPayload } from '../src/personal/locale';

describe('English import messages', () => {
  it.each([
    ['一次请选择 1–30 项内容导入', 'Choose 1–30 items to import at a time.'],
    ['每项请选择链接或本机文件其中一种来源', 'Choose either a link or a local file for each item.'],
    ['文件不能超过 50 MiB', 'Files cannot exceed 50 MiB.'],
    ['文本文件不能超过 2 MiB', 'Text files cannot exceed 2 MiB.'],
    ['上传记录不存在或已过期，请重新选择文件', 'The upload does not exist or has expired. Choose the file again.'],
    ['内容已修改，请重新运行本机分类。', 'The content was edited. Run local classification again.'],
    ['本机 Qwen 尚未就绪，条目已保留；启动模型后可重试分类。', 'Local Qwen is not ready. Your items are saved; start the model and retry classification.'],
    ['分类服务正在关闭，请稍后重试。', 'Classification is shutting down. Retry later.'],
    ['已有一个文件选择窗口，请先完成或取消它。', 'A file picker is already open. Complete or cancel it first.'],
  ])('translates the fixed message: %s', (message, english) => {
    expect(englishPayload({ message })).toEqual({ message: english });
  });

  it('translates nested preview explanations and failure messages while preserving personal fields', () => {
    const personal = '文件不能超过 50 MiB';
    const original = { candidates: [{ title: personal, notes: personal, attachment: { name: `${personal}.pdf` }, reason: '确认后加入书架，再由本机 Qwen 分类。' }], classification: { status: 'failed', message: 'Qwen 分类超时，条目已保留，可重试或手动分类。' } };
    const output = englishPayload(original) as typeof original;
    expect(output.candidates[0]).toMatchObject({ title: personal, notes: personal, attachment: { name: `${personal}.pdf` }, reason: 'Confirm to add these items to your shelf, then classify them with local Qwen.' });
    expect(output.classification.message).toContain('timed out');
    expect(original.classification.message).toBe('Qwen 分类超时，条目已保留，可重试或手动分类。');
  });

  it('preserves Qwen explanations even when they match a fixed string or a legacy rule template', () => {
    for (const status of ['ready', 'review']) {
      for (const reason of ['主题或学习用途不明确，需要确认后再收录。', '标题包含设计主题，以及教学、原理或实践线索。', '标题介绍了平面设计与字体。']) {
        const classification = { status, model: 'local-qwen', confidence: 'medium', reason };
        expect(englishPayload({ classification })).toEqual({ classification });
      }
    }
  });

  it('keeps user article labels intact while translating only the generated report labels', () => {
    const output = englishPayload({ items: [{ title: '每日科技', origin: 'manual', label: '本机收藏' }, { title: '科技日报', origin: 'report', reportSource: 'tech', reportDate: '2026-09-27' }], sources: [{ id: 'aesthetic', label: '审美图鉴', count: 2 }] }) as { items: { title: string; label?: string }[]; sources: { label: string }[] };
    expect(output.items[0]).toMatchObject({ title: '每日科技', label: '本机收藏' });
    expect(output.items[1].title).toBe('Daily AI & Technology · 2026-09-27');
    expect(output.sources[0].label).toBe('Daily Aesthetic Atlas');
  });
});
