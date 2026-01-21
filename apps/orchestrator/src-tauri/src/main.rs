use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Runtime, Size,
    WebviewUrl, WebviewWindowBuilder,
};
use yurutsuku_protocol::Message;

mod judge;
mod ipc_session;
mod notify;
mod worker;

const WINDOW_CHAT: &str = "chat";
const WINDOW_RUN: &str = "run";
const WINDOW_SETTINGS: &str = "settings";

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

struct WorkerState {
    process: Mutex<worker::WorkerProcess>,
}

struct SessionState {
    current: Mutex<Option<String>>,
}

struct SelectionState {
    current: Mutex<Option<String>>,
}

struct TerminalSessionState {
    // Worker is single-session for now. / Worker は当面単一セッション前提。
    current: Mutex<Option<String>>,
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

impl Default for Settings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            audio_enabled: true,
            volume: 0.8,
            silence_timeout_ms: 3500,
            llm_enabled: false,
            llm_tool: "codex".to_string(),
            character_id: "default".to_string(),
            log_retention_lines: 20_000,
            terminal_font_family: "ui-monospace, 'Cascadia Mono', Consolas, 'SFMono-Regular', Menlo, Monaco, 'Liberation Mono', 'DejaVu Sans Mono', monospace".to_string(),
            terminal_font_size: 18,
            terminal_theme: "dark".to_string(),
            terminal_scrollback_lines: 5000,
            terminal_copy_on_select: true,
        }
    }
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    // 設定ファイルは app_config_dir に置く / Store settings under app_config_dir.
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

