use anyhow::{Context, Result};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use nagomi_protocol::{parse_line, serialize_message, Message, Resize, SendInput, StartSession, StopSession};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub struct WorkerProcess {
    child: Child,
    stdin: ChildStdin,
    rx: Option<mpsc::Receiver<Message>>,
}

impl WorkerProcess {
    pub fn spawn(worker_path: &Path) -> Result<Self> {
        let mut command = Command::new(worker_path);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            // 余分なコンソールウィンドウを出さない / Hide extra console window.
            const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW_FLAG);
        }
        let mut child = command.spawn().with_context(|| "spawn worker process")?;
        let stdin = child.stdin.take().context("worker stdin")?;
        let stdout = child.stdout.take().context("worker stdout")?;
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let _ = tx.send(parse_line(&line));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            rx: Some(rx),
        })
    }

    pub fn send_message(&mut self, message: &Message) -> Result<()> {
        let line = serialize_message(message);
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.flush()?;
        Ok(())
    }

    pub fn read_message_with_timeout(&self, timeout: Duration) -> Result<Option<Message>> {
        let Some(rx) = self.rx.as_ref() else {
            return Ok(None);
        };
        match rx.recv_timeout(timeout) {
            Ok(message) => Ok(Some(message)),
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            Err(mpsc::RecvTimeoutError::Disconnected) => Ok(None),
        }
    }

    pub fn take_receiver(&mut self) -> Option<mpsc::Receiver<Message>> {
        self.rx.take()
    }

    pub fn send_start_session(&mut self, message: StartSession) -> Result<()> {
        self.send_message(&Message::StartSession(message))
    }

    pub fn send_input(&mut self, message: SendInput) -> Result<()> {
        self.send_message(&Message::SendInput(message))
    }

    pub fn send_resize(&mut self, message: Resize) -> Result<()> {
        self.send_message(&Message::Resize(message))
    }

    pub fn send_stop_session(&mut self, message: StopSession) -> Result<()> {
        self.send_message(&Message::StopSession(message))
    }

    pub fn stop(&mut self) -> Result<()> {
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}

fn workspace_root() -> Option<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.ancestors().nth(3).map(|path| path.to_path_buf())
}

fn worker_exe_name() -> &'static str {
    if cfg!(windows) {
        "nagomi-worker.exe"
    } else {
        "nagomi-worker"
    }
}

