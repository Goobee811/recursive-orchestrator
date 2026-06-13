---
title: "Red-Team Adversarial Review — Plan Context-Handoff v3.1 Token-Efficiency Redesign"
date: 2026-06-13
type: report
tags: [red-team, plan-review, context-handoff, token-efficiency]
status: done
---

# Red-Team Review — Plan v3.1 Token-Efficiency Redesign

Mọi finding đều grep/run-verified trên skill thật `~/.claude/skills/context-handoff/` (v3.0.0) + handoff thật repo này. Bug `--trail` đã reproduce live (TypeError đúng như plan mô tả). 13 findings: 1 CRITICAL, 3 HIGH, 5 MEDIUM, 4 LOW.

---

## CRITICAL

### F1 — Round-trip metadata VỠ: template "metadata KV" không parse được bởi parseHandoff, và round-trip test spec KHÔNG bắt

**Bằng chứng:**
- `resume-handoff.js:78` KV fallback regex: `/^\*\*([^*]+)\*\*:\s*(.+)$/` — đòi format `**Key**: value` (colon NGOÀI bold).
- `references/handoff-skeleton.md:14-17` (nguồn port template, phase-01 step 1): `**Ngày:** {YYYY-MM-DD HH:MM}` — colon TRONG bold. Đây cũng là convention KV của user (`markdown-formatting.md`: "`**Key:** Value`").
- Chạy thử: `'**Ngày:** 2026-06-13'.match(regex)` → **NO MATCH**. Chỉ `**Ngày**: ...` match. Comment `resume-handoff.js:66` "supports KV pairs (**Key:** Value)" là SAI so với code.
- Phase-01 L46 spec template "metadata KV"; nhưng L62 lại nói draft "GIỮ NGUYÊN data pre-fill hiện có" — pre-fill hiện tại emit metadata dạng TABLE (`format-handoff-draft.js:121-126` `| Trường | Giá trị |`). Hai chỉ thị mâu thuẫn.
- Phase-01 L47 round-trip test chỉ đòi `nextSteps/fileReferences/blockers/decisions/currentState` — **metadata KHÔNG có trong list** → test pass dù metadata parse rỗng.

**Impact:** nếu implementer port skeleton verbatim (KV colon-trong) → mọi handoff mới có metadata không parse được → `generate-resume-prompt.js:90-92` silently degrade `Branch: unknown / Plan: none / Trạng thái: unknown` trong resume prompt. Cùng lỗi áp vào parse `currentState` mới (phase-01 L64 spec "KV `**Key:** value`" — đúng format mà regex hiện tại không match).

**Fix đề xuất:** (a) chốt 1 format metadata duy nhất cho template (đề xuất GIỮ TABLE như draft hiện tại — parse đã chạy ổn, handoff thật dùng table); (b) nếu chọn KV thì sửa regex thành dạng chấp nhận cả hai: `/^\*\*([^*:]+):?\*\*:?\s*(.+)$/`; (c) THÊM metadata (Ngày/Branch/Plan/Trạng thái) vào field list bắt buộc của round-trip test.

---

## HIGH

### F2 — Claim "JSON đủ thay đọc doc" SAI cho nội dung ngoài-bảng và phiên orchestration

**Bằng chứng:**
- `parseHandoff` chỉ bắt 4+1 sections qua `parseTableRows` (`resume-handoff.js:89-99,133-147`) — **chỉ TABLE rows**. Không parse: `## Sơ Đồ Hệ Thống` (mermaid), `## 6. Liên Kết Chéo` (wikilinks), `## Wave Orchestration`, prose/bullet trong section.
- Orch skeleton `references/handoff-orchestration-skeleton.md:35` — section `## 1. Orchestrator Đã Plan Gì` KHÔNG match regex nào (`Bước Tiếp Theo|File Tham Chiếu|Vấn Đề|Quyết Định`) → bảng workstream/ý đồ phân công MẤT khỏi JSON. Chính skeleton này (L10) gọi đây là "phần GIÁ TRỊ NHẤT phải tự ghi".
- Handoff thật `plans/reports/handoff-260612-2345-...md:46-48`: Section 4 là prose + bullets ("Nit-1 để nguyên theo YAGNI", "3 handoff PRUNE — **user quyết KHÔNG dọn**") → `blockers = []` trong JSON. L63: wikilink SUPERSEDED → mất.

