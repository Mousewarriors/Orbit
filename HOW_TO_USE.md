# Using Orbit locally

Everything here runs on your machine. No account, no cloud required.

## 1. Launch it

```bash
npm run dev:desktop
```

The launcher opens; press **Alt+Space** any time to toggle it. Type to search
apps, do maths (`125*8`), open Clipboard History, Snippets, Notes, etc.

(First run builds the Rust app once — subsequent launches are fast. To make a
double-click installer instead: `npm run build --workspace @orbit/desktop`.)

## 2. Turn on local AI (Ollama)

Ollama is already installed and running on this machine with tool-capable models
(`llama3.1:8b`, `qwen2.5:14b`, `qwen2.5-coder`).

1. Open **Settings** (tray icon → Settings, or the "Open Settings" command).
2. Go to **AI** → choose **Local Ollama**. Endpoint `http://127.0.0.1:11434`.
3. That's it. Open **AI Chat** (command: "AI Chat") and ask anything — answers
   stream on-device.

> The model picker in Chat **auto-selects a tool-capable model**. The original
> `llama3` / `gemma` / `phi` can't call tools — if you pick one while Tools is
> on, you'll get a clear "does not support tools" message. Use `llama3.1:8b` or
> `qwen2.5:14b`.

## 3. Control AgentOS with AI

1. Open the **MCP & Tools** view (command: "MCP & Tools").
2. Under **AgentOS**, confirm the folder (`C:/AgentOS`) and click
   **Connect AgentOS**. Its 8 Second-Brain tools appear in the registry:
   search vault, ask Second Brain, get/save memories, route task, create
   handoff, log decision, battle plan.
   - You can **Test call** any of them right here (e.g. select *Battle plan* →
     Test call).
3. Open **AI Chat**, make sure the **Tools** toggle (top-right) is on, and just
   ask:
   - *"What's on my battle plan today?"* → it calls `get_battle_plan` and answers
     from your real vault.
   - *"Search my vault for what I decided about Orbit."* → `search_vault`.
   - *"Who should build this feature?"* → `route_task`.

Tool calls show as **cards** in the conversation (tool, server, risk, arguments,
result, timing).

## 4. Safety — what asks before acting

Read-only tools (search, ask, get memories, route, battle plan) run freely.
**Anything that writes asks first**:

- `save_memory`, `create_handoff`, `log_decision` pop a confirmation with the
  exact arguments. Choose **Run once**, **Allow for this session**, or
  **Decline**. High-risk tools can never be "remembered" — they ask every time.

Nothing the AI does can run a shell command, touch a path, or call a tool that
isn't in the registry — it can only use the tools you've connected, and writes
are always confirmed.

## 5. Add other MCP servers (optional)

Any stdio MCP server works the same way: MCP & Tools → add a server with a
`command` (e.g. `node`) and its args. HTTP MCP servers take an endpoint URL.

---

For honest per-feature status see [FEATURE_MATRIX.md](FEATURE_MATRIX.md); for
architecture rules see [CLAUDE.md](CLAUDE.md).
