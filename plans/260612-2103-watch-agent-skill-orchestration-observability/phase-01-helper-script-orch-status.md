---
phase: 1
title: "Helper script orch-status"
status: done
priority: P2
effort: "3-4h"
dependencies: []
---

# Phase 1: Helper script orch-status

<!-- Updated: Validation Session 1 - thêm write-path tier (Q2), --discover (Q3), chính xác hóa reuse (Q1) -->
<!-- Updated: Red Team Session 2026-06-12 - F1 resolver cross-repo wave; F3 tier mapping; F5/F6 tail robustness; F7 tail claude bounded; F9 schema variance; F11 discover hardening; F13 stalled; F14 read-path validation -->

## Overview

Tạo `scripts/orch-status.js` — tổng quan 1-lệnh mọi wave/agent của một root (repo bất kỳ), kèm `--tail` render nhanh events cuối của 1 worker codex, `--discover` quét mọi repo có orchestration. Script MỚI là READ-ONLY tuyệt đối; phase này kèm 1 thay đổi write-path nhỏ: ghi field `tier` vào agent record lúc tạo (quyết định user, Validation S1 Q2).

## Requirements

- Functional: summary mode + tail mode (codex + claude bounded) + json mode + discover mode; resolve target linh hoạt (gồm cross-repo wave); cảnh báo stalled/done-unharvested; read-path validate state untrusted; agent record mới có field `tier` ('leader'|'worker').
- Non-functional: gọn — 1 file ~200 dòng, scope sau red-team cho phép tách thành tối đa 2 file (vd `orch-status.js` + `orch-status-tail.js`), mỗi file <200 dòng; chạy <5s trên repo có ~25 wave (discover chỉ stat dir cấp 1 + skip OneDrive); orch-status không ghi/sửa file nào; PowerShell 5.1-safe khi gọi (arg đơn giản, không here-string).

## Architecture

