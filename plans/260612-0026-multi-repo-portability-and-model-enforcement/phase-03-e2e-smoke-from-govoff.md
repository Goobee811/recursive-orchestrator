---
title: "Phase 3 — E2E smoke multi-repo từ govoff"
date: 2026-06-12
type: plan
tags: [e2e, smoke, multi-repo, govoff]
status: active
plan: 260612-0026-multi-repo-portability-and-model-enforcement
---

# Phase 3 — E2E smoke multi-repo (orchestrator tự chạy)

**Owner:** orchestrator (spawn là việc của orchestrator — worker không tạo pane được theo FALLBACK design). **Status:** pending (chờ Phase 1).

## Steps

1. State + tasks tại `C:\Users\Bee\govoff\.orch-run\mrsmoke\` (1 task codex tí hon: đọc 1 file govoff, ghi result, không sửa gì).
2. Từ CWD `C:\Users\Bee\govoff` (qua `--cwd`/`-Cwd` trỏ govoff): gọi tuyệt đối `node C:\Users\Bee\recursive-orchestrator\scripts\nested-request.js ...` rồi `process-nested-requests.js --root-pane <pane orchestrator live>`.
3. Verify: prompt/out/result nằm TRONG `govoff\.orch-run\mrsmoke\`; pane split dọc từ orchestrator; worker codex chạy với `-C` govoff; harvest completed; KHÔNG file lạ rơi vào recursive-orchestrator.
4. Đóng pane smoke bằng `close-pane-with-log.js --state <govoff state> --confirm`; xác nhận tree về 1 leaf.
5. Negative check: gọi `orchestrate-start.ps1` THIẾU -RootPane → phải exit 1 (Phase 1 enforce).

## Success criteria

- Toàn bộ artefact wave nằm ở govoff; layout đúng convention; model/engine đúng tier; fail-fast RootPane hoạt động.

## Risks

- govoff là repo thật của user → task smoke READ-ONLY tuyệt đối, dọn pane sau khi xong; `.orch-run` mới tạo ở govoff GIỮ LẠI làm bằng chứng portability (nhỏ, vô hại) trừ khi user muốn xoá.