**Impact (case cụ thể):** phiên resume chỉ-JSON sẽ (a) không biết user đã quyết KHÔNG prune 3 handoff cũ → housekeeping phiên sau re-ask/re-suggest điều user đã chốt — vi phạm guard user-decisions; (b) resume wave partial không có ý đồ phân công gốc → re-dispatch mù hoặc buộc đọc lại doc (mất luôn khoản save 912 tok). Live state.json có agents/status nhưng KHÔNG có orchestrator rationale.

**Fix đề xuất:** (a) parse thêm section orch `Orchestrator Đã Plan Gì` (table) khi có; (b) conditional-read footer phải MẠNH cho handoff có wave section: "handoff orchestration → ĐỌC doc trước khi quyết re-dispatch"; (c) chấp nhận giới hạn: ghi rõ trong SKILL.md Resume rằng JSON không chứa mermaid/wikilinks/prose — đọc doc khi cần các phần đó (đừng claim "đủ").

### F3 — Target 3c Resume ≤3.700 tok không đạt được về số học nếu decision-trail-guide.md vẫn must-read, và baseline 714 đo khi --trail ĐANG VỠ

**Bằng chứng:**
- R1 §2: Resume = 2.152 (act) + 1.123 (outputs) + 965 (trail-guide MUST) + 912 (artifact) = 5.152. Số `714` (parse output) đo với `--validate` KHÔNG `--trail` — vì `--trail` crash (reproduce được). Sau bugfix, JSON resume PHÌNH: + trail text (cap 500 tok, `trace-decision-trail.js:130`) + `currentState` mới (~100) → parse ≈ 1.314.
- Cộng sau redesign: 1.500 (act target) + 1.314 (parse) + 937 (trail-guide đo thật ÷4) = **3.751 > 3.700** — FAIL trước khi tính generate-prompt. Bỏ trail-guide → 2.814 PASS thoải mái.
- Plan/phase-02 GIỮ decision-trail-guide.md nguyên trạng, KHÔNG nói resume có còn phải đọc nó không (SKILL.md hiện hành L85 trỏ nó từ Resume workflow).

**Impact:** Phase 3 "không hạ gate" → đo xong fail gate 3c → quay lại phase nào? Không phase nào own quyết định này.

**Fix đề xuất:** quyết định tường minh trong phase-02: trail JSON có node-ID `[D#]` tự giải thích → SKILL.md Resume KHÔNG yêu cầu đọc decision-trail-guide.md (chỉ trỏ on-demand khi user hỏi sâu). Ghi rõ vào đo lường phase-03: trail-guide không thuộc must-read Resume.

### F4 — Description draft 477 chars VƯỢT gate ≤450 của chính nó; strict-recall nhiều khả năng <85% → fallback C ~600 chars lại VI PHẠM target Layer-1 trong plan.md — hai gate không thể cùng thỏa

**Bằng chứng:**
- Đo draft phase-02 L40: **477 chars** > 450 (success criteria phase-02 L86 + plan.md L20). "decision trail" xuất hiện 2 lần trong draft (features + Triggers) — thừa 16 chars dễ cắt.
- Old description = 987 chars, **24 trigger phrases** (đếm từ SKILL.md:5). Phase-03 step 4 chấm STRICT: "không xuất hiện và không có synonym trực tiếp → FAIL". Misses khả dĩ của draft mới: `what was I working on` (không synonym), `switching tasks/projects` (bị bỏ), `sơ đồ handoff` (chỉ có "mermaid graphs" — khác ngôn ngữ), `what did we try`, `pick up tomorrow` (chỉ có bản VN "tiếp tục từ hôm qua") → 4-5 fails / 26-29 phrases ≈ 81-85% — sát/dưới gate 85%.
- Phase-02 L96 fallback: "nới lên ~600 chars (phương án C)". Nhưng plan.md Layer-1 target ghi cứng "≤450 chars" và phase-03 nói "KHÔNG hạ gate".

**Impact:** mâu thuẫn nội tại — nếu recall thắng thì target ≤450 vỡ; nếu ≤450 thắng thì recall vỡ. Phase 3 không có tie-break.

**Fix đề xuất:** sửa plan.md Layer-1 thành "≤450 mục tiêu; ≤600 chấp nhận nếu recall <85% (quyết định ưu tiên recall — user đã chốt ở validate interview)". Cắt sẵn draft xuống ≤450 (bỏ "decision trail" lặp, gộp "resume, continue"), thêm lại `what was I working on` hoặc khai báo phrase này được phép rớt.

---

## MEDIUM

### F5 — Baseline 3b (10.189 tok) double-count gather; headline "giảm 30-40%" chỉ đúng cho lớp catalog

