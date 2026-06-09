---
title: "Spike — Nested Spawn Capability (Phase 1 verdict)"
date: 2026-06-09
type: report
tags: [spike, phase-1, wmux, nested, baseline, verdict]
status: done
---

# Spike — Nested Spawn Capability + Baseline (Phase 1)

**Verdict tổng:** Baseline **PASS** (verified thực tế). Nested-từ-pane-worker = **FALLBACK** — `layout grid --anchor-surface` KHÔNG tạo subtree con dưới worker; Phase 4 dùng **Orchestrator trung gian**.

## Môi trường đã xác lập (quan trọng cho mọi phase)

| Mục | Giá trị |
|---|---|
| wmux CLI | `node "$WMUX_CLI"` (`$WMUX_CLI=C:\Users\Bee\wmux\resources\cli\wmux.js`) — **KHÔNG** gọi `wmux.exe` (nó launch app Electron, không phải CLI client) |
| Giao tiếp | named pipe `\\.\pipe\wmux` (env `WMUX_PIPE`); CLI gửi JSON-RPC v2 tới instance đang chạy |
| `wmux` trong PATH | KHÔNG có ở bash/PowerShell tool shell; chỉ có trong pane shell (qua `shell-integration` định nghĩa `wmux(){ node $WMUX_CLI "$@"; }`) |
| Surface tôi | `surf-4e998d02-…` (env `WMUX_SURFACE_ID`); `CLAUDE_CODE_SESSION_ID` tồn tại ✅ |
| Mô hình | **pane** = node tiling (container); **surface** = terminal/tab bên trong pane. `agent spawn --pane <p>` tạo **surface mới** trong pane p. 1 pane chứa nhiều surfaces. |

## B1 — Baseline (PASS, verified thực tế)

Chuỗi lệnh đã chạy thật (không phải đọc code):
```
node "$WMUX_CLI" layout grid --count 2 --type terminal        # → {newPaneIds:[pane-…]}, anchor auto = $WMUX_SURFACE_ID
node "$WMUX_CLI" agent spawn --pane <paneId> --cmd "node dummy-agent.js <sentinel> worker1" \
     --label spike-w1 --cwd <repo>                              # → {agentId, surfaceId}
node "$WMUX_CLI" agent list                                     # spike-w1 status=running
node "$WMUX_CLI" agent kill <agentId>                           # → {ok:true}
node "$WMUX_CLI" close-surface <surfaceId>                      # → {ok:true}
```

Bằng chứng: sentinel ghi thật `SPIKE_ALIVE worker1 …Z pid=…` (chứng minh `--cmd` AUTO-RUN), `agent list` thấy `spike-w1` **running**. → **2 blocker cũ (`--pane`, `--cmd`) đã giải bằng thực nghiệm**, không còn là "CLI-parse-only" (đóng H2).

## B2 — Nested spike (FALLBACK)

Test: anchor `layout grid` vào surface của worker W1 (`surf-35825ac5`) — mô phỏng worker tự spawn (CLI gửi cùng RPC `layout.grid{anchorSurfaceId}` dù chạy từ đâu).

```
node "$WMUX_CLI" layout grid --count 2 --anchor-surface surf-35825ac5 …
```

**Tree TRƯỚC** (sau B1): `branch[ leaf(Claude surf-4e998d02), leaf(pane-812432eb: W1) ]` — Claude pane riêng.

**Tree SAU** (anchor=W1):
- pane mới `pane-202bcc39` sinh ra **ngang hàng ở ROOT**, KHÔNG dưới subtree W1.
- ⚠️ surface Claude `surf-4e998d02` bị **GOM** vào pane chứa W1 (`pane-812432eb`); pane Claude gốc bị xoá.

→ `layout.grid` là thao tác **reshape workspace thành flat grid**: nhồi mọi surface hiện có vào anchor pane + tạo pane mới cho đủ `count`. **Không nested**, và **nguy hiểm** (gom nhầm surface orchestrator → suýt làm rối session điều phối).

**Code (`cli/wmux.js`):** `split`/`pane split` chỉ nhận `direction/type`, **KHÔNG có anchor** → luôn thao tác **focused** pane. Worker muốn split chính nó phải `focus-surface <self>` trước → **focus-steal** + **race** nếu nhiều worker đồng thời.

## Khuyến nghị Phase 4

1. **FALLBACK chính — Orchestrator trung gian:** worker ghi *intent spawn* (file/registry) → Orchestrator (single actor) thực thi `layout grid`/`agent spawn` hộ, trả `paneId/surfaceId` về worker. Cây nested **logic** vẫn đạt qua registry chain (parent→child), chỉ tập trung việc *tạo pane* ở 1 actor → tránh focus-race + tránh layout grid gom nhầm.
2. **Tùy chọn (chỉ nếu cần subtree HIỂN THỊ thật):** worker serialize qua lock toàn cục → `focus-surface <self>` → `split --down` (parse paneId con) → `agent spawn --pane <con>`. Chấp nhận focus nhấp nháy. Chưa verify thực — cần spike nhỏ nếu chọn hướng này.

## Cleanup

Đã kill agent spike + `close-surface` 3 surface spike (KHÔNG đụng `surf-4e998d02`). Tree về **1 leaf Claude**. 2 agent gốc của user (`agent-f1cf03ab`, `agent-109b3cfb` — việc bottletag-worker2) **nguyên vẹn**. 0 pane/agent rác sống (spike-w1 = `exited`).

## Câu hỏi mở

- `focus-surface + split` tạo subtree đúng? — suy từ code, **chưa chạy thực**; cần spike nếu Phase 4 chọn nested-hiển-thị-thật.
- Child worker (nếu `--cmd` là `claude`) có `CLAUDE_CODE_SESSION_ID` RIÊNG? — chưa test ở đây (Phase 3); dummy node không sinh session.
- `agent.list` lưu record `exited` tồn đọng — có cần lệnh prune? Không ảnh hưởng runtime; ghi nhận.
