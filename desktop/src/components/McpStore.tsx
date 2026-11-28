import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  DEFAULT_MCP_CATALOG_URL,
  type McpCatalog,
  type McpCatalogEntry,
  type McpCatalogOption,
  type McpServerConfig,
} from "../../../shared/protocol";
import "./McpStore.css";

const CATEGORY_NAMES: Record<string, string> = {
  "ai-media": "AI & media",
  "calendar-scheduling": "Calendar",
  "commerce-finance": "Commerce & finance",
  "crm-marketing": "CRM & marketing",
  "developer-tools": "Developer tools",
  "project-management": "Projects",
  "web-search": "Web & search",
};

function categoryName(category: string): string {
  return CATEGORY_NAMES[category]
    ?? category.charAt(0).toUpperCase() + category.slice(1).split("-").join(" ");
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Luma's MCP client has no OAuth sign-in flow. */
const installable = (option: McpCatalogOption) => option.auth !== "oauth";

function matches(entry: McpCatalogEntry, query: string): boolean {
  const text = [entry.id, entry.name, entry.publisher, entry.description, categoryName(entry.category)]
    .join(" ")
    .toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

type Props = {
  servers: McpServerConfig[];
  onChanged: () => Promise<void>;
};

export default function McpStore({ servers, onChanged }: Props) {
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchCatalog = useCallback(() => window.luma.getMcpCatalog()
    .then((next) => { setCatalog(next); setError(""); })
    .catch((reason: unknown) => setError(errorMessage(reason)))
    .finally(() => setLoading(false)), []);

  useEffect(() => { void fetchCatalog(); }, [fetchCatalog]);

  const searched = useMemo(
    () => (catalog?.entries ?? [])
      .filter((entry) => matches(entry, query.trim()))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, query],
  );
  const categories = useMemo(
    () => [...new Set((catalog?.entries ?? []).map((entry) => entry.category))]
      .sort((a, b) => categoryName(a).localeCompare(categoryName(b))),
    [catalog],
  );
  const visible = searched.filter((entry) => !category || entry.category === category);

  if (loading) {
    return (
      <div className="extensions-loading" role="status">
        <span className="extensions-spinner" aria-hidden="true" />
        <span>Loading the MCP Store…</span>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="extensions-error" role="alert">
        <span className="extensions-error-mark" aria-hidden="true">!</span>
        <div><strong>The MCP Store could not be loaded</strong><p>{error}</p></div>
        <button type="button" onClick={() => { setLoading(true); void fetchCatalog(); }}>Retry</button>
      </div>
    );
  }

  return (
    <section className="mcp-store" aria-label="MCP Store">
      {catalog.source !== DEFAULT_MCP_CATALOG_URL && (
        <p className="mcp-store-banner">Custom catalog: <code>{catalog.source}</code></p>
      )}
      {catalog.warning && <p className="mcp-store-banner" role="status">{catalog.warning}</p>}

      <input
        type="search"
        className="luma-input mcp-store-search"
        placeholder={`Search ${catalog.entries.length} MCP servers`}
        aria-label="Search MCP servers"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mcp-store-categories" role="group" aria-label="Categories">
        <button type="button" aria-pressed={!category} onClick={() => setCategory("")}>
          All <span>{searched.length}</span>
        </button>
        {categories.map((name) => {
          const count = searched.filter((entry) => entry.category === name).length;
          // A search hides categories with nothing in them.
          if (!count && category !== name) return null;
          return (
            <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>
              {categoryName(name)} <span>{count}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <p className="mcp-store-empty">No MCP servers match{query.trim() ? ` “${query.trim()}”` : ""}.</p>
      ) : (
        <ul className="mcp-store-list">
          {visible.map((entry) => (
            <StoreEntry
              key={entry.id}
              entry={entry}
              installed={servers.find((server) => server.catalog_id === entry.id)}
              idTaken={servers.some((server) => server.id === entry.id && server.catalog_id !== entry.id)}
              open={openId === entry.id}
              onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type EntryProps = {
  entry: McpCatalogEntry;
  installed: McpServerConfig | undefined;
  idTaken: boolean;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
};

function StoreEntry({ entry, installed, idTaken, open, onToggle, onChanged }: EntryProps) {
  const supported = entry.options.filter(installable);
  const [optionId, setOptionId] = useState(supported[0]?.id ?? entry.options[0]?.id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const option = entry.options.find((item) => item.id === optionId) ?? entry.options[0];
  const detailsId = `mcp-store-${entry.id}`;

  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      // Don't keep credentials in the page once they are saved.
      setValues({});
      await onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function install(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const inputs = Object.fromEntries(
      (option.inputs ?? [])
        .map((input) => [input.key, values[input.key]?.trim() ?? ""])
        .filter(([, value]) => value),
    );
    void act(() => window.luma.installMcp({ entry_id: entry.id, option_id: option.id, inputs }));
  }

  return (
    <li className={open ? "mcp-store-entry is-open" : "mcp-store-entry"}>
      <button type="button" className="mcp-store-summary" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
        <span className="mcp-store-mark" aria-hidden="true">{entry.name.charAt(0)}</span>
        <span className="mcp-store-copy">
          <strong>{entry.name}</strong>
          <span>{entry.description}</span>
        </span>
        {installed ? <span className="mcp-store-badge is-installed">Installed</span>
          : supported.length === 0 ? <span className="mcp-store-badge">Needs OAuth</span>
            : null}
      </button>

      {open && (
        <div className="mcp-store-details" id={detailsId}>
          <p className="mcp-store-meta">
            By {entry.publisher} · {categoryName(entry.category)} ·{" "}
            <a href={entry.docs_url} target="_blank" rel="noreferrer">Vendor docs</a> · checked {entry.verified_at}
          </p>
          {entry.notes?.map((note) => <p className="mcp-store-note" key={note}>{note}</p>)}
          {error && <p className="mcp-store-failure" role="alert">{error}</p>}

          {installed ? (
            <div className="mcp-store-actions">
              <span>{installed.enabled ? "Enabled." : "Installed but turned off. Enable it under Installed."}</span>
              <button
                type="button"
                className="luma-btn-ghost extensions-danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove MCP server ${installed.name}?`)) {
                    void act(() => window.luma.removeMcp(installed.id));
                  }
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <form onSubmit={install}>
              {entry.options.length > 1 && (
                <label className="mcp-store-field">
                  <span>Connection</span>
                  <select className="luma-input" value={option.id} onChange={(event) => { setOptionId(event.target.value); setValues({}); setError(""); }}>
                    {entry.options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}{installable(item) ? "" : " (not supported yet)"}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Shown before installing: this is what will run or be contacted. */}
              <div className="mcp-store-target">
                <span>{option.transport === "stdio" ? "Runs on this computer" : "Connects to"}</span>
                <code>{option.url ?? [option.command, ...(option.args ?? [])].join(" ")}</code>
              </div>

              {installable(option) ? (
                <>
                  {option.inputs?.map((input) => (
                    <label className="mcp-store-field" key={input.key}>
                      <span>{input.label}{input.required ? "" : " (optional)"}</span>
                      <input
                        className="luma-input"
                        type={input.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        required={input.required && !input.default}
                        placeholder={input.default}
                        value={values[input.key] ?? ""}
                        onChange={(event) => setValues({ ...values, [input.key]: event.target.value })}
                      />
                    </label>
                  ))}
                  {idTaken && <p className="mcp-store-failure">A server with the ID “{entry.id}” is already set up. Remove it under Installed first.</p>}
                  <div className="mcp-store-actions">
                    <span>Installs turned off, so you can check it before enabling.</span>
                    <button type="submit" className="luma-btn-primary" disabled={busy || idTaken}>
                      {busy ? "Installing…" : "Install"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="mcp-store-note">This connection needs OAuth sign-in, which Luma does not support yet.</p>
              )}
            </form>
          )}
        </div>
      )}
    </li>
  );
}
