import { useCallback, useEffect, useState } from 'react';
import { BRANDING } from '@orbit/branding';
import type { Appearance, ThemeChoice } from '@orbit/appearance';
import { DEFAULT_APPEARANCE } from '@orbit/appearance';
import * as native from '../native.js';
import { initAppearance, saveAppearance } from '../appearance.js';
import {
  AI_SETTING_KEYS,
  CLOUD_API_KEY_SECRET,
  DEFAULT_AI_SETTINGS,
  parseAiSettings,
  type ConfiguredProviderId,
} from '../ai/providerConfig.js';
import { Toggle, Field, Section, Row } from './controls.js';
import { ShortcutRecorder } from './ShortcutRecorder.js';
import {
  deleteMemory,
  PROFILE_KEYS,
  PROFILE_LABELS,
  setFact,
  toggleMemory,
  type MemoryRecord,
  type MemorySettings,
  type Profile,
  type ProfileKey,
} from '@orbit/profile';
import {
  loadProfileBundle,
  saveMemories,
  saveMemorySettings,
  saveProfile,
} from '../ai/profileStore.js';

type SectionId =
  | 'general'
  | 'appearance'
  | 'ai'
  | 'profile'
  | 'snippets'
  | 'files'
  | 'extensions'
  | 'privacy'
  | 'developer';

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: '⚙' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'ai', label: 'AI', icon: '🤖' },
  { id: 'profile', label: 'Profile & Memory', icon: '👤' },
  { id: 'snippets', label: 'Snippets', icon: '⌨' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'extensions', label: 'Extensions', icon: '🧩' },
  { id: 'privacy', label: 'Privacy', icon: '🔒' },
  { id: 'developer', label: 'Developer', icon: '🛠' },
];

export function Settings(): JSX.Element {
  const [active, setActive] = useState<SectionId>('general');

  // The Settings window applies the saved appearance to itself on open.
  useEffect(() => {
    void initAppearance();
  }, []);

  return (
    <div className="settings-root">
      <nav className="settings-nav" aria-label="Settings sections">
        <div className="settings-brand">{BRANDING.name} Settings</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`settings-nav-item${active === s.id ? ' is-active' : ''}`}
            onClick={() => setActive(s.id)}
            aria-current={active === s.id}
          >
            <span className="settings-nav-icon" aria-hidden>
              {s.icon}
            </span>
            {s.label}
          </button>
        ))}
      </nav>
      <main className="settings-content">
        {active === 'general' && <GeneralSection />}
        {active === 'appearance' && <AppearanceSection />}
        {active === 'ai' && <AiSection />}
        {active === 'profile' && <ProfileSection />}
        {active === 'snippets' && <SnippetsSection />}
        {active === 'files' && <FilesSection />}
        {active === 'extensions' && <ExtensionsSection />}
        {active === 'privacy' && <PrivacySection />}
        {active === 'developer' && <DeveloperSection />}
      </main>
    </div>
  );
}

const DEFAULT_HOTKEY = 'Alt+Space';

