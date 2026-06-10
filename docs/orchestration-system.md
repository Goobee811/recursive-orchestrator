---
title: "Recursive Pane Orchestration System"
date: 2026-06-10
type: doc
tags: [orchestration, wmux, architecture]
status: active
---

# Recursive Pane Orchestration System

Tài liệu này mô tả hệ điều phối pane đệ quy của repo `recursive-orchestrator`. Nguồn sự thật là code trong `scripts/` và plan `plans/260609-1722-recursive-pane-orchestration/plan.md`.

## Tổng quan kiến trúc Hybrid

Repo này không build lại toàn bộ orchestration stack. Hệ thống đi theo hướng **Hybrid**:

- **Nền có sẵn:** plugin `wmux-orchestrator@0.1.1` lo spawn pane, layout, registry, monitor, dashboard và orchestration wave cơ bản.
- **Delta trong repo:** các script ở `scripts/` bổ sung phần plugin chưa có: Codex engine, nested recursion theo FALLBACK, continuation chain 180k, reverse-relay, context-meter và 4 lớp an toàn.

Các thành phần chính:

- **Orchestrator depth 0:** actor trung tâm, đọc `state.json`, xử lý intent file, spawn worker vào pane wmux.
- **Worker:** agent chạy trong pane, làm một phần việc, ghi result file, có thể xin fan-out hoặc chain continuation.
- **State registry:** `state.json` lưu waves, agents, paneId, surfaceId, status, depth, parentAgentId, chainId.
- **Pane allocator:** `pane-spawn.js` dùng wmux CLI để tạo pane bằng split hoặc grid, rồi gọi `wmux agent spawn --pane --cmd`.
- **Launcher:** `launch-agent-ext.js` chọn engine `claude`, `opencode`, hoặc `codex`.

## Các delta đã build

### Codex engine

`scripts/launch-agent-ext.js` thêm engine `codex` bên cạnh `claude` và `opencode`.

- `claude` mặc định dùng model `claude-opus-4-8[1m]`, effort `max`.
- Có thể override bằng `--model` và `--effort` khi gọi launcher trực tiếp.
- `codex` chạy headless bằng `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check`.
- Codex ghi structured output qua `-o agent-<id>-result.json` và JSONL forensic log qua `--json`.
- Schema output nằm ở `scripts/codex-result-schema.json`.

Ví dụ:

```powershell
node scripts/launch-agent-ext.js .orch-run/p7pack/agent-w1-prompt.md --engine codex
node scripts/launch-agent-ext.js .orch-run/p7pack/agent-lead-prompt.md --model "claude-opus-4-8[1m]" --effort max
```

### Nested recursion FALLBACK

Worker không tự tạo pane con trực tiếp. Phase spike đã kết luận worker split/layout từ pane riêng không đủ ổn định. Thay vào đó worker ghi intent file; orchestrator trung gian spawn hộ.

Luồng:

1. Worker cần fan-out viết `nested-request-<parent>.json` bằng `nested-request.js`.
2. Orchestrator chạy `process-nested-requests.js`.
3. Script re-check guard, đăng ký child agents vào `state.json`, viết prompt, spawn pane.
4. Kết quả spawn được ghi vào `nested-response-<parent>.json`.

Guard nằm ở `nested-guard.js`:

- `maxDepth` mặc định `5`.
- `maxConcurrent` mặc định `8`.
- Guard fail-closed nếu state hoặc limit không hợp lệ.
- Worker check trước chỉ là advisory; orchestrator re-check mới là authoritative.

### Continuation chain 180k và reverse-relay

Một thread dài có thể vượt context của một worker. Khi gần hết budget, worker tạo chain request để orchestrator spawn link kế tiếp.

Luồng handoff:

1. Link hiện tại gọi `chain-request.js --done false`.
2. `chain-router.js` đọc `chain-request-<from>.json`.
3. Router tạo agent link mới có cùng depth, tăng `linkSeq`, giữ `chainId`.
4. Link mới đọc result của link trước và làm tiếp.

Luồng kết thúc:

1. Link cuối gọi `chain-request.js --done true`.
2. `chain-router.js` ghi marker `relay-<chainId>.json`.
3. Leader đọc marker để biết thread đã reverse-relay xong và lấy `lastResultFile`.

