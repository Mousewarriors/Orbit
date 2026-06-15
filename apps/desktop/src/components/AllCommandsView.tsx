import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandDefinition } from '@orbit/shared-types';
import type { ExtCommandInfo } from '../native.js';

interface BrowseRow {
  kind: 'builtin';
  id: string;
  title: string;
  subtitle: string | undefined;
  category: string;
  iconName: string | undefined;
}

interface BrowseExtRow {
  kind: 'extension';
  extId: string;
  command: string;
  title: string;
  subtitle: string | undefined;
  category: string;
  mode: string;
}

type Row = BrowseRow | BrowseExtRow;

function buildRows(definitions: CommandDefinition[], extCommands: ExtCommandInfo[]): Row[] {
  const rows: Row[] = definitions.map((d) => ({
    kind: 'builtin' as const,
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    category: d.category ?? 'General',
    iconName: d.icon?.kind === 'builtin' ? d.icon.name : undefined,
  }));
  for (const c of extCommands) {
    rows.push({
      kind: 'extension' as const,
      extId: c.ext_id,
      command: c.command,
      title: c.title,
      subtitle: c.description ?? c.ext_title,
      category: c.ext_title,
      mode: c.mode,
    });
  }
  return rows;
}

/**
 * Shows all builtin and extension commands grouped by category. Provides a
 * filter input, keyboard navigation, and executes the selected command via
 * the caller's dispatcher. Escape or back returns to Root Search.
 */
export function AllCommandsView({
  definitions,
  extCommands,
  onPop,
  onRunBuiltin,
  onRunExtension,
}: {
  definitions: CommandDefinition[];
  extCommands: ExtCommandInfo[];
  onPop: () => void;
  onRunBuiltin: (id: string) => Promise<void>;
  onRunExtension: (extId: string, command: string, mode: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allRows = useMemo(() => buildRows(definitions, extCommands), [definitions, extCommands]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase().trim();
    if (!f) return allRows;
    return allRows.filter(
      (r) =>
        r.title.toLowerCase().includes(f) ||
        r.category.toLowerCase().includes(f) ||
        (r.subtitle ?? '').toLowerCase().includes(f),
    );
  }, [allRows, filter]);

  useEffect(() => {
    setSelected(0);
  }, [filter]);

  const groups = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of filtered) {
      const existing = map.get(row.category);
      if (existing) existing.push(row);
      else map.set(row.category, [row]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const flatRows = useMemo(() => filtered, [filtered]);

  const run = useCallback(
    async (row: Row | undefined) => {
      if (!row) return;
      if (row.kind === 'builtin') {
        await onRunBuiltin(row.id);
      } else {
        onRunExtension(row.extId, row.command, row.mode);
      }
    },
    [onRunBuiltin, onRunExtension],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, flatRows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void run(flatRows[selected]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (filter) setFilter('');
        else onPop();
      }
    },
    [flatRows, selected, filter, run, onPop],
  );

  let flatIdx = 0;

  return (
    <div className="orbit-launcher" onKeyDown={onKeyDown}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back" title="Back (Esc)">
          ‹
        </button>
        <span className="orbit-breadcrumb">All Commands</span>
        <input
          ref={inputRef}
          className="orbit-search-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter commands…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="orbit-results" role="listbox" aria-label="All commands">
        {groups.length === 0 ? (
          <div className="orbit-empty">No commands match "{filter}"</div>
        ) : (
          groups.map(([cat, rows]) => (
            <div key={cat}>
              <div className="orbit-category-header">{cat}</div>
              {rows.map((row) => {
                const idx = flatIdx++;
                const isSelected = idx === selected;
                return (
                  <div
                    key={row.kind === 'builtin' ? row.id : `${row.extId}::${row.command}`}
                    role="option"
                    aria-selected={isSelected}
                    className={`orbit-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => setSelected(idx)}
                    onDoubleClick={() => void run(row)}
                    onMouseEnter={() => setSelected(idx)}
                  >
                    <div className="orbit-row-text">
                      <span className="orbit-row-title">{row.title}</span>
                      {row.subtitle && (
                        <span className="orbit-row-subtitle">{row.subtitle}</span>
                      )}
                    </div>
                    <span className="orbit-row-category">{cat}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="orbit-footer">
        <span className="orbit-footer-brand">Browse Commands</span>
        <div className="orbit-footer-actions">
          <button className="orbit-hint" onClick={() => void run(flatRows[selected])}>
            Run<kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
