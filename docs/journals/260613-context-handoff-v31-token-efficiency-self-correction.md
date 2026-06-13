---
title: "Skill /context-handoff v3.1.0 — Token Efficiency + Self-Correction Loop"
date: 2026-06-13
type: journal
tags: [context-handoff, token-efficiency, self-correction, skill, orchestration-handoff]
status: done
---

# Skill /context-handoff v3.1.0 — Token Efficiency + Self-Correction Loop

**Date:** 2026-06-13 | **Severity:** High | **Component:** Context handoff skill (global), orchestration doc generation | **Status:** Resolved

## Điều gì xảy ra

Phiên cook skill global /context-handoff từ v3.0.0 → v3.1.0 hoàn tất vào 2026-06-13. Plan `260613-0719-context-handoff-token-efficiency-redesign` với 4 phase tuần tự: (1) tách module + fix 2 bug cấp độ, (2) tối ưu SKILL.md description + references, (3) thêm vòng self-correction xuyên phiên (hypothesis → prediction → verify), (4) verify token e2e + test suite.

**Kết quả chính:**
- Token Activation: −30% (2.152 → 1.499 tok) ✓
- Token Creation git-only: −46% (6.072 → 3.271) ✓
- Token Creation+orch: −57% (9.232 → 4.003) ✓
- Token Resume: −36~48% (5.152 → 2.655–3.291) ✓
- Test Suite: **301 pass** (từ 264 baseline) — mọi file code <200 dòng ✓
- E2E: **9/9 data thật** PASS, 0 regression, 100% trigger coverage ✓

## Sự thật tàn nhẫn

Đối mặt 2 bug v3.0.0 **căn cơ** gây sự cố **real production:**

1. **Circular require vỡ `--trail` argument**: `resume-handoff.js:177` lazy-require không khóa được `trace-decision-trail.js:10` yêu cầu ngược `parseHandoff` → khi CLI block chạy **trước** `module.exports`, TypeError "parseHandoff is not a function" bắn vào mặt. Reproduce live: chạy `resume-handoff.js <handoff> --trail` trên handoff thật, TypeError mất ngay. Phổ biến nhất của circular require vòng tía: thế hệ code cũ chỉ biết "lazy require = fix được vòng", nhưng nếu 1 đầu (trace-decision-trail) yêu cầu TOP-LEVEL thì lazy ở đầu kia (resume-handoff) vô dụng. Fix sạch hơn: **tách module hoàn toàn**. `parse-handoff.js` (parser thuần) được require bởi `trace-decision-trail` trực tiếp, `resume-handoff.js` export sau CLI. Cycle triệt tiêu, không cần lazy.

2. **Metadata regex âm thầm degrade**: regex lúc v3.0.0 `/^\*\*([^*]+)\*\*:\s*(.+)$/` chỉ match format `**Key**: value` (colon SAU đóng ngoặc). Nhưng skeleton + handoff thật dùng `**Ngày:** value` (colon TRƯỚC đóng ngoặc — Vietnamese Markdown convention). Resume prompt từ, ngập ngừng lơ lửng `Branch: unknown` thay vì `Branch: main`. Suy nhân: developer vội quá, chỉ test format skeleton ban đầu, không test thực tế handoff. Fix: accept cả 2 form `/^\*\*([^*:]+):?\*\*:?\s+(.+)$/` hay 2 regex tuần tự.

**Điểm đau:**
- Phát hiện 2 bug này **TRƯỚC khi fix** bằng cách reproduce LIVE trên handoff thật — không phải phỏng đoán. Đây là bài học lớn: test fixture khác reality.
- Bug 1 ẩn trong "best practice" lazy-require — quá tin tưởng pattern cũ mà không check mỗi node trong vòng.
- Bug 2 lặng lẽ, không alert, chỉ symptom là `unknown` trong resume prompt. 5 phút debug mới phát hiện. Rất nguy hiểm vì user có thể dùng skill nhiều lần mà không thấy `Branch: main` và suy ra wrong context.

## Chi tiết kỹ thuật

### 1. Tách Module — Giải 2 Vấn Đề Cùng Một Cú Đập

**Decision:** Tách `parse-handoff.js` (135 dòng, parser thuần) khỏi `resume-handoff.js` (112 dòng sau refactor).

