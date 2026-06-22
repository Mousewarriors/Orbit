import { useEffect, useState } from 'react';

/** One selectable folder in the picker. */
export interface FolderChoice {
  readonly name: string;
  readonly path: string;
}

/**
 * A modal that asks the user to pick one of several equally-strong folder
 * matches when a mission step's project name is ambiguous. Arrow keys move the
 * selection, Enter chooses it, Escape cancels; the scrim click cancels. Keys are
 * captured at the window level (capture phase) so the launcher's own key handler
 * stays inert while the dialog is open.
 */
export function FolderPickerDialog({
  query,
  choices,
  onChoose,
  onCancel,
}: {
  query: string;
  choices: readonly FolderChoice[];
  onChoose: (choice: FolderChoice) => void;
  onCancel: () => void;
}): JSX.Element {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActive((i) => Math.min(i + 1, choices.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const choice = choices[active];
        if (choice) onChoose(choice);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [choices, active, onChoose, onCancel]);

  return (
    <>
      <div className="orbit-scrim" onClick={onCancel} />
      <div
        className="orbit-confirm orbit-folder-picker"
        role="dialog"
        aria-label={`Choose a folder for "${query}"`}
        aria-modal="true"
      >
        <div className="orbit-confirm-title">Which “{query}”?</div>
        <div className="orbit-confirm-body">
          Several indexed folders match. Pick the one to open.
        </div>
        <ul className="orbit-folder-list">
          {choices.map((choice, i) => (
            <li key={choice.path}>
              <button
                className={`orbit-folder-option${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onChoose(choice)}
              >
                <span className="orbit-folder-name">{choice.name}</span>
                <span className="orbit-folder-path">{choice.path}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="orbit-confirm-actions">
          <button className="orbit-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
