---
title: "Investigation: -HarvestKill wiring, forensics mapping, createCodexRenderer reuse, leader watch"
date: 2026-06-10
type: research
status: done
tags: [investigation, harvest-results, forensics, createCodexRenderer, paneId-mapping, leader-claude, watch-feature]
---

# Investigation: -HarvestKill wiring, forensics mapping, createCodexRenderer reuse, leader watch

**Scope:** READ-ONLY investigation để chuẩn bị plan cho 2 feature: (A) watch real-time agent output; (B) manual close pane + render log + kill shell.

**Conclusion:** Tất cả 5 nhóm câu hỏi đều có đáp án chi tiết + evidence + thuật toán mapping 2 chiều + kết luận tái dùng module.

---

## 1. -HarvestKill Wiring — Nơi khai báo / truyền / gọi

### Khai báo tham số

| File | Dòng | Context |
|------|------|---------|
| `scripts/orchestrator-pass.ps1` | 42 | `[switch]$HarvestKill` tham số của function |
| `scripts/orchestrate-start.ps1` | 7 | `[switch]$HarvestKill` tham số của daemon script |

### Truyền cờ

| File | Dòng | Luồng |
|------|------|-------|
| `scripts/orchestrate-start.ps1` | 101 | `if ($HarvestKill) { $args += "-HarvestKill" }` → truyền vào `powershell orchestrator-pass.ps1` |

### Gọi harvest-results.js với --kill flag

| File | Dòng | Code |
|------|------|------|
| `scripts/orchestrator-pass.ps1` | 73-76 | Build `$hv` array: `if ($HarvestKill) { $hv += "--kill" }` → gọi `node harvest-results.js ... --kill` |

### Hành vi khi KHÔNG có -HarvestKill

**File:** `scripts/harvest-results.js` (lines 81, 114)

```javascript
const doKill = hasFlag('--kill');  // line 81 — false nếu không có flag
...
if (doKill && wmuxCli) {  // line 114
  for (const t of toKill) { if (reapPane(wmuxCli, t)) killed.push(...); }
}
```

**Kết quả:**
- Khi KHÔNG có `--kill`: `doKill = false` → block if không chạy → **agent KHÔNG bị kill, pane SỐNG**
- Agent status vẫn được mark `completed` từ result file (lines 97-99) — lifecycle hoàn toàn độc lập với pane
- Wave vẫn được close nếu tất cả agent đều terminal (lines 104-109)
- **Xác nhận:** "bỏ cờ = pane sống nguyên nhưng agent vẫn được mark completed từ result file" ✅

### Các dòng cần sửa để bỏ -HarvestKill khỏi luồng mặc định

**Quyết định:** bỏ 2 dòng, KHÔNG bỏ tham số (để future có thể opt-in):

1. `scripts/orchestrate-start.ps1` line 101: **COMMENT OUT**
   ```powershell
   # if ($HarvestKill) { $args += "-HarvestKill" }  ← đặt dấu # ở đầu
   ```
   Hiện tại: `if ($HarvestKill) { $args += "-HarvestKill" }`

2. `scripts/orchestrator-pass.ps1` line 75: **COMMENT OUT**
   ```powershell
   # if ($HarvestKill) { $hv += "--kill" }  ← đặt dấu # ở đầu
   ```
   Hiện tại: `if ($HarvestKill) { $hv += "--kill" }`

**Tác dụng:** Khi `orchestrate-start.ps1` chạy mà KHÔNG gọi với `-HarvestKill` (default), dòng 101 SKIP → `$HarvestKill` mặc định `$false` (PowerShell switch default) → `orchestrator-pass.ps1` KHÔNG nhận flag → harvest-results.js không thêm `--kill` → pane sống.

**Lưu ý:** Tham số vẫn giữ lại để nếu user muốn opt-in kill thủ công có thể chạy `orchestrate-start.ps1 -HarvestKill $true`.

---

## 2. Mapping paneId/surfaceId → agentId → forensics

### Schema state.json

**Sample:** `.orch-run/p7e2e/state.json` (agent lead-p7e2e-c1, lines 38-59)

```json
{
  "id": "lead-p7e2e-c1",
  "label": "p7e2e-wa-nested",
  "paneId": "pane-a7e92d35-d481-41b1-853c-7f0874e5da2c",
  "surfaceId": "surf-60fd18e4-c3cc-47fe-a07d-399e324c6063",
  "wmuxAgentId": "agent-2d8a31e7-96f9-4354-b220-bd2bc55f4a45",
  "engine": "codex",
  "resultFile": "C:\\Users\\Bee\\recursive-orchestrator\\.orch-run\\p7e2e\\agent-lead-p7e2e-c1-result.md",
  "status": "completed"
}
```

