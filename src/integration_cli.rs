use anyhow::{Result, bail};
use std::{collections::BTreeMap, path::Path};

use crate::mcp::catalog::{Catalog, CatalogEntry, CatalogOption};

pub fn handles(args: &[String]) -> bool {
    matches!(args.first().map(String::as_str), Some("plugins" | "mcp"))
}

pub fn run(args: &[String]) -> Result<()> {
    let Some(group) = args.first().map(String::as_str) else {
        return Ok(());
    };
    let action = args.get(1).map(String::as_str).unwrap_or("list");
    let values = &args[2..];
    match (group, action) {
        ("plugins", "list") => {
            let entries = crate::plugins::PluginManager.list()?;
            if entries.is_empty() {
                println!("No native Luma plugins installed.");
            }
            for (record, manifest) in entries {
                println!(
                    "{}  {} v{}  {}\n  {}\n  tools: {}",
                    record.id,
                    manifest.name,
                    manifest.version,
                    if record.enabled {
                        "enabled"
                    } else {
                        "disabled"
                    },
                    manifest.description,
                    manifest
                        .tools
                        .iter()
                        .map(|tool| tool.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
        ("plugins", "install") => {
            let path = one(values, "luma plugins install <path>")?;
            let record = crate::plugins::PluginManager.install(Path::new(path))?;
            println!(
                "Installed {} (disabled). Inspect it, then run: luma plugins enable {}",
                record.id, record.id
            );
        }
        ("plugins", "enable" | "disable") => {
            let id = one(values, "luma plugins enable|disable <id>")?;
            let record = crate::plugins::PluginManager.set_enabled(id, action == "enable")?;
            println!(
                "{}: {}",
                record.id,
                if record.enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );
        }
        ("plugins", "uninstall") => {
            let id = one(values, "luma plugins uninstall <id>")?;
            if !crate::plugins::PluginManager.uninstall(id)? {
                bail!("plugin not installed: {id}");
            }
            println!("Uninstalled plugin {id}.");
        }
        ("mcp", "list") => {
            let servers = crate::mcp::McpManager.list()?;
            if servers.is_empty() {
                println!("No MCP servers configured.");
            }
            for server in servers {
                let endpoint = match server.transport {
                    crate::mcp::McpTransport::Stdio => {
                        format!("{} {}", server.command, server.args.join(" "))
                    }
                    crate::mcp::McpTransport::Http => server.url.unwrap_or_default(),
                };
                println!(
                    "{}  {}  {:?}  {}",
                    server.id,
                    if server.enabled {
                        "enabled"
                    } else {
                        "disabled"
                    },
                    server.transport,
                    endpoint
                );
            }
        }
        ("mcp", "catalog" | "search") => {
            let (query, category) = catalog_filters(values)?;
            let catalog = crate::mcp::catalog::load_blocking()?;
            print_catalog_status(&catalog);
            let installed = crate::mcp::McpManager.list()?;
            let mut matches: Vec<_> = catalog
                .entries
                .iter()
                .filter(|entry| {
                    category.is_none_or(|category| entry.category == category)
                        && matches_query(entry, &query)
                })
                .collect();
            matches.sort_by_key(|entry| (&entry.category, &entry.id));
            if matches.is_empty() {
                println!("No MCP servers match.");
            }
            let mut heading = "";
            for entry in matches {
                if entry.category != heading {
                    heading = &entry.category;
                    println!("\n{heading}");
                }
                let state = if installed
                    .iter()
                    .any(|server| server.catalog_id.as_deref() == Some(&entry.id))
                {
                    "  [installed]"
                } else if !entry.options.iter().any(|option| option.is_installable()) {
                    "  [needs OAuth, not supported yet]"
                } else {
                    ""
                };
                println!("  {}  {}{state}", entry.id, entry.description);
            }
            println!("\nDetails: luma mcp info <id>");
        }
        ("mcp", "info") => {
            let id = one(values, "luma mcp info <id>")?;
            let catalog = crate::mcp::catalog::load_blocking()?;
            print_catalog_status(&catalog);
            print_entry(find_entry(&catalog, id)?);
        }
        ("mcp", "install") => {
            let request = parse_install(values, |name| std::env::var(name).ok())?;
            // `info` and `catalog` save what the user saw; only fetch if
            // nothing has been browsed yet.
            let catalog = match crate::mcp::catalog::browsed() {
                Ok(catalog) => catalog,
                Err(_) => crate::mcp::catalog::load_blocking()?,
            };
            print_catalog_status(&catalog);
            let entry = find_entry(&catalog, &request.id)?;
            let option_id = match &request.option {
                Some(option) => option.as_str(),
                None => entry
                    .options
                    .iter()
                    .find(|option| option.is_installable())
                    .map(|option| option.id.as_str())
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "'{}' needs OAuth sign-in, which Luma does not support yet",
                            entry.name
                        )
                    })?,
            };
            let server = crate::mcp::McpManager.insert(crate::mcp::catalog::server_config(
                entry,
                option_id,
                &request.inputs,
            )?)?;
            if let Some(option) = entry.options.iter().find(|option| option.id == option_id) {
                // The template, not the saved values, so secrets stay off screen.
                println!("{}", describe_option(option));
            }
            println!(
                "Installed {} (disabled). Run `luma mcp tools {}` to inspect its tools, then `luma mcp enable {}`.",
                server.id, server.id, server.id
            );
        }
        ("mcp", "add") => {
            if values.len() < 2 {
                bail!("usage: luma mcp add <id> <command> [args...] [--env KEY=VALUE]");
            }
            let id = values[0].clone();
            let command = values[1].clone();
            let mut server_args = Vec::new();
            let mut env = BTreeMap::new();
            let mut index = 2;
            while index < values.len() {
                if values[index] == "--env" {
                    index += 1;
                    let pair = values
                        .get(index)
                        .ok_or_else(|| anyhow::anyhow!("--env requires KEY=VALUE"))?;
                    let (key, value) = pair
                        .split_once('=')
                        .ok_or_else(|| anyhow::anyhow!("--env requires KEY=VALUE"))?;
                    if key.is_empty() {
                        bail!("environment variable name cannot be empty");
                    }
                    env.insert(key.to_owned(), value.to_owned());
                } else {
                    server_args.push(values[index].clone());
                }
                index += 1;
            }
            let server = crate::mcp::McpManager.add(id, command, server_args, env)?;
            println!(
                "Registered MCP server {} (disabled). Run `luma mcp tools {}` to inspect its tools, then enable it.",
                server.id, server.id
            );
        }
        ("mcp", "add-http") => {
            if values.len() < 2 {
                bail!("usage: luma mcp add-http <id> <https-url> [--header KEY=VALUE]");
            }
            let id = values[0].clone();
            let url = values[1].clone();
            let mut headers = BTreeMap::new();
            let mut index = 2;
            while index < values.len() {
                if values[index] != "--header" {
                    bail!(
                        "unexpected argument '{}'; use repeatable --header KEY=VALUE",
                        values[index]
                    );
                }
                index += 1;
                let pair = values
                    .get(index)
                    .ok_or_else(|| anyhow::anyhow!("--header requires KEY=VALUE"))?;
                let (key, value) = pair
                    .split_once('=')
                    .ok_or_else(|| anyhow::anyhow!("--header requires KEY=VALUE"))?;
                if key.is_empty() {
                    bail!("header name cannot be empty");
                }
                headers.insert(key.to_owned(), value.to_owned());
                index += 1;
            }
            let server = crate::mcp::McpManager.add_http(id, url, headers)?;
            println!(
                "Registered HTTP MCP server {} (disabled). Run `luma mcp tools {}` to inspect its tools, then enable it.",
                server.id, server.id
            );
        }
        ("mcp", "enable" | "disable") => {
            let id = one(values, "luma mcp enable|disable <id>")?;
            let server = crate::mcp::McpManager.set_enabled(id, action == "enable")?;
            println!(
                "{}: {}",
                server.id,
                if server.enabled {
                    "enabled"
                } else {
                    "disabled"
                }
            );
        }
        ("mcp", "remove") => {
            let id = one(values, "luma mcp remove <id>")?;
            if !crate::mcp::McpManager.remove(id)? {
                bail!("MCP server not found: {id}");
            }
            println!("Removed MCP server {id}.");
        }
        ("mcp", "tools") => {
            let id = one(values, "luma mcp tools <id>")?;
            let tools = crate::mcp::McpManager.tools(id)?;
            if tools.is_empty() {
                println!("This MCP server exposes no tools.");
            }
            for tool in tools {
                println!(
                    "{}\n  {}\n  {}",
                    tool.name, tool.description, tool.input_schema
                );
            }
        }
        _ => bail!("unknown {group} command `{action}`; run `luma {group} --help`"),
    }
    Ok(())
}

fn catalog_filters(values: &[String]) -> Result<(String, Option<&str>)> {
    let mut words = Vec::new();
    let mut category = None;
    let mut values = values.iter();
    while let Some(value) = values.next() {
        if value == "--category" {
            category = Some(
                values
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("--category requires a name"))?
                    .as_str(),
            );
        } else {
            words.push(value.to_lowercase());
        }
    }
    Ok((words.join(" "), category))
}

