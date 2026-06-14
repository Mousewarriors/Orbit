import { useCallback, useEffect, useRef, useState } from 'react';
import * as native from '../native.js';

/**
 * Notes manager: a searchable list on the left and an autosaving editor on the
 * right. Selecting a note opens it; edits autosave (debounced) and on blur.
 * ⌘N creates a new note, ⌘⌫ deletes the open one, Escape returns to Root Search.
 *
 * `initialNoteId` (from a Root Search note result) opens that note on mount.
 */
export function NotesView({
  initialNoteId,
  onPop,
}: {
  initialNoteId: string | null;
  onPop: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<native.Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialNoteId);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (q: string) => {
    try {
      const list = await native.noteList(q, 200);
      setNotes(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }, []);

  // Initial load; open the requested note or the first one.
  useEffect(() => {
    void (async () => {
      const list = await refresh('');
      const open = initialNoteId
        ? list.find((n) => n.id === initialNoteId)
        : list[0];
      if (open) {
        setActiveId(open.id);
        setTitle(open.title);
        setBody(open.body);
      }
    })();
    // Run once on mount to load notes and open the requested/first note.
  }, []);

  useEffect(() => {
    void refresh(query);
  }, [query, refresh]);

  const persist = useCallback(async () => {
    if (!dirty.current) return;
    const trimmed = title.trim();
    if (!trimmed && !body.trim()) return; // don't persist a truly empty note
    try {
      if (activeId) {
        await native.noteUpdate({ id: activeId, title, body });
      } else {
        const id = crypto.randomUUID();
        await native.noteCreate({ id, title, body });
        setActiveId(id);
      }
      dirty.current = false;
      setSavedAt(Date.now());
      void refresh(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeId, title, body, query, refresh]);

  // Debounced autosave whenever title/body change.
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, body, persist]);

  const openNote = useCallback(
    (note: native.Note) => {
      void persist();
      setActiveId(note.id);
      setTitle(note.title);
      setBody(note.body);
      setError(null);
    },
    [persist],
  );

  const newNote = useCallback(() => {
    void persist();
    setActiveId(null);
    setTitle('');
    setBody('');
    dirty.current = false;
  }, [persist]);

  const deleteActive = useCallback(async () => {
    if (!activeId) {
      setTitle('');
      setBody('');
      dirty.current = false;
      return;
    }
    try {
      await native.noteDelete(activeId);
      dirty.current = false;
      const list = await refresh(query);
      const next = list[0];
      if (next) openNote(next);
      else {
        setActiveId(null);
        setTitle('');
        setBody('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [activeId, query, refresh, openNote]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newNote();
      } else if (mod && e.key === 'Backspace') {
        e.preventDefault();
        void deleteActive();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        void persist();
        onPop();
      }
    },
    [newNote, deleteActive, persist, onPop],
  );

  return (
    <div className="orbit-launcher notes-view" onKeyDown={onKeyDown}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={() => void persist().then(onPop)} aria-label="Back">
          ‹
        </button>
        <span className="orbit-breadcrumb">Notes</span>
        <input
          ref={searchRef}
          className="orbit-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes…"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {error && <div className="orbit-error">⚠ {error}</div>}

      <div className="notes-body">
        <div className="notes-list" role="listbox">
          {notes.length === 0 ? (
            <div className="orbit-empty">{query ? 'No matching notes' : 'No notes — ⌘N to add'}</div>
          ) : (
            notes.map((n) => (
              <div
                key={n.id}
                role="option"
                aria-selected={n.id === activeId}
                className={`orbit-row${n.id === activeId ? ' is-selected' : ''}`}
                onClick={() => openNote(n)}
              >
                <div className="orbit-row-text">
                  <span className="orbit-row-title">{n.title || 'Untitled'}</span>
                  <span className="orbit-row-subtitle">
                    {n.body.split('\n')[0]?.slice(0, 60) || 'Empty'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="notes-editor">
          <input
            className="notes-title"
            value={title}
            onChange={(e) => {
              dirty.current = true;
              setTitle(e.target.value);
            }}
            onBlur={() => void persist()}
            placeholder="Title"
            spellCheck={false}
          />
          <textarea
            className="notes-textarea"
            value={body}
            onChange={(e) => {
              dirty.current = true;
              setBody(e.target.value);
            }}
            onBlur={() => void persist()}
            placeholder="Write a note… (Markdown supported)"
            spellCheck
          />
        </div>
      </div>

      <div className="orbit-footer">
        <span className="orbit-footer-brand">
          Notes{savedAt ? ' · saved' : ''}
        </span>
        <div className="orbit-footer-actions">
          <button className="orbit-hint" onClick={newNote}>
            New<kbd>⌘N</kbd>
          </button>
          <button className="orbit-hint" onClick={() => void deleteActive()}>
            Delete<kbd>⌘⌫</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
