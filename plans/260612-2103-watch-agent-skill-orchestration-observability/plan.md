---
title: "Skill /watch-agent - quan sat nhanh orchestration sessions"
description: "Skill project-local /watch-agent [target]: từ repo này nhìn nhanh mọi orchestration session (repo bất kỳ) — ai phân công gì, leader/worker đang nghĩ/làm gì; kèm helper scripts/orch-status.js"
status: pending
priority: P2
created: 2026-06-12
---

# Skill /watch-agent - quan sat nhanh orchestration sessions

## Overview

User cần gõ `/watch-agent [tên session]` tại repo `recursive-orchestrator` và nhận ngay báo cáo: orchestrator ở các session khác (vd govoff, wmux session 2) đang phân công ra sao, leader/worker đang tư duy + hành động thế nào.

Nguyên liệu đã có đủ trên đĩa (không cần spawn gì, READ-ONLY 100%):

| Nguồn | Cho biết |
|-------|----------|
| `<work-repo>\.orch-run\<wave>\state.json` | phân công: id, label, subtask, engine, status, depth, timestamps; `tier` ghi mới từ Validation S1 (waves cũ không có → suy diễn từ engine) |
| `nested-request/response-*.json`, `chain-request-*`, `relay-*` | intent ủy quyền đang chờ/đã xử |
| `agent-<id>-out.jsonl` (codex) | hành động + "tư duy": lệnh `$`, ✓/✗, ✎ file, ▣ result decisions |
| `agent-<id>-result.{json,md}` | kết luận worker |
| `claudeSessionId` → `~/.claude/projects/<slug>/<uuid>.jsonl` | leader/worker claude: thinking + messages (lưu ý Red-team F8: 100% claude agent wave CŨ thiếu sid → fallback result.md) |

Thiếu 2 thứ: **bộ tổng hợp 1-lệnh** (hiện `watch-agent.js` chỉ soi 1 agent, không có cái nhìn wave/phân công) + **field `tier` trong state** (Validation S1 Q2 — user quyết ghi lúc tạo agent record). → Phase 1 thêm `scripts/orch-status.js` (mỏng, tái dùng `resolveTarget`/`sanitizeControl`/`forensicsPath` + `createCodexRenderer`; summary tự đọc state.json) + ghi `tier` tại `process-nested-requests.js`/`chain-router.js`; Phase 2 viết SKILL.md điều phối các công cụ; Phase 3 validate trên dữ liệu thật (wave `gantt-sync` govoff do session 2 vừa chạy 2026-06-12 20:50 — 2 đợt, 3 worker codex, completed).

Mode: fast (task nhỏ, rõ, chỉ chạm repo này + `.claude/skills/` local). YAGNI: không build daemon/UI; chỉ script tổng quan + skill hướng dẫn.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Helper script orch-status](./phase-01-helper-script-orch-status.md) | Pending |
| 2 | [Skill watch-agent SKILL.md](./phase-02-skill-watch-agent-skill-md.md) | Pending |
| 3 | [E2E validation va docs](./phase-03-e2e-validation-va-docs.md) | Pending |

## Dependencies

- Không block / không bị block bởi plan nào (4 plan trước đều done; xây trên tooling đã ship ở `260610-2149` + `260612-0026`).
- Three-tier + multi-repo doctrine: theo `docs/orchestration-system.md` (Multi-repo mode) — skill chỉ ĐỌC, không spawn/kill nên không đụng RootPane/reaper.

## Quyết định thiết kế chốt

