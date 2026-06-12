---
title: "Skill /watch-agent — quan sát orchestration sessions READ-ONLY"
date: 2026-06-12
type: report
tags: [orchestration, observability, watch-agent, skill, orch-status, bounded-reads]
status: done
---

# Skill /watch-agent — quan sát orchestration sessions READ-ONLY

**Date:** 2026-06-12 | **Severity:** Medium | **Component:** Orchestration observability, multi-repo doctrine | **Status:** Resolved

## Điều gì xảy ra

Plan `260612-2103-watch-agent-skill-orchestration-observability` hoàn tất trong phiên cook tối 12/6. Mục tiêu: từ repo `recursive-orchestrator`, user gõ `/watch-agent [target-session]` để quan sát **READ-ONLY** mọi orchestration wave khác (repo bất kỳ) — ai đã phân công gì, leader/worker đang tư duy + hành động ra sao.

3 phase triển khai:
- **Phase 1:** 3 script helper (`orch-status.js` 143d, `orch-status-read.js` 103d, `orch-status-tail.js` 111d) + ghi field `tier` vào agent record (additive tại `process-nested-requests.js` + `chain-router.js`) + test suite 45 check
- **Phase 2:** SKILL.md (66d) điều phối, DATA-ONLY GUARD chống injection từ forensics untrusted
- **Phase 3:** E2E validation 5 kịch bản trên data thật (discover, cross-repo `gantt-sync`, oversized 240KB, claude fallback, error)

**Kết quả:** full suite 10/10 PASS, 14/14 red-team finding verified, commit lên main.

## Nội dung kỹ thuật

### Thay đổi cốt lõi

1. **Scripts orch-status (3 file)**
   - `orch-status.js:` tổng quan wave — đọc `state.json`, tách phân công per-agent, tail bounded codex out.jsonl + claude transcript, format markdown summary
   - `orch-status-read.js:` đọc state files với xử lý schema variance (7 biến thể trên 25 wave), per-wave try/catch, all-optional fields
   - `orch-status-tail.js:` byte-slice bounded 256KB (sửa từ 64KB sau F5 — worst-case file 500KB → đọc max 256KB, không full dump). Tự động trim 2 đầu start/end incomplete line, cảnh báo nếu event bị cắt

2. **Field `tier` trong agent record**
   - Ghi tại điểm tạo agent (`process-nested-requests.js:150-155` + `chain-router.js:190`): giá trị `'leader'` (nested claude) hoặc `'worker'` (codex/opencode)
   - Chain-link **kế thừa** từ `from.agent.tier` (F3: sửa công thức ban đầu sai cho claude worker continuation + opencode)
   - Reader fallback suy diễn `~tier` cho wave cũ không có field (mapping: nested→leader, codex|opencode→worker, chainId→~worker)

3. **SKILL.md (66d, project-local)**
   - Không tự spawn/mutate — chỉ **DATA-ONLY GUARD** chống prompt injection
   - Exclusions (F10): KHÔNG đọc transcript phiên đang chạy của orchestrator, KHÔNG render `[user]` secret, KHÔNG selection slug chung cwd
   - Điều phối gọi `orch-status` với mode discovery (`--discover` quét `C:\Users\Bee\*` có `.orch-run`, chỉ stat dir rẻ <5s)

4. **Resolver xuyên repo (F1)**
   - `orch-status.js:60-67` sử dụng existing `resolveTarget` từ `orch-forensics-map.js`
   - Thứ tự resolve: absolute path → tên wave dưới cwd → tên repo local → **tên wave XUYÊN repo qua discover** (critical acceptance)

### Quyết định thiết kế then chốt

**Q1 (Tier write-path):** Ghi thành dữ liệu gốc tại agent record, không suy diễn lúc read (user override recommendation). Rationale: tier là source-of-truth cho wave mới, suy diễn chỉ fallback waves cũ. Implementation: 2 dòng additive `const engine`; `tier:` field.

**Q2 (Tier mapping):** Công thức `nested claude → leader`, `codex|opencode → worker`, chain-link kế thừa từ `from.agent.tier || 'worker'` (sửa sau F3). Phạm vi: mọi wave mới (gap: hand-seed thứ 3 vẫn `~tier`, docs hướng dẫn per F4).

**Q3 (Discovery):** Tự quét `C:\Users\Bee\*` có `.orch-run` thay hardcode danh sách (user override). Lệnh `orch-status --discover` → per-dir try/catch, skip OneDrive, sort max-mtime state.json, root-state.json thêm vào (hardening F11).

