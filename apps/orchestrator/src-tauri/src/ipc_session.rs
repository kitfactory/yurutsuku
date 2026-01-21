use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

static IPC_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
struct IpcSession {
    client_epoch: u64,
    window_label: String,
    created_ms: u64,
    last_seen_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcSessionSnapshot {
    session_id: String,
    client_epoch: u64,
    server_epoch: u64,
    phase: IpcSessionPhase,
    window_label: String,
    created_ms: u64,
    last_seen_ms: u64,
    active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcEchoResponse {
    session_id: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcSessionPhase {
    Ready,
    Closed,
}

pub struct IpcSessionState {
    server_epoch: u64,
    sessions: Mutex<HashMap<String, IpcSession>>,
}

pub fn init_ipc_session_state<R: Runtime>(app: &AppHandle<R>) {
    let server_epoch = now_ms();
    app.manage(IpcSessionState {
        server_epoch,
        sessions: Mutex::new(HashMap::new()),
    });
}

pub fn touch_ipc_session<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
) -> Result<(), String> {
    ensure_ipc_session(app, session_id, None)
}

pub fn touch_ipc_session_for_window<R: Runtime>(
    window: &WebviewWindow<R>,
    session_id: &str,
) -> Result<(), String> {
    let label = window.label().to_string();
    let app = window.app_handle();
    ensure_ipc_session(app, session_id, Some(&label))
}

#[tauri::command]
pub fn ipc_session_open<R: Runtime>(
    window: WebviewWindow<R>,
    client_epoch: u64,
) -> Result<IpcSessionSnapshot, String> {
    let label = window.label().to_string();
    let state = window
        .app_handle()
        .try_state::<IpcSessionState>()
        .ok_or_else(|| "ipc session state missing".to_string())?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "ipc session lock".to_string())?;
    sessions.retain(|_, session| session.window_label != label);

    let now = now_ms();
    let counter = IPC_SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let session_id = format!("ipc-{now}-{counter}");
    let session = IpcSession {
        client_epoch,
        window_label: label.clone(),
        created_ms: now,
        last_seen_ms: now,
    };
    sessions.insert(session_id.clone(), session.clone());

    Ok(IpcSessionSnapshot {
        session_id,
        client_epoch,
        server_epoch: state.server_epoch,
        phase: IpcSessionPhase::Ready,
        window_label: label,
        created_ms: session.created_ms,
        last_seen_ms: session.last_seen_ms,
        active: true,
    })
}

#[tauri::command]
pub fn ipc_session_probe<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<IpcSessionSnapshot, String> {
    let state = app
        .try_state::<IpcSessionState>()
        .ok_or_else(|| "ipc session state missing".to_string())?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "ipc session lock".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "ipc session not found".to_string())?;
    session.last_seen_ms = now_ms();
    Ok(IpcSessionSnapshot {
        session_id,
        client_epoch: session.client_epoch,
        server_epoch: state.server_epoch,
        phase: IpcSessionPhase::Ready,
        window_label: session.window_label.clone(),
        created_ms: session.created_ms,
        last_seen_ms: session.last_seen_ms,
        active: true,
    })
}

#[tauri::command]
pub fn ipc_session_echo<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    message: String,
) -> Result<IpcEchoResponse, String> {
    let state = app
        .try_state::<IpcSessionState>()
        .ok_or_else(|| "ipc session state missing".to_string())?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "ipc session lock".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "ipc session not found".to_string())?;
    session.last_seen_ms = now_ms();
    Ok(IpcEchoResponse { session_id, message })
}

#[tauri::command]
pub fn ipc_session_close<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
) -> Result<IpcSessionSnapshot, String> {
    let state = app
        .try_state::<IpcSessionState>()
        .ok_or_else(|| "ipc session state missing".to_string())?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "ipc session lock".to_string())?;
    let session = sessions
        .remove(&session_id)
        .ok_or_else(|| "ipc session not found".to_string())?;
    Ok(IpcSessionSnapshot {
        session_id,
        client_epoch: session.client_epoch,
        server_epoch: state.server_epoch,
        phase: IpcSessionPhase::Closed,
        window_label: session.window_label,
        created_ms: session.created_ms,
        last_seen_ms: now_ms(),
        active: false,
    })
}

fn ensure_ipc_session<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    expected_label: Option<&str>,
) -> Result<(), String> {
    let state = app
        .try_state::<IpcSessionState>()
        .ok_or_else(|| "ipc session state missing".to_string())?;
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "ipc session lock".to_string())?;
    let session = sessions
        .get_mut(session_id)
        .ok_or_else(|| "ipc session not found".to_string())?;
    if let Some(label) = expected_label {
        if session.window_label != label {
            return Err("ipc session window mismatch".to_string());
        }
    }
    session.last_seen_ms = now_ms();
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