```
TRƯỚC:
resume-handoff.js (300+ dòng)
├─ parseHandoff function
├─ CLI block
└─ module.exports ← lazy require <── trace-decision-trail require
                                     (circular)

SAU:
parse-handoff.js (135 dòng)
├─ parseHandoff export sạch
└─ khỏi CLI

resume-handoff.js (112 dòng)
├─ require('parse-handoff.js') trực tiếp
├─ CLI block
└─ module.exports ← không circular
```

**Lợi ích đôi:**
- (a) Đưa resume-handoff về 112 dòng <200 limit.
- (b) Triệt tiêu circular require hoàn toàn — không cần lazy, không cần trick exports-before-CLI.

**Impact:** Skill code giảm từ 26 script → 27 (thêm parse-handoff.js), nhưng mỗi file rõ ràng, mỗi file <200 dòng.

### 2. Metadata Regex Double-Format (Bug Fix F1)

**Handoff thực tế dùng:** `**Ngày:** 2026-06-13` (colon TRƯỚC đóng ngoặc)
**Skeleton test dùng:** `**Key**: value` (colon SAU đóng ngoặc)

Fix regex chấp nhận cả 2:
```javascript
/^\*\*([^*:]+):?\*\*:?\s+(.+)$/
// hoặc safe hơn: 2 regex tuần tự test cả form
```

**Verified:** Chạy `resume-handoff.js` trên handoff real lấy từ `plans/reports/`, metadata ra `Branch: main, Plan: ..., Trạng thái: done` (hết `unknown`).

### 3. Template Embed Vào Script — Giảm 46% Token Creation

**Trước v3.0:** `gather-context.js` đọc reference skeleton từ file:
- `references/handoff-skeleton.md` (1.217 tok)
- `references/handoff-skeleton-orch.md` (cộng)
- Filled example (979 tok)
→ **2.196 tok** phải đọc lúc Creation.

**Sau v3.1:** `gather-context.js` dùng `handoff-template.js` (constants):
```javascript
const HANDOFF_TEMPLATE = `## Tổng Quan
...
## Giả Thuyết & Dự Đoán
...
## Next Steps
...`;

const DOMAIN_SPLIT_HINT = "4 câu để tách domain";
const ORCH_GUIDANCE = "placeholders orch-plan";
```

Kết quả:
- Draft output **tự chứa skeleton** → Creation không cần đọc reference.
- `format-handoff-draft.js` (158 dòng) compose từ template constants + git data.
- Token: từ 6.072 → 3.271 (−46%).

**Cảnh báo:** `handoff-template.js` hiện 165 dòng (safe, <200). Nếu section mới thêm vào vượt, cần tách `ORCH_GUIDANCE` sang file riêng.

### 4. Resume Control-Plane vs Data-Plane (Red-team F2/F3)

**User decision (từ red-team audit):** KHÔNG thay nội dung handoff doc bằng JSON control-plane. Lý do: prose + mermaid + wikilinks + full orchestration-plan không thể mã hóa vào JSON mà vẫn có ích.

**Implementation:**
```
resume-handoff.js --brief ──> JSON control plane
                              {file, ageDays, validation, trail [D#]}
                              
resume-handoff.js (full)  ──> resume prompt gọi
                              generate-resume-prompt.js, dùng parse
                              
User LUÔN đọc handoff doc ──> data plane duy nhất (prose, mermaid, wikilinks)
```

**Impact:** Control-plane JSON nhỏ (244 tok), phục vụ orchestration checking (stale age, validation status, trail). Data-plane là handoff doc full, luôn đọc.

### 5. Vòng Tự-Sửa-Sai Xuyên Phiên (User Requirement Mới)

User yêu cầu (phỏng vấn 2026-06-13): "Tool-use là phần dễ. Tự sửa sai mới là phần khó."

**Architecture:**
- **Phiên N (Creation):** Ghi section `## Giả Thuyết & Dự Đoán` (bảng 3 cột: giả thuyết | căn cứ | cách verify) + metadata `**Verify:** {lệnh + kết quả đo thực}`.
- **Phiên N+1 (Resume):** (1) Đọc handoff. (2) Chạy lại lệnh **Verify:** → kết quả khác doc? (3) So từng prediction ↔ reality (git, test, orch). (4) Mâu thuẫn → ghi tường minh, **tin REALITY không tin doc**. (5) Ghi dead-end `[D#]` ở handoff kế tiếp.
- **High-risk gates (AskUserQuestion):** stale >7 ngày, wave còn `running`, prediction-reality lệch làm đổi hướng approach, mâu thuẫn với user-decision.

