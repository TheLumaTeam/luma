//! JSONL transport for the unified protocol.
//!
//! Reads [`ClientMessage`]s from stdin, writes [`ServerEvent`]s to stdout,
//! one JSON object per line. The desktop shell spawns `luma desktop-server`
//! and speaks this.
//!
//! This module is transport only. Every decision about what a message means
//! belongs to the core; the desktop shell is one client, not a privileged
//! one.

use crate::tools::{browser::BrowserControl, browser_session::BrowserProfile};
use anyhow::Result;
use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::chats;
use crate::config;
use crate::dashboard::{DashboardCommand, DashboardServer};
use crate::event::AgentEvent;
use crate::model::DynamicModel;
use crate::protocol::{
    ClientMessage, ErrorCategory, PROTOCOL_VERSION, ServerEvent, decode, encode,
};
use crate::provider::{ModelRequest, provider_for, supported_providers};
use crate::runtime::{RuntimeStore, TaskStatus};
use crate::session::{AgentCommand, Session};

/// How much input to buffer ahead of the reader.
///
/// The desktop shell may leave the process idle for a long time, so this is
/// sized generously rather than tuned for throughput.
const READ_BUFFER_BYTES: usize = 64 * 1024;

fn dashboard_assets_dir() -> Option<PathBuf> {
    std::env::var_os("LUMA_DASHBOARD_DIR").map(|directory| {
        let directory = PathBuf::from(directory);
        if directory.join("dist/index.html").is_file() {
            directory.join("dist")
        } else {
            directory
        }
    })
}

// ============================================================
// Server
// ============================================================

const RUNTIME_WATCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(250);
const RUNTIME_PUSH_BATCH: usize = 200;

pub struct DesktopServer {
    session: Session,
    input_tx: mpsc::Sender<String>,
    cancel: CancellationToken,
    model: DynamicModel,
    confirmation_tx: mpsc::Sender<crate::agent::Confirmation>,
    dashboard: Option<std::sync::Arc<DashboardServer>>,
    dashboard_task: Option<tokio::task::JoinHandle<()>>,
    runtime: RuntimeStore,
    /// The last runtime event pushed, once a client has subscribed.
    runtime_cursor: Option<i64>,
    /// Teammate browsers the user has taken control of.
    browser_controls: std::collections::HashMap<String, BrowserControl>,
}

impl DesktopServer {
    pub fn new(
        session: Session,
        input_tx: mpsc::Sender<String>,
        cancel: CancellationToken,
        model: DynamicModel,
        confirmation_tx: mpsc::Sender<crate::agent::Confirmation>,
        runtime: RuntimeStore,
    ) -> Self {
        Self {
            session,
            input_tx,
            cancel,
            model,
            confirmation_tx,
            dashboard: None,
            dashboard_task: None,
            runtime,
            runtime_cursor: None,
            browser_controls: Default::default(),
        }
    }

