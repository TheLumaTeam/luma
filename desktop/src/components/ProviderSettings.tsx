import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import ErrorNotice from "./ErrorNotice";
import type { SetupConfig, SetupProvider } from "../stores/setupStore";
import type { ProviderCategory, ProviderProtocol } from "../../../shared/protocol";
import "./ProviderSettings.css";

type Filter = "all" | ProviderCategory;
type TestResult = { state: "ok"; count: number } | { state: "error"; message: string };

const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  OpenAiCompatible: "OpenAI-compatible",
  Anthropic: "Anthropic",
  Gemini: "Gemini",
};

const CUSTOM_ID = /^custom-[a-z0-9][a-z0-9_-]{0,62}$/;

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function validEndpoint(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function customId(name: string, taken: Set<string>): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "provider";
  let id = `custom-${slug}`;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `custom-${slug}-${suffix}`;
  return id;
}

/** Credential saved for a provider, including the legacy key stored on the default model. */
function savedKey(config: SetupConfig | null, provider: SetupProvider): string | undefined {
  if (!config) return undefined;
  return config.provider_api_keys?.[provider.id]
    ?? (config.model.provider === provider.id ? config.model.api_key ?? undefined : undefined);
}

function providerEndpoint(config: SetupConfig | null, provider: SetupProvider): string {
  if (config?.model.provider === provider.id && config.model.endpoint) return config.model.endpoint;
  return config?.providers?.find((item) => item.id === provider.id)?.endpoint ?? provider.endpoint;
}

