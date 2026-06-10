---
title: "Điều tra UX — Tab 'Windows PowerShell' trống trong pane worker"
date: 2026-06-10
type: research
tags: [wmux, pane, surface, lifecycle, orchestration, ux]
status: active
plan: 260610-1734-pane-ux-empty-tab-and-display
---

# Câu hỏi 1 — Tab 'Windows PowerShell' trống có cần thiết không?

**Bối cảnh:** Khi hệ spawn worker, pane mới luôn có tab đầu "Windows PowerShell" không làm gì, tab thứ 2 mới là agent (nhãn xanh). Báo cáo này trả lời: (a) tab trống có tác dụng thực tế gì; (b) có cách nào bỏ; (c) rủi ro từng cách.

**Phương pháp:** Ưu tiên **thực nghiệm LIVE** trên wmux thật (bằng chứng hành vi = authoritative nhất) + đọc CLI `cli/wmux.js` + đọc `scripts/pane-spawn.js`. Đã **KHÔNG** extract `app.asar` đọc renderer minified vì thực nghiệm live + phát hiện cmdline shell `-NoExit` (xem F3) đã lộ trọn cơ chế — bằng chứng hành vi thắng việc khảo cổ bundle minified. CLI gọi qua `node "$WMUX_CLI"` (wmux không trên PATH).

---

## 1. Findings (bằng chứng)

### F1 — `split` tạo đúng 1 surface terminal mặc định (= tab trống), và TRẢ VỀ luôn surfaceId của nó
`scripts/pane-spawn.js:55-64` `allocateSplit` gọi `wmux split [--down] [--pane <id>]`. CLI `cli/wmux.js:194-201`:
```js
case 'split': {
  const direction = args.includes('--down') ? 'down' : 'right';
  const type = getFlag(args, '--type') || 'terminal';   // luôn có type, mặc định 'terminal'
  ...
  console.log(JSON.stringify(await sendV2('pane.split', { direction, type, ... })));
}
```
Lệnh đã chạy + output:
```
$ node "$WMUX_CLI" split --pane pane-9d022078-...
{ "paneId": "pane-f015fdff-...", "surfaceId": "surf-6199f91c-..." }
```
`tree` ngay sau split: pane mới có `surfaces=terminal(powershell.exe)` — đúng 1 surface terminal chạy `powershell.exe`.

→ **Split LUÔN tạo 1 surface terminal mặc định = tab trống.** Response trả về **cả `surfaceId`** của tab trống. NHƯNG `allocateSplit` (`pane-spawn.js:62`) chỉ đọc `parsed.paneId`, **vứt bỏ `surfaceId`** — dữ liệu cần để đóng tab trống đã có sẵn mà không dùng.

