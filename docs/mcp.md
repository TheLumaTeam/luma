# Model Context Protocol (MCP)

MCP support is a separate integration system from native Luma plugins. Luma
supports local **stdio** MCP servers and remote **Streamable HTTP** MCP servers
using JSON-RPC, `initialize`, `notifications/initialized`, `tools/list`, and
`tools/call`.

## Configure a server

```sh
luma mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /path/to/workspace
luma mcp tools filesystem
luma mcp enable filesystem
luma mcp list
luma mcp disable filesystem
luma mcp remove filesystem
```

For a remote Streamable HTTP server, register its HTTPS endpoint instead:

```sh
luma mcp add-http hosted https://mcp.example.com/mcp \
  --header 'Authorization=Bearer ${MCP_TOKEN}'
luma mcp tools hosted
luma mcp enable hosted
```

Repeat `--header KEY=VALUE` for additional headers. Header values may use
`${ENVIRONMENT_VARIABLE}` references; Luma resolves them from its process
environment at request time, so secrets do not need to be stored in the MCP
registry. HTTP is accepted only for `localhost`, `127.0.0.1`, and `::1`;
remote endpoints must use HTTPS. URL-embedded credentials are rejected.

The server is registered disabled. Inspect its discovered tools before
enabling it. Add environment variables with repeatable `--env KEY=VALUE`
options. Quote references such as `--env 'API_KEY=${API_KEY}'` so your shell
does not expand the variable before Luma can read it from the launching
environment.
The server registry is stored with owner-only file permissions on Unix.

Enabled MCP tools are exposed as `mcp__<server-id>__<tool-name>` to Code and
to Teammates that inherit the Global teammate's connectors. Each tool call
starts a fresh stdio process or HTTP MCP session, initializes it, calls the
tool, and closes the short-lived connection/process. HTTP redirects are
disabled, and request and response bodies are limited to 1 MB. MCP tools require approval by
default. Every MCP tool is treated as network-capable and requires the agent's
network permission; server metadata cannot prove that a process is offline.
Code grants this capability when an enabled external integration exposes a
tool, while Teammates follow their per-agent Internet access setting. Each
MCP tool invocation still requires approval.
MCP tool descriptions are shown as their user-facing descriptions and are
also used as model guidance by default. Servers may include Luma's optional
`modelGuide` tool metadata field to provide separate usage guidance for the
model; the runtime registers it automatically with the discovered tool.

## Security and limitations

- MCP servers are arbitrary local programs running as the current OS user.
  Process separation is not sandboxing, and server initialization can execute
  code before a tool is called. Only enable servers you trust.
- Luma's network permission check controls whether a declared network-capable
  tool can be invoked. It does not OS-sandbox a server that has other ways to
  access the network.
- Tools are discovered when the core loads enabled servers. Restart Luma after
  changing server configuration so the active registry is rebuilt.

## MCP Store

The store is a catalog of published MCP servers, kept in
[TheLumaTeam/mcps](https://github.com/TheLumaTeam/mcps). In the desktop app, open
**Settings → Extensions → MCP Store**. From a terminal:

```sh
luma mcp search issues
luma mcp catalog --category databases
luma mcp info linear
luma mcp install linear --option api-key --input LINEAR_API_KEY
luma mcp tools linear
luma mcp enable linear
luma mcp remove linear
```

`--input KEY` copies `KEY` from your environment, which keeps secrets out of
shell history. `--input KEY=VALUE` passes a value directly.

- Installing never enables a server. Check what it runs or connects to first.
  Local servers run code on your machine, including `luma mcp tools`.
- Values you enter are saved in Luma's MCP registry (`mcp/servers.json`,
  readable only by you on macOS and Linux). A few vendors put the key in the
  server URL, so it shows wherever the URL does.
- **OAuth sign-in is not supported yet.** Servers that only offer OAuth are
  listed but cannot be installed.
- Luma downloads the catalog only when you browse it, and keeps a copy for when
  you are offline. Installing uses that copy, so you get what you reviewed.
- `LUMA_MCP_CATALOG` points Luma at another catalog (a file path or HTTPS URL).
  Luma shows the source whenever it is not the default one.
