---
name: verify
description: Build, run, and drive the 汽車銷售業務系統 app (assistant/) end-to-end to verify changes.
---

# Verifying the assistant/ app

## Build & serve

```bash
cd assistant
npm ci            # Node 20+
npm run build     # single-file dist/index.html (run INSIDE assistant/)
npm run preview -- --port 4173 &   # serves dist/，最接近 GitHub Pages
node --test $(find src -name '*.test.js')   # 單元測試（目前 199 項）
```

## Drive with Playwright

- Chromium：`/opt/pw-browsers/chromium`（`launch({ executablePath, args:['--no-sandbox'] })`），`playwright-core` 裝在暫存資料夾。
- 手機尺寸 `viewport 390×844`；截圖用 `deviceScaleFactor: 2`。
- 測試資料庫 `car_sales_assistant_v1`：先開頁面讓它建好，再用 IndexedDB `put` 種資料，`reload` 後驗證。**不要碰使用者真實資料。**
- 端對端腳本：`assistant/e2e/stock-flow.mjs`（成交→配件核對→中央點貨→今天頁提醒）。

## 導覽（階段 1 之後）

- 底部／桌面頂部：今天（`work`）、案件、報價、客戶。右上：🔎 搜尋案件、🧰 工具、⚙ 設定。
- 浮動 ＋ 只開「新增客戶／案件／報價」。沒有「更多」頁、沒有客戶接待入口、沒有 ⏱ 膠囊。
- 兩個 `<nav>`/header 同時存在（桌面隱藏）：點底部導覽用 `p.locator('nav').getByText('案件',{exact:true})`；右上按鈕用 `p.locator('header:visible').getByLabel('工具')`。
- 首次啟動橫幅可用 `getByLabel('關閉提示')` 關掉。

## 要驗證的流程

- 今天：預設「逾期＋今天」清單；點上方數字只看某類；右上「清單｜月曆」；月曆同一份資料。
- 案件：卡片追蹤資訊列、篩選（全部／要追蹤／已報價／已成交／已交車／回收筒）；新增案件追蹤日選填（預設 3 天後），只產生一筆待辦。
- 報價：底部固定操作列；沒有原生 alert/confirm（用 `page.on('dialog')` 檢查為 0）；預覽圖不含 利率／成本／利潤／貸款公司／內部備忘；從案件開的報價存檔後回到案件。
- 成交到交車：案件內「建立施工進度」→ 每步一按 ✓；配件沒備妥時完成安裝／交車會跳「仍要繼續」；「確認交車」後 `timers` 為 0、案件 `completed`；施工進度不需密碼；🧰→業績與成本新裝置先要求設定數字密碼。
- 客戶：搜尋框全寬；詳情沒有 建立報價單／建立成交案／預計交車日／計時提醒／生日；歷程與待辦筆數不變。
- 設定：常用（報價選單、雲端同步、備份還原）／進階，可搜尋。

## Gotchas

- 勾選列用 `.click()` 不要 `.check()`（Playwright 會逐列重勾）。
- 案件詳情是全螢幕覆蓋層，點底部導覽前要先按「←」返回。
- 配件警示視窗開著時，底下的按鈕會被遮住，先按「仍要繼續」或「先去核對」。
- sandbox 會出現 fonts.googleapis.com 連線被擋與 favicon 404，屬環境雜訊。
