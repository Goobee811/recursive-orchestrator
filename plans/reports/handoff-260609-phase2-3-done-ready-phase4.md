# Handoff — recursive-pane-orchestration: Phase 2+3 DONE → Phase 4-6

Hệ điều phối đa tầng (Orchestrator→Leader→Worker) chạy agent vào pane wmux. **Phase 2 (Codex engine) + Phase 3 (context-meter) đã cook xong, test thật bằng subscription (0 đồng API), code-review pass + hardened.** Phiên sau: Phase 4 (nested engine — hướng Orchestrator-trung-gian), Phase 5 (continuation+relay, đủ điều kiện vì 2+3 done), Phase 6 (safety — BẮT BUỘC vì codex full-bypass).

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-09 21:22 |
| Branch | main |
| Plan | `plans/260609-1722-recursive-pane-orchestration` (Hybrid 7 phase) |
| Trạng thái | Phase 1,2,3 ✅ done; Phase 4-7 pending |

## 1. Công Việc Đã Hoàn Thành (phiên này)

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| Phase 2: Codex engine (fork launcher + schema) | `scripts/launch-agent-ext.js`, `scripts/codex-result-schema.json` | ✅ |
| Phase 2 test: codex direct + spawn-vào-pane-wmux (subscription) | hello.txt/hello2.txt, result.json đúng schema, out.jsonl forensics | ✅ |
| Phase 3: context-meter | `scripts/context-meter.js` | ✅ |
| Phase 3 test: 5 nhánh + spike child session-id riêng | — | ✅ |
| Code review (code-reviewer agent) + 5 fix hardening | — | ✅ |
| Memory: no-api-tokens + always-use-context-handoff | `~/.claude/projects/.../memory/` | ✅ |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Đã commit | Phase 2+3 = 3 commit trên `main` (2 feat + 1 docs handoff); working tree clean. Chưa push |
| Tests | context-meter 5 nhánh pass; codex e2e (direct+pane) pass. Không có test fail |
| Auth verify | codex = ChatGPT subscription (OAuth tokens, không phải API key); claude OAuth login → **0 đồng API** |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do (WHY) |
|------------|-------------|
| Engine codex truyền qua **argv `--engine`** (không qua env) | `agent spawn` KHÔNG có flag `--env` (verified `cli/wmux.js:359-379`) → env không tới pane được. Reject env-only; giữ `WMUX_AGENT_CMD` làm fallback tương thích plugin |
| codex spawn `stdin:'ignore'` (không `'inherit'`) | codex đọc stdin chờ `<stdin>` block khi stdin không phải TTY; pipe-inherit không bao giờ EOF → **treo**. 'ignore' = EOF ngay |
| Token đo = `input + cache_creation + cache_read` | `input_tokens` thuần ~16k, KHÔNG BAO GIỜ chạm 180k → safety-eject vô dụng. Reject input_tokens thuần. Tổng = context window thật (verified entry 117809) |
| work-units **primary**, token chỉ safety-eject | auto-compact làm token non-monotonic (M4) → token không tin được làm tín hiệu chính |
| Reject finding "shell:true" (portability) | bật shell:true phá quoting-safety của execFileSync (chính lý do plugin dùng nó). Máy hiện tại .exe → shell:false OK |
| Mọi engine chạy **subscription**, không API | user directive — [[no-api-tokens-subscription-only]] |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| codex/claude là npm `.cmd` shim nếu chạy máy KHÁC → `spawn` shell:false ENOENT | portability Phase 4-7 | máy này .exe (OK). Đừng bật shell:true → resolve full path nếu cần |
| empty dir `scripts/spike/codex-test/` bị wmux pty lock | cosmetic | git bỏ qua dir rỗng; tự giải khi wmux restart |
| `agent.list` giữ record `exited` tồn đọng | cosmetic | không ảnh hưởng runtime |

## 5. File Tham Chiếu

| File | Vai trò |
|------|---------|
| `plans/260609-1722-recursive-pane-orchestration/phase-04-orchestration-engine.md` | **ĐỌC ĐẦU** — nested engine, hướng Orchestrator-trung-gian (depth 5/đồng thời 8) |
| `plans/260609-1722-recursive-pane-orchestration/plan.md` | overview + phase table (1,2,3 ✅) + quyết định + red-team |
| `scripts/launch-agent-ext.js` | Fork launcher. Engine: `--engine`(argv) > `WMUX_AGENT_CMD`(env) > claude. Codex headless + tee JSONL. **Spawn codex từ Phase 4/5: phải thêm `--engine codex` vào `--cmd`** |
| `scripts/context-meter.js` | `{decision: continue\|handoff\|unknown}`. Primary=units, eject=token>180k, fail=unknown. Scan transcript theo UUID |
| `scripts/codex-result-schema.json` | Schema strict (5 key) — Leader đọc `result.json` ở Phase 5 |
| `plans/reports/spike-260609-nested-spawn-capability-report.md` | verdict nested=FALLBACK + chuỗi lệnh wmux CLI chuẩn (pane/surface model) |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plan]] | Plan đang active (Hybrid 7 phase) |
| [[no-api-tokens-subscription-only]] | Quy tắc: engine chạy subscription, không API |
| [[handoff-260609-phase1-done-ready-phase2-3]] | Handoff trước (Phase 1 done → 2+3) |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 | **Phase 4 — Nested engine**: Orchestrator-trung-gian (worker ghi intent → Orchestrator spawn hộ, registry chain giữ cây logic). Spawn codex nhớ `--engine codex` + cwd đúng | Phase 1 ✅ |
| 2 | **Phase 5 — Continuation + reverse-relay**: dùng context-meter (decision handoff) kích hoạt chain; Leader đọc result.json; chainId+seq | Phase 2,3 ✅ |
| 3 | **Phase 6 — Safety** (BẮT BUỘC): backup+denylist, data-fence+secret-scan, crash-recovery marker, runtime write-fence bọc launch path | Phase 2 ✅ |
