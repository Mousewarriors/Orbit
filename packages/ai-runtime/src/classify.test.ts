import { describe, expect, it } from 'vitest';
import {
  AI_CLASSIFICATION_CONFIDENCE,
  buildClassificationPrompt,
  classifyWithAi,
  parseClassification,
} from './classify.js';
import { MockProvider } from './mock.js';

describe('buildClassificationPrompt', () => {
  it('constrains the model to the allowed intents and JSON-only output', () => {
    const msgs = buildClassificationPrompt('do the thing');
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[0]!.content).toContain('continue_project');
    expect(msgs[0]!.content).toMatch(/only a json object/i);
    expect(msgs[1]).toEqual({ role: 'user', content: 'do the thing' });
  });
});

describe('parseClassification — validation', () => {
  it('accepts a valid intent + whitelisted slots', () => {
    const r = parseClassification('{"intent":"continue_project","slots":{"projectQuery":"Orbit"}}');
    expect(r).not.toBeNull();
    expect(r!.intent).toBe('continue_project');
    expect(r!.slots.projectQuery).toBe('Orbit');
    expect(r!.confidence).toBe(AI_CLASSIFICATION_CONFIDENCE);
    expect(r!.matchedRule).toBe('ai-classifier');
    expect(r!.requiresConfirmation).toBe(true);
  });

  it('tolerates code fences and surrounding prose', () => {
    const r = parseClassification('Sure!\n```json\n{"intent":"show_approvals"}\n```');
    expect(r!.intent).toBe('show_approvals');
  });

  it('rejects an unknown intent (model cannot invent actions)', () => {
    expect(parseClassification('{"intent":"format_hard_drive"}')).toBeNull();
    expect(parseClassification('{"intent":"none"}')).toBeNull();
    expect(parseClassification('not json at all')).toBeNull();
  });

  it('drops unknown slot fields and bad agent preferences', () => {
    const r = parseClassification(
      '{"intent":"launch_agent_on_project","slots":{"projectQuery":"Orbit","agentPreference":"skynet","shellCommand":"rm -rf /","includeLatestHandoff":true}}',
    );
    expect(r!.slots.projectQuery).toBe('Orbit');
    expect(r!.slots.agentPreference).toBeUndefined();
    expect(r!.slots.includeLatestHandoff).toBe(true);
    expect((r!.slots as Record<string, unknown>)['shellCommand']).toBeUndefined();
  });

  it('keeps a valid agent preference', () => {
    const r = parseClassification(
      '{"intent":"launch_agent_on_project","slots":{"agentPreference":"codex"}}',
    );
    expect(r!.slots.agentPreference).toBe('codex');
  });

  it('clamps overly long slot strings', () => {
    const long = 'x'.repeat(500);
    const r = parseClassification(`{"intent":"find_file","slots":{"fileQuery":"${long}"}}`);
    expect(r!.slots.fileQuery!.length).toBe(200);
  });
});

describe('classifyWithAi', () => {
  it('runs the prompt through a provider and validates the result', async () => {
    const provider = new MockProvider({
      reply: '{"intent":"open_application","slots":{"applicationQuery":"Calculator"}}',
    });
    const r = await classifyWithAi('please open the calc thingy', provider);
    expect(r!.intent).toBe('open_application');
    expect(r!.slots.applicationQuery).toBe('Calculator');
  });

  it('returns null when the model declines', async () => {
    const provider = new MockProvider({ reply: '{"intent":"none"}' });
    expect(await classifyWithAi('weather in paris', provider)).toBeNull();
  });
});
