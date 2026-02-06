use anyhow::Result;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
#[cfg(windows)]
use base64::Engine;
#[cfg(windows)]
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
#[cfg(windows)]
use std::ffi::OsStr;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
use std::process::{Command, Stdio};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Runtime, Size,
    WebviewUrl, WebviewWindowBuilder,
};
use nagomi_protocol::Message;
use crate::completion_hook::{CompletionHookManager, HookEvent, HookEventKind, hooks_base_dir};
#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_EXPAND_SZ, REG_SZ};
#[cfg(windows)]
use winreg::RegKey;
#[cfg(windows)]
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CallDevToolsProtocolMethodCompletedHandler;
#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
#[cfg(windows)]
use windows_sys::Win32::Foundation::RECT;
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetDC,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    SRCCOPY,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect;

mod ipc_session;
mod judge;
mod completion_hook;
mod notify;
mod worker;

const WINDOW_CHAT: &str = "chat";
const WINDOW_RUN: &str = "run";
const WINDOW_SETTINGS: &str = "settings";
const WINDOW_WATCHER: &str = "watcher";

#[cfg(windows)]
thread_local! {
    static WEBVIEW2_CAPTURE_HANDLER: RefCell<Option<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>> =
        RefCell::new(None);
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    notifications_enabled: bool,
    audio_enabled: bool,
    volume: f32,
    silence_timeout_ms: u64,
    llm_enabled: bool,
    llm_tool: String,
    character_id: String,
    log_retention_lines: u32,
    terminal_watcher_enabled: bool,
    #[serde(default)]
    terminal_font_family: String,
    #[serde(default)]
    terminal_font_size: u16,
    #[serde(default)]
    terminal_theme: String,
    #[serde(default)]
    terminal_scrollback_lines: u32,
    #[serde(default)]
    terminal_copy_on_select: bool,
}

#[derive(Debug, Clone, Serialize)]
struct TerminalOutputPayload {
    session_id: String,
    chunk: String,
    stream: String,
}

#[derive(Debug, Clone, Serialize)]
struct TerminalExitPayload {
    session_id: String,
    exit_code: i32,
}

#[derive(Debug, Clone, Serialize)]
struct TerminalErrorPayload {
    session_id: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
struct HookStatePayload {
    source: String,
    kind: String,
    source_session_id: Option<String>,
    judge_state: Option<String>,
    summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct TerminalFocusTransitionPayload {
    token: u64,
    active: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AggregateStatePayload {
    state: String,
}

#[derive(Debug, Clone, Serialize)]
struct CodexHookSetupResult {
    status: String,
    message: String,
    config_path: String,
    script_path: String,
    hook_path: String,
}

#[derive(Debug, Clone, Serialize)]
struct ToolJudgeResult {
    state: String,
    summary: String,
}

struct WorkerState {
    process: Mutex<worker::WorkerProcess>,
}

struct TerminalWorkerBus {
    tx: std::sync::mpsc::Sender<Message>,
}

struct TerminalWorkerState {
    processes: Mutex<HashMap<String, worker::WorkerProcess>>,
}

struct SessionState {
    current: Mutex<Option<String>>,
}

struct TerminalAggregateState {
    per_session: Mutex<HashMap<String, String>>,
    last_state: Mutex<String>,
}

impl Default for TerminalAggregateState {
    fn default() -> Self {
        Self {
            per_session: Mutex::new(HashMap::new()),
            last_state: Mutex::new("idle".to_string()),
        }
    }
}

struct SelectionState {
    current: Mutex<Option<String>>,
}

struct TerminalSessionState {
    active: Mutex<HashSet<String>>,
    labels: Mutex<HashMap<String, String>>,
}

struct TerminalSmokeWaiter {
    token: String,
    sender: std::sync::mpsc::Sender<Result<(), String>>,
}

struct TerminalSmokeState {
    waiters: Mutex<HashMap<String, TerminalSmokeWaiter>>,
}

struct CompletionHookState {
    manager: Mutex<CompletionHookManager>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Default)]
struct WindowAnimationState {
    next: AtomicU64,
    active: Mutex<HashMap<String, u64>>,
}

#[derive(Default)]
struct TerminalWindowLayoutState {
    layout: Mutex<HashMap<String, WindowRect>>,
    order: Mutex<Vec<String>>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            audio_enabled: true,
            volume: 0.8,
            silence_timeout_ms: 30000,
            llm_enabled: false,
            llm_tool: "codex".to_string(),
            character_id: "default".to_string(),
            log_retention_lines: 20_000,
            terminal_watcher_enabled: false,
            terminal_font_family: "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, Monaco, 'Liberation Mono', 'DejaVu Sans Mono', monospace".to_string(),
            terminal_font_size: 18,
            terminal_theme: "dark".to_string(),
            terminal_scrollback_lines: 5000,
            terminal_copy_on_select: true,
        }
    }
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    // 險ｭ螳壹ヵ繧｡繧､繝ｫ縺ｯ app_config_dir 縺ｫ鄂ｮ縺・/ Store settings under app_config_dir.
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

fn worker_log_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("worker_smoke.log")
}

fn terminal_debug_snapshot_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("terminal_debug_snapshots.jsonl")
}

fn terminal_debug_screenshot_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("terminal_debug_screenshots")
}

fn terminal_debug_screenshot_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    terminal_debug_screenshot_dir(app).join(format!("terminal-{}.png", now_ms))
}

fn codex_config_path() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".codex").join("config.toml"))
}

fn codex_notify_script_body() -> String {
    [
        "const fs = require(\"node:fs\");",
        "const os = require(\"node:os\");",
        "const path = require(\"node:path\");",
        "",
        "function hooksDir() {",
        "  const base = process.env.NAGOMI_HOOKS_DIR;",
        "  if (base) return base;",
        "  return path.join(os.homedir(), \".nagomi\", \"hooks\");",
        "}",
        "",
        "function main() {",
        "  const raw = process.argv[2];",
        "  if (!raw) return;",
        "  let event;",
        "  try {",
        "    event = JSON.parse(raw);",
        "  } catch {",
        "    event = { raw };",
        "  }",
        "  const payload = {",
        "    source: \"codex\",",
        "    event,",
        "    ts_ms: Date.now(),",
        "  };",
        "  const base = hooksDir();",
        "  fs.mkdirSync(base, { recursive: true });",
        "  const filePath = path.join(base, \"codex.jsonl\");",
        "  fs.appendFileSync(filePath, JSON.stringify(payload) + \"\\n\", \"utf8\");",
        "}",
        "",
        "main();",
        "",
    ]
    .join("\n")
}

fn toml_escape_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").replace('"', "\\\"")
}

fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &bytes[i + 1..i + 3];
                let hi = (hex[0] as char).to_digit(16);
                let lo = (hex[1] as char).to_digit(16);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push(((hi << 4) + lo) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_query_pairs(query: &str) -> HashMap<String, String> {
    let mut pairs = HashMap::new();
    for part in query.split('&') {
        if part.is_empty() {
            continue;
        }
        let mut iter = part.splitn(2, '=');
        let key = iter.next().unwrap_or_default();
        let value = iter.next().unwrap_or_default();
        if key.is_empty() {
            continue;
        }
        pairs.insert(url_decode(key), url_decode(value));
    }
    pairs
}

fn test_endpoints_enabled() -> bool {
    matches!(std::env::var("NAGOMI_ENABLE_TEST_ENDPOINTS").ok().as_deref(), Some("1"))
}

#[cfg(windows)]
fn expand_environment_strings(value: &str) -> String {
    let wide: Vec<u16> = OsStr::new(value).encode_wide().chain(Some(0)).collect();
    let mut buffer: Vec<u16> = vec![0; 32768];
    unsafe {
        let mut len = ExpandEnvironmentStringsW(
            wide.as_ptr(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
        );
        if len == 0 {
            return value.to_string();
        }
        if len as usize > buffer.len() {
            buffer.resize(len as usize, 0);
            len = ExpandEnvironmentStringsW(
                wide.as_ptr(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
            );
            if len == 0 {
                return value.to_string();
            }
        }
        let slice_len = len.saturating_sub(1) as usize;
        String::from_utf16_lossy(&buffer[..slice_len])
    }
}

#[cfg(windows)]
fn decode_reg_value(value: &winreg::RegValue) -> Option<String> {
    if value.vtype != REG_SZ && value.vtype != REG_EXPAND_SZ {
        return None;
    }
    let mut units: Vec<u16> = Vec::with_capacity(value.bytes.len() / 2);
    for chunk in value.bytes.chunks(2) {
        if chunk.len() == 2 {
            units.push(u16::from_le_bytes([chunk[0], chunk[1]]));
        }
    }
    let len = units.iter().position(|&unit| unit == 0).unwrap_or(units.len());
    let mut text = String::from_utf16_lossy(&units[..len]);
    if value.vtype == REG_EXPAND_SZ {
        text = expand_environment_strings(&text);
    }
    Some(text)
}

#[cfg(windows)]
fn read_registry_env(root: RegKey, path: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    let Ok(key) = root.open_subkey_with_flags(path, KEY_READ) else {
        return env;
    };
    for item in key.enum_values() {
        let Ok((name, value)) = item else {
            continue;
        };
        let Some(text) = decode_reg_value(&value) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        env.insert(name, text);
    }
    env
}

#[cfg(windows)]
fn normalize_env_key(key: &str) -> String {
    key.to_ascii_uppercase()
}

#[cfg(windows)]
struct EnvCollector {
    map: HashMap<String, (String, String)>,
}

#[cfg(windows)]
impl EnvCollector {
    fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    fn set_value(&mut self, key: &str, value: &str) {
        let normalized = normalize_env_key(key);
        if let Some((existing_key, existing_value)) = self.map.get_mut(&normalized) {
            *existing_value = value.to_string();
            if existing_key.is_empty() {
                *existing_key = key.to_string();
            }
        } else {
            self.map
                .insert(normalized, (key.to_string(), value.to_string()));
        }
    }

    fn insert_if_missing(&mut self, key: &str, value: &str) {
        let normalized = normalize_env_key(key);
        if !self.map.contains_key(&normalized) {
            self.map
                .insert(normalized, (key.to_string(), value.to_string()));
        }
    }

    fn get(&self, key: &str) -> Option<&String> {
        let normalized = normalize_env_key(key);
        self.map.get(&normalized).map(|(_, value)| value)
    }

    fn into_map(self) -> HashMap<String, String> {
        self.map
            .into_iter()
            .map(|(_, (key, value))| (key, value))
            .collect()
    }
}

#[cfg(windows)]
fn get_case_insensitive(map: &HashMap<String, String>, key: &str) -> Option<String> {
    map.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.clone())
}

#[cfg(windows)]
fn normalize_path_entry(entry: &str) -> String {
    entry
        .trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(windows)]
fn merge_paths(base: &str, extra: &str) -> String {
    let mut merged: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for part in base.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalize_path_entry(trimmed);
        if seen.insert(key) {
            merged.push(trimmed.to_string());
        }
    }
    for part in extra.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = normalize_path_entry(trimmed);
        if seen.insert(key) {
            merged.push(trimmed.to_string());
        }
    }
    merged.join(";")
}

#[cfg(windows)]
fn build_windows_terminal_env(session_id: &str) -> HashMap<String, String> {
    let mut collector = EnvCollector::new();
    for (key, value) in std::env::vars() {
        collector.set_value(&key, &value);
    }

    let system_env = read_registry_env(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    );
    let user_env = read_registry_env(RegKey::predef(HKEY_CURRENT_USER), "Environment");

    for (key, value) in &system_env {
        collector.insert_if_missing(key, value);
    }
    for (key, value) in &user_env {
        if key.eq_ignore_ascii_case("PATH") {
            continue;
        }
        collector.insert_if_missing(key, value);
    }

    let system_path = get_case_insensitive(&system_env, "PATH");
    let user_path = get_case_insensitive(&user_env, "PATH");
    let registry_path = match (system_path, user_path) {
        (Some(system), Some(user)) if !user.is_empty() => Some(format!("{system};{user}")),
        (Some(system), _) => Some(system),
        (_, Some(user)) => Some(user),
        _ => None,
    };

    if let Some(registry_path) = registry_path {
        let current_path = collector.get("PATH").cloned().unwrap_or_default();
        let merged_path = merge_paths(&current_path, &registry_path);
        if !merged_path.is_empty() {
            collector.set_value("Path", &merged_path);
        }
    }

    collector.set_value("NAGOMI_SESSION_ID", session_id);
    collector.into_map()
}

