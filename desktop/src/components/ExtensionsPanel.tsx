import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { McpServerConfig, PluginEntry } from "../../../shared/protocol";
import McpStore from "./McpStore";
import "./ExtensionsPanel.css";

type SkillEntry = { name: string; content: string };

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function parseJson<T>(value: string, label: string, fallback: T): T {
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  count,
  actions,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  count: number;
  actions?: ReactNode;
}) {
  return (
    <div className="extensions-heading">
      <div className="extensions-heading-copy">
        <span className="extensions-eyebrow">{eyebrow}</span>
        <div className="extensions-title-row">
          <h3 id={id}>{title}</h3>
          <span className="extensions-count" aria-label={`${count} items`}>{count}</span>
        </div>
        <p>{description}</p>
      </div>
      {actions && <div className="extensions-heading-actions">{actions}</div>}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="extensions-empty">
      <span className="extensions-empty-mark" aria-hidden="true">＋</span>
      <div>
        <p>{title}</p>
        <span>{description}</span>
      </div>
    </div>
  );
}

export default function ExtensionsPanel() {
  const [view, setView] = useState<"installed" | "store">("installed");
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [skillContentDraft, setSkillContentDraft] = useState("");

  const [serverId, setServerId] = useState("");
  const [serverName, setServerName] = useState("");
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverCommand, setServerCommand] = useState("");
  const [serverArgs, setServerArgs] = useState("");
  const [serverEnv, setServerEnv] = useState("{}");
  const [httpUrl, setHttpUrl] = useState("");
  const [httpHeaders, setHttpHeaders] = useState("{}");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");

  const refresh = useCallback(async () => {
    const [nextSkills, nextPlugins, nextServers] = await Promise.all([
      window.luma.getSkills(),
      window.luma.getPlugins(),
      window.luma.getMcpServers(),
    ]);
    setSkills(nextSkills);
    setPlugins(nextPlugins);
    setServers(nextServers);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([window.luma.getSkills(), window.luma.getPlugins(), window.luma.getMcpServers()])
      .then(([nextSkills, nextPlugins, nextServers]) => {
        if (!active) return;
        setSkills(nextSkills);
        setPlugins(nextPlugins);
        setServers(nextServers);
        setError("");
      })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (busy || refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRefreshing(false);
    }
  }

  function resetServerForm() {
    setEditingServerId(null);
    setServerId("");
    setServerName("");
    setTransport("stdio");
    setServerCommand("");
    setServerArgs("");
    setServerEnv("{}");
    setHttpUrl("");
    setHttpHeaders("{}");
  }

  function editServer(server: McpServerConfig) {
    setEditingServerId(server.id);
    setServerId(server.id);
    setServerName(server.name);
    setTransport(server.transport);
    setServerCommand(server.command);
    setServerArgs(JSON.stringify(server.args, null, 2));
    setServerEnv(JSON.stringify(server.env, null, 2));
    setHttpUrl(server.url ?? "");
    setHttpHeaders(JSON.stringify(server.headers, null, 2));
  }

  async function saveServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const args = parseJson<unknown>(serverArgs, "Arguments", []);
      const env = parseJson<unknown>(serverEnv, "Environment variables", {});
      const headers = parseJson<unknown>(httpHeaders, "HTTP headers", {});
      if (!Array.isArray(args) || !args.every((item) => typeof item === "string")) {
        throw new Error("Arguments must be a JSON array of strings.");
      }
      const isStringRecord = (value: unknown): value is Record<string, string> =>
        typeof value === "object" && value !== null && !Array.isArray(value)
        && Object.values(value).every((item) => typeof item === "string");
      if (!isStringRecord(env)) throw new Error("Environment variables must be a JSON object with string values.");
      if (!isStringRecord(headers)) throw new Error("HTTP headers must be a JSON object with string values.");

      if (editingServerId) {
        await window.luma.updateMcp({
          id: editingServerId,
          name: serverName.trim() || editingServerId,
          transport,
          url: transport === "http" ? httpUrl.trim() : null,
          headers: transport === "http" ? headers : {},
          command: transport === "stdio" ? serverCommand.trim() : "",
          args: transport === "stdio" ? args : [],
          env: transport === "stdio" ? env : {},
          enabled: servers.find((server) => server.id === editingServerId)?.enabled ?? false,
        });
      } else if (transport === "stdio") {
        await window.luma.addMcpStdio({ id: serverId.trim(), command: serverCommand.trim(), args, env });
      } else {
        await window.luma.addMcpHttp({ id: serverId.trim(), url: httpUrl.trim(), headers });
      }
      resetServerForm();
    });
  }

  return (
    <div className="extensions-panel" aria-busy={loading || busy}>
      <header className="extensions-intro">
        <div>
          <span className="extensions-eyebrow">WORKSPACE CAPABILITIES</span>
          <h2>Extensions</h2>
          <p>Give Luma reusable instructions, native tools, and connections to external services.</p>
        </div>
        <button type="button" className="luma-btn-secondary extensions-refresh" onClick={() => void reload()} disabled={loading || refreshing || busy}>
          <span aria-hidden="true" className={refreshing ? "extensions-refresh-icon is-spinning" : "extensions-refresh-icon"}>↻</span>
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      <div className="extensions-tabs" role="group" aria-label="Extensions view">
        <button type="button" aria-pressed={view === "installed"} onClick={() => setView("installed")}>Installed</button>
        <button type="button" aria-pressed={view === "store"} onClick={() => setView("store")}>MCP Store</button>
      </div>

      {error && (
        <div className="extensions-error" role="alert">
          <span className="extensions-error-mark" aria-hidden="true">!</span>
          <div><strong>Something went wrong</strong><p>{error}</p></div>
          <button type="button" onClick={() => void reload()} disabled={refreshing || busy}>Retry</button>
        </div>
      )}

      {loading ? (
        <div className="extensions-loading" role="status" aria-live="polite">
          <span className="extensions-spinner" aria-hidden="true" />
          <span>Loading your extensions…</span>
        </div>
      ) : view === "store" ? (
        <McpStore servers={servers} onChanged={refresh} />
      ) : (
        <>
          <section className="extensions-section" aria-labelledby="extensions-skills-title">
            <SectionHeading
              id="extensions-skills-title"
              eyebrow="01 / INSTRUCTIONS"
              title="Agent Skills"
              description="Reusable instructions that Luma can load when a task calls for them."
              count={skills.length}
              actions={<button type="button" onClick={() => void run(() => window.luma.openExtensionFolder("skills"))} disabled={busy} className="luma-btn-secondary">Open folder</button>}
            />
            {skills.length > 0 ? (
              <div className="extensions-list" aria-label="Installed agent skills">
                {skills.map((skill) => (
                  <div key={skill.name} className="extensions-list-row">
                    <div className="extensions-item-icon" aria-hidden="true">✳</div>
                    <div className="extensions-item-copy"><strong>{skill.name}</strong><span>Personal skill</span></div>
                    <div className="extensions-row-actions">
                      <button type="button" disabled={busy} onClick={() => { setEditingSkill(skill.name); setSkillContentDraft(skill.content); }} className="luma-btn-secondary">Edit</button>
                      <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete skill ${skill.name}?`)) void run(() => window.luma.deleteSkill(skill.name)); }} className="luma-btn-ghost extensions-danger">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No personal skills yet" description="Create a skill below or add one from the skills folder." />
            )}

            {editingSkill && (
              <div className="extensions-editor">
                <div className="extensions-form-heading"><div><strong>Edit skill</strong><span>{editingSkill}/SKILL.md</span></div><button type="button" className="luma-btn-ghost" onClick={() => setEditingSkill(null)}>Close</button></div>
                <label className="extensions-field">Skill instructions
                  <textarea autoFocus spellCheck={false} rows={12} value={skillContentDraft} onChange={(event) => setSkillContentDraft(event.target.value)} className="luma-input extensions-code" />
                </label>
                <div className="extensions-form-actions"><button type="button" disabled={busy || !skillContentDraft.trim()} onClick={() => void run(async () => { await window.luma.saveSkill(editingSkill, skillContentDraft); setEditingSkill(null); })} className="luma-btn-primary">Save skill</button></div>
              </div>
            )}

            <form className="extensions-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await window.luma.createSkill(skillName.trim(), skillDescription.trim(), skillInstructions); setSkillName(""); setSkillDescription(""); setSkillInstructions(""); }); }}>
              <div className="extensions-form-heading"><div><strong>Create a skill</strong><span>Give it a name and clear instructions.</span></div></div>
              <div className="extensions-form-grid">
                <label className="extensions-field">Skill name
                  <input required maxLength={64} pattern="[a-z0-9][a-z0-9-]{0,63}" value={skillName} onChange={(event) => setSkillName(event.target.value)} placeholder="e.g. release-notes" className="luma-input" />
                  <span className="extensions-hint">Lowercase letters, numbers, and hyphens.</span>
                </label>
                <label className="extensions-field">Description
                  <input required maxLength={240} value={skillDescription} onChange={(event) => setSkillDescription(event.target.value)} placeholder="What this skill helps with" className="luma-input" />
                </label>
                <label className="extensions-field extensions-field-full">Instructions
                  <textarea required rows={4} value={skillInstructions} onChange={(event) => setSkillInstructions(event.target.value)} placeholder="Describe the steps, context, and constraints the model should follow…" className="luma-input" />
                </label>
              </div>
              <div className="extensions-form-actions"><button type="submit" disabled={busy || !skillName.trim() || !skillDescription.trim() || !skillInstructions.trim()} className="luma-btn-primary">Create skill</button></div>
            </form>
          </section>

          <section className="extensions-section" aria-labelledby="extensions-plugins-title">
            <SectionHeading
              id="extensions-plugins-title"
              eyebrow="02 / NATIVE TOOLS"
              title="Native plugins"
              description="Install plugins that expose local tools to Luma. Each plugin needs a valid plugin.toml."
              count={plugins.length}
              actions={<><button type="button" onClick={() => void run(() => window.luma.openExtensionFolder("plugins"))} disabled={busy} className="luma-btn-secondary">Open folder</button><button type="button" disabled={busy} onClick={() => void run(async () => { const path = await window.luma.choosePluginPackage(); if (path) await window.luma.installPlugin(path); })} className="luma-btn-primary">Install plugin…</button></>}
            />
            {plugins.length > 0 ? (
              <div className="extensions-list" aria-label="Installed native plugins">
                {plugins.map(([installed, manifest]) => (
                  <div key={installed.id} className="extensions-list-row">
                    <div className="extensions-item-icon" aria-hidden="true">⌘</div>
                    <div className="extensions-item-copy"><strong>{manifest.name}<span className="extensions-version">v{manifest.version}</span></strong><span>{manifest.description || installed.id}</span></div>
                    <span className={`extensions-status ${installed.enabled ? "is-enabled" : "is-disabled"}`}>{installed.enabled ? "Enabled" : "Disabled"}</span>
                    <div className="extensions-row-actions">
                      <button type="button" disabled={busy} onClick={() => void run(() => window.luma.setPluginEnabled(installed.id, !installed.enabled))} className="luma-btn-secondary">{installed.enabled ? "Disable" : "Enable"}</button>
                      <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Uninstall ${manifest.name}?`)) void run(() => window.luma.uninstallPlugin(installed.id)); }} className="luma-btn-ghost extensions-danger">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No native plugins installed" description="Install a plugin package or place one in your plugins folder." />
            )}
          </section>

          <section className="extensions-section" aria-labelledby="extensions-mcp-title">
            <SectionHeading
              id="extensions-mcp-title"
              eyebrow="03 / CONNECTED SERVICES"
              title="MCP servers"
              description="Connect local tools over stdio or remote services over Streamable HTTP."
              count={servers.length}
              actions={<button type="button" onClick={() => void run(() => window.luma.openExtensionFolder("mcp"))} disabled={busy} className="luma-btn-secondary">Open config</button>}
            />
            {servers.length > 0 ? (
              <div className="extensions-list" aria-label="Configured MCP servers">
                {servers.map((server) => (
                  <div key={server.id} className="extensions-list-row">
                    <div className="extensions-item-icon" aria-hidden="true">⇄</div>
                    <div className="extensions-item-copy"><strong>{server.name}</strong><span title={server.transport === "http" ? server.url ?? undefined : `${server.command} ${server.args.join(" ")}`}>
                      <span className="extensions-transport">{server.transport === "http" ? "HTTP" : "STDIO"}</span>
                      {server.transport === "http" ? server.url : `${server.command} ${server.args.join(" ")}`}
                    </span></div>
                    <span className={`extensions-status ${server.enabled ? "is-enabled" : "is-disabled"}`}>{server.enabled ? "Enabled" : "Disabled"}</span>
                    <div className="extensions-row-actions">
                      <button type="button" disabled={busy} onClick={() => void run(() => window.luma.setMcpEnabled(server.id, !server.enabled))} className="luma-btn-secondary">{server.enabled ? "Disable" : "Enable"}</button>
                      <button type="button" disabled={busy} onClick={() => editServer(server)} className="luma-btn-secondary">Edit</button>
                      <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Remove MCP server ${server.name}?`)) void run(() => window.luma.removeMcp(server.id)); }} className="luma-btn-ghost extensions-danger">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No MCP servers configured" description="Add a local process or a remote HTTP endpoint below." />
            )}

            <form className="extensions-form" onSubmit={(event) => void saveServer(event)}>
              <div className="extensions-form-heading"><div><strong>{editingServerId ? "Edit MCP server" : "Add an MCP server"}</strong><span>{editingServerId ? `Updating ${editingServerId}` : "Choose how Luma should connect."}</span></div></div>
              <div className="extensions-form-grid">
                <label className="extensions-field">Transport
                  <select aria-label="MCP transport" value={transport} onChange={(event) => setTransport(event.target.value as "stdio" | "http")} className="luma-input"><option value="stdio">Local stdio</option><option value="http">Streamable HTTP</option></select>
                </label>
                <label className="extensions-field">Server ID
                  <input required maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" value={serverId} disabled={Boolean(editingServerId)} onChange={(event) => setServerId(event.target.value)} placeholder="e.g. filesystem" className="luma-input" />
                  <span className="extensions-hint">Lowercase letters, numbers, hyphens, and underscores.</span>
                </label>
                {editingServerId && <label className="extensions-field">Display name<input value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="Server name" className="luma-input" /></label>}
                {transport === "stdio" ? (
                  <>
                    <label className="extensions-field extensions-field-full">Command
                      <input required value={serverCommand} onChange={(event) => setServerCommand(event.target.value)} placeholder="e.g. npx" className="luma-input" />
                    </label>
                    <label className="extensions-field extensions-field-full">Arguments <span className="extensions-hint">JSON array of strings</span>
                      <textarea rows={3} spellCheck={false} value={serverArgs} onChange={(event) => setServerArgs(event.target.value)} placeholder={'["-y", "@example/mcp"]'} className="luma-input extensions-code" />
                    </label>
                    <label className="extensions-field extensions-field-full">Environment variables <span className="extensions-hint">JSON object with string values</span>
                      <textarea rows={3} spellCheck={false} value={serverEnv} onChange={(event) => setServerEnv(event.target.value)} placeholder={'{"API_KEY": "${API_KEY}"}'} className="luma-input extensions-code" />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="extensions-field extensions-field-full">Server URL
                      <input required type="url" value={httpUrl} onChange={(event) => setHttpUrl(event.target.value)} placeholder="https://example.com/mcp" className="luma-input" />
                    </label>
                    <label className="extensions-field extensions-field-full">HTTP headers <span className="extensions-hint">JSON object with string values</span>
                      <textarea rows={3} spellCheck={false} value={httpHeaders} onChange={(event) => setHttpHeaders(event.target.value)} placeholder={'{"Authorization": "Bearer …"}'} className="luma-input extensions-code" />
                    </label>
                  </>
                )}
              </div>
              <div className="extensions-form-actions">
                {editingServerId && <button type="button" disabled={busy} onClick={resetServerForm} className="luma-btn-secondary">Cancel</button>}
                <button type="submit" disabled={busy || (!editingServerId && !serverId.trim()) || (transport === "stdio" ? !serverCommand.trim() : !httpUrl.trim())} className="luma-btn-primary">{editingServerId ? "Save changes" : "Add server"}</button>
              </div>
            </form>
          </section>
        </>
      )}
      {busy && <span className="extensions-busy-note" role="status" aria-live="polite">Saving changes…</span>}
    </div>
  );
}
