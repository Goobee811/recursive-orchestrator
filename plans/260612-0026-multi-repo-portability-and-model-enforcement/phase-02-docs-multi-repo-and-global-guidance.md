---
title: "Phase 2 — Docs multi-repo + global guidance ~/.claude"
date: 2026-06-12
type: plan
tags: [docs, multi-repo, global-guidance, model-policy]
status: active
plan: 260612-0026-multi-repo-portability-and-model-enforcement
---

# Phase 2 — Docs + global guidance

**Owner:** wave `mrfix` W2 (codex) cho docs repo; orchestrator TỰ viết `~/.claude/CLAUDE.md` (config user-level, không giao worker). **Status:** in-progress.

## W2 — `docs/orchestration-system.md` thêm mục "Multi-repo mode"

Nội dung phải khớp Phase 1 behavior:

- Doctrine: orchestrator session CWD = WORK REPO; gọi scripts bằng đường dẫn TUYỆT ĐỐI `C:\Users\Bee\recursive-orchestrator\scripts\...`; state/prompt/result/forensics tại `<work-repo>\.orch-run\<wave>\`.
- `-RootPane` BẮT BUỘC ở orchestrate-start (lấy từ `node $env:WMUX_CLI tree`); WMUX_PANE_ID rỗng sau resume.
- CẤM: `wmux agent spawn` thô, `layout grid` tay cho wave, bare `claude` không qua `launch-agent-ext.js` (launcher enforce model policy), `codex exec` ad-hoc ngoài hệ khi orchestrate.
- Three-tier: Orchestrator Fable 5 (phiên chính, KHÔNG tự đổi model); Leader Opus 4.8 `claude-opus-4-8[1m]` effort max (launcher default); Worker GPT 5.5 Codex.
- Vận hành model: `model_refusal_fallback` (Fable 5 → Opus 4.8 do refusal) = incident vận hành — ghi nhận + báo user; khuyến nghị audit first-assistant-model của worker claude sau spawn (đọc transcript JSONL theo claudeSessionId).
- Đầu phiên orchestration: hỏi user "Chọn model nào: Fable hay Opus" cho phiên orchestrator.
- Ví dụ lệnh đầy đủ chạy từ repo ngoài (tree → state → tasks → nested-request → process-nested-requests → orchestrate-start, đều absolute path).

## Orchestrator — `~/.claude/CLAUDE.md` mục "Orchestration (wmux waves)"

- Hệ ở đâu, khi nào dùng, entrypoint tuyệt đối, doctrine state-tại-work-repo, RootPane bắt buộc, three-tier + cấm bare claude, hỏi model đầu phiên (yêu cầu user 2026-06-12), refusal-fallback là incident.
- Ngắn (~20-30 dòng), trỏ về `docs/orchestration-system.md` cho chi tiết.

## Success criteria

- Docs build/đọc mạch lạc, không mâu thuẫn behavior code sau Phase 1.
- Global section ngắn gọn, phiên repo ngoài đọc là biết kích hoạt hệ đúng cách.