export default function ProviderSettings({ onChangeModel }: { onChangeModel: () => void }) {
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [providers, setProviders] = useState<SetupProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [endpointDraft, setEndpointDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newProtocol, setNewProtocol] = useState<ProviderProtocol>("OpenAiCompatible");
  const [newEndpoint, setNewEndpoint] = useState("");
  const [newRequiresKey, setNewRequiresKey] = useState(false);
  const [newKey, setNewKey] = useState("");

  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState("");

  const refresh = useCallback(async () => {
    const [nextConfig, nextProviders] = await Promise.all([window.luma.getSetupConfig(), window.luma.getProviders()]);
    setConfig(nextConfig);
    setProviders(nextProviders);
    setJsonDraft(JSON.stringify((nextConfig?.providers ?? []).filter((item) => item.category === "Custom"), null, 2));
  }, []);

  useEffect(() => {
    let active = true;
    void refresh()
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);

  /** Applies a change to the freshly loaded config so edits made elsewhere are not overwritten. */
  async function save(change: (current: SetupConfig) => SetupConfig): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const current = await window.luma.getSetupConfig();
      if (!current) throw new Error("Finish setup before managing providers.");
      const next = change(current);
      // Only reload (and test) the default model when this change touches it.
      if (JSON.stringify(next.model) === JSON.stringify(current.model)) await window.luma.saveProviderSettings(next);
      else await window.luma.saveSetupConfig(next);
      window.dispatchEvent(new CustomEvent<SetupConfig>("luma:setup-config-changed", { detail: next }));
      await refresh();
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggle(provider: SetupProvider) {
    if (expanded === provider.id) { setExpanded(null); return; }
    setExpanded(provider.id);
    setKeyDraft("");
    setEndpointDraft(providerEndpoint(config, provider));
  }

  async function saveKey(provider: SetupProvider) {
    const key = keyDraft.trim();
    if (!key) return;
    const ok = await save((current) => ({
      ...current,
      provider_api_keys: { ...(current.provider_api_keys ?? {}), [provider.id]: key },
      model: current.model.provider === provider.id ? { ...current.model, api_key: key } : current.model,
    }));
    if (ok) setKeyDraft("");
  }

  async function removeKey(provider: SetupProvider) {
    await save((current) => {
      const keys = { ...(current.provider_api_keys ?? {}) };
      delete keys[provider.id];
      return {
        ...current,
        provider_api_keys: keys,
        model: current.model.provider === provider.id ? { ...current.model, api_key: null } : current.model,
      };
    });
    setTests((items) => { const next = { ...items }; delete next[provider.id]; return next; });
  }

  async function saveEndpoint(provider: SetupProvider) {
    const endpoint = endpointDraft.trim();
    if (!validEndpoint(endpoint)) { setError("Enter an http:// or https:// endpoint URL."); return; }
    await save((current) => ({
      ...current,
      providers: (current.providers ?? []).map((item) => item.id === provider.id ? { ...item, endpoint } : item),
      model: current.model.provider === provider.id ? { ...current.model, endpoint } : current.model,
    }));
  }

  async function removeProvider(provider: SetupProvider) {
    const ok = await save((current) => {
      if (current.model.provider === provider.id) throw new Error(`${provider.name} is the default provider. Choose a different default model before removing it.`);
      const keys = { ...(current.provider_api_keys ?? {}) };
      delete keys[provider.id];
      return { ...current, providers: (current.providers ?? []).filter((item) => item.id !== provider.id), provider_api_keys: keys };
    });
    if (ok) setExpanded(null);
  }

  async function test(provider: SetupProvider) {
    if (testing) return;
    setTesting(true);
    try {
      const endpoint = endpointDraft.trim() || providerEndpoint(config, provider);
      const models = await window.luma.getModels(provider, { apiKey: keyDraft.trim() || savedKey(config, provider), endpoint });
      setTests((items) => ({ ...items, [provider.id]: { state: "ok", count: models.length } }));
    } catch (reason) {
      setTests((items) => ({ ...items, [provider.id]: { state: "error", message: errorMessage(reason) } }));
    } finally {
      setTesting(false);
    }
  }

  async function addProvider(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    const endpoint = newEndpoint.trim();
    if (!name) { setError("Give the provider a name."); return; }
    if (!validEndpoint(endpoint)) { setError("Enter an http:// or https:// endpoint URL."); return; }
    const key = newKey.trim();
    const ok = await save((current) => {
      const id = customId(name, new Set(providers.map((item) => item.id)));
      const provider: SetupProvider = {
        id,
        name,
        description: `${PROTOCOL_LABELS[newProtocol]} endpoint`,
        category: "Custom",
        protocol: newProtocol,
        endpoint,
        requires_api_key: newRequiresKey,
        supports_model_discovery: true,
        api_key_env: null,
      };
      return {
        ...current,
        providers: [...(current.providers ?? []), provider],
        provider_api_keys: newRequiresKey && key ? { ...(current.provider_api_keys ?? {}), [id]: key } : current.provider_api_keys,
      };
    });
    if (ok) {
      setAdding(false);
      setNewName("");
      setNewProtocol("OpenAiCompatible");
      setNewEndpoint("");
      setNewRequiresKey(false);
      setNewKey("");
    }
  }

  async function saveJson() {
    setJsonError("");
    let parsed: SetupProvider[];
    try {
      const value = JSON.parse(jsonDraft) as unknown;
      if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || (item as { category?: unknown }).category !== "Custom")) {
        throw new Error("Enter an array containing only custom provider definitions.");
      }
      const ids = value.map((item) => (item as { id?: unknown }).id);
      if (ids.some((id) => typeof id !== "string" || !CUSTOM_ID.test(id)) || new Set(ids).size !== ids.length) {
        throw new Error("Each provider needs a unique ID beginning with custom-.");
      }
      parsed = value as SetupProvider[];
    } catch (reason) {
      setJsonError(errorMessage(reason));
      return;
    }
    await save((current) => {
      if (current.model.provider.startsWith("custom-") && !parsed.some((item) => item.id === current.model.provider)) {
        throw new Error("The registry must keep the provider used by the default model.");
      }
      return { ...current, providers: parsed };
    });
  }

  const counts = useMemo(() => ({
    all: providers.length,
    Cloud: providers.filter((item) => item.category === "Cloud").length,
    Local: providers.filter((item) => item.category === "Local").length,
    Custom: providers.filter((item) => item.category === "Custom").length,
  }), [providers]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providers.filter((item) => (filter === "all" || item.category === filter)
      && (!query || `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(query)));
  }, [filter, providers, search]);

  const defaultProvider = providers.find((item) => item.id === config?.model.provider);

  if (loading) {
    return <div className="providers-loading" role="status"><span className="providers-spinner" />Loading providers…</div>;
  }

  return (
    <div className="providers-panel">
      <div className="mb-4">
        <h2 className="text-[13px] font-medium text-[var(--luma-text)]">Providers</h2>
        <p className="mt-0.5 text-[12px] text-[var(--luma-text-muted)]">Connect model providers, manage their API keys, and add your own endpoints.</p>
      </div>

      <div className="providers-default">
        <div className="min-w-0">
          <div className="providers-label">Default model</div>
          <div className="providers-default-model">{config?.model.name || "Not configured"}</div>
          <div className="providers-muted">{defaultProvider?.name ?? (config?.model.provider || "No provider selected")}</div>
        </div>
        <button type="button" className="luma-inspector-action" onClick={onChangeModel}>Change model</button>
      </div>

      {error && <div className="mt-3"><ErrorNotice error={error} variant="inline" onDismiss={() => setError("")} /></div>}

      <div className="providers-toolbar">
        <div className="providers-filters" role="group" aria-label="Filter providers">
          {(["all", "Cloud", "Local", "Custom"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>
              {item === "all" ? "All" : item}<span>{counts[item]}</span>
            </button>
          ))}
        </div>
        <input aria-label="Search providers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search providers" className="luma-input h-8 w-[150px] text-[12px]" />
      </div>

      <ul className="providers-list" aria-label="Model providers">
        {visible.map((provider) => {
          const isDefault = config?.model.provider === provider.id;
          // Only providers saved in the config can be edited; built-in templates come from the core.
          const editable = provider.category === "Custom" && (config?.providers ?? []).some((item) => item.id === provider.id);
          const key = savedKey(config, provider);
          const open = expanded === provider.id;
          const result = tests[provider.id];
          const status = !provider.requires_api_key ? "No key needed" : key ? "Key saved" : "Needs API key";
          return (
            <li key={provider.id} className="providers-item" data-open={open}>
              <button type="button" className="providers-row" aria-expanded={open} aria-controls={`provider-${provider.id}`} onClick={() => toggle(provider)}>
                <span className="min-w-0 flex-1">
                  <span className="providers-name">{provider.name}{isDefault && <span className="providers-badge is-default">Default</span>}</span>
                  <span className="providers-description">{provider.description}</span>
                </span>
                <span className="providers-badge" data-status={!provider.requires_api_key ? "none" : key ? "ok" : "missing"}>{status}</span>
                <svg className="providers-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg>
              </button>

              {open && (
                <div id={`provider-${provider.id}`} className="providers-detail">
                  <dl className="providers-facts">
                    <div><dt>Type</dt><dd>{provider.category}</dd></div>
                    <div><dt>Protocol</dt><dd>{PROTOCOL_LABELS[provider.protocol]}</dd></div>
                    <div><dt>ID</dt><dd className="font-mono">{provider.id}</dd></div>
                  </dl>

                  <label className="providers-field">
                    <span>Endpoint</span>
                    {editable ? (
                      <span className="flex gap-2">
                        <input value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} disabled={busy} className="luma-input h-8 min-w-0 flex-1 text-[12px]" spellCheck={false} />
                        <button type="button" className="luma-inspector-action" disabled={busy || endpointDraft.trim() === providerEndpoint(config, provider)} onClick={() => void saveEndpoint(provider)}>Save</button>
                      </span>
                    ) : (
                      <span className="providers-readonly font-mono">{providerEndpoint(config, provider)}</span>
                    )}
                  </label>

                  {provider.requires_api_key && (
                    <label className="providers-field">
                      <span>API key</span>
                      <span className="flex gap-2">
                        <input type="password" autoComplete="off" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveKey(provider); } }} disabled={busy} placeholder={key ? "Saved. Enter a new key to replace it" : "Paste your API key"} className="luma-input h-8 min-w-0 flex-1 text-[12px]" />
                        <button type="button" className="luma-inspector-action is-primary" disabled={busy || !keyDraft.trim()} onClick={() => void saveKey(provider)}>Save key</button>
                        {key && <button type="button" className="luma-inspector-action" disabled={busy} onClick={() => void removeKey(provider)}>Remove</button>}
                      </span>
                      {provider.api_key_env && <span className="providers-muted">If no key is saved here, Luma reads <code>{provider.api_key_env}</code> from the environment.</span>}
                    </label>
                  )}

                  <div className="providers-actions">
                    <div className="providers-test" aria-live="polite">
                      {result?.state === "ok" && <span className="is-ok">Connected. {result.count} {result.count === 1 ? "model" : "models"} available.</span>}
                      {result?.state === "error" && <span className="is-error">{result.message}</span>}
                    </div>
                    {editable && <button type="button" className="luma-inspector-action is-danger" disabled={busy || isDefault} title={isDefault ? "Choose a different default model first" : undefined} onClick={() => void removeProvider(provider)}>Remove provider</button>}
                    <button type="button" className="luma-inspector-action" disabled={testing || busy} onClick={() => void test(provider)}>{testing ? "Testing…" : "Test connection"}</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {visible.length === 0 && <li className="providers-empty">{search ? `No provider matches “${search}”.` : "No providers in this category yet."}</li>}
      </ul>

      {adding ? (
        <form className="providers-add" onSubmit={(event) => void addProvider(event)}>
          <div className="providers-label">Add custom provider</div>
          <div className="providers-add-grid">
            <label className="providers-field"><span>Name</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="My server" className="luma-input h-8 text-[12px]" /></label>
            <label className="providers-field"><span>Protocol</span>
              <select value={newProtocol} onChange={(event) => setNewProtocol(event.target.value as ProviderProtocol)} className="luma-input h-8 text-[12px]">
                {(Object.keys(PROTOCOL_LABELS) as ProviderProtocol[]).map((item) => <option key={item} value={item}>{PROTOCOL_LABELS[item]}</option>)}
              </select>
            </label>
            <label className="providers-field providers-span"><span>Endpoint URL</span><input value={newEndpoint} onChange={(event) => setNewEndpoint(event.target.value)} placeholder="http://localhost:1234/v1" spellCheck={false} className="luma-input h-8 text-[12px]" /></label>
            <label className="providers-check providers-span"><input type="checkbox" checked={newRequiresKey} onChange={(event) => setNewRequiresKey(event.target.checked)} />Requires an API key</label>
            {newRequiresKey && <label className="providers-field providers-span"><span>API key</span><input type="password" autoComplete="off" value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="Optional, you can add it later" className="luma-input h-8 text-[12px]" /></label>}
          </div>
          <div className="providers-actions">
            <span className="flex-1" />
            <button type="button" className="luma-inspector-action" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="luma-inspector-action is-primary" disabled={busy || !newName.trim() || !newEndpoint.trim()}>Add provider</button>
          </div>
        </form>
      ) : (
        <button type="button" className="providers-add-trigger" onClick={() => { setAdding(true); setError(""); }}>＋ Add custom provider</button>
      )}

      <details className="mt-4 rounded-md border border-[var(--luma-border)] p-3">
        <summary className="luma-disclosure-summary text-[12px] font-semibold">Edit custom providers as JSON</summary>
        <p className="mt-2 text-[11.5px] leading-5 text-[var(--luma-text-muted)]">Advanced. API keys are stored separately and are not part of this list.</p>
        <textarea spellCheck={false} aria-label="Custom provider definitions" value={jsonDraft} onChange={(event) => { setJsonDraft(event.target.value); setJsonError(""); }} rows={10} className="luma-input mt-2 w-full resize-y font-mono text-[11.5px] leading-5" />
        {jsonError && <div className="mt-2"><ErrorNotice error={jsonError} variant="inline" /></div>}
        <div className="mt-2 flex justify-end"><button type="button" disabled={busy || !config} onClick={() => void saveJson()} className="luma-btn-primary h-7 px-3 text-[11.5px]">Save provider registry</button></div>
      </details>
    </div>
  );
}
