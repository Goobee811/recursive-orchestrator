---
title: "Context Handoff v3.0.0 — Design Patterns & Token Efficiency Research"
date: 2026-06-13
type: research
tags: [context-handoff-skill, token-efficiency, design-patterns, agent-skills, orchestration]
status: done
---

# Nghiên Cứu Design Patterns cho Context Handoff v3.0.0

**Mục tiêu:** Tối ưu hóa skill context-handoff cho token-efficiency tối đa + hiệu quả tối đa, dựa trên engineering practices từ Anthropic, cộng đồng LLM agents, và local baseline.

---

## 1. Key Findings từ Web Research

### 1.1 Anthropic's Progressive Disclosure Pattern (Chính thức)

Nguồn: [Anthropic Platform — Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)

**Nguyên tắc inti:**
- **Level 1 (Metadata):** Chỉ name + description (~100 tok) — LUÔN loaded tại startup
- **Level 2 (Instructions):** SKILL.md (~5k tok tối đa) — loaded khi skill trigger
- **Level 3 (Resources):** Reference files, code scripts — loaded theo nhu cầu via bash, chỉ output vào context

**Giá trị:** "Unbounded bundled content" — không bị context penalty cho files không dùng.

**Áp dụng vào handoff v3.0.0:**
- Metadata trong YAML frontmatter (discovery info)
- Core handoff info trong body chính (next steps, blockers, decisions)
- Detailed orchestration data, full decision trail → reference files (đọc as-needed)

---

### 1.2 Token-Efficient Format Hierarchy (Nghiên cứu 2025-2026)