#[cfg(not(windows))]
fn build_windows_terminal_env(_session_id: &str) -> HashMap<String, String> {
    HashMap::new()
}

fn has_header_terminator(buffer: &[u8]) -> bool {
    buffer
        .windows(4)
        .any(|slice| slice == b"\r\n\r\n")
        || buffer.windows(2).any(|slice| slice == b"\n\n")
}

fn command_exists(command: &str) -> bool {
    let path_var = match std::env::var_os("PATH") {
        Some(value) => value,
        None => return false,
    };
    let mut extensions: Vec<String> = Vec::new();
    if cfg!(windows) {
        if let Some(ext_var) = std::env::var_os("PATHEXT") {
            for ext in ext_var.to_string_lossy().split(';') {
                let trimmed = ext.trim();
                if !trimmed.is_empty() {
                    extensions.push(trimmed.to_string());
                }
            }
        }
        if extensions.is_empty() {
            extensions.push(".exe".to_string());
            extensions.push(".cmd".to_string());
            extensions.push(".bat".to_string());
        }
        extensions.push(String::new());
    } else {
        extensions.push(String::new());
    }
    for dir in std::env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate = if ext.is_empty() {
                dir.join(command)
            } else {
                dir.join(format!("{command}{ext}"))
            };
            if candidate.exists() {
                return true;
            }
        }
    }
    false
}

fn ensure_codex_hook_files(base_dir: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    fs::create_dir_all(base_dir).map_err(|err| err.to_string())?;
    let hook_path = base_dir.join("codex.jsonl");
    if !hook_path.exists() {
        fs::write(&hook_path, "").map_err(|err| err.to_string())?;
    }
    let script_path = base_dir.join("nagomi_codex_notify.js");
    if !script_path.exists() {
        let body = codex_notify_script_body();
        fs::write(&script_path, body).map_err(|err| err.to_string())?;
    }
    let legacy_py = base_dir.join("nagomi_codex_notify.py");
    Ok((script_path, hook_path, legacy_py))
}

fn send_terminal_input_for_session<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    text: &str,
) -> Result<(), String> {
    let workers = app.state::<TerminalWorkerState>();
    let mut guard = workers
        .processes
        .lock()
        .map_err(|_| "terminal worker lock".to_string())?;
    let Some(process) = guard.get_mut(session_id) else {
        return Err("terminal session not started".to_string());
    };
    process
        .send_input(nagomi_protocol::SendInput {
            session_id: session_id.to_string(),
            text: text.to_string(),
        })
        .map_err(|err| err.to_string())
}

fn ensure_codex_config(script_path: &Path, legacy_py: &Path) -> Result<(String, String), String> {
    let config_path = codex_config_path().ok_or_else(|| "codex config path missing".to_string())?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let script_marker = script_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("nagomi_codex_notify.js");
    let legacy_marker = legacy_py
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("nagomi_codex_notify.py");
    let script_toml = toml_escape_path(script_path);
    let legacy_toml = toml_escape_path(legacy_py);
    let mut current = String::new();
    if config_path.exists() {
        let mut file = fs::File::open(&config_path).map_err(|err| err.to_string())?;
        file.read_to_string(&mut current).map_err(|err| err.to_string())?;
    }
    let mut has_notify = false;
    let mut has_legacy = false;
    let mut has_script = false;
    let mut has_command = false;
    for line in current.lines() {
        if line.trim_start().starts_with("notify") {
            has_notify = true;
            if line.contains("nagomi-codex-notify") {
                has_command = true;
            }
            if line.contains(legacy_marker) || line.contains(&legacy_toml) {
                has_legacy = true;
            }
            if line.contains(script_marker) || line.contains(&script_toml) {
                has_script = true;
            }
        }
    }
    if has_command || has_script {
        return Ok((
            "already_installed".to_string(),
            "codex notify already configured".to_string(),
        ));
    }
    let notify_line = if command_exists("nagomi-codex-notify") {
        "notify = \"nagomi-codex-notify\"".to_string()
    } else {
        format!("notify = \"node {}\"", script_toml)
    };
    if has_notify && !has_legacy {
        return Ok((
            "skipped_existing_notify".to_string(),
            "notify already present; skipped updating config".to_string(),
        ));
    }
    let mut next_lines: Vec<String> = Vec::new();
    if has_legacy || has_script {
        for line in current.lines() {
            if line.trim_start().starts_with("notify") {
                next_lines.push(notify_line.clone());
            } else {
                next_lines.push(line.to_string());
            }
        }
        let next = next_lines.join("\n");
        fs::write(&config_path, format!("{next}\n")).map_err(|err| err.to_string())?;
        return Ok((
            "migrated_py_to_js".to_string(),
            "codex notify updated".to_string(),
        ));
    }
    let mut next = current;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str("# added by nagomi\n");
    next.push_str(&format!("{notify_line}\n"));
    fs::write(&config_path, next).map_err(|err| err.to_string())?;
    Ok(("installed".to_string(), "codex notify configured".to_string()))
}

fn start_health_server<R: Runtime>(app: AppHandle<R>) {
    let port = std::env::var("NAGOMI_ORCH_HEALTH_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(17707);
    thread::spawn(move || {
        let addr = format!("127.0.0.1:{port}");
        let listener = match TcpListener::bind(&addr) {
            Ok(listener) => listener,
            Err(err) => {
                let _ = log_worker_event(&app, &format!("health bind failed: {err}"));
                return;
            }
        };
        for stream in listener.incoming() {
            let stream = match stream {
                Ok(stream) => stream,
                Err(_) => continue,
            };
            handle_health_connection(stream, &app);
        }
    });
}

fn should_start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--start-hidden")
}

fn should_exit_on_last_terminal() -> bool {
    std::env::args().any(|arg| arg == "--exit-on-last-terminal")
}

#[derive(Clone, Copy)]
struct OrchestratorRuntimeFlags {
    exit_on_last_terminal: bool,
}

fn generate_terminal_session_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("terminal-{nonce}-{seq}")
}