    /// Run the read/write loop until stdin closes or the core is cancelled.
    pub async fn run(mut self, mut events: mpsc::Receiver<AgentEvent>) -> Result<()> {
        let stdout = tokio::io::stdout();

        let mut stdout = tokio::io::BufWriter::new(stdout);

        let mut stdin = BufReader::with_capacity(READ_BUFFER_BYTES, tokio::io::stdin());

        let mut line = String::new();
        write_event(
            &mut stdout,
            ServerEvent::Ready {
                version: PROTOCOL_VERSION,
                features: vec![
                    "persistent_agents".into(),
                    "durable_tasks".into(),
                    "scoped_memory".into(),
                    "schedules".into(),
                    "event_replay".into(),
                    "permission_profiles".into(),
                    "restart_reconciliation".into(),
                    "persistent_gateway".into(),
                    "core_command_registry".into(),
                    "manual_context_compaction".into(),
                ],
            },
        )
        .await?;

        if let Err(error) = crate::tools::browser_session::remove_orphaned_profiles(&self.runtime) {
            tracing::warn!(%error, "could not check for orphaned browser data");
        }

        // The gateway writes events from another process, so watch the store.
        let mut runtime_watch = tokio::time::interval(RUNTIME_WATCH_INTERVAL);
        runtime_watch.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = runtime_watch.tick(), if self.runtime_cursor.is_some() => {
                    self.push_runtime_events(&mut stdout).await?;
                }

                read = stdin.read_line(&mut line) => {
                    if read? == 0 {
                        break;
                    }

                    let trimmed = line.trim();

                    if !trimmed.is_empty() {
                        self.handle_line(trimmed, &mut stdout).await?;
                    }

                    line.clear();
                }

                Some(event) = events.recv() => {
                    if let Some(dashboard) = &self.dashboard {
                        let _ = dashboard.events.send(event.clone());
                    }
                    // The session is the core's view of the conversation, so
                    // it folds every event first. The session then decides
                    // which events are worth putting on the wire; a client
                    // must never see an event the core did not fold in.
                    let before = self.session.state().messages.len();

                    self.session.handle_event(event.clone());

                    if let Some(event) = self.session.advance(before) {
                        write_event(&mut stdout, ServerEvent::Agent { event }).await?;
                    }
                }

                _ = self.cancel.cancelled() => break,
            }
        }

        Ok(())
    }

    /// Handle one client line. A failing request (a missing approval, a
    /// workspace that is not a Git repository, ...) must be reported to the
    /// client with its request ID; it must never terminate the core.
    async fn handle_line<W>(&mut self, line: &str, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        match self.handle_line_inner(line, stdout).await {
            Ok(()) => Ok(()),
            Err(error) => {
                tracing::warn!(%error, "client request failed");
                let request_id = serde_json::from_str::<serde_json::Value>(line)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("data")?
                            .get("request_id")?
                            .as_str()
                            .map(str::to_owned)
                    });
                report_error(
                    stdout,
                    request_id,
                    format!("{error:#}"),
                    ErrorCategory::Transient,
                )
                .await
            }
        }
    }

    async fn handle_line_inner<W>(&mut self, line: &str, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        let message = match decode(line) {
            Ok(message) => message,

            Err(error) => {
                // A malformed line must not kill the session: the client may
                // be mid-update, and the next line is probably fine.
                tracing::warn!(%error, "ignoring unparseable client message");

                // Preserve request correlation even when this core build does
                // not understand a newer message variant. Without the ID the
                // desktop client cannot reject the matching pending request
                // and would misleadingly report a timeout instead.
                let request_id = serde_json::from_str::<serde_json::Value>(line)
                    .ok()
                    .and_then(|value| {
                        value
                            .get("data")?
                            .get("request_id")?
                            .as_str()
                            .map(str::to_owned)
                    });

                return report_error(
                    stdout,
                    request_id,
                    format!("could not parse message: {error}"),
                    ErrorCategory::Fatal,
                )
                .await;
            }
        };

        match message {
            ClientMessage::GetSession => {
                write_event(
                    stdout,
                    ServerEvent::Session {
                        session: self.session.view(),
                    },
                )
                .await
            }

            ClientMessage::SetModel { request_id, model } => {
                self.change_model(request_id, model, stdout).await
            }

            ClientMessage::SetSessionModel { request_id, model } => {
                self.change_session_model(request_id, model, stdout).await
            }

            ClientMessage::RunCommand {
                request_id,
                id,
                query,
            } if matches!(
                id.as_str(),
                "history_delete" | "history_prune" | "summary" | "rename"
            ) =>
            {
                self.run_session_command(request_id, id, query, stdout)
                    .await
            }

            ClientMessage::HistoryDelete { request_id, id } => {
                self.run_typed_history_delete(request_id, id, stdout).await
            }

            ClientMessage::HistoryPrune { request_id } => {
                self.run_typed_history_prune(request_id, stdout).await
            }

            ClientMessage::SummaryAdd {
                request_id,
                id,
                summary,
            } => {
                self.run_typed_summary_add(request_id, id, summary, stdout)
                    .await
            }

            ClientMessage::StartDashboard {
                request_id,
                host,
                port,
            } => self.start_dashboard(request_id, host, port, stdout).await,

            ClientMessage::BrowserView {
                request_id,
                agent_id,
            } => self.send_browser_view(request_id, &agent_id, stdout).await,
            ClientMessage::BrowserTakeControl {
                request_id,
                agent_id,
            } => {
                self.browser_controls.retain(|_, control| control.is_open());
                if !self.browser_controls.contains_key(&agent_id) {
                    let profile = self.browser_profile(&agent_id)?;
                    let control =
                        tokio::task::spawn_blocking(move || BrowserControl::start(&profile))
                            .await??;
                    self.browser_controls.insert(agent_id.clone(), control);
                }
                self.send_browser_view(request_id, &agent_id, stdout).await
            }
            ClientMessage::BrowserRelease {
                request_id,
                agent_id,
            } => {
                if let Some(control) = self.browser_controls.remove(&agent_id) {
                    tokio::task::spawn_blocking(move || control.finish()).await?;
                }
                self.send_browser_view(request_id, &agent_id, stdout).await
            }
            ClientMessage::BrowserClear {
                request_id,
                agent_id,
            } => {
                self.browser_profile(&agent_id)?.clear()?;
                self.send_browser_view(request_id, &agent_id, stdout).await
            }
            ClientMessage::AgentDelete { request_id, id } => {
                // Close a window the user left open, letting the browser exit
                // before its data is removed.
                if let Some(control) = self.browser_controls.remove(&id) {
                    tokio::task::spawn_blocking(move || control.finish()).await?;
                }
                let deleted = crate::tools::browser_session::delete_teammate(&self.runtime, &id)?;
                write_event(
                    stdout,
                    ServerEvent::AgentDeleted {
                        request_id,
                        id,
                        deleted,
                    },
                )
                .await
            }
            ClientMessage::RuntimeSubscribe { request_id } => {
                // Subscribing again keeps the cursor, so nothing is skipped.
                if self.runtime_cursor.is_none() {
                    self.runtime_cursor = Some(self.runtime.latest_event_sequence()?);
                }
                write_event(stdout, ServerEvent::RuntimeSubscribed { request_id }).await
            }
            message if is_runtime_message(&message) => self.serve_runtime(message, stdout).await,

            message if message.request_id().is_some() => serve(message, stdout).await,

            // Everything left is a conversation command, which the session
            // owns; `into_command` only returns `None` for the arms above.
            message => {
                let command = message
                    .into_command()
                    .expect("every non-request client message is a session command");

                self.run_command(command, stdout).await
            }
        }
    }

    /// The browser profile of an existing Teammate.
    fn browser_profile(&self, agent_id: &str) -> Result<BrowserProfile> {
        if self.runtime.get_agent(agent_id)?.is_none() {
            anyhow::bail!("agent not found: {agent_id}");
        }
        BrowserProfile::for_agent(agent_id)
    }

    async fn send_browser_view<W>(
        &mut self,
        request_id: String,
        agent_id: &str,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        self.browser_controls.retain(|_, control| control.is_open());
        let in_control = self.browser_controls.contains_key(agent_id);
        let view = self.browser_profile(agent_id)?.view(agent_id, in_control);
        write_event(stdout, ServerEvent::BrowserView { request_id, view }).await
    }

    async fn push_runtime_events<W>(&mut self, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        let Some(cursor) = self.runtime_cursor else {
            return Ok(());
        };
        let events = match self.runtime.events_since(cursor, RUNTIME_PUSH_BATCH) {
            Ok(events) => events,
            // A busy database is retried on the next tick.
            Err(error) => {
                tracing::warn!(%error, "could not read new runtime events");
                return Ok(());
            }
        };
        if let Some(last) = events.last() {
            self.runtime_cursor = Some(last.sequence);
            write_event(stdout, ServerEvent::RuntimeUpdate { events }).await?;
        }
        Ok(())
    }

    async fn serve_runtime<W>(&self, message: ClientMessage, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        if let ClientMessage::ApprovalResolve {
            request_id,
            id,
            allowed,
        } = &message
        {
            let approval = self
                .runtime
                .list_pending_approvals()?
                .into_iter()
                .find(|approval| approval.id == *id)
                .ok_or_else(|| anyhow::anyhow!("approval not found or already resolved: {id}"))?;
            let task = self
                .runtime
                .get_task(&approval.task_id)?
                .ok_or_else(|| anyhow::anyhow!("approval task no longer exists"))?;
            if task.status != TaskStatus::WaitingForApproval {
                anyhow::bail!("the task is no longer waiting for this approval");
            }
            let agent = self
                .runtime
                .get_agent(&approval.agent_id)?
                .ok_or_else(|| anyhow::anyhow!("approval agent no longer exists"))?;
            if matches!(
                agent.status,
                crate::runtime::AgentStatus::Paused | crate::runtime::AgentStatus::Stopped
            ) {
                anyhow::bail!("resume the agent before resolving its approval");
            }
            let approval = self.runtime.resolve_approval(id, *allowed)?;
            return write_event(
                stdout,
                ServerEvent::ApprovalResolved {
                    request_id: request_id.clone(),
                    approval,
                },
            )
            .await;
        }
        let request_id = message.request_id().map(str::to_owned);
        let result: Result<ServerEvent> = (|| {
            Ok(match message {
                ClientMessage::AgentsList { request_id } => ServerEvent::Agents {
                    request_id,
                    agents: self.runtime.list_agents()?,
                },
                ClientMessage::AgentCreate {
                    request_id,
                    name,
                    description,
                    kind,
                    configuration,
                    welcome,
                } => {
                    let agent =
                        self.runtime
                            .create_agent(&name, description, kind, configuration)?;
                    if welcome {
                        self.runtime.welcome_teammate(&agent.id)?;
                    }
                    ServerEvent::AgentSaved { request_id, agent }
                }
                ClientMessage::AgentUpdate {
                    request_id,
                    id,
                    name,
                    description,
                    configuration,
                } => ServerEvent::AgentSaved {
                    request_id,
                    agent: self
                        .runtime
                        .update_agent(&id, name, description, configuration)?,
                },
                ClientMessage::AgentSetStatus {
                    request_id,
                    id,
                    status,
                } => {
                    if !matches!(
                        status,
                        crate::runtime::AgentStatus::Idle
                            | crate::runtime::AgentStatus::Paused
                            | crate::runtime::AgentStatus::Stopped
                    ) {
                        anyhow::bail!("clients may only set an agent to idle, paused, or stopped");
                    }
                    self.runtime.set_agent_status(&id, status)?;
                    let agent = self
                        .runtime
                        .get_agent(&id)?
                        .ok_or_else(|| anyhow::anyhow!("agent not found: {id}"))?;
                    ServerEvent::AgentSaved { request_id, agent }
                }
                ClientMessage::TasksList {
                    request_id,
                    agent_id,
                    limit,
                } => ServerEvent::Tasks {
                    request_id,
                    tasks: self
                        .runtime
                        .list_tasks(agent_id.as_deref(), limit.unwrap_or(100))?,
                },
                ClientMessage::TaskCreate {
                    request_id,
                    agent_id,
                    request,
                    title,
                    workspace,
                    recover_on_restart,
                    conversation_id,
                } => ServerEvent::TaskSaved {
                    request_id,
                    task: self.runtime.create_task_in_conversation(
                        &agent_id,
                        &request,
                        crate::runtime::CreateTaskOptions {
                            title,
                            workspace,
                            recover_on_restart,
                            schedule_id: None,
                            conversation_id: conversation_id.as_deref(),
                        },
                    )?,
                },
                ClientMessage::TaskCancel { request_id, id } => {
                    let task = self
                        .runtime
                        .get_task(&id)?
                        .ok_or_else(|| anyhow::anyhow!("task not found: {id}"))?;
                    if task.status == TaskStatus::Running
                        || task.status == TaskStatus::WaitingForApproval
                        || task.status == TaskStatus::WaitingForInput
                    {
                        self.runtime.enqueue_gateway_cancel(&id)?;
                        ServerEvent::TaskSaved { request_id, task }
                    } else if task.status == TaskStatus::Queued || task.status == TaskStatus::Paused
                    {
                        ServerEvent::TaskSaved {
                            request_id,
                            task: self.runtime.transition_task(
                                &id,
                                TaskStatus::Cancelled,
                                None,
                                None,
                            )?,
                        }
                    } else {
                        anyhow::bail!("task is already in a terminal state")
                    }
                }
                ClientMessage::CheckInSet {
                    request_id,
                    agent_id,
                } => {
                    self.runtime.set_lead_check_in(agent_id.as_deref())?;
                    ServerEvent::Schedules {
                        request_id,
                        schedules: self.runtime.list_schedules(None)?,
                    }
                }
                ClientMessage::GroupsList { request_id } => ServerEvent::Groups {
                    request_id,
                    groups: self.runtime.list_groups()?,
                },
                ClientMessage::GroupCreate {
                    request_id,
                    name,
                    member_ids,
                } => {
                    self.runtime.create_group(&name, &member_ids)?;
                    ServerEvent::Groups {
                        request_id,
                        groups: self.runtime.list_groups()?,
                    }
                }
                ClientMessage::GroupDelete { request_id, id } => {
                    self.runtime.delete_group(&id)?;
                    ServerEvent::Groups {
                        request_id,
                        groups: self.runtime.list_groups()?,
                    }
                }
                ClientMessage::GroupPost {
                    request_id,
                    id,
                    message,
                } => {
                    self.runtime.post_to_group(&id, &message)?;
                    ServerEvent::GroupTranscript {
                        request_id,
                        messages: self.runtime.group_transcript(&id)?,
                    }
                }
                ClientMessage::GroupTranscript { request_id, id } => ServerEvent::GroupTranscript {
                    request_id,
                    messages: self.runtime.group_transcript(&id)?,
                },
                ClientMessage::AgentPresenceList { request_id } => ServerEvent::AgentPresence {
                    request_id,
                    presence: self.runtime.agent_presence()?,
                },
                ClientMessage::TaskSteer {
                    request_id,
                    id,
                    message,
                } => ServerEvent::TaskSaved {
                    request_id,
                    task: self.runtime.steer_task(&id, &message)?,
                },
                ClientMessage::TaskAnswerQuestion {
                    request_id,
                    id,
                    question_id,
                    answer,
                } => ServerEvent::TaskSaved {
                    request_id,
                    task: self
                        .runtime
                        .answer_task_question(&id, &question_id, &answer)?,
                },
                ClientMessage::TaskRetry { request_id, id } => {
                    let task = self
                        .runtime
                        .get_task(&id)?
                        .ok_or_else(|| anyhow::anyhow!("task not found: {id}"))?;
                    if task.status != TaskStatus::Failed && task.status != TaskStatus::Interrupted {
                        anyhow::bail!("only failed or interrupted tasks can be retried");
                    }
                    if self
                        .runtime
                        .get_agent(&task.agent_id)?
                        .is_none_or(|agent| agent.status == crate::runtime::AgentStatus::Stopped)
                    {
                        anyhow::bail!("cannot retry work for a stopped agent");
                    }
                    ServerEvent::TaskSaved {
                        request_id,
                        task: self
                            .runtime
                            .transition_task(&id, TaskStatus::Queued, None, None)?,
                    }
                }
                ClientMessage::TaskActionsList { request_id, id } => ServerEvent::TaskActions {
                    request_id,
                    actions: self.runtime.list_task_actions(&id)?,
                    id,
                },
                ClientMessage::TaskActionsReconcile {
                    request_id,
                    id,
                    acknowledgement,
                } => ServerEvent::TaskActionsReconciled {
                    request_id,
                    reconciled: self.runtime.reconcile_task_actions(&id, &acknowledgement)?,
                    id,
                },
                ClientMessage::TaskRename {
                    request_id,
                    id,
                    title,
                } => ServerEvent::TaskSaved {
                    request_id,
                    task: self.runtime.rename_task(&id, &title)?,
                },
                ClientMessage::TaskDelete { request_id, id } => ServerEvent::TaskDeleted {
                    request_id,
                    deleted: self.runtime.delete_task(&id)?,
                    id,
                },
                ClientMessage::PluginsList { request_id } => ServerEvent::Plugins {
                    request_id,
                    plugins: crate::plugins::PluginManager.list()?,
                },
                ClientMessage::PluginInstall { request_id, path } => ServerEvent::PluginSaved {
                    request_id,
                    plugin: crate::plugins::PluginManager.install(std::path::Path::new(&path))?,
                },
                ClientMessage::PluginSetEnabled {
                    request_id,
                    id,
                    enabled,
                } => ServerEvent::PluginSaved {
                    request_id,
                    plugin: crate::plugins::PluginManager.set_enabled(&id, enabled)?,
                },
                ClientMessage::PluginUninstall { request_id, id } => ServerEvent::PluginDeleted {
                    request_id,
                    deleted: crate::plugins::PluginManager.uninstall(&id)?,
                    id,
                },
                ClientMessage::McpList { request_id } => ServerEvent::McpServers {
                    request_id,
                    servers: crate::mcp::McpManager.list()?,
                },
                ClientMessage::McpAddStdio {
                    request_id,
                    id,
                    command,
                    args,
                    env,
                } => ServerEvent::McpSaved {
                    request_id,
                    server: crate::mcp::McpManager.add(id, command, args, env)?,
                },
                ClientMessage::McpAddHttp {
                    request_id,
                    id,
                    url,
                    headers,
                } => ServerEvent::McpSaved {
                    request_id,
                    server: crate::mcp::McpManager.add_http(id, url, headers)?,
                },
                ClientMessage::McpSetEnabled {
                    request_id,
                    id,
                    enabled,
                } => ServerEvent::McpSaved {
                    request_id,
                    server: crate::mcp::McpManager.set_enabled(&id, enabled)?,
                },
                ClientMessage::McpUpdate { request_id, server } => ServerEvent::McpSaved {
                    request_id,
                    server: crate::mcp::McpManager.update(server)?,
                },
                ClientMessage::McpRemove { request_id, id } => ServerEvent::McpDeleted {
                    request_id,
                    deleted: crate::mcp::McpManager.remove(&id)?,
                    id,
                },
                ClientMessage::ApprovalsList { request_id } => ServerEvent::Approvals {
                    request_id,
                    approvals: self.runtime.list_pending_approvals()?,
                },
                ClientMessage::MemoryList {
                    request_id,
                    scope,
                    scope_id,
                    query,
                    limit,
                } => ServerEvent::Memory {
                    request_id,
                    entries: self.runtime.list_memory(
                        scope,
                        &scope_id,
                        query.as_deref(),
                        limit.unwrap_or(100),
                    )?,
                },
                ClientMessage::MemoryAdd {
                    request_id,
                    scope,
                    scope_id,
                    content,
                    source,
                } => ServerEvent::MemorySaved {
                    request_id,
                    entry: self
                        .runtime
                        .add_memory(scope, &scope_id, &content, source)?,
                },
                ClientMessage::MemoryDelete { request_id, id } => ServerEvent::MemoryDeleted {
                    request_id,
                    deleted: self.runtime.delete_memory(&id)?,
                },
                ClientMessage::SchedulesList {
                    request_id,
                    agent_id,
                } => ServerEvent::Schedules {
                    request_id,
                    schedules: self.runtime.list_schedules(agent_id.as_deref())?,
                },
                ClientMessage::ScheduleCreate {
                    request_id,
                    agent_id,
                    title,
                    prompt,
                    run_at,
                    every_seconds,
                } => ServerEvent::ScheduleSaved {
                    request_id,
                    schedule: self.runtime.create_schedule(
                        &agent_id,
                        &title,
                        &prompt,
                        run_at,
                        every_seconds,
                    )?,
                },
                ClientMessage::ScheduleDelete { request_id, id } => ServerEvent::ScheduleDeleted {
                    request_id,
                    deleted: self.runtime.delete_schedule(&id)?,
                },
                ClientMessage::ScheduleSetEnabled {
                    request_id,
                    id,
                    enabled,
                } => ServerEvent::ScheduleSaved {
                    request_id,
                    schedule: self.runtime.set_schedule_enabled(&id, enabled)?,
                },
                ClientMessage::EventTriggersList {
                    request_id,
                    agent_id,
                } => ServerEvent::EventTriggers {
                    request_id,
                    triggers: self.runtime.list_event_triggers(agent_id.as_deref())?,
                },
                ClientMessage::EventTriggerCreate {
                    request_id,
                    agent_id,
                    title,
                    prompt,
                    event_type,
                    cooldown_seconds,
                } => ServerEvent::EventTriggerSaved {
                    request_id,
                    trigger: self.runtime.create_event_trigger(
                        &agent_id,
                        &title,
                        &prompt,
                        &event_type,
                        cooldown_seconds,
                    )?,
                },
                ClientMessage::EventTriggerDelete { request_id, id } => {
                    ServerEvent::EventTriggerDeleted {
                        request_id,
                        deleted: self.runtime.delete_event_trigger(&id)?,
                    }
                }
                ClientMessage::EventTriggerSetEnabled {
                    request_id,
                    id,
                    enabled,
                } => ServerEvent::EventTriggerSaved {
                    request_id,
                    trigger: self.runtime.set_event_trigger_enabled(&id, enabled)?,
                },
                ClientMessage::EventsSince {
                    request_id,
                    sequence,
                    limit,
                    agent_id,
                } => ServerEvent::RuntimeEvents {
                    request_id,
                    events: if let Some(agent_id) = agent_id.as_deref() {
                        self.runtime
                            .events_for_agent(agent_id, sequence, limit.unwrap_or(100))?
                    } else {
                        self.runtime.events_since(sequence, limit.unwrap_or(100))?
                    },
                },
                ClientMessage::RuntimeCapabilities { request_id } => {
                    ServerEvent::RuntimeCapabilities {
                        request_id,
                        features: vec![
                            "persistent_agents".into(),
                            "durable_tasks".into(),
                            "scoped_memory".into(),
                            "schedules".into(),
                            "event_triggers".into(),
                            "conversation_threads".into(),
                            "event_replay".into(),
                            "permission_profiles".into(),
                            "restart_reconciliation".into(),
                            "persistent_gateway".into(),
                            "task_action_journal".into(),
                            "persistent_task_plans".into(),
                            "task_steering".into(),
                            "runtime_push".into(),
                            "agent_presence".into(),
                            "lead_check_in".into(),
                            "group_chats".into(),
                            "teammate_browser".into(),
                            "teammate_welcome".into(),
                            "agent_evaluation".into(),
                            "github_integration".into(),
                            "browser_automation".into(),
                            "global_agent_inbox".into(),
                        ],
                        storage_schema: 10,
                    }
                }
                _ => anyhow::bail!("not a runtime request"),
            })
        })();
        match result {
            Ok(event) => write_event(stdout, event).await,
            Err(error) => {
                report_error(stdout, request_id, error.to_string(), ErrorCategory::Fatal).await
            }
        }
    }

    async fn change_model<W>(
        &mut self,
        request_id: String,
        name: String,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        let name = name.trim();
        if name.is_empty() {
            return report_error(
                stdout,
                Some(request_id),
                "model name cannot be empty".into(),
                ErrorCategory::Fatal,
            )
            .await;
        }

        let mut settings = match config::load() {
            Ok(config) => config,
            Err(error) => {
                return report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await;
            }
        };
        settings.model.name = name.to_string();

        let provider = crate::provider::provider_by_id(&settings.model.provider)
            .or_else(|| {
                settings
                    .providers
                    .iter()
                    .find(|provider| provider.id == settings.model.provider)
                    .cloned()
            })
            .or_else(|| {
                settings.model.provider.starts_with("custom-").then(|| {
                    crate::provider::SupportedProvider {
                        id: settings.model.provider.clone(),
                        name: "Custom provider".into(),
                        description: "Temporary custom OpenAI-compatible provider".into(),
                        category: crate::provider::ProviderCategory::Custom,
                        protocol: crate::provider::ProviderProtocol::OpenAiCompatible,
                        endpoint: settings.model.endpoint.clone(),
                        requires_api_key: settings.model.api_key.is_some(),
                        supports_model_discovery: true,
                        api_key_env: None,
                    }
                })
            });
        let Some(provider) = provider else {
            return report_error(
                stdout,
                Some(request_id),
                format!("Unknown configured provider: {}", settings.model.provider),
                ErrorCategory::Fatal,
            )
            .await;
        };
        let request = ModelRequest {
            provider,
            api_key: settings.model.api_key.clone(),
            endpoint: Some(settings.model.endpoint.clone()),
        };
        if let Err(error) = provider_for(&request.provider).test(&request, name).await {
            return report_error(
                stdout,
                Some(request_id),
                format!("Model test failed: {error}"),
                ErrorCategory::Transient,
            )
            .await;
        }

        if let Err(error) = config::save(&settings) {
            return report_error(
                stdout,
                Some(request_id),
                error.to_string(),
                ErrorCategory::Transient,
            )
            .await;
        }

        self.model.replace(&settings.model).await;
        self.session
            .set_model(settings.model.provider.clone(), settings.model.name.clone());
        write_event(
            stdout,
            ServerEvent::ModelChanged {
                request_id,
                provider: settings.model.provider,
                model: settings.model.name,
            },
        )
        .await?;
        write_event(
            stdout,
            ServerEvent::Session {
                session: self.session.view(),
            },
        )
        .await
    }

    async fn change_session_model<W>(
        &mut self,
        request_id: String,
        model: crate::config::ModelConfig,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        let provider = crate::provider::provider_by_id(&model.provider)
            .or_else(|| {
                config::load()
                    .ok()?
                    .providers
                    .into_iter()
                    .find(|provider| provider.id == model.provider)
            })
            .or_else(|| {
                model
                    .provider
                    .starts_with("custom-")
                    .then(|| crate::provider::SupportedProvider {
                        id: model.provider.clone(),
                        name: "Custom provider".into(),
                        description: "Custom OpenAI-compatible provider".into(),
                        category: crate::provider::ProviderCategory::Custom,
                        protocol: crate::provider::ProviderProtocol::OpenAiCompatible,
                        endpoint: model.endpoint.clone(),
                        requires_api_key: model.api_key.is_some(),
                        supports_model_discovery: true,
                        api_key_env: None,
                    })
            });
        let Some(provider) = provider else {
            return report_error(
                stdout,
                Some(request_id),
                format!("Unknown provider: {}", model.provider),
                ErrorCategory::Fatal,
            )
            .await;
        };
        if model.name.trim().is_empty() || model.endpoint.trim().is_empty() {
            return report_error(
                stdout,
                Some(request_id),
                "Provider endpoint and model name are required.".into(),
                ErrorCategory::Fatal,
            )
            .await;
        }
        let request = ModelRequest {
            provider,
            api_key: model.api_key.clone(),
            endpoint: Some(model.endpoint.clone()),
        };
        if let Err(error) = provider_for(&request.provider)
            .test(&request, &model.name)
            .await
        {
            return report_error(
                stdout,
                Some(request_id),
                format!("Model test failed: {error}"),
                ErrorCategory::Transient,
            )
            .await;
        }
        self.model.replace(&model).await;
        self.session
            .set_model(model.provider.clone(), model.name.clone());
        write_event(
            stdout,
            ServerEvent::ModelChanged {
                request_id,
                provider: model.provider,
                model: model.name,
            },
        )
        .await?;
        write_event(
            stdout,
            ServerEvent::Session {
                session: self.session.view(),
            },
        )
        .await
    }

    async fn run_session_command<W>(
        &mut self,
        request_id: String,
        id: String,
        query: Option<String>,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        match self.session.apply_run_command(&id, query.as_deref()).await {
            Ok(content) => {
                write_event(
                    stdout,
                    ServerEvent::CommandOutput {
                        request_id,
                        id,
                        content,
                    },
                )
                .await?;
                write_event(
                    stdout,
                    ServerEvent::Session {
                        session: self.session.view(),
                    },
                )
                .await
            }
            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await
            }
        }
    }

    async fn run_typed_history_delete<W>(
        &mut self,
        request_id: String,
        id: String,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        match self
            .session
            .apply_run_command("history_delete", Some(&id))
            .await
        {
            Ok(content) => {
                let deleted = content.starts_with("Deleted chat ");
                write_event(
                    stdout,
                    ServerEvent::HistoryDeleted {
                        request_id,
                        id,
                        deleted,
                    },
                )
                .await?;
                self.write_session_snapshot(stdout).await
            }
            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await
            }
        }
    }

    async fn run_typed_history_prune<W>(&mut self, request_id: String, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        match self
            .session
            .apply_run_command("history_prune", Some("confirm"))
            .await
        {
            Ok(content) if content.starts_with("Cancel the current request") => {
                report_error(stdout, Some(request_id), content, ErrorCategory::Transient).await
            }
            Ok(content) => {
                let removed = content
                    .split_whitespace()
                    .nth(2)
                    .and_then(|value| value.parse().ok())
                    .unwrap_or_default();
                write_event(
                    stdout,
                    ServerEvent::HistoryPruned {
                        request_id,
                        removed,
                    },
                )
                .await?;
                self.write_session_snapshot(stdout).await
            }
            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await
            }
        }
    }

    async fn run_typed_summary_add<W>(
        &mut self,
        request_id: String,
        id: String,
        summary: String,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        let query = serde_json::json!({ "id": id, "summary": summary }).to_string();
        match self
            .session
            .apply_run_command("summary", Some(&query))
            .await
        {
            Ok(_) => {
                write_event(stdout, ServerEvent::SummarySaved { request_id, id }).await?;
                self.write_session_snapshot(stdout).await
            }
            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await
            }
        }
    }

    async fn write_session_snapshot<W>(&self, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        write_event(
            stdout,
            ServerEvent::Session {
                session: self.session.view(),
            },
        )
        .await
    }

    async fn start_dashboard<W>(
        &mut self,
        request_id: String,
        host: String,
        port: u16,
        stdout: &mut W,
    ) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        // A listener task can terminate after an OS/socket error. Reap its
        // stale state before deciding whether another Dashboard may start.
        if self
            .dashboard_task
            .as_ref()
            .is_some_and(tokio::task::JoinHandle::is_finished)
        {
            self.dashboard_task = None;
            self.dashboard = None;
        }

        if self.dashboard_task.is_some() {
            return report_error(
                stdout,
                Some(request_id),
                "Dashboard is already running in this core process.".into(),
                ErrorCategory::Fatal,
            )
            .await;
        }

        let bind_address: std::net::IpAddr = match host.as_str() {
            "localhost" => std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
            value => match value.parse() {
                Ok(address) => address,
                Err(_) => {
                    return report_error(
                        stdout,
                        Some(request_id),
                        "Dashboard host must be a loopback IP address.".into(),
                        ErrorCategory::Fatal,
                    )
                    .await;
                }
            },
        };
        if !bind_address.is_loopback() {
            return report_error(stdout, Some(request_id), "Unauthenticated dashboard access is restricted to loopback. Remote access requires authenticated transport.".into(), ErrorCategory::Fatal).await;
        }

        let (dashboard, mut dashboard_commands) =
            DashboardServer::new(dashboard_assets_dir(), 256, self.runtime.clone());
        let listener = match tokio::net::TcpListener::bind((bind_address, port)).await {
            Ok(listener) => listener,
            Err(error) => {
                return report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await;
            }
        };
        let address = listener.local_addr()?.to_string();

        let input_tx = self.input_tx.clone();
        let confirmation_tx = self.confirmation_tx.clone();
        let request_cancel = self.session.request_cancellation();
        tokio::spawn(async move {
            while let Some(command) = dashboard_commands.recv().await {
                match command {
                    DashboardCommand::Chat(text) => {
                        if input_tx.send(text).await.is_err() {
                            break;
                        }
                    }
                    DashboardCommand::Confirm { allowed } => {
                        let confirmation = if allowed {
                            crate::agent::Confirmation::Allow
                        } else {
                            crate::agent::Confirmation::Deny
                        };
                        if confirmation_tx.send(confirmation).await.is_err() {
                            break;
                        }
                    }
                    DashboardCommand::Cancel => request_cancel.cancel(),
                }
            }
        });

        self.dashboard = Some(dashboard.clone());
        self.dashboard_task = Some(tokio::spawn(async move {
            if let Err(error) = dashboard.run_listener(listener).await {
                tracing::error!(%error, "Dashboard server stopped");
            }
        }));

        write_event(
            stdout,
            ServerEvent::DashboardStarted {
                request_id,
                address,
            },
        )
        .await
    }

    /// Dispatch a session command, reporting rejections back to the client
    /// instead of taking the process down.
    async fn run_command<W>(&mut self, command: AgentCommand, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        let forwarded = match self.session.apply(command.clone()).await {
            // Anything the session resolves locally (`/help`, `/quit`) or
            // routes to the agent itself — a confirmation, a cancel — returns
            // `None`, and has already been acted on.
            Ok(forwarded) => forwarded,

            Err(error) => {
                tracing::warn!(%error, "client command rejected");

                return report_error(stdout, None, error.to_string(), ErrorCategory::Transient)
                    .await;
            }
        };

        match forwarded {
            Some(text) => {
                write_event(
                    stdout,
                    ServerEvent::Session {
                        session: self.session.view(),
                    },
                )
                .await?;
                self.forward(text, stdout).await
            }

            // Local commands (`/help`, `/clear`) and state-only commands do
            // not generate an agent event, so send the updated snapshot to
            // keep clients' transcript and status in sync.
            None => {
                write_event(
                    stdout,
                    ServerEvent::Session {
                        session: self.session.view(),
                    },
                )
                .await
            }
        }
    }

    /// Hand a prompt to the agent. The session has already recorded it in the
    /// transcript, so a failure here is a dead agent, not a bad request.
    async fn forward<W>(&self, text: String, stdout: &mut W) -> Result<()>
    where
        W: AsyncWriteExt + Unpin,
    {
        match self.input_tx.send(text).await {
            Ok(()) => Ok(()),

            Err(_) => {
                report_error(
                    stdout,
                    None,
                    "the agent is no longer accepting input".to_string(),
                    ErrorCategory::Fatal,
                )
                .await
            }
        }
    }
}

