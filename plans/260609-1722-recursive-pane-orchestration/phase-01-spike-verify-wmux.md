---
phase: 1
title: "Repo Bootstrap + Baseline + Nesting Spike"
status: pending
priority: P1
effort: "2.5-3.5h"
dependencies: []
---

# Phase 1: Repo Bootstrap + Baseline + Nesting Spike

## Overview

Khởi tạo **repo riêng + git init** làm home cho hệ thống (giải gốc rollback-gap C2/C4), dời plan + chuẩn bị skeleton đa-runtime; xác nhận baseline plugin chạy; spike blocker DUY NHẤT còn lại (worker tự spawn sub-worker — nền cho nested).

## Key Insights

- Hệ thống lỡ khởi sinh trong `govoff` → dời ra repo riêng để có git (rollback/worktree) + tách khỏi nội dung marketing. wmux (binary Electron) + cmux (config WezTerm) GIỮ NGOÀI, tích hợp như runtime ngoài.
- ClaudeKit: KHÔNG đóng gói skill riêng — chỉ cần `ck` global dùng được khi `cd` vào repo (mặc định đã vậy).
- 2 blocker cũ (`--pane`/`--cmd`) đã giải bởi production `spawn-agents.sh:62-91` → chỉ confirm nhanh.
- Cái CHƯA biết: worker (claude instance trong pane riêng) gọi `layout grid --anchor-surface <WMUX_SURFACE_ID của nó>` có tạo được pane con dưới subtree của nó không → quyết định nested khả thi hay phải fallback (Orchestrator trung gian).

## Requirements

- Functional: (a) repo mới + git init + skeleton (`scripts/`, `docs/`, plan đã dời); (b) confirm baseline plugin spawn 1 dummy agent; (c) verdict worker tự spawn sub-worker.
- Non-functional: repo dùng được `ck` global khi `cd` vào; spike chạy trên dummy/fixture, dọn sạch pane.

## Architecture

```
B0 bootstrap: mkdir repo (vd C:\Users\Bee\orchestrator) → git init → skeleton scripts/docs
              → di chuyển plan 260609-1722 vào repo → .gitignore (node_modules, backup-*, out-*)
B1 baseline : PLUGIN_ROOT resolve → detect-wmux.sh → spawn-agents.sh (1 dummy) → agent list → cleanup
B2 nested   : từ pane worker (WMUX_SURFACE_ID=surf-W):
                wmux layout grid --count 2 --anchor-surface surf-W  → wmux tree (con dưới subtree W?)
                wmux agent spawn --pane <paneCon> --cmd "<dummy>"
                xác minh surface→pane: surface.list --pane <paneCon> chứa surfaceId sub-worker
```

## Related Code Files

- Read: `wmux-orchestrator/scripts/spawn-agents.sh`, `detect-wmux.sh`, `skills/orchestrate/SKILL.md` (Phase 0/1/6e).
- Create (repo mới): cấu trúc `scripts/`, `docs/`, `.gitignore`, README.
- Create: `plans/reports/spike-260609-nested-spawn-capability-report.md` — verdict GO-nested / FALLBACK + chuỗi lệnh chuẩn.

## Implementation Steps

1. **Bootstrap repo:** tạo repo mới (xác nhận tên/đường dẫn với user khi cook; mặc định `C:\Users\Bee\orchestrator`), `git init`, skeleton `scripts/`+`docs/`, `.gitignore`; di chuyển thư mục plan `260609-1722-recursive-pane-orchestration` vào repo; commit đầu.
2. Xác nhận `ck` global hoạt động khi `cd` vào repo (chạy thử 1 lệnh `ck plan status`).
3. **Baseline:** resolve `PLUGIN_ROOT`; `detect-wmux.sh`=available; spawn 1 dummy agent qua `spawn-agents.sh`, `agent list` thấy running, sentinel xuất hiện → baseline OK; dọn.
4. **Nested spike:** tạo 1 pane worker; thử `layout grid --anchor-surface <surf-worker>` (và/hoặc `split`); `wmux tree` xác định pane con dưới subtree worker hay root.
5. Spawn sub-worker vào pane con bằng `--pane`; xác minh `surface.list --pane <paneCon>` chứa surfaceId sub-worker.
6. Nếu nested fail: thử fallback "Orchestrator trung gian" (worker ghi yêu cầu ra file → Orchestrator split+spawn hộ → trả paneId).
7. Dọn toàn bộ pane/agent/sentinel spike.

## Success Criteria

- [ ] Repo mới + git init + skeleton; plan đã dời vào; `ck` global dùng được khi `cd` vào.
- [ ] Baseline plugin spawn 1 agent vào pane thật, auto-run, dọn sạch (confirm 2 blocker cũ đã giải).
- [ ] Verdict nested: worker CÓ/KHÔNG tự spawn sub-worker vào pane con — kèm chuỗi lệnh chuẩn (hoặc xác nhận fallback chạy).
- [ ] 0 pane/agent rác sau spike.

## Risk Assessment

- **Nested fail hoàn toàn** → Phase 4 dùng fallback "Orchestrator trung gian" (vẫn nested logic).
- **Spike spawn rác** vào session live → tối thiểu + cleanup bắt buộc + dummy.
- **Di chuyển plan làm hỏng path** → commit trước khi move; cập nhật active-plan trỏ repo mới.

## Next Steps

Repo + verdict nested là đầu vào cho **Phase 4**. Baseline OK → Phase 2/3 chạy song song. Mọi scripts delta về sau nằm trong repo mới.
