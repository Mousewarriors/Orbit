import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveTemplate } from '@orbit/placeholders';
import { validateQuicklinkInput } from '@orbit/validation';
import * as native from '../native.js';

interface Draft {
  id: string | null;
  title: string;
  target: string;
  alias: string;
}

const EMPTY_DRAFT: Draft = { id: null, title: '', target: '', alias: '' };

function isWebTarget(target: string): boolean {
  return /^(https?|mailto):/i.test(target.trim());
}

/**
 * Quicklinks manager: browse/search, create, edit, delete and open Quicklinks.
 * Enter opens the selected link (resolving placeholders with an empty argument);
 * ⌘N creates, ⌘E edits, ⌘⌫ deletes. Escape pops back to Root Search.
 */
export function QuicklinksView({
  onPop,
  onOpened,
}: {
  onPop: () => void;
  onOpened: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [links, setLinks] = useState<native.Quicklink[]>([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q: string) => {
    try {
      const list = await native.quicklinkList(q, 200);
      setLinks(list);
      setSelected((s) => (s >= list.length ? 0 : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!draft) void refresh(query);
  }, [query, draft, refresh]);

  useEffect(() => {
    if (draft) titleRef.current?.focus();
    else inputRef.current?.focus();
  }, [draft]);

  const openLink = useCallback(
    async (ql: native.Quicklink | undefined) => {
      if (!ql) return;
      try {
        const resolved = resolveTemplate(ql.target, { query: '', now: new Date() }).text;
        await native.hideLauncher().catch(() => {});
        if (isWebTarget(resolved)) await native.openUrl(resolved);
        else await native.launchPath(resolved);
        onOpened();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onOpened],
  );

  const deleteLink = useCallback(
    async (ql: native.Quicklink | undefined) => {
      if (!ql) return;
      try {
        await native.quicklinkDelete(ql.id);
        void refresh(query);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [query, refresh],
  );

  const startEdit = useCallback((ql: native.Quicklink) => {
    setError(null);
    setDraft({ id: ql.id, title: ql.title, target: ql.target, alias: ql.alias ?? '' });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const result = validateQuicklinkInput({
      title: draft.title,
      target: draft.target,
      alias: draft.alias,
    });
    if (!result.ok) {
      setError(result.errors[0]?.message ?? 'invalid quicklink');
      return;
    }
    const payload = {
      title: draft.title.trim(),
      target: draft.target.trim(),
      alias: draft.alias.trim() || null,
    };
    try {
      if (draft.id) await native.quicklinkUpdate({ id: draft.id, ...payload });
      else await native.quicklinkCreate({ id: crypto.randomUUID(), ...payload });
      setDraft(null);
      setError(null);
      void refresh(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft, query, refresh]);

  const onListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setError(null);
        setDraft({ ...EMPTY_DRAFT });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, links.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const ql = links[selected];
        if (ql) startEdit(ql);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void openLink(links[selected]);
      } else if (mod && e.key === 'Backspace') {
        e.preventDefault();
        void deleteLink(links[selected]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else onPop();
      }
    },
    [links, selected, query, openLink, deleteLink, startEdit, onPop],
  );

  const onFormKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void saveDraft();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDraft(null);
        setError(null);
      }
    },
    [saveDraft],
  );

  if (draft) {
    return (
      <div className="orbit-launcher" onKeyDown={onFormKeyDown}>
        <div className="orbit-search">
          <button className="orbit-back" onClick={() => setDraft(null)} aria-label="Back">
            ‹
          </button>
          <span className="orbit-breadcrumb">{draft.id ? 'Edit Quicklink' : 'New Quicklink'}</span>
        </div>

        {error && <div className="orbit-error">⚠ {error}</div>}

        <div className="orbit-form">
          <label className="orbit-field">
            <span className="orbit-label">Title</span>
            <input
              ref={titleRef}
              className="orbit-form-input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Search GitHub"
              spellCheck={false}
            />
          </label>
          <label className="orbit-field">
            <span className="orbit-label">Target (URL or path; supports {'{query}'})</span>
            <input
              className="orbit-form-input"
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              placeholder="https://github.com/search?q={query}"
              spellCheck={false}
            />
          </label>
          <label className="orbit-field">
            <span className="orbit-label">Alias (optional — type it then your query)</span>
            <input
              className="orbit-form-input"
              value={draft.alias}
              onChange={(e) => setDraft({ ...draft, alias: e.target.value })}
              placeholder="gh"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="orbit-footer">
          <span className="orbit-footer-brand">Quicklinks</span>
          <div className="orbit-footer-actions">
            <button className="orbit-hint" onClick={() => void saveDraft()}>
              Save<kbd>⌘↵</kbd>
            </button>
            <button className="orbit-hint" onClick={() => setDraft(null)}>
              Cancel<kbd>Esc</kbd>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="orbit-launcher" onKeyDown={onListKeyDown}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back" title="Back (Esc)">
          ‹
        </button>
        <span className="orbit-breadcrumb">Quicklinks</span>
        <input
          ref={inputRef}
          className="orbit-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search quicklinks…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {error && <div className="orbit-error">⚠ {error}</div>}

      <div className="orbit-results" role="listbox">
        {links.length === 0 ? (
          <div className="orbit-empty">
            {query ? 'No matching quicklinks' : 'No quicklinks yet — press ⌘N to create one'}
          </div>
        ) : (
          links.map((ql, i) => (
            <div
              key={ql.id}
              role="option"
              aria-selected={i === selected}
              className={`orbit-row${i === selected ? ' is-selected' : ''}`}
              onClick={() => setSelected(i)}
              onDoubleClick={() => void openLink(ql)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="orbit-icon orbit-icon-plain">⚡</span>
              <div className="orbit-row-text">
                <span className="orbit-row-title">{ql.title}</span>
                <span className="orbit-row-subtitle">
                  {ql.alias ? `${ql.alias} · ` : ''}
                  {ql.target}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="orbit-footer">
        <span className="orbit-footer-brand">Quicklinks</span>
        <div className="orbit-footer-actions">
          <button className="orbit-hint" onClick={() => void openLink(links[selected])}>
            Open<kbd>↵</kbd>
          </button>
          <button
            className="orbit-hint"
            onClick={() => {
              const ql = links[selected];
              if (ql) startEdit(ql);
            }}
          >
            Edit<kbd>⌘E</kbd>
          </button>
          <button className="orbit-hint" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            New<kbd>⌘N</kbd>
          </button>
          <button className="orbit-hint" onClick={() => void deleteLink(links[selected])}>
            Delete<kbd>⌘⌫</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
