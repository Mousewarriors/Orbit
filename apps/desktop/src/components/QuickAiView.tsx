import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiError } from '@orbit/ai-runtime';
import * as native from '../native.js';
import {
  AI_SETTING_KEYS,
  createProvider,
  parseAiSettings,
  type ProviderInfo,
} from '../ai/providerConfig.js';
import {
  addRecentPrompt,
  buildMessages,
  decodeQuickAiArg,
  parseRecentPrompts,
  type QuickAiContext,
} from '../ai/quickAi.js';
import { createNativeFetch } from '../ai/nativeFetch.js';
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
  const [confirmPaste, setConfirmPaste] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load provider config, clipboard context and recent prompts.
  useEffect(() => {
    void (async () => {
      if (!native.isTauri()) {
        setInfo(createProvider({ provider: 'mock', ollamaEndpoint: '', ollamaModel: '' }));
        return;
      }
      try {
        const [provider, endpoint, model, recentRaw, clip] = await Promise.all([
          native.getSetting(AI_SETTING_KEYS.provider),
          native.getSetting(AI_SETTING_KEYS.endpoint),
          native.getSetting(AI_SETTING_KEYS.model),
          native.getSetting(AI_SETTING_KEYS.recent),
          native.clipboardList('', 1).catch((): native.ClipboardEntry[] => []),
        ]);
        setInfo(createProvider(parseAiSettings({ provider, endpoint, model }), createNativeFetch()));
        setRecent(parseRecentPrompts(recentRaw));
        setClipboard(clip[0]?.content ?? '');
      } catch {
        setInfo(createProvider({ provider: 'none', ollamaEndpoint: '', ollamaModel: '' }));
      }
    })();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  const contexts = useMemo<QuickAiContext[]>(() => {
    if (useClipboard && clipboard.trim()) {
      return [
        { kind: 'clipboard', label: 'Clipboard', text: clipboard, remote: !(info?.local ?? true) },
      ];
    }
    return [];
  }, [useClipboard, clipboard, info?.local]);

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
