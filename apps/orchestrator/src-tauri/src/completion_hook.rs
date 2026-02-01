use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookEventKind {
    Completed,
    NeedInput,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct HookEvent {
    pub source: String,
    pub kind: HookEventKind,
    pub ts_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
}

pub type HookCallback = Arc<dyn Fn(HookEvent) + Send + Sync + 'static>;

pub trait CompletionHook: Send {
    fn start(&mut self, on_event: HookCallback);
    fn stop(&mut self);
}

struct JsonlTail {
    path: PathBuf,
    running: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl JsonlTail {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            running: Arc::new(AtomicBool::new(false)),
            handle: None,
        }
    }

    fn start<F>(&mut self, on_value: F)
    where
        F: Fn(Value) + Send + 'static,
    {
        if self.handle.is_some() {
            return;
        }
        let path = self.path.clone();
        let running = self.running.clone();
        running.store(true, Ordering::SeqCst);
        self.handle = Some(thread::spawn(move || {
            let mut offset: u64 = 0;
            while running.load(Ordering::SeqCst) {
                if let Ok(meta) = std::fs::metadata(&path) {
                    let len = meta.len();
                    if len < offset {
                        offset = 0;
                    }
                    if let Ok(mut file) = File::open(&path) {
                        let _ = file.seek(SeekFrom::Start(offset));
                        let mut reader = BufReader::new(file);
                        let mut line = String::new();
                        loop {
                            if !running.load(Ordering::SeqCst) {
                                break;
                            }
                            line.clear();
                            let read = reader.read_line(&mut line).unwrap_or(0);
                            if read == 0 {
                                break;
                            }
                            offset = reader.stream_position().unwrap_or(offset + read as u64);
                            let trimmed = line.trim_end();
                            if trimmed.is_empty() {
                                continue;
                            }
                            if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                                on_value(value);
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(200));
            }
        }));
    }

    fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            self.running.store(false, Ordering::SeqCst);
            let _ = handle.join();
        }
    }
}

pub struct CodexCompletionHook {
    tail: JsonlTail,
}

impl CodexCompletionHook {
    pub fn new(path: PathBuf) -> Self {
        Self {
            tail: JsonlTail::new(path),
        }
    }
}

impl CompletionHook for CodexCompletionHook {
    fn start(&mut self, on_event: HookCallback) {
        self.tail.start(move |value| {
            let (event, raw) = unwrap_event(value);
            if !matches_source(&raw, "codex") {
                return;
            }
            let kind = match codex_event_kind(&event) {
                Some(kind) => kind,
                None => return,
            };
            let source_session_id = read_any_string_from_values(
                &[&event, &raw],
                &["source_session_id", "sourceSessionId", "nagomi_session_id", "NAGOMI_SESSION_ID"],
            )
            .or_else(|| read_any_string(&event, &["thread-id", "thread_id", "threadId"]));
            let ts_ms = now_ms();
            on_event(HookEvent {
                source: "codex".to_string(),
                kind,
                ts_ms,
                source_session_id,
                raw: Some(raw),
            });
        });
    }

    fn stop(&mut self) {
        self.tail.stop();
    }
}

pub struct ClaudeCodeCompletionHook {
    tail: JsonlTail,
}

impl ClaudeCodeCompletionHook {
    pub fn new(path: PathBuf) -> Self {
        Self {
            tail: JsonlTail::new(path),
        }
    }
}

impl CompletionHook for ClaudeCodeCompletionHook {
    fn start(&mut self, on_event: HookCallback) {
        self.tail.start(move |value| {
            let (event, raw) = unwrap_event(value);
            if !matches_source(&raw, "claude") {
                return;
            }
            let kind = match event.get("hook_event_name").and_then(|v| v.as_str()) {
                Some("Stop") => HookEventKind::Completed,
                Some("PermissionRequest") | Some("Notification") => HookEventKind::NeedInput,
                _ => return,
            };
            let source_session_id = read_any_string_from_values(
                &[&event, &raw],
                &[
                    "source_session_id",
                    "sourceSessionId",
                    "nagomi_session_id",
                    "NAGOMI_SESSION_ID",
                    "session_id",
                    "sessionId",
                ],
            );
            let ts_ms = now_ms();
            on_event(HookEvent {
                source: "claude".to_string(),
                kind,
                ts_ms,
                source_session_id,
                raw: Some(raw),
            });
        });
    }

    fn stop(&mut self) {
        self.tail.stop();
    }
}

pub struct OpenCodeCompletionHook {
    tail: JsonlTail,
}

impl OpenCodeCompletionHook {
    pub fn new(path: PathBuf) -> Self {
        Self {
            tail: JsonlTail::new(path),
        }
    }
}

