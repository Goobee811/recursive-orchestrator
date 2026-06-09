# recursive-orchestrator

Home của **Recursive Pane Orchestration System** — hệ điều phối đa tầng (Orchestrator → Leader → Worker) chạy agent vào các pane wmux nhìn thấy được.

## Là gì

Mở rộng plugin `wmux-orchestrator@0.1.1` (đã cài sẵn) theo hướng **Hybrid**: dùng plugin làm nền (spawn/layout/registry/monitor/dashboard/decompose/coupling), chỉ build phần **delta** plugin chưa có:

- **Codex engine** (branch trong launch path; Leader đọc `-o`/`--output-schema`)
- **Nested recursion** (worker tự spawn sub-worker vào pane con — khác flat-waves của plugin)
- **Chuỗi 180k continuation + reverse-relay** handoff về Leader
- **context-meter** (đo ngưỡng 180k qua `CLAUDE_CODE_SESSION_ID`)
- **4 lớp an toàn** (backup+denylist, data-fence+secret-scan, crash-recovery, runtime write-fence)

## Runtime ngoài (KHÔNG nuốt vào repo)

| Thành phần | Vị trí | Vai trò |
|---|---|---|
| wmux (binary Electron) | `C:\Users\Bee\wmux\wmux.exe` | terminal multiplexer + pane host |
| wmux CLI | `node "$WMUX_CLI"` (`resources\cli\wmux.js`, named pipe `\\.\pipe\wmux`) | điều khiển pane/agent/layout |
| plugin nền | `~/.claude/plugins/cache/wmux-orchestrator/0.1.1/` | spawn-agents.sh, launch-agent.js, state.json |
| ClaudeKit | `ck` global (npm) | skills `/ck:*` khi `cd` vào repo |
| Codex | CLI ngoài | engine phụ (`danger-full-access`) |

## Cấu trúc

```
scripts/   # delta scripts (Codex branch, context-meter, safety, continuation)
docs/      # tài liệu hệ thống
plans/     # plan + phase files + reports
  260609-1722-recursive-pane-orchestration/   # plan Hybrid 7 phase
  reports/                                     # spike/handoff reports
```

## Trạng thái

Phase 1 (Repo Bootstrap + Baseline + Nesting Spike) — đang triển khai. Xem `plans/260609-1722-recursive-pane-orchestration/plan.md`.
