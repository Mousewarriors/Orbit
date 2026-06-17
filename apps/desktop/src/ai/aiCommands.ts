/**
 * AI Commands — reusable, named AI behaviours that open Quick AI pre-filled and
 * run against the configured provider. This slice ships a curated starter
 * library plus a Root Search provider; a user-editable command store comes
 * later. Each command is a static instruction (optionally operating on the
 * clipboard as context); `{input}` is substituted from any text typed after the
 * command name in Root Search.
 *
 * Pure and unit-tested — no native or React here.
 */
import type { SearchItem, SearchProvider } from '@orbit/shared-types';
import { encodeQuickAiArg } from './quickAi.js';

export interface AiCommand {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly keywords: readonly string[];
  /** Instruction sent to the model; may contain a single `{input}` placeholder. */
  readonly template: string;
  /** Auto-include the latest clipboard entry as context. */
  readonly useClipboard: boolean;
}

/** Replace `{input}` with the user's text; collapse leftover whitespace. */
export function renderAiCommand(command: AiCommand, input: string): string {
  return command.template.replace(/\{input\}/g, input.trim()).replace(/[ \t]+\n/g, '\n').trim();
}

/** Curated starter commands. All operate on the clipboard unless noted. */
export const BUILTIN_AI_COMMANDS: readonly AiCommand[] = [
  {
    id: 'ai.cmd.improve',
    title: 'Improve Writing',
    subtitle: 'Polish the clipboard text',
    keywords: ['improve', 'writing', 'polish', 'rewrite', 'editor'],
    template: 'Improve the writing of the provided text. Keep the meaning and tone; return only the improved text.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.grammar',
    title: 'Fix Spelling & Grammar',
    subtitle: 'Correct the clipboard text',
    keywords: ['grammar', 'spelling', 'proofread', 'fix', 'correct'],
    template: 'Correct any spelling and grammar mistakes in the provided text. Return only the corrected text.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.shorter',
    title: 'Make Shorter',
    subtitle: 'Condense the clipboard text',
    keywords: ['shorten', 'concise', 'condense', 'tighten'],
    template: 'Rewrite the provided text to be as concise as possible without losing meaning. Return only the rewritten text.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.professional',
    title: 'Make Professional',
    subtitle: 'Rewrite in a professional tone',
    keywords: ['professional', 'formal', 'tone', 'business'],
    template: 'Rewrite the provided text in a clear, professional tone. Return only the rewritten text.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.summarise',
    title: 'Summarise',
    subtitle: 'Summarise the clipboard text',
    keywords: ['summarise', 'summarize', 'tldr', 'digest', 'recap'],
    template: 'Summarise the key points of the provided text as a short bulleted list.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.explain',
    title: 'Explain',
    subtitle: 'Explain the clipboard text or code',
    keywords: ['explain', 'eli5', 'understand', 'code'],
    template: 'Explain the provided text or code clearly and concisely for a competent reader.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.translate-en',
    title: 'Translate to English',
    subtitle: 'Translate the clipboard text',
    keywords: ['translate', 'english', 'language'],
    template: 'Translate the provided text into natural English. Return only the translation.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.commit',
    title: 'Write Commit Message',
    subtitle: 'Draft a commit message from a diff on the clipboard',
    keywords: ['commit', 'git', 'message', 'changelog'],
    template:
      'Write a concise Conventional-Commits message (subject + short body) describing the provided git diff.',
    useClipboard: true,
  },
  {
    id: 'ai.cmd.json',
    title: 'Create JSON',
    subtitle: 'Turn a description into JSON',
    keywords: ['json', 'structure', 'schema', 'convert'],
    template: 'Produce a single valid JSON object representing: {input}. Return only the JSON.',
    useClipboard: false,
  },
];

/**
 * Root Search provider over the AI command library. Matched/ranked by title +
 * keywords; running one opens Quick AI pre-filled with the rendered template
 * (clipboard pre-attached where the command uses it) and auto-runs.
 */
export function createAiCommandProvider(
  commands: readonly AiCommand[] = BUILTIN_AI_COMMANDS,
): SearchProvider {
  return {
    id: 'ai-commands',
    source: 'ai',
    canHandle: (q) => q.trim().length >= 2,
    search(): Promise<SearchItem[]> {
      return Promise.resolve(
        commands.map((cmd) => {
          const prompt = renderAiCommand(cmd, '');
          const item: SearchItem = {
            id: cmd.id,
            title: cmd.title,
            subtitle: cmd.subtitle,
            keywords: ['ai', ...cmd.keywords],
            category: 'AI Commands',
            source: 'ai',
            icon: { kind: 'builtin', name: 'ai' },
            confidence: 0.5,
            primaryAction: {
              id: `${cmd.id}.run`,
              title: 'Run in Quick AI',
              run: {
                kind: 'push-view',
                viewId: 'quick-ai',
                args: {
                  id: encodeQuickAiArg({ prompt, useClipboard: cmd.useClipboard, autoRun: true }),
                },
              },
            },
          };
          return item;
        }),
      );
    },
  };
}