fn handle_health_connection<R: Runtime>(mut stream: TcpStream, app: &AppHandle<R>) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let started_at = Instant::now();
    let mut buffer: Vec<u8> = Vec::with_capacity(512);
    let mut temp = [0u8; 256];
    loop {
        match stream.read(&mut temp) {
            Ok(0) => break,
            Ok(size) => {
                buffer.extend_from_slice(&temp[..size]);
                if has_header_terminator(&buffer) || buffer.len() >= 8192 {
                    break;
                }
            }
            Err(err) if matches!(err.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                if started_at.elapsed() > Duration::from_secs(2) {
                    break;
                }
                continue;
            }
            Err(err) => {
                let _ = log_worker_event(app, &format!("health read failed: {err}"));
                return;
            }
        }
        if started_at.elapsed() > Duration::from_secs(2) {
            break;
        }
    }
    let request = String::from_utf8_lossy(&buffer);
    let first_line = request.lines().next().unwrap_or_default();
    if first_line.starts_with("GET /health ") {
        let body = format!(r#"{{"status":"ok","pid":{}}}"#, std::process::id());
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    if let Some(path) = first_line.split_whitespace().nth(1) {
        if path.starts_with("/open-terminal") {
            let requested_session_id = path
                .splitn(2, '?')
                .nth(1)
                .and_then(|query| {
                    query
                        .split('&')
                        .find(|part| part.starts_with("session_id="))
                })
                .and_then(|part| part.splitn(2, '=').nth(1))
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());

            let mut session_id = requested_session_id.unwrap_or_else(generate_terminal_session_id);
            if let Some(state) = app.try_state::<TerminalSessionState>() {
                if let Ok(guard) = state.labels.lock() {
                    if guard.contains_key(&session_id) {
                        session_id = generate_terminal_session_id();
                    }
                }
            }

            let _ = open_terminal_window_inner(app.clone(), session_id.clone());
            let body = format!(r#"{{"status":"ok","session_id":"{}"}}"#, session_id);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            return;
        }
        if path.starts_with("/terminal-send") {
            // Test-only endpoint guarded by env flag. / テスト用エンドポイント（環境変数で有効化）
            if !test_endpoints_enabled() {
                let body = r#"{"status":"forbidden"}"#;
                let response = format!(
                    "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                return;
            }
            let query = path.splitn(2, '?').nth(1).unwrap_or("");
            let pairs = parse_query_pairs(query);
            let session_id = pairs.get("session_id").cloned().unwrap_or_default();
            let text = pairs.get("text").cloned().unwrap_or_default();
            if session_id.is_empty() || text.is_empty() {
                let body = r#"{"status":"bad_request"}"#;
                let response = format!(
                    "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                return;
            }
            let _ = log_worker_event(
                app,
                &format!(
                    "terminal-send requested: session={session_id} size={}",
                    text.len()
                ),
            );
            match send_terminal_input_for_session(app, &session_id, &text) {
                Ok(()) => {
                    let body = r#"{"status":"ok"}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                }
                Err(err) => {
                    let (status, body) = if err.contains("terminal session not started") {
                        (404, r#"{"status":"not_found"}"#)
                    } else {
                        let _ = log_worker_event(
                            app,
                            &format!("terminal-send failed: session={session_id} error={err}"),
                        );
                        (500, r#"{"status":"error"}"#)
                    };
                    let response = format!(
                        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        status,
                        if status == 404 { "Not Found" } else { "Internal Server Error" },
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                }
            }
            return;
        }
        let _ = log_worker_event(app, &format!("health not_found path={path}"));
    }

    let body = r#"{"status":"not_found"}"#;
    let response = format!(
        "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn read_settings(path: &Path) -> Result<Settings> {
    if !path.exists() {
        return Ok(Settings::default());
    }
    let raw = fs::read_to_string(path)?;
    let settings = serde_json::from_str(&raw)?;
    Ok(settings)
}

fn write_settings(path: &Path, settings: &Settings) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(settings)?;
    let mut file = fs::File::create(path)?;
    file.write_all(raw.as_bytes())?;
    Ok(())
}

#[tauri::command]
fn load_settings<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
) -> Result<Settings, String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let path = settings_path(&app);
    read_settings(&path).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_settings<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    settings: Settings,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let path = settings_path(&app);
    let hook_tool = settings.llm_tool.clone();
    write_settings(&path, &settings).map_err(|err| err.to_string())?;
    apply_completion_hook_tool(&app, Some(&hook_tool));
    let _ = app.emit("settings-updated", settings.clone());
    sync_watcher_window(&app, &settings);
    Ok(())
}

#[tauri::command]
fn report_terminal_observation<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
    state: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    if session_id.trim().is_empty() {
        return Ok(());
    }
    let normalized = normalize_observed_state(&state);
    let aggregate_state = {
        let aggregate = app.state::<TerminalAggregateState>();
        let mut guard = aggregate
            .per_session
            .lock()
            .map_err(|_| "aggregate state lock failed".to_string())?;
        guard.insert(session_id, normalized);
        aggregate_observed_state(&guard)
    };
    let should_emit = {
        let aggregate = app.state::<TerminalAggregateState>();
        let mut last_guard = aggregate
            .last_state
            .lock()
            .map_err(|_| "aggregate state lock failed".to_string())?;
        if *last_guard == aggregate_state {
            false
        } else {
            *last_guard = aggregate_state.clone();
            true
        }
    };
    if should_emit {
        emit_terminal_aggregate_state(&app, &aggregate_state);
    }
    Ok(())
}

#[tauri::command]
fn ensure_codex_hook<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
) -> Result<CodexHookSetupResult, String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let base_dir = hooks_base_dir();
    let (script_path, hook_path, legacy_py) = ensure_codex_hook_files(&base_dir)?;
    let (status, message) = ensure_codex_config(&script_path, &legacy_py)?;
    Ok(CodexHookSetupResult {
        status,
        message,
        config_path: codex_config_path()
            .unwrap_or_else(|| PathBuf::from("."))
            .to_string_lossy()
            .to_string(),
        script_path: script_path.to_string_lossy().to_string(),
        hook_path: hook_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn tool_judge<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    tool: String,
    tail: String,
) -> Result<ToolJudgeResult, String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    run_tool_judge(&tool, &tail).map_err(|err| err.to_string())
}

fn apply_completion_hook_tool<R: Runtime>(app: &AppHandle<R>, tool: Option<&str>) {
    let base_dir = hooks_base_dir();
    let _ = fs::create_dir_all(&base_dir);
    let state = app.state::<CompletionHookState>();
    let mut guard = match state.manager.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    guard.set_tool(tool, &base_dir);
}

fn handle_hook_event<R: Runtime>(app: &AppHandle<R>, event: HookEvent) {
    emit_hook_state(app, &event, None, None);
}

fn emit_hook_state<R: Runtime>(
    app: &AppHandle<R>,
    event: &HookEvent,
    state: Option<judge::JudgeState>,
    summary: Option<&str>,
) {
    let payload = HookStatePayload {
        source: event.source.clone(),
        kind: hook_kind_to_string(event.kind),
        source_session_id: event.source_session_id.clone(),
        judge_state: state.map(judge_state_to_string),
        summary: summary.map(|value| value.to_string()),
    };
    let _ = app.emit("completion-hook-state", payload);
}

fn run_tool_judge(tool: &str, tail: &str) -> Result<ToolJudgeResult> {
    let tool_key = tool.trim().to_ascii_lowercase();
    let tool_path = resolve_tool_command(&tool_key);
    let env_args = std::env::var("NAGOMI_TOOL_ARGS").ok().unwrap_or_default();
    let timeout_ms = std::env::var("NAGOMI_TOOL_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(30000);
    let timeout = Duration::from_millis(timeout_ms);

    if env_args.trim().is_empty() && tool_key == "codex" {
        return run_codex_judge(&tool_path, tail, timeout);
    }

    if env_args.trim().is_empty() {
        return Ok(fallback_tool_judge(tail));
    }

    let args = split_tool_args(&env_args);
    let prompt = build_tool_prompt(tail);
    let output = match run_tool_command_stdout(&tool_path, &args, &prompt, timeout) {
        Ok(output) => output,
        Err(_) => return Ok(fallback_tool_judge(tail)),
    };
    if let Some(result) = parse_tool_judge_output(&output) {
        return Ok(result);
    }
    Ok(fallback_tool_judge(tail))
}

fn resolve_tool_command(tool_key: &str) -> String {
    let direct = std::env::var("NAGOMI_TOOL_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty());
    if let Some(value) = direct {
        return value;
    }
    let cli = std::env::var("NAGOMI_TOOL_CLI")
        .ok()
        .filter(|value| !value.trim().is_empty());
    cli.unwrap_or_else(|| tool_key.to_string())
}

fn split_tool_args(raw: &str) -> Vec<String> {
    raw.split_whitespace()
        .filter(|part| !part.is_empty())
        .map(|part| part.to_string())
        .collect()
}

fn build_tool_prompt(tail: &str) -> String {
    let header = "You are a terminal output judge.\n\
Return JSON only, matching this schema:\n\
{\"state\":\"success|failure|need_input\",\"summary\":\"string\"}\n\
Rules:\n\
- success: command finished successfully.\n\
- failure: error or failure occurred.\n\
- need_input: process is waiting for user input or is ambiguous.\n\
Keep summary short (1-2 lines).\n\
---\n";
    let mut prompt = String::new();
    prompt.push_str(header);
    prompt.push_str("Terminal output (tail):\n");
    prompt.push_str(tail);
    prompt.push('\n');
    prompt
}

fn run_tool_command_stdout(
    tool_path: &str,
    args: &[String],
    prompt: &str,
    timeout: Duration,
) -> Result<String> {
    let mut command = Command::new(tool_path);
    command
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let status = wait_with_timeout(&mut child, timeout)?;
    let mut stdout = String::new();
    if let Some(mut reader) = child.stdout.take() {
        let _ = reader.read_to_string(&mut stdout);
    }
    let mut stderr = String::new();
    if let Some(mut reader) = child.stderr.take() {
        let _ = reader.read_to_string(&mut stderr);
    }
    if !status.success() {
        return Err(anyhow::anyhow!("tool failed: {stderr}"));
    }
    Ok(stdout)
}

fn run_codex_judge(tool_path: &str, tail: &str, timeout: Duration) -> Result<ToolJudgeResult> {
    let schema = r#"{"type":"object","properties":{"state":{"type":"string","enum":["success","failure","need_input"]},"summary":{"type":"string"}},"required":["state","summary"],"additionalProperties":false}"#;
    let schema_path = create_temp_file("nagomi-judge-schema", "json", schema)?;
    let output_path = create_temp_path("nagomi-judge-output", "json");
    let mut args = Vec::new();
    args.push("exec".to_string());
    args.push("--output-schema".to_string());
    args.push(schema_path.to_string_lossy().to_string());
    args.push("--output-last-message".to_string());
    args.push(output_path.to_string_lossy().to_string());
    args.push("--color".to_string());
    args.push("never".to_string());
    args.push("--sandbox".to_string());
    args.push("read-only".to_string());
    args.push("--skip-git-repo-check".to_string());

    let prompt = build_tool_prompt(tail);
    let mut command = Command::new(tool_path);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let status = wait_with_timeout(&mut child, timeout)?;
    let mut stderr = String::new();
    if let Some(mut reader) = child.stderr.take() {
        let _ = reader.read_to_string(&mut stderr);
    }
    let raw = fs::read_to_string(&output_path).unwrap_or_default();
    let _ = fs::remove_file(&schema_path);
    let _ = fs::remove_file(&output_path);
    if !status.success() {
        return Ok(fallback_tool_judge(tail));
    }
    if let Some(result) = parse_tool_judge_output(&raw) {
        return Ok(result);
    }
    let _ = stderr;
    Ok(fallback_tool_judge(tail))
}

fn wait_with_timeout(child: &mut std::process::Child, timeout: Duration) -> Result<std::process::ExitStatus> {
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            return Err(anyhow::anyhow!("tool timeout"));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn create_temp_path(prefix: &str, ext: &str) -> PathBuf {
    static TOOL_SEQ: AtomicU64 = AtomicU64::new(0);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis();
    let seq = TOOL_SEQ.fetch_add(1, Ordering::Relaxed);
    let filename = format!("{prefix}-{nonce}-{seq}.{ext}");
    std::env::temp_dir().join(filename)
}

fn create_temp_file(prefix: &str, ext: &str, contents: &str) -> Result<PathBuf> {
    let path = create_temp_path(prefix, ext);
    fs::write(&path, contents)?;
    Ok(path)
}

fn parse_tool_judge_output(raw: &str) -> Option<ToolJudgeResult> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = trimmed
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(trimmed);
    let parsed: serde_json::Value = serde_json::from_str(candidate).ok()?;
    let state_value = parsed.get("state")?.as_str()?;
    let summary_value = parsed.get("summary").and_then(|val| val.as_str()).unwrap_or("");
    let state = normalize_judge_state(state_value)?;
    Some(ToolJudgeResult {
        state,
        summary: summary_value.to_string(),
    })
}

fn normalize_judge_state(raw: &str) -> Option<String> {
    let value = raw.trim().to_ascii_lowercase();
    match value.as_str() {
        "success" => Some("success".to_string()),
        "failure" | "fail" | "error" => Some("failure".to_string()),
        "need_input" | "need-input" | "waiting_input" | "waiting-input" => {
            Some("need_input".to_string())
        }
        _ => None,
    }
}

fn fallback_tool_judge(tail: &str) -> ToolJudgeResult {
    let lines: Vec<String> = tail.lines().map(|line| line.to_string()).collect();
    let config = judge::JudgeConfig::default();
    let input = judge::JudgeInput {
        exit_code: None,
        tail_lines: &lines,
        last_output_at: None,
        now: SystemTime::now(),
    };
    let state = judge::evaluate(&config, &input).unwrap_or(judge::JudgeState::NeedInput);
    let summary = judge::summarize_tail(&lines, 2).join("\n");
    ToolJudgeResult {
        state: judge_state_to_string(state),
        summary,
    }
}

#[allow(dead_code)]
fn judge_hook_event(event: &HookEvent) -> (judge::JudgeState, String) {
    let config = judge::JudgeConfig::default();
    let tail_lines = extract_hook_tail_lines(event);
    let now = SystemTime::now();
    let exit_code = match event.kind {
        HookEventKind::Error => Some(1),
        HookEventKind::Completed => None,
        HookEventKind::NeedInput => None,
    };
    let input = judge::JudgeInput {
        exit_code,
        tail_lines: &tail_lines,
        last_output_at: None,
        now,
    };
    let fallback = match event.kind {
        HookEventKind::Error => judge::JudgeState::Failure,
        _ => judge::JudgeState::Success,
    };
    let state = judge::evaluate(&config, &input).unwrap_or(fallback);
    let summary_lines = judge::summarize_tail(&tail_lines, 2);
    let summary = summary_lines.join("\n");
    (state, summary)
}

#[allow(dead_code)]
fn extract_hook_tail_lines(event: &HookEvent) -> Vec<String> {
    let raw = match event.raw.as_ref() {
        Some(raw) => raw,
        None => return Vec::new(),
    };
    let text = extract_text_from_value(raw)
        .or_else(|| raw.get("event").and_then(extract_text_from_value))
        .unwrap_or_default();
    if text.is_empty() {
        return Vec::new();
    }
    text.lines().map(|line| line.to_string()).collect()
}

#[allow(dead_code)]
fn extract_text_from_value(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let obj = value.as_object()?;
    let keys = [
        "last-assistant-message",
        "last_assistant_message",
        "message",
        "summary",
        "notification",
    ];
    for key in keys.iter() {
        if let Some(text) = obj.get(*key).and_then(|val| val.as_str()) {
            return Some(text.to_string());
        }
    }
    None
}

fn judge_state_to_string(state: judge::JudgeState) -> String {
    match state {
        judge::JudgeState::Success => "success".to_string(),
        judge::JudgeState::Failure => "failure".to_string(),
        judge::JudgeState::NeedInput => "need_input".to_string(),
    }
}

fn hook_kind_to_string(kind: HookEventKind) -> String {
    match kind {
        HookEventKind::Completed => "completed".to_string(),
        HookEventKind::NeedInput => "need_input".to_string(),
        HookEventKind::Error => "error".to_string(),
    }
}

fn collect_terminal_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<tauri::WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .filter(|window| window.label().starts_with("terminal-"))
        .collect()
}

fn window_frame_size<R: Runtime>(window: &tauri::WebviewWindow<R>) -> (u32, u32) {
    let outer = window.outer_size().ok();
    let inner = window.inner_size().ok();
    match (outer, inner) {
        (Some(outer), Some(inner)) => (
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        ),
        _ => (0, 0),
    }
}

fn compute_terminal_window_layout<R: Runtime>(
    monitors: &[tauri::Monitor],
    windows: Vec<tauri::WebviewWindow<R>>,
) -> HashMap<String, WindowRect> {
    let mut groups: Vec<Vec<tauri::WebviewWindow<R>>> =
        (0..monitors.len()).map(|_| Vec::new()).collect();
    for window in windows {
        let index = monitor_index_for_window(&window, monitors);
        if let Some(group) = groups.get_mut(index) {
            group.push(window);
        }
    }

    let mut layout = HashMap::new();
    for (monitor_index, mut group) in groups.into_iter().enumerate() {
        if group.is_empty() {
            continue;
        }
        let monitor = match monitors.get(monitor_index) {
            Some(monitor) => monitor,
            None => continue,
        };
        let area = monitor.work_area();
        let base_x = area.position.x;
        let base_y = area.position.y;
        let width = area.size.width;
        let height = area.size.height;

        group.sort_by_key(|window| window.label().to_string());
        let count = group.len();
        let (rows, cols) = grid_for_window_count(count);
        if cols == 0 {
            continue;
        }
        let (cell_width, cell_height) = cell_size(width, height, rows, cols);
        let threshold = row_group_threshold(height);
        let mut centers: Vec<(i32, i32, tauri::WebviewWindow<R>)> = group
            .into_iter()
            .map(|window| {
                let position = window.outer_position().ok();
                let size = window.outer_size().ok();
                let center_x = position.map(|pos| pos.x).unwrap_or(base_x)
                    + size.map(|s| s.width as i32 / 2).unwrap_or(0);
                let center_y = position.map(|pos| pos.y).unwrap_or(base_y)
                    + size.map(|s| s.height as i32 / 2).unwrap_or(0);
                (center_x, center_y, window)
            })
            .collect();
        centers.sort_by_key(|(x, y, _)| (*y, *x));
        let mut rows_grouped: Vec<Vec<(i32, i32, tauri::WebviewWindow<R>)>> = Vec::new();
        for item in centers {
            if let Some(row) = rows_grouped.last_mut() {
                if (item.1 - row[0].1).abs() <= threshold {
                    row.push(item);
                    continue;
                }
            }
            rows_grouped.push(vec![item]);
        }
        for row in &mut rows_grouped {
            row.sort_by_key(|(x, _, _)| *x);
        }
        let ordered_windows: Vec<tauri::WebviewWindow<R>> = rows_grouped
            .into_iter()
            .flat_map(|row| row.into_iter().map(|(_, _, window)| window))
            .collect();

        for (index, window) in ordered_windows.into_iter().enumerate() {
            let row = index / cols;
            let col = index % cols;
            let x = base_x + (col as i32 * cell_width as i32);
            let y = base_y + (row as i32 * cell_height as i32);
            let (frame_width, frame_height) = window_frame_size(&window);
            let target_width = cell_width.saturating_sub(frame_width).max(1);
            let target_height = cell_height.saturating_sub(frame_height).max(1);
            layout.insert(
                window.label().to_string(),
                WindowRect {
                    x,
                    y,
                    width: target_width,
                    height: target_height,
                },
            );
        }
    }

    layout
}

fn layout_order_from_rects(layout: &HashMap<String, WindowRect>) -> Vec<String> {
    let mut items: Vec<(String, WindowRect)> =
        layout.iter().map(|(label, rect)| (label.clone(), *rect)).collect();
    items.sort_by(|(a_label, a), (b_label, b)| {
        (a.y, a.x, a_label).cmp(&(b.y, b.x, b_label))
    });
    items.into_iter().map(|(label, _)| label).collect()
}

fn get_or_recompute_terminal_layout<R: Runtime>(
    app: &AppHandle<R>,
    monitors: &[tauri::Monitor],
    windows: Vec<tauri::WebviewWindow<R>>,
) -> (HashMap<String, WindowRect>, Vec<String>) {
    let labels: HashSet<String> = windows.iter().map(|window| window.label().to_string()).collect();
    let state = app.state::<TerminalWindowLayoutState>();

    if let (Ok(layout_guard), Ok(order_guard)) = (state.layout.lock(), state.order.lock()) {
        if layout_guard.len() == labels.len() && labels.iter().all(|l| layout_guard.contains_key(l))
        {
            return (layout_guard.clone(), order_guard.clone());
        }
    }

    let layout = compute_terminal_window_layout(monitors, windows);
    let order = layout_order_from_rects(&layout);
    if let Ok(mut guard) = state.layout.lock() {
        *guard = layout.clone();
    }
    if let Ok(mut guard) = state.order.lock() {
        *guard = order.clone();
    }
    (layout, order)
}

fn apply_window_rect<R: Runtime>(window: &tauri::WebviewWindow<R>, rect: WindowRect) {
    let _ = window.unmaximize();
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(rect.x, rect.y)));
    let _ = window.set_size(Size::Physical(PhysicalSize::new(
        rect.width.max(1),
        rect.height.max(1),
    )));
    let _ = window.show();
}

fn current_window_rect<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Option<WindowRect> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok().or_else(|| window.outer_size().ok())?;
    Some(WindowRect {
        x: position.x,
        y: position.y,
        width: size.width.max(1),
        height: size.height.max(1),
    })
}

fn ease_in_out_quad(t: f32) -> f32 {
    if t < 0.5 {
        2.0 * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
    }
}

fn lerp_i32(a: i32, b: i32, t: f32) -> i32 {
    let v = a as f32 + (b as f32 - a as f32) * t;
    v.round() as i32
}

fn lerp_u32(a: u32, b: u32, t: f32) -> u32 {
    let v = a as f32 + (b as f32 - a as f32) * t;
    v.round().max(1.0) as u32
}

fn start_focus_transition<R: Runtime>(
    app: &AppHandle<R>,
    old_label: Option<String>,
    new_label: String,
    new_expanded: WindowRect,
    layout: HashMap<String, WindowRect>,
) {
    const SHRINK_MS: u64 = 120;
    const EXPAND_MS: u64 = 160;
    const STEP_MS: u64 = 16;

    let state = match app.try_state::<WindowAnimationState>() {
        Some(state) => state,
        None => {
            app.manage(WindowAnimationState::default());
            app.state::<WindowAnimationState>()
        }
    };

    let new_tile = match layout.get(&new_label).copied() {
        Some(rect) => rect,
        None => {
            if let Some(window) = app.get_webview_window(&new_label) {
                apply_window_rect(&window, new_expanded);
                let _ = window.set_focus();
            }
            return;
        }
    };

    // Position all other terminal windows on their tile rectangles.
    for (label, rect) in &layout {
        if *label == new_label {
            continue;
        }
        if old_label.as_deref() == Some(label.as_str()) {
            continue;
        }
        if let Some(window) = app.get_webview_window(label) {
            apply_window_rect(&window, *rect);
        }
    }

    let new_token = state.next.fetch_add(1, Ordering::Relaxed);
    {
        if let Ok(mut guard) = state.active.lock() {
            guard.insert(new_label.clone(), new_token);
        }
    }

    let old_label = old_label.filter(|label| *label != new_label);
    let old_token = old_label.as_ref().map(|label| {
        let token = state.next.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut guard) = state.active.lock() {
            guard.insert(label.clone(), token);
        }
        token
    });

    let emit_transition = |label: &str, token: u64, active: bool| {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.emit(
                "terminal-focus-transition",
                TerminalFocusTransitionPayload { token, active },
            );
        }
    };

    emit_transition(&new_label, new_token, true);
    if let (Some(old_label), Some(old_token)) = (old_label.as_ref(), old_token) {
        emit_transition(old_label, old_token, true);
    }

    let app = app.clone();
    thread::spawn(move || {
        let is_cancelled = |label: &str, token: u64| -> bool {
            app.try_state::<WindowAnimationState>()
                .and_then(|state| state.active.lock().ok().map(|guard| guard.get(label).copied()))
                .flatten()
                != Some(token)
        };

        // 1) shrink old window back to its tile position.
        if let (Some(old_label), Some(old_token)) = (old_label.as_ref(), old_token) {
            if let (Some(window), Some(old_tile)) = (
                app.get_webview_window(old_label),
                layout.get(old_label).copied(),
            ) {
                let from = current_window_rect(&window).unwrap_or(old_tile);
                let steps = (SHRINK_MS / STEP_MS).max(1);
                let mut last = None;
                for i in 0..=steps {
                    if is_cancelled(old_label, old_token) {
                        if let Some(new_window) = app.get_webview_window(&new_label) {
                            let _ = new_window.emit(
                                "terminal-focus-transition",
                                TerminalFocusTransitionPayload {
                                    token: new_token,
                                    active: false,
                                },
                            );
                        }
                        if let Some(old_window) = app.get_webview_window(old_label) {
                            let _ = old_window.emit(
                                "terminal-focus-transition",
                                TerminalFocusTransitionPayload {
                                    token: old_token,
                                    active: false,
                                },
                            );
                        }
                        return;
                    }
                    let t = ease_in_out_quad(i as f32 / steps as f32);
                    let rect = WindowRect {
                        x: lerp_i32(from.x, old_tile.x, t),
                        y: lerp_i32(from.y, old_tile.y, t),
                        width: lerp_u32(from.width, old_tile.width, t),
                        height: lerp_u32(from.height, old_tile.height, t),
                    };
                    if last != Some(rect) {
                        apply_window_rect(&window, rect);
                        last = Some(rect);
                    }
                    thread::sleep(Duration::from_millis(STEP_MS));
                }
            }
        }

        // 2) expand new window from its tile position to the expanded rect.
        if is_cancelled(&new_label, new_token) {
            if let Some(window) = app.get_webview_window(&new_label) {
                let _ = window.emit(
                    "terminal-focus-transition",
                    TerminalFocusTransitionPayload {
                        token: new_token,
                        active: false,
                    },
                );
            }
            if let (Some(old_label), Some(old_token)) = (old_label.as_ref(), old_token) {
                if let Some(window) = app.get_webview_window(old_label) {
                    let _ = window.emit(
                        "terminal-focus-transition",
                        TerminalFocusTransitionPayload {
                            token: old_token,
                            active: false,
                        },
                    );
                }
            }
            return;
        }
        if let Some(window) = app.get_webview_window(&new_label) {
            apply_window_rect(&window, new_tile);
            let from = new_tile;
            let to = new_expanded;
            let steps = (EXPAND_MS / STEP_MS).max(1);
            let mut last = None;
            for i in 0..=steps {
                if is_cancelled(&new_label, new_token) {
                    let _ = window.emit(
                        "terminal-focus-transition",
                        TerminalFocusTransitionPayload {
                            token: new_token,
                            active: false,
                        },
                    );
                    if let (Some(old_label), Some(old_token)) = (old_label.as_ref(), old_token) {
                        if let Some(old_window) = app.get_webview_window(old_label) {
                            let _ = old_window.emit(
                                "terminal-focus-transition",
                                TerminalFocusTransitionPayload {
                                    token: old_token,
                                    active: false,
                                },
                            );
                        }
                    }
                    return;
                }
                let t = ease_in_out_quad(i as f32 / steps as f32);
                let rect = WindowRect {
                    x: lerp_i32(from.x, to.x, t),
                    y: lerp_i32(from.y, to.y, t),
                    width: lerp_u32(from.width, to.width, t),
                    height: lerp_u32(from.height, to.height, t),
                };
                if last != Some(rect) {
                    apply_window_rect(&window, rect);
                    last = Some(rect);
                }
                thread::sleep(Duration::from_millis(STEP_MS));
            }
            let _ = window.set_focus();
            let _ = window.emit(
                "terminal-focus-transition",
                TerminalFocusTransitionPayload {
                    token: new_token,
                    active: false,
                },
            );
            if let (Some(old_label), Some(old_token)) = (old_label.as_ref(), old_token) {
                if let Some(old_window) = app.get_webview_window(old_label) {
                    let _ = old_window.emit(
                        "terminal-focus-transition",
                        TerminalFocusTransitionPayload {
                            token: old_token,
                            active: false,
                        },
                    );
                }
            }
        }
    });
}

