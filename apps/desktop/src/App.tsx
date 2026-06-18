import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActionDescriptor,
  RankedItem,
  RankingSignals,
  SearchProvider,
} from '@orbit/shared-types';
import { runSearch } from '@orbit/search-engine';
import { createCommandProvider } from '@orbit/command-model';
import { BRANDING } from '@orbit/branding';
import * as native from './native.js';
import { createBuiltinRegistry, triggerFileIndex } from './builtins.js';
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
import { createIntentProvider } from './intentProvider.js';
import { createAiCommandProvider } from './ai/aiCommands.js';
import { executeAction, type EffectResult } from './execute.js';
import { initAppearance } from './appearance.js';
import { ResultRow } from './components/ResultRow.js';
import { ActionMenu } from './components/ActionMenu.js';
import { Footer } from './components/Footer.js';
import { ClipboardView } from './components/ClipboardView.js';
import { SnippetsView } from './components/SnippetsView.js';
import { QuicklinksView } from './components/QuicklinksView.js';
import { NotesView } from './components/NotesView.js';
import { ExtensionListView } from './components/ExtensionListView.js';
import { AllCommandsView } from './components/AllCommandsView.js';
import { ControlCenterView } from './components/ControlCenterView.js';
import { QuickAiView } from './components/QuickAiView.js';
import { ToolsView } from './components/ToolsView.js';
import { NotificationToast, useNotifications } from './components/NotificationToast.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { describeConfirmation, needsConfirmation } from './confirm.js';
import { decodeControlCenterArg } from './controlCenterState.js';