fn is_runtime_message(message: &ClientMessage) -> bool {
    matches!(
        message,
        ClientMessage::AgentsList { .. }
            | ClientMessage::AgentCreate { .. }
            | ClientMessage::AgentDelete { .. }
            | ClientMessage::AgentUpdate { .. }
            | ClientMessage::AgentSetStatus { .. }
            | ClientMessage::TasksList { .. }
            | ClientMessage::TaskCreate { .. }
            | ClientMessage::TaskCancel { .. }
            | ClientMessage::TaskSteer { .. }
            | ClientMessage::AgentPresenceList { .. }
            | ClientMessage::GroupsList { .. }
            | ClientMessage::GroupCreate { .. }
            | ClientMessage::GroupDelete { .. }
            | ClientMessage::GroupPost { .. }
            | ClientMessage::GroupTranscript { .. }
            | ClientMessage::CheckInSet { .. }
            | ClientMessage::TaskAnswerQuestion { .. }
            | ClientMessage::TaskRetry { .. }
            | ClientMessage::TaskActionsList { .. }
            | ClientMessage::TaskActionsReconcile { .. }
            | ClientMessage::TaskRename { .. }
            | ClientMessage::TaskDelete { .. }
            | ClientMessage::ApprovalsList { .. }
            | ClientMessage::ApprovalResolve { .. }
            | ClientMessage::MemoryList { .. }
            | ClientMessage::MemoryAdd { .. }
            | ClientMessage::MemoryDelete { .. }
            | ClientMessage::SchedulesList { .. }
            | ClientMessage::ScheduleCreate { .. }
            | ClientMessage::ScheduleDelete { .. }
            | ClientMessage::ScheduleSetEnabled { .. }
            | ClientMessage::EventTriggersList { .. }
            | ClientMessage::EventTriggerCreate { .. }
            | ClientMessage::EventTriggerDelete { .. }
            | ClientMessage::EventTriggerSetEnabled { .. }
            | ClientMessage::EventsSince { .. }
            | ClientMessage::RuntimeCapabilities { .. }
    )
}