fn primary_work_area<R: Runtime>(app: &AppHandle<R>) -> Result<(i32, i32, u32, u32), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "primary monitor not found".to_string())?;
    let area = monitor.work_area();
    Ok((
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
    ))
}

fn normalize_observed_state(raw: &str) -> String {
    let value = raw.trim().to_ascii_lowercase();
    if value.is_empty() {
        return "idle".to_string();
    }
    match value.as_str() {
        "need_input" | "need-input" | "needinput" => "need-input".to_string(),
        "fail" | "failure" | "error" => "fail".to_string(),
        "success" => "success".to_string(),
        "running" => "running".to_string(),
        "idle" => "idle".to_string(),
        _ => value,
    }
}

fn aggregate_observed_state(states: &HashMap<String, String>) -> String {
    let mut has_need_input = false;
    let mut has_fail = false;
    let mut has_running = false;
    for state in states.values() {
        match state.as_str() {
            "need-input" => has_need_input = true,
            "fail" => has_fail = true,
            "running" => has_running = true,
            "success" | "idle" => {}
            _ => {}
        }
    }
    if has_need_input {
        return "need-input".to_string();
    }
    if has_fail {
        return "fail".to_string();
    }
    if has_running {
        return "running".to_string();
    }
    "idle".to_string()
}

fn emit_terminal_aggregate_state<R: Runtime>(app: &AppHandle<R>, state: &str) {
    if let Some(window) = app.get_webview_window(WINDOW_WATCHER) {
        let payload = AggregateStatePayload {
            state: state.to_string(),
        };
        let _ = window.emit("terminal-aggregate-state", payload);
    }
}

fn position_watcher_window<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let (x, y, width, height) = primary_work_area(app)?;
    let win_w = 96u32;
    let win_h = 192u32;
    let margin = 16i32;
    let pos_x = x + width as i32 - win_w as i32 - margin;
    let pos_y = y + height as i32 - win_h as i32 - margin;
    let _ = window.set_size(Size::Physical(PhysicalSize::new(win_w, win_h)));
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(pos_x, pos_y)));
    Ok(())
}

fn open_watcher_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if app.get_webview_window(WINDOW_WATCHER).is_some() {
        return Ok(());
    }
    let url = "index.html?view=watcher";
    let window = WebviewWindowBuilder::new(app, WINDOW_WATCHER, WebviewUrl::App(url.into()))
        .title("Watcher")
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .build()
        .map_err(|err| err.to_string())?;
    let _ = position_watcher_window(app, &window);
    let state = app.state::<TerminalAggregateState>();
    let last_state = state
        .last_state
        .lock()
        .ok()
        .map(|value| value.clone())
        .unwrap_or_else(|| "idle".to_string());
    emit_terminal_aggregate_state(app, &last_state);
    Ok(())
}

