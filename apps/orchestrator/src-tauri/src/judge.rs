use regex::RegexSet;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JudgeState {
    Success,
    Failure,
    NeedInput,
}

pub struct JudgeConfig {
    silence_timeout_ms: u64,
    regex_set: RegexSet,
}

pub struct JudgeInput<'a> {
    pub exit_code: Option<i32>,
    pub tail_lines: &'a [String],
    pub last_output_at: Option<SystemTime>,
    pub now: SystemTime,
}

impl JudgeConfig {
    pub fn new(patterns: &[&str], silence_timeout_ms: u64) -> Result<Self, regex::Error> {
        Ok(Self {
            silence_timeout_ms,
            regex_set: RegexSet::new(patterns)?,
        })
    }

    pub fn default_patterns() -> &'static [&'static str] {
        &[
            r"(?i)\b(error|failed|panic|exception)\b",
            r"(?i)\b(traceback|fatal)\b",
        ]
    }
}

impl Default for JudgeConfig {
    fn default() -> Self {
        Self {
            silence_timeout_ms: 3500,
            regex_set: RegexSet::new(Self::default_patterns())
                .expect("default regex patterns"),
        }
    }
}

pub fn evaluate(config: &JudgeConfig, input: &JudgeInput<'_>) -> Option<JudgeState> {
    if let Some(code) = input.exit_code {
        if code == 0 {
            return Some(JudgeState::Success);
        }
        return Some(JudgeState::Failure);
    }

    if is_silence_timeout(input.last_output_at, input.now, config.silence_timeout_ms) {
        return Some(JudgeState::NeedInput);
    }

    let haystack = input.tail_lines.join("\n");
    if !haystack.is_empty() && config.regex_set.is_match(&haystack) {
        return Some(JudgeState::Failure);
    }

    None
}

fn is_silence_timeout(
    last_output_at: Option<SystemTime>,
    now: SystemTime,
    silence_timeout_ms: u64,
) -> bool {
    let last_output_at = match last_output_at {
        Some(time) => time,
        None => return false,
    };
    let elapsed = match now.duration_since(last_output_at) {
        Ok(duration) => duration,
        Err(_) => return false,
    };
    elapsed >= Duration::from_millis(silence_timeout_ms)
}

pub fn summarize_tail(lines: &[String], max_lines: usize) -> Vec<String> {
    if max_lines == 0 {
        return Vec::new();
    }
    let mut collected = Vec::new();
    for line in lines.iter().rev() {
        if line.trim().is_empty() {
            continue;
        }
        collected.push(line.clone());
        if collected.len() >= max_lines {
            break;
        }
    }
    collected.reverse();
    collected
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn judge_exit() {
        let config = JudgeConfig::default();
        let now = SystemTime::now();
        let input = JudgeInput {
            exit_code: Some(0),
            tail_lines: &[],
            last_output_at: None,
            now,
        };
        assert_eq!(evaluate(&config, &input), Some(JudgeState::Success));

        let input = JudgeInput {
            exit_code: Some(2),
            tail_lines: &[],
            last_output_at: None,
            now,
        };
        assert_eq!(evaluate(&config, &input), Some(JudgeState::Failure));
    }

    #[test]
    fn judge_regex() {
        let config = JudgeConfig::default();
        let now = SystemTime::now();
        let lines = vec!["all good".to_string(), "panic: boom".to_string()];
        let input = JudgeInput {
            exit_code: None,
            tail_lines: &lines,
            last_output_at: None,
            now,
        };
        assert_eq!(evaluate(&config, &input), Some(JudgeState::Failure));
    }

    #[test]
    fn judge_silence() {
        let config = JudgeConfig::new(&["nevermatch"], 3500).expect("config");
        let now = SystemTime::now();
        let input = JudgeInput {
            exit_code: None,
            tail_lines: &[],
            last_output_at: Some(now - Duration::from_millis(4000)),
            now,
        };
        assert_eq!(evaluate(&config, &input), Some(JudgeState::NeedInput));
    }

    #[test]
    fn summary_tail() {
        let lines = vec![
            "first".to_string(),
            "".to_string(),
            "second".to_string(),
            "third".to_string(),
        ];
        let summary = summarize_tail(&lines, 2);
        assert_eq!(summary, vec!["second".to_string(), "third".to_string()]);
    }
}
