---
phase: 2
title: Synthesis and recommendation
status: completed
effort: ''
---

# Phase 2: Synthesis and recommendation

## Overview

Tổng hợp findings Phase 1 thành khuyến nghị cuối + 3 quyết định cần user chốt. Orchestrator thực hiện (synthesis là việc điều phối, không phải code).

## Câu 1 — Tab "Windows PowerShell" trống

**Trả lời:** KHÔNG cần thiết. Là giàn giáo phát sinh, không load-bearing (surface agent `-NoExit` tự giữ pane sống), không cản harvest.

| # | Phương án | Đánh giá |
|---|-----------|----------|
| 1 | **Không làm gì** (khuyến nghị mặc định) | Tab vô hại; chi phí sửa > lợi ích thẩm mỹ; YAGNI. Giá trị biên: prompt PowerShell rảnh để thao tác tay khẩn cấp |
| 2 | **Đóng surface trống sau agent spawn** (nếu user muốn bỏ) | Thuần CLI, zero rủi ro patch, blast radius thẩm mỹ. Thiết kế sẵn ở Phase 3 WI-1 |
| 3 | Sửa renderer (pane không surface mặc định) | LOẠI — đụng vùng patch CED7F271, mất mỗi lần update wmux |

## Câu 2 — Display human-friendly

**Trả lời:** ĐÁNG cải tiến (không phải ca "mọi cách đều tăng ma sát"). Máy không đọc stdout pane → lớp display đổi tự do.

| # | Phương án | Đánh giá |
|---|-----------|----------|
| 1 | **(b) Render compact ANSI trong launcher** (khuyến nghị mạnh) | Giảm 97–98% nhiễu; rủi ro máy ZERO; 0 process/surface mới; đa-worker OK. Prototype đã chứng minh |
| 2 | **Không cải tiến** (giữ JSONL thô) | Hợp lệ nếu user ưu tiên đóng băng launcher; nhưng bằng chứng cho thấy #1 chi phí thấp lợi ích cao |
| 3 | Surface markdown / sidebar | Bổ trợ về sau — thêm tab/poller, không làm trước #1 |
| — | Browser HTML / bỏ `--json` | LOẠI — browser panel duy nhất vô hiệu đa-worker; bỏ `--json` vỡ fallback chain-router |

**Markdown trong terminal:** không đáng — terminal không render markdown native, prose nằm trong `decisions[]` ngắn; ANSI compact đạt ~90% lợi ích với ~10% chi phí.

## 3 quyết định cần user chốt

1. **Q1:** Giữ tab trống (khuyến nghị) hay bỏ bằng close-surface (WI-1)?
2. **Q2:** Làm render ANSI trong launcher (WI-2, khuyến nghị)? Nếu làm: mức tối giản hay giàu (kèm `decisions[]`/`remaining[]`)?
3. **Phát hiện phụ orphan-shell leak:** điều tra riêng (WI-3) hay để sau?

## ✅ Quyết định user ĐÃ CHỐT (2026-06-10 18:20)

| # | Quyết định | Kết quả |
|---|-----------|---------|
| Q1 | Tab trống | **BỎ — WI-1 ACTIVE** (user chốt sau khi được giải thích "thao tác tay" chỉ là prompt rảnh, giá trị ~0 với user; user đi ngược khuyến nghị mặc định #1 một cách có hiểu biết) |
| Q2 | Render pane | **LÀM — WI-2 ACTIVE, mức GIÀU** (kèm `decisions[]`/`remaining[]`, strip prefix powershell, tail output, cờ `WORKER_RAW_ECHO=1`) |
| Q3 | Orphan leak | **LÀM NGAY — WI-3 ACTIVE** (điều tra + fix, hướng mở rộng cleanup-panes.ps1 / reap theo pid) |

**Phương thức thực thi (user dặn):** phiên sau resume vai trò Orchestrator, điều phối nhóm Leaders/Workers thực hiện cả 3 WI — orchestrator không tự code.

## Success Criteria

- [x] User đã chốt 3 quyết định
- [x] Phase 3 được kích hoạt đúng các work item user chọn (cả 3 WI active)

## Risk Assessment

- Khuyến nghị #1 cho Q1 và #1 cho Q2 ngược chiều nhau về "có làm hay không" — đây là chủ đích: mỗi câu được đánh giá độc lập theo bằng chứng riêng (Q1 lợi ích thẩm mỹ thuần; Q2 lợi ích vận hành đo được).