**Bằng chứng:** R1 §1.3 (L42-58): Creation+Orch outputs = 1.724 (đã gồm gather git-only 957) + "incremental" 1.657 (lại gồm full gather 1.357) = 3.381 — gather bị đếm 2 lần. Đúng phải là 1.357+767+300 = **2.424** → before 3b ≈ 9.232, không phải 10.189. Per-layer giảm thực: 3a -26%, 3b -24% (vs số đúng), 3c -28% — chỉ catalog -55% chạm "30-40%+".

**Impact:** bảng before/after phase-03 sẽ tự khoe % cao hơn thực tế; target ≤7.000 vẫn đạt được (tính thành phần sau redesign ≈ 5.4-5.6k, dư biên) — chỉ số TRƯỚC sai, không phải target bất khả.

**Fix đề xuất:** sửa before 3b trong plan.md thành ~9.2k (ghi chú lỗi double-count của R1); đổi headline "30-40%" thành "24-55% tùy lớp".

### F6 — `<!-- Reflect: -->` comments: validator KHÔNG flag comment sót, và comment multi-line đầu doc LÀM BẨN overview → bẩn luôn resume prompt

**Bằng chứng:**
- `validate-handoff.js` không có check nào cho `<!--` sót lại (checks 9/9b chỉ bắt `{TODO...}` + `{...}` với prefix list cứng L109: `Approach|Mô tả|Vấn đề|...`). Placeholder mới từ ORCH_GUIDANCE (`{tên stream}`, `{VD: ...}`, `{wave-name}`, `{đường dẫn work repo...}` — orch-skeleton L24-71) KHÔNG nằm trong prefix list → save sót không ai cảnh báo.
- `resume-handoff.js:60` overview chỉ skip dòng BẮT ĐẦU bằng `<!--` — comment Reflect nhiều dòng ở "đầu doc" (phase-01 L61) → các dòng tiếp theo bị PUSH vào overview → `generate-resume-prompt` Context line chứa rác câu hỏi reflection.
- `validate-handoff.js` không xuất hiện trong Related Code Files của bất kỳ phase nào.

**Fix đề xuất:** (a) Reflect comments BẮT BUỘC single-line; (b) thêm check validator: `/<!--\s*Reflect/` còn trong doc → warn "unanswered reflect comment"; mở rộng prefix list 9b theo placeholders mới của template; (c) parseHandoff strip block comment `<!--[\s\S]*?-->` trước khi extract overview; (d) thêm validate-handoff.js vào file list phase-01.

### F7 — Dòng wave re-check trong resume prompt: nguồn hiện hành dùng đường dẫn RELATIVE — paste vào phiên mới ở work repo là VỠ

**Bằng chứng:** orch-skeleton L76-78 (nguồn ORCH_GUIDANCE): `node scripts/collect-orchestration-state.js --cwd <work-repo>...` — relative. Resume prompt được paste vào phiên mới cwd = work repo → resolve `<work-repo>/scripts/` (không tồn tại). Phase-01 L52 viết `node .../collect-orchestration-state.js` — "..." không spec absolute.

**Fix đề xuất:** generate-resume-prompt build dòng re-check bằng đường tuyệt đối từ `__dirname` của script (skill global path), không hardcode/relative. Thêm assertion vào test prompt mới.

### F8 — Regression test `--trail` có thể PASS RỖNG: TypeError chỉ trigger khi domain ≥2 handoffs

**Bằng chứng:** `trace-decision-trail.js:140-141` — chain 0 → return error; chain 1 → return note, KHÔNG BAO GIỜ gọi `parseHandoff` (chỉ gọi trong `chain.map` L144-146). Fixture 0 handoff còn cho exit 1 ('No handoff files found'). Phase-01 L57 chỉ ghi "spawn ..., expect exit 0, no TypeError" — không spec fixture.

**Fix đề xuất:** spec fixture tmp dir ≥2 handoff cùng domain slug (vd `handoff-260101-0001-auth-a.md` + `handoff-260102-0002-auth-b.md`), spawn `process.execPath` (không bare `node`) + `--dir <fixture>`; thêm control test: chạy trên code chưa fix phải FAIL (đã verify live: exit ≠ 0, TypeError tại trace L146).

### F9 — Script emit pointer tới file sẽ XÓA, và file giữ lại cũng trỏ file xóa — cả hai không nằm trong file-list phase nào