fn close_watcher_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW_WATCHER) {
        let _ = window.close();
    }
}

fn sync_watcher_window<R: Runtime>(app: &AppHandle<R>, settings: &Settings) {
    if settings.terminal_watcher_enabled {
        let _ = open_watcher_window(app);
    } else {
        close_watcher_window(app);
    }
}

fn available_monitors<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<tauri::Monitor>, String> {
    let mut monitors = app.available_monitors().map_err(|err| err.to_string())?;
    if monitors.is_empty() {
        let primary = app
            .primary_monitor()
            .map_err(|err| err.to_string())?
            .ok_or_else(|| "primary monitor not found".to_string())?;
        return Ok(vec![primary]);
    }
    monitors.sort_by_key(|monitor| {
        let area = monitor.work_area();
        (area.position.x, area.position.y)
    });
    Ok(monitors)
}

fn monitor_index_for_window<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    monitors: &[tauri::Monitor],
) -> usize {
    let position = window.outer_position().ok();
    let size = window.outer_size().ok();
    let center = match (position, size) {
        (Some(position), Some(size)) => {
            let center_x = position.x + (size.width as i32 / 2);
            let center_y = position.y + (size.height as i32 / 2);
            Some((center_x, center_y))
        }
        _ => None,
    };

    if let Some((center_x, center_y)) = center {
        if let Some((index, _)) = monitors.iter().enumerate().find(|(_, monitor)| {
            let area = monitor.work_area();
            center_x >= area.position.x
                && center_x < area.position.x + area.size.width as i32
                && center_y >= area.position.y
                && center_y < area.position.y + area.size.height as i32
        }) {
            return index;
        }

        let mut best = 0usize;
        let mut best_distance = i64::MAX;
        for (index, monitor) in monitors.iter().enumerate() {
            let area = monitor.work_area();
            let area_center_x = area.position.x + area.size.width as i32 / 2;
            let area_center_y = area.position.y + area.size.height as i32 / 2;
            let dx = area_center_x as i64 - center_x as i64;
            let dy = area_center_y as i64 - center_y as i64;
            let distance = dx * dx + dy * dy;
            if distance < best_distance {
                best_distance = distance;
                best = index;
            }
        }
        return best;
    }

    0
}

fn grid_for_window_count(count: usize) -> (usize, usize) {
    let rows = if count >= 9 {
        3
    } else if count >= 4 {
        2
    } else {
        1
    };
    let cols = (count + rows - 1) / rows;
    (rows, cols)
}

fn cell_size(width: u32, height: u32, rows: usize, cols: usize) -> (u32, u32) {
    if rows == 0 || cols == 0 {
        return (width.max(1), height.max(1));
    }
    let cell_width = (width / cols as u32).max(1);
    let cell_height = (height / rows as u32).max(1);
    (cell_width, cell_height)
}

fn row_group_threshold(height: u32) -> i32 {
    let min = 80i32;
    let dynamic = (height as f32 * 0.12) as i32;
    if dynamic > min {
        dynamic
    } else {
        min
    }
}

fn pickup_terminal_window_handle<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let windows = collect_terminal_windows(app);
    let monitors = available_monitors(app)?;
    let monitor_index = monitor_index_for_window(window, &monitors);
    let monitor = monitors
        .get(monitor_index)
        .ok_or_else(|| "monitor not found".to_string())?;
    let area = monitor.work_area();
    let base_x = area.position.x;
    let base_y = area.position.y;
    let width = area.size.width;
    let height = area.size.height;
    let (frame_width, frame_height) = window_frame_size(window);
    let target_width = ((width as f32) * 0.8) as u32;
    let target_height = ((height as f32) * 0.8) as u32;
    let target_width = target_width.saturating_sub(frame_width).max(1);
    let target_height = target_height.saturating_sub(frame_height).max(1);
    let center_x = base_x + ((width.saturating_sub(target_width)) as i32 / 2);
    let center_y = base_y + ((height.saturating_sub(target_height)) as i32 / 2);
    let expanded = WindowRect {
        x: center_x,
        y: center_y,
        width: target_width,
        height: target_height,
    };

    let (layout, _order) = get_or_recompute_terminal_layout(app, &monitors, windows);
    let old_label = app
        .state::<SelectionState>()
        .current
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    if let Ok(mut guard) = app.state::<SelectionState>().current.lock() {
        *guard = Some(window.label().to_string());
    }
    start_focus_transition(app, old_label, window.label().to_string(), expanded, layout);
    Ok(())
}

fn register_terminal_window<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    label: &str,
) -> Result<(), String> {
    let terminal_state = app
        .try_state::<TerminalSessionState>()
        .ok_or_else(|| "terminal session state missing".to_string())?;
    let mut guard = terminal_state
        .labels
        .lock()
        .map_err(|_| "terminal labels lock".to_string())?;
    guard.insert(session_id.to_string(), label.to_string());
    Ok(())
}

fn notify_smoke_match<R: Runtime>(app: &AppHandle<R>, session_id: &str, chunk: &str) {
    let state = match app.try_state::<TerminalSmokeState>() {
        Some(state) => state,
        None => return,
    };
    let mut guard = match state.waiters.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if let Some(waiter) = guard.get(session_id) {
        if chunk.to_lowercase().contains(&waiter.token) {
            if let Some(waiter) = guard.remove(session_id) {
                let _ = waiter.sender.send(Ok(()));
                let _ = log_worker_event(
                    app,
                    &format!("terminal smoke matched: session={session_id}"),
                );
            }
        }
    }
}

fn notify_smoke_error<R: Runtime>(app: &AppHandle<R>, session_id: &str, message: &str) {
    let state = match app.try_state::<TerminalSmokeState>() {
        Some(state) => state,
        None => return,
    };
    let mut guard = match state.waiters.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    if let Some(waiter) = guard.remove(session_id) {
        let _ = waiter.sender.send(Err(message.to_string()));
        let _ = log_worker_event(
            app,
            &format!("terminal smoke error: session={session_id} message={message}"),
        );
    }
}

#[tauri::command]
fn start_terminal_session<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let _ = log_worker_event(
        &app,
        &format!("terminal start requested: {session_id} cols={cols} rows={rows}"),
    );
    let terminal_state = app
        .try_state::<TerminalSessionState>()
        .ok_or_else(|| "terminal session state missing".to_string())?;
    {
        let active = terminal_state
            .active
            .lock()
            .map_err(|_| "terminal session lock".to_string())?;
        if active.contains(&session_id) {
            return Ok(());
        }
    }
    let cmd = if cfg!(windows) {
        "cmd.exe".to_string()
    } else {
        "sh".to_string()
    };
    #[cfg(windows)]
    let env = Some(build_windows_terminal_env(&session_id));
    #[cfg(not(windows))]
    let env: Option<HashMap<String, String>> = None;

    let worker_path = worker::resolve_worker_path().map_err(|err| err.to_string())?;
    let mut process = worker::WorkerProcess::spawn(&worker_path).map_err(|err| err.to_string())?;
    if let Some(rx) = process.take_receiver() {
        let tx = app.state::<TerminalWorkerBus>().tx.clone();
        thread::spawn(move || {
            while let Ok(message) = rx.recv() {
                let _ = tx.send(message);
            }
        });
    }
    process
        .send_start_session(nagomi_protocol::StartSession {
            session_id: session_id.clone(),
            cmd,
            cwd: None,
            env,
            cols,
            rows,
        })
        .map_err(|err| err.to_string())?;
    {
        let workers = app.state::<TerminalWorkerState>();
        let mut guard = workers
            .processes
            .lock()
            .map_err(|_| "terminal worker lock".to_string())?;
        guard.insert(session_id.clone(), process);
    }
    let mut active = terminal_state
        .active
        .lock()
        .map_err(|_| "terminal session lock".to_string())?;
    active.insert(session_id);
    Ok(())
}

#[tauri::command]
fn terminal_send_input<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
    text: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let _ = log_worker_event(
        &app,
        &format!("terminal input requested: {session_id} size={}", text.len()),
    );
    let workers = app.state::<TerminalWorkerState>();
    let mut guard = workers
        .processes
        .lock()
        .map_err(|_| "terminal worker lock".to_string())?;
    let Some(process) = guard.get_mut(&session_id) else {
        return Err("terminal session not started".to_string());
    };
    process
        .send_input(nagomi_protocol::SendInput { session_id, text })
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn terminal_resize<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let _ = log_worker_event(
        &app,
        &format!("terminal resize requested: {session_id} cols={cols} rows={rows}"),
    );
    let workers = app.state::<TerminalWorkerState>();
    let mut guard = workers
        .processes
        .lock()
        .map_err(|_| "terminal worker lock".to_string())?;
    let Some(process) = guard.get_mut(&session_id) else {
        return Err("terminal session not started".to_string());
    };
    process
        .send_resize(nagomi_protocol::Resize {
            session_id,
            cols,
            rows,
        })
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn stop_terminal_session<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let _ = log_worker_event(&app, &format!("terminal stop requested: {session_id}"));
    let terminal_state = app
        .try_state::<TerminalSessionState>()
        .ok_or_else(|| "terminal session state missing".to_string())?;
    {
        let mut active = terminal_state
            .active
            .lock()
            .map_err(|_| "terminal session lock".to_string())?;
        active.remove(&session_id);
    }
    {
        let mut labels = terminal_state
            .labels
            .lock()
            .map_err(|_| "terminal labels lock".to_string())?;
        labels.remove(&session_id);
    }
    let workers = app.state::<TerminalWorkerState>();
    let mut guard = workers
        .processes
        .lock()
        .map_err(|_| "terminal worker lock".to_string())?;
    if let Some(mut process) = guard.remove(&session_id) {
        let _ = process.send_stop_session(nagomi_protocol::StopSession {
            session_id: session_id.clone(),
        });
        let _ = process.stop();
    }
    let workers_empty = guard.is_empty();
    drop(guard);

    let flags = app.state::<OrchestratorRuntimeFlags>();
    if flags.exit_on_last_terminal {
        let active_empty = terminal_state
            .active
            .lock()
            .map_err(|_| "terminal session lock".to_string())?
            .is_empty();
        if active_empty && workers_empty {
            let _ = log_worker_event(&app, "last terminal closed: exit orchestrator");
            app.exit(0);
        }
    }
    Ok(())
}

#[tauri::command]
fn open_terminal_window<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    open_terminal_window_inner(app, session_id)
}

fn open_terminal_window_inner<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<(), String> {
    let _ = log_worker_event(
        &app,
        &format!("terminal window open requested: {session_id}"),
    );
    let safe_id = session_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let label = format!("terminal-{safe_id}");
    let title = format!("Terminal {session_id}");
    let query = format!("view=terminal&session_id={session_id}");
    create_window(&app, &label, &title, &query).map_err(|err| err.to_string())?;
    let _ = register_terminal_window(&app, &session_id, &label);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn register_terminal_session<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    ipc_session_id: String,
    session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session_for_window(&window, &ipc_session_id)?;
    let label = window.label().to_string();
    let app = window.app_handle();
    let _ = log_worker_event(
        &app,
        &format!("terminal session register: {session_id} label={label}"),
    );
    register_terminal_window(&app, &session_id, &label)
}

#[tauri::command]
fn debug_emit_terminal_broadcast<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let payload = TerminalOutputPayload {
        session_id,
        chunk: "[debug emit]\r\n".to_string(),
        stream: "stdout".to_string(),
    };
    app.emit("terminal-output-broadcast", payload)
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn debug_emit_terminal_output<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    ipc_session_id: String,
    session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session_for_window(&window, &ipc_session_id)?;
    let payload = TerminalOutputPayload {
        session_id,
        chunk: "[debug window]\r\n".to_string(),
        stream: "stdout".to_string(),
    };
    window
        .emit("terminal-output", payload)
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn append_terminal_debug_snapshot<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let path = terminal_debug_snapshot_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut entry = payload;
    if let Some(obj) = entry.as_object_mut() {
        let stamped = u64::try_from(now_ms).unwrap_or(u64::MAX);
        obj.insert(
            "ts_ms".to_string(),
            serde_json::Value::Number(stamped.into()),
        );
    }
    let raw = serde_json::to_string(&entry).map_err(|err| err.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|err| err.to_string())?;
    writeln!(file, "{}", raw).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_debug_screenshot<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    ipc_session_id: String,
) -> Result<String, String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let path = terminal_debug_screenshot_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    #[cfg(windows)]
    {
        save_webview2_screenshot(&window, &path).map_err(|err| err.to_string())?;
        return Ok(path.to_string_lossy().to_string());
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("screenshot is only supported on Windows in P0".to_string())
    }
}