// ============================================================
// Core-owned interactive commands
// ============================================================

fn execute_core_command(id: &str, query: Option<&str>) -> Result<String> {
    use crate::tools::{Tool, developer, filesystem, git};
    use serde_json::json;
    let workspace = std::env::current_dir()?.canonicalize()?;
    let scoped_path = |value: Option<&str>| -> Result<String> {
        let candidate = value.map_or_else(|| workspace.clone(), |value| workspace.join(value));
        let canonical = candidate.canonicalize()?;
        if !canonical.starts_with(&workspace) {
            anyhow::bail!("workspace command path must stay inside the active workspace");
        }
        Ok(canonical.display().to_string())
    };

    match id {
        "git_status" => {
            git::GitChanges.execute(&json!({"path": workspace.display().to_string()}).to_string())
        }
        "git" => {
            let path = workspace.display().to_string();
            let view = query.unwrap_or("status");
            if let Some(file) = view.strip_prefix("stage:") {
                return git::GitStage.execute(&json!({"path": path, "file": file}).to_string());
            }
            if let Some(file) = view.strip_prefix("unstage:") {
                return git::GitUnstage.execute(&json!({"path": path, "file": file}).to_string());
            }
            if let Some(file) = view.strip_prefix("revert:") {
                return git::GitRevert.execute(&json!({"path": path, "file": file}).to_string());
            }
            if let Some(file) = view.strip_prefix("diff:") {
                return git::GitDiff.execute(&json!({"path": path, "file": file}).to_string());
            }
            if let Some(file) = view.strip_prefix("diff-staged:") {
                return git::GitDiff
                    .execute(&json!({"path": path, "file": file, "staged": true}).to_string());
            }
            match view {
                "status" => git::GitStatus.execute(&json!({"path": path}).to_string()),
                "status_json" | "git_status" => {
                    git::GitChanges.execute(&json!({"path": path}).to_string())
                }
                "diff" => git::GitDiff.execute(&json!({"path": path}).to_string()),
                "diff_staged" => {
                    git::GitDiff.execute(&json!({"path": path, "staged": true}).to_string())
                }
                "log" => developer::GitLog.execute(&json!({"path": path, "limit": 20}).to_string()),
                "branches" => developer::GitBranches.execute(&json!({"path": path}).to_string()),
                other => {
                    anyhow::bail!(
                        "unknown Git view: {other}; use status, status_json, diff, log, branches, stage:<file>, unstage:<file>, or revert:<file>"
                    )
                }
            }
        }
        "files" => {
            let path = scoped_path(query)?;
            filesystem::list_directory::ListDirectory
                .execute(&json!({"path": path, "depth": 3}).to_string())
        }
        "search" => {
            let pattern = query
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("workspace search requires a non-empty query"))?;
            let files = filesystem::search_files::SearchFiles.execute(
                &json!({"path": workspace.display().to_string(), "pattern": pattern}).to_string(),
            )?;
            let files = match serde_json::from_str::<serde_json::Value>(&files) {
                Ok(value) => value,
                Err(_) => serde_json::Value::String(files),
            };
            let conversations = crate::chats::search(pattern)?;
            Ok(serde_json::to_string_pretty(&json!({
                "workspace_files": files,
                "conversations": conversations,
            }))?)
        }
        "find_files" => {
            let pattern = query
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("file finder requires a non-empty query"))?;
            filesystem::find_files::FindFiles.execute(
                &json!({"path": workspace.display().to_string(), "query": pattern, "limit": 40})
                    .to_string(),
            )
        }
        "read_file" => {
            let path = scoped_path(query)?;
            filesystem::read_file::ReadFile.execute(&path)
        }
        "doctor" => developer::InspectProject
            .execute(&json!({"path": workspace.display().to_string()}).to_string()),
        "help" | "commands" => Ok(crate::commands::registry()
            .into_iter()
            .map(|item| format!("{}  —  {}", item.command, item.description))
            .collect::<Vec<_>>()
            .join("\n")),
        "status" => {
            let config = crate::config::load_or_default()?;
            Ok(format!(
                "Luma Core v{}\nWorkspace: {}\nProvider: {}\nModel: {}",
                env!("CARGO_PKG_VERSION"),
                workspace.display(),
                config.model.provider,
                config.model.name
            ))
        }
        "workspace" => Ok(format!("Active workspace: {}", workspace.display())),
        "workspace_dashboard" => {
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            let workspace_id = workspace.to_string_lossy().to_string();
            let git = crate::tools::git::GitChanges
                .execute(&json!({"path": workspace.display().to_string()}).to_string())
                .unwrap_or_else(|error| {
                    serde_json::json!({"error": error.to_string()}).to_string()
                });
            let git: serde_json::Value =
                serde_json::from_str(&git).unwrap_or_else(|_| json!({"raw": git}));
            let tasks = runtime
                .list_tasks(None, 50)?
                .into_iter()
                .filter(|task| {
                    task.workspace
                        .as_deref()
                        .is_none_or(|path| path == workspace_id)
                })
                .take(8)
                .collect::<Vec<_>>();
            let agents = runtime
                .list_agents()?
                .into_iter()
                .filter(|agent| {
                    agent.kind == crate::runtime::AgentKind::Teammates
                        && matches!(
                            agent.status,
                            crate::runtime::AgentStatus::Active
                                | crate::runtime::AgentStatus::Waiting
                                | crate::runtime::AgentStatus::Recovering
                        )
                })
                .collect::<Vec<_>>();
            Ok(serde_json::to_string_pretty(&json!({
                "workspace": workspace.display().to_string(),
                "git": git,
                "recent_tasks": tasks,
                "active_teammates": agents,
            }))?)
        }
        "context" => {
            let instruction_names = [
                "GALAXY.md",
                "AGENTS.md",
                "CLAUDE.md",
                ".github/copilot-instructions.md",
            ];
            let instructions = instruction_names
                .iter()
                .filter_map(|name| {
                    let path = workspace.join(name);
                    std::fs::read_to_string(&path).ok().map(|content| {
                        json!({
                            "path": name,
                            "characters": content.chars().count(),
                            "content": content,
                        })
                    })
                })
                .collect::<Vec<_>>();
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            let project_memory = runtime.list_memory(
                crate::runtime::MemoryScope::Project,
                &workspace.display().to_string(),
                None,
                100,
            )?;
            let user_memory =
                runtime.list_memory(crate::runtime::MemoryScope::User, "user", None, 100)?;
            Ok(serde_json::to_string_pretty(&json!({
                "workspace": workspace.display().to_string(),
                "instruction_files": instructions,
                "available_tools": crate::tools::default_registry().names(),
                "skills": crate::tools::skills::ListSkills.execute("{}").unwrap_or_else(|error| format!("Unavailable: {error}")),
                "saved_memory": { "project": project_memory, "user": user_memory },
                "scope_note": "This is an inventory of context sources available to Luma. It is not a byte-for-byte dump of the private model request; provider system prompts and hidden runtime instructions are not exposed here."
            }))?)
        }
        "version" => Ok(format!("Luma Core v{}", env!("CARGO_PKG_VERSION"))),
        "tools" => Ok(crate::tools::default_registry().names().join("\n")),
        "skills" => crate::tools::skills::ListSkills.execute("{}"),
        "plugins" => Ok(serde_json::to_string_pretty(
            &crate::plugins::PluginManager.list()?,
        )?),
        "mcp" => {
            let servers = crate::mcp::McpManager
                .list()?
                .into_iter()
                .map(|server| {
                    json!({
                        "id": server.id,
                        "name": server.name,
                        "transport": server.transport,
                        "url": server.url,
                        "command": server.command,
                        "args": server.args,
                        "enabled": server.enabled,
                    })
                })
                .collect::<Vec<_>>();
            Ok(serde_json::to_string_pretty(&servers)?)
        }
        "restore" | "history_show" => {
            let id = query
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("this command requires a saved conversation ID"))?;
            Ok(serde_json::to_string_pretty(&crate::chats::load(id)?)?)
        }
        "history_list" => Ok(serde_json::to_string_pretty(&crate::chats::list()?)?),
        "history_delete" => {
            let _ = query;
            anyhow::bail!(
                "history deletion must run through the active session command so it can protect the current conversation"
            )
        }
        "history_prune" => {
            let _ = query;
            anyhow::bail!(
                "history pruning must run through the active session command so it can reset the current conversation"
            )
        }
        "summary" => {
            let _ = query;
            anyhow::bail!(
                "summary updates must run through the active session so its in-memory state stays synchronized"
            )
        }
        "teammates" | "agents" => {
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            Ok(serde_json::to_string_pretty(&runtime.list_agents()?)?)
        }
        "tasks" => {
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            Ok(serde_json::to_string_pretty(
                &runtime.list_tasks(None, 100)?,
            )?)
        }
        "approvals" => {
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            Ok(serde_json::to_string_pretty(
                &runtime.list_pending_approvals()?,
            )?)
        }
        "schedules" => {
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            Ok(serde_json::to_string_pretty(
                &runtime.list_schedules(None)?,
            )?)
        }
        "memory" => {
            let runtime = crate::runtime::RuntimeStore::open_default()?;
            let workspace_id = workspace.display().to_string();
            let user = runtime.list_memory(crate::runtime::MemoryScope::User, "user", query, 50)?;
            let project = runtime.list_memory(
                crate::runtime::MemoryScope::Project,
                &workspace_id,
                query,
                50,
            )?;
            Ok(serde_json::to_string_pretty(
                &json!({"user": user, "project": project}),
            )?)
        }
        "monitor" => {
            crate::tools::observability::ExecutionMetrics::default().execute(query.unwrap_or("{}"))
        }
        "history" => {
            if let Some(query) = query.filter(|value| !value.trim().is_empty()) {
                Ok(serde_json::to_string_pretty(&crate::chats::search(query)?)?)
            } else {
                Ok(serde_json::to_string_pretty(&crate::chats::list()?)?)
            }
        }
        _ => anyhow::bail!("unsupported Core command: {id}"),
    }
}

