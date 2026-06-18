import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  validateArgs,
  type McpClient,
  type ToolRecord,
  type ToolRisk,
} from '@orbit/tool-registry';
import { buildToolRegistry, DEMO_MCP_SERVER_ID } from '../ai/toolRegistry.js';
import {
  MCP_SERVERS_SETTING_KEY,
  parseMcpServers,
  removeServer,
  serializeMcpServers,
  upsertServer,
  validateServer,
  type StoredMcpServer,
} from '../ai/mcpServers.js';
import * as native from '../native.js';
import { describeConfirmation } from '../confirm.js';
import { ConfirmDialog } from './ConfirmDialog.js';

/**
 * MCP & Tools — the unified Tool Registry surface (spec §13.5).
 *
 * Lists every registered tool grouped by source with its risk, side effects and
 * approval policy, an inspector showing the input schema, and a Test-call for
 * the in-process demo MCP server. Consequential (confirmation-required) tools
 * route their test call through the same confirmation dialog the Mission engine
 * uses — so the gating is visible here, not just asserted.
 */
const RISK_LABEL: Record<ToolRisk, string> = {
  safe: 'Safe',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const SOURCE_LABEL: Record<string, string> = {
  native: 'Orbit (native)',
  relay: 'Orbit Relay',
  agentos: 'AgentOS Gateway',
  extension: 'Extensions',
  mcp: 'MCP servers',
  'ai-provider': 'AI provider',
};

export function ToolsView({ onPop }: { onPop: () => void }): JSX.Element {
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [clients, setClients] = useState<ReadonlyMap<string, McpClient>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [testArg, setTestArg] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [confirmTool, setConfirmTool] = useState<ToolRecord | null>(null);
  const [servers, setServers] = useState<StoredMcpServer[]>([]);
  const [form, setForm] = useState({ id: '', name: '', endpoint: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    const built = await buildToolRegistry();
    setTools(built.registry.all());
    setClients(built.clients);
    if (native.isTauri()) {
      setServers(parseMcpServers(await native.getSetting(MCP_SERVERS_SETTING_KEY).catch(() => null)));
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persistServers = useCallback(
    async (next: StoredMcpServer[]) => {
      setServers(next);
      if (native.isTauri()) {
        await native.setSetting(MCP_SERVERS_SETTING_KEY, serializeMcpServers(next)).catch(() => {});
      }
      await reload();
    },
    [reload],
  );

  const addServer = useCallback(() => {
    const candidate = { id: form.id.trim(), name: form.name.trim(), endpoint: form.endpoint.trim() };
    const err = validateServer(candidate, servers);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setForm({ id: '', name: '', endpoint: '' });
    void persistServers(upsertServer(servers, { ...candidate, enabled: true }));
  }, [form, servers, persistServers]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [tools, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ToolRecord[]>();
    for (const t of filtered) {
      const list = map.get(t.source) ?? [];
      list.push(t);
      map.set(t.source, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const selected = useMemo(
    () => tools.find((t) => t.id === selectedId) ?? null,
    [tools, selectedId],
  );

  const runTest = useCallback(
    async (tool: ToolRecord) => {
      setResult(null);
      const client = clients.get(tool.serverId ?? '');
      if (!client) {
        setResult('Only the in-process demo MCP server is callable here (real servers need the native MCP bridge).');
        return;
      }
      const args = testArg.trim() ? { text: testArg, title: testArg } : {};
      const check = validateArgs(tool.inputSchema, args);
      if (!check.ok) {
        setResult(`Invalid arguments: ${check.errors.join(', ')}`);
        return;
      }
      try {
        const out = await client.callTool(tool.name, check.cleaned);
        setResult(out.ok ? out.content : `Tool error: ${out.content}`);
      } catch (e) {
        setResult(e instanceof Error ? e.message : String(e));
      }
    },
    [clients, testArg],
  );

  const onTestClick = useCallback(
    (tool: ToolRecord) => {
      if (tool.requiresConfirmation) setConfirmTool(tool);
      else void runTest(tool);
    },
    [runTest],
  );

  return (
    <div className="orbit-launcher tools-view" tabIndex={-1}>
      <div className="orbit-search">
        <button className="orbit-back" onClick={onPop} aria-label="Back">
          Back
        </button>
        <span className="orbit-breadcrumb">MCP &amp; Tools</span>
        <input
          className="tools-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools…"
          spellCheck={false}
        />
      </div>

      <div className="tools-note">
        One unified registry. Risk and approval policy are derived from each tool's declared side
        effects — anything that writes, sends, runs, deploys or spends is gated. The demo MCP server
        runs in-process (synthetic); add a real HTTP MCP server below — it connects through the
        native bridge.
      </div>

      <div className="tools-servers">
        <div className="tools-servers-title">HTTP MCP servers</div>
        {servers.map((s) => (
          <div key={s.id} className="tools-server-row">
            <span className="tools-server-name">{s.name}</span>
            <span className="tools-server-ep">{s.endpoint}</span>
            <button
              className="tools-server-toggle"
              onClick={() => void persistServers(servers.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))}
            >
              {s.enabled ? 'Enabled' : 'Disabled'}
            </button>
            <button className="tools-server-remove" onClick={() => void persistServers(removeServer(servers, s.id))}>
              Remove
            </button>
          </div>
        ))}
        <div className="tools-server-form">
          <input
            className="tools-server-input"
            placeholder="id"
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
          />
          <input
            className="tools-server-input"
            placeholder="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="tools-server-input tools-server-ep-input"
            placeholder="https://host/mcp"
            value={form.endpoint}
            onChange={(e) => setForm((f) => ({ ...f, endpoint: e.target.value }))}
          />
          <button className="tools-test-run" disabled={busy} onClick={addServer}>
            Add
          </button>
        </div>
        {formError && <div className="orbit-error">⚠ {formError}</div>}
      </div>

      <div className="tools-body">
        <div className="tools-list">
          {grouped.map(([source, list]) => (
            <div key={source} className="tools-group">
              <div className="tools-group-title">{SOURCE_LABEL[source] ?? source}</div>
              {list.map((t) => (
                <button
                  key={t.id}
                  className={`tools-row${selectedId === t.id ? ' is-selected' : ''}`}
                  onClick={() => {
                    setSelectedId(t.id);
                    setResult(null);
                  }}
                >
                  <span className="tools-row-title">{t.title}</span>
                  <span className={`tools-risk risk-${t.risk}`}>{RISK_LABEL[t.risk]}</span>
                  {t.requiresConfirmation && <span className="tools-gated">Confirm</span>}
                </button>
              ))}
            </div>
          ))}
          {grouped.length === 0 && <div className="tools-empty">No tools match.</div>}
        </div>

        <div className="tools-detail">
          {selected ? (
            <>
              <h3>{selected.title}</h3>
              <p className="tools-desc">{selected.description || 'No description.'}</p>
              <dl className="tools-meta">
                <dt>Source</dt>
                <dd>{SOURCE_LABEL[selected.source] ?? selected.source}</dd>
                <dt>Risk</dt>
                <dd>{RISK_LABEL[selected.risk]}</dd>
                <dt>Side effects</dt>
                <dd>{selected.sideEffects.join(', ') || 'none'}</dd>
                <dt>Approval</dt>
                <dd>
                  {selected.requiresConfirmation
                    ? `Required · ${selected.approvalScopes.join(', ') || 'once'}`
                    : 'Not required'}
                </dd>
              </dl>
              <div className="tools-schema">
                <div className="tools-schema-title">Input</div>
                {Object.entries(selected.inputSchema.properties).map(([key, prop]) => (
                  <div key={key} className="tools-schema-row">
                    <code>{key}</code>
                    <span className="tools-schema-type">{prop.type}</span>
                    {selected.inputSchema.required?.includes(key) && (
                      <span className="tools-req">required</span>
                    )}
                  </div>
                ))}
              </div>
              {selected.serverId === DEMO_MCP_SERVER_ID && (
                <div className="tools-test">
                  <input
                    className="tools-test-input"
                    value={testArg}
                    onChange={(e) => setTestArg(e.target.value)}
                    placeholder="Test input…"
                    spellCheck={false}
                  />
                  <button className="tools-test-run" onClick={() => onTestClick(selected)}>
                    Test call
                  </button>
                </div>
              )}
              {result !== null && <pre className="tools-result">{result}</pre>}
            </>
          ) : (
            <div className="tools-empty">Select a tool to inspect it.</div>
          )}
        </div>
      </div>

      {confirmTool && (
        <ConfirmDialog
          prompt={describeConfirmation({
            id: `tool.${confirmTool.id}`,
            title: `Run ${confirmTool.title}`,
            run: { kind: 'copy', text: '' },
            dangerous: true,
          })}
          onConfirm={() => {
            const t = confirmTool;
            setConfirmTool(null);
            void runTest(t);
          }}
          onCancel={() => setConfirmTool(null)}
        />
      )}
    </div>
  );
}
