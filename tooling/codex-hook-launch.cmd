@echo off
codex.cmd -c "hooks.on_session_start=[{matcher=\"\",hooks=[{type=\"command\",command=\"powershell -NoProfile -File C:/Users/kitad/workspace/yurutsuku/tooling/codex-hook-test.ps1 SessionStart\"}]}]" --no-alt-screen