impl CompletionHook for OpenCodeCompletionHook {
    fn start(&mut self, on_event: HookCallback) {
        self.tail.start(move |value| {
            let (event, raw) = unwrap_event(value);
            if !matches_source(&raw, "opencode") {
                return;
            }
            let kind = match event.get("type").and_then(|v| v.as_str()) {
                Some("session.idle") => HookEventKind::Completed,
                Some("session.error") => HookEventKind::Error,
                Some("permission.updated") | Some("permission.replied") => HookEventKind::NeedInput,
                _ => return,
            };
            let source_session_id = read_any_string_from_values(
                &[&event, &raw],
                &[
                    "source_session_id",
                    "sourceSessionId",
                    "nagomi_session_id",
                    "NAGOMI_SESSION_ID",
                    "session_id",
                    "sessionId",
                ],
            );
            let ts_ms = now_ms();
            on_event(HookEvent {
                source: "opencode".to_string(),
                kind,
                ts_ms,
                source_session_id,
                raw: Some(raw),
            });
        });
    }

    fn stop(&mut self) {
        self.tail.stop();
    }
}

pub struct CompletionHookManager {
    active_tool: Option<String>,
    active_hook: Option<Box<dyn CompletionHook>>,
    on_event: HookCallback,
}

impl CompletionHookManager {
    pub fn new(on_event: HookCallback) -> Self {
        Self {
            active_tool: None,
            active_hook: None,
            on_event,
        }
    }

    pub fn set_tool(&mut self, tool: Option<&str>, base_dir: &Path) {
        let next_tool = tool.map(|value| value.to_string());
        if self.active_tool == next_tool {
            return;
        }
        if let Some(mut hook) = self.active_hook.take() {
            hook.stop();
        }
        self.active_tool = next_tool.clone();
        let Some(tool) = next_tool else { return };
        let hook: Box<dyn CompletionHook> = match tool.as_str() {
            "codex" => Box::new(CodexCompletionHook::new(tool_hook_path(base_dir, "codex"))),
            "claude" => Box::new(ClaudeCodeCompletionHook::new(tool_hook_path(base_dir, "claude"))),
            "opencode" => Box::new(OpenCodeCompletionHook::new(tool_hook_path(base_dir, "opencode"))),
            _ => return,
        };
        let mut hook = hook;
        hook.start(self.on_event.clone());
        self.active_hook = Some(hook);
    }

    pub fn stop(&mut self) {
        if let Some(mut hook) = self.active_hook.take() {
            hook.stop();
        }
        self.active_tool = None;
    }
}

pub fn hooks_base_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        return PathBuf::from(home).join(".nagomi").join("hooks");
    }
    PathBuf::from(".nagomi").join("hooks")
}

fn tool_hook_path(base_dir: &Path, tool: &str) -> PathBuf {
    base_dir.join(format!("{tool}.jsonl"))
}

fn unwrap_event(value: Value) -> (Value, Value) {
    if let Some(event) = value.get("event").cloned() {
        (event, value)
    } else {
        (value.clone(), value)
    }
}

fn matches_source(raw: &Value, expected: &str) -> bool {
    let source = raw.get("source").and_then(|value| value.as_str());
    match source {
        Some(found) => found == expected,
        None => true,
    }
}

fn read_any_string(event: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = event.get(*key).and_then(|v| v.as_str()) {
            return Some(value.to_string());
        }
    }
    None
}

fn read_any_string_from_values(values: &[&Value], keys: &[&str]) -> Option<String> {
    for value in values {
        if let Some(found) = read_any_string(value, keys) {
            return Some(found);
        }
    }
    None
}

fn codex_event_kind(event: &Value) -> Option<HookEventKind> {
    let type_name = event
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let status = event
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if type_name == "agent-turn-complete" || type_name == "turn.completed" || status.contains("complete") {
        return Some(HookEventKind::Completed);
    }
    if type_name.contains("error") || type_name.contains("fail") || status.contains("error") {
        return Some(HookEventKind::Error);
    }
    if type_name.contains("need-input")
        || type_name.contains("input")
        || type_name.contains("permission")
        || type_name.contains("request")
        || status.contains("waiting")
    {
        return Some(HookEventKind::NeedInput);
    }
    None
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::{codex_event_kind, HookEventKind};
    use serde_json::json;

    #[test]
    fn codex_event_kind_completed_by_type() {
        let event = json!({ "type": "agent-turn-complete" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::Completed));
        let event = json!({ "type": "turn.completed" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::Completed));
    }

    #[test]
    fn codex_event_kind_completed_by_status() {
        let event = json!({ "status": "complete" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::Completed));
    }

    #[test]
    fn codex_event_kind_error() {
        let event = json!({ "type": "agent-error" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::Error));
        let event = json!({ "type": "agent-failed" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::Error));
        let event = json!({ "status": "error" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::Error));
    }

    #[test]
    fn codex_event_kind_need_input() {
        let event = json!({ "type": "need-input" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::NeedInput));
        let event = json!({ "type": "input" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::NeedInput));
        let event = json!({ "type": "permission_request" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::NeedInput));
        let event = json!({ "type": "request" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::NeedInput));
        let event = json!({ "status": "waiting" });
        assert_eq!(codex_event_kind(&event), Some(HookEventKind::NeedInput));
    }

    #[test]
    fn codex_event_kind_none_when_unknown() {
        let event = json!({ "type": "progress" });
        assert_eq!(codex_event_kind(&event), None);
    }
}
