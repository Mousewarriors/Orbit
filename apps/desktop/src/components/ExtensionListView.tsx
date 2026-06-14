import { useCallback, useEffect, useRef, useState } from 'react';
import * as native from '../native.js';

/**
 * Renders a `list`-mode extension command. The view holds its own query, debounces
 * it, and re-invokes the extension's child process for each search; selecting an
 * item performs its (already permission-brokered) action. Escape returns to Root
 * Search.
 *
 * `target` is "<extId>::<command>" (from the provider's push-view action).
 */
export function ExtensionListView({
  target,
  onPop,
  onDone,
}: {
  target: string;
  onPop: () => void;
  onDone: () => void;
}): JSX.Element {
  const [extId = '', command = ''] = target.split('::');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<native.ExtRunItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invoke = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await native.extensionRun(extId, command, q);
        setItems(result.items);
        setSelected((s) => (s >= result.items.length ? 0 : s));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [extId, command],
  );

  useEffect(() => {
    inputRef.current?.focus();
    void invoke('');
  }, [invoke]);

  // Debounce re-invocation as the user types (each call spawns a child process).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void invoke(query), 150);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, invoke]);

  const runAction = useCallback(
    async (item: native.ExtRunItem | undefined) => {
      if (!item?.action) return;
      const { kind, value } = item.action;
      try {
        if (kind === 'open-url') await native.openUrl(value);
        else if (kind === 'open-path') await native.launchPath(value);
        else if (kind === 'copy') await native.clipboardSet(value);
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onDone],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void runAction(items[selected]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else onPop();
      }
    },
    [items, selected, query, runAction, onPop],
  );

  return (
    <div className="orbit-launcher" onKeyDown={onKeyDown}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back" title="Back (Esc)">
          ‹
        </button>
        <span className="orbit-breadcrumb">{command}</span>
        <input
          ref={inputRef}
          className="orbit-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {error && <div className="orbit-error">⚠ {error}</div>}

      <div className="orbit-results" role="listbox">
        {items.length === 0 ? (
          <div className="orbit-empty">{loading ? 'Loading…' : 'No results'}</div>
        ) : (
          items.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={i === selected}
              className={`orbit-row${i === selected ? ' is-selected' : ''}`}
              onClick={() => setSelected(i)}
              onDoubleClick={() => void runAction(item)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="orbit-icon orbit-icon-plain">🧩</span>
              <div className="orbit-row-text">
                <span className="orbit-row-title">{item.title}</span>
                {item.subtitle && <span className="orbit-row-subtitle">{item.subtitle}</span>}
              </div>
              {item.action && <span className="orbit-row-category">{item.action.kind}</span>}
            </div>
          ))
        )}
      </div>

      <div className="orbit-footer">
        <span className="orbit-footer-brand">Extension</span>
        <div className="orbit-footer-actions">
          <button className="orbit-hint" onClick={() => void runAction(items[selected])}>
            Run<kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
