---
title: "Handoff — ĐIỀU TRA sự cố govoff: hệ không orchestrate ở repo ngoài, pane loạn, model đảo three-tier"
date: 2026-06-12
type: report
tags: [handoff, incident, govoff, portability, multi-repo, pane-layout, model-policy, three-tier, investigation]
status: active
---

# Handoff — Sự cố govoff 2026-06-11: điều tra + fix đầu phiên sau

User báo (2026-06-11 23:57, VERBATIM tinh thần): làm 1 task thật RẤT DÀI tại repo `C:\Users\Bee\govoff` — (1) orchestrator KHÔNG điều phối gì; (2) mở pane RẤT LỘN XỘN, spawn worker vào pane lộn xộn; (3) sau khi nhận lệnh, phiên chính TỰ CHUYỂN thành Opus 4.8 nhưng worker lại chạy Fable 5 — NGƯỢC three-tier policy (Orchestrator=Fable 5 mạnh nhất; Leader=Opus 4.8; Worker=GPT 5.5 Codex). **Ưu tiên 1 phiên sau: điều tra root-cause cả 3 → fix để hệ dùng được từ repo NGOÀI.** BASF task vẫn chờ user giao đề (sau điều tra).

| Trường | Giá trị |
|--------|---------|
| Ngày | 2026-06-12 00:05 |
| Branch | main sạch (`5d26ff4`) — sự cố KHÔNG đụng repo này |
| Repo sự cố | `C:\Users\Bee\govoff` (cấu trúc: `.claude/`, `docs/`, `plans/`, `mythic-usda-proof/`) |
| Hệ pane hiện tại | sạch: 1 leaf orchestrator, 0 orphan (đã sweep 23:50) |

## 1. Dữ kiện ĐÃ THU (đêm nay, 2 lệnh đọc nhanh)

| Dữ kiện | Giá trị | Ý nghĩa |
|---------|---------|---------|
| `C:\Users\Bee\govoff\.orch-run` | **KHÔNG TỒN TẠI** | Hệ orchestration KHÔNG được kích hoạt ở govoff — không state.json, không wave, không launcher. Phiên đó improvise spawn/pane ngoài hệ → giải thích triệu chứng (1) và phần lớn (2) |
| Transcript phiên govoff dài | `~/.claude/projects/C--Users-Bee-govoff/f036d9d7-c85d-4577-93a9-c454438b0bd0.jsonl` — **15.1MB**, mtime 2026-06-11 23:41 | NGUỒN ĐIỀU TRA CHÍNH. 3 phiên nhỏ cùng ngày: `856b7530…` (0.3MB, 18:47), `ff5d3b59…` (0.2MB, 18:47), `63e2f702…` (0.4MB, 14:52) |

## 2. Giả thuyết điều tra (H1-H3 — phiên sau verify từng cái bằng transcript + env)