fn start_health_server<R: Runtime>(app: AppHandle<R>) {
    let port = std::env::var("YURUTSUKU_ORCH_HEALTH_PORT")
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

fn pick_existing_terminal_session_id<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let state = app.try_state::<TerminalSessionState>()?;

    if let Ok(guard) = state.current.lock() {
        if let Some(session_id) = guard.as_ref() {
            return Some(session_id.clone());
        }
    }

    if let Ok(guard) = state.active.lock() {
        if let Some(session_id) = guard.iter().next() {
            return Some(session_id.clone());
        }
    }

    if let Ok(guard) = state.labels.lock() {
        if let Some((session_id, _)) = guard.iter().next() {
            return Some(session_id.clone());
        }
    }

    None
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
    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let mut buffer = [0u8; 512];
    let read_size = match stream.read(&mut buffer) {
        Ok(size) => size,
        Err(err) => {
            let _ = log_worker_event(app, &format!("health read failed: {err}"));
            return;
        }
    };
    let request = String::from_utf8_lossy(&buffer[..read_size]);
    if request.starts_with("GET /health ") {
        let body = format!(r#"{{"status":"ok","pid":{}}}"#, std::process::id());
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    if let Some(path) = request.split_whitespace().nth(1) {
        if path.starts_with("/open-terminal") {
            let requested_session_id = path
                .splitn(2, '?')
                .nth(1)
                .and_then(|query| query.split('&').find(|part| part.starts_with("session_id=")))
                .and_then(|part| part.splitn(2, '=').nth(1))
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());

            // Worker is single-session for now: always reuse the existing session when present.
            // Worker が単一セッションのため、既存セッションがあれば常に再利用する。
            let session_id = pick_existing_terminal_session_id(app)
                .or(requested_session_id)
                .unwrap_or_else(generate_terminal_session_id);

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
    }

    let body = r#"{"status":"not_found"}"#;
    let response = format!(
        "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
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
    write_settings(&path, &settings).map_err(|err| err.to_string())
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
    let rows = if count >= 9 { 3 } else if count >= 4 { 2 } else { 1 };
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
    if dynamic > min { dynamic } else { min }
}

fn pickup_terminal_window_handle<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
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
    let _ = arrange_terminal_windows_inner(app.clone());
    let _ = window.unmaximize();
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(center_x, center_y)));
    let _ = window.set_size(Size::Physical(PhysicalSize::new(target_width, target_height)));
    let _ = window.show();
    let _ = window.set_focus();
    if let Ok(mut guard) = app.state::<SelectionState>().current.lock() {
        *guard = Some(window.label().to_string());
    }
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

    // Prevent "session already exists" / "session_id mismatch" by refusing to start a second session
    // when the worker is already running one.
    // Worker が単一セッションのため、2つ目の start は拒否して状態汚染を防ぐ。
    if let Ok(guard) = terminal_state.current.lock() {
        if let Some(existing) = guard.as_ref() {
            if existing != &session_id {
                return Err(format!("terminal session already active: {existing}"));
            }
        }
    }

    let mut active = terminal_state
        .active
        .lock()
        .map_err(|_| "terminal session lock".to_string())?;
    if active.contains(&session_id) {
        return Ok(());
    }
    let cmd = if cfg!(windows) {
        "cmd.exe".to_string()
    } else {
        "sh".to_string()
    };
    let worker_state = app.state::<WorkerState>();
    let mut process = worker_state
        .process
        .lock()
        .map_err(|_| "worker lock".to_string())?;
    process
        .send_start_session(yurutsuku_protocol::StartSession {
            session_id: session_id.clone(),
            cmd,
            cwd: None,
            env: None,
            cols,
            rows,
        })
        .map_err(|err| err.to_string())?;
    if let Ok(mut guard) = terminal_state.current.lock() {
        *guard = Some(session_id.clone());
    }
    active.clear();
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
    let state = app
        .try_state::<TerminalSessionState>()
        .ok_or_else(|| "terminal session state missing".to_string())?;
    if let Ok(guard) = state.current.lock() {
        if let Some(current) = guard.as_ref() {
            if current != &session_id {
                return Err("terminal session_id mismatch".to_string());
            }
        }
    }
    let active = state.active.lock().map_err(|_| "terminal session lock".to_string())?;
    if !active.contains(&session_id) {
        return Err("terminal session not started".to_string());
    }
    drop(active);
    let state = app.state::<WorkerState>();
    let mut process = state.process.lock().map_err(|_| "worker lock".to_string())?;
    process
        .send_input(yurutsuku_protocol::SendInput { session_id, text })
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
    let state = app
        .try_state::<TerminalSessionState>()
        .ok_or_else(|| "terminal session state missing".to_string())?;
    if let Ok(guard) = state.current.lock() {
        if let Some(current) = guard.as_ref() {
            if current != &session_id {
                return Err("terminal session_id mismatch".to_string());
            }
        }
    }
    let active = state.active.lock().map_err(|_| "terminal session lock".to_string())?;
    if !active.contains(&session_id) {
        return Err("terminal session not started".to_string());
    }
    drop(active);
    let state = app.state::<WorkerState>();
    let mut process = state.process.lock().map_err(|_| "worker lock".to_string())?;
    process
        .send_resize(yurutsuku_protocol::Resize {
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
    let state = app
        .try_state::<TerminalSessionState>()
        .ok_or_else(|| "terminal session state missing".to_string())?;
    if let Ok(guard) = state.current.lock() {
        if let Some(current) = guard.as_ref() {
            if current != &session_id {
                return Ok(());
            }
        }
    }
    let mut active = state.active.lock().map_err(|_| "terminal session lock".to_string())?;
    if !active.remove(&session_id) {
        return Ok(());
    }
    if let Ok(mut guard) = state.current.lock() {
        *guard = None;
    }
    let state = app.state::<WorkerState>();
    let mut process = state.process.lock().map_err(|_| "worker lock".to_string())?;
    process
        .send_stop_session(yurutsuku_protocol::StopSession { session_id })
        .map_err(|err| err.to_string())?;
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
    let session_id = pick_existing_terminal_session_id(&app).unwrap_or(session_id);
    let _ = log_worker_event(&app, &format!("terminal window open requested: {session_id}"));
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
    window.emit("terminal-output", payload).map_err(|err| err.to_string())?;
    Ok(())
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
        "cmd.exe /C echo ok".to_string()
    } else {
        "sh -c echo ok".to_string()
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
    let mut process = state.process.lock().map_err(|_| "worker lock".to_string())?;
    process
        .send_start_session(yurutsuku_protocol::StartSession {
            session_id: session_id.clone(),
            cmd,
            cwd: None,
            env: None,
            cols: 120,
            rows: 30,
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
    let mut groups: Vec<Vec<tauri::WebviewWindow<R>>> =
        (0..monitors.len()).map(|_| Vec::new()).collect();
    for window in windows {
        let index = monitor_index_for_window(&window, &monitors);
        if let Some(group) = groups.get_mut(index) {
            group.push(window);
        }
    }

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
            let _ = window.unmaximize();
            let _ = window.set_position(Position::Physical(PhysicalPosition::new(x, y)));
            let _ = window.set_size(Size::Physical(PhysicalSize::new(target_width, target_height)));
            let _ = window.show();
            let _ = window.set_focus();
        }
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
    let mut groups: Vec<Vec<tauri::WebviewWindow<R>>> =
        (0..monitors.len()).map(|_| Vec::new()).collect();
    for window in windows {
        let index = monitor_index_for_window(&window, &monitors);
        if let Some(group) = groups.get_mut(index) {
            group.push(window);
        }
    }
    for group in &mut groups {
        group.sort_by_key(|window| window.label().to_string());
    }

    let selected_label = app
        .state::<SelectionState>()
        .current
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    let mut focused_group = None;
    let mut focused_index = None;
    for (group_index, group) in groups.iter().enumerate() {
        if let Some(index) = group
            .iter()
            .position(|window| window.is_focused().unwrap_or(false))
        {
            focused_group = Some(group_index);
            focused_index = Some(index);
            break;
        }
    }

    let mut selected_group = None;
    let mut selected_index = None;
    if let Some(label) = selected_label {
        for (group_index, group) in groups.iter().enumerate() {
            if let Some(index) = group.iter().position(|window| window.label() == label) {
                selected_group = Some(group_index);
                selected_index = Some(index);
                break;
            }
        }
    }

    let find_next_group = |start: usize, step: i32| -> Option<usize> {
        if groups.is_empty() {
            return None;
        }
        for offset in 1..=groups.len() {
            let mut next = start as i32 + (step * offset as i32);
            let len = groups.len() as i32;
            if next < 0 {
                next += len;
            }
            let next = (next % len) as usize;
            if !groups[next].is_empty() {
                return Some(next);
            }
        }
        None
    };

    let step = if direction.as_deref() == Some("prev") { -1 } else { 1 };
    let (target_group, target_index) = match (selected_group, selected_index) {
        (Some(group_index), Some(index)) => {
            let group = &groups[group_index];
            if step > 0 {
                if index + 1 < group.len() {
                    (group_index, index + 1)
                } else if let Some(next_group) = find_next_group(group_index, step) {
                    (next_group, 0)
                } else {
                    (group_index, index)
                }
            } else if index > 0 {
                (group_index, index - 1)
            } else if let Some(prev_group) = find_next_group(group_index, step) {
                let last_index = groups[prev_group].len().saturating_sub(1);
                (prev_group, last_index)
            } else {
                (group_index, index)
            }
        }
        _ => match (focused_group, focused_index) {
            (Some(group_index), Some(index)) => (group_index, index),
            _ => {
                let first_group = groups.iter().position(|group| !group.is_empty());
                if let Some(group_index) = first_group {
                    (group_index, 0)
                } else {
                    return Ok(());
                }
            }
        },
    };

    if let Some(window) = groups
        .get(target_group)
        .and_then(|group| group.get(target_index))
    {
        let _ = pickup_terminal_window_handle(&app, window);
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

    let url = format!("index.html?{query}");
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .build()?;
    Ok(())
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let menu = Menu::new(app)?;
    let open_chat = MenuItem::with_id(app, "open_chat", "Open Chat", true, None::<&str>)?;
    let open_run = MenuItem::with_id(app, "open_run", "Open Run", true, None::<&str>)?;
    let open_settings =
        MenuItem::with_id(app, "open_settings", "Open Settings", true, None::<&str>)?;
    let open_terminal =
        MenuItem::with_id(app, "open_terminal", "Open Terminal Window", true, None::<&str>)?;
    let arrange_terminals = MenuItem::with_id(
        app,
        "arrange_terminals",
        "Arrange Terminal Windows",
        true,
        None::<&str>,
    )?;
    let worker_start =
        MenuItem::with_id(app, "worker_start", "Start Worker Session", true, None::<&str>)?;
    let worker_send_sample =
        MenuItem::with_id(app, "worker_send_sample", "Send Sample Input", true, None::<&str>)?;
    let worker_stop =
        MenuItem::with_id(app, "worker_stop", "Stop Worker Session", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    menu.append(&open_chat)?;
    menu.append(&open_run)?;
    menu.append(&open_settings)?;
    menu.append(&open_terminal)?;
    menu.append(&arrange_terminals)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&worker_start)?;
    menu.append(&worker_send_sample)?;
    menu.append(&worker_stop)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&quit)?;

    let mut tray = TrayIconBuilder::<R>::with_id("main")
        .menu(&menu)
        .tooltip("yurutsuku")
        .on_menu_event(|app, event| match event.id() {
            id if id == "open_chat" => {
                let _ = create_window(app, WINDOW_CHAT, "Chat", "chat");
                if let Some(window) = app.get_webview_window(WINDOW_CHAT) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            id if id == "open_run" => {
                let _ = create_window(app, WINDOW_RUN, "Run", "run");
                if let Some(window) = app.get_webview_window(WINDOW_RUN) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            id if id == "open_settings" => {
                let _ = create_window(app, WINDOW_SETTINGS, "Settings", "settings");
                if let Some(window) = app.get_webview_window(WINDOW_SETTINGS) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            id if id == "open_terminal" => {
                // Reuse existing session if worker is already running. / Workerが単一セッション前提のため既存を再利用
                let session_id =
                    pick_existing_terminal_session_id(app).unwrap_or_else(generate_terminal_session_id);
                let _ = open_terminal_window_inner(app.clone(), session_id);
            }
            id if id == "arrange_terminals" => {
                let _ = arrange_terminal_windows_inner(app.clone());
            }
            id if id == "worker_start" => {
                if let Err(err) = start_worker_session(app) {
                    let _ = log_worker_event(app, &format!("start_session failed: {err}"));
                    println!("[worker] start_session failed: {err}");
                }
            }
            id if id == "worker_send_sample" => {
                if let Err(err) = send_sample_input(app) {
                    let _ = log_worker_event(app, &format!("send_input failed: {err}"));
                    println!("[worker] send_input failed: {err}");
                }
            }
            id if id == "worker_stop" => {
                if let Err(err) = stop_worker_session(app) {
                    let _ = log_worker_event(app, &format!("stop_session failed: {err}"));
                    println!("[worker] stop_session failed: {err}");
                }
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

fn start_worker_reader<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        use std::collections::HashMap;

        #[derive(Debug)]
        struct PendingOutput {
            queued_at: Instant,
            bytes: usize,
            chunks: Vec<String>,
        }

        // Terminal output coalescing defaults / ターミナル出力合体の既定値
        const OUTPUT_BUSY_THRESHOLD_BYTES: usize = 256 * 1024;
        const OUTPUT_FLUSH_DELAY_NORMAL: Duration = Duration::from_millis(16);
        const OUTPUT_FLUSH_BYTES_NORMAL: usize = 64 * 1024;
        const OUTPUT_FLUSH_DELAY_BUSY: Duration = Duration::from_millis(32);
        const OUTPUT_FLUSH_BYTES_BUSY: usize = 128 * 1024;

        let debug_io = std::env::var_os("YURUTSUKU_DEBUG_WORKER_IO").is_some();
        let enable_broadcast =
            std::env::var_os("YURUTSUKU_ENABLE_TERMINAL_OUTPUT_BROADCAST").is_some();
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
                                &format!("output received: session={session_id} stream={stream} size={}", chunk.len()),
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
                    notify_smoke_error(
                        &app,
                        &exit.session_id,
                        &format!("exit before token: {}", exit.exit_code),
                    );
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
                        let mut active = state.active.lock().ok();
                        if let Some(active) = active.as_mut() {
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
                    let _ =
                        log_worker_event(&app, &format!("error {}: {}", error.session_id, error.message));
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
                if entry.bytes >= flush_bytes || now.duration_since(entry.queued_at) >= flush_delay {
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
    process.send_start_session(yurutsuku_protocol::StartSession {
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
    process.send_input(yurutsuku_protocol::SendInput {
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
    process.send_stop_session(yurutsuku_protocol::StopSession { session_id })?;
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
            handle.manage(TerminalSessionState {
                current: Mutex::new(None),
                active: Mutex::new(HashSet::new()),
                labels: Mutex::new(HashMap::new()),
            });
            handle.manage(TerminalSmokeState {
                waiters: Mutex::new(HashMap::new()),
            });
            start_worker_reader(handle.clone());
            if should_start_hidden() {
                if let Some(window) = handle.get_webview_window(WINDOW_CHAT) {
                    let _ = window.hide();
                }
            }

            let path = settings_path(handle);
            let settings = read_settings(&path)?;
            write_settings(&path, &settings)?;

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
        path.push(format!("yurutsuku-{name}-{nonce}.json"));
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
