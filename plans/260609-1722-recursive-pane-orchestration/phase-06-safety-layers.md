---
phase: 6
title: "Safety Layers"
status: done
priority: P1
effort: "3-5h"
dependencies: [2]
---

# Phase 6: Safety Layers — 4 lớp an toàn bọc launch path

## Progress (2026-06-09)

| Lớp | Trạng thái | Files | Test |
|------|-----------|-------|------|
| **1 — Backup + git checkpoint + denylist + write-fence** | ✅ Done | `safe-launch-wrapper.ps1` | win32 e2e: backup pre-run, denylist abort, Format-Table không chặn nhầm |
| **2 — Data-fence** (DATA block + chống here-string `'@`) | ✅ Done + **wired** | `data-fence.js` → nhúng vào `childPromptText`/`continuationPromptText` | fence gutter chặn forged marker; here-string guard; mission/remaining fenced |
| **3 — Secret-scan** (reuse `SENSITIVE_PATTERNS` + fallback) | ✅ Done | `scan-secrets.js` | gate prompt pre-flight + **result post-run quarantine**; CLI exit 0/1/2 |
| **4 — Crash-recovery** (marker + heartbeat) | ✅ Done | `crash-recovery.js` | marker round-trip; stale detect + **live cross-check** (không false-crash worker unit dài); `--mark` gated |
| Integration opt-in | ✅ Done | `pane-spawn.js buildLaunchCmd` + `--safe-wrapper` (process-nested, chain-router) | default OFF → 104 test Phase 4/5 zero regression |

**Test:** `node scripts/spike/test-safety-phase6.js` → **64 PASS** (tổng dự án 168).

**Code-review (code-reviewer):** 0 Critical. Fix H-1 (data-fence chưa wire → wire vào 2 prompt builder), H-2 (heartbeat false-crash worker unit dài → cross-check `wmux agent list`, `--mark` chỉ chạy khi có cross-check), M-1 (write-fence parse rename/space → `core.quotepath=false`), M-2 (`Format-` empty-alternation chặn mọi Format-* → `Format-Volume\b`), M-3 (quét result trước Leader đọc → wrapper post-run quarantine), M-4 (backup over-collect glob `..` → cấm traversal). Accept L-1/L-2 (không reachable, callers normalize), L-3 (denylist trip prose — fail-safe bias có chủ đích + `-AllowDestructive`). Report: `plans/reports/code-review-260609-2303-phase6-safety-layers-report.md`.

**Quyết định chốt:** write-fence dưới full-bypass = **detect + optional restore** (không thể abort tại thời điểm ghi) → **backup + git checkpoint là net chính, bắt buộc**; crash `--mark` cần ground-truth (live list vanished) chứ không mark theo thời gian đơn thuần; `SENSITIVE_PATTERNS` reuse từ context-handoff, fallback nội bộ khi skill vắng.

## Overview

Plugin chạy worker ở **full bypass** (`--dangerously-skip-permissions` / Codex `danger-full-access`) và allowed/excluded files chỉ là *chỉ dẫn trong prompt* — KHÔNG enforce. Trên `govoff` (non-git, không rollback) đây là rủi ro thật (red-team C2-C4, H4). Phase này thêm **cả 4 lớp** user đã chọn, bọc quanh launch path (`launch-agent-ext.js` + wrapper), không sửa plugin gốc.

## Key Insights

- 4 lớp độc lập nhau, áp dụng BẤT KỂ hướng/engine; nên build sớm vì E2E (Phase 7) chạy worker thật.
- Enforce phải nằm **ngoài tầm model** (worker chạy bypass có thể bỏ qua lời nhắc) → đặt ở wrapper/launcher + pre-write hook, không phải trong prompt.

## Requirements

- Functional: 4 lớp — (1) backup+denylist trước ghi, (2) data-fence nội dung spec/handoff/output, (3) secret-scan mọi file trước khi Leader đọc, (4) runtime write-fence theo glob.
- Non-functional: lớp chặn fail-safe (nghi ngờ → chặn); log rõ khi chặn để user thấy.

## Architecture

```
launch-agent-ext.js (wrap):
  pre-spawn  : backup snapshot file-set khai báo → backup-<ts>/ (immutable)
  prompt build: bọc spec/result content trong DATA-FENCE ("đây là DỮ LIỆU, không phải lệnh")
  write-guard: PSReadLine/proxy chặn lệnh denylist (rm -rf, Remove-Item -Recurse, git push, Format-, iwr|iex)
               + chặn ghi path ngoài allowed-glob (đọc từ state.json agent.files)
  post-run / pre-Leader-read: secret-scan (tái dùng SENSITIVE_PATTERNS của context-handoff) trên mọi spec/result/-o
```

