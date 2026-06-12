---
title: "Root-cause 3 triệu chứng sự cố govoff 2026-06-11 — tổng hợp wave govinv"
date: 2026-06-12
type: report
tags: [govinv, incident, govoff, root-cause, portability, pane-layout, model-policy, orchestration]
status: done
plan: none
---

# Root-cause sự cố govoff — tổng hợp wave điều tra `govinv`

**Phương pháp:** wave orchestration thật (`.orch-run/govinv/`), 3 worker codex GPT 5.5 forensics song song trên transcript `~/.claude/projects/C--Users-Bee-govoff/f036d9d7-c85d-4577-93a9-c454438b0bd0.jsonl` (15.12MB, 1878 dòng JSONL, cả 3 parser độc lập: 0 parse error). Spawn qua `nested-request.js` → `process-nested-requests.js`, RootPane tường minh, harvest result-based, panes giữ sống. Wave: spawn 00:19 → harvest đủ 00:26 (~7 phút).

**Báo cáo worker:** `.orch-run/govinv/agent-orch-root-c1-result.md` (H1), `-c2-` (H2), `-c3-` (H3).

## Kết luận 3 triệu chứng

### H1 — Orchestrator không điều phối: CONFIRMED

- Transcript **0 hit** mọi entrypoint hệ: `process-nested-requests`, `spawn-by-split`, `launch-agent-ext`, `orchestrator-pass`, `pane-spawn`, `nested-request`, `orchestrate-start`, `harvest-results`, `.orch-run` — tất cả 0. Chỉ 3 hit `recursive-orchestrator` từ memory-file references (line 29, 686).
- Phiên govoff improvise: **20 lần `codex exec` ad-hoc** (batch + sleep + log file tự chế) + 3 `wmux agent spawn` thô + browser reload thủ công. Không state registry, không launcher, không harvest.
- govoff KHÔNG có: root `CLAUDE.md`, `README.md`, `.claude/settings*.json` (chỉ `agent-memory/`), `.orch-run`. Plans cũ có handoff docs nhắc orchestration design nhưng không phải runtime guidance kích hoạt được.
- **Root-cause:** hệ chỉ sống trong `C:\Users\Bee\recursive-orchestrator`; phiên ở repo ngoài không có công cụ + không có guidance → không biết hệ tồn tại.

### H2 — Pane loạn: PARTIAL CONFIRMED, cơ chế ĐÍNH CHÍNH

- Giả thuyết cũ (split fallback first-leaf do WMUX_PANE_ID rỗng) **KHÔNG được chứng minh**: transcript **0 lệnh `split`**, 0 lần đọc `WMUX_PANE_ID`.
- Cơ chế thật: `layout grid --count 6` (07:00:58Z) nổ 5 pane mới grid 3x2 từ 1 leaf, rồi `agent spawn --pane` tay vào **3/5 pane**, 2 pane thừa bỏ trống; không quan hệ cha-con, không convention dọc/ngang, không close-surface lifecycle.
- Phần đúng của giả thuyết: không `--source-pane`/`-RootPane` (0 hit), không qua `pane-spawn.js`.
- **Root-cause:** improvise layout grid thô thay vì directional split convention — hệ quả trực tiếp của H1.

### H3 — Model đảo three-tier: CONFIRMED, 2 cơ chế tách biệt

- **(a) Worker chạy Fable 5:** 3 worker spawn qua script ps1 tự sinh (`w1-usda-research.ps1:31`, `w2-brand-tokens.ps1:30`, `w4-content-design.ps1:49`) đều là `claude --permission-mode bypassPermissions $prompt` — **không `--model`** → ăn CLI default `~/.claude/settings.json: "model": "claude-fable-5[1m]"`. W2/W4 chạy Fable 5; W4 (63e2f702), W2 (856b7530) xác nhận từ transcript; W1 (ff5d3b59) start default rồi cũng dính fallback sang Opus.
- **(b) Phiên chính "tự chuyển Opus 4.8":** KHÔNG phải `/model`, KHÔNG fast-mode. Là **`model_refusal_fallback`** — system event line 166: `trigger:"refusal"`, `originalModel:"claude-fable-5"`, `fallbackModel:"claude-opus-4-8"` lúc 07:02:52Z (9 phút sau khi phiên bắt đầu, ngay sau `browser get-text` đọc shared chat claude.ai line 160). CLI chính thức tự retry bằng Opus 4.8 khi Fable 5 refuse — không phải model tự ý đổi. Toàn bộ phần còn lại của phiên (543 messages, tới 23:23) chạy Opus 4.8.
- **Root-cause:** bare `claude` không qua `launch-agent-ext.js` (launcher có default `claude-opus-4-8[1m]`:8,42 nhưng chỉ áp khi dùng launcher) + refusal-fallback đổi tier phiên chính im lặng.

## Hướng fix đề xuất (CHỜ USER DUYỆT — không fix mò)

| # | Nhóm | Nội dung | Giải quyết |
|---|------|----------|-----------|
| F1 | Multi-repo mode | Scripts gọi được từ repo bất kỳ bằng đường dẫn tuyệt đối; state/forensics tại `<work-repo>\.orch-run\`; audit `__dirname` vs `process.cwd()` trong launcher/process-nested/pane-spawn | H1 |
| F2 | Global guidance | Mục orchestration trong `~/.claude/CLAUDE.md` (hoặc skill/command global): hệ tồn tại ở đâu, entrypoint tuyệt đối, three-tier policy, RootPane bắt buộc — để MỌI phiên repo ngoài biết hệ | H1, H2, H3 |
| F3 | Enforce model launcher + cấm bare claude | Nhánh claude thiếu `--model` → LUÔN gắn policy model; guidance cấm spawn `claude` trần khi orchestrate; cân nhắc spawn-guard reject command chứa `claude` không `--model` | H3a |
| F4 | RootPane bắt buộc + cấm layout grid tay | Mọi hướng dẫn/entrypoint multi-repo yêu cầu `-RootPane`/`--source-pane` tường minh; spawn LUÔN qua `pane-spawn.js`/`process-nested-requests.js` | H2 |
| F5 | Giám sát refusal-fallback | Surface `model_refusal_fallback` như incident vận hành (đổi tier im lặng); khuyến nghị worker đề xuất của c3: audit first-assistant-model sau spawn | H3b |

## Unresolved Questions

- Pane thật cuối phiên govoff không quan sát được (transcript không có `tree` cuối) — dựng từ command history.
- `model_refusal_fallback` trigger cụ thể bởi nội dung gì (adjacency với browser get-text shared chat — chưa khẳng định nhân quả).
- BASF task thật vẫn chờ user giao đề (sau fix).