// ============================================================
// Setup and introspection
// ============================================================

async fn serve<W>(message: ClientMessage, stdout: &mut W) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    match message {
        ClientMessage::GetCommands { request_id } => {
            write_event(
                stdout,
                ServerEvent::Commands {
                    request_id,
                    commands: crate::commands::registry(),
                },
            )
            .await?;
        }

        ClientMessage::RunCommand {
            request_id,
            id,
            query,
        } => {
            let content = execute_core_command(&id, query.as_deref())?;
            write_event(
                stdout,
                ServerEvent::CommandOutput {
                    request_id,
                    id,
                    content,
                },
            )
            .await?;
        }

        ClientMessage::GetSetupConfig { request_id } => match crate::config::load_or_default() {
            Ok(config) => {
                write_event(stdout, ServerEvent::SetupConfig { request_id, config }).await?;
            }

            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await?;
            }
        },

        ClientMessage::SaveSetupConfig { request_id, config } => {
            match crate::config::save(&config) {
                Ok(()) => {
                    write_event(stdout, ServerEvent::SetupSaved { request_id }).await?;
                }

                Err(error) => {
                    report_error(
                        stdout,
                        Some(request_id),
                        error.to_string(),
                        ErrorCategory::Transient,
                    )
                    .await?;
                }
            }
        }

        ClientMessage::GetProviders { request_id } => {
            let mut providers = supported_providers();
            if let Ok(config) = crate::config::load_or_default() {
                for saved in config.providers {
                    if !providers.iter().any(|provider| provider.id == saved.id) {
                        providers.push(saved);
                    }
                }
            }
            write_event(
                stdout,
                ServerEvent::Providers {
                    request_id,
                    providers,
                },
            )
            .await?;
        }

        ClientMessage::GetModels {
            request_id,
            provider,
            api_key,
            endpoint,
        } => {
            let request = ModelRequest {
                provider: provider.clone(),
                api_key,
                endpoint,
            };

            match provider_for(&provider).list_models(&request).await {
                Ok(models) => {
                    write_event(stdout, ServerEvent::Models { request_id, models }).await?;
                }

                Err(error) => {
                    report_error(
                        stdout,
                        Some(request_id),
                        error.to_string(),
                        ErrorCategory::Transient,
                    )
                    .await?;
                }
            }
        }

        ClientMessage::TestProvider {
            request_id,
            provider,
            api_key,
            endpoint,
            model,
        } => {
            let request = ModelRequest {
                provider: provider.clone(),
                api_key,
                endpoint,
            };

            match provider_for(&provider).test(&request, &model).await {
                Ok(()) => {
                    write_event(stdout, ServerEvent::ProviderTested { request_id }).await?;
                }

                Err(error) => {
                    report_error(
                        stdout,
                        Some(request_id),
                        error.to_string(),
                        ErrorCategory::Transient,
                    )
                    .await?;
                }
            }
        }

        ClientMessage::SetModel { .. } => {
            // Handled by DesktopServer because it owns the live model handle.
        }

        ClientMessage::StartDashboard { .. } => {
            // Handled by DesktopServer because it owns the live dashboard task.
        }

        ClientMessage::HistoryList { request_id } => match chats::list() {
            Ok(chats) => {
                write_event(stdout, ServerEvent::HistoryList { request_id, chats }).await?;
            }
            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await?;
            }
        },

        ClientMessage::HistoryShow { request_id, id } => match chats::load(&id) {
            Ok(chat) => {
                write_event(stdout, ServerEvent::HistoryChat { request_id, chat }).await?;
            }
            Err(error) => {
                report_error(
                    stdout,
                    Some(request_id),
                    error.to_string(),
                    ErrorCategory::Transient,
                )
                .await?;
            }
        },

        ClientMessage::HistoryDelete { request_id, .. } => {
            report_error(
                stdout,
                Some(request_id),
                "history deletion requires the active session dispatcher".into(),
                ErrorCategory::Fatal,
            )
            .await?;
        }

        ClientMessage::HistoryPrune { request_id } => {
            report_error(
                stdout,
                Some(request_id),
                "history pruning requires the active session dispatcher".into(),
                ErrorCategory::Fatal,
            )
            .await?;
        }

        ClientMessage::SummaryAdd { request_id, .. } => {
            report_error(
                stdout,
                Some(request_id),
                "summary updates require the active session dispatcher".into(),
                ErrorCategory::Fatal,
            )
            .await?;
        }

        other => {
            tracing::debug!(?other, "unhandled client message");
        }
    }

    Ok(())
}

