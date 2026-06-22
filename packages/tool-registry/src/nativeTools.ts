/**
 * Orbit's own safe capabilities, expressed as `ToolRecord`s.
 *
 * These are the *whitelisted* operations Orbit already performs through audited
 * native actions (launch an app, reveal a folder, search the index, navigate
 * the Control Center, dispatch a local agent via Relay, run a Quick AI sub-
 * task, restart Relay). Publishing them as tools means the Mission engine and
 * the Approval Centre treat native capabilities and MCP tools uniformly — and,
 * crucially, that a planner can only ever assemble a mission from *this* fixed
 * set of ids, never an arbitrary command.
 */
import { approvalScopesFor, deriveRisk, requiresConfirmation } from './policy.js';
import type { ToolInputSchema, ToolRecord, ToolSideEffect } from './types.js';

/** Stable ids the Mission engine maps to its step kinds. */
export const NATIVE_TOOL_IDS = {
  openApplication: 'native:open_application',
  openProjectInApplication: 'native:open_project_in_application',
  openProjectFolder: 'native:open_project_folder',
  openControlCenter: 'native:open_control_center',
  findFiles: 'native:find_files',
  findNotes: 'native:find_notes',
  dispatchAgent: 'native:dispatch_agent',
  restartRelay: 'native:restart_relay',
  quickAi: 'native:quick_ai',
} as const;

export type NativeToolId = (typeof NATIVE_TOOL_IDS)[keyof typeof NATIVE_TOOL_IDS];

function obj(properties: ToolInputSchema['properties'], required?: readonly string[]): ToolInputSchema {
  return { type: 'object', properties, ...(required ? { required } : {}) };
}

function record(
  id: string,
  title: string,
  description: string,
  inputSchema: ToolInputSchema,
  sideEffects: readonly ToolSideEffect[],
): ToolRecord {
  const risk = deriveRisk(sideEffects);
  return {
    id,
    name: id.split(':').pop() ?? id,
    title,
    description,
    source: 'native',
    inputSchema,
    risk,
    sideEffects,
    requiresConfirmation: requiresConfirmation(sideEffects, risk),
    approvalScopes: approvalScopesFor(risk),
    availability: 'available',
    health: 'healthy',
  };
}

/**
 * Build the native tool catalog. `dispatchAgent` is sourced from Relay (the
 * local execution spine) and is genuinely consequential, so it is marked as a
 * `run-command` side effect → high risk → always confirmed, never persistently
 * approvable.
 */
export function nativeToolRecords(): ToolRecord[] {
  return [
    record(
      NATIVE_TOOL_IDS.openApplication,
      'Open application',
      'Launch an installed application by name.',
      obj({ applicationQuery: { type: 'string', description: 'App name to open' } }, ['applicationQuery']),
      [],
    ),
    record(
      NATIVE_TOOL_IDS.openProjectInApplication,
      'Open project in application',
      'Resolve an installed application and a project — a known project or any indexed folder matching the name — then open that folder in the application.',
      obj(
        {
          applicationQuery: { type: 'string', description: 'Application name or alias' },
          projectQuery: { type: 'string', description: 'Project to resolve' },
        },
        ['applicationQuery', 'projectQuery'],
      ),
      [],
    ),
    record(
      NATIVE_TOOL_IDS.openProjectFolder,
      'Open project folder',
      'Reveal a resolved project folder in the file manager.',
      obj({ projectQuery: { type: 'string', description: 'Project to resolve' } }, ['projectQuery']),
      ['read'],
    ),
    record(
      NATIVE_TOOL_IDS.openControlCenter,
      'Open Control Center',
      'Navigate the Control Center to a tab (projects, sessions, activity, handoffs, approvals…).',
      obj({
        controlCenterTab: { type: 'string', description: 'Tab id' },
        projectQuery: { type: 'string' },
        sessionStatus: { type: 'string' },
      }),
      ['read'],
    ),
    record(
      NATIVE_TOOL_IDS.findFiles,
      'Find files',
      'Search the local file index.',
      obj({ fileQuery: { type: 'string' } }, ['fileQuery']),
      ['read'],
    ),
    record(
      NATIVE_TOOL_IDS.findNotes,
      'Find notes',
      'Search your notes.',
      obj({ noteQuery: { type: 'string' } }, ['noteQuery']),
      ['read'],
    ),
    {
      // Dispatching a local agent runs real work via Orbit Relay → always gated.
      ...record(
        NATIVE_TOOL_IDS.dispatchAgent,
        'Launch agent on project',
        'Create a Relay launch plan for an agent on a project and execute it after confirmation.',
        obj(
          {
            projectQuery: { type: 'string', description: 'Project to resolve' },
            agentPreference: {
              type: 'string',
              description: 'Preferred agent',
              enum: ['best', 'codex', 'claude', 'antigravity', 'openclaw'],
            },
            objective: { type: 'string', description: 'What the agent should do' },
          },
          ['projectQuery'],
        ),
        ['run-command'],
      ),
      source: 'relay',
    },
    record(
      NATIVE_TOOL_IDS.restartRelay,
      'Restart Relay',
      'Restart the Orbit Relay sidecar process.',
      obj({}),
      ['system-change'],
    ),
    record(
      NATIVE_TOOL_IDS.quickAi,
      'Quick AI',
      'Run a one-shot AI sub-task (summarise, explain, draft) and capture its text.',
      obj(
        { prompt: { type: 'string' }, useClipboard: { type: 'boolean' } },
        ['prompt'],
      ),
      ['network'],
    ),
  ];
}
