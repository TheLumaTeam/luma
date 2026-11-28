pub mod agent;
pub mod chats;
pub mod commands;
pub mod config;
pub mod context;
pub mod continuity;
pub mod dashboard;
pub mod desktop;
pub mod event;
pub mod gateway;
pub mod groups;
pub mod history;
pub mod integration_cli;
pub mod lease;
pub mod logging;
pub mod mcp;
pub mod model;
pub mod plugins;
pub mod protocol;
pub mod provider;
pub mod react;
pub mod recurrence;
pub mod runtime;
pub mod safety;
pub mod session;
pub mod tasks;
pub mod tools;
pub mod worker;
pub mod workspace;

#[cfg(feature = "tui")]
pub mod theme;

#[cfg(feature = "tui")]
pub mod tui;

#[cfg(test)]
pub mod tests;
