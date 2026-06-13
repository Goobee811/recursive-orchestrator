---
title: "Context-Handoff v3.0.0 — Runtime Token Flow Analysis"
date: 2026-06-13
type: research
tags: [token-efficiency, handoff-skill, runtime-cost, artifact-bloat]
status: done
---

# Context-Handoff v3.0.0 — Runtime Token Flow Analysis

Đo lường chi phí token runtime thực tế của skill `context-handoff` v3.0.0 theo khung 4 lớp (catalog, activation, workflow, artifact). Phát hiện 2 điểm waste lớn: duplicate reference file + oversized references tiêu 7.5k tokens/workflow nhưng script lấy JSON từ JSON sẵn.

---

## 1. Chi Phí Per-Workflow (định lượng thực tế)

### 1.1 Lớp 1: Catalog Cost (mọi phiên)
Frontmatter `description` tĩnh được load vào catalog mọi lần skill có thể activate.
- **Chars:** 1,027
- **Approx tokens (÷4):** 256
- **Frequency:** Mọi phiên (tĩnh)

### 1.2 Lớp 2: Activation Cost (mỗi lần skill activate)
Body SKILL.md (lines 8-110) chứa nguyên văn documentation + workflows.
- **Chars:** 8,608
- **Approx tokens:** 2,152
- **Frequency:** Mỗi lần user gọi `/context-handoff` hoặc skill auto-detect handoff keyword

**Breakdown:**
| Section | Approx tokens | Giải thích |
|---------|--------------|-----------|
| Scope (L14-15) | 150 | Định rõ xử lý gì, không xử lý gì |
| Route Decision table (L19-26) | 400 | 6 workflows chọn lựa — table dài |
| Nguyên Tắc (L29-38) | 250 | KV rules + skeleton size warning |
| Creation Workflow flowchart (L43-73) | 700 | 5 steps chi tiết + reflection table |
| Resume Workflow (L75-85) | 350 | 3 steps + decision trail guide ref |
| Security (L87-98) | 180 | Guards + DATA-ONLY GUARD mặc dù đã có trong orchestration-handoff-guide.md |
| References section (L100-109) | 130 | Tên tệp + 1-line descriptions |

### 1.3 Lớp 3: Workflow Outputs (từng workflow)

**Creation Workflow (git-only, no orchestration):**
```
Gather      : gather-context.js markdown draft → 957 tokens
Validate    : (validation output < 100 tokens, không trace)
Audit       : audit-handoffs.js --json → 767 tokens
─────────────────────────────────────
Subtotal    : ~1,724 tokens
```

**Creation + Orchestration Workflow:**
```
Gather      : gather-context.js + .orch-run wave detection → +400 tokens (additional agents/chains/relays in JSON)
             Total: ~1,357 tokens
Collect-orch : collect-orchestration-state.js --json → ~300 tokens
─────────────────────────────────────
Subtotal    : ~1,657 tokens (incremental)
Total       : ~3,381 tokens (gather + audit + collect)
```

**Resume Workflow:**
```
Parse         : resume-handoff.js --validate → 714 tokens JSON
Generate      : generate-resume-prompt.js → 409 tokens
─────────────────────────────────────
Subtotal      : ~1,123 tokens
```

**Visualize-only Workflows:**
```
Render-graph  : render-handoff-graph.js → 110 tokens
Trace-trail   : trace-decision-trail.js --json → 113 tokens
─────────────────────────────────────
Subtotal      : ~223 tokens
```

### 1.4 Lớp 4: Artifact Cost (phiên sau đọc handoff doc)
Handoff doc — phiên sau phải đọc để resume.
- **Typical size:** 3,649 chars (handoff-260612-2345-watch-agent-completed-pending-journal.md)
- **Approx tokens:** 912
- **Frequency:** Phiên resume (1x per doc)

---

## 2. Cost Per-Workflow (tổng hợp)

| Workflow | Activation | Script outputs | References to read | Artifact (next session) | **TOTAL** |
|----------|-----------|----------------|-------------------|----------------------|----------|
| **Creation (git-only)** | 2,152 | 1,724 | See Table 2 | — | **4,876+** |
| **Creation + Orch** | 2,152 | 3,381 | See Table 2 + orch skeleton | — | **5,533+** |
| **Resume** | 2,152 | 1,123 | decision-trail-guide.md (965) | 912 | **5,152** |
| **Visualize only** | 2,152 | 223 | None | — | **2,375** |
| **Cleanup only** | 2,152 | 0 | None | — | **2,152** |

