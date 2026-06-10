---
phase: 3
title: "Implementation (conditional)"
status: done
effort: "2 wave (paneux: 2 codex worker song song; orphfix: 1 Leader Opus) + dogfood + 2 code review"
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

- [x] Các WI user chọn được implement qua worker + nghiệm thu độc lập (test 0 FAIL, verify live)
- [x] WI không được chọn: ghi nhận quyết định trong plan, đóng plan sạch (cả 3 WI đều ACTIVE — không có WI bị bỏ)

## Kết Quả Thực Hiện (2026-06-10, vai trò Orchestrator — workers thực hiện)

| WI | Actor | Kết quả | Bằng chứng |
|----|-------|---------|-----------|
| WI-1 close-surface tab trống | codex worker (wave paneux) | DONE — `allocateSplit` trả `{paneId, defaultSurfaceId}`, `closeSurfaceQuiet` gọi sau spawn thành công ở 3 caller; grid giữ nguyên | suite 214/0; dogfood live 3/3 pane chỉ 1 tab (cả engine codex lẫn claude) |
| WI-2 render ANSI giàu | codex worker (wave paneux) | DONE — line-buffer qua chunk boundary, `createCodexRenderer` export, fallback echo thô khi renderer lỗi, `WORKER_RAW_ECHO=1` | test mới `test-codex-render.js` 16/0 (chunk-invariant 7/64/1000B + cắt giữa dòng); live codex exit 0; out.jsonl production 29/29 parse OK |
| WI-3 orphan-shell leak | Leader Opus (wave orphfix) | DONE — tạo mới `scripts/reap-orphan-shells.ps1` (identity-based: đọc env `WMUX_SURFACE_ID` qua PEB; dry-run mặc định; `-Reap`/`-TargetPid`; 4 lớp khoá + fail-safe exit 3) | verify thang a→d live; census 11 shell/1021MB → 2/175MB (reap 9 orphan/846MB); negative test REFUSED orchestrator/self; dry-run độc lập từ orchestrator: 0 orphan còn lại |

**Review (code-reviewer, advisory):** wave paneux APPROVE_WITH_NITS — 0 critical/high. Nits ghi nhận (không sửa, cosmetic/by-design): (1) `launch-agent-ext.js` thứ tự khai báo `C` trước `noColor` (an toàn call-time, dễ nhầm khi đọc); (2) flush phần dư buffer khi stream kết thúc in thô — ĐÚNG spec; (3) `input_tokens: 0` bị ẩn khỏi turn summary (display-only); (4) `test-codex-render.js` cần fixture local `.orch-run/chfix|agfix` — fail ENOENT trên fresh clone; (5) `|| ''` vs `?? null` cho surfaceId.

**Review reaper: REQUEST_CHANGES → remediation wave orphfix2** (1 codex worker, zone 1 file): (H1) TOCTOU race — shell sinh giữa snapshot tree và census bị xếp orphan oan → vá bằng `-MinOrphanAgeMin` mặc định 2 phút (trẻ hơn = YOUNG-SKIPPED, TargetPid cũng REFUSED); (H2) env đọc được nhưng thiếu key `WMUX_SURFACE_ID` (sid rỗng) lọt nhánh ORPHAN — lệch design intent lock 4 → rỗng = UNCERTAIN không bao giờ kill; (M1) chặn 32-bit PowerShell ngay đầu (offset PEB chỉ đúng x64) → fail-safe exit 3. **✅ Remediation DONE + nghiệm thu**: ladder live đầy đủ (young REFUSED exit 2 → override `-MinOrphanAgeMin 0` mới kill được, live shells nguyên); orchestrator xác minh độc lập 3 marker trong file + chạy dry-run/`-Reap` cuối từ context riêng (reap orphan còn lại, hệ về 0 orphan, exit 0).

**Insight vận hành mới (từ census WI-3):** harvest `agent kill` vốn ĐÃ giết shell agent; nguồn leak chính là shell tab-trống (không agent gắn). Sau WI-1, tab trống bị đóng ngay lúc spawn → shell của nó vẫn orphan (1/worker) → chạy `reap-orphan-shells.ps1` định kỳ (dry-run xem trước, `-Reap` dọn). Khuyến nghị tương lai của Leader: cân nhắc tích hợp vào `orchestrator-pass` nếu RAM thành vấn đề; PHẢI giữ 4 lớp khoá. Risk mở: giả định single-window của wmux 0.5.0 (re-validate khi wmux có multi-window).

## Risk Assessment

WI-1 + WI-2 đụng 2 file khác nhau → 2 worker song song được (zone tách biệt). WI-2 nên làm 1 worker riêng vì cần verify live cẩn thận.
