---
phase: 2
title: "Instructions: SKILL.md + Description Tune-up + References Consolidation"
status: pending
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Instructions — SKILL.md + Description Tune-up + References Consolidation

## Overview

Nén lớp activation (SKILL.md ~2.152→≤1.500 tok) bằng cách chuyển nội dung vào draft output (không mất), tune-up description theo user decision (KHÔNG cắt — chỉ tăng chất lượng recall), tái cấu trúc references 8 .md → 4 .md theo no-duplication rule (template đã sống trong script từ Phase 1), cập nhật evals.

## Context Links

- Research: [[researcher-02-skill-creator-criteria-audit-report]] (3 phương án description + eval strategy)
- Chuẩn: `~/.claude/skills/skill-creator/references/token-efficiency-criteria.md`, `benchmark-optimization-guide.md` (5 bước — vòng này là bước 2 + 5)
- Phụ thuộc: Phase 1 xong (draft self-guiding) — SKILL.md mới trỏ vào guidance trong draft

## Requirements

- Functional: skill vẫn activate đúng với trigger song ngữ thực dụng; mọi route hiện hành giữ nguyên hành vi; pointers SKILL.md ↔ files khớp 100%
- Non-functional: description coverage 100% triggers v3.0.0 (không gate giảm chars — user decision); SKILL.md ≤6.000 chars (~1.500 tok) và <300 dòng; mỗi reference ≤300 dòng; no-duplication (template chỉ ở script)

## Architecture

**SKILL.md v3.1.0 (route-first, ~70-80 dòng):**
1. Frontmatter: `version: 3.1.0` (F13) + description mới (xem dưới)
2. Scope (giữ, nén)
3. Route Decision table (gọn — gộp cột Điều kiện vào mô tả workflow)
4. Nguyên Tắc — GIỮ, nén (size warn 300/2000, 1-doc-1-domain, snapshot, wikilinks là features đã chốt — F11)
5. Creation 5 steps — NÉN: bỏ mermaid flowchart trang trí; bảng 2b reflection questions THAY bằng 1 dòng "Trả lời mọi `<!-- Reflect: -->` trong draft trước khi fill" (questions sống trong draft từ Phase 1); chi tiết multi-domain/cluster → draft tự hướng dẫn
6. Resume 3 steps — control/data-plane (red-team F2/F3 + user decision "luôn đọc doc"): step 1 chạy `resume-handoff.js --brief --validate --trail` (stale/validation/trail); step 2 LUÔN ĐỌC handoff doc (nguồn nội dung duy nhất — KHÔNG chạy thêm full-JSON parse, hết double-read) + wave re-check khi có section Wave (`summary.running > 0` → gợi ý watch-agent); step 3 continue từ priority 1
7. **Chừa chỗ khối `## Guardrails`** — Phase 3 chèn (vòng tự-sửa-sai: prediction/Verify/mâu thuẫn/high-risk gates); budget 6.000 chars PHẢI tính sẵn ~600 chars cho khối này
8. Security — GIỮ NGUYÊN VỊ TRÍ trong SKILL.md (threat model: DATA-ONLY GUARD phải always-loaded), chỉ nén câu chữ trùng ý
9. References list cập nhật (4 .md + 1 .json)

**Description tune-up (user decision 2026-06-13: KHÔNG cắt — "số tokens này đáng để bỏ ra"):**
- GIỮ toàn bộ trigger phrases hiện tại (zero loss)
- AUDIT bổ sung: phrase nào user thực dùng mà description chưa có (đối chiếu memory + evals + trigger mới của guardrails nếu Phase 3 cần, vd 'so dự đoán', 'kiểm tra giả thuyết') → THÊM
- Được phép DÀI HƠN hiện tại nếu trigger thêm có giá trị; chỉ xóa khi 2 phrase trùng hệt nghĩa và đã có eval chứng minh không mất recall
- Gate duy nhất: coverage 100% phrases v3.0.0 (Phase 4 chấm)

**References consolidation (8 → 4 .md + 1 .json):**

| File hiện tại | Hành động | Đích |
|---|---|---|
| handoff-skeleton.md | ĐỔI THÀNH `handoff-authoring-guide.md` | Giữ: ví dụ multi/single-domain, anti-patterns, stale guidance; NHẬN: domain-splitting 4 câu hỏi + troubleshooting (từ workflow-details); XÓA khối template (đã ở `scripts/handoff-template.js` — để pointer) |
| handoff-orchestration-skeleton.md | XÓA | Guidance đã embed vào draft (Phase 1); phần mapping chuỗi handoff→sections chuyển vào orchestration-handoff-guide.md |
| orchestration-handoff-guide.md | GIỮ + nhận mapping + SỬA pointer dòng 3 đang trỏ orchestration-skeleton (F9) | Data sources, mermaid grammar, resume wave |
| workflow-details.md | XÓA | Domain-splitting + troubleshooting → authoring-guide; bảng cross-references skills → authoring-guide; riêng dòng watch-agent khi wave running GIỮ trong SKILL.md Resume step (route logic) |
| handoff-filled-example.md + -business.md | GỘP → `handoff-filled-examples.md` | 2 ví dụ, ≤300 dòng, on-demand |
| skills-keyword-map.md | XÓA | `.json` là source of truth (script đọc); SKILL.md trỏ `.json` |
| skills-keyword-map.json | GIỮ | — |
| decision-trail-guide.md | GIỮ NGUYÊN | Đã focused |