fn matches_query(entry: &CatalogEntry, query: &str) -> bool {
    let text = format!(
        "{} {} {} {} {}",
        entry.id, entry.name, entry.publisher, entry.description, entry.category
    )
    .to_lowercase();
    query.split_whitespace().all(|word| text.contains(word))
}

fn find_entry<'a>(catalog: &'a Catalog, id: &str) -> Result<&'a CatalogEntry> {
    catalog
        .entries
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| anyhow::anyhow!("'{id}' is not in the MCP catalog"))
}

fn print_catalog_status(catalog: &Catalog) {
    if catalog.source != crate::mcp::catalog::DEFAULT_CATALOG_URL {
        println!("Catalog: {}", catalog.source);
    }
    if let Some(warning) = &catalog.warning {
        eprintln!("{warning}");
    }
}

/// What an option connects to or runs, with inputs still as placeholders.
fn describe_option(option: &CatalogOption) -> String {
    match &option.url {
        Some(url) => format!("Connects to: {url}"),
        None => format!("Runs: {} {}", option.command, option.args.join(" ")),
    }
}

fn print_entry(entry: &CatalogEntry) {
    println!("{} ({}) by {}", entry.name, entry.id, entry.publisher);
    println!("{}", entry.description);
    println!("Docs: {} (checked {})", entry.docs_url, entry.verified_at);
    for note in &entry.notes {
        println!("Note: {note}");
    }
    for option in &entry.options {
        let state = if option.is_installable() {
            ""
        } else {
            "  [OAuth, not supported yet]"
        };
        println!("\n  --option {}  {}{state}", option.id, option.label);
        println!("    {}", describe_option(option));
        for input in &option.inputs {
            println!(
                "    --input {}=…  {}{}",
                input.key,
                input.label,
                if input.required { "" } else { " (optional)" }
            );
        }
    }
}

