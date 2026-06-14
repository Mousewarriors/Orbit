import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RankedItem, RankingSignals, SearchProvider } from '@orbit/shared-types';
import { runSearch } from '@orbit/search-engine';
import { createCommandProvider } from '@orbit/command-model';
import { BRANDING } from '@orbit/branding';
import * as native from './native.js';
import { createBuiltinRegistry } from './builtins.js';
import {
  createAppProvider,
  createCalculatorProvider,
  createFileProvider,
  createExtensionProvider,
  createNoteProvider,
  createQuicklinkProvider,
  createSnippetProvider,
  createToolsProvider,
} from './providers.js';
import { executeAction } from './execute.js';
import { initAppearance } from './appearance.js';
import { ResultRow } from './components/ResultRow.js';
import { ActionMenu } from './components/ActionMenu.js';
import { Footer } from './components/Footer.js';
import { ClipboardView } from './components/ClipboardView.js';
import { SnippetsView } from './components/SnippetsView.js';
import { QuicklinksView } from './components/QuicklinksView.js';
import { NotesView } from './components/NotesView.js';
import { ExtensionListView } from './components/ExtensionListView.js';

type View = 'root' | 'clipboard' | 'snippets' | 'quicklinks' | 'notes' | 'extension-list';

function buildSignals(snapshot: Array<[string, number, number]>): RankingSignals {
  const usage = new Map<string, number>();
  const lastUsed = new Map<string, number>();
  for (const [id, count, last] of snapshot) {
    usage.set(id, count);
    lastUsed.set(id, last);
  }
  return { usage, lastUsed, pinned: new Set(), favourites: new Set(), now: Date.now() };
}

export function App(): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RankedItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [view, setView] = useState<View>('root');
  const [viewArg, setViewArg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const appsRef = useRef<native.NativeApp[]>([]);
  const extCommandsRef = useRef<native.ExtCommandInfo[]>([]);
  const signalsRef = useRef<RankingSignals>(buildSignals([]));
  const searchAbort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { registry, effects } = useMemo(() => createBuiltinRegistry(), []);

  const providers = useMemo<SearchProvider[]>(
    () => [
      createCommandProvider(registry),
      createAppProvider(() => appsRef.current),
      createSnippetProvider(),
      createQuicklinkProvider(),
      createNoteProvider(),
      createFileProvider(),
      createToolsProvider(),
      createExtensionProvider(() => extCommandsRef.current),
      createCalculatorProvider(),
    ],
    [registry],
  );

  // Initial load: applications + usage signals (only when inside Tauri).
  useEffect(() => {
    if (!native.isTauri()) return;
    void (async () => {
      try {
        const [apps, snapshot, extCommands] = await Promise.all([
          native.listApplications(),
          native.usageSnapshot(),
          native.extensionCommands().catch(() => []),
        ]);
        appsRef.current = apps;
        extCommandsRef.current = extCommands;
        signalsRef.current = buildSignals(snapshot);
        void doSearch(query);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // Intentionally run once on mount; doSearch/query are stable enough here.
  }, []);

  const doSearch = useCallback(
    (q: string) => {
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      void runSearch(
        q,
        providers,
        { signals: signalsRef.current, limit: 50 },
        (update) => {
          setResults([...update.results]);
          setSelected((prev) => (prev >= update.results.length ? 0 : prev));
        },
        controller.signal,
      );
    },
    [providers],
  );

  useEffect(() => {
    void doSearch(query);
  }, [query, doSearch]);

  // Focus the input whenever the window becomes visible, and re-apply the saved
  // appearance — the Settings window persists changes that we pick up on re-show.
  useEffect(() => {
    void initAppearance();
    const onFocus = () => {
      inputRef.current?.focus();
      void initAppearance();
    };
    window.addEventListener('focus', onFocus);
    inputRef.current?.focus();
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Restore focus to the search input whenever we return to Root Search from a
  // subview (Clipboard/Snippets/Settings) — the input is freshly mounted, so the
  // mount-time focus effect above doesn't re-run.
  useEffect(() => {
    if (view === 'root') inputRef.current?.focus();
  }, [view]);

  const runItem = useCallback(
    async (ranked: RankedItem | undefined, actionIndex = -1) => {
      if (!ranked) return;
      const { item } = ranked;
      const action =
        actionIndex < 0
          ? item.primaryAction
          : [item.primaryAction, ...(item.secondaryActions ?? [])][actionIndex];
      if (!action) return;
      try {
        const outcome = await executeAction(action, { query, effects });
        // Learn from usage for ranking (keyed by item id).
        if (native.isTauri()) void native.recordCommandUsage(item.id).catch(() => {});
        setActionMenuOpen(false);
        if (
          outcome.pushView === 'clipboard' ||
          outcome.pushView === 'snippets' ||
          outcome.pushView === 'quicklinks' ||
          outcome.pushView === 'notes' ||
          outcome.pushView === 'extension-list'
        ) {
          setViewArg(outcome.pushViewArg ?? null);
          setView(outcome.pushView);
        } else if (outcome.hide) {
          setQuery('');
          if (native.isTauri()) void native.hideLauncher().catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [query, effects],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (actionMenuOpen) return; // ActionMenu handles its own keys
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void runItem(results[selected]);
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (results[selected]) setActionMenuOpen(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else if (native.isTauri()) void native.hideLauncher().catch(() => {});
      }
    },
    [actionMenuOpen, results, selected, query, runItem],
  );

  const current = results[selected];

  const closeToRoot = useCallback(() => {
    setView('root');
    setQuery('');
    if (native.isTauri()) void native.hideLauncher().catch(() => {});
  }, []);

  if (view === 'clipboard') {
    return <ClipboardView onPop={() => setView('root')} onCopied={closeToRoot} />;
  }

  if (view === 'snippets') {
    return <SnippetsView onPop={() => setView('root')} onPasted={closeToRoot} />;
  }

  if (view === 'quicklinks') {
    return <QuicklinksView onPop={() => setView('root')} onOpened={closeToRoot} />;
  }

  if (view === 'notes') {
    return <NotesView initialNoteId={viewArg} onPop={() => setView('root')} />;
  }

  if (view === 'extension-list') {
    return (
      <ExtensionListView
        target={viewArg ?? ''}
        onPop={() => setView('root')}
        onDone={closeToRoot}
      />
    );
  }

  return (
    <div className="orbit-launcher" onKeyDown={onKeyDown}>
      <div className="orbit-search">
        <span className="orbit-search-glyph" aria-hidden>
          ◎
        </span>
        <input
          ref={inputRef}
          className="orbit-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${BRANDING.name}…  apps, commands, calculations`}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search"
        />
      </div>

      {error && <div className="orbit-error">⚠ {error}</div>}

      <div className="orbit-results" role="listbox" aria-label="Results">
        {results.length === 0 ? (
          <div className="orbit-empty">
            {query ? 'No results' : 'Type to search, or run a command'}
          </div>
        ) : (
          results.map((r, i) => (
            <ResultRow
              key={r.item.id}
              ranked={r}
              selected={i === selected}
              onClick={() => {
                setSelected(i);
                void runItem(r);
              }}
              onMouseEnter={() => setSelected(i)}
            />
          ))
        )}
      </div>

      <Footer
        item={current?.item}
        onPrimary={() => void runItem(current)}
        onActions={() => current && setActionMenuOpen(true)}
      />

      {actionMenuOpen && current && (
        <ActionMenu
          item={current.item}
          onClose={() => setActionMenuOpen(false)}
          onRun={(idx) => void runItem(current, idx)}
        />
      )}
    </div>
  );
}