## Related Code Files

Trong `~/.claude/skills/context-handoff/`:
- Sửa: `SKILL.md` (v3.1.0), `evals/evals.json`, `scripts/package.json` (3.1.0)
- Tạo: `references/handoff-authoring-guide.md`, `references/handoff-filled-examples.md`
- Xóa: `references/handoff-skeleton.md`, `references/handoff-orchestration-skeleton.md`, `references/workflow-details.md`, `references/handoff-filled-example.md`, `references/handoff-filled-example-business.md`, `references/skills-keyword-map.md`

## Implementation Steps

1. Viết `handoff-authoring-guide.md` (gộp nội dung theo bảng trên, ≤300 dòng) + `handoff-filled-examples.md` (gộp 2 ví dụ).
2. Chuyển mapping chuỗi handoff→sections từ orchestration-skeleton vào `orchestration-handoff-guide.md` (vẫn ≤300 dòng).
3. Xóa 6 file references cũ.
4. Viết lại `SKILL.md` v3.1.0 theo architecture trên — đo `(Get-Content -Raw).Length` ≤6.000 chars; mọi pointer trỏ file/tên section TỒN TẠI (cross-check sau bước 3).
5. Cập nhật `evals/evals.json`: sửa cases tham chiếu hành vi cũ (đọc skeleton template file); THÊM section trigger-coverage: ≥26 positive phrases (toàn bộ triggers v3.0.0 — coverage phải 100%, không mất phrase nào) + ≥5 negative (vd "fetch my calendar", "viết journal phiên này", "xem wave đang chạy live", "spawn thêm worker", "tổng kết git tuần này"). Pass: 100% positive coverage, 100% negative reject.
6. `scripts/package.json` → 3.1.0 + SKILL.md frontmatter `version: 3.1.0` (F13).
7. Grep sweep trong skill dir (SKILL.md, references, scripts, evals, __tests__): không còn reference nào trỏ 6 file đã xóa — chú ý tests đang đọc `handoff-skeleton.md` nếu có (red-team Q4) phải đổi sang template module.

## Todo List

- [ ] handoff-authoring-guide.md + handoff-filled-examples.md
- [ ] orchestration-handoff-guide.md nhận mapping
- [ ] Xóa 6 references cũ
- [ ] SKILL.md v3.1.0 ≤6.000 chars; description tune-up coverage 100%
- [ ] evals.json: cases mới + trigger-recall section
- [ ] package.json 3.1.0
- [ ] Grep sweep dangling pointers trong skill dir

## Success Criteria

- [ ] Description: coverage 100% trigger phrases v3.0.0 (zero loss; được dài hơn nếu thêm trigger giá trị); SKILL.md ≤6.000 chars (đã tính chỗ khối Guardrails Phase 3), <300 dòng
- [ ] References: đúng 4 .md + 1 .json, mỗi file ≤300 dòng, zero template duplication
- [ ] Mọi pointer trong SKILL.md resolve được (file + section tồn tại)
- [ ] evals.json có trigger-coverage section (≥26 positive + ≥5 negative)
- [ ] Mọi route v3.0.0 vẫn có trong Route table (không mất workflow nào)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Tune-up vô tình xóa/đổi phrase đang hoạt động | Diff description cũ↔mới từng phrase; gate coverage 100% ở Phase 4 |
| Xóa file references phá pointer ở handoffs/docs cũ ngoài skill dir | Phase 4 grep sweep toàn cục (plans/reports, docs, memory) |
| SKILL.md nén mất instruction load-bearing (vd quy tắc NGUYÊN VĂN resume prompt, AskUserQuestion sau save) | Checklist giữ-nguyên trong step 4: NGUYÊN VĂN prompt, Ask Giữ/commit/Xóa, housekeeping PRUNE/REVIEW, stale >7 ngày, DATA-ONLY GUARD, wave re-check — diff review từng mục trước khi save |
| SKILL.md vượt 6.000 chars khi Phase 3 chèn Guardrails | Budget chừa sẵn ~600 chars; vượt → nén Route/Creation thêm, KHÔNG cắt guardrails (user decision) |
| Eval cases cũ fail vì hành vi mới | Sửa cases đồng bộ trong cùng phase, không để Phase 4 mới phát hiện |

## Security Considerations

- Security section KHÔNG rời SKILL.md — chỉ nén từ ngữ; đủ 6 nhóm: sensitive data, validator bắt buộc, role boundary, injection-as-data, DATA-ONLY GUARD, .orch-run READ-ONLY

## Next Steps

Phase 3 chèn khối Guardrails vào SKILL.md (chỗ đã chừa) + behavior; Phase 4 verify e2e + đo token + sweep toàn cục.