Seed link đầu:

```powershell
node scripts/chain-router.js seed --state .orch-run/p7pack/state.json --agent orch-root-c2 --leader orch-root
```

### Context meter

`scripts/context-meter.js` quyết định worker tiếp tục hay handoff.

- Primary signal là work-units: `--units-done` so với `--budget-units`.
- Token chỉ là safety eject vì auto-compact làm token transcript không monotonic.
- Transcript được tìm theo `CLAUDE_CODE_SESSION_ID` trong `~/.claude/projects`.
- Nếu transcript không đọc được, decision là `unknown`, worker phải theo unit budget.

Ví dụ:

```powershell
node scripts/context-meter.js --session $env:CLAUDE_CODE_SESSION_ID --units-done 3 --budget-units 5 --threshold 180000
```

### Bốn lớp an toàn

`scripts/safe-launch-wrapper.ps1` bọc launcher khi được opt-in bằng `--safe-wrapper`.

Các lớp:

- **Secret pre-flight:** scan prompt/spec bằng `scan-secrets.js`.
- **Denylist:** chặn spec chứa mẫu lệnh phá hoại như recursive delete, force push, pipe-to-exec.
- **Backup:** snapshot các file được khai báo trong vùng allowed trước khi worker chạy.
- **Write-fence:** sau khi worker chạy, kiểm tra git status, báo file đổi ngoài vùng allowed; có thể restore nếu bật `-RestoreOutOfZone`.

Wrapper đọc vùng allowed từ `state.json`, không tin argv bên ngoài.

Ví dụ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/safe-launch-wrapper.ps1 `
  -Launcher scripts/launch-agent-ext.js `
  -PromptFile .orch-run/p7pack/agent-w1-prompt.md `
  -Engine codex `
  -StateFile .orch-run/p7pack/state.json `
  -AgentId w1
```

## Sơ đồ luồng chính

### Fan-out nested

```text
Orchestrator depth 0
  nhận việc
  cập nhật state.json
  spawn worker vào pane wmux
        |
        v
Worker cần chia tiếp
  nested-request.js ghi nested-request-*.json
        |
        v
orchestrator-pass.ps1
  process-nested-requests.js
  đăng ký child wave
  spawn child panes
        |
        v
Child workers làm việc
  ghi agent-*-result.md/json
        |
        v
harvest-results.js đóng wave theo result
```

### Continuation chain

```text
Link W1 gần hết budget
  chain-request.js --done false
        |
        v
chain-router.js
  spawn W2 với chainId + linkSeq=2
        |
        v
W2 đọc result W1 và làm tiếp
        |
        v
Link cuối
  chain-request.js --done true
        |
        v
chain-router.js
  ghi relay-<chainId>.json
        |
        v
Leader đọc marker reverse-relay
```

## Cách dùng script

### `scripts/orchestrator-pass.ps1`

Driver một pass của orchestrator loop.

Các bước trong một pass:

1. `reconcile-agents.js`: poll `wmux agent list`, đóng agent đã exit.
2. `harvest-results.js`: đóng agent theo result file; xử lý pane `-NoExit`.
3. `process-nested-requests.js`: xử lý fan-out nested.
4. `chain-router.js`: xử lý continuation chain khi bật `-Chain`.
5. `crash-recovery.js detect`: phát hiện worker stale, chỉ mark khi có live cross-check.

Ví dụ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/orchestrator-pass.ps1 `
  -State .orch-run/p7pack/state.json `
  -WmuxCli $env:WMUX_CLI `
  -RootPane <paneId> `
  -Cwd "C:\Users\Bee\recursive-orchestrator" `
  -Chain `
  -Mark `
  -HarvestKill
```

Ghi chú:

- `-Chain` mới bật bước chain-router.
- `-Mark` cho phép crash-recovery mark failed, nhưng chỉ khi có wmux live list.
- `-HarvestKill` reap pane đã có result.
- `-RootPane` nên truyền tường minh vì `WMUX_PANE_ID` có thể rỗng sau resume.

### `scripts/spawn-by-split.js`

