---
title: "Phase 1 — Code hardening: RootPane mandatory, no silent grid, harvest orchDir"
date: 2026-06-12
type: plan
tags: [rootpane, grid-fallback, harvest, hardening]
status: active
plan: 260612-0026-multi-repo-portability-and-model-enforcement
---

# Phase 1 — Code hardening

**Owner:** wave `mrfix` W1 (codex). **Priority:** cao. **Status:** in-progress.

## Context

- Root-cause H2/H4: govoff dùng `layout grid` tay; hệ nhà cũng có thể rơi grid IM LẶNG khi `--layout split` mà không resolve được source pane (`process-nested-requests.js:172-176` `useGrid = opts.layout === 'grid' || !splitRootPane`).
- `orchestrate-start.ps1` không bắt buộc `-RootPane`; `WMUX_PANE_ID` rỗng sau resume → loop spawn không root-pane.
- `harvest-results.js:59` đường md fallback `agent.resultFile` (tương đối trong state) resolve theo process.cwd() — sai khi chạy từ nơi khác work repo.

## Changes (5 điểm, tối thiểu, backward-compat)

1. `scripts/orchestrate-start.ps1`: `-RootPane` BẮT BUỘC non-empty → thiếu/rỗng: in lỗi rõ + exit 1 (trước hash-check càng tốt).
2. `scripts/orchestrator-pass.ps1`: `$RootPane` rỗng → `Write-Host` cảnh báo vàng 1 dòng (không fail — pass harvest-only hợp lệ).
3. `scripts/process-nested-requests.js`: layout `split` + KHÔNG resolve được source pane (không parentPane, không rootPane) → KHÔNG rơi grid; mark request error per-child `no source pane for split layout; pass --root-pane or use --layout grid` (children failed như nhánh `no pane allocated` hiện có). Grid CHỈ khi `--layout grid` tường minh.
4. `scripts/chain-router.js`: nếu có cùng pattern fallback grid/first-leaf khi thiếu pane nguồn → áp guard tương tự (kiểm tra trước, sửa tối thiểu).
5. `scripts/harvest-results.js`: mọi đường resultFile/md tương đối → resolve against `orchDir` (dirname của state file), không theo cwd.

## Success criteria

- `node --check` pass mọi JS sửa; PS1 syntax scriptblock pass.
- Suite `scripts/spike/test-*.js` PASS hết; thêm case mới: split-no-source → error (không grid).
- `orchestrate-start.ps1` thiếu RootPane → exit 1 message rõ.

## Risks

- Đừng phá pass harvest-only không RootPane (mục 2 chỉ warn).
- Backward-compat: caller cũ truyền root-pane đầy đủ không đổi hành vi.
