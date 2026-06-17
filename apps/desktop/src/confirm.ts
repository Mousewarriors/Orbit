/**
 * Confirmation/preview policy for consequential actions.
 *
 * Pure and unit-tested: the launcher consults `needsConfirmation` before running
 * any action, and renders `describeConfirmation` as a preview the user must
 * approve. Keeping the copy here (rather than inline in the component) lets the
 * policy be exercised without a DOM and keeps "what counts as consequential"
 * in one auditable place — in line with the security rule that no destructive
 * or process-affecting action runs without an explicit, visible confirmation.
 */
import type { ActionDescriptor } from '@orbit/shared-types';

/** A consequential action requires explicit confirmation before it runs. */
export function needsConfirmation(action: Pick<ActionDescriptor, 'dangerous'>): boolean {
  return action.dangerous === true;
}

export interface ConfirmationPrompt {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
}

/**
 * Human-readable preview for a consequential action. Known run kinds get
 * specific copy; anything else falls back to a generic but honest warning so a
 * future dangerous action is never silently un-described.
 */
export function describeConfirmation(action: ActionDescriptor): ConfirmationPrompt {
  const run = action.run;
  const cancelLabel = 'Cancel';

  if (run.kind === 'builtin' && run.handler === 'run-command') {
    const commandId = typeof run.args?.['commandId'] === 'string' ? run.args['commandId'] : '';
    if (commandId === 'builtin.cc.restart') {
      return {
        title: 'Restart Relay?',
        body: 'This restarts the Relay sidecar process. Any in-flight Relay requests may be interrupted.',
        confirmLabel: 'Restart Relay',
        cancelLabel,
      };
    }
  }

  if (run.kind === 'paste') {
    return {
      title: 'Replace text?',
      body: 'This types the generated text into the previously focused window, replacing the current selection.',
      confirmLabel: 'Replace',
      cancelLabel,
    };
  }

  return {
    title: `${action.title}?`,
    body: 'This action is consequential and may be hard to undo.',
    confirmLabel: action.title,
    cancelLabel,
  };
}