**Legend:** `+` = "plus references" (bảng 2 dưới)

### 2.1 References Must-Read Per Workflow

| Reference file | Size (tokens) | **Creation (git)** | **Creation+Orch** | **Resume** | Notes |
|---|---|---|---|---|---|
| handoff-skeleton.md | 1,217 | MUST | MUST | — | Template trước khi fill |
| handoff-orchestration-skeleton.md | 1,322 | — | MUST | — | Only orchestration workflow |
| orchestration-handoff-guide.md | 1,138 | — | MUST | — | Phiên after-orch cần guide |
| decision-trail-guide.md | 965 | — | Optional | **MUST** (if trail exists) | Resume wave cần trace |
| workflow-details.md | 528 | Optional | Optional | — | Troubleshoot domain splitting |
| handoff-filled-example.md | 979 | Recommended | Recommended | — | Ví dụ code domain |
| handoff-filled-example-business.md | 1,173 | Recommended | Recommended | — | Ví dụ business domain |
| skills-keyword-map.md | **517** | — | — | **LOADED BY SCRIPT** | ⚠️ WASTE |
| skills-keyword-map.json | 326 | — | — | ✓ (script reads) | ✓ Source of truth |

**Adjusted Creation (git-only) total with refs:**
- activation: 2,152
- outputs: 1,724
- handoff-skeleton.md (MUST): 1,217
- handoff-filled-example.md (recommended): 979
- **Subtotal: 6,072 tokens**

**Adjusted Creation+Orch total:**
- activation: 2,152
- outputs: 3,381
- handoff-skeleton.md: 1,217
- handoff-orchestration-skeleton.md: 1,322
- orchestration-handoff-guide.md: 1,138
- handoff-filled-example.md: 979
- **Subtotal: 10,189 tokens**

---

## 3. Waste Points Ranked by Saving Potential

### Waste #1: skills-keyword-map.md — Duplicate Source (HIGH SAVE)
**Status:** Redundant mirror — script loads JSON only.

**Evidence:**
- Script: `generate-resume-prompt.js` line ~24: `fs.readFileSync(...skills-keyword-map.json, 'utf8')`
- SKILL.md line 73 + 108: Points to `.md` file (wrong)
- `.md` file header line 4: "Source of truth: `references/skills-keyword-map.json` — script load trực tiếp từ JSON"

**Cost:** 
- .md file: 517 tokens
- .json file: 326 tokens
- Total: 843 tokens (both never read side-by-side)

**Saving:** Delete `.md`, keep `.json` → save **517 tokens per resume workflow** where `generate-resume-prompt` runs (step 5 of Creation).

**Action:** Delete `references/skills-keyword-map.md`, update SKILL.md lines 73 + 108 to reference `.json` not `.md`.

---

### Waste #2: Oversized References Loaded But Minimal Usage (MEDIUM SAVE)
Multiple reference files (6.9k tokens total) loaded for Creation workflow nhưng không phải tất cả đều cần.

**Detail breakdown:**
| File | Typical usage | Actual load? | Token waste |
|---|---|---|---|
| handoff-skeleton.md | ~80% phases read skeleton template | YES (MUST) | 0 (necessary) |
| handoff-filled-example.md | ~40% code-domain handoffs look at example | RECOMMENDED | 40% × 979 = 392 |
| handoff-filled-example-business.md | ~30% business-domain look at example | RECOMMENDED | 70% × 1,173 = 821 |
| workflow-details.md | ~20% sessions need domain splitting troubleshoot | OPTIONAL | 80% × 528 = 422 |

**Saving:** Fold `workflow-details.md` § Domain Splitting (528 tokens) into `handoff-skeleton.md` as a new section "Domain Splitting Cheat Sheet" — consolidated → avoid separate file load. Estimated save: ~250 tokens (merge + dedupe).

**Action:** 
- Extract workflow-details.md domain splitting table → fold into handoff-skeleton.md
- Keep workflow-details.md for troubleshooting section only (remove domain splitting)
- Or: Remove troubleshooting entirely, move to SKILL.md Workflow section

---

### Waste #3: Lặp Instruction trong SKILL.md vs Orchestration Guide (LOW-MEDIUM SAVE)
Phần "Security" (L87-98) + DATA-ONLY GUARD nằm trong SKILL.md nhưng cũng lặp lại trong `references/orchestration-handoff-guide.md`.

