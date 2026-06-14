import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveTemplate } from '@orbit/placeholders';
import { validateSnippetInput } from '@orbit/validation';
import * as native from '../native.js';

interface Draft {
  id: string | null; // null → creating a new snippet
  name: string;
  keyword: string;
  content: string;
  description: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: '', keyword: '', content: '', description: '' };

/**
 * Snippets manager: browse/search, create, edit and delete snippets, and paste
 * one into the active app (resolving dynamic placeholders first). Enter pastes
 * the selected snippet; ⌘N creates, ⌘E edits, ⌘⌫ deletes. Escape pops back.
 */
export function SnippetsView({
  onPop,
  onPasted,
}: {
  onPop: () => void;
  onPasted: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [snippets, setSnippets] = useState<native.Snippet[]>([]);
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q: string) => {
    try {
      const list = await native.snippetList(q, 200);
      setSnippets(list);
      setSelected((s) => (s >= list.length ? 0 : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!draft) void refresh(query);
  }, [query, draft, refresh]);

  useEffect(() => {
    if (draft) nameRef.current?.focus();
    else inputRef.current?.focus();
  }, [draft]);

  const pasteSnippet = useCallback(
    async (snippet: native.Snippet | undefined) => {
      if (!snippet) return;
      try {
        const text = resolveTemplate(snippet.content, { now: new Date() }).text;
        await native.hideLauncher().catch(() => {});
        await native.pasteText(text);
        void native.snippetRecordUse(snippet.id).catch(() => {});
        onPasted();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [onPasted],
  );

  const deleteSnippet = useCallback(
    async (snippet: native.Snippet | undefined) => {
      if (!snippet) return;
      try {
        await native.snippetDelete(snippet.id);
        void refresh(query);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [query, refresh],
  );

  const startEdit = useCallback((snippet: native.Snippet) => {
    setError(null);
    setDraft({
      id: snippet.id,
      name: snippet.name,
      keyword: snippet.keyword ?? '',
      content: snippet.content,
      description: snippet.description ?? '',
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const result = validateSnippetInput({
      name: draft.name,
      keyword: draft.keyword,
      content: draft.content,
      description: draft.description,
    });
    if (!result.ok) {
      setError(result.errors[0]?.message ?? 'invalid snippet');
      return;
    }
    const payload = {
      name: draft.name.trim(),
      keyword: draft.keyword.trim() || null,
      content: draft.content,
      description: draft.description.trim() || null,
    };
    try {
      if (draft.id) {
        await native.snippetUpdate({ id: draft.id, ...payload });
      } else {
        await native.snippetCreate({ id: crypto.randomUUID(), ...payload });
      }
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
        setSelected((s) => Math.min(s + 1, snippets.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const s = snippets[selected];
        if (s) startEdit(s);
      } else if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const s = snippets[selected];
        if (s) void native.clipboardSet(resolveTemplate(s.content, { now: new Date() }).text);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void pasteSnippet(snippets[selected]);
      } else if (mod && e.key === 'Backspace') {
        e.preventDefault();
        void deleteSnippet(snippets[selected]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else onPop();
      }
    },
    [snippets, selected, query, pasteSnippet, deleteSnippet, startEdit, onPop],
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
          <span className="orbit-breadcrumb">{draft.id ? 'Edit Snippet' : 'New Snippet'}</span>
        </div>

        {error && <div className="orbit-error">⚠ {error}</div>}

        <div className="orbit-form">
          <label className="orbit-field">
            <span className="orbit-label">Name</span>
            <input
              ref={nameRef}
              className="orbit-form-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Email signature"
              spellCheck={false}
            />
          </label>
          <label className="orbit-field">
            <span className="orbit-label">Keyword (optional — types to expand)</span>
            <input
              className="orbit-form-input"
              value={draft.keyword}
              onChange={(e) => setDraft({ ...draft, keyword: e.target.value })}
              placeholder=";sig"
              spellCheck={false}
            />
          </label>
          <label className="orbit-field">
            <span className="orbit-label">Content (supports placeholders like {'{date}'})</span>
            <textarea
              className="orbit-form-textarea"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder={'Best regards,\nSimon'}
              rows={6}
              spellCheck={false}
            />
          </label>
        </div>

        <div className="orbit-footer">
          <span className="orbit-footer-brand">Snippets</span>
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
        <span className="orbit-breadcrumb">Snippets</span>
        <input
          ref={inputRef}
          className="orbit-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search snippets…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {error && <div className="orbit-error">⚠ {error}</div>}

      <div className="orbit-results" role="listbox">
        {snippets.length === 0 ? (
          <div className="orbit-empty">
            {query ? 'No matching snippets' : 'No snippets yet — press ⌘N to create one'}
          </div>
        ) : (
          snippets.map((s, i) => (
            <div
              key={s.id}
              role="option"
              aria-selected={i === selected}
              className={`orbit-row${i === selected ? ' is-selected' : ''}`}
              onClick={() => setSelected(i)}
              onDoubleClick={() => void pasteSnippet(s)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="orbit-icon orbit-icon-plain">✂️</span>
              <div className="orbit-row-text">
                <span className="orbit-row-title">{s.name}</span>
                <span className="orbit-row-subtitle">
                  {s.keyword ? `⌨ ${s.keyword} · ` : ''}
                  {s.content.split('\n')[0]}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="orbit-footer">
        <span className="orbit-footer-brand">Snippets</span>
        <div className="orbit-footer-actions">
          <button className="orbit-hint" onClick={() => void pasteSnippet(snippets[selected])}>
            Paste<kbd>↵</kbd>
          </button>
          <button
            className="orbit-hint"
            onClick={() => {
              const s = snippets[selected];
              if (s) startEdit(s);
            }}
          >
            Edit<kbd>⌘E</kbd>
          </button>
          <button className="orbit-hint" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            New<kbd>⌘N</kbd>
          </button>
          <button className="orbit-hint" onClick={() => void deleteSnippet(snippets[selected])}>
            Delete<kbd>⌘⌫</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
