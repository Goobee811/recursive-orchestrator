---
phase: 3
title: "E2E validation va docs"
status: done-pending-2session-gate
priority: P2
effort: "30-45m"
dependencies: [1, 2]
---

# Phase 3: E2E validation va docs

<!-- Updated: Validation Session 1 - docs 437 dòng (Q1), kịch bản 1 dùng --discover (Q3), DoD chờ phiên sau (Q4) -->
<!-- Updated: Red Team Session 2026-06-12 - F12 ĐÍNH CHÍNH docs = 594 dòng vật lý (S1 đo sai bằng Measure-Object -Line); F1 kịch bản 2 ghi đường resolve; F8 kịch bản 4 claude; F4 docs snippet hand-seed có tier; F5 nghiệm thu wave có event lớn -->

## Overview

Validate toàn luồng trên dữ liệu THẬT (gồm wave `gantt-sync` do session 2 của user vừa chạy ở govoff) + cập nhật docs/memory cho khớp công cụ mới.

**DoD 2 phiên (Validation S1 Q4):** phiên cook chạy đủ 3 kịch bản mô phỏng + commit, nhưng plan GIỮ in-progress; chỉ chuyển completed khi phiên MỚI gõ `/watch-agent` thật thành công (catalog nạp đầu phiên). Ghi gate này vào handoff phiên cook.

## Requirements

- Functional: 3 kịch bản chạy đúng; báo cáo đúng template; lỗi target sạch sẽ.
- Non-functional: tổng quan <5s; báo cáo đầy đủ trong ~1 phút thao tác; mọi bước read-only.

## Architecture

Kịch bản nghiệm thu:

| # | Lệnh/Tình huống | Kỳ vọng |
|---|------------------|---------|
| 1 | `/watch-agent` (không arg, tại repo này) | discovery qua `orch-status --discover` (quét `C:\Users\Bee\*` cấp 1, skip OneDrive): liệt kê tối thiểu repo này + govoff, repo hoạt động mới nhất trước; KHÔNG auto deep-dive |
| 2 | `/watch-agent gantt-sync` | resolve XUYÊN repo qua nhánh 2.5 (cwd không có wave này, `C:\Users\Bee\gantt-sync` không tồn tại → discover tìm thấy trong govoff — Red-team F1), in "resolved → govoff"; báo cáo wave 2 đợt (diff-gantt + diff-ws-sheets → apply-sync), đọc đúng decisions từ out.jsonl, completed result-based, tier hiển thị `~worker` (wave cũ — suy diễn) |
| 3 | `/watch-agent khong-ton-tai` | thông báo lỗi rõ + gợi ý target hợp lệ, exit sạch |
| 4 | Deep-dive 1 agent CLAUDE (vd `wpatch/lead-wpatch` hoặc `orphfix/orch-root-c1`) — Red-team F8 | agent cũ không có claudeSessionId → orch-status fallback result.md bounded + message rõ; skill tường thuật từ result, KHÔNG throw |
| 5 | `--tail` trên wave có event >64KB (vd `agfix/orch-root-c1` 114KB hoặc `wpatch/orch-root-c1` 240KB) — Red-team F5 | trim/adaptive slice hoạt động: có output events hoặc cảnh báo oversized, KHÔNG dump raw JSON cụt, KHÔNG output rỗng im lặng |

## Related Code Files

- Modify: `docs/orchestration-system.md` — mục "Theo dõi và đóng pane thủ công": thêm tiểu mục `orch-status.js` (phân vai: orch-status = tổng quan wave/phân công + tail bounded cả codex lẫn claude; watch-agent = follow live 1 agent) + bảng "Tham chiếu code" thêm 1 dòng; nhắc skill `/watch-agent` (project-local); **snippet/hướng dẫn hand-seed agent record (nếu có trong docs) bổ sung field `tier`** (Red-team F4 — đường tạo record thứ 3 ngoài 2 file đã vá).
- Modify: memory `dogfood-worker-lifecycle-result-based.md` hoặc index — 1 dòng về quan sát qua `/watch-agent` (nếu đáng; không thì bỏ qua — YAGNI).

## Implementation Steps

1. Chạy kịch bản 1-5, lưu output mẫu (trích gọn) vào báo cáo phase.
2. Sửa docs/orchestration-system.md (giữ <800 dòng — hiện **594 dòng vật lý**; con số 437 của Validation S1 là đo sai bằng `Measure-Object -Line` vốn bỏ dòng trống — Red-team F12; cook re-check bằng `(Get-Content ...).Count` trước khi sửa).
3. Re-run full spike suite lần cuối + `git status` xác nhận chỉ các file thuộc plan này đổi.
4. Commit theo conventional commits (feat scripts + skill, docs riêng nếu gọn hơn).
5. Handoff phiên cook ghi gate còn lại: "phiên sau gõ `/watch-agent` thật → mới check ô cuối + chuyển plan completed".

## Success Criteria

- [ ] 5 kịch bản PASS, có output mẫu trong báo cáo
- [ ] docs cập nhật, <800 dòng (baseline 594)
- [ ] Full suite PASS; working tree chỉ chứa thay đổi của plan
- [ ] Commit sạch, không AI reference
- [ ] (Gate phiên SAU — Validation S1 Q4) Phiên mới gõ `/watch-agent` thật thành công → lúc đó mới chuyển plan completed

## Risk Assessment

- Wave gantt-sync có thể bị user dọn trước khi validate → fallback nghiệm thu trên mrsmoke + govinv (vẫn đủ 2 repo).
- Phiên hiện tại không thấy skill mới trong catalog → nghiệm thu mô phỏng + xác nhận phiên sau (đã nêu phase 2).
