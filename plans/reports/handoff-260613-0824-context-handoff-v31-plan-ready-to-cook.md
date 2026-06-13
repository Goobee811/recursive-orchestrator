# Handoff — context-handoff v3.1 plan ready-to-cook

Plan nâng skill global context-handoff lên v3.1 đã hoàn chỉnh qua deep mode (3 researchers + red-team 13 findings absorbed + validate interview 4 user decisions). Phiên sau chỉ cần cook plan — mọi quyết định lớn đã chốt, không re-litigate.

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-13 01:24 |
| Branch | main |
| Plan | plans/260613-0719-context-handoff-token-efficiency-redesign |
| Trạng thái | ready-to-cook |

## 1. Công Việc Đã Hoàn Thành

| Công việc | Files | Trạng thái |
|-----------|-------|------------|
| Đo runtime token 4 lớp + audit skill-creator + design patterns (3 researchers) | `plans/260613-0719-.../research/researcher-01..03-*.md` | done |
| Plan 4 phases (scripts → instructions → guardrails → verification) | `plan.md` + `phase-01..04-*.md` | done |
| Red-team review: 1 CRITICAL + 3 HIGH + 9 khác — TẤT CẢ đã xử lý vào plan | `reports/from-red-team-to-planner-adversarial-plan-review.md` | done |
| Validate interview: 4 user decisions ghi vào plan.md § User Decisions | `plan.md` | done |
| Tasks hydrated #1→#4 chuỗi blockedBy (session-scoped — phiên sau cook tự re-hydrate từ plan files) | — | done |

## 2. Trạng Thái Hiện Tại

| Khía cạnh | Chi tiết |
|-----------|----------|
| Chưa commit | Plan dir mới `260613-0719-*` (untracked) + leftover phiên trước: `docs/orchestration-system.md` (modified), `plans/260613-0631-*` (untracked) |
| Lỗi/Tests | 2 bug v3.0.0 ĐÃ XÁC MINH chờ fix ở Phase 1: (a) circular require — `resume-handoff.js --trail` TypeError (`trace-decision-trail.js:10` require ngược khi CLI chạy trước `module.exports:211`); (b) metadata regex `resume-handoff.js:78` không match `**Ngày:** value` → resume prompt âm thầm `Branch: unknown` |

## 3. Quyết Định & Bối Cảnh

| Quyết định | Lý do |
|------------|-------|
| Template nhúng vào script (`handoff-template.js` mới), draft tự hướng dẫn | Save 1.2-2.5k tok/Creation — bỏ đọc skeleton/example mặc định; round-trip test với parseHandoff bảo vệ |
| Resume control/data-plane: `--brief` JSON (stale/validate/trail) + LUÔN đọc doc | Red-team F2/F3 bác "JSON đủ thay đọc doc" (mất prose/mermaid/wikilinks); user chốt "luôn đọc doc như cũ" |
| Description KHÔNG cắt — chỉ tune-up, coverage 100% triggers | USER DECISION: "sợi dây duy trì ngữ cảnh xuyên phiên... tokens đáng bỏ ra" — đảo đề xuất R2 cắt còn 400 chars |
| THÊM Phase 3 guardrails: giả thuyết → prediction → Verify → mâu thuẫn → user review gates | USER YÊU CẦU MỚI: "Tool-use là phần dễ. Tự sửa sai mới là phần khó" |
| REJECT: snapshot/full split, SKILL.md siêu mỏng, YAML ledger (defer), tiered mini-handoff | Vi phạm 1-doc-1-domain / R3 tự bác / YAGNI — chi tiết bảng plan.md § Quyết định thiết kế |
| References 8 .md → 4 .md (+1 .json), xóa skills-keyword-map.md | User đồng ý; .md là mirror chết, script chỉ đọc .json |

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| Không blocker | — | Red-team xác nhận fix circular require đúng & đủ (đã map require graph); plan cook được ngay. Leftover phiên trước + plan dir đã commit cuối phiên planning |

## 5. File Tham Chiếu

| File | Vai trò |
|------|---------|
| `plans/260613-0719-context-handoff-token-efficiency-redesign/plan.md` | ĐỌC ĐẦU TIÊN — targets 4 lớp, quyết định adopt/reject, § User Decisions (KHÔNG tự đảo) |
| `plans/260613-0719-.../phase-01-scripts-embedded-template-self-contained-resume-bugfix.md` | Phase cook đầu tiên — specs scripts + 2 bugfix + tests |
| `plans/260613-0719-.../reports/from-red-team-to-planner-adversarial-plan-review.md` | Evidence F1-F13 khi cần đối chiếu lúc implement |
| `~/.claude/skills/context-handoff/` | Đối tượng sửa (skill GLOBAL — ngoài repo này) |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[plans/260613-0719-context-handoff-token-efficiency-redesign/plan]] | Plan active — cook target |
| [[plans/260613-0631-context-handoff-v3-orchestration-aware/plan]] | Plan v3.0.0 done sáng nay — nền của vòng này |
| [[docs/orchestration-system]] | Phase 4 sẽ cập nhật § Handoff giữa các phiên |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 1 | `/ck:cook plans/260613-0719-context-handoff-token-efficiency-redesign` — chạy 4 phases tuần tự | Không |
| 2 | Phase 4 xong: bảng token before/after vào `reports/verify-260613-token-before-after.md` | Phases 1-3 |
| 3 | Sau cook: `/ck:journal` + commit (plan dir vào repo; skill global không thuộc repo) | Cook xong |

## 8. Resume Prompt

> Auto-generated bởi `node scripts/generate-resume-prompt.js <file>`. Copy prompt bên dưới để bắt đầu session mới.

```
Resume từ handoff: plans/reports/handoff-260613-0824-context-handoff-v31-plan-ready-to-cook.md

Context: Plan nâng skill global context-handoff lên v3.1 đã hoàn chỉnh qua deep mode (3 researchers + red-team 13 findings absorbed + validate interview 4 user decisions). Phiên sau chỉ cần cook plan — mọi quyết định lớn đã chốt, không re-litigate.
Branch: main
Plan: plans/260613-0719-context-handoff-token-efficiency-redesign
Trạng thái: ready-to-cook

Việc cần làm (ưu tiên):
1. `/ck:cook plans/260613-0719-context-handoff-token-efficiency-redesign` — chạy 4 phases tuần tự (phụ thuộc: Không)
2. Phase 4 xong: bảng token before/after vào `reports/verify-260613-token-before-after.md` (phụ thuộc: Phases 1-3)
3. Sau cook: `/ck:journal` + commit (plan dir vào repo; skill global không thuộc repo) (phụ thuộc: Cook xong)

Blockers: - Không blocker

Entry files:
- `plans/260613-0719-context-handoff-token-efficiency-redesign/plan.md`
- `plans/260613-0719-.../phase-01-scripts-embedded-template-self-contained-resume-bugfix.md`
- `plans/260613-0719-.../reports/from-red-team-to-planner-adversarial-plan-review.md`
- `~/.claude/skills/context-handoff/`

QUAN TRỌNG: Trước khi bắt đầu, kiểm tra skills catalog (cả global ~/.claude/skills/ và local .claude/skills/) và activate các skills phù hợp với công việc. Gợi ý hướng: testing, debugging, research, docs lookup, frontend design. Đừng bỏ qua skills — chúng giúp thực hiện công việc hiệu quả hơn.

Bắt đầu: Đọc handoff file → đọc entry files → activate skills → làm từ ưu tiên 1.
```