type View =
  | 'root'
  | 'clipboard'
  | 'snippets'
  | 'quicklinks'
  | 'notes'
  | 'extension-list'
  | 'all-commands'
  | 'control-center'
  | 'quick-ai'
  | 'mcp-tools';

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
  // A consequential action awaiting explicit confirmation (preview shown).
  const [pendingConfirm, setPendingConfirm] = useState<{
    itemId: string;
    action: ActionDescriptor;
  } | null>(null);
  const [view, setView] = useState<View>('root');
  const [viewArg, setViewArg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Providers that failed/timed out on the last completed search, surfaced as a
  // subtle diagnostic so a degraded source is visible rather than silent.
  const [degraded, setDegraded] = useState<string[]>([]);
  // Transient status line for long-running commands run from Root Search (e.g.
  // "Rebuild File Index"), so the launcher gives visible feedback instead of
  // silently closing.
  const [status, setStatus] = useState<string | null>(null);

  const { notifications, dismiss: dismissNotification } = useNotifications();

  const appsRef = useRef<native.NativeApp[]>([]);
  const projectsRef = useRef<Array<{ path: string; name: string | null }>>([]);
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
      createIntentProvider({
        getApps: () => appsRef.current,
        getProjects: () => projectsRef.current,
        fileSearch: async (q, limit) =>
          native.isTauri() ? native.fileSearch(q, { limit }) : [],
        noteSearch: async (q, limit) => (native.isTauri() ? native.noteList(q, limit) : []),
      }),
      createAiCommandProvider(),
      createCalculatorProvider(),
    ],
    [registry],
  );

  // Keep a cached recent ∪ favourite project list for natural-language project
  // resolution ("Continue Orbit", "Open the Orbit project"). Favourites first,
  // then recents, deduped by path.
  const refreshProjects = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      const [favourites, recent] = await Promise.all([
        native.projectMetaListFavourites().catch((): native.ProjectMeta[] => []),
        native.projectMetaListRecent(30).catch((): native.ProjectMeta[] => []),
      ]);
      const byPath = new Map<string, { path: string; name: string | null }>();
      for (const p of [...favourites, ...recent]) {
        if (!byPath.has(p.path)) byPath.set(p.path, { path: p.path, name: p.name });
      }
      projectsRef.current = [...byPath.values()];
    } catch {
      // Keep the previous cache on failure.
    }
  }, []);

  // Refresh the cached application list from native (picks up the background
  // UWP/Store scan — `list_applications` returns whatever the native app index
  // currently holds, which the background scan replaces shortly after startup).
  const refreshApps = useCallback(async () => {
    if (!native.isTauri()) return;
    try {
      appsRef.current = await native.listApplications();
    } catch {
      // Keep the previous cache on failure; the next focus/reindex retries.
    }
  }, []);

  // Initial load: applications + usage signals (only when inside Tauri).
  useEffect(() => {
    if (!native.isTauri()) return;
    void (async () => {
      const loadAll = () =>
        Promise.all([
          native.listApplications(),
          native.usageSnapshot(),
          native.extensionCommands().catch((): native.ExtCommandInfo[] => []),
        ]);
      try {
        // On a packaged release the bundled frontend loads directly from the
        // binary with no dev-server round-trip, so it can fire IPC before
        // Tauri finishes registering managed state.  The root fix moves
        // manage() earlier in lib.rs; this retry is belt-and-suspenders for
        // any residual timing gap and for future regressions.
        let result: Awaited<ReturnType<typeof loadAll>>;
        try {
          result = await loadAll();
        } catch {
          await new Promise<void>((r) => setTimeout(r, 400));
          result = await loadAll();
        }
        const [apps, snapshot, extCommands] = result;
        appsRef.current = apps;
        extCommandsRef.current = extCommands;
        signalsRef.current = buildSignals(snapshot);
        void doSearch(query);
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        // Avoid surfacing raw Tauri internals (e.g. "state not managed for
        // field 'state' on command 'list_applications'").
        setError(
          raw.includes('state not managed')
            ? 'Orbit is still starting up — please close and reopen the launcher.'
            : raw,
        );
      }
    })();
    // The fast startup scan (Start Menu `.lnk` only) is replaced a moment later
    // by a background scan that also enumerates UWP/Store apps (e.g. Calculator)
    // via `Get-StartApps`; re-fetch once that's had time to finish.
    void refreshProjects();
    const timer = setTimeout(() => void refreshApps(), 2000);
    return () => clearTimeout(timer);
    // Intentionally run once on mount; doSearch/query are stable enough here.
  }, []);

  // Make "Reindex Applications" actually refresh what the launcher searches —
  // otherwise the renderer's cached app list never picks up the rescan.
  useEffect(() => {
    effects.set('builtin.apps.reindex', async () => {
      await native.reindexApplications();
      await refreshApps();
    });
  }, [effects, refreshApps]);

  // Poll the file index until the background rebuild finishes, updating the
  // status line with progress and the final indexed/error counts.
  const pollFileIndex = useCallback(async () => {
    for (let i = 0; i < 120; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const s = await native.fileIndexStatus().catch(() => null);
      if (!s) {
        setStatus('File index status unavailable.');
        return;
      }
      if (s.running) {
        setStatus(`Indexing files… ${s.indexed} indexed so far`);
        continue;
      }
      const parts = [`Indexed ${s.indexed} file${s.indexed === 1 ? '' : 's'}`];
      if (s.errors > 0) parts.push(`${s.errors} folder${s.errors === 1 ? '' : 's'} skipped`);
      if (s.unavailable.length > 0) parts.push(`${s.unavailable.length} root(s) unavailable`);
      setStatus(parts.join(' · '));
      return;
    }
  }, []);

  // "Rebuild File Index" (aka "Index Files") must use the same indexing service
  // as Settings → Files: enable indexing on first use (which also kicks off the
  // initial scan), or trigger a rebuild if already enabled — and give visible
  // feedback either way instead of silently doing nothing.
  useEffect(() => {
    effects.set('builtin.files.reindex', async (): Promise<EffectResult> => {
      try {
        const msg = await triggerFileIndex({
          status: native.fileIndexStatus,
          setEnabled: native.fileIndexSetEnabled,
          rebuild: native.fileIndexRebuild,
        });
        setStatus(msg);
        void pollFileIndex();
      } catch (e) {
        setStatus(`Index Files failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return { keepOpen: true };
    });
  }, [effects, pollFileIndex]);

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
          if (update.done) {
            if (update.errors.size > 0) {
              // Structured logging for diagnostics, plus a visible hint.
              for (const [id, msg] of update.errors) {
                console.warn(`[orbit] search provider "${id}" failed: ${msg}`);
              }
              setDegraded([...update.errors.keys()]);
            } else {
              setDegraded([]);
            }
          }
        },
        controller.signal,
      );
    },
    [providers],
  );

  useEffect(() => {
    setError(null); // a fresh query clears any stale action error
    void doSearch(query);
  }, [query, doSearch]);

  // Focus the input whenever the window becomes visible, and re-apply the saved
  // appearance — the Settings window persists changes that we pick up on re-show.
  useEffect(() => {
    void initAppearance();
    const onFocus = () => {
      inputRef.current?.focus();
      void initAppearance();
      void refreshApps();
      void refreshProjects();
    };
    window.addEventListener('focus', onFocus);
    inputRef.current?.focus();
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshApps, refreshProjects]);

  // Restore focus to the search input whenever we return to Root Search from a
  // subview (Clipboard/Snippets/Settings) — the input is freshly mounted, so the
  // mount-time focus effect above doesn't re-run.
  useEffect(() => {
    if (view === 'root') inputRef.current?.focus();
  }, [view]);

  // Run an already-resolved action (past any confirmation gate).
  const executeResolved = useCallback(
    async (itemId: string, action: ActionDescriptor) => {
      try {
        setError(null);
        const outcome = await executeAction(action, { query, effects });
        // Learn from usage for ranking (keyed by item id). Only reached when the
        // action resolved successfully — a failed launch throws and is caught
        // below, so we never record usage for something that didn't happen.
        if (native.isTauri()) void native.recordCommandUsage(itemId).catch(() => {});
        setActionMenuOpen(false);
        if (
          outcome.pushView === 'clipboard' ||
          outcome.pushView === 'snippets' ||
          outcome.pushView === 'quicklinks' ||
          outcome.pushView === 'notes' ||
          outcome.pushView === 'extension-list' ||
          outcome.pushView === 'all-commands' ||
          outcome.pushView === 'control-center' ||
          outcome.pushView === 'quick-ai' ||
          outcome.pushView === 'mcp-tools'
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

  const runItem = useCallback(
    async (ranked: RankedItem | undefined, actionIndex = -1) => {
      if (!ranked) return;
      const { item } = ranked;
      const action =
        actionIndex < 0
          ? item.primaryAction
          : [item.primaryAction, ...(item.secondaryActions ?? [])][actionIndex];
      if (!action) return;
      // Consequential actions are previewed and must be explicitly approved
      // before they run (e.g. "Restart Relay" from the natural-language bar).
      if (needsConfirmation(action)) {
        setActionMenuOpen(false);
        setPendingConfirm({ itemId: item.id, action });
        return;
      }
      await executeResolved(item.id, action);
    },
    [executeResolved],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (actionMenuOpen || pendingConfirm) return; // dialogs handle their own keys
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
    [actionMenuOpen, pendingConfirm, results, selected, query, runItem],
  );

  const confirmPrompt = pendingConfirm ? describeConfirmation(pendingConfirm.action) : null;

  const current = results[selected];

  const closeToRoot = useCallback(() => {
    setView('root');
    setQuery('');
    if (native.isTauri()) void native.hideLauncher().catch(() => {});
  }, []);

  const runCommandById = useCallback(
    async (id: string) => {
      const effect = effects.get(id);
      if (!effect) {
        setView('root');
        return;
      }
      try {
        const outcome = (await effect('')) ?? {};
        const ef = outcome as EffectResult;
        const pushTarget = 'pushView' in outcome ? ef.pushView : undefined;
        if (
          pushTarget === 'clipboard' ||
          pushTarget === 'snippets' ||
          pushTarget === 'quicklinks' ||
          pushTarget === 'notes' ||
          pushTarget === 'extension-list' ||
          pushTarget === 'all-commands' ||
          pushTarget === 'control-center' ||
          pushTarget === 'quick-ai' ||
          pushTarget === 'mcp-tools'
        ) {
          setViewArg(ef.pushViewArg ?? null);
          setView(pushTarget);
        } else {
          closeToRoot();
        }
      } catch {
        setView('root');
      }
    },
    [effects, closeToRoot],
  );

  const runExtFromBrowse = useCallback(
    (extId: string, command: string, mode: string) => {
      if (mode === 'list') {
        setViewArg(`${extId}::${command}`);
        setView('extension-list');
      } else {
        void native.extensionRun(extId, command, '').catch(() => {});
        closeToRoot();
      }
    },
    [closeToRoot],
  );

  const toast = (
    <NotificationToast notifications={notifications} onDismiss={dismissNotification} />
  );

  if (view === 'clipboard') {
    return <><ClipboardView onPop={() => setView('root')} onCopied={closeToRoot} />{toast}</>;
  }

  if (view === 'snippets') {
    return <><SnippetsView onPop={() => setView('root')} onPasted={closeToRoot} />{toast}</>;
  }

  if (view === 'quicklinks') {
    return <><QuicklinksView onPop={() => setView('root')} onOpened={closeToRoot} />{toast}</>;
  }

  if (view === 'notes') {
    return <><NotesView initialNoteId={viewArg} onPop={() => setView('root')} />{toast}</>;
  }

  if (view === 'extension-list') {
    return (
      <>
        <ExtensionListView
          target={viewArg ?? ''}
          onPop={() => setView('root')}
          onDone={closeToRoot}
        />
        {toast}
      </>
    );
  }

  if (view === 'all-commands') {
    return (
      <>
        <AllCommandsView
          definitions={registry.listEnabled()}
          extCommands={extCommandsRef.current}
          onPop={() => setView('root')}
          onRunBuiltin={runCommandById}
          onRunExtension={runExtFromBrowse}
        />
        {toast}
      </>
    );
  }

  if (view === 'control-center') {
    const ccArg = decodeControlCenterArg(viewArg);
    return (
      <>
        <ControlCenterView
          onPop={() => setView('root')}
          initialTab={ccArg.tab}
          initialProject={ccArg.project}
          initialSessionStatus={ccArg.sessionStatus}
        />
        {toast}
      </>
    );
  }

  if (view === 'quick-ai') {
    return <><QuickAiView initialArg={viewArg ?? undefined} onPop={() => setView('root')} />{toast}</>;
  }

  if (view === 'mcp-tools') {
    return <><ToolsView onPop={() => setView('root')} />{toast}</>;
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
      {!error && status && <div className="orbit-status">{status}</div>}
      {!error && query.length > 0 && degraded.length > 0 && (
        <div className="orbit-degraded" title={`Unavailable: ${degraded.join(', ')}`}>
          Some sources are unavailable ({degraded.join(', ')}); other results are unaffected.
        </div>
      )}

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
      {pendingConfirm && confirmPrompt && (
        <ConfirmDialog
          prompt={confirmPrompt}
          onConfirm={() => {
            const { itemId, action } = pendingConfirm;
            setPendingConfirm(null);
            void executeResolved(itemId, action);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
      {toast}
    </div>
  );
}
