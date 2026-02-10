use anyhow::{Context, Result};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn env_u16(name: &str, default: u16) -> u16 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(default)
}

fn http_get(host: &str, port: u16, path: &str, timeout: Duration) -> Result<String> {
    let addr = format!("{host}:{port}");
    let mut stream = TcpStream::connect(&addr).with_context(|| format!("connect {addr}"))?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes())?;
    stream.flush()?;
    let mut buf = String::new();
    stream.read_to_string(&mut buf)?;
    Ok(buf)
}

fn is_healthy(port: u16) -> bool {
    http_get("127.0.0.1", port, "/health", Duration::from_millis(400))
        .map(|raw| raw.contains(r#""status":"ok""#))
        .unwrap_or(false)
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Walk up until we find a workspace root (Cargo.toml).
    // workspace root（Cargo.toml）を見つけるまで上位ディレクトリを辿る。
    for dir in manifest_dir.ancestors() {
        let candidate = dir.join("Cargo.toml");
        if candidate.exists() {
            return Some(dir.to_path_buf());
        }
    }
    None
}

fn orchestrator_exe_name() -> &'static str {
    if cfg!(windows) {
        "nagomi-orchestrator.exe"
    } else {
        "nagomi-orchestrator"
    }
}

fn resolve_orchestrator_path() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let candidate = dir.join(orchestrator_exe_name());
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    if let Some(root) = workspace_root() {
        let candidate = root
            .join("target")
            .join("debug")
            .join(orchestrator_exe_name());
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn spawn_orchestrator(path: &Path) -> Result<()> {
    let mut command = Command::new(path);
    command
        .arg("--start-hidden")
        .arg("--exit-on-last-terminal")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        // 余分なコンソールウィンドウを表示しない / Hide extra console window on Windows.
        const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
    command
        .spawn()
        .with_context(|| format!("spawn orchestrator: {}", path.display()))?;
    Ok(())
}

fn wait_health(port: u16, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if is_healthy(port) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    anyhow::bail!("timeout waiting for orchestrator health on port {port}");
}

fn main() -> Result<()> {
    let port = env_u16("NAGOMI_ORCH_HEALTH_PORT", 17707);

    let mut session_id: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--session-id" => session_id = args.next(),
            "--help" | "-h" => {
                println!("nagomi: start orchestrator and open a terminal window");
                println!("  --session-id <id>  Open terminal with a fixed session id");
                return Ok(());
            }
            _ => {}
        }
    }

    if !is_healthy(port) {
        let orchestrator_path = resolve_orchestrator_path()
            .or_else(|| Some(PathBuf::from(orchestrator_exe_name())))
            .context("resolve orchestrator path")?;
        spawn_orchestrator(&orchestrator_path)?;
        wait_health(port, Duration::from_secs(8))?;
    }

    let path = match session_id {
        Some(id) => format!("/open-terminal?session_id={id}"),
        None => "/open-terminal".to_string(),
    };
    let _ = http_get("127.0.0.1", port, &path, Duration::from_millis(800))?;
    Ok(())
}