function GeneralSection(): JSX.Element {
  const [hotkey, setHotkey] = useState<string>(DEFAULT_HOTKEY);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [autostart, setAutostartState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    void native
      .getSetting('general.hotkey')
      .then((v) => setHotkey(v ?? DEFAULT_HOTKEY))
      .catch(() => {});
    void native
      .getAutostart()
      .then(setAutostartState)
      .catch(() => {});
  }, []);

  const toggleAutostart = useCallback(async (enabled: boolean) => {
    setAutostartBusy(true);
    setError(null);
    try {
      await native.setAutostart(enabled);
      setAutostartState(enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutostartBusy(false);
    }
  }, []);

  const apply = useCallback(async (accelerator: string) => {
    setError(null);
    try {
      await native.setActivationShortcut(accelerator);
      setHotkey(accelerator);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <Section
      title="General"
      description="How you summon Orbit and how it behaves at the system level."
    >
      <Field
        label="Activation shortcut"
        hint="The global hotkey that shows and hides the launcher."
      >
        <ShortcutRecorder value={hotkey} onRecorded={(acc) => void apply(acc)} />
        <button className="settings-btn-ghost" onClick={() => void apply(DEFAULT_HOTKEY)}>
          Reset to {DEFAULT_HOTKEY}
        </button>
      </Field>
      {saved && <p className="settings-ok">Shortcut updated.</p>}
      {error && <p className="settings-err">⚠ {error}</p>}

      <Field
        label="Startup"
        hint="When enabled, Orbit starts automatically when you sign in and waits in the system tray. A single instance is enforced — launching Orbit again just focuses the existing window."
      >
        <Toggle
          label="Launch Orbit at login"
          checked={autostart}
          disabled={autostartBusy}
          onChange={(v) => void toggleAutostart(v)}
        />
      </Field>
    </Section>
  );
}

function AppearanceSection(): JSX.Element {
  const [a, setA] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    void initAppearance().then(setA);
  }, []);

  const update = useCallback(
    (patch: Partial<Appearance>) => {
      const next = { ...a, ...patch };
      setA(next);
      void saveAppearance(next);
    },
    [a],
  );

  return (
    <Section
      title="Appearance"
      description="Theme, transparency and motion. Changes apply to this window now and to the launcher the next time it opens."
    >
      <Field label="Theme">
        <div className="settings-segment" role="radiogroup" aria-label="Theme">
          {(['system', 'dark', 'light'] as ThemeChoice[]).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={a.theme === t}
              className={`settings-segment-btn${a.theme === t ? ' is-active' : ''}`}
              onClick={() => update({ theme: t })}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Surface opacity"
        hint={`${a.opacity}% — lower is more see-through. Disabled when reduced transparency is on.`}
      >
        <input
          type="range"
          min={40}
          max={100}
          step={1}
          value={a.opacity}
          disabled={a.reducedTransparency}
          onChange={(e) => update({ opacity: Number(e.target.value) })}
        />
      </Field>

      <Row>
        <Toggle
          label="Reduced transparency (solid background)"
          checked={a.reducedTransparency}
          onChange={(v) => update({ reducedTransparency: v })}
        />
      </Row>
      <Row>
        <Toggle
          label="Reduced motion (disable animations)"
          checked={a.reducedMotion}
          onChange={(v) => update({ reducedMotion: v })}
        />
      </Row>
    </Section>
  );
}

function AiSection(): JSX.Element {
  const [provider, setProvider] = useState<ConfiguredProviderId>(DEFAULT_AI_SETTINGS.provider);
  const [endpoint, setEndpoint] = useState(DEFAULT_AI_SETTINGS.ollamaEndpoint);
  const [model, setModel] = useState(DEFAULT_AI_SETTINGS.ollamaModel);
  const [cloudBase, setCloudBase] = useState(DEFAULT_AI_SETTINGS.cloudBaseUrl ?? '');
  const [cloudModel, setCloudModel] = useState(DEFAULT_AI_SETTINGS.cloudModel ?? '');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, e, m, cb, cm, keyStored] = await Promise.all([
        native.getSetting(AI_SETTING_KEYS.provider),
        native.getSetting(AI_SETTING_KEYS.endpoint),
        native.getSetting(AI_SETTING_KEYS.model),
        native.getSetting(AI_SETTING_KEYS.cloudBase),
        native.getSetting(AI_SETTING_KEYS.cloudModel),
        native.secretHas(CLOUD_API_KEY_SECRET).catch(() => false),
      ]);
      const s = parseAiSettings({ provider: p, endpoint: e, model: m, cloudBase: cb, cloudModel: cm });
      setProvider(s.provider);
      setEndpoint(s.ollamaEndpoint);
      setModel(s.ollamaModel);
      setCloudBase(s.cloudBaseUrl ?? '');
      setCloudModel(s.cloudModel ?? '');
      setHasKey(keyStored);
    })();
  }, []);

  const choose = useCallback((p: ConfiguredProviderId) => {
    setProvider(p);
    void native.setSetting(AI_SETTING_KEYS.provider, p);
  }, []);

  const saveKey = useCallback(async () => {
    const v = apiKey.trim();
    if (!v) return;
    await native.secretSet(CLOUD_API_KEY_SECRET, v).catch(() => {});
    setApiKey('');
    setHasKey(true);
  }, [apiKey]);

  const removeKey = useCallback(async () => {
    await native.secretDelete(CLOUD_API_KEY_SECRET).catch(() => {});
    setHasKey(false);
  }, []);

  return (
    <Section
      title="AI"
      description="Quick AI uses these settings. Orbit keeps API keys out of plaintext and never uploads context without your action."
    >
      <Field label="Provider" hint="Which engine Quick AI talks to.">
        <div className="settings-segment" role="radiogroup" aria-label="AI provider">
          {([
            ['none', 'None'],
            ['mock', 'Mock (offline)'],
            ['ollama', 'Local Ollama'],
            ['openai-compat', 'Cloud (OpenAI-compatible)'],
          ] as ReadonlyArray<[ConfiguredProviderId, string]>).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={provider === id}
              className={`settings-segment-btn${provider === id ? ' is-active' : ''}`}
              onClick={() => choose(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <p className="settings-note">
        <strong>Mock</strong> is a fully-offline placeholder that proves the Quick AI surface works
        end-to-end — it does not produce real answers. <strong>Local Ollama</strong> now works for
        real via the native HTTP bridge — set the endpoint + model below and Quick AI, AI Commands
        and mission AI-planning stream real tokens on-device. <strong>Cloud (OpenAI-compatible)</strong>
        now works too — set the endpoint, model and an API key (stored in OS secure storage). A
        native Anthropic adapter and AgentOS Auto routing are next.
      </p>

      <Field label="Local Ollama endpoint" hint="Where your local Ollama server is listening.">
        <input
          className="settings-input"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          onBlur={() => void native.setSetting(AI_SETTING_KEYS.endpoint, endpoint)}
          placeholder="http://127.0.0.1:11434"
        />
      </Field>
      <Field label="Local Ollama model">
        <input
          className="settings-input-narrow"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => void native.setSetting(AI_SETTING_KEYS.model, model)}
          placeholder="llama3.1"
        />
      </Field>

      <Field
        label="Cloud endpoint (OpenAI-compatible)"
        hint="Any OpenAI-compatible /v1 base — OpenAI, OpenRouter, or a local server (LM Studio, vLLM)."
      >
        <input
          className="settings-input"
          value={cloudBase}
          onChange={(e) => setCloudBase(e.target.value)}
          onBlur={() => void native.setSetting(AI_SETTING_KEYS.cloudBase, cloudBase)}
          placeholder="https://api.openai.com/v1"
        />
      </Field>
      <Field label="Cloud model">
        <input
          className="settings-input-narrow"
          value={cloudModel}
          onChange={(e) => setCloudModel(e.target.value)}
          onBlur={() => void native.setSetting(AI_SETTING_KEYS.cloudModel, cloudModel)}
          placeholder="gpt-4o-mini"
        />
      </Field>
      <Field
        label="Cloud API key"
        hint="Stored in your OS secure storage (Windows Credential Manager) — never in settings, files or logs."
      >
        {hasKey ? (
          <div className="settings-key-row">
            <span className="settings-key-stored">🔑 Key stored</span>
            <button className="settings-btn" onClick={() => void removeKey()}>
              Remove key
            </button>
          </div>
        ) : (
          <div className="settings-key-row">
            <input
              className="settings-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
            <button className="settings-btn" disabled={!apiKey.trim()} onClick={() => void saveKey()}>
              Save key
            </button>
          </div>
        )}
      </Field>
    </Section>
  );
}

function ProfileSection(): JSX.Element {
  const [profile, setProfileState] = useState<Profile>({ facts: [] });
  const [memories, setMemoriesState] = useState<readonly MemoryRecord[]>([]);
  const [settings, setSettingsState] = useState<MemorySettings>({ enabled: false, privateMode: false });

  useEffect(() => {
    void (async () => {
      const bundle = await loadProfileBundle();
      setProfileState(bundle.profile);
      setMemoriesState(bundle.memories);
      setSettingsState(bundle.memorySettings);
    })();
  }, []);

  const factValue = (key: ProfileKey): string =>
    profile.facts.find((f) => f.key === key)?.value ?? '';

  const updateFact = useCallback((key: ProfileKey, value: string) => {
    setProfileState((prev) => {
      const next = setFact(prev, key, value);
      void saveProfile(next);
      return next;
    });
  }, []);

  const updateMemorySettings = useCallback((patch: Partial<MemorySettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      void saveMemorySettings(next);
      return next;
    });
  }, []);

  const mutateMemories = useCallback((next: MemoryRecord[]) => {
    setMemoriesState(next);
    void saveMemories(next);
  }, []);

  return (
    <Section
      title="Profile & Memory"
      description="Profile is facts you write about yourself; memory is optional, summarised, and every item is shown and deletable. They are kept separate and never uploaded without your action."
    >
      {PROFILE_KEYS.map((key) => (
        <Field key={key} label={PROFILE_LABELS[key]}>
          <input
            className="settings-input"
            defaultValue={factValue(key)}
            onBlur={(e) => updateFact(key, e.target.value)}
            placeholder="—"
          />
        </Field>
      ))}

      <Field label="Memory" hint="When off, no memory is ever used or shown to the model.">
        <Toggle
          label={settings.enabled ? 'Memory on' : 'Memory off'}
          checked={settings.enabled}
          onChange={(v) => updateMemorySettings({ enabled: v })}
        />
      </Field>
      <Field label="Private mode" hint="Don't record new memories from your current activity.">
        <Toggle
          label={settings.privateMode ? 'Private' : 'Recording allowed'}
          checked={settings.privateMode}
          onChange={(v) => updateMemorySettings({ privateMode: v })}
        />
      </Field>

      <div className="settings-memory-list">
        {memories.length === 0 && <p className="settings-note">No memories yet.</p>}
        {memories.map((m) => (
          <div key={m.id} className="settings-memory-row">
            <Toggle
              label=""
              checked={m.enabled}
              onChange={() => mutateMemories(toggleMemory(memories, m.id))}
            />
            <span className="settings-memory-content">{m.content}</span>
            {m.sensitive && <span className="settings-memory-sensitive">sensitive</span>}
            <button
              className="settings-memory-delete"
              onClick={() => mutateMemories(deleteMemory(memories, m.id))}
            >
              Delete
            </button>
          </div>
        ))}
        {memories.length > 0 && (
          <button className="settings-btn" onClick={() => mutateMemories([])}>
            Clear all memory
          </button>
        )}
      </div>
    </Section>
  );
}