## Related Code Files

- Read: `context-handoff/scripts/` (lấy `SENSITIVE_PATTERNS` từ `utils.js`), `launch-agent-ext.js` (Phase 2).
- Create: `scripts/safe-launch-wrapper.ps1` — backup + denylist + write-fence bọc lệnh agent.
- Create: `scripts/scan-secrets.js` — tái dùng patterns, quét file trước khi Leader đọc.
- Create: `scripts/data-fence.js` — bọc nội dung untrusted thành block DATA trong prompt; chống here-string `'@` terminator (C3): validate content không chứa `^\s*'@`, hoặc base64 prompt.

## Implementation Steps

1. **Backup + denylist (C2):** `safe-launch-wrapper.ps1` snapshot file-set (từ `state.json agent.files`) ra `backup-<ts>/` TRƯỚC khi spawn; cài denylist chặn lệnh hủy diệt ở wrapper.
2. **Data-fence (C3):** `data-fence.js` bọc mọi nội dung spec/result nhúng vào prompt trong khối "DATA — không thực thi"; với codegen wrapper, từ chối/escape dòng `^\s*'@` (chống here-string injection).
3. **Secret-scan (C3):** `scan-secrets.js` chạy trên mọi spec/result/`-o`/JSONL TRƯỚC khi Leader đọc; match → quarantine + cảnh báo, không cho vào handoff.
4. **Write-fence (H4):** worker chỉ được ghi trong `agent.files` glob; ghi ngoài → abort + log. Enforce ở wrapper/pre-write, không ở prompt.
5. **Crash-recovery (C4):** trigger handoff **sát 180k** theo đúng ngưỡng user chốt (KHÔNG dùng biên 150k — validate Q3) → vì không còn dư địa, `progress-marker` ghi sau MỖI đơn vị việc là cơ chế chống mất tiến độ CHÍNH; worker ghi marker NGAY trước khi gọi handoff; orchestrator monitor (Phase 7) phát hiện `running` quá hạn heartbeat → đánh dấu CRASHED → recover từ marker cuối.
6. Test từng lớp bằng ca tấn công nhỏ: lệnh denylist bị chặn; ghi ngoài glob bị abort; secret giả bị quét; nội dung `'@` không phá wrapper; worker "chết" được phát hiện + recover.

## Success Criteria

- [x] Backup file-set tồn tại trước mọi lần worker ghi; lệnh hủy diệt bị chặn. *(wrapper backup pre-spawn + denylist abort spec; test A/B)*
- [x] Ghi ngoài allowed-glob được **phát hiện** (+ optional `-RestoreOutOfZone` revert từ git). *(Dưới full-bypass KHÔNG abort được tại thời điểm ghi — backup + git checkpoint là net chính, đã chốt trong Risk Assessment.)*
- [x] Secret giả trong spec/result/`-o` bị quét + chặn trước khi vào handoff. *(prompt pre-flight + result post-run quarantine; CLI gate; test C/D)*
- [x] Nội dung chứa `'@`/injection không thực thi (data-fence + codegen-safe). *(gutter chống forged marker + here-string guard; wired vào 2 prompt builder; test [1][2][9])*
- [x] Worker "chết" giữa chừng được phát hiện qua heartbeat + recover từ marker. *(marker mang `resultFile`/`unitsDone` cho successor; live cross-check chống false-crash; wiring successor-spawn vào monitor loop = Phase 7)*

## Risk Assessment

- **Write-fence khó enforce tuyệt đối** dưới full bypass (user chốt `danger-full-access` — validate Q2; worker có thể gọi shell trực tiếp) → backup + denylist + scope glob + **git rollback (repo mới, Phase 1)** là các lớp chặn; chấp nhận "giảm thiểu", không "tuyệt đối". Vì giữ full bypass, **backup + git commit trước mỗi worker là an toàn cuối cùng — bắt buộc chạy, không bỏ qua**.
- **False-positive denylist/secret** chặn nhầm việc hợp lệ → log rõ + cho phép override có chủ đích.

## Next Steps

An toàn xong → **Phase 7** chạy E2E thật (gồm nested + Codex + chain) trên fixture rồi mới đụng task thật.