Spawn một agent đã đăng ký `pending` trong `state.json` vào pane mới bằng directional split.

Ví dụ:

```powershell
node scripts/spawn-by-split.js `
  --state .orch-run/p7pack/state.json `
  --agent orch-root-c2 `
  --wmux-cli $env:WMUX_CLI `
  --source-pane <paneId> `
  --split vertical `
  --cwd "C:\Users\Bee\recursive-orchestrator"
```

Quy ước:

- `--split vertical`: child worker, split sang phải.
- `--split horizontal`: sibling cùng wave, split xuống dưới.
- Script yêu cầu agent đang ở status `pending`.

### `scripts/nested-request.js`

Worker gọi khi cần fan-out.

Ví dụ:

```powershell
node scripts/nested-request.js `
  --state .orch-run/p7pack/state.json `
  --parent orch-root-c2 `
  --tasks tasks.json `
  --cwd "C:\Users\Bee\recursive-orchestrator"
```

`tasks.json` là mảng object có `label`, `subtask`, tùy chọn `files`, `excludeFiles`, `engine`.

Nếu guard deny, exit code `3`, worker phải tự làm tuần tự.

### `scripts/chain-request.js`

Worker gọi khi cần continuation hoặc kết thúc chain.

Handoff link kế:

```powershell
node scripts/chain-request.js `
  --state .orch-run/p7pack/state.json `
  --from orch-root-c2 `
  --done false `
  --label "continue docs" `
  --remaining "Phần việc còn lại..." `
  --engine codex `
  --prev-result .orch-run/p7pack/agent-orch-root-c2-result.md
```

Báo thread hoàn tất:

```powershell
node scripts/chain-request.js --state .orch-run/p7pack/state.json --from orch-root-c2 --done true
```

### `scripts/chain-router.js`

Orchestrator xử lý `chain-request-*.json`.

Seed chain link 1:

```powershell
node scripts/chain-router.js seed --state .orch-run/p7pack/state.json --agent orch-root-c2 --leader orch-root
```

Route pending requests:

```powershell
node scripts/chain-router.js `
  --state .orch-run/p7pack/state.json `
  --wmux-cli $env:WMUX_CLI `
  --root-pane <paneId> `
  --layout split `
  --max-concurrent 8 `
  --cwd "C:\Users\Bee\recursive-orchestrator"
```

### `scripts/launch-agent-ext.js`

Launcher engine mở rộng.

Ví dụ:

```powershell
node scripts/launch-agent-ext.js .orch-run/p7pack/agent-w1-prompt.md --engine claude
node scripts/launch-agent-ext.js .orch-run/p7pack/agent-w2-prompt.md --engine opencode
node scripts/launch-agent-ext.js .orch-run/p7pack/agent-w3-prompt.md --engine codex
```

Default:

- Engine mặc định: `claude`.
- Claude model mặc định: `claude-opus-4-8[1m]`.
- Claude effort mặc định: `max`.
- Codex dùng GPT-5.5 theo CLI/runtime hiện tại của môi trường, và chạy full bypass.

### `scripts/safe-launch-wrapper.ps1`

Safety wrapper opt-in quanh launcher. Dùng khi worker được phép sửa file thật.

Ví dụ ngắn:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/safe-launch-wrapper.ps1 `
  -Launcher scripts/launch-agent-ext.js `
  -PromptFile .orch-run/p7pack/agent-w1-prompt.md `
  -Engine codex `
  -StateFile .orch-run/p7pack/state.json `
  -AgentId w1
```

### `scripts/cleanup-panes.ps1`

Script này đang được worker khác cùng wave viết. Quy ước vận hành dự kiến:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-panes.ps1 -State .orch-run/p7pack/state.json
```

Mục đích: đọc `state.json`, đóng các pane/agent còn sót sau wave. Khi cần khẩn cấp có thể đóng thủ công:

```powershell
node $env:WMUX_CLI close-pane <paneId>
```

## Quy ước layout pane

Quy ước trực quan của repo:

