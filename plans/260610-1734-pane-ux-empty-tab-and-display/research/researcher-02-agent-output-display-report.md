---
title: "Điều tra UX — Display human-friendly cho hoạt động agent (codex worker pane)"
date: 2026-06-10
type: research
tags: [codex, jsonl, launcher, pane, display, ux, ansi, markdown]
status: active
plan: 260610-1734-pane-ux-empty-tab-and-display
---

# Câu hỏi 2 — Display vừa máy-đọc-tốt vừa người-đọc-tốt cho worker codex

**Bối cảnh:** Worker codex chạy `codex exec --json` → JSONL events echo ra pane. Máy đọc tốt, **người đọc rất khó** (dòng JSONL 1600–2800 ký tự). Leader claude chạy TUI interactive nên human đã đọc tốt; vấn đề **chỉ ở CODEX worker pane**.

**Ràng buộc bất biến (đã xác minh):** `scripts/launch-agent-ext.js` `runCodex` (dòng 91-143) tee stdout → `out.jsonl` (forensics) + echo pane. Máy đọc **`out.jsonl` + result `-o` + `state.json`**, **KHÔNG đọc stdout pane**. ⇒ Lớp display pane đổi được mà không chạm protocol máy, **miễn giữ:** tee `out.jsonl` nguyên vẹn, propagate exit code, không chặn flush, stdin `ignore` (không treo codex).

**Phương pháp:** chạy `codex exec --help`; phân tích schema `out.jsonl` thật; viết script render thử nghiệm `.orch-run/uxplan/render-test.js` chạy trên `out.jsonl` CÓ SẴN để đo độ đọc được (KHÔNG sửa `launch-agent-ext.js`).

---

## 1. Findings (bằng chứng)

### F1 — codex KHÔNG có cờ "vừa máy vừa người"; `--json` là all-or-nothing
`codex exec --help` (trích):
```
--json                  Print events to stdout as JSONL
--color <COLOR>         [default: auto] [possible values: always, never, auto]
-o, --output-last-message <FILE>   ghi message cuối (độc lập --json)
--output-schema <FILE>             ép message cuối theo schema
```
- `--json` → JSONL thuần (máy). KHÔNG có cờ output human-có-cấu-trúc song song.
- `--color` chỉ tô màu renderer mặc định (chế độ KHÔNG `--json`); vô nghĩa khi đã `--json` (JSONL không ANSI).
- Bỏ `--json` → codex in text đẹp cho người, **nhưng** `out.jsonl` mất JSONL → **hỏng fallback** `chain-router` đọc `out.jsonl` khi thiếu result (commit `b4b82b9`). ⇒ **Không thể bỏ `--json`.**
- `-o` (`launch-agent-ext.js:111`) và `--output-schema` (`:113-115`) độc lập `--json` → result giữ nguyên dù đổi display.

→ **Không có lời giải sẵn từ cờ codex.** Phải xử lý ở lớp launcher hoặc viewer ngoài.

### F2 — Schema `out.jsonl` (codex `--json`) rất dễ render
Phân tích `.orch-run/chfix/agent-orch-root-c1-out.jsonl` (66 dòng):
```
event_types: thread.started ×1, turn.started ×1, item.started ×25, item.completed ×38, turn.completed ×1
item types:  command_execution ×44 (command, aggregated_output, exit_code, status)
             agent_message     ×13 (text — ở chế độ --output-schema là JSON result {status,filesChanged,decisions,remaining})
             file_change       ×6  (changes:[{path,kind}], status)
```
→ Stream có cấu trúc rõ → map 1 event → 1 dòng gọn dễ dàng.

### F3 — [QUYẾT ĐỊNH] Render compact ANSI giảm 97–98% ký tự, glanceable
`.orch-run/uxplan/render-test.js` (script thử nghiệm, KHÔNG phải script hệ thống) parse JSONL → dòng ANSI gọn. Chạy thật:
```
chfix:  raw 66 dòng, avg 1671 ký tự/dòng  →  rendered 65 dòng, avg 56 ký tự/dòng  →  GIẢM 97%
agfix:  raw 63 dòng, avg 2788 ký tự/dòng  →  rendered 50 dòng, avg 53 ký tự/dòng  →  GIẢM 98%
```
Trích output rendered (đọc lướt thấy ngay agent đang làm gì):
```
── codex session 019eb075-… ──
$ ... powershell ... -Command 'Get-Content -Raw README.md'
  ✓ · # recursive-orchestrator
  ✗ exit 1 · Get-Content : Cannot find path
✎ update chain-router.js ✓
▣ result status=partial files=2 decisions=1
$ ... 'node scripts/spike/t…'
  ✓ · leader-aggregate phase5c tests PASS
✎ add agent-orch-root-c1-result.md ✓
── turn done · in 930955 · out 6855 ──
```
→ Raw JSONL (1600–2800 ký tự/dòng, có dòng dump nguyên file) **gần như vô dụng trong pane**; rendered **đọc lướt nắm được toàn bộ tiến trình**. **Bằng chứng định lượng cho thấy render compact đáng giá rõ rệt.**

