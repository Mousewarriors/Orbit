import type { SearchItem } from '@orbit/shared-types';
import { BRANDING } from '@orbit/branding';

export function Footer({
  item,
  onPrimary,
  onActions,
}: {
  item: SearchItem | undefined;
  onPrimary: () => void;
  onActions: () => void;
}): JSX.Element {
  return (
    <div className="orbit-footer">
      <span className="orbit-footer-brand">{BRANDING.name}</span>
      <div className="orbit-footer-actions">
        {item && (
          <button className="orbit-hint" onClick={onPrimary}>
            {item.primaryAction.title}
            <kbd>↵</kbd>
          </button>
        )}
        {item && (item.secondaryActions?.length ?? 0) > 0 && (
          <button className="orbit-hint" onClick={onActions}>
            Actions
            <kbd>⌘K</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
