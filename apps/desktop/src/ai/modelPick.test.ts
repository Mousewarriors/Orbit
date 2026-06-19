import { describe, expect, it } from 'vitest';
import { isLikelyToolModel, pickDefaultModel, pickToolModel } from './modelPick.js';

describe('modelPick', () => {
  it('recognises tool-capable families and rejects non-tool ones', () => {
    expect(isLikelyToolModel('llama3.1:8b')).toBe(true);
    expect(isLikelyToolModel('qwen2.5:14b')).toBe(true);
    expect(isLikelyToolModel('qwen2.5-coder:7b')).toBe(true);
    expect(isLikelyToolModel('llama3:8b')).toBe(false);
    expect(isLikelyToolModel('llama3:latest')).toBe(false);
    expect(isLikelyToolModel('gemma2:9b')).toBe(false);
  });

  it('picks the first tool-capable model', () => {
    const models = [{ id: 'llama3:latest' }, { id: 'llama3.1:8b' }, { id: 'qwen2.5:14b' }];
    expect(pickToolModel(models)).toBe('llama3.1:8b');
  });

  it('prefers a tool model when requested, else the first', () => {
    const models = [{ id: 'llama3:latest' }, { id: 'llama3.1:8b' }];
    expect(pickDefaultModel(models, true)).toBe('llama3.1:8b');
    expect(pickDefaultModel(models, false)).toBe('llama3:latest');
    expect(pickDefaultModel([{ id: 'llama3:latest' }], true)).toBe('llama3:latest'); // none tool-capable
    expect(pickDefaultModel([], true)).toBeNull();
  });
});