#[tauri::command]
fn terminal_smoke<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    token: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let token = token.unwrap_or_else(|| "ok".to_string());
    let timeout_ms = timeout_ms.unwrap_or(30000);
    let session_id = format!(
        "smoke-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    let (tx, rx) = std::sync::mpsc::channel();
    let smoke_state = if let Some(state) = app.try_state::<TerminalSmokeState>() {
        state
    } else {
        app.manage(TerminalSmokeState {
            waiters: Mutex::new(HashMap::new()),
        });
        app.state::<TerminalSmokeState>()
    };
    {
        let mut guard = smoke_state
            .waiters
            .lock()
            .map_err(|_| "terminal smoke lock".to_string())?;
        guard.insert(
            session_id.clone(),
            TerminalSmokeWaiter {
                token: token.to_lowercase(),
                sender: tx,
            },
        );
    }
    let _ = log_worker_event(
        &app,
        &format!("terminal smoke start: session={session_id} token={token}"),
    );

    let cmd = if cfg!(windows) {
        "cmd.exe".to_string()
    } else {
        "sh".to_string()
    };
    let state = {
        let mut worker_state = None;
        for _ in 0..40 {
            if let Some(state) = app.try_state::<WorkerState>() {
                worker_state = Some(state);
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        worker_state.ok_or_else(|| "worker state missing".to_string())?
    };
    let mut process = state
        .process
        .lock()
        .map_err(|_| "worker lock".to_string())?;
    process
        .send_start_session(nagomi_protocol::StartSession {
            session_id: session_id.clone(),
            cmd,
            cwd: None,
            env: None,
            cols: 120,
            rows: 30,
        })
        .map_err(|err| err.to_string())?;
    let input = if cfg!(windows) {
        "echo ok\r\nexit\r\n".to_string()
    } else {
        "echo ok\nexit\n".to_string()
    };
    process
        .send_input(nagomi_protocol::SendInput {
            session_id: session_id.clone(),
            text: input,
        })
        .map_err(|err| err.to_string())?;
    let _ = log_worker_event(
        &app,
        &format!("terminal smoke start_session sent: session={session_id}"),
    );

    match rx.recv_timeout(Duration::from_millis(timeout_ms)) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(err)) => Err(err),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            notify_smoke_error(&app, &session_id, "timeout waiting for output");
            Err("timeout waiting for output".to_string())
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            notify_smoke_error(&app, &session_id, "smoke channel disconnected");
            Err("smoke channel disconnected".to_string())
        }
    }
}

#[tauri::command]
fn arrange_terminal_windows<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    arrange_terminal_windows_inner(app)
}

fn arrange_terminal_windows_inner<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let windows = collect_terminal_windows(&app);
    if windows.is_empty() {
        return Ok(());
    }
    let monitors = available_monitors(&app)?;
    let (layout, order) = get_or_recompute_terminal_layout(&app, &monitors, windows);
    for (label, rect) in layout {
        if let Some(window) = app.get_webview_window(&label) {
            apply_window_rect(&window, rect);
        }
    }
    if let Ok(mut guard) = app.state::<TerminalWindowLayoutState>().order.lock() {
        *guard = order;
    }
    Ok(())
}

#[tauri::command]
fn pickup_terminal_window<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    session_id: String,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let safe_id = session_id
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    let label = format!("terminal-{safe_id}");
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "window not found".to_string())?;
    pickup_terminal_window_handle(&app, &window)
}

#[tauri::command]
fn pickup_terminal_window_by_index<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    index: usize,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let mut windows = collect_terminal_windows(&app);
    if windows.is_empty() {
        return Err("window not found".to_string());
    }
    windows.sort_by_key(|window| window.label().to_string());
    let window = windows
        .get(index)
        .ok_or_else(|| "window not found".to_string())?;
    pickup_terminal_window_handle(&app, window)
}

#[tauri::command]
fn focus_next_terminal_window<R: Runtime>(
    app: AppHandle<R>,
    ipc_session_id: String,
    direction: Option<String>,
) -> Result<(), String> {
    ipc_session::touch_ipc_session(&app, &ipc_session_id)?;
    let windows = collect_terminal_windows(&app);
    if windows.is_empty() {
        return Ok(());
    }
    let monitors = available_monitors(&app)?;
    let (layout, order) = get_or_recompute_terminal_layout(&app, &monitors, windows.clone());
    if order.is_empty() {
        return Ok(());
    }

    let selected_label = app
        .state::<SelectionState>()
        .current
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    let focused_label = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .map(|window| window.label().to_string());

    let current_label = selected_label
        .filter(|label| layout.contains_key(label))
        .or_else(|| focused_label.filter(|label| layout.contains_key(label)))
        .unwrap_or_else(|| order[0].clone());

    let current_index = order
        .iter()
        .position(|label| label == &current_label)
        .unwrap_or(0);
    let step: isize = if direction.as_deref() == Some("prev") {
        -1
    } else {
        1
    };
    let len = order.len() as isize;
    let next_index = ((current_index as isize + step).rem_euclid(len)) as usize;
    let target_label = &order[next_index];
    if let Some(window) = app.get_webview_window(target_label) {
        let _ = pickup_terminal_window_handle(&app, &window);
    }
    Ok(())
}

fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    title: &str,
    query: &str,
) -> Result<()> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let normalized_query = if query.contains('=') {
        query.to_string()
    } else {
        format!("view={query}")
    };
    let url = format!("index.html?{normalized_query}");
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .build()?;
    Ok(())
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let menu = Menu::new(app)?;
    let open_settings =
        MenuItem::with_id(app, "open_settings", "Open Settings", true, None::<&str>)?;
    let open_terminal = MenuItem::with_id(
        app,
        "open_terminal",
        "Open Terminal Window",
        true,
        None::<&str>,
    )?;
    let arrange_terminals = MenuItem::with_id(
        app,
        "arrange_terminals",
        "Arrange Terminal Windows",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    menu.append(&open_terminal)?;
    menu.append(&arrange_terminals)?;
    menu.append(&open_settings)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit)?;

    let mut tray = TrayIconBuilder::<R>::with_id("main")
        .menu(&menu)
        .tooltip("nagomi")
        .on_menu_event(|app, event| match event.id() {
            id if id == "open_settings" => {
                let _ = create_window(app, WINDOW_SETTINGS, "Settings", "settings");
                if let Some(window) = app.get_webview_window(WINDOW_SETTINGS) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            id if id == "open_terminal" => {
                let session_id = generate_terminal_session_id();
                let _ = open_terminal_window_inner(app.clone(), session_id);
            }
            id if id == "arrange_terminals" => {
                let _ = arrange_terminal_windows_inner(app.clone());
            }
            id if id == "quit" => {
                app.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn init_worker<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let worker_path = worker::resolve_worker_path()?;
    let process = worker::WorkerProcess::spawn(&worker_path)?;
    app.manage(WorkerState {
        process: Mutex::new(process),
    });
    app.manage(SessionState {
        current: Mutex::new(None),
    });
    log_worker_event(app, "worker initialized")?;
    Ok(())
}

fn log_worker_event<R: Runtime>(app: &AppHandle<R>, message: &str) -> Result<()> {
    let path = worker_log_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{}", message)?;
    Ok(())
}

#[cfg(windows)]
// WebView2 capture avoids black screenshots from GDI / WebView2 で GDI 黒塗りを回避する
fn save_webview2_screenshot<R: Runtime>(window: &tauri::Window<R>, path: &Path) -> Result<()> {
    let webview = window
        .webviews()
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("webview not found"))?;
    let app_handle = window.app_handle().clone();
    let path_buf = path.to_path_buf();
    let cleanup_path = path_buf.clone();
    let path_for_webview = path_buf.clone();
    let cleanup_for_webview = cleanup_path.clone();

    webview
        .with_webview(move |webview| {
            let capture_result: Result<()> = (|| {
                let controller = webview.controller();
                let core = unsafe {
                    controller
                        .CoreWebView2()
                        .map_err(|err| anyhow::anyhow!("CoreWebView2 failed: {err}"))?
                };
                let method_wide: Vec<u16> =
                    "Page.captureScreenshot".encode_utf16().chain(Some(0)).collect();
                let params_wide: Vec<u16> =
                    "{\"format\":\"png\",\"fromSurface\":true}"
                        .encode_utf16()
                        .chain(Some(0))
                        .collect();
                let output_path = path_for_webview.clone();
                let app_handle = app_handle.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result: windows::core::Result<()>, response: String| {
                        if let Err(err) = result {
                            let _ = log_worker_event(
                                &app_handle,
                                &format!("debug screenshot devtools failed: {err}"),
                            );
                            WEBVIEW2_CAPTURE_HANDLER.with(|slot| *slot.borrow_mut() = None);
                            return Ok(());
                        }
                        let data = serde_json::from_str::<serde_json::Value>(&response)
                            .ok()
                            .and_then(|value| {
                                value
                                    .get("data")
                                    .and_then(|value| value.as_str())
                                    .map(|value| value.to_string())
                            })
                            .unwrap_or_default();
                        if data.is_empty() {
                            let _ = log_worker_event(
                                &app_handle,
                                "debug screenshot devtools missing data",
                            );
                            WEBVIEW2_CAPTURE_HANDLER.with(|slot| *slot.borrow_mut() = None);
                            return Ok(());
                        }
                        match BASE64_STANDARD.decode(data.as_bytes()) {
                            Ok(bytes) => {
                                let _ = fs::write(&output_path, bytes);
                            }
                            Err(err) => {
                                let _ = log_worker_event(
                                    &app_handle,
                                    &format!("debug screenshot base64 decode failed: {err}"),
                                );
                            }
                        }
                        WEBVIEW2_CAPTURE_HANDLER.with(|slot| *slot.borrow_mut() = None);
                        Ok(())
                    },
                ));
                WEBVIEW2_CAPTURE_HANDLER.with(|slot| *slot.borrow_mut() = Some(handler.clone()));
                unsafe {
                    core.CallDevToolsProtocolMethod(
                        PCWSTR(method_wide.as_ptr()),
                        PCWSTR(params_wide.as_ptr()),
                        &handler,
                    )
                    .map_err(|err| anyhow::anyhow!("CallDevToolsProtocolMethod failed: {err}"))?
                };
                Ok(())
            })();

            if let Err(err) = capture_result {
                let _ = fs::remove_file(&cleanup_for_webview);
                let _ = log_worker_event(&app_handle, &format!(
                    "debug screenshot failed: {err}"
                ));
            }
        })
        .map_err(|err| anyhow::anyhow!("webview access failed: {err}"))?;

    if let Err(err) = wait_for_screenshot_file(&path_buf, Duration::from_secs(3)) {
        let _ = fs::remove_file(cleanup_path);
        return Err(err);
    }
    Ok(())
}

