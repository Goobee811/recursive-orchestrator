---
phase: 5
title: "Continuation Chain + Reverse-Relay"
status: in-progress
priority: P1
effort: "4-6h"
dependencies: [2, 3]
---

# Phase 5: Continuation Chain (180k) + Reverse-Relay Handoff

## Progress (2026-06-09)

| Phần | Trạng thái | Files | Test |
|------|-----------|-------|------|
| **5A — Reconcile lifecycle (giải H3)** | ✅ Done | `reconcile-agents.js`, `process-nested-requests.js` (+`wmuxAgentId`, reconcile đầu pass), `pane-spawn.js` (DRY) | 27 PASS + verify daemon thật |
| **5B — Chain + reverse-relay** | ✅ Done | `chain-request.js` (worker intent), `chain-router.js` (route spawn-next/relay) | 45 PASS |
| **5C — Leader aggregate** | ⏳ Pending | `leader-aggregate.ps1` (gộp chain + Codex diff-verify + trail) | — |

**H3 GIẢI:** `wmux agent spawn` không có hook `on-agent-stop` → child kẹt `running`. `reconcile-agents.js` poll `wmux agent list` (`{agents:[{agentId,surfaceId,status:running\|exited,exitCode}]}`) → active→terminal (exitCode 0=completed, else failed), giải phóng slot + đóng wave. Map child↔live qua `wmuxAgentId` rồi `surfaceId`; chỉ đụng id đã có trong state (không chạm pane user). Chạy đầu mỗi monitor pass của process-nested + chain-router (an toàn standalone).

**Code-review (code-reviewer):** 0 Critical. Fix H-1 (grid-fail slot leak), M-1 (error misclassify), M-2 (chain-router reconcile standalone). Defer M-3 (TOCTOU 2-pass — single-actor tuần tự, không thực), M-4 (cwd — worker full-trust → Phase 6). Report: `plans/reports/code-review-260609-2221-phase5-engine-reconcile-chain-report.md`.

**Quyết định kỹ thuật chốt:** continuation GIỮ NGUYÊN depth (cùng việc, phiên mới — KHÔNG phải nesting, chỉ tốn slot); termination = `nextLink==null` + relay marker (KHÔNG dùng frontmatter — H5/H6); chain link = nested wave 1-agent.

## Overview

Hiện thực đúng vòng đời user mô tả mà plugin KHÔNG có: 1 luồng việc có thể qua **nhiều worker nối tiếp** (vì 180k), W1→…→Wn; **Wn chuyền NGƯỢC về Leader**; Leader gộp (gồm cả nhánh Codex do Leader tự viết handoff) → Orchestrator. Sửa luôn các lỗ hổng chain mà red-team chỉ ra.

## Key Insights

- Plugin = 1 agent / 1 result file, giả định agent làm xong subtask trong 1 phiên. Continuation chain (cùng subtask, qua nhiều phiên do 180k) là delta thật.
- **H5/H6 fix:** KHÔNG định tuyến chain bằng slug-prefix/`chain_end` frontmatter (fuzzy + không ai đọc). Dùng **`chainId` + `linkSeq` (int)** ghi trong `state.json`; termination = `nextLink==null`; reverse-relay = đọc state, không đọc frontmatter.
- **Codex (Q3 user):** Codex worker ghi result theo schema (Phase 2); Leader đọc `-o` + JSONL + **verify diff file đích** rồi tự viết handoff. KHÔNG suy ra "done" từ việc file tồn tại (H7).
- `context-handoff --trail` vẫn dùng để gộp text, nhưng đặt slug duy nhất theo `chainId` (tránh gom nhầm — H5).

## Requirements

- Functional: điểm handoff (xong luồng / chạm 180k) → spawn worker kế tiếp nối state; Wn → Leader; Leader gộp → Orchestrator.
- Non-functional: không mất tiến độ tại điểm cắt; chain truy vết được bằng `chainId`+`linkSeq`; mọi handoff Claude pass `validate-handoff.js`.