### F4 — Lớp echo pane tách biệt hoàn toàn khỏi forensics
`launch-agent-ext.js:134-137`:
```js
child.stdout.on('data', (chunk) => {
  out.write(chunk);            // → out.jsonl (forensics, MÁY đọc)
  process.stdout.write(chunk); // → pane (echo thô, HUMAN đọc) ← chỉ dòng này là display
});
```
→ Chỉ `process.stdout.write(chunk)` là lớp display. Đổi nó **không đụng** `out.write(chunk)` (forensics), `-o` result, `finish()`/exit-code (`:128-142`), stdin `ignore` (`:124`). **Blast radius của bug render = chỉ hình ảnh pane; xấu nhất = pane xấu = hiện trạng.** Máy an toàn tuyệt đối.

### F5 — wmux có sẵn nhiều kênh display ngoài (CLI xác nhận)
- **Surface markdown:** `markdown set <surfaceId> --content|--file` (`cli/wmux.js:412-422`, IPC `markdown.set_content`/`markdown.load_file`) → render markdown trong 1 surface.
- **Sidebar:** `set-status`/`set-progress`/`log <level> <msg>` (`:444-457`) → đẩy dòng progress vào sidebar (panel toàn cục).
- **Browser panel:** `browser open <url>` (`:312-316`) → mở HTML trong panel phải.
- **Surface phụ:** `new-surface [--type T]` (`:117-121`) + `close-surface` (`:123-124`).
- **agent-activity:** `agent-activity --surface --tool --skill --done` (`:477-495`) → cập nhật indicator "nhãn xanh" của surface agent.

---

## 2. Các phương án + trade-off + rủi ro

### (b) Render trong launcher — parse JSONL → dòng ANSI gọn ⭐
Sửa `runCodex` `child.stdout.on('data')`: vẫn `out.write(chunk)` (thô, máy nguyên vẹn), nhưng thay `process.stdout.write(chunk)` bằng **line-buffer → parse từng event → in dòng render** (như `render-test.js`).
- **Lợi:** giảm 97–98% nhiễu pane (F3); zero process/surface mới; protocol máy bất biến (F4); ANSI màu sẵn trong terminal.
- **Rủi ro / độ phức tạp (TRUNG BÌNH, ~40 dòng):**
  1. **Line-buffer qua ranh giới chunk:** 1 dòng JSON có thể bị cắt giữa 2 'data' event → phải buffer, split `\n`, parse dòng đủ, giữ phần dư. (Bug chính cần đúng.)
  2. **Dòng không-JSON:** try/catch parse, fallback in thô.
  3. **Giữ flush/exit:** không đổi `finish()`/`out.end()` (`:128-142`); chỉ đổi nhánh echo. stdin vẫn `ignore`.
  - Vì là **code path LIVE** → báo cáo này CHỈ đề xuất thiết kế, CHƯA sửa.
- **Tăng cường đề xuất:** với `agent_message` schema, hiện `▣ result decisions=N` — nên surface text `decisions[]`/`remaining[]` gần nhất (`▣ result status=partial · "Dùng ck:fix vì…"`) để lộ lý do agent. Strip prefix `powershell.exe -Command` để hiện lệnh thật.

### (c) Viewer ngoài zero-touch (không đụng launcher)
- **(c1) Surface phụ tail `out.jsonl`:** `new-surface` + node script tail-render. → **thêm 1 tab** (nghịch lý với Q1), cần quản vòng đời surface. Ma sát cao.
- **(c2) Surface markdown (F5):** poller render `out.jsonl` → file `.md`, đẩy `markdown set --file`. Đẹp, đúng "markdown" user hỏi. NHƯNG: **thêm 1 surface/tab** + **cần poller** regenerate+push; markdown là snapshot (không stream thật trừ khi poll dày). Ma sát trung-cao.
- **(c3) Browser panel HTML (F5):** render `out.jsonl` → HTML auto-refresh, `browser open file://…`. Panel phải **đã hiển thị sẵn**. NHƯNG: **browser panel DUY NHẤT, dùng chung** → không thể hiện N worker song song (vô hiệu cho hệ đa-worker); file:// fetch sibling có thể bị Electron chặn. Ma sát cao + giới hạn kiến trúc chí mạng.
- **(c4) Sidebar log (F5):** launcher/tail đẩy dòng gọn vào sidebar. Không thêm surface. NHƯNG sidebar **toàn cục dùng chung** + format hạn chế (log lines) → bổ trợ chứ không thay được view per-pane.