#[cfg(windows)]
fn wait_for_screenshot_file(path: &Path, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(meta) = fs::metadata(path) {
            if meta.len() > 0 {
                return Ok(());
            }
        }
        if Instant::now() >= deadline {
            anyhow::bail!("CapturePreview timeout");
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(windows)]
fn save_window_screenshot(raw_hwnd: isize, path: &Path) -> Result<()> {
    if raw_hwnd == 0 {
        anyhow::bail!("invalid hwnd");
    }
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let ok = unsafe { GetClientRect(raw_hwnd, &mut rect) };
    if ok == 0 {
        anyhow::bail!("GetClientRect failed");
    }
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        anyhow::bail!("invalid window size");
    }

    let hdc_window = unsafe { GetDC(raw_hwnd) };
    if hdc_window == 0 {
        anyhow::bail!("GetDC failed");
    }
    let hdc_mem = unsafe { CreateCompatibleDC(hdc_window) };
    if hdc_mem == 0 {
        unsafe {
            ReleaseDC(raw_hwnd, hdc_window);
        }
        anyhow::bail!("CreateCompatibleDC failed");
    }
    let hbmp = unsafe { CreateCompatibleBitmap(hdc_window, width, height) };
    if hbmp == 0 {
        unsafe {
            DeleteDC(hdc_mem);
            ReleaseDC(raw_hwnd, hdc_window);
        }
        anyhow::bail!("CreateCompatibleBitmap failed");
    }
    let previous = unsafe { SelectObject(hdc_mem, hbmp as _) };
    unsafe {
        BitBlt(
            hdc_mem,
            0,
            0,
            width,
            height,
            hdc_window,
            0,
            0,
            SRCCOPY | CAPTUREBLT,
        );
    }

    let mut bmi: BITMAPINFO = unsafe { std::mem::zeroed() };
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = width;
    bmi.bmiHeader.biHeight = -height;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    let mut buffer = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        GetDIBits(
            hdc_mem,
            hbmp,
            0,
            height as u32,
            buffer.as_mut_ptr() as *mut _,
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    unsafe {
        if previous != 0 {
            SelectObject(hdc_mem, previous);
        }
        DeleteObject(hbmp as _);
        DeleteDC(hdc_mem);
        ReleaseDC(raw_hwnd, hdc_window);
    }

    if lines == 0 {
        anyhow::bail!("GetDIBits failed");
    }

    write_bmp(path, width, height, &buffer)?;
    Ok(())
}

#[cfg(windows)]
fn write_bmp(path: &Path, width: i32, height: i32, pixels: &[u8]) -> Result<()> {
    let header_size = 14u32;
    let info_size = 40u32;
    let data_size = pixels.len() as u32;
    let file_size = header_size + info_size + data_size;

    let mut file = fs::File::create(path)?;
    file.write_all(&[0x42, 0x4d])?;
    file.write_all(&file_size.to_le_bytes())?;
    file.write_all(&0u16.to_le_bytes())?;
    file.write_all(&0u16.to_le_bytes())?;
    file.write_all(&(header_size + info_size).to_le_bytes())?;
    file.write_all(&info_size.to_le_bytes())?;
    file.write_all(&width.to_le_bytes())?;
    file.write_all(&(-height).to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&32u16.to_le_bytes())?;
    file.write_all(&(BI_RGB as u32).to_le_bytes())?;
    file.write_all(&data_size.to_le_bytes())?;
    file.write_all(&0i32.to_le_bytes())?;
    file.write_all(&0i32.to_le_bytes())?;
    file.write_all(&0u32.to_le_bytes())?;
    file.write_all(&0u32.to_le_bytes())?;
    file.write_all(pixels)?;
    Ok(())
}

fn start_worker_reader<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        use std::collections::HashMap;

        #[derive(Debug)]
        struct PendingOutput {
            queued_at: Instant,
            bytes: usize,
            chunks: Vec<String>,
        }

        // Terminal output coalescing defaults / 繧ｿ繝ｼ繝溘リ繝ｫ蜃ｺ蜉帛粋菴薙・譌｢螳壼､
        const OUTPUT_BUSY_THRESHOLD_BYTES: usize = 256 * 1024;
        const OUTPUT_FLUSH_DELAY_NORMAL: Duration = Duration::from_millis(16);
        const OUTPUT_FLUSH_BYTES_NORMAL: usize = 64 * 1024;
        const OUTPUT_FLUSH_DELAY_BUSY: Duration = Duration::from_millis(32);
        const OUTPUT_FLUSH_BYTES_BUSY: usize = 128 * 1024;

        let debug_io = std::env::var_os("NAGOMI_DEBUG_WORKER_IO").is_some();
        let enable_broadcast =
            std::env::var_os("NAGOMI_ENABLE_TERMINAL_OUTPUT_BROADCAST").is_some();
        let mut pending: HashMap<(String, String), PendingOutput> = HashMap::new();

        loop {
            let total_pending_bytes: usize = pending.values().map(|entry| entry.bytes).sum();
            let (flush_delay, flush_bytes) = if total_pending_bytes > OUTPUT_BUSY_THRESHOLD_BYTES {
                (OUTPUT_FLUSH_DELAY_BUSY, OUTPUT_FLUSH_BYTES_BUSY)
            } else {
                (OUTPUT_FLUSH_DELAY_NORMAL, OUTPUT_FLUSH_BYTES_NORMAL)
            };

            // Flush deadline drives worker read timeout so we can flush ~16ms even when output is sparse.
            let now = Instant::now();
            let mut next_deadline: Option<Instant> = None;
            for entry in pending.values() {
                let deadline = entry.queued_at + flush_delay;
                next_deadline = Some(next_deadline.map_or(deadline, |prev| prev.min(deadline)));
            }
            let timeout = next_deadline
                .map(|deadline| deadline.saturating_duration_since(now))
                .unwrap_or(Duration::from_millis(200))
                .min(Duration::from_millis(200));

            let message = {
                let state = app.state::<WorkerState>();
                let process = state.process.lock().expect("worker lock");
                process.read_message_with_timeout(timeout).ok().flatten()
            };

            if let Some(message) = message {
                match message {
                    Message::Output(output) => {
                        notify_smoke_match(&app, &output.session_id, &output.chunk);
                        let session_id = output.session_id;
                        let stream = output.stream;
                        let chunk = output.chunk;

                        if debug_io {
                            let _ = log_worker_event(
                                &app,
                                &format!(
                                    "output received: session={session_id} stream={stream} size={}",
                                    chunk.len()
                                ),
                            );
                        }

                        let key = (session_id.clone(), stream.clone());
                        let entry = pending.entry(key).or_insert_with(|| PendingOutput {
                            queued_at: Instant::now(),
                            bytes: 0,
                            chunks: Vec::new(),
                        });
                        entry.bytes += chunk.len();
                        entry.chunks.push(chunk);
                    }
                    Message::Exit(exit) => {
                        if exit.exit_code == 0 {
                            let mut matched = false;
                            if let Some(state) = app.try_state::<TerminalSmokeState>() {
                                if let Ok(mut guard) = state.waiters.lock() {
                                    if let Some(waiter) = guard.remove(&exit.session_id) {
                                        let _ = waiter.sender.send(Ok(()));
                                        let _ = log_worker_event(
                                            &app,
                                            &format!(
                                                "terminal smoke exit ok: session={}",
                                                exit.session_id
                                            ),
                                        );
                                        matched = true;
                                    }
                                }
                            }
                            if !matched {
                                notify_smoke_error(
                                    &app,
                                    &exit.session_id,
                                    "exit before token: 0",
                                );
                            }
                        } else {
                            notify_smoke_error(
                                &app,
                                &exit.session_id,
                                &format!("exit before token: {}", exit.exit_code),
                            );
                        }
                        let _ = log_worker_event(
                            &app,
                            &format!("exit {}: {}", exit.session_id, exit.exit_code),
                        );
                        println!("[worker] exit {}: {}", exit.session_id, exit.exit_code);
                        let session = app.state::<SessionState>();
                        let mut guard = session.current.lock().expect("session lock");
                        *guard = None;
                        let label = {
                            let state = app.state::<TerminalSessionState>();
                            if let Ok(mut active) = state.active.lock() {
                                active.remove(&exit.session_id);
                            }
                            let guard = state.labels.lock().ok();
                            guard
                                .and_then(|map| map.get(&exit.session_id).cloned())
                                .unwrap_or_default()
                        };
                        if label.is_empty() {
                            let _ = log_worker_event(
                                &app,
                                &format!(
                                    "terminal exit ignored: session={} label missing",
                                    exit.session_id
                                ),
                            );
                        } else if let Some(window) = app.get_webview_window(&label) {
                            let payload = TerminalExitPayload {
                                session_id: exit.session_id.clone(),
                                exit_code: exit.exit_code,
                            };
                            match window.emit("terminal-exit", payload) {
                                Ok(()) => {
                                    let _ = log_worker_event(
                                        &app,
                                        &format!(
                                            "terminal exit emitted: session={} label={}",
                                            exit.session_id, label
                                        ),
                                    );
                                }
                                Err(err) => {
                                    let _ = log_worker_event(
                                        &app,
                                        &format!(
                                            "terminal exit emit failed: session={} label={} err={}",
                                            exit.session_id, label, err
                                        ),
                                    );
                                }
                            }
                        } else {
                            let _ = log_worker_event(
                                &app,
                                &format!(
                                    "terminal exit ignored: session={} window missing label={}",
                                    exit.session_id, label
                                ),
                            );
                        }
                    }
                    Message::Error(error) => {
                        notify_smoke_error(&app, &error.session_id, &error.message);
                        let _ = log_worker_event(
                            &app,
                            &format!("error {}: {}", error.session_id, error.message),
                        );
                        println!("[worker] error {}: {}", error.session_id, error.message);
                        let label = {
                            let state = app.state::<TerminalSessionState>();
                            let guard = state.labels.lock().ok();
                            guard
                                .and_then(|map| map.get(&error.session_id).cloned())
                                .unwrap_or_default()
                        };
                        if label.is_empty() {
                            let _ = log_worker_event(
                                &app,
                                &format!(
                                    "terminal error ignored: session={} label missing",
                                    error.session_id
                                ),
                            );
                        } else if let Some(window) = app.get_webview_window(&label) {
                            let payload = TerminalErrorPayload {
                                session_id: error.session_id.clone(),
                                message: error.message,
                            };
                            match window.emit("terminal-error", payload) {
                                Ok(()) => {
                                    let _ = log_worker_event(
                                        &app,
                                        &format!(
                                            "terminal error emitted: session={} label={}",
                                            error.session_id, label
                                        ),
                                    );
                                }
                                Err(err) => {
                                    let _ = log_worker_event(
                                        &app,
                                        &format!(
                                        "terminal error emit failed: session={} label={} err={}",
                                        error.session_id, label, err
                                    ),
                                    );
                                }
                            }
                        } else {
                            let _ = log_worker_event(
                                &app,
                                &format!(
                                    "terminal error ignored: session={} window missing label={}",
                                    error.session_id, label
                                ),
                            );
                        }
                    }
                    _ => {}
                }
            }

            // Flush due output buffers (size or time).
            let now = Instant::now();
            let mut flush_keys: Vec<(String, String)> = Vec::new();
            for (key, entry) in pending.iter() {
                if entry.bytes >= flush_bytes || now.duration_since(entry.queued_at) >= flush_delay
                {
                    flush_keys.push(key.clone());
                }
            }

            for (session_id, stream) in flush_keys {
                let Some(entry) = pending.remove(&(session_id.clone(), stream.clone())) else {
                    continue;
                };
                if entry.chunks.is_empty() {
                    continue;
                }
                let chunk = if entry.chunks.len() == 1 {
                    entry.chunks.into_iter().next().unwrap_or_default()
                } else {
                    entry.chunks.concat()
                };

                let label = {
                    let state = app.state::<TerminalSessionState>();
                    let guard = state.labels.lock().ok();
                    guard
                        .and_then(|map| map.get(&session_id).cloned())
                        .unwrap_or_default()
                };

                if !label.is_empty() {
                    if let Some(window) = app.get_webview_window(&label) {
                        let payload = TerminalOutputPayload {
                            session_id: session_id.clone(),
                            chunk: chunk.clone(),
                            stream: stream.clone(),
                        };
                        let _ = window.emit("terminal-output", payload);
                    }
                }

                if enable_broadcast {
                    let broadcast_payload = TerminalOutputPayload {
                        session_id,
                        chunk,
                        stream,
                    };
                    let _ = app.emit("terminal-output-broadcast", broadcast_payload);
                }
            }
        }
    });
}