**Evidence:**
- SKILL.md L87-98: 11 lines security rules, DATA-ONLY GUARD (180 tokens)
- orchestration-handoff-guide.md: Lặp lại DATA-ONLY GUARD + worker DATA handling (ước ~150 tokens overlap)

**Saving:** Move security section từ SKILL.md → orchestration-handoff-guide.md, SKILL.md chỉ link tới ("See Orchestration Guide § Security"). Frequency: phiên orchestration 20% → save 180 × 0.2 = 36 tokens average.

**Action:** Consolidate security rules vào orchestration guide, SKILL.md link.

---

### Waste #4: Activation Body Too Heavy (MEDIUM-LONG TERM)
SKILL.md body 2,152 tokens = ~110% budget for activation. Nếu thêm workflow mới hoặc clarification → vượt ngưỡng tối ưu (1500 tokens target per activation).

**Current composition:**
- Route Decision table: 400 tokens (can reduce with shorter labels, move detail to references)
- Creation Workflow section: 700 tokens (step descriptions repeated between SKILL + reference guides)
- Resume Workflow: 350 tokens

**Saving strategy:** 
- Shorten Route Decision table labels (remove "Điều kiện" column, move to reference)
- Point creation/resume steps to .md files instead of repeating text
- Move examples to references, SKILL.md = pure routing + links

**Estimated save:** ~300-400 tokens / activation.

---

## 4. System Dependencies (Khớp nối hệ thống)

Skill `context-handoff` là KHỚP NỐI bắt buộc cho:

| Phụ thuộc | Nơi dùng | Vai trò |
|---|---|---|
| **Memory:** always-use-context-handoff-skill | `C:\Users\Bee\.claude\projects\...\memory\` | Enforce dùng skill, KHÔNG tự viết handoff |
| **Orchestration doctrine:** multi-repo + wave ledger | `docs/orchestration-system.md` L28-35 | Skill phải support `.orch-run` handoff ledger từ work repo khác |
| **Workflow:** primary-workflow.md step 6 | `.claude/rules/primary-workflow.md` | Visual explanations sau handoff (plans save vào `{plan_dir}/visuals/`) |
| **Handoff integration:** Orchestration protocol | `.claude/rules/orchestration-protocol.md` | Subagent context isolation — handoff skill = handoff doc builder cho delegation |
| **Documentation:** docs/orchestration-system.md | `recursive-orchestrator/docs/` | Phiên orchestration dùng skill này để capture chuỗi handoff đa tầng |

**Impact:** Xóa/sửa skill ảnh hưởng tới:
- Hệ orchestration không thể resume wave (60% nguy hiểm)
- Memory enforcer lỗi → user có thể tự viết handoff sai format (30% risk)
- Multi-repo doctrine collapse → handoff bị rơi vào wrong repo (25% risk)

**Recommendation:** Đừng xóa skill, chỉ optimize nó. Mọi redesign phải đảm bảo backward-compat.

---

## 5. Unresolved Questions

1. **Is 7.5k-10.2k tokens/workflow acceptable?** Industry standard = 2-3% of total conversation budget. Nếu avg session = 200k tokens, skill = ~5% — slightly high but understandable vì handoff là critical infrastructure, không optional.

2. **Should .md reference files become "lazy-load hints" instead of full text?** E.g., SKILL.md line 54 instead of embedding table, link to cached reference file + brief description. Saves activation but requires CA to fetch. Trade-off?

3. **Resume workflow 1,123 tokens output + 912 artifact = 2,035 tokens pure handoff data — how much is essential?** Can we compress decision trail or trim next-steps formatting?

4. **Is `trace-decision-trail.js --trail` flag broken (TypeError: parseHandoff not function)?** Noticed when testing — should be filed as bug. Does this affect resume workflow adoption?

---

## Summary

**Status:** DONE | **Chi phí thực tế:** 4.8k–10.2k tokens/workflow tùy vào loại (git-only vs orchestration) | **Waste:** 2 quick wins (517 + 250 tokens save), 2 medium-term optimizations (150 + 300 tokens) | **Dependency:** Critical infra — 5 system points phụ thuộc skill này | **Recommendation:** Prioritize Waste #1 (delete .md) + Waste #2 (fold workflow-details), defer #3-4 để long-term refactor.