- Worker con sâu hơn một cấp: split dọc, pane mới nằm **bên phải** pane nguồn.
- Sibling cùng wave: split ngang, pane mới nằm **bên dưới** sibling trước.
- `process-nested-requests.js` spawn child đầu bằng vertical split từ parent/root pane; child tiếp theo dùng horizontal split từ pane child trước.
- `chain-router.js` spawn link kế bằng vertical split từ pane link trước, fallback về root pane nếu pane trước đã bị harvest.

Patch wmux đã được dogfood verified ngày `2026-06-10`:

- CLI hỗ trợ `split --pane <paneId>`.
- Renderer `__wmux_splitPane` nhận `params.paneId`.
- Nếu pane id không hợp lệ, fallback first-leaf để backward compatible.

Cảnh báo vận hành:

- Update wmux có thể đè patch.
- Trước mỗi phiên orchestration, kiểm SHA256 `app.asar`.
- Hash đã verify: `CED7F271E601015CEAF42FFE2EE005D698991B7A32EB31C73D1DE674BBD828B6`.
- Nếu hash khác, vá lại theo spec `.orch-run/wpatch2/agent-w1b-prompt.md`.
- Backup gốc tại `C:\Users\Bee\wmux-backup-20260610`.

## Lifecycle worker headless Codex

Pane wmux dùng shell `-NoExit`, nên process Codex có thể xong nhưng pane vẫn sống. Vì vậy không được dựa riêng vào `reconcile-agents.js`.

Luồng đúng:

- Worker Codex ghi `agent-<id>-result.json`.
- `harvest-results.js` đọc status trong JSON.
- `done` hoặc `partial` => agent `completed`.
- `blocked` => agent `failed`.
- `orchestrator-pass.ps1 -HarvestKill` gọi harvest và reap pane idle.

Với Claude/opencode, harvest coi `agent-<id>-result.md` tồn tại và non-empty là completed.

## Lệnh dọn khẩn

Ưu tiên script cleanup khi có:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-panes.ps1 -State .orch-run/p7pack/state.json
```

Đóng pane thủ công:

```powershell
node $env:WMUX_CLI close-pane <paneId>
```

Nếu cần đóng agent trước:

```powershell
node $env:WMUX_CLI agent kill <wmuxAgentId>
```

## Giới hạn và rủi ro

- **Depth tối đa:** `5`.
- **Concurrent tối đa:** `8` live agents.
- **Codex full bypass:** bắt buộc dùng safety wrapper khi thao tác file thật có rủi ro.
- **`WMUX_PANE_ID` có thể rỗng sau resume:** luôn truyền `--source-pane` hoặc `-RootPane` tường minh.
- **PowerShell 5.1 và JSON cho Node:** ghi UTF-8 không BOM; các script Node đã strip BOM cho `state.json` nhưng file request nên tránh BOM.
- **Worker intent file là untrusted:** orchestrator luôn re-validate parent id, engine, tasks, depth, concurrency.
- **Pane patch ngoài repo:** update wmux có thể làm mất `split --pane`, cần hash check trước phiên.
- **Crash recovery không kill worker sống:** `crash-recovery.js detect --mark` chỉ mutate khi có live cross-check từ wmux.

## Tham chiếu code

- `scripts/orchestrator-pass.ps1`: driver một monitor pass.
- `scripts/process-nested-requests.js`: xử lý nested fan-out.
- `scripts/nested-request.js`: worker ghi fan-out intent.
- `scripts/nested-guard.js`: depth/concurrency guard.
- `scripts/nested-state.js`: state lock, agent lookup, wave append.
- `scripts/pane-spawn.js`: allocate split/grid và spawn vào pane.
- `scripts/spawn-by-split.js`: spawn một pending agent bằng split.
- `scripts/chain-request.js`: worker ghi continuation/done intent.
- `scripts/chain-router.js`: seed/route chain và reverse-relay.
- `scripts/context-meter.js`: quyết định continue/handoff theo unit budget và token safety.
- `scripts/harvest-results.js`: lifecycle result-based cho pane `-NoExit`.
- `scripts/crash-recovery.js`: progress marker và stale detection.
- `scripts/launch-agent-ext.js`: launcher `claude|opencode|codex`.
- `scripts/safe-launch-wrapper.ps1`: safety wrapper opt-in.
