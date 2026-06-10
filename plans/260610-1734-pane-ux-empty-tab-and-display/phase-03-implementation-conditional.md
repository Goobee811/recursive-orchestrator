---
phase: 3
title: "Implementation (conditional)"
status: pending
effort: ""
---

# Phase 3: Implementation (conditional)

## Overview

Các work item CÓ ĐIỀU KIỆN — chỉ kích hoạt theo quyết định user ở Phase 2. Mọi WI phân cho worker codex qua wave orchestration (orchestrator không tự code). Thiết kế chi tiết đã có sẵn trong research reports.

**✅ User đã chốt 2026-06-10: CẢ 3 WI ĐỀU ACTIVE.** WI-2 mức render = GIÀU. Phân wave gợi ý: WI-1 + WI-2 song song (2 worker, zone tách biệt `pane-spawn.js` vs `launch-agent-ext.js`); WI-3 cần điều tra trước nên có thể Leader-led hoặc worker riêng (zone `cleanup-panes.ps1` + có thể script mới — tách wave nếu đụng file chung).

## WI-1 — Bỏ tab trống bằng close-surface (✅ ACTIVE — user chốt bỏ)

**Related Code Files:** Modify `scripts/pane-spawn.js` + `scripts/spike/test-split-pipeline.js`

**Thiết kế (từ report 01 §3#2):**
1. `allocateSplit` (pane-spawn.js:55-64): đọc thêm `parsed.surfaceId` (đang bị vứt) → trả `{ paneId, defaultSurfaceId }`
2. Caller (`spawnIntoPane` thành công xong): gọi `wmux close-surface <defaultSurfaceId>` — CHỈ SAU khi agent surface đã tồn tại (ràng buộc Q1-F5: pane cần ≥1 surface)
3. Try/catch: close-surface lỗi → bỏ qua (còn tab trống = hiện trạng, không hồi quy)
4. Cập nhật test-split-pipeline.js khớp signature mới + case: close-surface được gọi sau spawn, không gọi khi spawn fail

**Rủi ro:** thấp — blast radius thẩm mỹ; không đụng app.asar/patch; harvest đọc từ đĩa không ảnh hưởng.

## WI-2 — Render compact ANSI trong launcher (✅ ACTIVE — mức GIÀU)

**Related Code Files:** Modify `scripts/launch-agent-ext.js` (chỉ nhánh echo trong `runCodex`)

**Thiết kế (từ report 02 §2b + prototype `.orch-run/uxplan/render-test.js`):**
1. Giữ NGUYÊN: `out.write(chunk)` (forensics out.jsonl), `-o` result, `finish()`/exit-code, stdin `ignore`
2. Thay `process.stdout.write(chunk)` bằng: line-buffer (buffer + split `\n`, giữ phần dư qua chunk boundary) → JSON.parse từng dòng đủ (try/catch, non-JSON in thô) → in 1 dòng ANSI gọn: `$ cmd` / `✓ ✗ exit` / `✎ file ✓` / `▣ result`
3. Cờ `WORKER_RAW_ECHO=1` → echo thô như cũ (thoát hiểm debug, rẻ)
4. Mức render theo user chọn: tối giản HOẶC giàu (kèm `decisions[]`/`remaining[]` + strip prefix `powershell.exe -Command`)
5. Verify: chạy launcher với out.jsonl thật (chfix/agfix) + 1 worker codex live nhỏ; full suite 190 test không hồi quy

**Rủi ro:** trung bình-thấp — code path live nhưng bug chỉ ảnh hưởng hình ảnh pane (xấu nhất = quay về hiện trạng); bug chính cần đúng là line-buffer qua chunk boundary.

## WI-3 — Điều tra orphan-shell leak (✅ ACTIVE — user chọn fix ngay)

**Scope:** ngoài 2 câu UX — điều tra riêng. `close-surface`/`close-pane` không giết shell `powershell -NoExit` nền → tích lũy orphan (census 10). Hướng: mở rộng `cleanup-panes.ps1` reap theo pid surface, hoặc daemon reap định kỳ. Cần plan/wave riêng nếu user chọn làm.

## Success Criteria

- [ ] Các WI user chọn được implement qua worker + nghiệm thu độc lập (test 0 FAIL, verify live)
- [ ] WI không được chọn: ghi nhận quyết định trong plan, đóng plan sạch

## Risk Assessment

WI-1 + WI-2 đụng 2 file khác nhau → 2 worker song song được (zone tách biệt). WI-2 nên làm 1 worker riêng vì cần verify live cẩn thận.