## Architecture

```
Wk (claude): xong đơn vị → context-meter (Phase 3)
   done luồng       → ghi result + linkSeq, nextLink=null → reverse-relay
   chưa & continue  → làm tiếp
   chưa & handoff   → ghi result + nextLink=k+1 → engine spawn W(k+1) "tiếp từ chainId@linkSeq"
Wk (codex):  ghi result schema + out.jsonl (KHÔNG tự handoff)
Leader: với mỗi link → nếu codex: đọc -o/jsonl + DIFF file đích → tự viết handoff
        gộp toàn chain qua state(chainId) + resume-handoff --trail (slug=chainId) → handoff tổng → Orchestrator
```

## Related Code Files

- Read: `context-handoff/scripts/resume-handoff.js`, `validate-handoff.js`, `trace-decision-trail.js` (hiểu giới hạn slug/phút → tránh).
- Create: `scripts/chain-router.js` — đọc state(chainId), quyết spawn-next vs reverse-relay (thay `chain_end`).
- Create: `scripts/leader-aggregate.ps1` — gộp chain + nhánh Codex (đọc `-o`/jsonl + verify diff) → handoff tổng.
- Update: `state.json` — thêm `chainId`, `linkSeq`, `nextLink`, `leaderAgentId`.

## Implementation Steps

1. Mở rộng `state.json`: `chainId`, `linkSeq`, `nextLink`, `leaderAgentId` cho mỗi link.
2. `chain-router.js`: sau khi 1 link kết thúc, đọc state → `nextLink!=null` ⇒ spawn worker kế với spec "tiếp từ result của linkSeq trước"; `nextLink==null` ⇒ định tuyến reverse-relay về `leaderAgentId`.
3. Spec worker kế CHỈ trỏ tới result link trước (data-fenced — Phase 6) + work-units còn lại.
4. Nhánh Codex trong `leader-aggregate.ps1`: đọc result schema + `out.jsonl`; chạy diff file đích để xác nhận thay đổi thực; chỉ viết handoff "done" khi diff khớp; nếu rỗng/mơ hồ → đánh dấu link BLOCKED + re-dispatch Codex fresh ("file có thể sửa dở, verify trước").
5. Leader gộp: `resume-handoff.js --trail` với slug=`chainId` (duy nhất) → handoff tổng gửi Orchestrator; validate pass.
6. Test: chuỗi W1→W2(claude)→W3(codex, end)→Leader; ép cắt ở ~30k (hạ ngưỡng test) để kích hoạt sớm; xác minh trail đúng thứ tự `linkSeq` + nghiệm thu diff khớp.

## Success Criteria

- [x] Worker chạm ngưỡng → spawn worker kế tự động nối state, không mất tiến độ. *(5B; logic + dry-run verified, real spawn ở Phase 7 E2E)*
- [x] Wn → reverse-relay đúng về Leader qua state (`nextLink==null`), không phụ thuộc frontmatter. *(5B + relay marker)*
- [x] **(H3)** Nested/chain child `exited` được reconcile → terminal + giải phóng slot + đóng wave. *(5A; 27 test + daemon thật)*
- [ ] Codex link: Leader viết handoff hợp lệ từ `-o`/jsonl + verify diff (không false-positive). *(5C pending)*
- [ ] Trail gộp đúng thứ tự `linkSeq`, không gom nhầm chain khác (slug=chainId duy nhất). *(5C pending)*

## Risk Assessment

- **Mất ngữ cảnh khi cắt** → result mỗi link bắt buộc có "việc còn lại + file đọc trước" (work-units rõ).
- **Codex chết trước `-o`** (H7) → JSONL log + verify diff; không bịa done.
- **Chain không kết thúc** (H6) → `nextLink==null` là điều kiện dừng tường minh trong state; chain-router không spawn nếu đã null.

## Next Steps

Ghép với Phase 4 (nested) thành luồng đầy đủ; an toàn ở **Phase 6**; kiểm thử thật ở **Phase 7**.
