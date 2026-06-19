import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiError } from '@orbit/ai-runtime';
import * as native from '../native.js';
import { AI_SETTING_KEYS, type ProviderInfo } from '../ai/providerConfig.js';
import {
  addRecentPrompt,
  buildMessages,
  decodeQuickAiArg,
  parseRecentPrompts,
  type QuickAiContext,
} from '../ai/quickAi.js';
import { loadProviderInfo } from '../ai/providerLoad.js';
import { loadProfileBundle } from '../ai/profileStore.js';
import { buildContext, type ContextItem, type MemoryRecord, type MemorySettings, type Profile } from '@orbit/profile';
import { describeConfirmation } from '../confirm.js';
import { ConfirmDialog } from './ConfirmDialog.js';

type Status = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';

/**
 * Quick AI — a compact one-shot AI surface. Streams a response from the
 * configured provider, with an optional Clipboard context chip, a clear
 * on-device/leaves-device privacy indicator, and copy / paste-into-active-app
 * output actions (paste is gated by the same confirmation dialog as any
 * consequential action). Honest when no real provider is configured.
 */
export function QuickAiView({
  initialArg,
  onPop,
}: {
  initialArg?: string | undefined;
  onPop: () => void;
}): JSX.Element {
  const launch = useMemo(() => decodeQuickAiArg(initialArg), [initialArg]);
  const [prompt, setPrompt] = useState(launch.prompt);
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [clipboard, setClipboard] = useState<string>('');
  const [useClipboard, setUseClipboard] = useState(launch.useClipboard ?? false);
  const didAutoRun = useRef(false);
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile>({ facts: [] });
  const [memories, setMemories] = useState<readonly MemoryRecord[]>([]);
  const [memorySettings, setMemorySettings] = useState<MemorySettings>({
    enabled: false,
    privateMode: false,
  });
  const [usePersonal, setUsePersonal] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [confirmPaste, setConfirmPaste] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load provider config, clipboard context and recent prompts.
  useEffect(() => {
    void (async () => {
      setInfo(await loadProviderInfo());
      if (!native.isTauri()) return;
      try {
        const [recentRaw, clip] = await Promise.all([
          native.getSetting(AI_SETTING_KEYS.recent),
          native.clipboardList('', 1).catch((): native.ClipboardEntry[] => []),
        ]);
        setRecent(parseRecentPrompts(recentRaw));
        setClipboard(clip[0]?.content ?? '');
        const bundle = await loadProfileBundle();
        setProfile(bundle.profile);
        setMemories(bundle.memories);
        setMemorySettings(bundle.memorySettings);
      } catch {
        /* secondary context is best-effort */
      }
    })();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  const remote = !(info?.local ?? true);

  // Personal context (profile + enabled memories), honouring the memory switch
  // and excluding sensitive items that would leave the device.
  const personalItems = useMemo<ContextItem[]>(
    () => buildContext(profile, memories, memorySettings, { remote }),
    [profile, memories, memorySettings, remote],
  );

  const contexts = useMemo<QuickAiContext[]>(() => {
    const list: QuickAiContext[] = [];
    if (useClipboard && clipboard.trim()) {
      list.push({ kind: 'clipboard', label: 'Clipboard', text: clipboard, remote });
    }
    if (usePersonal) {
      for (const it of personalItems) {
        list.push({ kind: it.kind, label: it.label, text: it.text, remote });
      }
    }
    return list;
  }, [useClipboard, clipboard, usePersonal, personalItems, remote]);

  const run = useCallback(async () => {
    const provider = info?.provider;
    if (!provider || !prompt.trim() || status === 'streaming') return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOutput('');
    setError(null);
    setStatus('streaming');
    // Persist the prompt to recent history.
    const nextRecent = addRecentPrompt(recent, prompt);
    setRecent(nextRecent);
    if (native.isTauri()) {
      void native.setSetting(AI_SETTING_KEYS.recent, JSON.stringify(nextRecent)).catch(() => {});
    }
    try {
      await provider.stream(
        { messages: buildMessages(prompt, contexts), temperature: 0.3 },
        (chunk) => {
          if (chunk.delta) setOutput((o) => o + chunk.delta);
        },
        controller.signal,
      );
      setStatus('done');
    } catch (e) {
      if (e instanceof AiError && e.code === 'cancelled') {
        setStatus('cancelled');
      } else {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [info, prompt, status, recent, contexts]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // AI Commands open Quick AI with autoRun — fire once the provider is ready.
  useEffect(() => {
    if (!didAutoRun.current && launch.autoRun && info?.configured && prompt.trim()) {
      didAutoRun.current = true;
      void run();
    }
  }, [launch.autoRun, info, prompt, run]);

  const copyOutput = useCallback(async () => {
    if (!output) return;
    if (native.isTauri()) await native.clipboardSet(output).catch(() => {});
    else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output);
  }, [output]);

  const doPaste = useCallback(async () => {
    setConfirmPaste(false);
    if (!native.isTauri() || !output) return;
    await native.hideLauncher().catch(() => {});
    await native.pasteText(output).catch(() => {});
    onPop();
  }, [output, onPop]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (confirmPaste) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void run();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (status === 'streaming') stop();
        else onPop();
      }
    },
    [confirmPaste, run, status, stop, onPop],
  );

  const pasteAction = {
    id: 'quickai.replace',
    title: 'Paste into active app',
    run: { kind: 'paste' as const, text: output },
    dangerous: true,
  };

  return (
    <div className="orbit-launcher quick-ai" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back">
          Back
        </button>
        <span className="orbit-breadcrumb">Quick AI</span>
        {info && (
          <span
            className={`quick-ai-badge ${info.local ? 'is-local' : 'is-remote'}`}
            title={info.local ? 'Processed on this device' : 'Sent to a remote service'}
          >
            {info.label} · {info.local ? 'On-device' : 'Leaves device'}
          </span>
        )}
      </div>

      {info && !info.configured ? (
        <div className="quick-ai-empty">
          <p>No AI provider is configured yet.</p>
          <p className="quick-ai-note">
            Quick AI needs a provider. Choose one in Settings → AI (a local offline Mock is available
            now; local Ollama and cloud providers arrive with the native AI bridge).
          </p>
          <button className="settings-btn" onClick={() => void native.openSettings()}>
            Open AI Settings
          </button>
        </div>
      ) : (
        <>
          <textarea
            ref={inputRef}
            className="quick-ai-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ask anything…  (Ctrl/Cmd+Enter to run)"
            rows={3}
            spellCheck={false}
          />

          <div className="quick-ai-chips">
            <button
              className={`quick-ai-chip${useClipboard ? ' is-on' : ''}`}
              disabled={!clipboard.trim()}
              onClick={() => setUseClipboard((v) => !v)}
              title={clipboard.trim() ? clipboard.slice(0, 200) : 'Clipboard is empty'}
            >
              {useClipboard ? '✓ ' : '+ '}Clipboard
            </button>
            <button
              className={`quick-ai-chip${usePersonal ? ' is-on' : ''}`}
              disabled={personalItems.length === 0}
              onClick={() => setUsePersonal((v) => !v)}
              title={
                personalItems.length === 0
                  ? 'No profile or memory yet (add it in Settings → Profile)'
                  : `${personalItems.length} item(s) about you`
              }
            >
              {usePersonal ? '✓ ' : '+ '}Personal
            </button>
            {usePersonal && personalItems.length > 0 && (
              <button className="quick-ai-why" onClick={() => setShowWhy((v) => !v)}>
                {showWhy ? 'Hide' : 'Why this context?'}
              </button>
            )}
            <div className="quick-ai-run">
              {status === 'streaming' ? (
                <button className="quick-ai-stop" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="quick-ai-go" disabled={!prompt.trim()} onClick={() => void run()}>
                  Run
                </button>
              )}
            </div>
          </div>

          {usePersonal && showWhy && (
            <div className="quick-ai-why-panel">
              <div className="quick-ai-why-title">
                Sent to the model {remote ? '(leaves device)' : '(on-device)'}:
              </div>
              {personalItems.map((it, i) => (
                <div key={i} className="quick-ai-why-item">
                  <span className="quick-ai-why-kind">{it.kind === 'profile' ? 'Profile' : 'Memory'}</span>
                  <span className="quick-ai-why-label">{it.label}</span>
                  {it.sensitive && <span className="quick-ai-why-sensitive">sensitive</span>}
                </div>
              ))}
              {memorySettings.enabled ? null : (
                <div className="quick-ai-why-note">Memory is off — only profile facts are included.</div>
              )}
            </div>
          )}

          {error && <div className="orbit-error">⚠ {error}</div>}

          {(output || status === 'streaming') && (
            <div className="quick-ai-output" aria-live="polite">
              {output}
              {status === 'streaming' && <span className="quick-ai-caret">▌</span>}
            </div>
          )}

          {output && status !== 'streaming' && (
            <div className="quick-ai-actions">
              <button onClick={() => void copyOutput()}>Copy</button>
              <button onClick={() => setConfirmPaste(true)}>Paste into active app</button>
            </div>
          )}

          {status === 'idle' && recent.length > 0 && (
            <div className="quick-ai-recent">
              <div className="quick-ai-recent-title">Recent</div>
              {recent.slice(0, 6).map((r) => (
                <button key={r} className="quick-ai-recent-item" onClick={() => setPrompt(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {confirmPaste && (
        <ConfirmDialog
          prompt={describeConfirmation(pasteAction)}
          onConfirm={() => void doPaste()}
          onCancel={() => setConfirmPaste(false)}
        />
      )}
    </div>
  );
}