**Bằng chứng:**
- `format-orchestration-section.js:82` emit vào MỌI draft: `'<!-- ORCHESTRATION SESSION: dùng skeleton references/handoff-orchestration-skeleton.md...'` — file này Phase 2 xóa. Phase-01 sửa script này (append ORCH_GUIDANCE) nhưng không nhắc thay comment; Phase-02 Related Code Files chỉ có SKILL.md/evals/package.json.
- `references/orchestration-handoff-guide.md:3` (file GIỮ): "Skeleton: `handoff-orchestration-skeleton.md`" — phase-02 step 2 chỉ nói "nhận mapping", không nói sửa pointer L3.
- Các hit khác đã cover ổn: SKILL.md (L39,55,73,102-108 — rewrite toàn bộ ✓), evals.json 2 cases (step 5 ✓), handoff-skeleton.md L5/L103 (file bị transform ✓), 2 example cross-link nhau (gộp ✓). Tests KHÔNG đọc references/*.md (grep __tests__ = 0 hit đọc file; chỉ 1 tên test "skeleton sections" — cosmetic). Ngoài skill dir: docs/orchestration-system.md:623 trỏ orchestration-handoff-guide.md (GIỮ — không vỡ); memory dir + ~/.claude/rules + .claude/skills/watch-agent repo này: **0 hit** (grep verified); handoff/plan cũ trong plans/ = snapshot lịch sử (chính sách phase-03 chấp nhận ✓).

**Fix đề xuất:** thêm `format-orchestration-section.js` (comment L82) vào phase-01 step 3, và `orchestration-handoff-guide.md:3` vào phase-02 step 2 — để sweep chỉ là verify, không phải khâu phát hiện.

---

## LOW

### F10 — handoff-template.js sát trần 200 dòng; authoring-guide thì AN TOÀN
Cộng nguồn: template block 76 dòng (skeleton L9-84) + Reflect ~8 + DOMAIN_SPLIT_HINT ~10 (workflow-details L5-14) + ORCH_GUIDANCE ~45-60 (orch-skeleton phần tự ghi Sec 1/2/3/5 + nguyên tắc) + helper/exports ~20 ≈ **160-175 dòng** — headroom ≤35 dòng, chưa có valve khi tràn. Đề xuất valve: ORCH_GUIDANCE đặt trong format-orchestration-section.js thay vì template module. Ngược lại handoff-authoring-guide.md ≈ 84-100 dòng (skeleton non-template 43 + split 10 + troubleshoot 9 + cross-refs 12 + headers) — xa trần 300, **CLEAR**.

### F11 — Section "Nguyên Tắc" (SKILL.md L29-38) không có chỗ trong architecture v3.1
Phase-02 L29-37 liệt kê 7 thành phần SKILL.md mới — không có Nguyên Tắc (size warn 300/2000, 1-doc-1-domain, snapshot >7 ngày, wikilinks, KV/tables). Hành vi sống trong validator/template nên không mất chức năng, nhưng checklist giữ-nguyên (phase-02 L98) không nhắc → dễ rơi im lặng khi viết lại. Đề xuất: thêm 4 rule này vào checklist giữ-nguyên (dạng nén 2-3 dòng).

### F12 — "exports-before-CLI" cho 11 scripts: lưu ý TDZ
`generate-resume-prompt.js:10` `SKILL_KEYWORD_MAP` là `const` — `module.exports` phải đặt SAU mọi const (TDZ), tức "ngay trước CLI block", không phải đầu file. Mọi function declaration đều hoisted nên còn lại an toàn. Thêm 1 câu vào phase-01 step (L55) tránh implementer máy móc.

### F13 — Gaps nhỏ plan không đề cập
- SKILL.md frontmatter `version: 3.1.0` — steps chỉ bump package.json (phase-02 L71); title nói v3.1.0 nhưng không có step sửa frontmatter version.
- `--since "4 hours ago"` default + hint "8 hours ago" cho phiên dài — không nằm trong checklist giữ-nguyên khi nén Creation step 1.
- Ai own việc update trigger-recall evals khi description đổi LẦN SAU — không định nghĩa (chỉ làm 1 lần ở phase-02).
- Hai phương pháp đếm token song song: phase-03 đo chars÷4 (theo R1) nhưng validator runtime dùng chars÷3.2 sau collapse whitespace (`utils.js estimateTokens`) — ngưỡng 300/2000 sống ở thang 3.2. Không phải bug, nhưng báo cáo before/after đừng trộn hai thang.

---

## Các góc đã kiểm và CLEAR

| Góc | Kết luận |
|---|---|
| Bug circular require (góc 3) | Phân tích plan CHÍNH XÁC từng line (trace L10 top-level require ngược; resume CLI L189-209 chạy trước exports L211; lazy L177). Reproduce live: TypeError tại trace L146. Fix (a) exports-before-CLI là load-bearing và ĐỦ; (b) lazy-require là belt-and-braces đúng. Map toàn bộ require graph: KHÔNG còn cycle nào khác (generate-resume-prompt→resume-handoff one-way; decision-trail-graph không require gì; mọi entry order khác đều an toàn) |
| Khớp nối 5 hệ phụ thuộc (góc 7) | Doctrine multi-repo giữ (handoff path relative-to-cwd OK, trừ F7); watch-agent hint GIỮ tường minh (phase-02 L34, L51); resume wave running giữ wave re-check + watch-agent; memory always-use-skill không bị ảnh hưởng (features memory nhắc — prompt-ready-to-paste, decision trail — đều giữ); docs update có step riêng (phase-03 step 6) |
| Guard user decisions (góc 8) | Không cắt feature user chốt: mermaid ✓, [D#] ✓, NGUYÊN VĂN prompt ✓ (risk table phase-01), AskUserQuestion ✓, housekeeping ✓, 1-doc-1-domain ✓ (REJECT R3-F là guard ĐÚNG — R3 recommend Option F nhưng plan bác với lý do user-decision, chuẩn mực), 5 reflection questions chuyển chỗ không cắt ✓, size warn sống trong validator ✓ (caveat F11) |
| Cross-plan overlap | Plan 260613-0631 (cùng skill) status **done** — không phải overlap pending; plan.md chỉ cần 1 câu ghi nhận v3.0.0 vừa ship sáng nay làm baseline |
| Phase sequencing | Không có trạng thái trung gian vỡ: file chỉ xóa ở Phase 2 cùng lúc rewrite SKILL.md (trừ F9 comment timing) |

## Điểm plan làm ĐÚNG (đừng sửa nhầm)

1. **Bug evidence chính xác tuyệt đối** — line numbers đúng 100%, điều kiện trigger "domain ≥2 handoffs" đúng (verified bằng code path + reproduce).
2. **Reject R3-F (snapshot/full split) và R3-D (SKILL siêu mỏng)** — đúng cả về user-decision guard lẫn kỹ thuật (R3 tự thừa nhận trade-off của chính nó).
3. **Giữ Security trong SKILL.md (reject R1-W3)** — threat model DATA-ONLY GUARD always-loaded là lập luận đúng; R1 đề xuất move chỉ save 36 tok trung bình, không đáng rủi ro.
4. **Round-trip test là ý tưởng đúng** (chỉ thiếu metadata trong field list — F1c).
5. **Backward-compat e2e case với handoff v3.0.0 thật** + zero-regression temp repo — đúng chỗ cần test.
6. **Trigger-recall eval có negative cases** (5 negative chống over-trigger) — hiếm plan nào nhớ chiều này.
7. **Phase-03 "không hạ gate, quay lại phase"** — kỷ luật đúng (chỉ cần fix F3/F4 để gate khả thi).
8. **Bỏ đọc skeleton mặc định bằng embed-in-script** — hướng đúng: draft hiện tại của script ĐÃ chứa structure đầy đủ (format-handoff-draft.js L117-181), references skeleton thực chất là bản sao thứ hai → hợp nhất là khử duplication thật.

## Unresolved Questions

1. Metadata format chốt là TABLE hay KV? (F1 — quyết định này đổi cả template, parse, và test; đề xuất TABLE vì handoff thật + draft script đều đang dùng table và parse ổn).
2. decision-trail-guide.md còn là must-read của Resume workflow không? (quyết định này định đoạt gate 3c — F3).
3. Khi recall <85%: gate ≤450 chars hay recall thắng? Cần user chốt 1 dòng trong plan.md (F4).
4. Handoff cũ ở CÁC WORK REPO KHÁC (doctrine multi-repo) chứa pointer tới skeleton bị xóa — xác nhận chính sách "snapshot lịch sử, không sửa" áp dụng cho mọi repo, không chỉ repo này?

---

**Status:** DONE
**Summary:** Plan nền tảng tốt (bug evidence chính xác, reject các option research sai, guard user decisions chuẩn) nhưng có 1 lỗi CRITICAL round-trip metadata-KV-vs-regex sẽ silently phá resume prompt cho mọi handoff mới, cộng 3 HIGH: claim "JSON đủ" sai cho orch/prose content, target 3c không đạt nổi nếu giữ trail-guide must-read, và description draft tự vượt gate 450 chars của chính nó.
**Số findings:** CRITICAL 1 (F1) | HIGH 3 (F2-F4) | MEDIUM 5 (F5-F9) | LOW 4 (F10-F13)
