import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AI_COMMANDS,
  createAiCommandProvider,
  renderAiCommand,
  type AiCommand,
} from './aiCommands.js';
import { decodeQuickAiArg } from './quickAi.js';

const signal = new AbortController().signal;

describe('renderAiCommand', () => {
  it('substitutes {input} and trims', () => {
    const cmd: AiCommand = {
      id: 'x',
      title: 'X',
      subtitle: '',
      keywords: [],
      template: 'Make JSON for: {input}',
      useClipboard: false,
    };
    expect(renderAiCommand(cmd, '  a user  ')).toBe('Make JSON for: a user');
  });

  it('leaves a template without {input} intact', () => {
    const improve = BUILTIN_AI_COMMANDS.find((c) => c.id === 'ai.cmd.improve')!;
    expect(renderAiCommand(improve, '')).toBe(improve.template);
  });
});

describe('starter library', () => {
  it('has unique ids and non-empty templates', () => {
    const ids = new Set(BUILTIN_AI_COMMANDS.map((c) => c.id));
    expect(ids.size).toBe(BUILTIN_AI_COMMANDS.length);
    for (const c of BUILTIN_AI_COMMANDS) expect(c.template.length).toBeGreaterThan(0);
  });
});

describe('createAiCommandProvider', () => {
  it('previews clipboard commands before sending clipboard content', async () => {
    const items = await createAiCommandProvider().search('improve', signal);
    const improve = items.find((i) => i.id === 'ai.cmd.improve')!;
    const run = improve.primaryAction.run;
    expect(run.kind).toBe('push-view');
    if (run.kind !== 'push-view') throw new Error('expected push-view');
    expect(run.viewId).toBe('quick-ai');
    const launch = decodeQuickAiArg(String(run.args!['id']));
    expect(launch.prompt).toContain('Improve the writing');
    expect(launch.useClipboard).toBe(true);
    expect(launch.autoRun).toBeUndefined();
  });

  it('a clipboard-free command does not pre-attach the clipboard', async () => {
    const items = await createAiCommandProvider().search('json', signal);
    const json = items.find((i) => i.id === 'ai.cmd.json')!;
    const run = json.primaryAction.run;
    if (run.kind !== 'push-view') throw new Error('expected push-view');
    const launch = decodeQuickAiArg(String(run.args!['id']));
    expect(launch.useClipboard).toBeUndefined();
    expect(launch.autoRun).toBe(true);
  });
});

describe('quick-ai launch codec', () => {
  it('round-trips flags and treats a bare string as a prompt', () => {
    expect(decodeQuickAiArg('just a prompt')).toEqual({ prompt: 'just a prompt' });
    expect(decodeQuickAiArg(null)).toEqual({ prompt: '' });
  });
});