**Field chính:**
- **`id`** (string, unique): agent ID — dùng làm key tra cứu
- **`paneId`** (string): wmux pane UUID — join point chính
- **`surfaceId`** (string): wmux surface UUID — cùng pane có thể có nhiều surface
- **`wmuxAgentId`** (string): wmux agent UUID — cắm vào `wmux agent kill`
- **`engine`** (string): "claude", "codex", "opencode"
- **`resultFile`** (string): path absolute kết quả

### Forensics files mỗi agent

**Mẫu vị trí:** `.orch-run/<wave>/agent-<agent-id>-{output}`

| Engine | File | Schema | Cách tìm |
|--------|------|--------|----------|
| **codex** | `agent-<id>-result.json` | `{ status, filesChanged, decisions, remaining }` | `path.join(orchDir, agent-${id}-result.json)` |
| **codex** | `agent-<id>-out.jsonl` | Dòng JSONL thô từ codex | `path.join(orchDir, agent-${id}-out.jsonl)` |
| **claude** / **opencode** | `agent-<id>-result.md` | Markdown nội dung | `agent.resultFile` hoặc `path.join(orchDir, agent-${id}-result.md)` |

**orchDir = path.dirname(state.json)** (vd `.orch-run/p7e2e/`)

**Discovery lịch sử:** Scan `.orch-run/*/state.json` (tất cả wave dir) để xây dựng bảng tra cứu.

### Thuật toán mapping 2 chiều (pseudocode)

```
/// INPUT: một loạt state.json path, ví dụ:
///   .orch-run/*/state.json → [.orch-run/p7e2e/state.json, .orch-run/orphfix/state.json, ...]

BUILD_LOOKUP():
  paneIdToAgent = Map<paneId, {agentId, waveIndex, engine, forensicsPath}>
  agentIdToPane = Map<agentId, {paneId, surfaceId, waveIndex, engine}>
  
  FOR EACH statePath IN glob(".orch-run/*/state.json"):
    state = JSON.parse(readFile(statePath))
    orchDir = dirname(statePath)
    
    FOR EACH wave IN state.waves:
      FOR EACH agent IN wave.agents:
        paneId = agent.paneId
        agentId = agent.id
        engine = agent.engine || "claude"
        
        IF engine == "codex":
          forensicsPath = join(orchDir, `agent-${agentId}-out.jsonl`)
        ELSE:
          forensicsPath = agent.resultFile || join(orchDir, `agent-${agentId}-result.md`)
        
        paneIdToAgent[paneId] = {agentId, waveIndex, engine, forensicsPath}
        agentIdToPane[agentId] = {paneId, surfaceId, waveIndex, engine}

QUERY_BY_PANE(paneId):
  RETURN paneIdToAgent[paneId] || NULL

QUERY_BY_AGENT(agentId):
  RETURN agentIdToPane[agentId] || NULL

FORENSICS_PATH(agentId):
  entry = agentIdToPane[agentId]
  IF entry:
    IF entry.engine == "codex":
      // Tìm wave dir từ entry.waveIndex
      statePath = glob(".orch-run/*/state.json") tìm match entry.waveIndex
      orchDir = dirname(statePath)
      RETURN join(orchDir, `agent-${agentId}-out.jsonl`)
    ELSE:
      // Đọc agent.resultFile từ state.json
      RETURN (state từ statePath).waves[entry.waveIndex].agents[...].resultFile

LIVE_PANES_NOW():
  tree = node wmux tree  // shell current
  RETURN tree.tree.surfaces[...].paneId (nếu là leaf) HOẶC tree.tree.children[...] (nếu split)
```

### Ví dụ thực tế

**Truy vấn 1:** User chạy `watch pane-a7e92d35-...` (tên pane trên UI)

```
paneId = "pane-a7e92d35-d481-41b1-853c-7f0874e5da2c"
entry = paneIdToAgent[paneId]
  → {agentId: "lead-p7e2e-c1", engine: "codex", forensicsPath: ".orch-run/p7e2e/agent-lead-p7e2e-c1-out.jsonl"}
tail(".orch-run/p7e2e/agent-lead-p7e2e-c1-out.jsonl") | createCodexRenderer()
```

