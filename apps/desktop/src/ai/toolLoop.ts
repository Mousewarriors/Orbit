/**
 * Tool-use loop — lets a chat model *call* approved tools (function-calling).
 *
 * This is the bridge between Chat/Quick AI and the Tool Registry: the model is
 * offered Orbit's registered tools (native + AgentOS + any MCP server); when it
 * asks to call one, we gate consequential calls through confirmation, execute it
 * through the registry, feed the bounded result back, and let the model continue
 * until it produces a final answer.
 *
 * Safety: the model can only ever call a tool that is already in the registry
 * (an unknown name is refused, not invented), every consequential call is
 * confirmed, and tool output is fed back as data — never executed. The loop is
 * pure (provider + execute + confirm are injected) so it is unit-tested headless.
 */
import { throwIfAborted, type AiMessage, type AiProvider, type AiToolDef } from '@orbit/ai-runtime';
import type { ToolRecord } from '@orbit/tool-registry';

export type ToolCallStatus = 'running' | 'done' | 'error' | 'denied' | 'unknown-tool';

/** A live, renderable record of one tool call the model made this turn. */
export interface ToolCallCard {
  /** Stable key for React rendering. */
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly source: ToolRecord['source'];
  readonly serverId?: string;
  readonly risk: ToolRecord['risk'];
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: ToolCallStatus;
  readonly result?: string;
  readonly error?: string;
  readonly durationMs?: number;
}

export interface ToolLoopDeps {
  readonly provider: AiProvider;
  readonly model?: string;
  readonly tools: readonly ToolRecord[];
  readonly execute: (
    record: ToolRecord,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<{ ok: boolean; content: string }>;
  readonly confirm: (
    record: ToolRecord,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<boolean>;
  /** Live card updates (emitted as a call moves running → done/error/denied). */
  readonly onCard: (card: ToolCallCard) => void;
  readonly maxRounds?: number;
  readonly signal?: AbortSignal;
}

/** Convert a ToolRecord into the provider's tool definition. */
export function toolRecordToDef(record: ToolRecord): AiToolDef {
  return {
    name: record.name,
    description: record.description || record.title,
    parameters: {
      type: 'object',
      properties: record.inputSchema.properties,
      ...(record.inputSchema.required ? { required: record.inputSchema.required } : {}),
    },
  };
}

const DEFAULT_MAX_ROUNDS = 6;

export interface ToolLoopResult {
  readonly content: string;
  /** Number of tool calls actually executed (approved + run). */
  readonly executed: number;
}

/**
 * Run the conversation with tool-use until the model gives a final answer (or
 * the round budget is exhausted, after which one final answer is requested with
 * tools withheld).
 */
export async function runToolLoop(
  baseMessages: readonly AiMessage[],
  deps: ToolLoopDeps,
): Promise<ToolLoopResult> {
  const defs = deps.tools.map(toolRecordToDef);
  const byName = new Map<string, ToolRecord>();
  for (const t of deps.tools) if (!byName.has(t.name)) byName.set(t.name, t);

  const convo: AiMessage[] = [...baseMessages];
  const maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
  let executed = 0;

  for (let round = 0; round < maxRounds; round++) {
    throwIfAborted(deps.signal);
    const resp = await deps.provider.complete(
      { messages: convo, tools: defs, temperature: 0.3, ...(deps.model ? { model: deps.model } : {}) },
      deps.signal,
    );
    const calls = resp.toolCalls ?? [];
    if (calls.length === 0) {
      return { content: resp.content, executed };
    }

    convo.push({ role: 'assistant', content: resp.content, toolCalls: calls });

    for (let i = 0; i < calls.length; i++) {
      throwIfAborted(deps.signal);
      const call = calls[i]!;
      const key = `r${round}-c${i}-${call.name}`;
      const record = byName.get(call.name);

      if (!record) {
        deps.onCard({
          key,
          name: call.name,
          title: call.name,
          source: 'mcp',
          risk: 'medium',
          args: call.arguments,
          status: 'unknown-tool',
        });
        convo.push({
          role: 'tool',
          toolName: call.name,
          content: `Tool "${call.name}" is not available. Use only the provided tools.`,
        });
        continue;
      }

      const base: ToolCallCard = {
        key,
        name: record.name,
        title: record.title,
        source: record.source,
        ...(record.serverId ? { serverId: record.serverId } : {}),
        risk: record.risk,
        args: call.arguments,
        status: 'running',
      };

      if (record.requiresConfirmation) {
        const approved = await deps.confirm(record, call.arguments);
        if (!approved) {
          deps.onCard({ ...base, status: 'denied' });
          convo.push({
            role: 'tool',
            toolName: call.name,
            content: 'The user declined to run this tool. Do not retry it; continue without it.',
          });
          continue;
        }
      }

      deps.onCard(base);
      const started = Date.now();
      let outcome: { ok: boolean; content: string };
      try {
        outcome = await deps.execute(record, call.arguments);
      } catch (e) {
        outcome = { ok: false, content: e instanceof Error ? e.message : String(e) };
      }
      const durationMs = Date.now() - started;
      executed += 1;

      deps.onCard({
        ...base,
        status: outcome.ok ? 'done' : 'error',
        ...(outcome.ok ? { result: outcome.content } : { error: outcome.content }),
        durationMs,
      });
      convo.push({
        role: 'tool',
        toolName: call.name,
        content: outcome.content || (outcome.ok ? '(no output)' : 'The tool failed.'),
      });
    }
  }

  // Round budget exhausted: ask once more for a final answer, tools withheld.
  throwIfAborted(deps.signal);
  const final = await deps.provider.complete(
    { messages: convo, ...(deps.model ? { model: deps.model } : {}) },
    deps.signal,
  );
  return {
    content: final.content || '(Stopped after reaching the tool-call limit.)',
    executed,
  };
}
