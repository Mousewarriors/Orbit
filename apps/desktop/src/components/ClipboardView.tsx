import { useCallback, useEffect, useRef, useState } from 'react';
import * as native from '../native.js';

/** Format an epoch-ms timestamp as a short relative time. */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Clipboard History view: its own filter input over stored entries. Enter copies
 * the entry back to the clipboard and closes the launcher; Escape pops back to
 * Root Search. Sensitive entries are masked until revealed.
 */
export function ClipboardView({
  onPop,
  onCopied,
}: {
  onPop: () => void;
  onCopied: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<native.ClipboardEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q: string) => {
    try {
      const list = await native.clipboardList(q, 200);
      setEntries(list);
      setSelected((s) => (s >= list.length ? 0 : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void refresh(query);
  }, [query, refresh]);

  const copyEntry = useCallback(
    async (entry: native.ClipboardEntry | undefined) => {
      if (!entry) return;
      try {
        await native.clipboardSet(entry.content);
        onCopied();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onCopied],
  );

  const pasteEntry = useCallback(
    async (entry: native.ClipboardEntry | undefined) => {
      if (!entry) return;
      try {
        await native.hideLauncher().catch(() => {});
        await native.pasteText(entry.content);
        onCopied();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onCopied],
  );

  const deleteEntry = useCallback(
    async (entry: native.ClipboardEntry | undefined) => {
      if (!entry) return;
      await native.clipboardDelete(entry.id);
      void refresh(query);
    },
    [query, refresh],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, entries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) void pasteEntry(entries[selected]);
        else void copyEntry(entries[selected]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else onPop();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') {
        e.preventDefault();
        void deleteEntry(entries[selected]);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        const entry = entries[selected];
        if (entry) {
          setRevealed((prev) => new Set(prev).add(entry.id));
        }
      }
    },
    [entries, selected, query, copyEntry, pasteEntry, deleteEntry, onPop],
  );

  return (
    <div className="orbit-launcher" onKeyDown={onKeyDown}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back" title="Back (Esc)">
          ‹
        </button>
        <span className="orbit-breadcrumb">Clipboard History</span>
        <input
          ref={inputRef}
          className="orbit-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter clipboard…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {error && <div className="orbit-error">⚠ {error}</div>}

      <div className="orbit-results" role="listbox">
        {entries.length === 0 ? (
          <div className="orbit-empty">
            {query ? 'No matching entries' : 'Clipboard history is empty — copy something'}
          </div>
        ) : (
          entries.map((entry, i) => {
            const masked = entry.sensitive && !revealed.has(entry.id);
            return (
              <div
                key={entry.id}
                role="option"
                aria-selected={i === selected}
                className={`orbit-row${i === selected ? ' is-selected' : ''}`}
                onClick={() => setSelected(i)}
                onDoubleClick={() => void copyEntry(entry)}
                onMouseEnter={() => setSelected(i)}
              >
                <span className="orbit-icon orbit-icon-plain">{entry.pinned ? '📌' : '📋'}</span>
                <div className="orbit-row-text">
                  <span className="orbit-row-title">
                    {masked ? '•••••• (sensitive — ⌘R to reveal)' : entry.preview}
                  </span>
                  <span className="orbit-row-subtitle">
                    {entry.kind} · {relativeTime(entry.created_at)}
                    {entry.source_app ? ` · ${entry.source_app}` : ''}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="orbit-footer">
        <span className="orbit-footer-brand">Clipboard</span>
        <div className="orbit-footer-actions">
          <button className="orbit-hint" onClick={() => void copyEntry(entries[selected])}>
            Copy<kbd>↵</kbd>
          </button>
          <button className="orbit-hint" onClick={() => void pasteEntry(entries[selected])}>
            Paste<kbd>⌘↵</kbd>
          </button>
          <button className="orbit-hint" onClick={() => void deleteEntry(entries[selected])}>
            Delete<kbd>⌘⌫</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
