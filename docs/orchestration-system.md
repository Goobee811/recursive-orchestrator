---
title: "Recursive Pane Orchestration System"
date: 2026-06-12
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
- **Pane allocator:** `pane-spawn.js` dùng wmux CLI để tạo pane bằng directional split hoặc grid tường minh, rồi gọi `wmux agent spawn --pane --cmd`.
- **Launcher:** `launch-agent-ext.js` chọn engine `claude`, `opencode`, hoặc `codex`.

## Multi-repo mode

Hệ orchestration nằm trong repo này nhưng được phép điều phối work repo khác. Doctrine vận hành:

- **CWD phiên orchestrator = work repo.** Ví dụ làm việc trên `C:\Users\Bee\govoff` thì phiên orchestrator `cd` vào govoff, không chạy trong repo `recursive-orchestrator`.
- **Script orchestration gọi bằng đường dẫn tuyệt đối:** `C:\Users\Bee\recursive-orchestrator\scripts\...`.
- **State/prompt/result/forensics nằm trong work repo:** `<work-repo>\.orch-run\<wave>\`. Không để artefact wave rơi vào repo orchestration khi đang làm repo khác.
- **`-RootPane` bắt buộc với `orchestrate-start.ps1`:** lấy pane live bằng `node $env:WMUX_CLI tree`. Không dựa vào `WMUX_PANE_ID` vì biến này có thể rỗng sau resume.

Các lệnh bị cấm khi đang orchestrate:

- Không `wmux agent spawn` thô; luôn đi qua `process-nested-requests.js`, `chain-router.js`, `spawn-by-split.js` hoặc launcher của hệ.
- Không tự `layout grid` cho wave. Grid chỉ dùng khi truyền `--layout grid` tường minh; layout split mà không có source pane phải báo lỗi `no source pane for split layout; pass --root-pane or use --layout grid`.
- Không chạy bare `claude` ngoài `launch-agent-ext.js`; launcher là điểm enforce model policy.
- Không chạy `codex exec` ad-hoc ngoài hệ khi orchestration đang quản lý wave.

Chính sách model 3 tầng:

| Tầng | Model/engine | Ghi chú |
|---|---|---|
| Orchestrator | Fable 5 hoặc Opus theo user chọn đầu phiên | Phiên chính không tự đổi model. Đầu phiên phải hỏi: "Chọn model nào: Fable hay Opus". |
| Leader | `claude-opus-4-8[1m]`, effort `max` | Default của `launch-agent-ext.js`. |
| Worker | GPT 5.5 Codex | Chạy qua nhánh `codex` của launcher. |

`model_refusal_fallback` từ Fable 5 sang Opus 4.8 do refusal là **incident vận hành**: ghi nhận, báo user ngay, và không coi là thay đổi tier bình thường. Với worker Claude, nên audit first-assistant-model sau spawn bằng transcript JSONL theo `claudeSessionId` trong `state.json`.

Ví dụ tối thiểu từ repo ngoài `C:\Users\Bee\govoff`:

```powershell
cd C:\Users\Bee\govoff
node $env:WMUX_CLI tree

