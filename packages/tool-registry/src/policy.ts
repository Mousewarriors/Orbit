/**
 * Risk + approval policy derivation.
 *
 * A tool declares *what it does* (side effects); this module decides *how
 * dangerous that is* and *how an approval may be remembered*. Keeping it pure
 * and central means the Mission engine, the Approval Centre and the MCP mapper
 * all gate identical operations the same way — there is one policy, not three.
 */
import {
  maxRisk,
  RISK_ORDER,
  type ApprovalScope,
  type ToolRisk,
  type ToolSideEffect,
} from './types.js';

/**
 * The minimum risk each side effect carries. The mandatory-approval categories
 * from the spec (§13.4 / §21) all floor at `medium` or above so they can never
 * be classified safe.
 */
const SIDE_EFFECT_RISK: Readonly<Record<ToolSideEffect, ToolRisk>> = {
  read: 'safe',
  network: 'low',
  'write-file': 'medium',
  'send-message': 'high',
  'run-command': 'high',
  'delete-file': 'high',
  'system-change': 'high',
  'git-push': 'high',
  publish: 'high',
  deploy: 'critical',
  spend: 'critical',
};

/**
 * Side effects that always demand confirmation regardless of any lower risk
 * hint a source might supply (spec §13.4: tools that write/delete/send/run/
 * publish/deploy/spend/change-infrastructure/share-private-data).
 */
const MANDATORY_CONFIRM: ReadonlySet<ToolSideEffect> = new Set<ToolSideEffect>([
  'write-file',
  'delete-file',
  'send-message',
  'run-command',
  'git-push',
  'deploy',
  'publish',
  'spend',
  'system-change',
]);

/** Derive the effective risk from a tool's declared side effects + a base hint. */
export function deriveRisk(
  sideEffects: readonly ToolSideEffect[],
  baseHint: ToolRisk = 'safe',
): ToolRisk {
  let risk: ToolRisk = baseHint;
  for (const effect of sideEffects) {
    risk = maxRisk(risk, SIDE_EFFECT_RISK[effect]);
  }
  return risk;
}

/** Whether a tool with these effects/risk must be confirmed before running. */
export function requiresConfirmation(
  sideEffects: readonly ToolSideEffect[],
  risk: ToolRisk,
): boolean {
  if (RISK_ORDER[risk] >= RISK_ORDER.medium) return true;
  return sideEffects.some((effect) => MANDATORY_CONFIRM.has(effect));
}

/**
 * Which approval scopes the UI may offer for a tool at this risk. Per spec §21,
 * high and critical risk may only ever be approved *once* — never persistently
 * for a mission or a project. Lower-risk consequential tools may be remembered
 * for the duration of a mission or project.
 */
export function approvalScopesFor(risk: ToolRisk): readonly ApprovalScope[] {
  if (RISK_ORDER[risk] >= RISK_ORDER.high) return ['once'];
  if (RISK_ORDER[risk] === RISK_ORDER.medium) return ['once', 'per-mission', 'per-project'];
  // safe/low tools don't need an approval at all; offer none.
  return [];
}

export { SIDE_EFFECT_RISK, MANDATORY_CONFIRM };