**Truy vấn 2:** User chạy `close-pane-and-log lead-p7e2e-c1` (agent ID)

```
agentId = "lead-p7e2e-c1"
entry = agentIdToPane[agentId]
  → {paneId: "pane-a7e92d35-...", surfaceId: "surf-60fd18e4-...", engine: "codex"}
wmux list-surfaces --pane pane-a7e92d35-... 
  → [{"id": "surf-60fd18e4-...", paneId: "pane-a7e92d35-..."}]
pid = find_process_by_surface_id("surf-60fd18e4-...")
log_path = ".orch-run/p7e2e/closed-pane-lead-p7e2e-c1-<ts>.md"
render_and_save_forensics(forensicsPath, log_path)
Stop-Process $pid
wmux close-pane pane-a7e92d35-...
```

---

## 3. createCodexRenderer tái dùng — module hoá

### Hiện tại trong launch-agent-ext.js

**File:** `scripts/launch-agent-ext.js` lines 58-154

**Export:** Line 199
```javascript
module.exports = { createCodexRenderer };
```

**Signature:**
```javascript
createCodexRenderer(options = {})
  → returns { write(chunk), end() }
```

**Input:**
- `chunk` (Buffer|string): JSONL line từ codex stdout
- HOẶC từ file: read file → split line → pass vào `renderer.write(line)`

**Output behavior:**
- `write(chunk)`: phân tích JSONL → gọi callback `options.write(output_string)` 
  - Default: `process.stdout.write(output_string)`
  - Tùy biến: `write: (s) => fileHandle.write(s)`
- `end()`: flush buffer cuối cùng

**Stateful:** Có `buffer` (line 68) lưu dòng chưa hoàn chỉnh, nhưng `write()` đã xử lý line-split (line 139-141). Đủ idempotent để tái dùng.

### Kích thước file

**Hiện tại:** ~200 dòng (lines 1-199)
- Core `createCodexRenderer` = lines 58-154 (~97 dòng)
- Helper functions (colors, render event) = lines 58-121 (~64 dòng nesting)

Đáp ứng rule repo: file <200 dòng. **Không cần tách module riêng.**

### Cách tái dùng

**Cách 1 (KHẢ TRANG):** Import trực tiếp từ `launch-agent-ext.js`
```javascript
const { createCodexRenderer } = require('./scripts/launch-agent-ext.js');

// Sử dụng để render file tĩnh:
const renderer = createCodexRenderer({ 
  write: (s) => fs.appendFileSync(logPath, s) 
});
const lines = fs.readFileSync('.orch-run/p7e2e/agent-lead-p7e2e-c1-out.jsonl', 'utf8')
  .split('\n');
for (const line of lines) renderer.write(line + '\n');
renderer.end();
```

**Cách 2 (ĐỘC LẬP HƠN):** Tách `createCodexRenderer` ra `scripts/codex-renderer.js` (~100 dòng)
- Pro: reuse rõ ràng, không phụ thuộc launcher CLI
- Con: +1 file, module duy nhất chỉ phục vụ watch/close (YAGNI)

**Khuyến cáo:** **Cách 1** đủ. Tái dùng trực tiếp từ launcher. Nếu sau này watch/close trở thành multi-file phức tạp, thì tách module.

### Replay static file

**Test:** Render 1 file `out.jsonl` cũ từ đầu

```javascript
const fs = require('fs');
const { createCodexRenderer } = require('./scripts/launch-agent-ext.js');

const filePath = '.orch-run/p7e2e/agent-lead-p7e2e-c1-out.jsonl';
const renderer = createCodexRenderer({ noColor: false });

if (fs.existsSync(filePath)) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/).filter(Boolean);
  lines.forEach(line => renderer.write(line + '\n'));
  renderer.end();
}
```

**Kết quả:** Render render compact ANSI từ đầu → in ra stdout hoặc save vào file. ✅ **Fully supported.**

---

## 4. Watch leader Claude (TUI) — transcript mapping + event format

### Session ID mapping

**Cơ chế:** context-meter.js lines 49-59 (Scout verified)

```javascript
function findTranscript() {
  if (transcriptArg && fs.existsSync(transcriptArg)) return transcriptArg;
  if (!sessionId) return null;
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return null;
  for (const proj of fs.readdirSync(projectsRoot)) {
    const candidate = path.join(projectsRoot, proj, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
```

