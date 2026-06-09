---
phase: 2
title: "Codex Engine + Wrapper Protocol"
status: done
priority: P1
effort: "2-3h"
dependencies: [1]
---

# Phase 2: Codex Engine + Wrapper Protocol

## Overview

Thêm **Codex** làm engine thứ ba bên cạnh `claude`/`opencode` trong launch path của plugin, theo đúng quyết định user (giữ Codex v1). Vì Codex không gọi được skill Claude, output phải **có cấu trúc** (`--output-schema`) để Leader đọc + viết handoff hộ (Phase 5).

## Key Insights

- `launch-agent.js:26-42` branch `WMUX_AGENT_CMD`: `claude` (mặc định, `--dangerously-skip-permissions --`) | `opencode`. Thêm nhánh `codex` chỉ ~10 dòng.
- Codex `exec` flags đã verify (codex-cli 0.138.0): `--dangerously-bypass-approvals-and-sandbox`, `--skip-git-repo-check` (BẮT BUỘC vì govoff non-git), `-C <cwd>`, `-o <file>` (chỉ last-message — H7), `--json` (events stdout), `--output-schema <file>`.
- **KHÔNG sửa in-place** `launch-agent.js` của plugin → fork bản copy trong delta để giữ plugin gốc nguyên (rủi ro tổng trong plan.md).

## Requirements

- Functional: chọn engine qua `WMUX_AGENT_CMD=codex`; Codex chạy headless, ghi kết quả có cấu trúc + log đầy đủ.
- Non-functional: prompt truyền quoting-safe (như plugin); output đủ để Leader tái dựng handoff kể cả khi Codex lỗi.

## Architecture

```
launch-agent-ext.js (fork của launch-agent.js)
  WMUX_AGENT_CMD=codex →
    execFileSync('codex', ['exec',
       '--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check',
       '-C', cwd, '-o', resultFile, '--output-schema', schemaFile, '--json',
       '--', prompt], {stdio:[...]})  + redirect --json JSONL ra out-<id>.jsonl
schemaFile = {filesChanged[], decisions[], remaining[], blockers[], status}
```

## Related Code Files

- Read: `wmux-orchestrator/scripts/launch-agent.js` (mẫu fork), `spawn-agents.sh` (chỗ gọi launcher).
- Create: `scripts/launch-agent-ext.js` — fork + nhánh codex.
- Create: `scripts/codex-result-schema.json` — JSON Schema cho `--output-schema`.
- Create/Update: cấu hình để `spawn-agents.sh` (hoặc bản gọi) trỏ tới `launch-agent-ext.js` khi agent có `engine:codex` trong `state.json`.

## Implementation Steps

1. Fork `launch-agent.js` → `launch-agent-ext.js`, giữ nguyên branch claude/opencode, thêm `codex`.
2. Viết `codex-result-schema.json` (filesChanged, decisions, remaining, blockers, status) → ép Codex emit JSON parse được.
3. Capture cả `-o resultFile` (last message JSON) VÀ `--json` JSONL ra `out-<id>.jsonl` (forensics khi Codex chết — H7).
4. Cho `state.json` agent có field `engine` (claude|codex); bản gọi launcher chọn theo field đó.
5. Test: spawn 1 agent codex trên task dummy (tạo/sửa 1 file fixture), xác nhận resultFile JSON hợp lệ + JSONL log tồn tại + file fixture đổi.
6. Test lỗi: ép Codex thoát non-zero giữa chừng → xác nhận JSONL log vẫn còn để Leader đọc.

## Success Criteria

- [x] `--engine codex` (qua argv, vì `agent spawn` không truyền env) spawn Codex headless vào pane, tự chạy, không hỏi approval. Verified: spawn pane → hello2.txt tạo ~12s.
- [x] Result file đúng schema (parse được, đủ 5 key) + JSONL log persisted (tee streaming, flush-on-exit cho forensics khi Codex lỗi).
- [x] Plugin gốc (`launch-agent.js`) KHÔNG bị sửa; fork `launch-agent-ext.js`; claude/opencode branch byte-identical upstream (code-reviewer xác nhận).

**Đã build:** `scripts/launch-agent-ext.js` (engine resolution: `--engine` > `WMUX_AGENT_CMD` > claude; codex branch stdin='ignore' tránh hang, tee JSONL), `scripts/codex-result-schema.json` (strict, 5 required key). Auth = ChatGPT subscription (`OPENAI_API_KEY` null), KHÔNG tốn API.

## Risk Assessment

- **Codex cần auth** lần đầu → kiểm tra `codex` đã login trước khi spawn; nếu chưa, báo user (không tự bypass auth).
- **`-o` chỉ last-message** → bù bằng `--output-schema` (ép cấu trúc) + JSONL log (H7).
- **Sửa nhầm plugin** → fork, không in-place.

## Next Steps

Engine Codex + schema là đầu vào cho **Phase 5** (Leader đọc `-o` viết handoff). Lớp an toàn bọc launcher ở **Phase 6**.
