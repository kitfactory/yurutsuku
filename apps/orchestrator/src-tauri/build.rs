fn main() {
    // Ensure the frontend assets are re-embedded when they change.
    // フロントエンド資産が変更されたときに再埋め込みされるようにする。
    println!("cargo:rerun-if-changed=../src");
    tauri_build::build()
}