**Thuật toán:**
1. Env `CLAUDE_CODE_SESSION_ID` → UUID (truyền từ launcher khi spawn leader)
2. Scan `~/.claude/projects/<*>/<sessionId>.jsonl`
3. Tìm file khớp → return path

**Schema:** `~/.claude/projects/<project-slug>/<sessionId>.jsonl`
- `<project-slug>` = dir mã hoá slug, ví dụ `C--Users-Bee-recursive-orchestrator`
- `<sessionId>` = UUID từ env

**Vấn đề:** state.json **KHÔNG lưu session ID của worker/leader claude**

- Worker codex: lưu kèm `engine: "codex"` → dùng `out.jsonl`
- Leader claude: **KHÔNG có** session ID field → cần truyền env

**Cách khả thi lấy session ID:**

| Cách | Khả thi | Chi tiết |
|------|---------|----------|
| **Lưu env vào state.json** | ⚠️ Medium | Leader spawn script thêm `"claudeSessionId": process.env.CLAUDE_CODE_SESSION_ID` vào agent record. Yêu cầu sửa `launch-agent-ext.js` + caller nơi spawn leader |
| **Scan transcript mtime mới nhất** | ⚠️ Low | Giả sử leader là transcript được tạo gần nhất trong project → dễ sai nếu multi-session. Non-deterministic |
| **Truyền qua prompt metadata** | ⚠️ Medium | Prompt file đầu đã ghi `<!-- SESSION_ID: ... -->` hoặc tham số → leader parse → ghi vào result comment. Cần reader phân tích |
| **RECOMMENDED: Orchest spawn thêm field** | ✅ Best | Khi spawn leader, orchestrator set env `CLAUDE_CODE_SESSION_ID=$(uuidgen)` (Windows PowerShell: `[guid]::NewGuid()`) → rồi GHI field vào state.json: `claudeSessionId`. Lúc watch/close tra cứu thẳng |

**Đánh giá effort:** Cách RECOMMENDED = +3 dòng state update (medium effort, 1 patch nhỏ).

### Event structure của transcript JSONL

**File:** `~/.claude/projects/<slug>/<uuid>.jsonl` — mỗi dòng là 1 event

**Sample event từ context-meter.js** (lines 65-76, đọc usage):

```json
{
  "message": {
    "usage": {
      "input_tokens": 45000,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 10000,
      "output_tokens": 2000
    }
  }
}
```

**Event type dự kiến:**
- `type: "user"` — message input từ orchestrator
- `type: "assistant"` — response từ claude
- `type: "tool_use"` — gọi tool (bash, read, edit, etc.)
- `type: "tool_result"` — kết quả tool
- `usage` field — token count (không phải mỗi event đều có)

**Render compact cho leader:** 
- Tương tự codex renderer (WI-2), tóm tắt 1 event → 1 dòng output
- Ví dụ: `[user] 3 words` / `[assistant] 234 tokens` / `[tool] bash "ls"` / `[result] ✓ 5 files`

**Size kỳ vọng:** Transcript leader ~50-200 dòng JSON/session, mỗi event ~200-500 bytes → **≤100KB/session**.

---

## 5. Bề mặt wmux CLI cho watch/close + surface phụ

### Lệnh liên quan (từ wmux.js)

**Read-only lệnh:** tree, list-surfaces, agent list, pane list

| Lệnh | Input | Output | Dùng cho |
|------|-------|--------|----------|
| `wmux tree` | (none) | `{tree: {type, paneId, surfaces: [{id, type, shell}]}}` | Lấy layout hiện tại + danh sách pane + surface |
| `wmux list-surfaces [--pane paneId]` | `--pane` (optional) | `{surfaces: [{id, paneId, type, isActive}]}` | List surface của pane hoặc tất cả |
| `wmux agent list [--workspace id]` | `--workspace` (optional) | `{agents: [{id, status, paneId}]}` | Danh sách agent live |
| `wmux pane list [--workspace id]` | `--workspace` (optional) | `{panes: [...]}` | Danh sách pane |

**Write lệnh:** split, close-pane, agent kill, new-surface

| Lệnh | Input | Output | Dùng cho |
|------|-------|--------|----------|
| `wmux split [--down] [--pane id] [--type T]` | `--pane` (target pane để split) | `{paneId, ...}` | Tạo pane mới (split current HOẶC --pane) |
| `wmux close-pane <paneId>` | paneId | JSON confirm | Đóng pane + UI collapse |
| `wmux agent kill <agentId>` | wmuxAgentId | JSON confirm | Kill agent process (pane shell vẫn sống -NoExit) |
| `wmux new-surface [--type T] [--color-scheme]` | type (terminal/markdown) | `{id, type}` | Tạo surface mới |