function SnippetsSection(): JSX.Element {
  const [status, setStatus] = useState<native.WatcherStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await native.snippetWatcherStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await native.snippetWatcherSetEnabled(enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const restart = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await native.snippetWatcherRestart());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const supported = status?.supported ?? true;

  return (
    <Section
      title="Snippets"
      description="System-wide keyword expansion. Type a snippet's keyword in any app and Orbit replaces it with the snippet's text."
    >
      {!supported && (
        <p className="settings-note">
          System-wide expansion is only available on Windows in this build. You can still paste
          snippets from the launcher.
        </p>
      )}
      <Row>
        <Toggle
          label="Enable system-wide keyword expansion"
          checked={status?.running ?? false}
          disabled={busy || !supported}
          onChange={(v) => void setEnabled(v)}
        />
      </Row>
      <div className="settings-status">
        <span className={`settings-dot${status?.running ? ' is-on' : ''}`} aria-hidden />
        {status?.running
          ? `Watching — ${status.keyword_count} keyword${status.keyword_count === 1 ? '' : 's'} active`
          : 'Not watching'}
      </div>
      <Field
        label="Troubleshooting"
        hint="If expansion stops firing (for example after switching users), reinstall the keyboard hook."
      >
        <button
          className="settings-btn-ghost"
          disabled={busy || !status?.running}
          onClick={() => void restart()}
        >
          Restart watcher
        </button>
      </Field>
      <p className="settings-note">
        Manage snippet text and keywords from the launcher → “Snippets”. Expansion injects the
        snippet's raw text; dynamic placeholders like {'{date}'} are resolved when you paste from the
        launcher.
      </p>
      {error && <p className="settings-err">⚠ {error}</p>}
    </Section>
  );
}