fn start_terminal_worker_reader<R: Runtime>(
    app: AppHandle<R>,
    rx: std::sync::mpsc::Receiver<Message>,
) {
    thread::spawn(move || {
        use std::collections::HashMap;

        #[derive(Debug)]
        struct PendingOutput {
            queued_at: Instant,
            bytes: usize,
            chunks: Vec<String>,
        }

        // Terminal output coalescing defaults / 繧ｿ繝ｼ繝溘リ繝ｫ蜃ｺ蜉帛粋菴薙・譌｢螳壼､
        const OUTPUT_BUSY_THRESHOLD_BYTES: usize = 256 * 1024;
        const OUTPUT_FLUSH_DELAY_NORMAL: Duration = Duration::from_millis(16);
        const OUTPUT_FLUSH_BYTES_NORMAL: usize = 64 * 1024;
        const OUTPUT_FLUSH_DELAY_BUSY: Duration = Duration::from_millis(32);
        const OUTPUT_FLUSH_BYTES_BUSY: usize = 128 * 1024;

        let debug_io = std::env::var_os("NAGOMI_DEBUG_WORKER_IO").is_some();
        let enable_broadcast =
            std::env::var_os("NAGOMI_ENABLE_TERMINAL_OUTPUT_BROADCAST").is_some();
        let mut pending: HashMap<(String, String), PendingOutput> = HashMap::new();

        loop {
            let total_pending_bytes: usize = pending.values().map(|entry| entry.bytes).sum();
            let (flush_delay, flush_bytes) = if total_pending_bytes > OUTPUT_BUSY_THRESHOLD_BYTES {
                (OUTPUT_FLUSH_DELAY_BUSY, OUTPUT_FLUSH_BYTES_BUSY)
            } else {
                (OUTPUT_FLUSH_DELAY_NORMAL, OUTPUT_FLUSH_BYTES_NORMAL)
            };

            // Flush deadline drives recv timeout so we can flush ~16ms even when output is sparse.
            let now = Instant::now();
            let mut next_deadline: Option<Instant> = None;
            for entry in pending.values() {
                let deadline = entry.queued_at + flush_delay;
                next_deadline = Some(next_deadline.map_or(deadline, |prev| prev.min(deadline)));
            }
            let timeout = next_deadline
                .map(|deadline| deadline.saturating_duration_since(now))
                .unwrap_or(Duration::from_millis(200))
                .min(Duration::from_millis(200));

            let message = rx.recv_timeout(timeout).ok();
            if let Some(message) = message {
                match message {
                    Message::Output(output) => {
                        let session_id = output.session_id;
                        let stream = output.stream;
                        let chunk = output.chunk;

                        if debug_io {
                            let _ = log_worker_event(
                                &app,
                                &format!(
                                    "terminal output received: session={session_id} stream={stream} size={}",
                                    chunk.len()
                                ),
                            );
                        }

                        let key = (session_id.clone(), stream.clone());
                        let entry = pending.entry(key).or_insert_with(|| PendingOutput {
                            queued_at: Instant::now(),
                            bytes: 0,
                            chunks: Vec::new(),
                        });
                        entry.bytes += chunk.len();
                        entry.chunks.push(chunk);
                    }
                    Message::Exit(exit) => {
                        let _ = log_worker_event(
                            &app,
                            &format!("terminal exit {}: {}", exit.session_id, exit.exit_code),
                        );
                        println!(
                            "[terminal-worker] exit {}: {}",
                            exit.session_id, exit.exit_code
                        );

                        let label = {
                            let state = app.state::<TerminalSessionState>();
                            let guard = state.labels.lock().ok();
                            guard
                                .and_then(|map| map.get(&exit.session_id).cloned())
                                .unwrap_or_default()
                        };
                        if !label.is_empty() {
                            if let Some(window) = app.get_webview_window(&label) {
                                let payload = TerminalExitPayload {
                                    session_id: exit.session_id.clone(),
                                    exit_code: exit.exit_code,
                                };
                                let _ = window.emit("terminal-exit", payload);
                            }
                        }

                        if let Ok(mut active) = app.state::<TerminalSessionState>().active.lock() {
                            active.remove(&exit.session_id);
                        }
                        if let Ok(mut guard) = app.state::<TerminalWorkerState>().processes.lock() {
                            if let Some(mut process) = guard.remove(&exit.session_id) {
                                let _ = process.stop();
                            }
                        }
                    }
                    Message::Error(error) => {
                        let _ = log_worker_event(
                            &app,
                            &format!("terminal error {}: {}", error.session_id, error.message),
                        );
                        println!(
                            "[terminal-worker] error {}: {}",
                            error.session_id, error.message
                        );

                        let label = {
                            let state = app.state::<TerminalSessionState>();
                            let guard = state.labels.lock().ok();
                            guard
                                .and_then(|map| map.get(&error.session_id).cloned())
                                .unwrap_or_default()
                        };
                        if !label.is_empty() {
                            if let Some(window) = app.get_webview_window(&label) {
                                let payload = TerminalErrorPayload {
                                    session_id: error.session_id.clone(),
                                    message: error.message,
                                };
                                let _ = window.emit("terminal-error", payload);
                            }
                        }
                    }
                    _ => {}
                }
            }

            // Flush due output buffers (size or time).
            let now = Instant::now();
            let mut flush_keys: Vec<(String, String)> = Vec::new();
            for (key, entry) in pending.iter() {
                if entry.bytes >= flush_bytes || now.duration_since(entry.queued_at) >= flush_delay
                {
                    flush_keys.push(key.clone());
                }
            }

            for (session_id, stream) in flush_keys {
                let Some(entry) = pending.remove(&(session_id.clone(), stream.clone())) else {
                    continue;
                };
                if entry.chunks.is_empty() {
                    continue;
                }
                let chunk = if entry.chunks.len() == 1 {
                    entry.chunks.into_iter().next().unwrap_or_default()
                } else {
                    entry.chunks.concat()
                };

                let label = {
                    let state = app.state::<TerminalSessionState>();
                    let guard = state.labels.lock().ok();
                    guard
                        .and_then(|map| map.get(&session_id).cloned())
                        .unwrap_or_default()
                };
                if !label.is_empty() {
                    if let Some(window) = app.get_webview_window(&label) {
                        let payload = TerminalOutputPayload {
                            session_id: session_id.clone(),
                            chunk: chunk.clone(),
                            stream: stream.clone(),
                        };
                        let _ = window.emit("terminal-output", payload);
                    }
                }

                if enable_broadcast {
                    let broadcast_payload = TerminalOutputPayload {
                        session_id,
                        chunk,
                        stream,
                    };
                    let _ = app.emit("terminal-output-broadcast", broadcast_payload);
                }
            }
        }
    });
}

fn start_worker_session<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    {
        let session = app.state::<SessionState>();
        let guard = session.current.lock().expect("session lock");
        if guard.is_some() {
            anyhow::bail!("session already started");
        }
    }

    let session_id = format!(
        "session-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let cmd = if cfg!(windows) {
        "cmd.exe".to_string()
    } else {
        "sh".to_string()
    };

    let state = app.state::<WorkerState>();
    let mut process = state.process.lock().expect("worker lock");
    process.send_start_session(nagomi_protocol::StartSession {
        session_id: session_id.clone(),
        cmd,
        cwd: None,
        env: None,
        cols: 120,
        rows: 30,
    })?;

    let session = app.state::<SessionState>();
    let mut guard = session.current.lock().expect("session lock");
    *guard = Some(session_id);
    log_worker_event(app, "start_session requested (new)")?;
    Ok(())
}

fn send_sample_input<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let session = app.state::<SessionState>();
    let session_id = {
        let guard = session.current.lock().expect("session lock");
        guard.clone().unwrap_or_default()
    };
    if session_id.is_empty() {
        anyhow::bail!("session not started");
    }

    let payload = if cfg!(windows) {
        "echo ok\r\n"
    } else {
        "echo ok\n"
    };
    let state = app.state::<WorkerState>();
    let mut process = state.process.lock().expect("worker lock");
    process.send_input(nagomi_protocol::SendInput {
        session_id,
        text: payload.to_string(),
    })?;
    log_worker_event(app, "send_input requested")?;
    Ok(())
}

fn stop_worker_session<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let session = app.state::<SessionState>();
    let session_id = {
        let guard = session.current.lock().expect("session lock");
        guard.clone().unwrap_or_default()
    };
    if session_id.is_empty() {
        anyhow::bail!("session not started");
    }

    let state = app.state::<WorkerState>();
    let mut process = state.process.lock().expect("worker lock");
    process.send_stop_session(nagomi_protocol::StopSession { session_id })?;
    log_worker_event(app, "stop_session requested")?;
    Ok(())
}

fn main() {
    let global_shortcut = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcut("CommandOrControl+Shift+Y")
        .expect("valid global shortcut")
        .with_handler(|app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = arrange_terminal_windows_inner(app.clone());
            }
        })
        .build();

    tauri::Builder::default()
        .plugin(global_shortcut)
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            report_terminal_observation,
            ensure_codex_hook,
            tool_judge,
            open_terminal_window,
            arrange_terminal_windows,
            pickup_terminal_window,
            pickup_terminal_window_by_index,
            focus_next_terminal_window,
            start_terminal_session,
            terminal_send_input,
            terminal_resize,
            stop_terminal_session,
            register_terminal_session,
            ipc_session::ipc_session_open,
            ipc_session::ipc_session_probe,
            ipc_session::ipc_session_echo,
            ipc_session::ipc_session_close,
            debug_emit_terminal_broadcast,
            debug_emit_terminal_output,
            append_terminal_debug_snapshot,
            save_debug_screenshot,
            terminal_smoke
        ])
        .setup(|app| {
            let handle = app.handle();
            init_worker(handle)?;
            ipc_session::init_ipc_session_state(handle);
            start_health_server(handle.clone());
            handle.manage(SelectionState {
                current: Mutex::new(None),
            });
            handle.manage(TerminalAggregateState::default());
            handle.manage(TerminalWindowLayoutState::default());
            handle.manage(TerminalSessionState {
                active: Mutex::new(HashSet::new()),
                labels: Mutex::new(HashMap::new()),
            });
            let (terminal_tx, terminal_rx) = std::sync::mpsc::channel::<Message>();
            handle.manage(TerminalWorkerBus { tx: terminal_tx });
            handle.manage(TerminalWorkerState {
                processes: Mutex::new(HashMap::new()),
            });
            handle.manage(TerminalSmokeState {
                waiters: Mutex::new(HashMap::new()),
            });
            handle.manage(OrchestratorRuntimeFlags {
                exit_on_last_terminal: should_exit_on_last_terminal(),
            });
            let hook_handle = handle.clone();
            let hook_callback: Arc<dyn Fn(HookEvent) + Send + Sync> =
                Arc::new(move |event| {
                    handle_hook_event(&hook_handle, event);
                });
            handle.manage(CompletionHookState {
                manager: Mutex::new(CompletionHookManager::new(hook_callback)),
            });
            start_worker_reader(handle.clone());
            start_terminal_worker_reader(handle.clone(), terminal_rx);
            if should_start_hidden() {
                if let Some(window) = handle.get_webview_window(WINDOW_CHAT) {
                    let _ = window.hide();
                }
            }

            let path = settings_path(handle);
            let settings = read_settings(&path)?;
            write_settings(&path, &settings)?;
            apply_completion_hook_tool(&handle, Some(settings.llm_tool.as_str()));
            sync_watcher_window(&handle, &settings);

            build_tray(handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        path.push(format!("nagomi-{name}-{nonce}.json"));
        path
    }

    #[test]
    fn settings_roundtrip() {
        let path = temp_settings_path("roundtrip");
        let settings = Settings {
            notifications_enabled: false,
            audio_enabled: true,
            volume: 0.5,
            silence_timeout_ms: 4000,
            llm_enabled: false,
            llm_tool: "codex".to_string(),
            character_id: "test".to_string(),
            log_retention_lines: 100,
            terminal_watcher_enabled: true,
            terminal_font_family:
                "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, Monaco, 'Liberation Mono', 'DejaVu Sans Mono', monospace"
                    .to_string(),
            terminal_font_size: 14,
            terminal_theme: "light".to_string(),
            terminal_scrollback_lines: 5000,
            terminal_copy_on_select: false,
        };

        write_settings(&path, &settings).expect("write settings");
        let loaded = read_settings(&path).expect("read settings");
        assert_eq!(loaded, settings);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn settings_default_when_missing() {
        let path = temp_settings_path("missing");
        let loaded = read_settings(&path).expect("read settings");
        assert_eq!(loaded, Settings::default());
    }

    #[test]
    fn tauri_config_windows() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let raw = fs::read_to_string(&path).expect("read config");
        let value: Value = serde_json::from_str(&raw).expect("parse config");
        let windows = value
            .get("app")
            .and_then(|value| value.get("windows"))
            .and_then(|value| value.as_array())
            .expect("windows array");

        let labels: Vec<&str> = windows
            .iter()
            .filter_map(|window| window.get("label").and_then(|value| value.as_str()))
            .collect();

        assert!(labels.contains(&WINDOW_CHAT));
    }

    #[test]
    fn create_window_registers() {
        let app = tauri::test::mock_app();
        let handle = app.handle();

        create_window(handle, WINDOW_CHAT, "Chat", "chat").expect("create window");
        let window = handle
            .get_webview_window(WINDOW_CHAT)
            .expect("window exists");
        assert_eq!(window.label(), WINDOW_CHAT);
    }

    #[test]
    fn tray_icon_created() {
        let app = tauri::test::mock_app();
        let handle = app.handle();

        build_tray(handle).expect("build tray");
        let tray = handle
            .tray_by_id(&tauri::tray::TrayIconId::new("main"))
            .expect("tray exists");
        assert_eq!(tray.id().as_ref(), "main");
    }
}

