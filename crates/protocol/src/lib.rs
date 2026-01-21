use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StartSession {
    pub session_id: String,
    pub cmd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SendInput {
    pub session_id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Resize {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StopSession {
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Output {
    pub session_id: String,
    pub stream: String,
    pub chunk: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Exit {
    pub session_id: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorMessage {
    pub session_id: String,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    StartSession(StartSession),
    SendInput(SendInput),
    Resize(Resize),
    StopSession(StopSession),
    Output(Output),
    Exit(Exit),
    Error(ErrorMessage),
    Unknown(Value),
}

fn with_type(value: Value, msg_type: &str) -> Value {
    let mut value = value;
    if let Value::Object(ref mut map) = value {
        map.insert("type".to_string(), Value::String(msg_type.to_string()));
    }
    value
}

pub fn parse_line(line: &str) -> Message {
    let trimmed = line.trim_end();
    let value: Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(_) => return Message::Unknown(Value::String(trimmed.to_string())),
    };

    let msg_type = value
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");

    match msg_type {
        "start_session" => serde_json::from_value::<StartSession>(value.clone())
            .map(Message::StartSession)
            .unwrap_or(Message::Unknown(value)),
        "send_input" => serde_json::from_value::<SendInput>(value.clone())
            .map(Message::SendInput)
            .unwrap_or(Message::Unknown(value)),
        "resize" => serde_json::from_value::<Resize>(value.clone())
            .map(Message::Resize)
            .unwrap_or(Message::Unknown(value)),
        "stop_session" => serde_json::from_value::<StopSession>(value.clone())
            .map(Message::StopSession)
            .unwrap_or(Message::Unknown(value)),
        "output" => serde_json::from_value::<Output>(value.clone())
            .map(Message::Output)
            .unwrap_or(Message::Unknown(value)),
        "exit" => serde_json::from_value::<Exit>(value.clone())
            .map(Message::Exit)
            .unwrap_or(Message::Unknown(value)),
        "error" => serde_json::from_value::<ErrorMessage>(value.clone())
            .map(Message::Error)
            .unwrap_or(Message::Unknown(value)),
        _ => Message::Unknown(value),
    }
}

pub fn serialize_message(message: &Message) -> String {
    let value = match message {
        Message::StartSession(message) => with_type(serde_json::to_value(message).unwrap(), "start_session"),
        Message::SendInput(message) => with_type(serde_json::to_value(message).unwrap(), "send_input"),
        Message::Resize(message) => with_type(serde_json::to_value(message).unwrap(), "resize"),
        Message::StopSession(message) => with_type(serde_json::to_value(message).unwrap(), "stop_session"),
        Message::Output(message) => with_type(serde_json::to_value(message).unwrap(), "output"),
        Message::Exit(message) => with_type(serde_json::to_value(message).unwrap(), "exit"),
        Message::Error(message) => with_type(serde_json::to_value(message).unwrap(), "error"),
        Message::Unknown(value) => value.clone(),
    };

    let mut line = serde_json::to_string(&value).unwrap_or_else(|_| "{\"type\":\"unknown\"}".to_string());
    line.push('\n');
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> Vec<Value> {
        let raw = include_str!("../../../testdata/protocol_fixtures.json");
        serde_json::from_str(raw).expect("fixtures should parse")
    }

    #[test]
    fn parse_known_messages() {
        for value in fixtures() {
            let line = serde_json::to_string(&value).expect("value to json");
            let parsed = parse_line(&line);
            let msg_type = value
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("");

            match msg_type {
                "start_session" => {
                    let expected: StartSession = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::StartSession(expected));
                }
                "send_input" => {
                    let expected: SendInput = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::SendInput(expected));
                }
                "resize" => {
                    let expected: Resize = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::Resize(expected));
                }
                "stop_session" => {
                    let expected: StopSession = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::StopSession(expected));
                }
                "output" => {
                    let expected: Output = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::Output(expected));
                }
                "exit" => {
                    let expected: Exit = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::Exit(expected));
                }
                "error" => {
                    let expected: ErrorMessage = serde_json::from_value(value).unwrap();
                    assert_eq!(parsed, Message::Error(expected));
                }
                _ => panic!("unexpected fixture type"),
            }
        }
    }

    #[test]
    fn serialize_roundtrip() {
        let messages = vec![
            Message::StartSession(StartSession {
                session_id: "session".to_string(),
                cmd: "cmd.exe".to_string(),
                cwd: None,
                env: None,
                cols: 120,
                rows: 30,
            }),
            Message::SendInput(SendInput {
                session_id: "session".to_string(),
                text: "dir".to_string(),
            }),
            Message::Resize(Resize {
                session_id: "session".to_string(),
                cols: 100,
                rows: 40,
            }),
            Message::StopSession(StopSession {
                session_id: "session".to_string(),
            }),
            Message::Output(Output {
                session_id: "session".to_string(),
                stream: "stdout".to_string(),
                chunk: "hello".to_string(),
            }),
            Message::Exit(Exit {
                session_id: "session".to_string(),
                exit_code: 0,
            }),
            Message::Error(ErrorMessage {
                session_id: "session".to_string(),
                message: "fail".to_string(),
                recoverable: true,
            }),
        ];

        for message in messages {
            let line = serialize_message(&message);
            let parsed = parse_line(&line);
            assert_eq!(parsed, message);
        }
    }

    #[test]
    fn unknown_message_type() {
        let line = r#"{"type":"mystery","value":1}"#;
        let parsed = parse_line(line);
        assert!(matches!(parsed, Message::Unknown(_)));
    }
}
