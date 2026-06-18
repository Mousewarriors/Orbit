import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiError, type AiModelInfo } from '@orbit/ai-runtime';
import {
  buildChatMessages,
  CHAT_SYSTEM_PROMPT,
  conversationToMarkdown,
  deriveTitle,
  parseMarkdownBlocks,
  type ConversationMessage,
} from '@orbit/chat';
import { addMemory, buildContext, renderContextBlock, type ContextItem } from '@orbit/profile';
import * as native from '../native.js';
import {
  AI_SETTING_KEYS,
  createProvider,
  parseAiSettings,
  type ProviderInfo,
} from '../ai/providerConfig.js';
import { createNativeFetch } from '../ai/nativeFetch.js';
import { loadProfileBundle, saveMemories } from '../ai/profileStore.js';

type Status = 'idle' | 'streaming';

function genId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * AI Chat — persistent, multi-turn conversation on top of the live provider.
 * Conversations + messages persist in SQLite (orbit-core `chat`); streaming,
 * stop, regenerate, copy, rename/pin/delete and Markdown export all run against
 * the real runtime. Honest when no provider is configured.
 */
export function ChatView({ onPop }: { onPop: () => void }): JSX.Element {
  const [info, setInfo] = useState<ProviderInfo | null>(null);
  const [chats, setChats] = useState<native.Chat[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<native.ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<readonly AiModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [personalItems, setPersonalItems] = useState<ContextItem[]>([]);
  const [memories, setMemories] = useState<Awaited<ReturnType<typeof loadProfileBundle>>['memories']>([]);
  const [usePersonal, setUsePersonal] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const tauri = native.isTauri();

  const refreshChats = useCallback(async () => {
    if (!tauri) return;
    setChats(await native.chatList(search, 100).catch(() => []));
  }, [tauri, search]);

  useEffect(() => {
    void (async () => {
      if (!tauri) {
        setInfo(createProvider({ provider: 'mock', ollamaEndpoint: '', ollamaModel: '' }));
        return;
      }
      const [provider, endpoint, model] = await Promise.all([
        native.getSetting(AI_SETTING_KEYS.provider),
        native.getSetting(AI_SETTING_KEYS.endpoint),
        native.getSetting(AI_SETTING_KEYS.model),
      ]);
      const built = createProvider(parseAiSettings({ provider, endpoint, model }), createNativeFetch());
      setInfo(built);
      setSelectedModel(model?.trim() ?? '');
      await refreshChats();
      // Populate the model list + personal context (both best-effort).
      if (built.provider?.listModels) {
        built.provider.listModels().then(setModels).catch(() => setModels([]));
      }
      const bundle = await loadProfileBundle();
      setMemories(bundle.memories);
      setPersonalItems(
        buildContext(bundle.profile, bundle.memories, bundle.memorySettings, { remote: !built.local }),
      );
    })();
  }, [tauri, refreshChats]);

  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Scroll to the bottom as content grows.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, streaming]);

  const selectChat = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setStatus('idle');
      setStreaming('');
      setCurrentId(id);
      setError(null);
      if (tauri) setMessages(await native.chatMessages(id).catch(() => []));
    },
    [tauri],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setStreaming('');
    setCurrentId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }, []);

  const history = useMemo<ConversationMessage[]>(
    () => messages.map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const runAssistant = useCallback(
    async (chatId: string, convo: ConversationMessage[]) => {
      const provider = info?.provider;
      if (!provider) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('streaming');
      setStreaming('');
      setError(null);
      // Personal context (profile + enabled memories) is prepended to the
      // system prompt as data when the user has opted in.
      const system =
        usePersonal && personalItems.length > 0
          ? `${CHAT_SYSTEM_PROMPT}\n\n${renderContextBlock(personalItems)}`
          : CHAT_SYSTEM_PROMPT;
      const modelName = selectedModel.trim();
      let acc = '';
      try {
        await provider.stream(
          {
            messages: buildChatMessages(convo, system),
            temperature: 0.4,
            ...(modelName ? { model: modelName } : {}),
          },
          (chunk) => {
            if (chunk.delta) {
              acc += chunk.delta;
              setStreaming(acc);
            }
          },
          controller.signal,
        );
        if (tauri) {
          const saved = await native.chatAddMessage(
            genId(),
            chatId,
            'assistant',
            acc,
            modelName || info?.label || null,
          );
          setMessages((prev) => [...prev, saved]);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: genId(), chat_id: chatId, role: 'assistant', content: acc, model: null, seq: prev.length, created_at: Date.now() },
          ]);
        }
      } catch (e) {
        if (!(e instanceof AiError && e.code === 'cancelled')) {
          setError(e instanceof Error ? e.message : String(e));
        }
        // Persist whatever streamed so a cancelled/failed turn isn't lost.
        if (acc && tauri) {
          const saved = await native.chatAddMessage(genId(), chatId, 'assistant', acc, info?.label ?? null).catch(() => null);
          if (saved) setMessages((prev) => [...prev, saved]);
        }
      } finally {
        setStreaming('');
        setStatus('idle');
        void refreshChats();
      }
    },
    [info, tauri, refreshChats, usePersonal, personalItems, selectedModel],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || status === 'streaming' || !info?.provider) return;
    let chatId = currentId;
    if (!chatId) {
      chatId = genId();
      if (tauri) {
        await native.chatCreate(chatId, deriveTitle(text)).catch(() => {});
      }
      setCurrentId(chatId);
    }
    let userMsg: native.ChatMessage;
    if (tauri) {
      userMsg = await native.chatAddMessage(genId(), chatId, 'user', text, null);
    } else {
      userMsg = { id: genId(), chat_id: chatId, role: 'user', content: text, model: null, seq: messages.length, created_at: Date.now() };
    }
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    await runAssistant(
      chatId,
      nextMessages.map((m) => ({ role: m.role, content: m.content })),
    );
    void refreshChats();
  }, [input, status, info, currentId, tauri, messages, runAssistant, refreshChats]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const regenerate = useCallback(async () => {
    if (status === 'streaming' || !currentId) return;
    // Find the last assistant message and drop it + anything after.
    const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === 'assistant');
    if (lastAssistantIdx < 0) return;
    const idx = messages.length - 1 - lastAssistantIdx;
    const fromSeq = messages[idx]!.seq;
    const kept = messages.slice(0, idx);
    if (tauri) await native.chatDeleteFrom(currentId, fromSeq).catch(() => {});
    setMessages(kept);
    await runAssistant(
      currentId,
      kept.map((m) => ({ role: m.role, content: m.content })),
    );
  }, [status, currentId, messages, tauri, runAssistant]);

  const deleteChat = useCallback(
    async (id: string) => {
      if (tauri) await native.chatDelete(id).catch(() => {});
      if (id === currentId) newChat();
      await refreshChats();
    },
    [tauri, currentId, newChat, refreshChats],
  );

  // Branch a new conversation from a message: copies the prefix up to `seq`.
  const branchFrom = useCallback(
    async (seq: number) => {
      if (!currentId || !tauri) return;
      const parentTitle = chats.find((c) => c.id === currentId)?.title ?? 'Chat';
      const id = genId();
      await native.chatBranch(id, currentId, seq, `${parentTitle} (branch)`).catch(() => {});
      await refreshChats();
      await selectChat(id);
    },
    [currentId, tauri, chats, refreshChats, selectChat],
  );

  // Explicit (never silent) save of a message into Memory.
  const saveToMemory = useCallback(
    async (content: string) => {
      const next = addMemory(memories, { id: genId(), content, source: 'chat', createdAt: Date.now() });
      setMemories(next);
      if (tauri) await saveMemories(next).catch(() => {});
      setSavedNote('Saved to memory');
      setTimeout(() => setSavedNote(null), 2000);
    },
    [memories, tauri],
  );

  const togglePin = useCallback(
    async (chat: native.Chat) => {
      if (tauri) await native.chatSetPinned(chat.id, !chat.pinned).catch(() => {});
      await refreshChats();
    },
    [tauri, refreshChats],
  );

  const rename = useCallback(
    async (title: string) => {
      if (currentId && tauri) await native.chatRename(currentId, title).catch(() => {});
      await refreshChats();
    },
    [currentId, tauri, refreshChats],
  );

  const exportChat = useCallback(async () => {
    const title = chats.find((c) => c.id === currentId)?.title ?? 'Chat';
    const md = conversationToMarkdown(title, history);
    if (tauri) await native.clipboardSet(md).catch(() => {});
    else await navigator.clipboard?.writeText(md).catch(() => {});
  }, [chats, currentId, history, tauri]);

  const copyText = useCallback(
    async (text: string) => {
      if (tauri) await native.clipboardSet(text).catch(() => {});
      else await navigator.clipboard?.writeText(text).catch(() => {});
    },
    [tauri],
  );

  const currentChat = chats.find((c) => c.id === currentId) ?? null;

  if (info && !info.configured) {
    return (
      <div className="orbit-launcher chat-view" tabIndex={-1}>
        <div className="orbit-search">
          <button className="orbit-back" onClick={onPop}>
            Back
          </button>
          <span className="orbit-breadcrumb">AI Chat</span>
        </div>
        <div className="quick-ai-empty">
          <p>No AI provider is configured.</p>
          <p className="quick-ai-note">Choose Local Ollama (or Mock) in Settings → AI to start chatting.</p>
          <button className="settings-btn" onClick={() => void native.openSettings()}>
            Open AI Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="orbit-launcher chat-view" tabIndex={-1}>
      <div className="chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-head">
            <button className="orbit-back" onClick={onPop} aria-label="Back">
              Back
            </button>
            <button className="chat-new" onClick={newChat}>
              + New
            </button>
          </div>
          <input
            className="chat-search"
            placeholder="Search chats…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chat-list">
            {chats.map((c) => (
              <div
                key={c.id}
                className={`chat-list-row${c.id === currentId ? ' is-active' : ''}`}
                onClick={() => void selectChat(c.id)}
              >
                <span className="chat-list-title">
                  {c.pinned ? '📌 ' : ''}
                  {c.title || 'New chat'}
                </span>
                <button
                  className="chat-row-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void togglePin(c);
                  }}
                  title={c.pinned ? 'Unpin' : 'Pin'}
                >
                  {c.pinned ? '★' : '☆'}
                </button>
                <button
                  className="chat-row-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteChat(c.id);
                  }}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
            {chats.length === 0 && <div className="chat-empty-list">No chats yet.</div>}
          </div>
        </aside>

        <main className="chat-main">
          <div className="chat-header">
            <input
              className="chat-title-input"
              value={currentChat?.title ?? ''}
              placeholder="New chat"
              disabled={!currentId}
              onChange={(e) =>
                setChats((prev) => prev.map((c) => (c.id === currentId ? { ...c, title: e.target.value } : c)))
              }
              onBlur={(e) => void rename(e.target.value)}
            />
            {info && (
              <span className={`quick-ai-badge ${info.local ? 'is-local' : 'is-remote'}`}>
                {info.label} · {info.local ? 'On-device' : 'Leaves device'}
              </span>
            )}
            {models.length > 0 && (
              <select
                className="chat-model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                title="Model for the next reply"
              >
                {!models.some((m) => m.id === selectedModel) && selectedModel && (
                  <option value={selectedModel}>{selectedModel}</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {personalItems.length > 0 && (
              <button
                className={`chat-head-btn${usePersonal ? ' is-on' : ''}`}
                onClick={() => setUsePersonal((v) => !v)}
                title={`${personalItems.length} item(s) about you`}
              >
                {usePersonal ? '✓ Personal' : 'Personal'}
              </button>
            )}
            <button className="chat-head-btn" disabled={history.length === 0} onClick={() => void exportChat()}>
              Export
            </button>
            <button
              className="chat-head-btn"
              disabled={status === 'streaming' || messages.every((m) => m.role !== 'assistant')}
              onClick={() => void regenerate()}
            >
              Regenerate
            </button>
          </div>

          <div className="chat-thread" ref={threadRef}>
            {messages.map((m) => (
              <ChatBubble
                key={m.id}
                role={m.role}
                content={m.content}
                onCopy={() => void copyText(m.content)}
                onSaveMemory={() => void saveToMemory(m.content)}
                {...(m.role === 'assistant' ? { onBranch: () => void branchFrom(m.seq) } : {})}
              />
            ))}
            {status === 'streaming' && (
              <ChatBubble role="assistant" content={streaming} streaming onCopy={() => void copyText(streaming)} />
            )}
            {messages.length === 0 && status === 'idle' && (
              <div className="chat-thread-empty">Ask anything. Conversations are saved locally.</div>
            )}
          </div>

          {error && <div className="orbit-error">⚠ {error}</div>}
          {savedNote && <div className="chat-saved-note">{savedNote}</div>}

          <div className="chat-input-row">
            <textarea
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message…  (Ctrl/Cmd+Enter to send)"
              rows={2}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {status === 'streaming' ? (
              <button className="chat-stop" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="chat-send" disabled={!input.trim()} onClick={() => void send()}>
                Send
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function ChatBubble({
  role,
  content,
  streaming,
  onCopy,
  onBranch,
  onSaveMemory,
}: {
  role: native.ChatMessage['role'];
  content: string;
  streaming?: boolean;
  onCopy: () => void;
  onBranch?: () => void;
  onSaveMemory?: () => void;
}): JSX.Element {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  return (
    <div className={`chat-bubble is-${role}`}>
      <div className="chat-bubble-role">{role === 'user' ? 'You' : 'Assistant'}</div>
      <div className="chat-bubble-body">
        {blocks.map((b, i) =>
          b.kind === 'code' ? (
            <pre key={i} className="chat-code">
              {b.lang && <span className="chat-code-lang">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          ) : (
            <p key={i} className="chat-text">
              {b.text}
            </p>
          ),
        )}
        {streaming && <span className="quick-ai-caret">▌</span>}
      </div>
      {!streaming && content && (
        <div className="chat-bubble-actions">
          <button className="chat-copy" onClick={onCopy}>
            Copy
          </button>
          {onBranch && (
            <button className="chat-copy" onClick={onBranch} title="Start a new chat from here">
              Branch
            </button>
          )}
          {onSaveMemory && (
            <button className="chat-copy" onClick={onSaveMemory} title="Save this to Memory">
              Save to memory
            </button>
          )}
        </div>
      )}
    </div>
  );
}