- Resolve target (positional, optional):
  1. Absolute path: `*.json` → coi là state.json; dir chứa `state.json` → wave dir; dir chứa `.orch-run` → repo root (quét mọi wave).
  2. Tên trần: thử wave dưới `<cwd>\.orch-run\<tên>\state.json` → rồi repo `C:\Users\Bee\<tên>\.orch-run\` → **(2.5, Red-team F1)** chưa thấy: chạy logic discover, tìm wave trùng tên trong các repo phát hiện được (vd `gantt-sync` nằm trong govoff khi đứng ở repo này); đúng 1 hit → dùng + in rõ "resolved → <path>"; nhiều hit → liệt kê, exit 2 → không thấy: lỗi rõ kèm gợi ý.
  3. Không arg: quét `<cwd>\.orch-run\` (gồm cả `state.json` ROOT-level nếu có — orch-forensics-map.js:22-23 hỗ trợ; repo này có file đó thật — Red-team F11).
  4. `--discover`: quét mọi thư mục con CẤP 1 của `C:\Users\Bee` có `.orch-run` (chỉ `fs.existsSync(<dir>\.orch-run)` — không recurse) + cwd nếu nằm ngoài; in tổng quan từng repo, sort theo **max mtime các state.json** của repo (mtime dir `.orch-run` không đổi khi update wave — Red-team F11); skip-list `OneDrive` (placeholder hydration có thể treo existsSync) + try/catch per-dir.
- Quét wave + reuse (chính xác hóa Validation S1 Q1): `buildLookup` của `orch-forensics-map.js` THIẾU label/status/depth/timestamps → summary TỰ ĐỌC state.json (strip BOM như `nested-state.js:34`); vẫn reuse `resolveTarget` (tail mode — non-strict, in `warning` khi id trùng nhiều run), `sanitizeControl`, `forensicsPath`, `createCodexRenderer`. KHÔNG refactor orch-forensics-map.js.
- **Read-path validation (Red-team F14 — state.json là UNTRUSTED input):** `agent.id` phải khớp pattern an toàn (chữ-số-gạch, như `isValidAgentId` các writer dùng) trước khi dựng đường dẫn; mọi đường dẫn forensics/result sau `path.resolve(orchDir, ...)` phải `startsWith(orchDir)` (normalize trước) — vi phạm → bỏ qua agent + in `⚠ unsafe path skipped`. Không render file ngoài orchDir của wave.
- **Write-path tier (quyết định user, Validation S1 Q2; công thức sửa theo Red-team F3):**
  - `process-nested-requests.js` (kids map ~152): `tier: engine === 'claude' ? 'leader' : 'worker'` — codex VÀ opencode đều worker (nested-state.js:23 có 3 engine; harvest xếp opencode nhóm worker).
  - `chain-router.js` (link record ~190): `tier: from.agent.tier || 'worker'` — chain link KẾ THỪA vai từ from-agent (link là continuation cùng vai, kể cả engine claude — bằng chứng test-leader-aggregate-phase5c.js:40 claude link là worker continuation dưới leader).
  - Thuần additive — không đổi field nào hiện có, KHÔNG đụng `launch-agent-ext.js`.
  - **Coverage gap đã biết (Red-team F4):** tồn tại đường hand-seed thứ 3 (orchestrator ghi record tay — bằng chứng waves lmodel/wpatch2/htest thiếu resultFile/toolUses) → record hand-seed sẽ KHÔNG có tier, orch-status in `~tier` suy diễn. Phase 3 cập nhật docs snippet hand-seed ghi kèm `tier`.
- Summary mode (default, mỗi wave sort theo mtime state desc):
  - Header: tên wave, statePath, đếm intent pending (`nested-request-*`/`chain-request-*` có `status` TOP-LEVEL === "pending" — verified structure: 1 file per parentAgentId/chainId).
  - Mỗi agent 1 dòng: `id | label | engine | tier | status | depth | started→finished` + `out=<bytes>@<mtime HH:mm:ss>` (codex) + `result=<status từ result.json>` nếu có + `sid=<claudeSessionId 8 ký tự>` nếu có. `tier` đọc từ field state nếu có; record thiếu tier → suy diễn: có `chainId` → `~worker`; còn lại theo engine (`claude`→`~leader`, khác→`~worker`) — luôn kèm `~` đánh dấu suy diễn (Red-team F3).
  - **Schema variance (Red-team F9):** 25 wave hiện có 7 biến thể record (htest thiếu paneId/subtask; lmodel/wpatch2 thiếu resultFile/toolUses; wpatch có crashReason/crashedAt + status `crashed`; dchain* có chainId/linkSeq/leaderAgentId) → MỌI field đều optional với reader, thiếu render `-`; try/catch per-state-file VÀ per-wave: state hỏng/JSON cụt vẫn in 1 dòng `<wave> | ⚠ state unreadable (<err>)` — KHÔNG crash cả lệnh, KHÔNG skip im lặng (Red-team F9 + tiền lệ xấu buildLookup catch{continue}).
  - Heuristic trạng thái (thứ tự ưu tiên — Red-team F13): (1) result.json/md tồn tại + parse được → in `done-unharvested` dù state ghi running (lifecycle harvest thủ công — docs:298); (2) `status===running` && KHÔNG result && out.jsonl mtime cũ hơn 5 phút → `⚠ stalled?` (heuristic mtime — codex không emit timestamp per-event, lệnh dài không ghi event → chấp nhận false-positive có dấu `?`); (3) `status===running` && không có out.jsonl → `⚠ no-output`; (4) `status===crashed` → in kèm crashReason nếu có.
- `--tail <agentId> [-n 40]` (codex): đọc tối đa 64KB CUỐI `agent-<id>-out.jsonl` (fs.read theo offset, KHÔNG đọc cả file); **trim partial CẢ HAI ĐẦU slice** (bỏ phần trước newline đầu VÀ sau newline cuối — event đang ghi dở); slice sau trim có 0 event → nhân đôi slice (cap 256KB), vẫn 0 → in `(event cuối quá lớn >256KB — dùng watch-agent.js)`; khi leading-trim bỏ ≥8KB → in `⚠ skipped oversized event ~<N>KB` (Red-team F5 — đo thật 5/5 file có dòng >64KB đều bị cắt; KHÔNG hứa đủ `-n` events khi slice không chứa). Render qua `createCodexRenderer` với **write tùy chỉnh bọc `sanitizeControl`** (như watch-agent.js:102 — default write KHÔNG sanitize), **KHÔNG gọi `renderer.end()`** (end flush raw buffer dòng cụt — launch-agent-ext.js:144-148; Red-team F6).
- `--tail <agentId>` (claude — Red-team F7): KHÔNG dùng `watch-agent.js --once` (nó readFileSync NGUYÊN file — transcript thật 2.7MB); orch-status TỰ tail: lấy `claudeSessionId` từ state → tìm transcript (logic như `findTranscript` watch-agent.js:25-34) → byte-slice 64KB cuối (same trim rules) → render từng dòng qua `renderClaudeLine` (đã export — watch-agent.js:142) với write bọc sanitizeControl. Thiếu `claudeSessionId` (100% claude agent cũ — Red-team F8) → fallback: in 40 dòng cuối `agent-<id>-result.md` (bounded) + message `(không có claudeSessionId — chỉ có result)`.
- `--json`: in JSON machine-readable (waves/agents đủ field trên) cho skill parse.
- Output text đi qua `sanitizeControl` (out.jsonl là untrusted).

## Related Code Files

- Create: `scripts/orch-status.js`
- Create: `scripts/spike/test-orch-status.js` (+ fixture mới trong `scripts/spike/fixtures/` nếu cần — tái dùng fixture watch-agent nếu khớp)
- Modify: `scripts/process-nested-requests.js` (thêm `tier` vào kids map ~dòng 152) + `scripts/chain-router.js` (thêm `tier` vào agent record ~dòng 190) — THUẦN ADDITIVE, Validation S1 Q2
- Modify: KHÔNG file nào khác (cấm sửa orch-forensics-map.js/watch-agent.js/launch-agent-ext.js — chỉ require)

## Implementation Steps

1. Viết resolver target theo thứ tự trên (hàm thuần, test được), gồm nhánh 2.5 cross-repo wave (F1) + `--discover` (sort max-mtime state, skip OneDrive).
2. Viết reader wave: TỰ load state.json (strip BOM như nested-state.js:34 — buildLookup không đủ field), MỌI field optional (7 biến thể schema — F9), try/catch per-state + per-wave in `⚠ state unreadable`, validate `agent.id` + scope-check đường dẫn (F14), gom field (kèm `tier`, fallback suy diễn `~` theo chainId/engine — F3), stat out.jsonl/result.json.
3. Summary printer + heuristic theo thứ tự ưu tiên: done-unharvested (result-file thắng — F13) → stalled? → no-output → crashed.
4. Tail mode codex: byte-slice 64KB cuối, trim partial 2 đầu, nhân đôi khi 0-event (cap 256KB), cảnh báo oversized (F5); render qua `createCodexRenderer` với write bọc sanitizeControl, KHÔNG gọi `end()` (F6).
5. Tail mode claude: claudeSessionId → transcript byte-slice + `renderClaudeLine` (re-use export watch-agent.js:142); thiếu sid → fallback result.md bounded (F7, F8).
6. `--json` mode.
7. Thêm `tier` vào agent record: `process-nested-requests.js` kids map — `engine === 'claude' ? 'leader' : 'worker'`; `chain-router.js` link record — `from.agent.tier || 'worker'` (kế thừa — F3); thêm assertion tier vào test nested/chain hiện có HOẶC test-orch-status (không phá schema cũ — đã kiểm: suite không có deepEqual trọn record).
8. `node --check`; viết `test-orch-status.js`: resolver (6 nhánh gồm cross-repo wave + discover), summary đúng trường (tier thật + tier suy diễn: chain claude → ~worker, nested claude → ~leader, opencode → ~worker), heuristic done-unharvested/stalled (mtime giả), tail không vỡ với dòng cụt ĐẦU + CUỐI slice + strip control-char + oversized event, state.json rỗng/cụt → dòng unreadable không crash, resultFile trỏ ngoài orchDir → bị chặn `⚠ unsafe path skipped`, root-level `.orch-run\state.json` được quét, exit 0 khi root rỗng ("no waves"), exit 2 khi target không resolve.
9. Chạy FULL suite `scripts/spike/test-*.js` — không phá test cũ (đặc biệt test-nested-phase4 + test-chain-phase5 sau khi thêm tier).

## Success Criteria

- [ ] `node scripts/orch-status.js` (repo này) liệt kê govinv/mrfix... đúng status đã biết; wave hỏng (nếu có) in `⚠ state unreadable` không crash; root-level state.json được quét
- [ ] `node scripts/orch-status.js govoff` liệt kê mrsmoke + gantt-sync (multi-repo, tên trần)
- [ ] `node scripts/orch-status.js gantt-sync` (đứng tại repo này) resolve XUYÊN repo ra govoff qua nhánh 2.5 + in "resolved → ..." (Red-team F1)
- [ ] `node scripts/orch-status.js --discover` tìm thấy tối thiểu recursive-orchestrator + govoff (quét C:\Users\Bee cấp 1, skip OneDrive), sort repo hoạt động mới nhất trước
- [ ] `node scripts/orch-status.js C:\Users\Bee\govoff\.orch-run\gantt-sync\state.json --tail orch-root-c3` render events cuối apply-sync, không dump raw JSON cụt
- [ ] Tail 1 agent claude: có sid → transcript bounded; không sid (mọi claude agent cũ) → fallback result.md bounded + message rõ
- [ ] Agent record mới (qua process-nested-requests/chain-router) có `tier` đúng (nested claude=leader, codex/opencode=worker, chain link kế thừa); waves cũ hiển thị `~tier` suy diễn
- [ ] test-orch-status.js PASS + full suite PASS + node --check sạch

## Risk Assessment

- ~~API orch-forensics-map không khớp~~ ĐÃ XÁC MINH (Validation S1): buildLookup thiếu field → summary tự đọc state.json; reuse resolveTarget/sanitizeControl/forensicsPath/createCodexRenderer.
- Sửa write-path đã ship (process-nested-requests/chain-router, suite 254 PASS) → field thuần additive, không đổi field cũ; full suite re-run bắt regression; reader coi `tier` optional nên waves cũ/state lệch version không vỡ; đường hand-seed thứ 3 không có tier (gap đã chấp nhận — F4, docs sẽ hướng dẫn).
- out.jsonl đang được ghi (worker sống) → ~~renderer tự skip event cụt~~ **SAI (Red-team F6): renderer echo RAW dòng parse-fail và `end()` flush raw buffer** → bắt buộc trim partial 2 đầu slice + write bọc sanitizeControl + không gọi `end()`.
- Event đơn >64KB (đo thật: 5/5 file có dòng >64KB, max 240KB) → slice adaptive cap 256KB + cảnh báo oversized; phase 3 nghiệm thu thêm trên wave có event lớn (agfix/wpatch), không chỉ gantt-sync (F5).
- state.json là untrusted input: id/resultFile có thể chứa path traversal → validate + scope-check, skip + cảnh báo (F14).
- Torn read khi writer init state bằng WriteAllText non-atomic (docs:62) → try/catch per-state in unreadable, lần chạy sau tự lành (F9).
- Tên repo trùng tên wave → thứ tự resolve đã chốt (wave cwd trước, repo sau) + in rõ đã resolve thành gì; agentId trùng nhiều run trong tail → resolveTarget non-strict chọn newest + in warning sẵn có.
- `--discover` đụng dir không quyền đọc/OneDrive placeholder → skip-list OneDrive, try/catch per-dir, không crash; vẫn in tên dir bị skip ở stderr (không im lặng hoàn toàn).