function FilesSection(): JSX.Element {
  const [status, setStatus] = useState<native.FileIndexStatus | null>(null);
  const [roots, setRoots] = useState('');
  const [excludes, setExcludes] = useState('');
  const [includeHidden, setIncludeHidden] = useState(false);
  const [contentIndexing, setContentIndexing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await native.fileIndexStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void native.getSetting('files.roots').then((v) => setRoots(v ?? ''));
    void native.getSetting('files.excludes').then((v) => setExcludes(v ?? ''));
    void native
      .getSetting('files.include_hidden')
      .then((v) => setIncludeHidden(v === 'true'));
    void native
      .getSetting('files.content_indexing')
      .then((v) => setContentIndexing(v === 'true'));
  }, [refresh]);

  // Poll progress while a rebuild is in flight.
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(() => void refresh(), 600);
    return () => clearInterval(t);
  }, [status?.running, refresh]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await native.fileIndexSetEnabled(enabled));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const rebuild = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Persist current root/exclude edits first so the rebuild uses them.
      await native.setSetting('files.roots', roots);
      await native.setSetting('files.excludes', excludes);
      await native.setSetting('files.include_hidden', String(includeHidden));
      await native.setSetting('files.content_indexing', String(contentIndexing));
      setStatus(await native.fileIndexRebuild());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [roots, excludes, includeHidden, contentIndexing]);

  const clearIndex = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await native.fileIndexClear());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // First-run helper: enable indexing for the sensible default user folders
  // (Desktop / Documents / Downloads, as resolved natively) and rebuild.
  const useDefaults = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await native.setSetting('files.roots', ''); // empty → native defaults
      setRoots('');
      await native.fileIndexSetEnabled(true);
      setStatus(await native.fileIndexRebuild());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const enabled = status?.enabled ?? false;
  const total = status?.total ?? 0;
  const lastAt = status?.last_indexed_at ?? 0;
  const isFirstRun = enabled && !status?.running && total === 0;

  return (
    <Section
      title="Files"
      description="Index local files and folders so you can find them from Root Search. By default only metadata (names, paths, sizes) is stored; file contents are indexed only if you turn on content indexing below. Everything stays on your device — nothing is uploaded. Orbit never indexes a whole drive automatically."
    >
      <Row>
        <Toggle
          label="Enable local file indexing"
          checked={enabled}
          disabled={busy}
          onChange={(v) => void setEnabled(v)}
        />
      </Row>

      {!enabled && (
        <p className="settings-note">
          File search is off, so typing a filename in Root Search won&apos;t return files. Turn it on
          to index the folders below.
        </p>
      )}

      {isFirstRun && (
        <div className="settings-callout">
          <p>
            <strong>No files indexed yet.</strong> Add folders below and rebuild, or index the usual
            user folders to get started.
          </p>
          <button className="settings-btn" disabled={busy} onClick={() => void useDefaults()}>
            Index Documents, Desktop &amp; Downloads
          </button>
        </div>
      )}

      <div className="settings-status">
        <span className={`settings-dot${status?.running ? ' is-on' : ''}`} aria-hidden />
        {status?.running
          ? `Indexing… ${status.indexed.toLocaleString()} items so far`
          : `${total.toLocaleString()} items indexed${
              lastAt > 0 ? ` · last indexed ${new Date(lastAt).toLocaleString()}` : ''
            }`}
      </div>

      {status && status.unavailable.length > 0 && (
        <p className="settings-err">
          ⚠ {status.unavailable.length} folder{status.unavailable.length === 1 ? '' : 's'} could not
          be found (unavailable drive or deleted folder): {status.unavailable.join(', ')}
        </p>
      )}
      {status && status.errors > 0 && (
        <p className="settings-note">
          {status.errors.toLocaleString()} folder{status.errors === 1 ? '' : 's'} could not be read
          (permission denied) and were skipped.
        </p>
      )}

      <Field
        label="Indexed folders"
        hint="One path per line. Leave empty to use sensible defaults (Desktop, Documents, Downloads)."
      >
        <textarea
          className="settings-textarea"
          rows={3}
          value={roots}
          placeholder={(status?.roots ?? []).join('\n') || 'Default user folders'}
          onChange={(e) => setRoots(e.target.value)}
          onBlur={() => void native.setSetting('files.roots', roots)}
        />
      </Field>
      <Field label="Excluded folders" hint="One name or path per line (node_modules, .git, target are always skipped).">
        <textarea
          className="settings-textarea"
          rows={2}
          value={excludes}
          onChange={(e) => setExcludes(e.target.value)}
          onBlur={() => void native.setSetting('files.excludes', excludes)}
        />
      </Field>
      <Row>
        <Toggle
          label="Include hidden files and folders"
          checked={includeHidden}
          onChange={(v) => {
            setIncludeHidden(v);
            void native.setSetting('files.include_hidden', String(v));
          }}
        />
      </Row>
      <Row>
        <Toggle
          label="Index file contents (text files only)"
          checked={contentIndexing}
          onChange={(v) => {
            setContentIndexing(v);
            void native.setSetting('files.content_indexing', String(v));
          }}
        />
      </Row>
      <p className="settings-note">
        Content indexing lets Root Search match words inside text/code files (small
        files only). The text is stored locally in your index and never uploaded.
        Rebuild after changing this. Off by default.
      </p>
      <Field label="Index" hint="Rebuild after changing folders. Both run in the background.">
        <button className="settings-btn-ghost" disabled={busy || !enabled} onClick={() => void rebuild()}>
          Rebuild index now
        </button>
        <button className="settings-btn-ghost" disabled={busy || total === 0} onClick={() => void clearIndex()}>
          Clear index
        </button>
      </Field>
      {error && <p className="settings-err">⚠ {error}</p>}
    </Section>
  );
}

