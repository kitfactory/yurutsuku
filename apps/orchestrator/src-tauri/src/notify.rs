use anyhow::Result;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;

use crate::judge::JudgeState;

pub trait ToastSink {
    fn show(&self, title: &str, body: &str) -> Result<()>;
}

pub trait AudioSink {
    fn play(&self, volume: f32) -> Result<()>;
}

pub struct SystemToastSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> SystemToastSink<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> ToastSink for SystemToastSink<R> {
    fn show(&self, title: &str, body: &str) -> Result<()> {
        self.app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()?;
        Ok(())
    }
}

pub struct SystemAudioSink;

impl AudioSink for SystemAudioSink {
    fn play(&self, _volume: f32) -> Result<()> {
        #[cfg(windows)]
        {
            // Windows の標準ビープを鳴らす / Play the default Windows beep.
            unsafe {
                windows_sys::Win32::System::Diagnostics::Debug::MessageBeep(0);
            }
        }
        Ok(())
    }
}

pub struct NotifyCooldown {
    last_sent: Mutex<Option<SystemTime>>,
    cooldown: Duration,
}

impl NotifyCooldown {
    pub fn new(cooldown_ms: u64) -> Self {
        Self {
            last_sent: Mutex::new(None),
            cooldown: Duration::from_millis(cooldown_ms),
        }
    }

    pub fn should_notify(&self, now: SystemTime) -> bool {
        let guard = self.last_sent.lock().expect("cooldown lock");
        match *guard {
            None => true,
            Some(last) => now.duration_since(last).map(|d| d >= self.cooldown).unwrap_or(false),
        }
    }

    pub fn mark_sent(&self, now: SystemTime) {
        let mut guard = self.last_sent.lock().expect("cooldown lock");
        *guard = Some(now);
    }
}

pub fn notify_toast<S: ToastSink>(sink: &S, title: &str, body: &str) -> Result<()> {
    sink.show(title, body)
}

pub fn notify_audio<S: AudioSink>(sink: &S, volume: f32) -> Result<()> {
    sink.play(volume)
}

pub struct NotifySettings {
    pub toast_enabled: bool,
    pub audio_enabled: bool,
    pub volume: f32,
}

pub fn notify_flow<T: ToastSink, A: AudioSink>(
    toast: &T,
    audio: &A,
    cooldown: &NotifyCooldown,
    now: SystemTime,
    state: JudgeState,
    summary: &str,
    settings: &NotifySettings,
) -> Result<bool> {
    if !matches!(state, JudgeState::Failure | JudgeState::NeedInput) {
        return Ok(false);
    }
    if !cooldown.should_notify(now) {
        return Ok(false);
    }

    let title = match state {
        JudgeState::Failure => "failure",
        JudgeState::Success => "success",
        JudgeState::NeedInput => "need_input",
    };
    let body = if summary.is_empty() { "no summary" } else { summary };

    if settings.toast_enabled {
        notify_toast(toast, title, body)?;
    }
    if settings.audio_enabled {
        notify_audio(audio, settings.volume)?;
    }
    cooldown.mark_sent(now);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockToast {
        calls: Mutex<Vec<(String, String)>>,
    }

    impl MockToast {
        fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl ToastSink for MockToast {
        fn show(&self, title: &str, body: &str) -> Result<()> {
            let mut guard = self.calls.lock().expect("toast lock");
            guard.push((title.to_string(), body.to_string()));
            Ok(())
        }
    }

    struct MockAudio {
        calls: Mutex<Vec<f32>>,
    }

    impl MockAudio {
        fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl AudioSink for MockAudio {
        fn play(&self, volume: f32) -> Result<()> {
            let mut guard = self.calls.lock().expect("audio lock");
            guard.push(volume);
            Ok(())
        }
    }

    #[test]
    fn notify_toast_works() {
        let sink = MockToast::new();
        notify_toast(&sink, "title", "body").expect("toast ok");
        let calls = sink.calls.lock().expect("toast lock");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "title");
        assert_eq!(calls[0].1, "body");
    }

    #[test]
    fn notify_audio_works() {
        let sink = MockAudio::new();
        notify_audio(&sink, 0.7).expect("audio ok");
        let calls = sink.calls.lock().expect("audio lock");
        assert_eq!(calls.len(), 1);
        assert!((calls[0] - 0.7).abs() < f32::EPSILON);
    }

    #[test]
    fn notify_cooldown() {
        let cooldown = NotifyCooldown::new(1500);
        let start = SystemTime::UNIX_EPOCH + Duration::from_millis(1000);
        let later = SystemTime::UNIX_EPOCH + Duration::from_millis(2000);
        let later_ok = SystemTime::UNIX_EPOCH + Duration::from_millis(2600);

        assert!(cooldown.should_notify(start));
        cooldown.mark_sent(start);
        assert!(!cooldown.should_notify(later));
        assert!(cooldown.should_notify(later_ok));
    }

    #[test]
    fn notify_flow_works() {
        let toast = MockToast::new();
        let audio = MockAudio::new();
        let cooldown = NotifyCooldown::new(1500);
        let settings = NotifySettings {
            toast_enabled: true,
            audio_enabled: true,
            volume: 0.6,
        };
        let now = SystemTime::UNIX_EPOCH + Duration::from_millis(1000);

        let sent = super::notify_flow(
            &toast,
            &audio,
            &cooldown,
            now,
            JudgeState::Failure,
            "summary",
            &settings,
        )
        .expect("notify flow ok");
        assert!(sent);
        assert_eq!(toast.calls.lock().expect("toast lock").len(), 1);
        assert_eq!(audio.calls.lock().expect("audio lock").len(), 1);

        let blocked = super::notify_flow(
            &toast,
            &audio,
            &cooldown,
            SystemTime::UNIX_EPOCH + Duration::from_millis(2000),
            JudgeState::NeedInput,
            "summary",
            &settings,
        )
        .expect("notify flow blocked");
        assert!(!blocked);
    }
}
