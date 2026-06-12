---
phase: 3
title: "E2E validation va docs"
status: pending
priority: P2
effort: "30-45m"
dependencies: [1, 2]
---

# Phase 3: E2E validation va docs

## Overview

Validate toàn luồng trên dữ liệu THẬT (gồm wave `gantt-sync` do session 2 của user vừa chạy ở govoff) + cập nhật docs/memory cho khớp công cụ mới.

## Requirements

- Functional: 3 kịch bản chạy đúng; báo cáo đúng template; lỗi target sạch sẽ.
- Non-functional: tổng quan <5s; báo cáo đầy đủ trong ~1 phút thao tác; mọi bước read-only.

## Architecture

Kịch bản nghiệm thu:

| # | Lệnh/Tình huống | Kỳ vọng |
|---|------------------|---------|
| 1 | `/watch-agent` (không arg, tại repo này) | discovery: liệt kê wave repo này + govoff, mới nhất trước |
| 2 | `/watch-agent gantt-sync` | báo cáo wave govoff 2 đợt (diff-gantt + diff-ws-sheets → apply-sync), đọc đúng decisions từ out.jsonl, completed result-based |
| 3 | `/watch-agent khong-ton-tai` | thông báo lỗi rõ + gợi ý target hợp lệ, exit sạch |

## Related Code Files

- Modify: `docs/orchestration-system.md` — mục "Theo dõi và đóng pane thủ công": thêm tiểu mục `orch-status.js` (phân vai: orch-status = tổng quan wave/phân công; watch-agent = soi 1 agent) + bảng "Tham chiếu code" thêm 1 dòng; nhắc skill `/watch-agent` (project-local).
- Modify: memory `dogfood-worker-lifecycle-result-based.md` hoặc index — 1 dòng về quan sát qua `/watch-agent` (nếu đáng; không thì bỏ qua — YAGNI).

## Implementation Steps

1. Chạy kịch bản 1-3, lưu output mẫu (trích gọn) vào báo cáo phase.
2. Sửa docs/orchestration-system.md (giữ <800 dòng — hiện 594).
3. Re-run full spike suite lần cuối + `git status` xác nhận chỉ các file thuộc plan này đổi.
4. Commit theo conventional commits (feat scripts + skill, docs riêng nếu gọn hơn).

## Success Criteria

- [ ] 3 kịch bản PASS, có output mẫu trong báo cáo
- [ ] docs cập nhật, <800 dòng
- [ ] Full suite PASS; working tree chỉ chứa thay đổi của plan
- [ ] Commit sạch, không AI reference

## Risk Assessment

- Wave gantt-sync có thể bị user dọn trước khi validate → fallback nghiệm thu trên mrsmoke + govinv (vẫn đủ 2 repo).
- Phiên hiện tại không thấy skill mới trong catalog → nghiệm thu mô phỏng + xác nhận phiên sau (đã nêu phase 2).