1. **Skill project-local** tại `.claude/skills/watch-agent/SKILL.md` repo này (user: "ngay tại repo recursive-orchestrator này là đủ").
2. **`[tên session]` resolve linh hoạt** (thứ tự): absolute path (state.json | wave dir | repo) → tên wave dưới `<cwd>\.orch-run\` → tên repo `C:\Users\Bee\<tên>` có `.orch-run` (quét mọi wave, mới nhất trước) → **tên wave XUYÊN repo qua discover (Red-team F1 — vd `gantt-sync` từ repo này)** → không arg = discovery: quét cwd + mọi thư mục con cấp 1 `C:\Users\Bee\*` có `.orch-run` (Validation S1 — thay "danh sách work-repo đã biết" bằng quét tự động; hardening F11: skip OneDrive, sort max-mtime state, không auto deep-dive).
3. **Tách vai 2 công cụ (điều chỉnh Red-team F7):** `orch-status.js` = tổng quan wave + tail BOUNDED một-lần (cả codex out.jsonl lẫn claude transcript byte-slice); `watch-agent.js` (sẵn có) = follow LIVE 1 agent cho user tự chạy ở terminal — skill không tự chạy mode đọc-nguyên-file của nó.
4. **Bounded reads mọi nơi** — không cat nguyên out.jsonl/transcript (15MB bài học govinv); tail theo byte slice.
5. Orchestrator session của repo đích KHÔNG nằm trong `.orch-run` — "orchestrator đang nghĩ gì" đọc best-effort từ jsonl mtime mới nhất trong `~/.claude/projects/<slug>/`, tail bounded, chỉ đọc.

## Validation Log

### Session 1 — 2026-06-12
**Trigger:** User chốt phiên trước: chạy `/ck:plan validate` trước khi cook (gate 1/2).
**Questions asked:** 4

### Verification Results
- **Tier:** Standard (Fact Checker + Contract Verifier)
- **Claims checked:** 24
- **Verified:** 22 | **Failed:** 1 | **Unverified:** 1 (partial)

#### Failures
1. [Fact Checker] Phase 3 ghi docs/orchestration-system.md "hiện 594" dòng — thực tế **437** (constraint <800 vẫn thỏa). → sửa số.
   **⚠ ĐÍNH CHÍNH (Red Team 2026-06-12, F12):** failure này là FALSE — số đo 437 lấy từ `Measure-Object -Line` vốn CHỈ đếm dòng non-blank; số dòng vật lý là **594** (594 = 437 non-blank + 157 dòng trống; xác nhận lại bằng `(Get-Content).Count` + cả 3 reviewer `wc -l`). Con số 594 trong plan gốc ĐÚNG từ đầu; Validation S1 đã tạo regression đúng→sai và phase files đã được sửa lại về 594. Bài học: đếm dòng bằng `(Get-Content ...).Count` hoặc `wc -l`, không dùng `Measure-Object -Line`.
2. [Fact Checker — partial] Phase 2 cột "engine/tier" — state.json KHÔNG có field `tier`/`model` ở agent (verified gantt-sync + mrfix state). → user quyết: thêm `tier` vào write-path.

#### Bằng chứng VERIFIED chính
- `orch-forensics-map.js:116` exports `{buildLookup, resolveTarget, forensicsPath, sanitizeControl}`; `stateFiles()` quét `.orch-run/*/state.json` nhận `options.root` — nhưng entry `buildLookup` THIẾU label/status/depth/timestamps → summary phải tự đọc state.json.
- `launch-agent-ext.js:195` exports `createCodexRenderer`; `watch-agent.js:14,17` có `--state`/`--once`; `nested-state.js:34` strip BOM.
- Agent record sinh tại `process-nested-requests.js:150-155` + `chain-router.js:190` (chỗ thêm `tier` — KHÔNG cần đụng launch-agent-ext.js).
- Wave `gantt-sync` govoff còn nguyên: 2 đợt (c1 diff-gantt + c2 diff-ws-sheets → c3 apply-sync), 3 codex completed, out.jsonl 127-200KB, có backup/. Intent files: `nested-request-<parent>.json`/`chain-request-*.json` có `status` TOP-LEVEL ("pending"/"processed"/"denied"); `relay-*.json` tồn tại.
- Repo này 25 wave (khớp "~25"); `.claude/skills/` local CHƯA tồn tại; docs mục "Theo dõi và đóng pane thủ công" tại dòng 498.

#### Questions & Answers

1. **[Risks]** Verification tìm thấy 2 điểm stale: (1) docs 594→thực tế 437 dòng; (2) "tái dùng export orch-forensics-map nếu API phù hợp" — buildLookup thiếu field cho summary. Sửa cả 2 vào phase files?
   - Options: Sửa cả hai (Recommended) | Chỉ sửa số dòng docs | Giữ nguyên
   - **Answer:** Sửa cả hai
   - **Rationale:** Plan chính xác với codebase thật; người cook không phải tự phát hiện lại.

2. **[Architecture]** Bảng phân công ghi "engine/tier" nhưng state.json không có field tier. Hiển thị thế nào?
   - Options: Suy diễn từ engine (Recommended) | Chỉ in engine | Thêm tier vào state khi launch
   - **Answer:** **Thêm tier vào state khi launch** (user override recommendation — MỞ RỘNG SCOPE)
   - **Rationale:** Tier thành dữ liệu gốc cho wave mới. Ghi tại điểm TẠO agent record (`process-nested-requests.js` + `chain-router.js`), KHÔNG đụng launch-agent-ext.js (lệnh cấm sửa giữ nguyên). Waves cũ không có field → orch-status fallback suy diễn kèm nhãn `~`.
   **Điều chỉnh sau Red Team (giữ nguyên quyết định, sửa chi tiết):** (F3) công thức nhị phân ban đầu sai cho claude chain-link (worker continuation) và opencode → mapping chốt: nested `claude→leader`, `codex|opencode→worker`; chain link KẾ THỪA `from.agent.tier || 'worker'`; fallback suy diễn thêm nhánh `chainId → ~worker`. (F4) phạm vi "mọi wave mới" đính chính: tồn tại đường hand-seed thứ 3 (bằng chứng lmodel/wpatch2/htest) không qua 2 file vá → record đó vẫn `~tier`; docs sẽ hướng dẫn hand-seed ghi tier.

3. **[Scope]** Nguồn danh sách "work-repo đã biết" cho discovery mode (không arg)?
   - Options: cwd + govoff hardcode (Recommended) | Quét C:\Users\Bee\* | List tĩnh trong skill
   - **Answer:** **Quét C:\Users\Bee\*** (user override recommendation)
   - **Rationale:** Tự phát hiện repo mới, không stale. orch-status thêm `--discover`: quét thư mục con cấp 1 của `C:\Users\Bee` có `.orch-run` (chỉ stat dir — rẻ, vẫn <5s). Skill gọi 1 lệnh thay vì duy trì danh sách.

4. **[Assumptions]** Skill catalog chỉ nạp đầu phiên — definition of done?
   - Options: Mô phỏng là đủ (Recommended) | Chờ phiên sau mới đóng
   - **Answer:** **Chờ phiên sau mới đóng** (user override recommendation)
   - **Rationale:** Plan giữ in-progress sau phiên cook; chỉ chuyển completed khi phiên MỚI gõ `/watch-agent` thật thành công. Phase 3 vẫn chạy đủ 3 kịch bản mô phỏng + commit; gate cuối ghi vào handoff phiên cook.

#### Confirmed Decisions
- Sửa 2 stale facts (docs 437 dòng — SAI, xem đính chính F12: thực tế 594; phạm vi reuse thực tế — đúng) — chính xác hóa plan.
- `tier` thành field state.json ghi lúc tạo agent record ('leader'|'worker') — phase 1 thêm write-path + test; reader fallback suy diễn cho waves cũ.
- Discovery = quét tự động `C:\Users\Bee\*` có `.orch-run` qua `orch-status --discover`.
- DoD: plan đóng ở phiên SAU phiên cook (xác nhận catalog thật).

#### Action Items
- [x] Phase 1: thêm bước sửa `process-nested-requests.js` + `chain-router.js` (field `tier`) + test; thêm `--discover`; chính xác hóa reuse; effort 2-3h → 3-4h
- [x] Phase 2: bảng phân công đọc `tier` từ state (fallback suy diễn có nhãn); discovery = 1 lệnh `--discover`
- [x] Phase 3: docs 437 dòng (đã đính chính lại = 594 theo Red-team F12); kịch bản 1 dùng `--discover`; DoD chờ phiên sau
- [x] plan.md: quyết định #2 cập nhật nhánh discovery; bảng nguồn chú thích tier

#### Impact on Phases
- Phase 1: scope tăng (write-path tier + discovery flag) — vẫn 1 phase, effort 3-4h
- Phase 2: đổi nguồn dữ liệu tier + đơn giản hóa discovery (bỏ "danh sách work-repo đã biết")
- Phase 3: số liệu docs + DoD 2 phiên

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-helper-script-orch-status.md, phase-02-skill-watch-agent-skill-md.md, phase-03-e2e-validation-va-docs.md
- Decision deltas checked: 5 (docs 437 dòng; phạm vi reuse orch-forensics-map; tier write-path + fallback `~`; discovery `--discover` quét C:\Users\Bee\*; DoD 2 phiên)
- Reconciled stale references: 3 trong plan.md (overview "Thiếu duy nhất"→"Thiếu 2 thứ" + câu reuse; quyết định #2 nhánh discovery; bảng nguồn chú thích tier) + 3 phase files propagated với marker
- Unresolved contradictions: 0 (grep stale terms: mọi hit còn lại nằm trong chính Validation Log — trích dẫn lịch sử, đúng chỗ)

## Red Team Review

### Session — 2026-06-12
**Reviewers:** 3 hostile (Security Adversary + Assumption Destroyer/Contract Verifier + Failure Mode Analyst), 24 findings thô → dedupe 15.
**Findings:** 15 (14 accepted, 1 rejected)
**Severity breakdown:** 2 Critical, 10 High, 3 Medium

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| F1 | Resolver không resolve được tên wave xuyên repo (`gantt-sync` từ repo này) — kịch bản nghiệm thu 2 fail-by-spec | Critical | Accept | Phase 1 (nhánh 2.5), Phase 3 (kịch bản 2), plan.md QĐ#2 |
| F2 | Prompt injection: forensics untrusted (out.jsonl/result/transcript) render vào phiên orchestrator; sanitizeControl không chống chỉ thị | Critical | Accept | Phase 2 (DATA-ONLY GUARD) |
| F3 | Công thức tier `codex?worker:leader` sai cho claude chain-link (worker continuation — test-leader-aggregate-phase5c.js:40) và opencode (nested-state.js:23) | High | Accept (modified — giữ Q2, sửa mapping + kế thừa chain) | Phase 1 (write-path + fallback), plan.md Q2 |
| F4 | Đường hand-seed thứ 3 tạo record (bằng chứng lmodel/wpatch2/htest) ngoài 2 file vá → không có tier; rationale "mọi wave mới" quá rộng | High | Accept | Phase 1 (coverage gap), Phase 3 (docs snippet), plan.md Q2 |
| F5 | Tail 64KB drop im lặng event >64KB (đo thật 5/5 file dính, max 240KB; gantt-sync max 33KB — nghiệm thu cũ bị che khuyết tật) | High | Accept | Phase 1 (trim 2 đầu + adaptive 256KB + cảnh báo), Phase 3 (kịch bản 5) |
| F6 | Claim "renderer tự skip event cụt" SAI — echo raw (launch-agent-ext.js:118-126) + `end()` flush raw (:144-148); default write không sanitize (:55) | High | Accept | Phase 1 (risk row sửa + spec write/end) |
| F7 | `watch-agent --once` đọc TOÀN BỘ file (fromStart mặc định; transcript thật 2.7MB) — phá quyết định bounded-reads #4 | High | Accept | Phase 1 (tail claude bounded), Phase 2 (lệnh đổi), plan.md QĐ#3 |
| F8 | 100% claude agent trên đĩa (4/4) thiếu claudeSessionId → lệnh claude deep-dive throw (watch-agent.js:108); phase 3 không có kịch bản claude | High | Accept | Phase 1 (fallback result.md), Phase 3 (kịch bản 4), plan.md bảng nguồn |
| F9 | 7 biến thể schema agent record trên 25 wave + status `crashed` ngoài vocabulary + torn-read init non-atomic (docs:62) — thiếu spec all-optional + try/catch per-wave | High | Accept | Phase 1 (schema variance + unreadable row) |
| F10 | Transcript live: tự đọc chính phiên đang chạy + render `[user]` (secret) + slug chung cwd chọn nhầm leader transcript | High | Accept | Phase 2 (bước 4 exclusions a-e) |
| F11 | `--discover`: OneDrive treo existsSync, sort key không định nghĩa (mtime dir không đổi), root `.orch-run\state.json` bị scanner mới bỏ sót, cross-trust auto-aggregation | High | Accept (modified — giữ Q3, hardening trong phạm vi) | Phase 1 (discover spec), Phase 2 (không auto deep-dive) |
| F12 | Docs = 594 dòng vật lý, không phải 437 — Validation S1 đo sai tool (`Measure-Object -Line` bỏ dòng trống), tạo regression đúng→sai + mâu thuẫn nội tại (heading dòng 498 > 437) | Medium | Accept (đính chính) | Phase 3 (step 2), plan.md Validation Log Failure #1 |
| F13 | Stalled heuristic false-positive cấu trúc: worker done-chưa-harvest vẫn `running` (harvest-results.js:100-105, lifecycle thủ công docs:298); codex event không timestamp | Medium | Accept | Phase 1 (thứ tự ưu tiên result-file → done-unharvested) |
| F14 | Read-path không validate state untrusted: `agent.id`/`resultFile` chứa `..`/absolute → forensicsPath (orch-forensics-map.js:32-37 path.resolve không scope-check) đọc file ngoài orchDir | High | Accept | Phase 1 (read-path validation) |
| R1 | (SA) Bỏ write-path tier vì denormalization thừa (tier ≡ f(engine)) | Medium | **Reject** | — Đảo quyết định user Q2 đã chốt (guard); concern hợp lệ được mitigate qua F3 (mapping đúng) + F4 (giới hạn phạm vi claim); SA tự nhãn "challenges confirmed user decision" |

**Ghi chú guard:** Q3 (discover) được Contract Verifier chủ động kiểm — không có repo thật bị miss (chỉ 2 repo có .orch-run, đều cấp 1) → không challenge; Q4 (DoD 2 phiên) không bị challenge. Q2 giữ nguyên quyết định ghi-tier, chỉ sửa công thức (F3) + phạm vi claim (F4).

**Unresolved questions từ reviewers (không block cook):**
1. Ai hand-seed lmodel/wpatch2/htest (orchestrator gõ tay hay script đã xóa)? → phase 3 xử bằng docs; nếu sau này lộ script thứ 3, vá thêm 1 dòng tier.
2. `json-tool.js` (writer upstream plugin theo nested-state.js:6) không tìm thấy trên đĩa — nếu còn sống ở đâu đó, F9 càng cần per-wave try/catch (đã spec).
3. Claim "suite 254 PASS" chưa re-run trong red-team (read-only) — phase 1 step 9 sẽ re-run full suite.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01-helper-script-orch-status.md, phase-02-skill-watch-agent-skill-md.md, phase-03-e2e-validation-va-docs.md
- Decision deltas checked: 14 (F1-F14 accepted)
- Reconciled stale references: plan.md QĐ#2 (nhánh cross-repo + hardening discover), QĐ#3 (phân vai orch-status/watch-agent sau F7), bảng nguồn (note sid F8), Validation Log (đính chính F12 tại Failure #1 + 2 pointer tại Confirmed Decisions/Action Items, điều chỉnh Q2 rationale theo F3/F4); 3 phase files apply trực tiếp với marker Red Team Session
- Grep hậu kiểm (`437|tự skip|--once|mọi wave mới|engine === 'codex'`): mọi hit còn lại là trích dẫn lịch sử trong log/đính chính hoặc câu phủ định chủ động ("KHÔNG dùng --once") — đúng chỗ
- Unresolved contradictions: **0**
