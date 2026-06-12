---
phase: 2
title: "Skill watch-agent SKILL.md"
status: pending
priority: P2
effort: "1h"
dependencies: [1]
---

# Phase 2: Skill watch-agent SKILL.md

## Overview

Skill project-local `.claude/skills/watch-agent/SKILL.md`: khi user gõ `/watch-agent [target]`, Claude thu thập forensics qua orch-status + watch-agent rồi TƯỜNG THUẬT: phân công, tư duy, hành động của từng session/wave. READ-ONLY.

## Requirements

- Functional: nhận target linh hoạt (wave | repo | path | trống); báo cáo theo template cố định; nhanh (tổng quan 1 lệnh, đào sâu có chọn lọc).
- Non-functional: token-efficient (bounded reads, không cat file lớn); không spawn/kill/sửa state; tiếng Việt.

## Architecture

SKILL.md frontmatter: `name: watch-agent`, `description` nêu trigger: user gõ `/watch-agent [tên wave|tên repo|đường dẫn]`, muốn biết orchestration sessions đang phân công/tư duy/hành động ra sao — quan sát read-only.

Workflow trong skill (5 bước):

1. **Resolve target** — đúng thứ tự của orch-status (phase 1); không arg → discovery: chạy orch-status trên cwd + các work-repo đã biết (đọc mục Orchestration trong `~/.claude/CLAUDE.md` + memory; tối thiểu thử `C:\Users\Bee\govoff`).
2. **Tổng quan:** `node scripts/orch-status.js <target>` → dựng bảng PHÂN CÔNG per wave: `agent | label | engine/tier | status | freshness`. Kèm intent pending (nested/chain) = "orchestrator đang định giao thêm gì".
3. **Đào sâu có chọn lọc** (mặc định ≤3 agent, ưu tiên: running → failed/stalled → completed mới nhất; nhiều hơn thì hỏi user chọn):
   - codex → `node scripts/orch-status.js <target> --tail <id>` (events cuối: lệnh, ✓/✗, ✎, ▣ decisions).
   - claude → `node scripts/watch-agent.js <id> --state <abs state> --once` (transcript render).
4. **Orchestrator session đích (best-effort, optional):** jsonl mtime mới nhất trong `~/.claude/projects/<repo-slug>/` → tail bounded (node byte-slice, KHÔNG đọc cả file) → tóm 2-3 hành động/assistant text gần nhất. Ghi chú trong báo cáo đây là phiên LIVE của user — chỉ đọc.
5. **Tường thuật theo template:**
   - `## Wave <tên> (<repo>)` → bảng phân công → per agent 2-4 bullet "đang/đã làm gì" (dịch events thành lời: lệnh gần nhất, file đổi, decisions, result) → `### Cảnh báo` (stalled/no-output/failed/`model_refusal_fallback` nếu lộ trong transcript) → `### Gợi ý theo dõi tiếp` (lệnh watch live cho user tự chạy trong terminal: mode follow + Ctrl+C; nhắc KHÔNG reap/close khi 2 wmux window mở).

Ràng buộc ghi thẳng trong skill: bounded reads; không bao giờ chạy lệnh wmux mutate (spawn/close/kill/reap); kết quả completed dựa result-file (pane sống ≠ đang chạy); cross-repo luôn truyền `--state` tuyệt đối.

## Related Code Files

- Create: `.claude/skills/watch-agent/SKILL.md`
- Modify: không (script đã xong ở phase 1)

## Implementation Steps

1. Viết SKILL.md theo kiến trúc trên (≤150 dòng): frontmatter, When to use, Workflow 5 bước, template báo cáo, ràng buộc, 3 ví dụ gọi (`/watch-agent` | `/watch-agent gantt-sync` | `/watch-agent govoff`).
2. Đối chiếu lệnh trong skill khớp interface orch-status.js thật (phase 1 đã chốt flags).
3. Kiểm skill xuất hiện trong catalog phiên mới (restart/`/skills` — ghi vào success criteria của phase 3 nếu cần phiên mới).

## Success Criteria

- [ ] SKILL.md tồn tại, frontmatter hợp lệ, lệnh khớp interface thật
- [ ] Mô phỏng `/watch-agent gantt-sync` trong phiên này theo đúng workflow skill ra báo cáo đúng template
- [ ] Không chứa bất kỳ lệnh mutate nào (grep: spawn|close-pane|kill|reap|--confirm → 0 hit trong phần lệnh thực thi)

## Risk Assessment

- Skill catalog chỉ nạp đầu phiên → phiên hiện tại có thể chưa thấy `/watch-agent`; nghiệm thu bằng mô phỏng workflow + xác nhận ở phiên sau (ghi rõ trong báo cáo).
- Tail transcript phiên live của user: chỉ đọc, best-effort, có thể thiếu ngữ cảnh — skill phải nhãn rõ "best-effort".
