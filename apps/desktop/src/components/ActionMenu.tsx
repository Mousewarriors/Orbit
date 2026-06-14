import { useEffect, useState } from 'react';
import type { ActionDescriptor, SearchItem } from '@orbit/shared-types';

/** Compact, keyboard-navigable Action Panel for the selected result. */
export function ActionMenu({
  item,
  onClose,
  onRun,
}: {
  item: SearchItem;
  onClose: () => void;
  onRun: (actionIndex: number) => void;
}): JSX.Element {
  const actions: ActionDescriptor[] = [item.primaryAction, ...(item.secondaryActions ?? [])];
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, actions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onRun(sel);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [actions.length, sel, onRun, onClose]);

  return (
    <>
      <div className="orbit-scrim" onClick={onClose} />
      <div className="orbit-action-menu" role="menu" aria-label="Actions">
        <div className="orbit-action-menu-title">Actions</div>
        {actions.map((a, i) => (
          <div
            key={a.id}
            role="menuitem"
            className={`orbit-action${i === sel ? ' is-selected' : ''}${
              a.style === 'destructive' ? ' is-destructive' : ''
            }`}
            onClick={() => onRun(i)}
            onMouseEnter={() => setSel(i)}
          >
            {a.title}
          </div>
        ))}
      </div>
    </>
  );
}