function ExtensionsSection(): JSX.Element {
  const [exts, setExts] = useState<native.ExtensionInfo[]>([]);
  const [errors, setErrors] = useState<Array<[string, string]>>([]);
  const [devPaths, setDevPaths] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, errs, paths] = await Promise.all([
        native.extensionList(),
        native.extensionErrors(),
        native.extensionGetDevPaths(),
      ]);
      setExts(list);
      setErrors(errs);
      setDevPaths(paths);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setExts(await native.extensionReload());
      setErrors(await native.extensionErrors());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const reloadOne = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        setExts(await native.extensionReloadOne(id));
        setErrors(await native.extensionErrors());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // A missing extension drops out of the list — re-sync so it disappears.
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await native.extensionSetEnabled(id, enabled);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  const installBundled = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setExts(await native.extensionInstallBundled());
      setErrors(await native.extensionErrors());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const saveDevPaths = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setExts(await native.extensionSetDevPaths(devPaths));
      setErrors(await native.extensionErrors());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [devPaths]);

  return (
    <Section
      title="Extensions"
      description="Extensions run in isolated child processes and can only do what their manifest declares. Nothing runs in the launcher itself."
    >
      <Field
        label="Bundled extensions"
        hint="Developer Utilities and AgentOS Controller ship with Orbit. Installing copies them into your local extensions folder; existing folders are left untouched, so this never undoes a deliberate uninstall or disable."
      >
        <button className="settings-btn-ghost" disabled={busy} onClick={() => void installBundled()}>
          Install Bundled Extensions
        </button>
      </Field>

      <Field label="Installed" hint="Disable an extension to hide its commands; a repeatedly crashing extension is disabled automatically.">
        {exts.length === 0 ? (
          <p className="settings-note">No extensions found. Add a folder below to load some.</p>
        ) : (
          <div className="settings-ext-list">
            {exts.map((e) => (
              <div key={e.id} className="settings-ext">
                <div className="settings-ext-main">
                  <div className="settings-ext-title">
                    {e.title} <span className="settings-ext-ver">v{e.version || '0.0.0'}</span>
                    <span className={`settings-ext-health is-${e.health}`}>{e.health}</span>
                  </div>
                  {e.description && <div className="settings-ext-desc">{e.description}</div>}
                  <div className="settings-ext-meta">
                    {e.commands.length > 0
                      ? e.commands.map((c) => c.title).join(' · ')
                      : 'no commands'}
                  </div>
                  <div className="settings-ext-meta">
                    {e.permissions.length > 0
                      ? `Permissions: ${e.permissions.join(', ')}`
                      : 'No permissions requested'}
                  </div>
                  {e.last_error && (
                    <div className="settings-ext-error">Last error: {e.last_error}</div>
                  )}
                  {e.recent_logs && (
                    <details className="settings-ext-logs">
                      <summary>Recent logs</summary>
                      <pre className="settings-ext-logs-body">{e.recent_logs}</pre>
                    </details>
                  )}
                  <div className="settings-ext-actions">
                    <button
                      className="settings-link"
                      onClick={() => void native.launchPath(e.dir).catch(() => {})}
                    >
                      Open folder
                    </button>
                    <button
                      className="settings-link"
                      disabled={busy}
                      onClick={() => void reloadOne(e.id)}
                    >
                      Reload
                    </button>
                  </div>
                </div>
                <Toggle
                  label=""
                  checked={e.enabled}
                  disabled={busy}
                  onChange={(v) => void toggle(e.id, v)}
                />
              </div>
            ))}
          </div>
        )}
      </Field>

      <Field label="Developer folders" hint="One path per line. Point Orbit at folders containing extensions (e.g. the repo's extensions/examples) to load them.">
        <textarea
          className="settings-textarea"
          rows={2}
          value={devPaths}
          onChange={(e) => setDevPaths(e.target.value)}
          placeholder="C:\path\to\Orbit\extensions\examples"
        />
        <button className="settings-btn-ghost" disabled={busy} onClick={() => void saveDevPaths()}>
          Save &amp; reload
        </button>
        <button className="settings-btn-ghost" disabled={busy} onClick={() => void reload()}>
          Reload
        </button>
      </Field>

      {errors.length > 0 && (
        <Field label="Failed to load">
          <ul className="settings-ext-errors">
            {errors.map(([dir, msg]) => (
              <li key={dir}>
                <span className="settings-mono">{dir}</span> — {msg}
              </li>
            ))}
          </ul>
        </Field>
      )}
      {error && <p className="settings-err">⚠ {error}</p>}
    </Section>
  );
}

