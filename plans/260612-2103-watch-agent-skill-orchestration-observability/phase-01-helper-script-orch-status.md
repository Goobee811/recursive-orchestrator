---
phase: 1
title: "Helper script orch-status"
status: pending
priority: P2
effort: "2-3h"
dependencies: []
---

# Phase 1: Helper script orch-status

## Overview

Tạo `scripts/orch-status.js` — tổng quan 1-lệnh mọi wave/agent của một root (repo bất kỳ), kèm `--tail` render nhanh events cuối của 1 worker codex. READ-ONLY tuyệt đối.

## Requirements

- Functional: summary mode + tail mode + json mode; resolve target linh hoạt; cảnh báo stalled.
- Non-functional: <200 dòng (ưu tiên gọn, tối đa chấp nhận ~220 hoặc tách resolver); chạy <5s trên repo có ~25 wave; không ghi/sửa file nào; PowerShell 5.1-safe khi gọi (arg đơn giản, không here-string).

## Architecture

- Resolve target (positional, optional):
  1. Absolute path: `*.json` → coi là state.json; dir chứa `state.json` → wave dir; dir chứa `.orch-run` → repo root (quét mọi wave).
  2. Tên trần: thử wave dưới `<cwd>\.orch-run\<tên>\state.json` → rồi repo `C:\Users\Bee\<tên>\.orch-run\` → không thấy: lỗi rõ kèm gợi ý.
  3. Không arg: quét `<cwd>\.orch-run\`.
- Quét wave: tái dùng export của `scripts/orch-forensics-map.js` nếu API phù hợp (nó đã scan `.orch-run/*/state.json` + `sanitizeControl`); không phù hợp → tự glob đơn giản (≤10 dòng), KHÔNG refactor file đó.
- Summary mode (default, mỗi wave sort theo mtime state desc):
  - Header: tên wave, statePath, đếm intent pending (`nested-request-*`/`chain-request-*` có `status:"pending"`).
  - Mỗi agent 1 dòng: `id | label | engine | status | depth | started→finished` + `out=<bytes>@<mtime HH:mm:ss>` (codex) + `result=<status từ result.json>` nếu có + `sid=<claudeSessionId 8 ký tự>` nếu có.
  - Heuristic: `status===running` && out.jsonl mtime cũ hơn 5 phút → nhãn `⚠ stalled?`. `status===running` && không có out.jsonl → `⚠ no-output`.
- `--tail <agentId> [-n 40]`: đọc tối đa 64KB CUỐI `agent-<id>-out.jsonl` (fs.read theo offset, KHÔNG đọc cả file), cắt bỏ phần trước newline đầu (dòng cụt), render qua `createCodexRenderer` (require từ `./launch-agent-ext`), chỉ in ~n events cuối. Agent claude → in hướng dẫn dùng `watch-agent.js <id> --state <abs> --once`.
- `--json`: in JSON machine-readable (waves/agents đủ field trên) cho skill parse.
- Output text đi qua `sanitizeControl` (out.jsonl là untrusted).

## Related Code Files

- Create: `scripts/orch-status.js`
- Create: `scripts/spike/test-orch-status.js` (+ fixture mới trong `scripts/spike/fixtures/` nếu cần — tái dùng fixture watch-agent nếu khớp)
- Modify: KHÔNG file nào khác (cấm sửa orch-forensics-map.js/watch-agent.js/launch-agent-ext.js — chỉ require)

## Implementation Steps

1. Viết resolver target theo thứ tự trên (hàm thuần, test được).
2. Viết reader wave: load state.json (strip BOM như nested-state làm), gom field, stat out.jsonl/result.json.
3. Summary printer + heuristic stalled/no-output.
4. Tail mode: byte-slice 64KB cuối + renderer; claude → message hướng dẫn.
5. `--json` mode.
6. `node --check`; viết `test-orch-status.js`: resolver (4 nhánh), summary đúng trường, stalled heuristic (mtime giả), tail không vỡ với dòng cụt đầu slice + strip control-char, exit 0 khi root rỗng ("no waves"), exit 2 khi target không resolve.
7. Chạy FULL suite `scripts/spike/test-*.js` — không phá test cũ.

## Success Criteria

- [ ] `node scripts/orch-status.js` (repo này) liệt kê govinv/mrfix... đúng status đã biết
- [ ] `node scripts/orch-status.js govoff` liệt kê mrsmoke + gantt-sync (multi-repo, tên trần)
- [ ] `node scripts/orch-status.js C:\Users\Bee\govoff\.orch-run\gantt-sync\state.json --tail orch-root-c3` render events cuối apply-sync
- [ ] test-orch-status.js PASS + full suite PASS + node --check sạch

## Risk Assessment

- API orch-forensics-map không khớp → fallback glob nội bộ (đã chốt, không refactor file ngoài).
- out.jsonl đang được ghi (worker sống) → đọc byte-slice an toàn, chấp nhận event cuối cụt (renderer tự skip).
- Tên repo trùng tên wave → thứ tự resolve đã chốt (wave cwd trước, repo sau) + in rõ đã resolve thành gì.