| # | Giả thuyết | Cách verify |
|---|-----------|-------------|
| H1 — KHÔNG PORTABLE | Toàn bộ hệ (scripts/*.js, *.ps1, docs, conventions) nằm TRONG `C:\Users\Bee\recursive-orchestrator`; cd sang govoff thì orchestrator phiên đó không có công cụ, không có CLAUDE.md/docs hướng dẫn hệ → tự bịa cách spawn | Grep transcript govoff: có nhắc `process-nested-requests`/`spawn-by-split`/`launch-agent-ext` không? Có lệnh `wmux agent spawn` thô không? |
| H2 — PANE LOẠN | `WMUX_PANE_ID` rỗng/stale (đã document) + không truyền `--source-pane`/`-RootPane` tường minh + không dùng `pane-spawn.js` (convention con=DỌC, sibling=NGANG nằm trong code repo này) → split rơi fallback first-leaf / vị trí tuỳ tiện | Trace transcript: lệnh split/spawn nào đã chạy, có pane id nguồn không |
| H3 — MODEL ĐẢO | (a) Worker Fable 5: user đã set Fable 5 làm DEFAULT CLI (`/model` 2026-06-10) → mọi `claude` spawn KHÔNG có `--model` tường minh sẽ ăn Fable 5; launcher repo này default `claude-opus-4-8[1m]` cho claude NHƯNG chỉ áp khi spawn QUA `launch-agent-ext.js` — govoff không dùng launcher → worker ăn default = Fable 5. (b) Phiên chính "tự chuyển Opus 4.8": tìm trong transcript event model switch / lệnh `/model` / `claude --model` / fast-mode — Claude KHÔNG tự đổi model được trừ khi có lệnh → xác định ai/cái gì trigger | Grep transcript: `"model"` events, `claude-opus-4-8`, `--model`, `/model`; đối chiếu timeline với lời user "sau khi nhận lệnh" |

## 3. Hướng fix dự kiến (SAU khi root-cause xác nhận — đừng fix mò)

- **Portability (H1):** thiết kế "multi-repo mode" — hệ chạy được từ repo bất kỳ: orchestrator ở repo nào cũng gọi scripts bằng ĐƯỜNG DẪN TUYỆT ĐỐI `C:\Users\Bee\recursive-orchestrator\scripts\...`; state/forensics đặt tại WORK repo (`<work-repo>\.orch-run\`); cân nhắc: global skill/command (`~/.claude/skills/` hoặc CLAUDE.md global mục orchestration) để phiên ở repo ngoài BIẾT hệ tồn tại + cách dùng. Scripts cần audit chỗ nào assume CWD = repo này (`__dirname` vs `process.cwd()` — launcher/process-nested dùng gì cho promptFile/resultFile path).
- **Layout (H2):** bắt buộc `-RootPane` tường minh trong mọi hướng dẫn multi-repo; spawn LUÔN qua `pane-spawn.js`/`process-nested-requests.js`.
- **Model policy (H3):** enforce trong launcher — nhánh claude: nếu thiếu `--model` → LUÔN gắn `claude-opus-4-8[1m]` (leader default, đã có); thêm guard/docs: orchestrator KHÔNG đổi model phiên chính; cân nhắc ghi model policy vào CLAUDE.md global để mọi phiên (repo nào) đều nắm three-tier.

## 4. Vấn Đề / Câu Hỏi Mở

| Vấn đề | Ảnh hưởng | Ghi chú |
|--------|-----------|---------|
| 3 triệu chứng govoff CHƯA root-cause | hệ không dùng được ngoài repo nhà | điều tra ĐẦU phiên sau (ưu tiên 1) |
| "Tự chuyển Opus 4.8" chưa rõ cơ chế | nếu là hành vi tự phát của phiên → nguy hiểm hơn config | transcript 15.1MB là bằng chứng duy nhất |
| BASF task thật | criterion cuối Phase 7 plan nền `260609-1722` | VẪN CHỜ USER GIAO ĐỀ — làm sau điều tra |

## 5. File Tham Chiếu (đọc THEO THỨ TỰ)

| # | File | Vai trò |
|---|------|---------|
| 1 | `~/.claude/projects/C--Users-Bee-govoff/f036d9d7-c85d-4577-93a9-c454438b0bd0.jsonl` | **BẰNG CHỨNG CHÍNH** — transcript phiên sự cố 15.1MB. LƯU Ý: ĐỪNG đọc tuần tự cả file (15MB!) — grep theo keyword (spawn/wmux/model/--model/opus/fable) + đọc lát quanh match; hoặc giao 1 researcher agent điều tra với chỉ dẫn grep |
| 2 | `C:\Users\Bee\govoff\.claude\` + `plans/` | xem phiên đó để lại settings/plan gì |
| 3 | `docs/orchestration-system.md` (repo này) | baseline hành vi ĐÚNG của hệ |
| 4 | `scripts/launch-agent-ext.js` + `scripts/pane-spawn.js` | audit assume-CWD + model default cho fix H1/H3 |
| 5 | `plans/reports/handoff-260611-0141-pane-ux-advanced-shipped-basf-await.md` | handoff trước — trạng thái hệ + BASF chờ |

## 6. Liên Kết Chéo

| Doc/Plan | Quan hệ |
|----------|---------|
| [[handoff-260611-0141-pane-ux-advanced-shipped-basf-await]] | trạng thái hệ sạch + công cụ mới + BASF chờ — vẫn hiệu lực |
| [[three-tier-model-policy]] | policy bị vi phạm ở govoff — memory vận hành |
| [[pane-split-layout-convention]] | convention bị vi phạm ở govoff |
| [[govoff-orchestration-incident-not-portable]] | memory mới ghi sự cố |

## 7. Bước Tiếp Theo

| Ưu tiên | Hành động | Phụ thuộc |
|---------|-----------|-----------|
| 0 | Đầu phiên: kiểm hash app.asar = `CED7F271…`; `wmux tree` lấy pane orchestrator mới | — |
| 1 | **ĐIỀU TRA sự cố govoff**: verify H1/H2/H3 từ transcript `f036d9d7…jsonl` (grep, KHÔNG đọc cả 15MB — giao researcher agent nếu cần) + govoff/.claude + plans → báo root-cause 3 triệu chứng cho user | — |
| 2 | **FIX theo root-cause** (chốt với user trước khi sửa): multi-repo mode (scripts đường dẫn tuyệt đối + state tại work-repo + global guidance) + enforce model policy trong launcher + bắt buộc RootPane | root-cause xác nhận |
| 3 | BASF task thật — spawn qua wave (watch + close-with-log + sweep như quy trình mới) | user giao đề |