New-Item -ItemType Directory -Force .orch-run\govwave | Out-Null
$enc = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText("C:\Users\Bee\govoff\.orch-run\govwave\state.json", '{"version":1,"waves":[]}', $enc)
[IO.File]::WriteAllText("C:\Users\Bee\govoff\.orch-run\govwave\tasks.json", @'
[
  {
    "label": "docs-check",
    "subtask": "Đọc README và báo cáo ngắn tình trạng repo.",
    "engine": "codex"
  }
]
'@, $enc)

node C:\Users\Bee\recursive-orchestrator\scripts\nested-request.js `
  --state C:\Users\Bee\govoff\.orch-run\govwave\state.json `
  --parent orch-root `
  --tasks C:\Users\Bee\govoff\.orch-run\govwave\tasks.json `
  --cwd C:\Users\Bee\govoff

node C:\Users\Bee\recursive-orchestrator\scripts\process-nested-requests.js `
  --state C:\Users\Bee\govoff\.orch-run\govwave\state.json `
  --wmux-cli $env:WMUX_CLI `
  --root-pane <paneId> `
  --cwd C:\Users\Bee\govoff

powershell -NoProfile -ExecutionPolicy Bypass `
  -File C:\Users\Bee\recursive-orchestrator\scripts\orchestrate-start.ps1 `
  -State C:\Users\Bee\govoff\.orch-run\govwave\state.json `
  -WmuxCli $env:WMUX_CLI `
  -RootPane <paneId> `
  -Chain `
  -Mark
```

## Các delta đã build

### Codex engine

`scripts/launch-agent-ext.js` thêm engine `codex` bên cạnh `claude` và `opencode`.

- `claude` mặc định dùng model `claude-opus-4-8[1m]`, effort `max`.
- Có thể override bằng `--model` và `--effort` khi gọi launcher trực tiếp.
- `codex` chạy headless bằng `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check`.
- Codex ghi structured output qua `-o agent-<id>-result.json` và JSONL forensic log qua `--json`.
- Schema output nằm ở `scripts/codex-result-schema.json`.
- Echo pane của codex được render compact ANSI (1 event → 1 dòng gọn: lệnh, kết quả, file change, result kèm decisions/remaining) thay vì JSONL thô; `out.jsonl` vẫn nhận byte thô nguyên vẹn — máy không đọc stdout pane. Renderer lỗi thì tự fallback echo thô; đặt env `WORKER_RAW_ECHO=1` để ép echo thô khi debug.

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

### `scripts/orchestrate-start.ps1`

Driver loop nhiều pass cho một wave orchestration. Dùng PowerShell 5.1 và truyền path tuyệt đối khi chạy từ repo ngoài.

Ví dụ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\Bee\recursive-orchestrator\scripts\orchestrate-start.ps1 `
  -State C:\Users\Bee\govoff\.orch-run\govwave\state.json `
  -WmuxCli $env:WMUX_CLI `
  -RootPane <paneId> `
  -Chain `
  -Mark
```

Ghi chú:

- `-RootPane` là bắt buộc; thiếu hoặc rỗng phải fail-fast exit `1`.
- `-State` quyết định thư mục wave; mọi result tương đối phải resolve theo thư mục chứa state, không theo CWD của script.
- `-HarvestKill` là opt-in legacy, không dùng mặc định.

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
  -Mark
```

Ghi chú:

- `-Chain` mới bật bước chain-router.
- `-Mark` cho phép crash-recovery mark failed, nhưng chỉ khi có wmux live list.
- `-HarvestKill` (opt-in legacy, KHÔNG nằm trong ví dụ mặc định): reap pane đã có result. Mặc định KHÔNG truyền — pane sống đến khi user tự đóng bằng `close-pane-with-log.js` (xem § Theo dõi và đóng pane thủ công).
- `-RootPane` luôn truyền tường minh khi pass cần spawn nested/chain. Pass harvest-only có thể không cần, nhưng sẽ cảnh báo nếu thiếu.

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

### `scripts/process-nested-requests.js`

Orchestrator xử lý request fan-out trong thư mục wave của `state.json`. Layout mặc định là split theo pane nguồn:

- Child đầu split dọc từ parent/root pane.
- Child tiếp theo split ngang từ pane child trước.
- Nếu `--layout split` mà không resolve được parent pane hoặc `--root-pane`, request phải bị lỗi rõ: `no source pane for split layout; pass --root-pane or use --layout grid`.
- Grid chỉ hợp lệ khi truyền `--layout grid` tường minh.

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

Teardown một wave đã biết theo `state.json`: với từng agent đã đăng ký chạy `wmux agent kill` rồi `close-pane`. Chỉ gỡ UI qua wmux API, không kill OS process.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-panes.ps1 -State .orch-run/p7pack/state.json
```

Khi cần khẩn cấp có thể đóng thủ công:

```powershell
node $env:WMUX_CLI close-pane <paneId>
```

### `scripts/reap-orphan-shells.ps1`

Sweep toàn hệ giết shell `powershell -NoExit` mồ côi mà `close-surface`/`close-pane` để lại (~115MB/shell; chủ yếu là shell tab-trống vì harvest `agent kill` đã giết shell agent). Nhận diện identity-based: đọc env `WMUX_SURFACE_ID` của từng shell (P/Invoke PEB, x64) và đối chiếu live tree — không heuristic.

```powershell
# Dry-run (mặc định, không kill gì): liệt kê orphan + lý do phân loại
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reap-orphan-shells.ps1 -OrchestratorPane <paneId>

# Kill thật toàn bộ orphan / kill đúng 1 pid
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reap-orphan-shells.ps1 -OrchestratorPane <paneId> -Reap
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reap-orphan-shells.ps1 -OrchestratorPane <paneId> -TargetPid <pid>
```

`-OrchestratorPane <paneId>` là BẮT BUỘC thực tế (thay hardcode cũ — pane orchestrator đổi mỗi resume): truyền paneId hiện hành lấy từ `wmux tree`; thiếu/sai -> fail-safe exit 3 không kill gì. JSON summary có `shells: [{pid, sid, reason}]` (map pid↔surfaceId cho mọi candidate — `close-pane-with-log.js` dùng để resolve pid) và `toctouSkippedPids` (pid bị skip do re-check signature+CreationDate ngay trước Stop-Process phát hiện lệch — chống pid-reuse).

An toàn: chỉ kill khi đủ CẢ 4 khoá (cmdline đúng chữ ký surface shell; parent là wmux electron; không thuộc chuỗi tổ tiên của chính script; `WMUX_SURFACE_ID` đọc được và không có trong live tree). Fail-safe exit 3 không kill gì khi không xác định được tập live tin cậy; `-TargetPid` vào pid không phải orphan bị REFUSED exit 2. Chống race lúc hệ đang spawn: orphan trẻ hơn `-MinOrphanAgeMin` (mặc định 2 phút) chỉ bị liệt kê YOUNG-SKIPPED, không kill (kể cả `-TargetPid`) — sẽ được quét ở lần chạy sau. Shell có env đọc được nhưng thiếu `WMUX_SURFACE_ID` xếp UNCERTAIN, không bao giờ kill. Yêu cầu PowerShell 64-bit (offset PEB x64; 32-bit bị từ chối exit 3). Lưu ý: giả định single-window (wmux 0.5.0) — re-validate trước khi dùng trên wmux multi-window.

## Quy ước layout pane

Quy ước trực quan của repo:

- Worker con sâu hơn một cấp: split dọc, pane mới nằm **bên phải** pane nguồn.
- Sibling cùng wave: split ngang, pane mới nằm **bên dưới** sibling trước.
- `process-nested-requests.js` spawn child đầu bằng vertical split từ parent/root pane; child tiếp theo dùng horizontal split từ pane child trước.
- `chain-router.js` spawn link kế bằng vertical split từ pane link trước, fallback về root pane nếu pane trước đã bị harvest.
- Pane worker chỉ còn **1 tab agent**: surface terminal mặc định do `split` tạo được đóng ngay sau khi agent spawn thành công (`closeSurfaceQuiet` trong `pane-spawn.js`; chỉ đóng SAU spawn vì pane tự huỷ khi mất surface cuối; đóng lỗi thì bỏ qua — tab trống còn lại vô hại).

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
- **Mặc định pane SỐNG sau completed** — harvest chỉ mark trạng thái từ result, KHÔNG đóng pane. User tự đóng từng pane bằng `close-pane-with-log.js` (lưu log rồi kill). `orchestrator-pass.ps1 -HarvestKill` là opt-in legacy nếu muốn reap pane tự động như trước.

Với Claude/opencode, harvest coi `agent-<id>-result.md` tồn tại và non-empty là completed.

## Theo dõi và đóng pane thủ công

Mặc định hệ KHÔNG tự đóng pane worker (quyết định 2026-06-10: đóng tay hoàn toàn). Hai công cụ đi kèm:

### `scripts/watch-agent.js` — theo dõi agent real-time

Tail forensics đĩa của agent đang chạy (không phụ thuộc scrollback — `read-screen` chưa hoạt động ở wmux 0.5.0):

```powershell
node scripts/watch-agent.js <agentId|paneId>            # replay từ đầu rồi follow real-time
node scripts/watch-agent.js <agentId> --once            # render hết file hiện có rồi thoát
node scripts/watch-agent.js <agentId> --state <path>    # chỉ định run khi agentId trùng giữa nhiều .orch-run/*
```

- Codex worker: tail `agent-<id>-out.jsonl`, render compact qua `createCodexRenderer`; offset theo BYTE, tự xử lý file bị truncate khi respawn.
- Leader/worker claude: đọc `claudeSessionId` từ state.json (được ghi lúc spawn qua cờ `claude --session-id <uuid>`) -> tail transcript `~/.claude/projects/<slug>/<uuid>.jsonl` render compact. Thiếu field -> lỗi hướng dẫn rõ, không đoán.
- agentId trùng nhiều run: watch tự chọn state mtime mới nhất kèm cảnh báo; truyền `--state` để chỉ định.
- Mọi output qua bộ lọc control-char (strip C0/C1/CSI/OSC) — output worker là untrusted.

### `scripts/orch-status.js` — tổng quan wave + tail bounded (READ-ONLY)

Một lệnh nhìn nhanh MỌI wave/agent của một root (repo bất kỳ) — bảng phân công, `tier`, freshness, intent đang chờ; kèm tail bounded events cuối của 1 worker. Không ghi/sửa gì.

```powershell
node scripts/orch-status.js                       # tổng quan cwd (.orch-run hiện tại)
node scripts/orch-status.js <wave|repo|path>      # 1 wave / repo / state.json (resolve xuyên repo qua tên wave)
node scripts/orch-status.js --discover            # quét mọi repo cấp 1 dưới $HOME có .orch-run (bỏ OneDrive)
node scripts/orch-status.js <target> --tail <id>  # events cuối 1 agent (codex out.jsonl | claude transcript) — byte-slice, KHÔNG đọc cả file
node scripts/orch-status.js <target> --json       # JSON machine-readable cho skill parse
```

- **Phân vai với `watch-agent.js`:** orch-status = tổng quan wave/phân công + tail BOUNDED một-lần (cả codex `out.jsonl` lẫn claude transcript byte-slice); `watch-agent.js` = follow LIVE 1 agent (replay-rồi-theo-dõi, user tự chạy ở terminal). orch-status KHÔNG dùng mode đọc-nguyên-file của watch-agent.
- **State.json untrusted:** mọi `agent.id`/`resultFile` được validate + scope-check trong orchDir trước khi mở file forensics; field thiếu render `-`; state hỏng → 1 dòng `⚠ state unreadable`, không crash cả lệnh.
- **`tier`:** record sinh qua `process-nested-requests.js`/`chain-router.js` mang field `tier` (`leader`/`worker`); wave cũ và record **hand-seed tay** (orchestrator ghi thẳng state) không có field → orch-status in `~leader`/`~worker` (suy diễn engine/chain). Khi hand-seed agent record bằng tay, thêm `tier: 'leader'|'worker'` (claude=leader, codex/opencode=worker) để bảng phân công chính xác.
- Skill project-local **`/watch-agent [target]`** (`.claude/skills/watch-agent/SKILL.md`) điều phối 2 công cụ này thành báo cáo phân công/tư duy/hành động — READ-ONLY, có DATA-ONLY GUARD chống prompt injection.

### `scripts/close-pane-with-log.js` — đóng pane kèm lưu log

Đóng 1 pane worker: render forensics -> lưu snapshot -> kill shell thu hồi RAM (~115MB/shell) -> close pane. **Dry-run mặc định**, chỉ phá huỷ khi `--confirm`:

```powershell
node scripts/close-pane-with-log.js <agentId|paneId>             # dry-run: in kế hoạch + ghi snapshot
node scripts/close-pane-with-log.js <agentId|paneId> --confirm   # agent-kill -> close-pane -> kill shell (verify JSON killed[])
```

- Snapshot lưu tại `.orch-run/<wave>/closed-pane-<agentId>-<ts>.md` (đã sanitize control-char + redact secret qua scan-secrets).
- Agent còn `running|pending` -> REFUSE (đóng sẽ mất result + kẹt slot); `--force` chỉ in lệnh mark state mẫu, KHÔNG tự sửa state.
- Kill shell qua `reap-orphan-shells.ps1 -TargetPid <pid> -MinOrphanAgeMin 0 -OrchestratorPane <pane-live>` — giữ trọn 4 khoá nhận diện; xác nhận kill bằng JSON `killed[]`, KHÔNG tin exit code; fail -> in lệnh khắc phục + exit non-zero.
- Constraint: chạy TRONG pane wmux (gate electron-ancestry) + PowerShell 64-bit; giả định single-window (wmux 0.5.0).

### Phân vai 3 công cụ đóng pane

| Công cụ | Vai trò | Log forensics? |
|---------|---------|----------------|
| `close-pane-with-log.js` | đóng LẺ có log (MẶC ĐỊNH) | Có (snapshot `.md`) |
| `cleanup-panes.ps1` | dọn KHẨN khi state hỏng (đóng hàng loạt) | KHÔNG — cảnh báo MẤT forensics |
| `-HarvestKill` (orchestrate-start / orchestrator-pass) | legacy opt-in reap tự động | Không |

**KHÔNG có reaper sweep tự động** trong luồng mặc định — không caller nào tự chạy `reap-orphan-shells.ps1`; khi cần dọn orphan tồn đọng, user chạy sweep TAY (dry-run trước, `-Reap` sau).

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
- **Cấm bare agent trong wave:** không dùng bare `claude`, `codex exec` ad-hoc, `wmux agent spawn` thô hoặc `layout grid` tay khi hệ đang điều phối.
- **`model_refusal_fallback` là incident:** nếu phiên orchestrator Fable 5 fallback sang Opus 4.8 do refusal, báo user và ghi nhận trong báo cáo vận hành.
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
- `scripts/cleanup-panes.ps1`: teardown wave theo `state.json` (wmux API, không kill process).
- `scripts/reap-orphan-shells.ps1`: reap orphan surface shell toàn hệ (dry-run mặc định, 4 lớp khoá, fail-safe; `-OrchestratorPane` bắt buộc, JSON `shells[]` + TOCTOU re-check).
- `scripts/orch-forensics-map.js`: resolver agentId/paneId -> forensics paths (scan `.orch-run/*/state.json`, disambiguation đa-run, `sanitizeControl`).
- `scripts/watch-agent.js`: theo dõi agent real-time qua forensics đĩa (codex out.jsonl + claude transcript).
- `scripts/orch-status.js`: tổng quan wave/phân công READ-ONLY (resolve xuyên repo + `--discover` + tail bounded); cùng `scripts/orch-status-read.js` (lớp đọc state, validate/scope-check, suy diễn `tier`) và `scripts/orch-status-tail.js` (byte-slice tail codex/claude, fallback result).
- `scripts/close-pane-with-log.js`: đóng pane thủ công — lưu snapshot log rồi kill shell (dry-run mặc định).
- `.claude/skills/watch-agent/SKILL.md`: skill project-local `/watch-agent` — tường thuật orchestration sessions (read-only, DATA-ONLY GUARD, điều phối orch-status + watch-agent).
