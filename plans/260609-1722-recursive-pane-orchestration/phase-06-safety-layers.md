---
phase: 6
title: "Safety Layers"
status: pending
priority: P1
effort: "3-5h"
dependencies: [2]
---

# Phase 6: Safety Layers — 4 lớp an toàn bọc launch path

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

- [ ] Backup file-set tồn tại trước mọi lần worker ghi; lệnh hủy diệt bị chặn.
- [ ] Ghi ngoài allowed-glob bị abort (không corrupt file ngoài zone).
- [ ] Secret giả trong spec/result/`-o` bị quét + chặn trước khi vào handoff.
- [ ] Nội dung chứa `'@`/injection không thực thi (data-fence + codegen-safe).
- [ ] Worker "chết" giữa chừng được phát hiện qua heartbeat + recover từ marker.

## Risk Assessment

- **Write-fence khó enforce tuyệt đối** dưới full bypass (user chốt `danger-full-access` — validate Q2; worker có thể gọi shell trực tiếp) → backup + denylist + scope glob + **git rollback (repo mới, Phase 1)** là các lớp chặn; chấp nhận "giảm thiểu", không "tuyệt đối". Vì giữ full bypass, **backup + git commit trước mỗi worker là an toàn cuối cùng — bắt buộc chạy, không bỏ qua**.
- **False-positive denylist/secret** chặn nhầm việc hợp lệ → log rõ + cho phép override có chủ đích.

## Next Steps

An toàn xong → **Phase 7** chạy E2E thật (gồm nested + Codex + chain) trên fixture rồi mới đụng task thật.