// ============================================================
// Output
// ============================================================

async fn write_event<W>(writer: &mut W, event: ServerEvent) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    let line = encode(&event)?;

    writer.write_all(line.as_bytes()).await?;
    writer.flush().await?;

    Ok(())
}

async fn report_error<W>(
    writer: &mut W,
    request_id: Option<String>,
    message: String,
    category: ErrorCategory,
) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
{
    write_event(
        writer,
        ServerEvent::Error {
            request_id,
            message,
            category,
        },
    )
    .await
}

#[cfg(test)]
mod core_command_tests {
    use super::{execute_core_command, is_runtime_message};
    use crate::protocol::ClientMessage;

    #[test]
    fn task_rename_and_delete_are_dispatched_to_runtime() {
        let rename = ClientMessage::TaskRename {
            request_id: "rename-1".into(),
            id: "task-1".into(),
            title: "Renamed task".into(),
        };
        let delete = ClientMessage::TaskDelete {
            request_id: "delete-1".into(),
            id: "task-1".into(),
        };

        assert!(is_runtime_message(&rename));
        assert!(is_runtime_message(&delete));
    }

    #[test]
    fn core_commands_expose_version_help_and_git_views() {
        assert!(
            execute_core_command("version", None)
                .unwrap()
                .contains(env!("CARGO_PKG_VERSION"))
        );
        assert!(
            execute_core_command("help", None)
                .unwrap()
                .contains("/compact")
        );
        assert!(execute_core_command("git", Some("status")).is_ok());
        assert!(execute_core_command("git", Some("status_json")).is_ok());
        let git_status: serde_json::Value =
            serde_json::from_str(&execute_core_command("git_status", None).unwrap()).unwrap();
        assert!(git_status["branch"].is_string());
        assert!(git_status["files"].is_array());
        let context: serde_json::Value =
            serde_json::from_str(&execute_core_command("context", None).unwrap()).unwrap();
        assert!(context["instruction_files"].is_array());
        assert!(context["available_tools"].is_array());
        assert!(context["scope_note"].is_string());
        let dashboard: serde_json::Value =
            serde_json::from_str(&execute_core_command("workspace_dashboard", None).unwrap())
                .unwrap();
        assert!(dashboard["workspace"].is_string());
        assert!(dashboard["git"].is_object());
        assert!(dashboard["recent_tasks"].is_array());
        assert!(dashboard["active_teammates"].is_array());
    }

