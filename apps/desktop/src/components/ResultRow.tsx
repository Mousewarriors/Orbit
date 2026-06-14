import type { RankedItem } from '@orbit/shared-types';
import { Icon } from './Icon.js';

export function ResultRow({
  ranked,
  selected,
  onClick,
  onMouseEnter,
}: {
  ranked: RankedItem;
  selected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}): JSX.Element {
  const { item } = ranked;
  return (
    <div
      role="option"
      aria-selected={selected}
      className={`orbit-row${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <Icon source={item.icon} label={item.title} />
      <div className="orbit-row-text">
        <span className="orbit-row-title">{item.title}</span>
        {item.subtitle && <span className="orbit-row-subtitle">{item.subtitle}</span>}
      </div>
      <span className="orbit-row-category">{item.category}</span>
    </div>
  );
}