function PrivacySection(): JSX.Element {
  const [clipboardEnabled, setClipboardEnabled] = useState(true);
  const [retention, setRetention] = useState('500');
  const [cleared, setCleared] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [enabled, ret] = await Promise.all([
          native.getSetting('privacy.clipboard.enabled'),
          native.getSetting('privacy.clipboard.retention'),
        ]);
        setClipboardEnabled(enabled !== 'false');
        if (ret) setRetention(ret);
      } catch {
        /* defaults are fine */
      }
    })();
  }, []);

  const persist = useCallback(async (key: string, value: string) => {
    try {
      await native.setSetting(key, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <Section
      title="Privacy"
      description="Orbit stores everything locally. Nothing is uploaded. Control what is captured and for how long."
    >
      <Row>
        <Toggle
          label="Capture clipboard history"
          checked={clipboardEnabled}
          onChange={(v) => {
            setClipboardEnabled(v);
            void persist('privacy.clipboard.enabled', String(v));
          }}
        />
      </Row>
      <Field
        label="History retention"
        hint="Maximum number of clipboard entries to keep (10–10000)."
      >
        <input
          type="number"
          min={10}
          max={10000}
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          onBlur={() => void persist('privacy.clipboard.retention', retention)}
          className="settings-input-narrow"
        />
      </Field>
      <Field label="Clipboard history" hint="Permanently delete all stored clipboard entries.">
        <button
          className="settings-btn-danger"
          onClick={() => {
            void (async () => {
              try {
                setCleared(await native.clipboardClear());
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })();
          }}
        >
          Clear clipboard history
        </button>
        {cleared != null && <span className="settings-ok"> Removed {cleared} entries.</span>}
      </Field>
      {error && <p className="settings-err">⚠ {error}</p>}
    </Section>
  );
}

function DeveloperSection(): JSX.Element {
  const [diag, setDiag] = useState<native.Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void native
      .diagnostics()
      .then(setDiag)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Copy a diagnostics JSON blob for bug reports (no secrets — just version,
  // platform and the local data/db paths the user already sees above).
  const copyDiagnostics = useCallback(async () => {
    if (!diag) return;
    setError(null);
    try {
      const blob = JSON.stringify(
        { ...diag, app: BRANDING.name, exported_at: new Date().toISOString() },
        null,
        2,
      );
      await native.clipboardSet(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [diag]);

  return (
    <Section title="Developer" description="Diagnostics and local data locations.">
      <dl className="settings-kv">
        <dt>Version</dt>
        <dd>{diag?.version ?? '—'}</dd>
        <dt>Platform</dt>
        <dd>{diag?.platform ?? '—'}</dd>
        <dt>Data folder</dt>
        <dd className="settings-mono">{diag?.data_dir ?? '—'}</dd>
        <dt>Database</dt>
        <dd className="settings-mono">{diag?.db_path ?? '—'}</dd>
      </dl>
      <Field label="Diagnostics" hint="Local only — version, platform and data paths. No secrets are included.">
        <button className="settings-btn-ghost" onClick={() => void native.openDataDir()}>
          Open data folder
        </button>
        <button className="settings-btn-ghost" disabled={!diag} onClick={() => void copyDiagnostics()}>
          Copy diagnostics
        </button>
        {copied && <span className="settings-ok"> Copied.</span>}
      </Field>
      {error && <p className="settings-err">⚠ {error}</p>}
    </Section>
  );
}
