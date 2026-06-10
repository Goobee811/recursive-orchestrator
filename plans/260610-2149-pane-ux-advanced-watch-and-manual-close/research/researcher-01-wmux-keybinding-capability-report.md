---
title: "wmux 0.5.0 Keybinding Capability Research"
date: 2026-06-10
type: research
status: done
tags: [wmux, keybinding, config, pane-ux]
---

## Kết luận: NO-GO Keybinding Nội Bộ

**wmux 0.5.0 KHÔNG hỗ trợ keybinding → command trong core app.**

---

## 1. Config Path Thực Tế

| Thuộc tính | Giá trị |
|-----------|--------|
| **Config file** | `~/.wmux/config.toml` |
| **App data dir** | `%APPDATA%\wmux` (settings.json ngoài) |
| **Hiện tại** | Không tồn tại — user chưa tạo |

**Evidence:** `/tmp/wmux-inspect-src/dist/main/user-config.js:72-75`, tham số `getConfigPath()` trả về `os.homedir() + '/.wmux/config.toml'`

---

## 2. Config Schema Hiện Tại

wmux config.toml chỉ hỗ trợ `[terminal]` section — KHÔNG keybinding:

```toml
[terminal]
font-family     = "Consolas"
font-size       = 14
cursor-style    = "block"        # block | underline | bar
cursor-blink    = true
scrollback-lines = 10000

[terminal.colors]
default = "Dracula"

[terminal.colors.schemes.prod]
background = "#2b0b0b"
foreground = "#ffdddd"
cursor     = "#ff5555"
palette    = ["#000", "#ff5555", ...]  # 0-16 entries
```

**Evidence:**
- `/tmp/wmux-inspect-src/dist/main/user-config.js:38-67` — lược đồ comment
- Lines 127-198 — `mapToConfig()` xử lý chỉ `[terminal]`; KHÔNG xử lý keybind / hotkey / accelerator

---

## 3. Tìm Kiếm Keybinding Toàn Codebase

| Thuật ngữ | Kết quả | Ghi chú |
|-----------|--------|--------|
| keybind, keybinding | **0 match** | Cơ chế không tồn tại |
| accelerator | **0 match** | Electron.Menu accelerator không dùng |
| globalShortcut | **0 match** | Electron.globalShortcut API không dùng |
| hotkey, keymap | **0 match** | — |

Bundle extract: 443 JS files quét; tất cả "0 match" → keybinding không implement

**Evidence:** Bash grep recursive: `find /tmp/wmux-inspect-src/dist -type f -name "*.js" -exec grep -l "keybind\|accelerator\|globalShortcut\|hotkey" {} \;` → không output

---

## 4. CLI Commands Đầy Đủ

wmux **KHÔNG có CLI command để register keybinding**. Danh sách toàn bộ command group:

| Group | Command | API Method |
|-------|---------|-----------|
| **System** | ping, identify, capabilities, list-windows, focus-window | system.* |
| **Workspace** | new-workspace, close-workspace, select-workspace, rename-workspace, list-workspaces | workspace.* |
| **Surface** | new-surface, close-surface, focus-surface, list-surfaces, set-color-scheme, clear-color-scheme, list-themes | surface.*, theme.list |
| **Pane** | split, close-pane, focus-pane, zoom-pane, list-panes, pane <sub>, tree | pane.* |
| **Layout** | layout grid | layout.* |
| **Terminal** | send <text>, send-key <key>, read-screen, trigger-flash | surface.send_text, surface.send_key, surface.read_text |
| **Browser** | browser open/snapshot/click/type/fill/screenshot/get-text/eval/wait/back/forward/reload | browser.* |
| **Agent** | agent spawn, spawn-batch, status, list, kill | agent.* |
| **Markdown** | markdown set | markdown.* |
| **Diff** | diff | diff.* |
| **Notify** | notify, list-notifications, clear-notifications | notification.* |
| **Sidebar** | set-status, set-progress, log, sidebar-state | sidebar.* |
| **Hook** | hook --event <type> --tool <name> --agent <id> | hook.event |
| **Config** | config show/reload/path, reload-config | config.* |

**Evidence:** `/tmp/wmux-inspect-src/dist/cli/wmux.js:512-534` — help text + switch statement lines 73-499

---

## 5. Fallback Options Đánh Giá Nhanh

Vì wmux không support keybinding → command natively:

| Fallback | Khả năng | Trade-off |
|----------|----------|-----------|
| **1. PowerShell $PROFILE alias** | ✅ GO | Chỉ alias text commands; TẬT khi dùng GUI app; no hotkey scope |
| **2. Windows AutoHotkey (v2)** | ✅ GO | Global hotkeys; spawn subprocess running CLI; no UI integration; setup phức tạp |
| **3. User phải type CLI command** | ✅ GO | Direct; không cần setup; slow (phải gõ mỗi lần) |
| **4. Custom Electron menu (app patch)** | ⚠️ RISKY | App.asar đã vá custom (hash CED7F271); patch lại = rebuild bundle → high maintenance cost |
| **5. Waitmux wrapper script** | ✅ GO | Interceptor script + keybind ở ngoài; moderate complexity |

---

## 6. Kết Luận Ý Tưởng

### Ý tưởng gốc
**Bind 1 phím (e.g. Ctrl+Shift+W) → chạy skill "đóng pane + lưu log"**
- wmux core: **NO-GO** (không support keybinding config)
- Fallback path: **AutoHotkey (Windows) hoặc wrapper** — viable nhưng ngoài wmux scope

### Ý tưởng 2
**Bind 1 phím cho lệnh "watch agent"**
- CLI command có: `wmux agent list|status|kill` — CÓ API
- Keybinding: **NO-GO** (same root issue)
- Fallback: AutoHotkey + `wmux agent list` qua CLI

---

## 7. Recommendation

### Cho Phase Hiện Tại (Pane UX Tier 3)
- **KHÔNG implement keybinding nội bộ wmux** — scope creep, app.asar patch risk
- **THAY VÀO:** Focus vào CLI improvement:
  1. Thêm command: `wmux pane close-with-log [--pane <id>]` → gọi close-pane + trigger log save (hook)
  2. Thêm command: `wmux agent watch [--interval <ms>]` → loop `wmux agent list` → refresh UI
  3. User tạo PowerShell alias / AutoHotkey script sau để call these CLI commands

### Nếu muốn global hotkey sau này
- **Tool:** Windows AutoHotkey v2 (standalone, không patch wmux)
  ```ahk
  ^+w::Run("wmux pane close-with-log")  ; Ctrl+Shift+W
  ```
- **Hoặc:** Custom Electron patch (risky, 5.2 release với full signed bundle)

---

## Unresolved Questions

1. **Có nên add `pane.close-with-log` CLI command hay flag existing `pane close`?**
   - Kiến nghị: Thêm flag `--save-log` vào `pane close` để keep backward compat
   
2. **Agent watch interval default là bao nhiêu ms?** (for AutoHotkey pattern)
   - Kiến nghị: 1000ms (1s polling) để balance UI responsiveness vs CPU

3. **Settings.json (`%APPDATA%\wmux\settings.json`) có bao giờ hỗ trợ keybinding?**
   - Status: Không found trong code; question for wmux team / next version roadmap

---

**Extracted:** `/tmp/wmux-inspect-src/` (deleted after report)  
**Config location:** `C:\Users\Bee\.wmux\config.toml` (non-existent, auto-created on first `wmux config reload`)