    #[test]
    fn workspace_commands_reject_paths_outside_the_active_workspace() {
        let error = execute_core_command("files", Some("../")).unwrap_err();
        assert!(error.to_string().contains("inside the active workspace"));
        assert!(execute_core_command("search", Some("  ")).is_err());
    }

    #[test]
    fn core_file_finder_returns_ranked_workspace_relative_results() {
        let output = execute_core_command("find_files", Some("desktop")).unwrap();
        let results: serde_json::Value = serde_json::from_str(&output).unwrap();
        let first = results.as_array().and_then(|items| items.first()).unwrap();
        assert!(first["path"].as_str().unwrap().starts_with("desktop/"));
        assert!(first["score"].as_i64().unwrap() > 0);
        assert!(execute_core_command("find_files", Some(" ")).is_err());
    }

    #[test]
    fn mutating_history_commands_require_the_session_dispatcher() {
        assert!(execute_core_command("history_delete", Some("../history.json")).is_err());
        assert!(execute_core_command("history_delete", Some(" ")).is_err());
        assert!(execute_core_command("history_prune", None).is_err());
        assert!(execute_core_command("history_prune", Some("yes")).is_err());
        assert!(
            execute_core_command("summary", Some("{}"))
                .unwrap_err()
                .to_string()
                .contains("active session")
        );
    }
}
