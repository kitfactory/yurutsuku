use fantoccini::{Client, ClientBuilder, Locator};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::time::Duration;

fn app_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("target")
        .join("debug")
        .join("nagomi-orchestrator")
}

async fn connect() -> Result<Client, fantoccini::error::NewSessionError> {
    let mut caps = Map::<String, Value>::new();
    caps.insert(
        "tauri:options".to_string(),
        json!({
            "application": app_path(),
            "args": [],
        }),
    );
    ClientBuilder::native()
        .capabilities(caps)
        .connect("http://localhost:4444")
        .await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
#[ignore = "requires tauri-driver and msedgedriver running"]
async fn mode_switch_e2e() -> Result<(), Box<dyn std::error::Error>> {
    let client = connect().await?;

    let chat_main = client
        .find(Locator::Css("[data-role='chat-main']"))
        .await?;
    let chat_toolbar = client
        .find(Locator::Css("[data-role='chat-toolbar']"))
        .await?;
    let run_board = client
        .find(Locator::Css("[data-role='run-board']"))
        .await?;
    let run_chip = client
        .find(Locator::Css("[data-role='mode-chip'][data-mode='run']"))
        .await?;
    run_chip.click().await?;
    tokio::time::sleep(Duration::from_millis(200)).await;

    let chat_class = chat_main.attr("class").await?.unwrap_or_default();
    let toolbar_class = chat_toolbar.attr("class").await?.unwrap_or_default();
    let run_class = run_board.attr("class").await?.unwrap_or_default();
    assert!(chat_class.contains("hidden"));
    assert!(toolbar_class.contains("hidden"));
    assert!(!run_class.contains("hidden"));

    let chat_chip = client
        .find(Locator::Css("[data-role='mode-chip'][data-mode='chat']"))
        .await?;
    chat_chip.click().await?;
    tokio::time::sleep(Duration::from_millis(200)).await;

    let chat_class = chat_main.attr("class").await?.unwrap_or_default();
    let toolbar_class = chat_toolbar.attr("class").await?.unwrap_or_default();
    let run_class = run_board.attr("class").await?.unwrap_or_default();
    assert!(!chat_class.contains("hidden"));
    assert!(!toolbar_class.contains("hidden"));
    assert!(run_class.contains("hidden"));

    let phase_button = client
        .find(Locator::Css("[data-role='phase-button'][data-phase='success']"))
        .await?;
    phase_button.click().await?;
    tokio::time::sleep(Duration::from_millis(100)).await;

    let phase = client
        .find(Locator::Css("[data-role='character-phase']"))
        .await?;
    let phase_text = phase.text().await?;
    assert_eq!(phase_text, "success");

    client.close().await?;
    Ok(())
}
