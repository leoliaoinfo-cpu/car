---
name: verify
description: Build, run, and drive the 汽車銷售業務系統 app (assistant/) end-to-end to verify changes.
---

# Verifying the assistant/ app

## Build & serve

```bash
cd assistant
npm ci            # Node 20+
npm run build     # single-file dist/index.html (must run INSIDE assistant/, root has no package.json)
npm run preview -- --port 4173 &   # serves dist/ — closest to GitHub Pages production
```

## Drive with Playwright

Chromium executable (remote env): `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(NOT `/opt/pw-browsers/chromium/chrome`). Install `playwright-core` in a scratch dir.

Wipe state for a clean run:

```js
await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.deleteDatabase('business_assistant_v2');
  r.onsuccess = r.onerror = r.onblocked = () => res();
}));
await page.reload();
```

## Flows worth driving

- Four tabs exist: 今日工作 (default), 行事曆, 客戶追蹤, 業績表 — 薪資計算 and 工作日誌
  were removed on purpose; their IndexedDB stores remain for old-backup import compat.
- Theme: Morandi blue-grey, dark by default via `html.dark` + CSS variables (`--c-*`
  in index.css; dark body bg = rgb(23,28,33), light = rgb(236,240,243));
  localStorage key `theme` ('dark'|'light'), toggle button in settings header.
  Wipe localStorage 'theme' for a deterministic theme test.
- 記錄「交車」 creates 6 timers by default: 3/7/30-day aftercare + 3 adjustable annual
  reminders (保險續保/驗車 +11 months, 舊換新評估 +54 months; each can be unchecked).
- New-client modal name placeholder is 「姓名 / 公司名 *」 — match with
  `input[placeholder*="姓名"]`. Clients have clientType/taxId/industry/contacts[]/
  referrerId/referralFee; search also matches industry, taxId, contact name/phone.
- Quote generator has preset chips (addons + negative subsidies, editable at
  設定 → 🚚 報價選單) and a loan block (down/months/rate/monthly-revenue →
  月付 + 每月淨賺 shown on the sheet). quote.loan persists — check edit mode keeps it.
- Date-type custom fields support recurrence (每年/一次性/連續N年) — occurrences show
  grouped-by-field on Today and as 🎉 events on the calendar.
- 報價單產生器: client detail → 「＋ 建立報價單」; quotes are saved on client.quotes
  and editable afterwards (✏️ in the 🧾 報價單 section; timeline amount syncs on edit;
  deleting a quote keeps its timeline event). Signature persists via settings
  'quoteProfile' (loads async — wait for the input value, don't read immediately).
- Today page has 📋 待辦事項 (central tasks, quick-add input, tasks store) and
  👤 客戶待辦 (undone client todos across all clients). Checking a client-todo row
  removes it — use .click() not .check(): Playwright check() retries on the
  controlled checkbox and will tick EVERY row one by one.
- Timeline entries are editable (✏️ inline form) and deletable (two-step ✕).
- 交車待辦範本 is editable at 設定 → 📋 待辦範本 (settings key 'todoTemplate').
- When settings panel is open over the CRM page, scope button selectors with
  `.anim-slide-right` — the CRM toolbar also has a "+ 新增" button behind the overlay.
- 行事曆: events = client nextDate (追蹤), unconfirmed timers (提醒), deals (成交);
  click a day → event list; click an event row → jumps to the client in CRM;
  追蹤 rows have an inline 已聯繫 button that clears nextDate.
- 業績表: archive a deal via client detail 「＋ 歸檔到業績表」 (amount prefills from the
  latest quote/order event); 單月 view shows per-field totals, 總表 groups by month.
  Deal fields are editable in 設定 → 🏆 業績欄位. Deleting a deal keeps the client's
  timeline entry (by design).
- Today page: empty state shows 「今天沒有待辦事項」; recording events on clients makes
  an auto-computed 「📊 本日成果」 section appear (counts + NT$ amounts from timeline).
- CRM: 新增 client → detail → 業務進度記錄 quick-event buttons (報價 has amount field);
  記錄「交車」 must create 3 timers (floating `⏱ 3` button) and set nextDate +3 days.
- Pin (📌 button in detail header) → 即將簽約 section (note + todos) → shows on Today page.
- Settings → 備份還原: upload garbage JSON → 「無法讀取備份」; upload real export →
  summary confirm card, confirming triggers a `pre-restore-backup-*.json` download first.
- Reload page → data persists (IndexedDB).

## Gotchas

- Text 「逾期追蹤」 matches both the stat tile (always present) and the section title —
  assert on `⚠️ 逾期追蹤` for the section.
- Checkboxes are controlled inputs updated after an async save — use `.click()` +
  wait for the count text, not Playwright `.check()`.
- Console shows ERR_CONNECTION_RESET for fonts.googleapis.com (sandbox proxy) and a
  favicon 404 — environment noise, not app errors.
- 記錄「交車」 overwrites nextDate to +3 days — if a test needs an overdue client,
  don't record delivery on that client.
- Two `<nav>` elements exist (hidden desktop header nav + mobile bottom nav) — target
  the bottom one with `nav.md\\:hidden >> text=…`.
- Today page shows a backup-reminder banner when clients exist and lastBackupAt
  (settings store) is missing or ≥7 days old; 立即備份 downloads `auto-sales-backup-*.json`.