Nguồn: [Markdown-KV Efficiency Study](https://www.improvingagents.com/blog/best-input-data-format-for-llms/), [TOON Format Research](https://arxiv.org/pdf/2604.05865)

**Bảng so sánh:**

| Format | Token cost | Accuracy | Use case |
|--------|-----------|----------|----------|
| **KV pairs** `**Key:** value` | Thấp nhất | 60.7% (cao) | Metadata ≤8 fields, tỷ lệ key:value cao |
| **Markdown table** | Trung bình -33% vs JSON | Cao (bảng headers amortized) | Comparison matrices, multi-row data |
| **JSON** | Cao nhất (O(n·k) overhead) | Trung bình | Structured data cần parsing |
| **CSV** | Compact nhất (~80 token/row) | Thấp khi sparse | Dense tabular data, không cần parsing |
| **YAML** | Trung bình | Cao (nested clear) | Hierarchical/branching (orchestration chains) |

**Kết luận:** KV < Table < JSON/CSV; YAML tốt cho nested.

**Local practice validation:** markdown-formatting.md (CLAUDE.md subset) đã confirm:
- KV cho ≤10 items
- Table cho multi-row
- Danh sách > prose (~25% token savings)

---

### 1.3 Session Resume & Context Compression (2025-2026)

Nguồn: [Anthropic Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [ZenML LLMOps Context Compression](https://www.zenml.io/llmops-database/evaluating-context-compression-strategies-for-long-running-ai-agent-sessions)

**Nguyên tắc:**
- Resume cần "minimal sufficient context" — không quá tóm, không quá chi tiết
- 65% enterprise AI failures (2025) do **context drift** (quên state), KHÔNG context limit
- **Continuation probe** best-practice: "What should we do next?" verify agent recall

**Strategies:**
1. **Durable state + dynamic injection:** Persist structured session state, inject at resume
2. **Anchored iterative summarization:** Thay vì truncate/drop, summarize older turns
3. **Compaction API (provider-native):** Claude's native context compression (không implement user-side)

**Áp dụng vào resume prompt:**
- Prompt chỉ cần: entry files + next priority + blockers + file snapshot date
- KHÔNG replay full conversation history
- Verify wave state (nếu orchestration) trước resume

---

### 1.4 Agent Handoff Patterns (LangGraph, OpenAI Swarm)

Nguồn: [LangGraph Multi-Agent Architecture](https://reference.langchain.com/python/langgraph-supervisor), [Microsoft Agent Framework](https://devblogs.microsoft.com/agent-framework/a-tour-of-handoff-orchestration-pattern/)

**Handoff state schema chuẩn:**
```yaml
handoff_state:
  current_agent: string
  assignments: [AgentAssignment]
  shared_context: SharedState  # cross-agent visibility
  decisions: [Decision]  # trail with node-IDs
  blockers: [Blocker]  # with severity
```

**Nguyên tắc 2 tầng (từ LangGraph pattern):**
- **Supervisor tier (orchestrator):** Routed state, assignment tracking
- **Agent tier (worker):** Shared messages list + role-specific state
- Handoff via Command(goto=..., update=...) — explicit routing

**Lessons từ Swarm pattern:** Direct agent-to-agent handoff tiết kiệm LLM call; supervisor pattern dễ debug. Trade-off: latency vs clarity.

**Áp dụng:** Orchestration skeleton đã capture (bảng agents depth/parent). Mermaid graph + Command-style relay edges chuẩn.

---

### 1.5 Self-Describing Output Pattern

Nguồn: [Agent Handoff Pattern Guide](https://www.mindstudio.ai/blog/what-is-agent-handoff-pattern)

**Concept:** Output không chỉ dữ liệu, mà kèm mini-instructions để downstream agent hiểu cách dùng — "output describes itself".

**Ví dụ:**
```markdown
## Resume từ [file]: [summary]

Context: [điều kiện bối cảnh]
Next steps (ưu tiên):
1. [action] (dependencies: [what's needed])

Blockers: [list]

Entry files to read: [list]

QUAN TRỌNG: [warn/caveat nếu có]

Start: [bước khởi động cụ thể]
```

**Lợi ích:** Resume prompt chỉ cần copy-paste; không cần phiên sau activate full skill — instruction ở trong prompt.

---

## 2. Design Options — 4-6 Hướng Tối Ưu

Mỗi option evaluate qua: mô tả / token saved (est.) / effort / risk / verdict.

### Option A: Template-Embedded-in-Script (RECOMMENDED)

**Mô tả:**
- `gather-context.js` không chỉ emit draft từ skeleton file, mà **chứa sẵn template** (embedded trong script)
- Phiên creation KHÔNG cần đọc `references/handoff-skeleton.md` → tiết kiệm 0.7k token discovery
- Template là mutable hằng số; update template → tất cả phiên sau auto dùng version mới

**Token saved:** ~700 tokens (SKILL.md + skeleton read mỗi lần huỷ; giờ đọc 1 lần setup)

**Effort:** 
- Refactor `gather-context.js`: ~80 dòng template string (JS) thay vì file I/O
- SKILL.md loại bỏ "read references/handoff-skeleton.md" instruction
- **Effort est.:** M (2 hours refactor)

**Risk:**
- Template là immutable runtime artifact → harder to iterate vs file edit
- Version-control template changes trong .js file (vs .md file tracking)
- **Mitigation:** Template = dedicated const `HANDOFF_TEMPLATE`; git blame tracking

**Verdict:** ✅ **STRONG YEA** — token win + convenience. Cost giao diện developer (immutable template) acceptable.

---

### Option B: Tiered Handoff (Mini/Full/Orchestration)

**Mô tả:**
- 3 tiers by session length + complexity:
  - **Mini:** ~200 tok (phiên ≤30 min, 1 file changed, no decisions)
  - **Full:** ~800-1200 tok (standard, 1 domain, 5+ decisions)
  - **Orchestration:** ~1200-1500 tok (wave data, ledger, relay chain)
- Route tự động dựa `--tier` flag hoặc git stats (LOC changed, commit count)

**Token saved:** ~40% overall (phiên ngắn không bị "đệm" full skeleton)

**Effort:** 
- `gather-context.js` thêm heuristic: `loc_changed < 100 && commits < 3` → tier=mini
- 3 skeleton files (mini, full, orch)
- **Effort est.:** L (3-4 hours: heuristic tuning, 3 test runs)

**Risk:**
- Over-thinning mini tiers → phiên sau mất context (false positive)
- Heuristic không bao giờ perfect → user manual override: `--tier full` explicit
- **Mitigation:** Default tier=full nếu uncertain; warn user khi auto-downgrade

**Verdict:** 🟡 **CONDITIONAL** — tốt cho very-short-session use case (fix 1 line), nhưng overhead heuristic > token save cho typical. Keep if user ask; otherwise fold into Option A.

---

### Option C: Minimal Resume Prompt + Self-Describing Artifact

**Mô tả:**
- Resume prompt **chỉ chứa con trỏ:** `file-path + 3 next-steps + blockers + snapshot-date`
- Handoff artifact **tự describe:** "Để resume, đọc section [Y], activate skill [Z] nếu cần, thực hiện bước [B]"
- Phiên resume KHÔNG activate full skill, vì instruction đã ở trong handoff doc

**Token saved:** 
- Resume prompt: -800 tokens (reuse doc, không repeat)
- Skip skill activation: -2.6k tokens (SKILL.md không load)
- **Total est.:** -3.4k tokens per resume phiên
- **Caveat:** Tradeoff = phiên resume mất full skill context (dải workflows, references)

**Effort:**
- Refactor handoff skeleton: thêm "## How to Resume This" section
- `generate-resume-prompt.js`: output only [D#], file-paths, next-steps (not full context)
- Handoff body: explain "skip skill activation if you understand the intent below"
- **Effort est.:** M (2-3 hours; update skeleton + script)

**Risk:**
- Phiên resume không có skill context → nếu user ask "what's the next workflow" skill chưa loaded
- Cần user explicit activate nếu cần full guidance (extra step vs. auto-activation)
- **Mitigation:** Trigger keywords in handoff: "activate /ck:context-handoff" nếu cần full resume guidance

**Verdict:** 🟡 **MAYBE** — **Strong if resume phiên next KHÔNG gọi skill.** Nhưng user behavior: resume → cần guidance → activate skill anyway. Savings = marginal (-3.4k giữa phiên, nhưng +2.6k nếu skill activate). Best case: resume phiên ĐỘC LẬP (không gọi skill) — hiếm.

---

### Option D: SKILL.md Mỏng + Routes (Instructions-in-Output Pattern)

**Mô tả:**
- SKILL.md chỉ ~150 dòng: route table (intents → workflows) + invariants
- Mọi workflow detail → script output tự hướng dẫn: "next: read file X, then run command Y"
- "Instructions live in output, not docs"

**Token saved:**
- SKILL.md discovery: 1.2k → 400 tok (-800)
- Script output kèm guidance → implicit workflow coaching (không cần đọc SKILL.md lại)
- **Total est.:** -800 tokens per session

**Effort:**
- Rewrite SKILL.md: delete all Workflows & Reflection sections, keep route table only
- Enhance all 5 scripts (gather, generate, resume, validate, audit): thêm "next step" hints output
- **Effort est.:** L (4-5 hours: 5 scripts, route table design)

**Risk:**
- SKILL.md hư cơ quá → phiên đầu tiên user loss orientation
- Script output grow (kèm hints) → overall token không save, maybe +100 tok per script call
- Coupling tight giữa script behavior + doc discovery
- **Mitigation:** Keep route table readable; script output format consistent (e.g. `**Next:** ...`)

**Verdict:** 🔴 **NO** — token savings cancel out by script output growth. Risk orientation loss > benefit. Reject unless user explicit ask "make docs minimal".

---

### Option E: Orchestration-Specific State Schema (YAML-based Ledger)

**Mô tả:**
- Thay vì bảng agents + mermaid hybrid (current), unify thành **YAML ledger schema**
- Mỗi handoff section auto-emit dạng:
  ```yaml
  wave_ledger:
    assignments:
      - leader_id: L1
        streams: [S1, S2]
        model: opus-4.8
    handoff_chain:
      - from: orchestrator → to: L1 (request-id: R1)
      - from: L1 → to: W1 (nested-request: NR1)
      - from: W1 → to: W2 (chain-180k: C1)
    decisions:
      - [D1] "spawn 2 leaders parallel" @ 2026-06-12T10:15Z
      - [D2] "W1 capacity-error → requeue" @ 2026-06-12T10:45Z
  ```
- AI agent parse YAML (grep-safe) thay vì read mermaid + tables + prose

**Token saved:** 
- YAML compact vs prose + 3 separate formats: ~15% (-180 tok per wave)
- grep-friendly → agent re-parse faster (implicit, không count context)
- **Total est.:** -180 tok per wave handoff

**Effort:**
- Design YAML schema (decisions node-ID, assignments list, chain edges) — coordination với orchestration team
- Refactor auto-harvest (gather-context from .orch-run) → emit YAML
- Update mermaid render: read YAML → draw (vs. current table → draw)
- **Effort est.:** L (4-5 hours schema design + 2 script refactor)

**Risk:**
- User читеability ↓ (YAML < mermaid visual)
- Needs custom mermaid generator from YAML (not stock)
- Orchestration scaffold complexity → error-prone YAML emit
- **Mitigation:** Keep mermaid for user viz; YAML as AI-readable index only (dual output)

**Verdict:** 🟡 **DEFER** — **Good for phase 2 (v3.1)** when orchestration steady. Phase 1 (v3.0) keep mermaid + tables; user clarity > grep-efficiency now.

---

### Option F: Snapshot-Based Mini Artifact + Full Artifact Pattern

**Mô tả:**
- Tách handoff thành **2 files:**
  1. **Snapshot** (~300 tok): overview + next steps + blockers only
  2. **Full** (~1.2k tok): decision trail + cross-refs + wave details
- Resume default read snapshot; nếu cần context chi tiết → read full
- Orchestration wave: force full (vì cần ledger)

**Token saved:** 
- Resume phiên: chỉ load snapshot (-600 tok vs full)
- Phiên research/debug: load full (accept penalty)
- **Total avg.:** -300 tok per resume session

**Effort:**
- `generate-resume-prompt.js`: output separate `{slug}-snapshot.md` + `{slug}-full.md`
- Resume workflow: load snapshot → read full nếu user ask
- SKILL.md: clarify "always check {full} if you need decision history"
- **Effort est.:** M (2-3 hours: 1 script refactor, 2 template sections)

**Risk:**
- User confusion: why 2 files? (though clear naming helps)
- Orchestration handoff KHÔNG snapshot; always full → special case code
- Stale full file không delete → cleanup audit tăng complexity
- **Mitigation:** Naming: `-snapshot` vs no suffix; auto-delete full > 7 ngày nếu snapshot fresher

**Verdict:** 🟡 **MAYBE** — **Good compromise** (Option B + Option C hybrid). Balanced token win (-300 avg) vs. clarity (2 files clear intent). Cost complexity = small. **Consider as Phase 1 alternative to Option A.**

---

## 3. Khuyến Nghị Kiến Trúc Tổng (v3.0.0)

**Chốt hạn 1 approach:**

```
RECOMMENDED = Option A (Template-Embedded) + Option F (Snapshot Pattern)
```

**Lý do:**

1. **Template-in-script (Option A)** → Giải quyết discovery overhead (-700 tok)
   - Simple refactor: 80 dòng template string
   - Risk thấp: test-friendly (constant setup)
   - User friction: 0 (transparent)

2. **Snapshot + Full (Option F)** → Giải quyết resume-session overhead (-300 tok avg)
   - Resume chỉ read 300-tok snapshot (next steps + blockers + date)
   - Full artifact còn → trace decision history nếu cần
   - User clarity: explicit (2 file types, clear naming)

3. **Keep mermaid + tables** (reject Option E)
   - User readability > grep-efficiency (Opus/Haiku cân bằng)
   - Mermaid visualization valuable for orchestration audit
   - YAML schema = defer to v3.1

**Combined token savings estimate:**
- Discovery (gather handoff): -700 tok (template)
- Resume (read snapshot): -600 tok (avg, -300 per session vs full)
- **Phase 1 per-session impact:** -300 to -600 tok (typical resume phiên)

**Implementation phases:**
- **Phase 1 (v3.0.0):** Embed template + snapshot/full split
- **Phase 2 (v3.1):** YAML ledger for pure-orchestration use case

---

## 4. Anti-Patterns Cần Tránh

| Don't | Do Instead |
|-------|------------|
| Copy full conversation history vào resume prompt | Pointer + summary + entry files only |
| Large nested JSON handoff artifact | Markdown + KV + tables (flat) |
| SKILL.md thay đổi → tất cả phiên cũ invalidate | Snapshot mindset: new handoff from current state |
| Mermaid render từ script thay vì auto-emit | Auto-emit từ `.orch-run` (current: verify) |
| Resume prompt chứa full wave state + code | Con trỏ file + high-level summary; code in artifact |
| Document > 2000 tok = giữ | Đề xuất split domain hoặc archive nếu > 7 ngày |
| Handoff chứa raw credentials/API keys | Validate-handoff.js scan + redact (verify continues) |

---

## 5. Unresolved Questions

1. **Phiên resume nên auto-activate `/context-handoff` skill?**
   - Current: Implicit (not in resume prompt)
   - Option C suggest: Explicit ("activate skill if needed")
   - Recommend: Ask user behavior data — resume phiên next % call skill?

2. **Orchestration wave state — read from artifact or live state.json?**
   - Handoff recommendation: live state (trust real state > stale doc)
   - But gather-context.js đã harvest; reconcile strategy không clear
   - Need: Decision: "snapshot state at handoff time" vs "always re-check state.json"

3. **Mini-handoff (Option B) — threshold nào reasonable?**
   - Heuristic: LOC < 100, commits < 3 → mini
   - But "1 fix" có thể loop 10 commits
   - Need: Empirical data: phiên gốc token vs resume token by session type

4. **Snapshot + Full pattern — auto-delete old full artifact?**
   - Proposal: > 7 ngày + snapshot fresher → delete full
   - Risk: User want trace history via full
   - Recommend: Ask user preference (keep forever vs. auto-cleanup)

---

## 6. Execution Checklist (v3.0.0 Specification)

Phiên sau dùng output này cho Phase 1 implementation:

- [ ] Refactor `gather-context.js`: embed template const `HANDOFF_TEMPLATE` (80 dòng)
- [ ] Create skeleton: `{slug}-snapshot.md` + keep existing full as default
- [ ] Update `generate-resume-prompt.js`: output snapshot path + pointer to full
- [ ] Regenerate `references/handoff-skeleton.md`: mark obsolete (now in script)
- [ ] Test snapshot size: verify < 500 tok typical
- [ ] Test resume workflow: snapshot → full if needed
- [ ] Update SKILL.md route table: clarify snapshot vs. full
- [ ] Verify orchestration waves: still output full (no snapshot split)

---

## Sources

- [Anthropic Platform — Agent Skills Overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Anthropic Engineering — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Agent Skills Best Practices — Anthropic/The New Stack](https://thenewstack.io/agent-skills-anthropics-next-bid-to-define-ai-standards/)
- [Context Compression Strategies for Long-Running Sessions — ZenML LLMOps Database](https://www.zenml.io/llmops-database/evaluating-context-compression-strategies-for-long-running-ai-agent-sessions)
- [Effective Context Engineering for AI Agents — Anthropic Engineering Blog](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Agent Memory & State Management — TechAhead](https://www.techaheadcorp.com/blog/agent-memory-state/)
- [Memory Architectures & Trade-offs — Atlan](https://atlan.com/know/agent-memory-architectures/)
- [Which Table Format Do LLMs Understand Best — Improving Agents](https://www.improvingagents.com/blog/best-input-data-format-for-llms/)
- [TOON Format: Token-Efficient JSON Superset — ArXiv 2604.05865](https://arxiv.org/pdf/2604.05865)
- [Multi-Agent Orchestration — LangGraph Supervisor vs Swarm — DEV Community](https://dev.to/focused_dot_io/multi-agent-orchestration-in-langgraph-supervisor-vs-swarm-tradeoffs-and-architecture-1b7e)
- [Agent Handoff Pattern — MindStudio](https://www.mindstudio.ai/blog/what-is-agent-handoff-pattern)
- [Context Engineering for LLM Agents — Medium/Jin Tan Ruan](https://jtanruan.medium.com/context-engineering-in-llm-based-agents-d670d6b439bc)

---

**Status:** DONE

**Summary:** 6 design options evaluated; **Option A (template-embedded) + Option F (snapshot/full split)** recommended cho v3.0.0, estimated -300-600 tok per session. Implementation spec trong Execution Checklist.

**Concerns/Blockers:** 4 unresolved Qs listed above (user behavior data, state.json strategy, mini threshold, cleanup policy) — recommend gather data from 5-10 next sessions trước finalize v3.1.