### Tạo SURFACE MỚI trong pane TỒN TẠI?

**Question:** Có lệnh nào mở tab mới trong pane hiện tại (không split pane) không?

**Answer:** **KHÔNG có** lệnh `new-surface --pane <id>` trong wmux.js.

**Cơ chế wmux:** 
- Pane = layout cell (có thể split ngang/dọc)
- Surface = terminal tab trong pane (1 pane có 1+ surface)
- `new-surface` tạo surface **GLOBAL** (floating hoặc active pane)
- KHÔNG có cách chỉ định "tạo surface vào pane X"

**Hậu quả cho watch feature:**
- **Option A:** Tạo pane **MỚI** dành watch bằng split (chia layout)
  - Pro: layout rõ ràng, không ảnh hưởng pane agent
  - Con: layout thêm phức tạp
- **Option B:** Monitor tail output vào **terminal ở ngoài** (bash loop, Monitor tool, hoặc PowerShell)
  - Pro: không cần UI mux, thuần script
  - Con: user cần cửa sổ riêng

**Khuyến cáo cho plan:** **Option B** (tail script ngoài pane) là phương pháp chính, cost thấp. Option A (split pane watch) là upgrade future nếu UX cần.

### Output JSON shape của tree + list-surfaces

**Verified từ wmux tree (live run):**

```json
{
  "tree": {
    "type": "leaf",
    "paneId": "pane-365eb7fa-638d-4276-bcd6-718f6901db26",
    "surfaces": [
      {
        "id": "surf-5f296277-09bd-4989-aded-2152d29e7a50",
        "type": "terminal",
        "shell": "powershell.exe"
      }
    ],
    "activeSurfaceIndex": 0
  }
}
```

**Verified từ wmux list-surfaces (live run):**

```json
{
  "surfaces": [
    {
      "id": "surf-5f296277-09bd-4989-aded-2152d29e7a50",
      "type": "terminal",
      "paneId": "pane-365eb7fa-638d-4276-bcd6-718f6901db26",
      "isActive": true
    }
  ]
}
```

**Tree structure (split pane):** type = "split" (có `direction`, `first`, `second` children):
- `{type: "split", direction: "right", first: {...}, second: {...}}`
- Leaf: `{type: "leaf", paneId, surfaces}`

---

## Unresolved Questions

| # | Câu hỏi | Ảnh hưởng | Phụ thuộc |
|---|--------|----------|----------|
| **Q1** | wmux config.toml có hỗ trợ map keybinding → shell command không? | Watch/close skill có thể bind phím tắt hay phải gõ lệnh | Phiên sau verify config.toml / wmux capabilities |
| **Q2** | Leader claude: cần patch launch-agent-ext.js để ghi `claudeSessionId` vào state.json không? | Mapping session→transcript | Design decision: ghi env vào state vs scan mtime |
| **Q3** | multi-window wmux: `system.tree` trả toàn bộ hay chỉ window active? | Reaper/skill xác định live pane có sai không | wmux spec / wmux 0.6.0+ | 

---

## Summary

✅ **-HarvestKill wiring:** 2 dòng cần comment (orchestrate-start:101, orchestrator-pass:75); harvest-results.js sẽ SKIP kill pane khi --kill KHÔNG có.

✅ **Mapping 2 chiều:** Scan .orch-run/*/state.json → build lookup paneId↔agentId↔forensicsPath; pseudocode cẩn thận cho planner.

✅ **createCodexRenderer:** Export sẵn line 199; tái dùng trực tiếp từ launcher (không cần tách module); full support replay static file.

✅ **Leader watch:** Cần lưu session ID (recommend: env → state field); transcript scan phương pháp context-meter.js; event format đơn giản JSON/dòng.

✅ **wmux CLI:** tree, list-surfaces verified output shape; KHÔNG có "tạo surface trong pane tồn tại" → dùng tail script ngoài.

---

**Status:** DONE
**Summary:** 5 nhóm investigate đầy đủ, evidence cụ thể file:line, thuật toán mapping sẵn dùng cho planner, kết luận rõ ràng reuse module.
**Concerns/Blockers:** None — all data ready for plan phase.