### (d) Markdown trong terminal có đáng không?
- Terminal **không render markdown native** → cần renderer ngoài (glow/mdcat) = thêm dependency + process.
- Ở chế độ `--output-schema` headless, `agent_message` là **JSON schema, không phải văn xuôi dài** (F2) → ít thứ để markdown render; prose nằm trong `decisions[]` (dòng ngắn).
- → **ANSI compact lines đạt ~90% lợi ích đọc với ~10% chi phí.** Markdown chỉ thêm giá trị ở surface markdown (c2) — vốn đã nặng. **Markdown-trong-terminal KHÔNG đáng cho ca này.**

---

## 3. (e) Bảng so sánh chi phí/ma sát — MÁY vs HUMAN

| Phương án | Lợi HUMAN | Rủi ro MÁY | Ma sát hệ thống | Đụng code live | Đa-worker OK? |
|---|---|---|---|---|---|
| **(b) Render trong launcher** | **Cao** (giảm 97–98%, màu, glanceable) | **Zero** (forensics/result/exit bất biến; bug chỉ ảnh hưởng hình ảnh) | **Thấp** (0 process/surface mới) | Có (~40 dòng, blast radius thẩm mỹ) | **Có** (mỗi pane tự render) |
| (c1) Surface tail | Cao | Zero | Cao (+1 tab + quản vòng đời) | Không | Có |
| (c2) Surface markdown | Cao (đẹp nhất) | Zero | Cao (+1 tab + poller) | Không | Có |
| (c3) Browser HTML | Cao (1 worker) | Zero | Cao (poller+HTML) | Không | **KHÔNG** (1 browser dùng chung) |
| (c4) Sidebar log | Trung (bổ trợ) | Zero | Trung (poller/đẩy) | Tuỳ | Một phần (sidebar chung) |
| Giữ nguyên `--json` thô | **Rất thấp** | Zero | Zero | Không | — |
| Bỏ `--json` (text đẹp) | Cao | **HỎNG** (mất out.jsonl → vỡ fallback chain) | — | — | — |

---

## 4. Khuyến nghị xếp hạng

**#1 — (b) Render compact ANSI trong launcher.** *Khuyến nghị mạnh nếu user muốn cải thiện.*
Lý do: lợi ích human cao nhất (F3: 97–98%), rủi ro máy **zero** (F4: blast radius thẩm mỹ — xấu nhất quay về hiện trạng), ma sát thấp nhất (0 process/surface mới), hoạt động tự nhiên cho đa-worker. Là phương án DUY NHẤT vừa "đẹp cho người" vừa "an toàn cho máy" mà không thêm hạ tầng. Đã có nguyên mẫu chứng minh (`render-test.js`).

**#2 — KHÔNG CẢI TIẾN (giữ `--json` thô).** *Kết luận hợp lệ — không phải thất bại.*
Nếu user chấp nhận pane khó đọc (vì máy mới là khách hàng chính, human chỉ liếc), thì giữ nguyên là lựa chọn YAGNI hợp lệ — user đã nói rõ điều này. NHƯNG bằng chứng F3 cho thấy chi phí cải tiến (b) thấp và lợi ích cao, nên **#1 vượt #2** trừ khi user ưu tiên đóng băng code path launcher.

**#3 — (c2) Surface markdown / (c4) Sidebar — BỔ TRỢ, không thay thế.**
Cân nhắc về sau nếu muốn view "đẹp" tách biệt. Nhưng thêm surface/tab (xung đột tinh thần Q1) + cần poller → **không khuyến nghị làm trước (b).**

**Loại bỏ:** (c3) Browser HTML (1 browser dùng chung, vô hiệu đa-worker); bỏ `--json` (vỡ protocol máy).

→ **Kết luận trung thực:** Đây KHÔNG phải ca "mọi phương án đều tăng ma sát". Phương án (b) có ma sát thấp + rủi ro máy zero + lợi ích đo được cao → **đáng cải tiến**. Quyết định cuối thuộc user: làm (b) hay đóng băng launcher (#2).

---

## 5. Câu hỏi mở
1. User có chấp nhận sửa code path live `launch-agent-ext.js` không? (b) an toàn nhưng vẫn là sửa launcher đang chạy production.
2. Mức render mong muốn: tối giản (`$ cmd` / `✓✗` / `✎ file`) hay giàu (kèm `decisions[]`/`remaining[]` + tail output)? Ảnh hưởng ~20 dòng code.
3. Có cần GIỮ song song bản echo thô đâu đó (vd cờ env `WORKER_RAW_ECHO=1`) để debug khi render lỗi? (đề xuất: có, rẻ, an toàn.)
4. `render-test.js` để lại trong `.orch-run/uxplan/` làm tham chiếu thiết kế — có cần xoá sau khi user quyết không?