**Q4 (Catalog loading):** Plan ban đầu chốt DoD "chờ phiên MỚI gõ `/watch-agent` thật rồi mới đóng". Nhưng giả định cũ "catalog chỉ load đầu phiên" SAI — harness re-scan skill catalog mid-session khi tạo SKILL.md → `/watch-agent gantt-sync` chạy end-to-end OK NGAY phiên cook → user duyệt đóng plan `completed` (không phải chờ phiên sau).

### Findings từ Red Team & Bài học

| # | Finding | Severity | Bài học |
|---|---------|----------|---------|
| **F1** | Resolver phải resolve wave xuyên repo (`gantt-sync` từ repo này) | Critical | Accept. Implementation: dùng resolveTarget existing, thêm nhánh discover. |
| **F3** | Công thức tier sai cho claude chain-link + opencode | High | Sửa mapping: nested→leader; codex\|opencode→worker; chain kế thừa `from.agent.tier`. |
| **F5** | Tail 64KB drop im lặng event >64KB (đo 240KB max) | High | Adaptive 256KB + trim 2 đầu + cảnh báo. Bounded-reads doctrine giữ vững worst-case. |
| **F7** | `watch-agent --once` đọc nguyên file, phá bounded-reads | High | Tách vai: `orch-status` tail bounded 1-lần; `watch-agent` (sẵn) follow LIVE cho terminal. |
| **F8** | 100% claude agent cũ thiếu claudeSessionId → throw | High | Fallback result.md, không throw. |
| **F12** | Docs "437 dòng" sai (Validation S1 dùng `Measure-Object -Line` chỉ đếm non-blank) | Medium | **Đính chính:** thực tế 594 dòng vật lý = 437 non-blank + 157 blank. Bài học: đếm dòng bằng `(Get-Content).Count` / `wc -l`, KHÔNG `Measure-Object -Line`. |

## Tầm ảnh hưởng

1. **Codebase:** +680 dòng (3 script + SKILL.md + test + docs); tier field 2 dòng additive tại write-path; 0 breaking change.
2. **Doctrine:** Bounded-reads enforced, multi-repo discovery **tự động** (không stale danh sách), DATA-ONLY GUARD cho read-path.
3. **DoD:** Gate Q4 (catalog mid-session load) đóng NGAY phiên cook — premise "catalog chỉ load đầu phiên" sai, harness re-scan mid-session, `/watch-agent gantt-sync` chạy OK, user duyệt → plan `completed`.

## Quyết định đã chốt

✓ Ghi `tier` thành dữ liệu gốc lúc tạo agent record
✓ Mapping tier: nested→leader, codex|opencode→worker, chain kế thừa
✓ Discovery = quét auto `C:\Users\Bee\*` có `.orch-run` qua `--discover`
✓ Bounded-reads 256KB adaptive, trim incomplete line, cảnh báo oversized
✓ SKILL.md DATA-ONLY GUARD, exclusions chống injection
✓ Resolver xuyên repo qua existing resolveTarget + nhánh discover

## Bài học dành cho sau này

1. **`Measure-Object -Line` chỉ đếm dòng non-blank** → regression verification S1. Dùng `(Get-Content).Count` hoặc `wc -l` cho dòng vật lý.
2. **Bounded reads xung đột với "edit sau"** — F7 tách vai clear: helper script tail 1-lần; user's `watch-agent` terminal follow LIVE. KHÔNG mix 2 mode trong 1 tool.
3. **Schema variance thực tế (7 biến thể, 25 wave)** → all-optional + per-wave try/catch, không throw on first unreadable row (F9).
4. **Tier dữ liệu > suy diễn** — ghi lúc tạo record; fallback suy diễn dành waves cũ hoặc hand-seed ngoài script (F4).
5. **Discovery pattern** — quét tự động rẻ (<5s stat), skip trap (OneDrive existsSync treo), sort max-mtime không dùng mtime dir (thay state.json). Giữ mở rộng cho repo mới.

## Trạng thái & Next Steps

**Resolve:** Plan **completed** — gate Q4 đóng ngay phiên cook (commit `c77b2f9`), 4 commit lên main (d94dba9–61fb4c6). Việc còn lại duy nhất sau cook = journal này.

**Nếu skill lỗi về sau** (cross-session thật): debug từ phiên cook — F1 resolver xuyên repo, F2 DATA-ONLY GUARD, F10 exclusion transcript, F11 discover hardening.

**Không block:** Multi-repo doctrine, 3-tier model, RootPane/reaper — skill chỉ đọc, không mutate.