**Verified e2e:** Tạo handoff với prediction sai chủ ý (vd "301 tests pass" nhưng thực tế 298) → resume → detect contradiction → ghi `[D2]` dead-end node → trace xuyên phiên.

## Bài học lớn

### 1. **Tách Module Giải 2 Vấn Đề Cùng Lúc**
Circular require là triệu chứng, không phải nguyên nhân. Thay vì band-aid lazy-require, tách module sạch khỏi CLI. Result: 2 benefit cùng cú (giảm 188 dòng, hết circular). Này là refactor đúng cách.

### 2. **Guard User-Decision Chống YAGNI Drift**
Description v3.1 tăng từ 256 → 272 tok (dù dự tính giảm). Lý do: +3 trigger guardrails cần dài để rõ ràng. Red-team đề xuất cắt xuống 400 chars, nhưng user chốt "recall > token, description là sợi dây duy trì ngữ cảnh xuyên phiên". Decision đã lock, không đổi. Bài học: khi audit/YAGNI đơi xuất "tính thêm", **kiểm tra lại user-decision gốc**. Không auto-apply audit mà không khảo sát.

### 3. **Verify Bug Bằng Reproduce Live, Không Dự Đoán**
Bug 1 (circular require) và Bug 2 (metadata regex) chỉ lộ khi run `resume-handoff.js <thực-tế-handoff>` — không phát hiện từ unit test vì test dùng fixture khác. Dự đoán "lazy-require sẽ OK" + "skeleton format = thực tế format" = SAI. Bài học: fixture test ≠ real artifact. Luôn chạy lại trên thực tế trước đóng yên.

### 4. **Schema Variance Giả Sử vs Thực Tế**
Lúc design, giả định "tất cả handoff tuân skeleton nguyên bản". Thực tế: 25 wave trong `.orch-run`, schema có 7 biến thể (missing fields, variant metadata format). Bài học: chuẩn hóa schema lúc ghi (lực bắt buộc tại source) tốt hơn tolerant-parse lúc read (vì lúc read đã quá muộn để sửa). Vừa đây fix metadata regex là example "tolerant-parse fail", vừa là caution để v3.2 chuẩn hóa ghi.

### 5. **Test Fragility Cần Explicit Setup**
`listRecentWaves` test dùng `maxAgeHours: 0.000001` = race 3.6ms thực tế wall-clock. Khi suite chạy nhanh (CI/CD), test fail lơ lửng. Fix: backdate mtime tường minh qua `fs.utimes()` thay dựa thời gian trôi. Bài học: time-dependent test phải mock/control thời gian, không dựa system clock.

## Quyết định đã chốt

✓ Tách `parse-handoff.js` khỏi `resume-handoff.js` — vừa giảm dòng vừa hết circular.
✓ Metadata regex accept cả 2 format `**Key:** value` và `**Key**: value`.
✓ Template embed vào script (constants), không đọc reference → −46% token Creation.
✓ Resume `--brief` JSON control-plane, luôn đọc handoff doc as data-plane.
✓ Section `## Giả Thuyết & Dự Đoán` + vòng tự-sửa-sai xuyên phiên.
✓ Description KHÔNG cắt dù YAGNI đợi (user decision: recall > token).
✓ 301 tests pass, mọi file <200 dòng, 9/9 e2e data thật.

## Trạng thái & Next Steps

**Resolve:** Skill v3.1.0 live tại `~/.claude/skills/context-handoff/`. Plan `260613-0719-context-handoff-token-efficiency-redesign` đóng **completed**. Commit plan + reports vào repo (commit `6c506bc`).

Skill code ngoài repo — nếu user muốn version-control skill, commit riêng.

**Không block:** 3-tier model, orchestration multi-repo, phiên cook kế tiếp.

**Nếu regression về sau:** Debug từ phase này — F1 metadata regex, F2/F3 control/data-plane sep, F6 Reflect comment, F7 absolute path re-check, F8 fixture ≥2 handoffs trong test.

---

**Phần bị thách thức:** Integration giữa token optimization + self-correction guardrails — cần giữ both mà SKILL.md ≤6000 chars (chỉ còn 4 chars dư, F10). Tương lai nếu thêm feature phải tách ORCH_GUIDANCE sang file riêng.

**Phần thành công:** Vòng self-correction e2e chạy OK (prediction → contradiction → dead-end [D#] → resume ghi trail), user có thể trace lỗi xuyên phiên một cách tường minh.