struct InstallRequest {
    id: String,
    option: Option<String>,
    inputs: BTreeMap<String, String>,
}

/// `--input KEY` without a value copies `KEY` from the environment, which
/// keeps secrets out of shell history.
fn parse_install(
    values: &[String],
    environment: impl Fn(&str) -> Option<String>,
) -> Result<InstallRequest> {
    const USAGE: &str = "usage: luma mcp install <id> [--option <name>] [--input KEY[=VALUE]]";
    let mut values = values.iter();
    let id = values.next().ok_or_else(|| anyhow::anyhow!(USAGE))?.clone();
    let mut request = InstallRequest {
        id,
        option: None,
        inputs: BTreeMap::new(),
    };
    while let Some(flag) = values.next() {
        let value = values.next().ok_or_else(|| anyhow::anyhow!(USAGE))?;
        match flag.as_str() {
            "--option" => request.option = Some(value.clone()),
            "--input" => {
                let (key, value) = match value.split_once('=') {
                    Some((key, value)) => (key.to_owned(), value.to_owned()),
                    None => {
                        let found = environment(value).ok_or_else(|| {
                            anyhow::anyhow!("environment variable {value} is not set")
                        })?;
                        (value.clone(), found)
                    }
                };
                request.inputs.insert(key, value);
            }
            _ => bail!(USAGE),
        }
    }
    Ok(request)
}

fn one<'a>(values: &'a [String], usage: &str) -> Result<&'a str> {
    if values.len() != 1 {
        bail!("usage: {usage}");
    }
    Ok(&values[0])
}

#[cfg(test)]
mod tests {
    use super::{handles, parse_install};

    #[test]
    fn install_inputs_can_come_from_the_environment() {
        let arguments: Vec<String> = ["linear", "--input", "TOKEN", "--input", "ORG=a=b"]
            .map(str::to_owned)
            .into();
        let request = parse_install(&arguments, |name| {
            (name == "TOKEN").then(|| "secret".into())
        })
        .unwrap();
        assert_eq!(request.inputs["TOKEN"], "secret");
        assert_eq!(request.inputs["ORG"], "a=b");
        assert!(parse_install(&arguments, |_| None).is_err());
    }

    #[test]
    fn integration_commands_are_dispatched_separately() {
        assert!(handles(&["plugins".into(), "list".into()]));
        assert!(handles(&["mcp".into(), "add".into()]));
        assert!(!handles(&["teammates".into()]));
        assert!(!handles(&["desktop-server".into()]));
    }
}