#[allow(dead_code)]
pub fn resolve_worker_path() -> Result<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let candidate = dir.join(worker_exe_name());
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    if let Some(root) = workspace_root() {
        let candidate = root.join("target").join("debug").join(worker_exe_name());
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Ok(PathBuf::from(worker_exe_name()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};
    use nagomi_protocol::Output;

    fn build_worker_binary() -> Result<PathBuf> {
        static WORKER_PATH: OnceLock<PathBuf> = OnceLock::new();
        if let Some(path) = WORKER_PATH.get() {
            return Ok(path.clone());
        }
        let root = workspace_root().context("workspace root")?;
        let target = root.join("target").join("debug").join(worker_exe_name());
        let status = Command::new("cargo")
            .args(["build", "-p", "nagomi-worker"])
            .current_dir(&root)
            .status()
            .with_context(|| "build worker binary")?;
        if !status.success() {
            anyhow::bail!("failed to build worker binary");
        }
        if !target.exists() {
            anyhow::bail!("worker binary not found after build");
        }
        let _ = WORKER_PATH.set(target.clone());
        Ok(target)
    }

    fn start_worker() -> Result<WorkerProcess> {
        let path = build_worker_binary()?;
        WorkerProcess::spawn(&path)
    }

    fn wait_for_message(worker: &WorkerProcess, timeout: Duration) -> Option<Message> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if let Ok(Some(message)) = worker.read_message_with_timeout(Duration::from_millis(200))
            {
                return Some(message);
            }
        }
        None
    }

    #[test]
    fn worker_spawn_stdio_connect() {
        let mut worker = start_worker().expect("spawn worker");
        assert!(worker.child.id() > 0);
        worker.stop().expect("stop worker");
    }

    #[test]
    fn send_start_send_input_resize_stop() {
        let mut worker = start_worker().expect("spawn worker");
        let session_id = "session-send";
        let cmd = if cfg!(windows) { "cmd.exe" } else { "sh" };
        worker
            .send_start_session(StartSession {
                session_id: session_id.to_string(),
                cmd: cmd.to_string(),
                cwd: None,
                env: None,
                cols: 120,
                rows: 30,
            })
            .expect("start session");

        worker
            .send_resize(Resize {
                session_id: session_id.to_string(),
                cols: 140,
                rows: 40,
            })
            .expect("resize");

        let payload = if cfg!(windows) { "echo ok\r\n" } else { "echo ok\n" };
        worker
            .send_input(SendInput {
                session_id: session_id.to_string(),
                text: payload.to_string(),
            })
            .expect("send input");

        let mut saw_output = false;
        let mut saw_exit = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Some(message) = wait_for_message(&worker, Duration::from_millis(300)) {
                match message {
                    Message::Output(Output { chunk, .. }) => {
                        if chunk.to_lowercase().contains("ok") {
                            saw_output = true;
                        }
                    }
                    Message::Exit(_) => {
                        saw_exit = true;
                    }
                    _ => {}
                }
                if saw_output && saw_exit {
                    break;
                }
            }
        }

        assert!(saw_output);

        worker
            .send_stop_session(StopSession {
                session_id: session_id.to_string(),
            })
            .expect("stop session");

        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Some(message) = wait_for_message(&worker, Duration::from_millis(300)) {
                if matches!(message, Message::Exit(_)) {
                    saw_exit = true;
                    break;
                }
            }
        }

        assert!(saw_exit);
        worker.stop().expect("stop worker");
    }

    #[test]
    fn recv_output_exit_error() {
        let mut worker = start_worker().expect("spawn worker");
        let session_id = "session-output";
        let cmd = if cfg!(windows) {
            "cmd.exe /C echo ok"
        } else {
            "sh -c echo ok"
        };
        worker
            .send_start_session(StartSession {
                session_id: session_id.to_string(),
                cmd: cmd.to_string(),
                cwd: None,
                env: None,
                cols: 120,
                rows: 30,
            })
            .expect("start session");

        let mut saw_output = false;
        let mut saw_exit = false;
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Some(message) = wait_for_message(&worker, Duration::from_millis(300)) {
                match message {
                    Message::Output(Output { chunk, .. }) => {
                        if chunk.to_lowercase().contains("ok") {
                            saw_output = true;
                        }
                    }
                    Message::Exit(_) => {
                        saw_exit = true;
                    }
                    Message::Error(_) => {
                        break;
                    }
                    _ => {}
                }
                if saw_output && saw_exit {
                    break;
                }
            }
        }

        assert!(saw_output);
        assert!(saw_exit);
        worker.stop().expect("stop worker");
    }

    #[test]
    fn session_flow() {
        let mut worker = start_worker().expect("spawn worker");
        let session_id = "session-flow";
        let cmd = if cfg!(windows) { "cmd.exe" } else { "sh" };
        worker
            .send_start_session(StartSession {
                session_id: session_id.to_string(),
                cmd: cmd.to_string(),
                cwd: None,
                env: None,
                cols: 120,
                rows: 30,
            })
            .expect("start session");

        let payload = if cfg!(windows) {
            "echo ok\r\nexit\r\n"
        } else {
            "echo ok\nexit\n"
        };
        worker
            .send_input(SendInput {
                session_id: session_id.to_string(),
                text: payload.to_string(),
            })
            .expect("send input");

        let mut saw_output = false;
        let mut saw_exit = false;
        let deadline =
            Instant::now() + Duration::from_secs(if cfg!(windows) { 12 } else { 5 });
        while Instant::now() < deadline {
            if let Some(message) = wait_for_message(&worker, Duration::from_millis(300)) {
                match message {
                    Message::Output(Output { chunk, .. }) => {
                        if chunk.to_lowercase().contains("ok") {
                            saw_output = true;
                        }
                    }
                    Message::Exit(_) => {
                        saw_exit = true;
                    }
                    _ => {}
                }
                if saw_output && saw_exit {
                    break;
                }
            }
        }

        assert!(saw_output);
        assert!(saw_exit);
        worker.stop().expect("stop worker");
    }
}