### F2 — `agent spawn` LUÔN tạo surface MỚI thứ 2 (không tái dùng tab trống)
`pane-spawn.js:70-81` `spawnIntoPane` gọi `wmux agent spawn --pane <id> --cmd ... --label ...`. CLI `cli/wmux.js:361-381` — params chỉ nhận `--cmd/--label/--cwd/--pane/--workspace`, **không có** `--surface` để nhắm surface có sẵn. Lệnh đã chạy:
```
$ node "$WMUX_CLI" agent spawn --pane pane-f015fdff-... --cmd 'powershell ...' --label uxplan-test-agent
{ "agentId": "agent-7535f913-...", "surfaceId": "surf-f72d85e7-..." }   # surfaceId MỚI, khác surf-6199f91c
$ node "$WMUX_CLI" list-surfaces --pane pane-f015fdff-...
   surf-6199f91c-... terminal active=false   # tab trống
   surf-f72d85e7-... terminal active=true    # surface agent
```
→ **Agent spawn tạo surface thứ 2; tab trống (#1) vẫn còn.** Đây chính là cơ chế sinh ra hiện tượng 2 tab. Không có đường CLI để spawn agent vào surface có sẵn.

### F3 — [QUYẾT ĐỊNH] Mọi surface là shell `-NoExit` bền → surface agent TỰ giữ pane sống
Kiểm cmdline tiến trình powershell của surface agent (pid 9336):
```
$ powershell -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=9336').CommandLine"
powershell.exe -NoLogo -ExecutionPolicy Bypass -NoExit -Command ". $env:WMUX_PS1_SCRIPT"
```
→ wmux **KHÔNG** chạy `--cmd` trực tiếp. Nó mở một **shell powershell `-NoExit` bền** (source script tích hợp wmux), rồi *feed* `--cmd` vào shell đó. Khi `--cmd` chạy xong, shell về prompt và **sống tiếp nhờ `-NoExit`**.

Bằng chứng hành vi củng cố (test T3 — agent one-shot thoát tức thì `Write-Host ONESHOT_HI`):
```
t=0s  surfaces_in_T3=2 agentSurfacePresent=true T3inTree=true
t=3s  ... t=6s ... t=9s ... t=12s surfaces_in_T3=2 agentSurfacePresent=true T3inTree=true
```
Surface agent **tồn tại nguyên** 12s sau khi cmd logic đã xong. → **Surface không bao giờ tự đóng khi cmd hoàn tất.**

**Hệ quả then chốt:** Khi codex worker thật chạy xong (codex thoát, wrapper `.ps1` xong), điều khiển về prompt của shell `-NoExit` của surface agent → **surface agent ở lại, một mình giữ pane sống.** ⇒ **Tab trống KHÔNG cần để giữ pane sống.**

### F4 — Đóng surface trống → pane sống khoẻ với chỉ surface agent
```
$ node "$WMUX_CLI" close-surface surf-6199f91c-...   # đóng TAB TRỐNG
{ "ok": true }
$ node "$WMUX_CLI" list-surfaces --pane pane-f015fdff-...
count=1
   surf-f72d85e7-... terminal active=true   # chỉ còn surface agent
$ node "$WMUX_CLI" tree → T1_IN_TREE=true     # pane vẫn sống
```
CLI: `close-surface` tại `cli/wmux.js:123-124` (`sendV2('surface.close', {id})`); `list-surfaces` tại `cli/wmux.js:129-130`.
→ **Đóng tab trống sạch sẽ; pane sống với 1 surface agent. Phương án "đóng tab trống sau agent spawn" KHẢ THI.**

### F5 — Pane cần ≥1 surface: đóng surface CUỐI → pane TỰ ĐÓNG
```
$ node "$WMUX_CLI" close-surface surf-f72d85e7-...   # đóng surface cuối còn lại
{ "ok": true }
$ node "$WMUX_CLI" tree → T1_IN_TREE=false  remaining_panes=<orchestrator>,<me>
$ node "$WMUX_CLI" list-surfaces --pane pane-f015fdff-... → count_in_T1=0
```
→ **Pane 0-surface không tồn tại; wmux tự xoá pane khi surface cuối đóng.** Đây là ràng buộc rủi ro then chốt cho mọi phương án bỏ tab trống (phải bỏ tab trống SAU khi đã có surface agent).

### F6 — [Phát hiện phụ] `close-surface` VÀ `close-pane` đều ORPHAN process powershell
- Sau `close-surface` surface agent + pane T1 auto-close: `tasklist /FI "PID eq 9336"` → **vẫn sống** (115 MB).
- Sau `close-pane T3`: pid agent oneshot 15860 → **vẫn sống**.
- Census: 10 powershell `-NoExit` đang chạy đồng thời (tích luỹ qua các lần spawn/đóng).
→ **wmux gỡ surface/pane khỏi UI nhưng KHÔNG giết tiến trình shell nền** → rò rỉ tài nguyên hệ thống (pre-existing, không do tab trống gây ra; `cleanup-panes.ps1` là công cụ reap khẩn cấp đã có theo memory). Liên quan Q1: tab trống cũng là 1 shell `-NoExit`, khi harvest `close-pane` nó cũng bị orphan → **tab trống GÓP THÊM 1 orphan/worker.**

### F7 — Đối chứng đời thực: agent đã exit thì pane biến mất
`agent list` cho thấy agent `agfix-...` `status: exited` (exitCode -1073741510, crash) nhưng pane `pane-b587d150` của nó **không còn trong tree**. → Pane worker được reap (qua harvest `close-pane` / cleanup); record agent vẫn lưu trong `agent list` dạng exited.

---

## 2. Trả lời câu hỏi

### (a) Tab trống có tác dụng thực tế gì trong lifecycle hiện tại?
| Giả thuyết tác dụng | Kết luận | Bằng chứng |
|---|---|---|
| Giữ pane sống khi surface agent exit | **Phần lớn THỪA** — surface agent là shell `-NoExit`, tự ở lại giữ pane sống sau khi agent xong | F3, F4 |
| Cho user thao tác tay khẩn cấp | **Giá trị biên** — là 1 prompt powershell rảnh trong pane worker user có thể click vào; nhưng cwd của nó là cwd mặc định lúc split (thường KHÔNG phải cwd worker) | F1 + suy luận |
| Ảnh hưởng harvest `-HarvestKill` close-pane | **KHÔNG** — `close-pane` xoá cả pane bất kể số surface; tab trống không cản. Chỉ thêm 1 orphan shell lúc reap | F5, F6 |

→ **Tab trống về cơ bản là "giàn giáo" phát sinh ngẫu nhiên** từ cách `split` (luôn tạo 1 surface) ghép với `agent spawn` (tạo surface thứ 2), **không có chức năng load-bearing** trong lifecycle hiện tại.

### (b) Có cách nào bỏ tab trống?
| Cách | Khả thi? | Cơ chế |
|---|---|---|
| Tạo pane KHÔNG kèm surface mặc định | **Không (qua CLI)** | `split` luôn truyền `type='terminal'`; không có `--type none`. Cần sửa renderer handler `pane.split` |
| Spawn agent vào surface có sẵn thay vì tạo mới | **Không (qua CLI)** | `agent spawn` không có `--surface`; luôn tạo surface mới (F2). Cần sửa renderer |
| **Đóng surface trống NGAY SAU agent spawn** | **CÓ — thuần CLI** | `allocateSplit` đã nhận `surfaceId` tab trống trong response split (F1); sau `spawnIntoPane`, gọi `close-surface <emptySurfaceId>` (F4) |

### (c) Rủi ro từng cách
- **Ràng buộc thứ tự (F5):** pane cần ≥1 surface → phải đóng tab trống **SAU** khi surface agent đã tồn tại. Nếu đảo thứ tự (đóng khi pane chỉ có tab trống) → pane auto-close, hỏng spawn.
- **Ảnh hưởng result-based harvest:** **KHÔNG.** Harvest đọc result/`out.jsonl` từ **đĩa**, độc lập với pane. Pane auto-close (nếu xảy ra) không mất dữ liệu; `-HarvestKill close-pane` gặp pane đã biến mất → vô hại (idempotent).
- **Đụng patch `split --pane` (app.asar CED7F271):** chỉ 2 cách sửa renderer (tạo-pane-không-surface / spawn-vào-surface-có-sẵn) **đụng vùng patch** → mất khi update wmux (xem `.orch-run/wpatch2/` — patch từng mất 1 lần). Cách **đóng-surface-sau-spawn KHÔNG đụng** app.asar (thuần orchestration trong `pane-spawn.js`). ✅
- **Orphan (F6):** đóng tab trống sớm sẽ orphan shell idle của nó ngay thay vì lúc harvest; **tổng orphan/worker không đổi** (cả 2 shell đều bị orphan sớm hay muộn). Biên.

---

## 3. Khuyến nghị xếp hạng

**#1 — KHÔNG LÀM GÌ (chấp nhận tab trống).** *Khuyến nghị mặc định.*
Tab trống vô hại (F3: không load-bearing; không cản harvest). Chi phí "sửa" (thêm 1 lời gọi `close-surface`/worker + logic truyền `surfaceId` + mất prompt khẩn cấp biên) có thể vượt lợi ích (thuần thẩm mỹ: bớt 1 tab). Theo YAGNI/KISS. **Đây là kết luận hợp lệ nếu user chỉ thấy hơi rối mắt chứ không vướng vận hành.**

**#2 — Đóng surface trống sau `agent spawn`** *(nếu user muốn bỏ hẳn vì lý do UX).*
Sạch nhất, **zero rủi ro patch**, thuần CLI. Thiết kế đề xuất (CHƯA sửa — chỉ đề xuất):
- `allocateSplit` (`pane-spawn.js:55-64`): trả về cả `{ paneId, defaultSurfaceId }` (đọc thêm `parsed.surfaceId` đang bị vứt ở dòng 62).
- Sau `spawnIntoPane` thành công, gọi `wmux close-surface <defaultSurfaceId>` (chỉ khi agent surface đã tạo OK — giữ ràng buộc F5).
- Bọc try/catch: nếu close-surface lỗi, bỏ qua (tab trống còn lại = trạng thái hiện tại, không hồi quy).
- **Blast radius:** chỉ thẩm mỹ pane; không đụng `out.jsonl`/result/exit-code/harvest.
- *Lưu ý phụ:* nên cân nhắc reap orphan shell (F6) ở cùng chỗ — nhưng đó là vấn đề riêng, không nên gộp.

**#3 — Sửa renderer (tạo pane không surface mặc định).** *Không khuyến nghị.*
"Đúng" nhất về bản chất nhưng đụng vùng patch `__wmux_splitPane` (CED7F271) → **mất mỗi lần update wmux**, phải vá lại (tiền lệ `.orch-run/wpatch2/`). Chi phí bảo trì >> lợi ích.

---

## 4. Câu hỏi mở
1. **Orphan leak (F6):** `close-surface`/`close-pane` để lại shell `-NoExit` mồ côi — cần `cleanup-panes.ps1` reap? Đây là vấn đề hệ thống độc lập, đáng điều tra riêng (ngoài phạm vi 2 câu UX). Cần user quyết có ưu tiên không.
2. **Prompt khẩn cấp:** Tab trống có thực sự từng được user dùng để thao tác tay không? Nếu CÓ giá trị vận hành → giữ (ủng hộ #1). Cần user xác nhận thói quen dùng.
3. Chưa đọc renderer minified để xác nhận `pane.split` có cờ tạo-không-surface ẩn nào không (đánh giá: gần như chắc không, vì CLI luôn ép `type`); chỉ cần khi user chọn #3.
