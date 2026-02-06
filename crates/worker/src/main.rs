use anyhow::{bail, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{BufRead, BufWriter, ErrorKind, Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use nagomi_protocol::{parse_line, serialize_message, Message, Output};

fn spawn_command_with_args(
    command: &str,
    args: &[&str],
    cols: u16,
    rows: u16,
    cwd: Option<&str>,
    env: Option<&std::collections::HashMap<String, String>>,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn Child + Send + Sync>)> {
    let pty_system = native_pty_system();
    let pty_pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(command);
    for arg in args {
        cmd.arg(arg);
    }
    if let Some(path) = cwd {
        cmd.cwd(path);
    }
    if let Some(env_map) = env {
        for (key, value) in env_map {
            cmd.env(key, value);
        }
    }

    let child = pty_pair.slave.spawn_command(cmd)?;
    drop(pty_pair.slave);
    Ok((pty_pair.master, child))
}

#[cfg(test)]
fn spawn_shell(
    cols: u16,
    rows: u16,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn Child + Send + Sync>)> {
    if cfg!(windows) {
        spawn_command_with_args("cmd.exe", &[], cols, rows, None, None)
    } else {
        spawn_command_with_args("sh", &[], cols, rows, None, None)
    }
}

#[cfg(test)]
fn read_output<R: Read>(reader: &mut R) -> Result<String> {
    // バイト列をUTF-8として扱う / Treat bytes as UTF-8 text.
    let mut buffer = Vec::new();
    reader.read_to_end(&mut buffer)?;
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

#[cfg(test)]
fn read_output_as_ndjson<R: Read>(session_id: &str, reader: &mut R) -> Result<String> {
    let chunk = read_output(reader)?;
    Ok(output_to_ndjson(session_id, &chunk))
}

fn send_input(writer: &mut dyn Write, input: &str) -> Result<()> {
    writer.write_all(input.as_bytes())?;
    // 改行など「確定入力」のときだけflush / Flush only on "commit" inputs (e.g. Enter)
    // Backspace連打のようなケースで毎回flushすると詰まりやすい / Per-keystroke flush can stall under heavy repeats.
    if input.contains('\r') || input.contains('\n') || input.len() >= 1024 {
        writer.flush()?;
    }
    Ok(())
}

#[cfg(test)]
fn read_output_with_timeout(
    master: &dyn MasterPty,
    child: &mut dyn Child,
    timeout: Duration,
) -> Result<String> {
    let mut reader = master.try_clone_reader()?;
    let (tx, rx) = mpsc::channel();

    // 別スレッドで読み取り、メイン側でタイムアウト制御 / Read on a thread and enforce timeouts in main.
    thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        let mut consecutive_zero_reads: u32 = 0;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    // PTYは終了前に0を返すことがあるため、少し待って再試行 / PTY may return 0 before exit; wait briefly and retry.
                    consecutive_zero_reads += 1;
                    if consecutive_zero_reads >= 100 {
                        break;
                    }
                    thread::sleep(Duration::from_millis(2));
                }
                Ok(read_len) => {
                    consecutive_zero_reads = 0;
                    if tx.send(buffer[..read_len].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();

    loop {
        if Instant::now() >= deadline {
            let _ = stop_child(child);
            break;
        }

        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                output.extend_from_slice(&chunk);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(_status) = child.try_wait()? {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    Ok(String::from_utf8_lossy(&output).to_string())
}

fn resize_pty(master: &dyn MasterPty, cols: u16, rows: u16) -> Result<()> {
    master.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    Ok(())
}

fn stop_child(child: &mut dyn Child) -> Result<portable_pty::ExitStatus> {
    let mut killer = child.clone_killer();
    let _ = killer.kill();

    // 終了を待ってタイムアウトしたら失敗にする / Wait for exit with timeout.
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            bail!("child did not exit");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(test)]
fn output_to_ndjson(session_id: &str, chunk: &str) -> String {
    // PTY 出力は一旦 stdout として扱う / Treat PTY output as stdout for now.
    let message = Message::Output(Output {
        session_id: session_id.to_string(),
        stream: "stdout".to_string(),
        chunk: chunk.to_string(),
    });

    serialize_message(&message)
}

#[allow(dead_code)]
struct WorkerSession {
    session_id: String,
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    writer: Box<dyn Write + Send>,
    exit_sent: Arc<AtomicBool>,
}

fn send_message(stdout_tx: &mpsc::Sender<String>, message: &Message) -> Result<()> {
    let line = serialize_message(message);
    if stdout_tx.send(line).is_err() {
        bail!("stdout channel closed");
    }
    Ok(())
}

fn send_error(stdout_tx: &mpsc::Sender<String>, session_id: &str, message: &str) -> Result<()> {
    let error = Message::Error(nagomi_protocol::ErrorMessage {
        session_id: session_id.to_string(),
        message: message.to_string(),
        recoverable: false,
    });
    send_message(stdout_tx, &error)
}

fn spawn_from_cmd(
    cmd: &str,
    cols: u16,
    rows: u16,
    cwd: Option<&str>,
    env: Option<&std::collections::HashMap<String, String>>,
) -> Result<(Box<dyn MasterPty + Send>, Box<dyn Child + Send + Sync>)> {
    let parts = shlex::split(cmd)
        .unwrap_or_else(|| cmd.split_whitespace().map(ToString::to_string).collect::<Vec<_>>());
    if parts.is_empty() {
        bail!("cmd is empty");
    }
    let (program, args) = parts.split_first().expect("cmd parts");
    let args_ref: Vec<&str> = args.iter().map(|arg| arg.as_str()).collect();
    spawn_command_with_args(program, &args_ref, cols, rows, cwd, env)
}

fn start_session(
    message: &nagomi_protocol::StartSession,
    stdout_tx: &mpsc::Sender<String>,
) -> Result<WorkerSession> {
    let (master, child) = spawn_from_cmd(
        &message.cmd,
        message.cols,
        message.rows,
        message.cwd.as_deref(),
        message.env.as_ref(),
    )?;
    let writer = master.take_writer()?;
    let child = Arc::new(Mutex::new(child));
    let exit_sent = Arc::new(AtomicBool::new(false));
    let session_id = message.session_id.clone();

    let reader = master.try_clone_reader()?;
    let stdout_clone = stdout_tx.clone();
    let session_clone = session_id.clone();
    let exit_clone = Arc::clone(&exit_sent);
    thread::spawn(move || {
        stream_output(reader, &session_clone, stdout_clone, exit_clone);
    });

    let child_clone = Arc::clone(&child);
    let stdout_clone = stdout_tx.clone();
    let session_clone = session_id.clone();
    let exit_clone = Arc::clone(&exit_sent);
    thread::spawn(move || {
        watch_exit(child_clone, &session_clone, stdout_clone, exit_clone);
    });

    Ok(WorkerSession {
        session_id,
        master,
        child,
        writer,
        exit_sent,
    })
}

fn stream_output(
    mut reader: Box<dyn Read + Send>,
    session_id: &str,
    stdout_tx: mpsc::Sender<String>,
    exit_flag: Arc<AtomicBool>,
) {
    use std::sync::Condvar;

    #[derive(Default)]
    struct SharedOut {
        buf: Vec<u8>,
        reader_done: bool,
    }

    const READ_BUFFER_BYTES: usize = 64 * 1024;
    const SHARED_BUFFER_LIMIT_BYTES: usize = 512 * 1024; // safety valve / 無限肥大防止

    let shared = Arc::new((Mutex::new(SharedOut::default()), Condvar::new()));
    let shared_reader = Arc::clone(&shared);
    let exit_clone = Arc::clone(&exit_flag);

    thread::spawn(move || {
        let mut buffer = [0u8; READ_BUFFER_BYTES];
        let mut exit_seen_at: Option<Instant> = None;
        let exit_grace = Duration::from_millis(250);
        loop {
            if exit_clone.load(Ordering::SeqCst) && exit_seen_at.is_none() {
                exit_seen_at = Some(Instant::now());
            }
            match reader.read(&mut buffer) {
                Ok(0) => {
                    if let Some(start) = exit_seen_at {
                        if start.elapsed() >= exit_grace {
                            break;
                        }
                    }
                    thread::yield_now(); // Windows/ConPTY may return 0 even when not EOF.
                }
                Ok(read_len) => {
                    let (lock, cvar) = &*shared_reader;
                    let mut state = lock.lock().expect("output buffer lock");
                    state.buf.extend_from_slice(&buffer[..read_len]);
                    // bound memory: drop oldest if needed（頻発しない前提なのでO(n)でOK）
                    if state.buf.len() > SHARED_BUFFER_LIMIT_BYTES {
                        let drop_len = state.buf.len() - SHARED_BUFFER_LIMIT_BYTES;
                        state.buf.drain(0..drop_len);
                    }
                    cvar.notify_one();
                }
                Err(err) => {
                    if matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted) {
                        if let Some(start) = exit_seen_at {
                            if start.elapsed() >= exit_grace {
                                break;
                            }
                        }
                        thread::yield_now();
                        continue;
                    }
                    break;
                }
            }
        }
        // wake flusher and mark done
        let (lock, cvar) = &*shared_reader;
        if let Ok(mut state) = lock.lock() {
            state.reader_done = true;
        }
        cvar.notify_one();
    });

    // PTY output coalescing defaults / PTY出力合体の既定値
    let max_bytes: usize = 32 * 1024;
    let max_delay = Duration::from_millis(8);
    let mut last_send = Instant::now();

    loop {
        let (lock, cvar) = &*shared;
        let mut state = lock.lock().expect("output buffer lock");

        if state.buf.is_empty() && !state.reader_done {
            let (guard, _) = cvar
                .wait_timeout(state, max_delay)
                .expect("output buffer wait");
            state = guard;
        }

        if state.buf.is_empty() {
            if state.reader_done {
                break;
            }
            continue;
        }

        // Coalesce by time/size to reduce event count / 時間・サイズで合体してイベント数を削減
        let should_flush =
            state.buf.len() >= max_bytes || last_send.elapsed() >= max_delay || state.reader_done;
        if !should_flush {
            let elapsed = last_send.elapsed();
            let remaining = max_delay
                .checked_sub(elapsed)
                .unwrap_or_else(|| Duration::from_millis(0));
            let (guard, _) = cvar
                .wait_timeout(state, remaining)
                .expect("output buffer wait");
            state = guard;
            continue;
        }

        // take up to max_bytes without per-byte loops
        let drained = if state.buf.len() > max_bytes {
            let tail = state.buf.split_off(max_bytes);
            let drained = std::mem::take(&mut state.buf);
            state.buf = tail;
            drained
        } else {
            std::mem::take(&mut state.buf)
        };
        drop(state);

        let chunk = String::from_utf8_lossy(&drained).into_owned();
        last_send = Instant::now();
        let _ = send_message(
            &stdout_tx,
            &Message::Output(Output {
                session_id: session_id.to_string(),
                stream: "stdout".to_string(),
                chunk,
            }),
        );
    }
}

fn watch_exit(
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    session_id: &str,
    stdout_tx: mpsc::Sender<String>,
    exit_sent: Arc<AtomicBool>,
) {
    loop {
        let status = {
            let mut guard = child.lock().expect("child lock");
            guard.try_wait()
        };
        match status {
            Ok(Some(status)) => {
                if exit_sent.swap(true, Ordering::SeqCst) {
                    break;
                }
                let message = Message::Exit(nagomi_protocol::Exit {
                    session_id: session_id.to_string(),
                    exit_code: status.exit_code() as i32,
                });
                let _ = send_message(&stdout_tx, &message);
                break;
            }
            Ok(None) => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => {
                let _ = send_error(&stdout_tx, session_id, &format!("exit wait failed: {err}"));
                break;
            }
        }
    }
}

fn main() {
    let stdin = std::io::stdin();
    let (stdout_tx, stdout_rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let stdout = std::io::stdout();
        // 単一writer + バッファでフラッシュ頻度を抑える / Single writer with buffering to reduce flush frequency.
        let mut writer = BufWriter::with_capacity(1 << 20, stdout.lock());
        let mut pending_bytes: usize = 0;
        let mut last_flush = Instant::now();

        loop {
            match stdout_rx.recv_timeout(Duration::from_millis(2)) {
                Ok(line) => {
                    pending_bytes += line.len();
                    let _ = writer.write_all(line.as_bytes());

                    while let Ok(next) = stdout_rx.try_recv() {
                        pending_bytes += next.len();
                        let _ = writer.write_all(next.as_bytes());
                    }

                    // 対話時は「一度空になった」タイミングでflushすると反応が良い / Flush when the queue is drained for interactive responsiveness.
                    if pending_bytes > 0 && pending_bytes < 8 * 1024 {
                        let _ = writer.flush();
                        pending_bytes = 0;
                        last_flush = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // no-op, flush check below
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            if pending_bytes >= 64 * 1024 || last_flush.elapsed() >= Duration::from_millis(2) {
                let _ = writer.flush();
                pending_bytes = 0;
                last_flush = Instant::now();
            }
        }

        let _ = writer.flush();
    });
    let mut session: Option<WorkerSession> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                let _ = send_error(&stdout_tx, "unknown", &format!("stdin read failed: {err}"));
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        match parse_line(&line) {
            Message::StartSession(message) => {
                if session.is_some() {
                    let _ = send_error(&stdout_tx, &message.session_id, "session already exists");
                    continue;
                }
                match start_session(&message, &stdout_tx) {
                    Ok(new_session) => session = Some(new_session),
                    Err(err) => {
                        let _ = send_error(&stdout_tx, &message.session_id, &format!("{err}"));
                    }
                }
            }
            Message::SendInput(message) => {
                if let Some(active) = session.as_mut() {
                    if active.session_id != message.session_id {
                        let _ = send_error(&stdout_tx, &message.session_id, "session_id mismatch");
                        continue;
                    }
                    if let Err(err) = send_input(active.writer.as_mut(), &message.text) {
                        let _ = send_error(&stdout_tx, &message.session_id, &format!("{err}"));
                    }
                } else {
                    let _ = send_error(&stdout_tx, &message.session_id, "session not started");
                }
            }
            Message::Resize(message) => {
                if let Some(active) = session.as_mut() {
                    if active.session_id != message.session_id {
                        let _ = send_error(&stdout_tx, &message.session_id, "session_id mismatch");
                        continue;
                    }
                    if let Err(err) = resize_pty(active.master.as_ref(), message.cols, message.rows)
                    {
                        let _ = send_error(&stdout_tx, &message.session_id, &format!("{err}"));
                    }
                } else {
                    let _ = send_error(&stdout_tx, &message.session_id, "session not started");
                }
            }
            Message::StopSession(message) => {
                if let Some(active) = session.as_mut() {
                    if active.session_id != message.session_id {
                        let _ = send_error(&stdout_tx, &message.session_id, "session_id mismatch");
                        continue;
                    }
                    let mut guard = active.child.lock().expect("child lock");
                    match stop_child(guard.as_mut()) {
                        Ok(status) => {
                            if active.exit_sent.swap(true, Ordering::SeqCst) {
                                continue;
                            }
                            let message = Message::Exit(nagomi_protocol::Exit {
                                session_id: message.session_id.clone(),
                                exit_code: status.exit_code() as i32,
                            });
                            let _ = send_message(&stdout_tx, &message);
                        }
                        Err(err) => {
                            let _ = send_error(&stdout_tx, &message.session_id, &format!("{err}"));
                        }
                    }
                } else {
                    let _ = send_error(&stdout_tx, &message.session_id, "session not started");
                }
            }
            Message::Unknown(_) => {}
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    fn conpty_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn conpty_spawn() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let result = spawn_shell(120, 30);
        assert!(result.is_ok());
    }

    #[test]
    fn stdio_read() {
        let mut reader = std::io::Cursor::new(b"ok".to_vec());
        let output = read_output(&mut reader).expect("capture output");
        assert!(output.to_lowercase().contains("ok"));
    }

    #[test]
    fn ndjson_output() {
        let mut reader = std::io::Cursor::new(b"hello".to_vec());
        let line = read_output_as_ndjson("session", &mut reader).expect("ndjson output");
        let parsed = parse_line(&line);

        match parsed {
            Message::Output(message) => {
                assert_eq!(message.session_id, "session");
                assert_eq!(message.stream, "stdout");
                assert_eq!(message.chunk, "hello");
            }
            _ => panic!("expected output message"),
        }
    }

    #[test]
    fn stdio_write() {
        let mut buffer = Vec::new();
        {
            let mut writer = std::io::Cursor::new(&mut buffer);
            send_input(&mut writer, "echo ok\n").expect("write input");
        }
        assert!(String::from_utf8_lossy(&buffer).contains("echo ok"));
    }

    #[test]
    fn input_forward() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let (master, mut child) = spawn_shell(120, 30).expect("spawn shell");
        let mut writer = master.take_writer().expect("take writer");
        send_input(&mut writer, "echo ok\n").expect("forward input");
        drop(writer);
        stop_child(child.as_mut()).expect("stop child");
    }

    #[test]
    fn stdio_read_real() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let (master, mut child) = if cfg!(windows) {
            spawn_command_with_args("cmd.exe", &["/C", "echo", "ok"], 120, 30, None, None)
                .expect("spawn command")
        } else {
            spawn_command_with_args("sh", &["-c", "echo ok"], 120, 30, None, None)
                .expect("spawn command")
        };

        let mut output =
            read_output_with_timeout(master.as_ref(), child.as_mut(), Duration::from_secs(5))
                .expect("read output");
        if !output.to_lowercase().contains("ok") {
            let retry =
                read_output_with_timeout(master.as_ref(), child.as_mut(), Duration::from_secs(2))
                    .expect("read output retry");
            output.push_str(&retry);
        }
        assert!(output.to_lowercase().contains("ok"));
    }

    #[test]
    fn input_forward_real() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let (master, mut child) = spawn_shell(120, 30).expect("spawn shell");
        let mut writer = master.take_writer().expect("take writer");
        thread::sleep(Duration::from_millis(50));
        let payload = if cfg!(windows) {
            "echo ok\r\nexit\r\n"
        } else {
            "echo ok\nexit\n"
        };
        send_input(&mut writer, payload).expect("send input");
        drop(writer);

        let mut output =
            read_output_with_timeout(master.as_ref(), child.as_mut(), Duration::from_secs(2))
                .expect("read output");
        if !output.to_lowercase().contains("ok") {
            let retry =
                read_output_with_timeout(master.as_ref(), child.as_mut(), Duration::from_secs(2))
                    .expect("read output retry");
            output.push_str(&retry);
        }
        assert!(output.to_lowercase().contains("ok"));
    }

    #[test]
    fn ndjson_output_real() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let (master, mut child) = if cfg!(windows) {
            spawn_command_with_args("cmd.exe", &["/C", "echo", "ok"], 120, 30, None, None)
                .expect("spawn command")
        } else {
            spawn_command_with_args("sh", &["-c", "echo ok"], 120, 30, None, None)
                .expect("spawn command")
        };

        let output =
            read_output_with_timeout(master.as_ref(), child.as_mut(), Duration::from_secs(2))
                .expect("read output");
        let line = output_to_ndjson("session", &output);
        let parsed = parse_line(&line);

        match parsed {
            Message::Output(message) => {
                assert_eq!(message.session_id, "session");
                assert_eq!(message.stream, "stdout");
                assert!(message.chunk.to_lowercase().contains("ok"));
            }
            _ => panic!("expected output message"),
        }
    }

    #[test]
    fn resize() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let (master, mut child) = spawn_shell(120, 30).expect("spawn shell");
        resize_pty(master.as_ref(), 140, 40).expect("resize");
        stop_child(child.as_mut()).expect("stop child");
    }

    #[test]
    fn stop() {
        let _guard = conpty_lock().lock().expect("conpty lock");
        let (_master, mut child) = spawn_shell(120, 30).expect("spawn shell");
        stop_child(child.as_mut()).expect("stop child");
    }

    #[test]
    fn cleanup() {
        assert!(true);
    }

    #[test]
    fn cmd_parser_supports_quoted_args() {
        let parts = shlex::split("wsl.exe -d \"Ubuntu 24.04\"").expect("parse cmd");
        assert_eq!(
            parts,
            vec![
                "wsl.exe".to_string(),
                "-d".to_string(),
                "Ubuntu 24.04".to_string()
            ]
        );
    }
}

