import { useEffect } from 'react';
import type { ConfirmationPrompt } from '../confirm.js';

/**
 * A modal preview the user must approve before a consequential action runs.
 * Enter confirms, Escape cancels; the scrim click cancels. Captures keys at the
 * window level (capture phase) so the launcher's own key handler stays inert
 * while the dialog is open.
 */
export function ConfirmDialog({
  prompt,
  onConfirm,
  onCancel,
}: {
  prompt: ConfirmationPrompt;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onConfirm, onCancel]);

  return (
    <>
      <div className="orbit-scrim" onClick={onCancel} />
      <div className="orbit-confirm" role="alertdialog" aria-label={prompt.title} aria-modal="true">
        <div className="orbit-confirm-title">{prompt.title}</div>
        <div className="orbit-confirm-body">{prompt.body}</div>
        <div className="orbit-confirm-actions">
          <button className="orbit-confirm-cancel" onClick={onCancel}>
            {prompt.cancelLabel}
          </button>
          <button className="orbit-confirm-ok" onClick={onConfirm} autoFocus>
            {prompt.confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
