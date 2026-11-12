# 汽車銷售業務系統 — 專案說明（AI 每次對話自動讀取）

> 這份檔案放在 repo 根目錄，Claude Code 開新對話會**自動載入**；Codex 讀 `AGENTS.md`（指向本檔）。
> 所以使用者**不需要重新解釋專案**。開工前先讀完本檔；細節與歷史決策見 `docs/HANDOFF.md`。
> **更新規則**：做完會影響「架構／規矩／決策」的功能，就順手更新本檔對應段落（保持精簡，細節寫進 HANDOFF）。

## 1. 這是什麼

使用者是**貨車（KIA 彰化卡旺／K2500）業務本人，不是工程師**。這是他自用的業務工作系統 PWA：客戶、案件、報價、成交、交車施工流程、配件點貨、行事曆。
- 程式在 `assistant/`：React 18 + Vite + Tailwind；建置成單一 `dist/index.html`（vite-plugin-singlefile）。
- 資料存瀏覽器 IndexedDB，經使用者**自己的 GitHub 私人 repo**（預設 `car-sales-data`）雲端同步（`src/sync.js`，LWW 合併 + 墓碑）。
- 線上網址：https://leoliaoinfo-cpu.github.io/car/ （GitHub Actions `deploy.yml` 於 push 到開發分支時自動建置部署，約 1 分鐘）。

## 2. 協作規矩（務必遵守）

- **用繁體中文**，口語、講重點、附截圖。使用者不懂程式，別丟術語。
- **直接動工**；有取捨時給「建議＋理由」讓他選，不要丟一堆選項要他研究。
- 做完一個功能：自己建置並實際用 Playwright 手機尺寸（390×844）操作驗證、截圖，再 `git commit`（繁中訊息）並 `git push` 到 **`claude/car-sales-handoff-sht2ks`**。**不要擅自開 PR、不要推 main。**
- **每次做完重要功能，順手更新本檔（CLAUDE.md）**再一起 commit：架構／DB 版本／新流程改 §4～§5，新決策或踩雷補 §6，完成與待辦改 §7。這是使用者明確要求的收工步驟，沒更新等於沒做完。
- **資料絕不能遺失**：改資料層前先想會不會覆蓋既有資料；破壞性操作先確認；舊資料要相容（見 §6 陷阱）。
- Claude 與 Codex 會輪流接手同一條分支：**開工先 `git pull`，看 `git log` 掌握對方做了什麼**；不要同時改。
- 注意 `git status` 是否有未提交變更；Codex 常把進度留在使用者電腦未推送，要請他先 commit+push。

## 3. 指令

```bash
cd assistant
npm ci
npm run dev                      # 開發
npm run build                    # 產出 dist/index.html（交付物）
npm run preview -- --port 4173   # 預覽（測試用）
node --test $(find src -name '*.test.js')   # 單元測試（無 npm test script；目前 175 項全過）
```
- 端對端：`assistant/e2e/stock-flow.mjs`（需 `playwright-core`，先 preview；見檔頭說明）。完整驗證流程見 `.claude/skills/verify/SKILL.md`。
- 測試資料庫名 `car_sales_assistant_v1`；測試前請自行 seed 或清空，**不要碰使用者真實資料**。

## 4. 架構速覽

- **導覽**（`src/App.jsx`）：底部 工作 / 案件 / 客戶 / 更多；更多內有 客戶接待、報價管理、行事曆、產品型錄、成交與施工管理、完整工作總覽、系統設定。桌面版 Header 對應。
- **`src/context.jsx`**：全域狀態與所有存取（saveDeal、confirmQuoteDeal、deleteClient…），改資料一律走這裡，別在元件裡直接寫 DB（照片除外）。
- **`src/db.js`**：IndexedDB（idb），目前 **DB v12**，stores：clients cats stages customFields journalEntries archivedJournal salaryMonths timers timerHistory settings deals dealFields tasks tombstones events photos pricingRecords quoteDrafts receptionSessions suppliers cases workItems activities。所有 `put` 自動蓋 `_ts`、`delete` 自動寫墓碑供同步。
- **`src/storageKeys.js`**：所有儲存名稱的唯一來源，**一律帶專屬前綴**（見 §6 儲存隔離）。
- `src/utils/`：純邏輯（可單元測試）。`dataMerge.js` 同步／還原的合併決策、`cases.js` 案件階段與工作佇列、`pricing.js` 報價成本利潤、`stock.js` 成交配件核對與缺貨、`delivery.js` 交車流程、`quotes.js`、`reception.js`、`presentationLock.js`、`lock.js`、`ics.js`。
- `src/components/`：`cases/`（案件主流程）、`quote/`（QuoteModal 報價編輯、QuoteWorkspace 獨立報價工作區）、`work/`（工作清單）、`crm/`、`deals/`、`reception/`、`today/`、`calendar/`、`catalog/`、`SettingsPanel.jsx`。

## 5. 核心業務模型與流程

- **案件（cases）為主軸**：客戶 →（買車／改裝）案件 → 報價草稿（`quoteDrafts`，可不先建客戶）→ **指定一張報價成交**（`confirmQuoteDeal`）→ 成交（`deals`）→ 交車施工流程（SOP 逐步、廠商）→ 完成。
- **成交 ↔ 案件關聯有兩種**：新資料 `deal.caseId`；**舊資料只有 `case.dealId`**。一律用 `findDealForCase(deals, case)`（utils/cases.js）找，不要只比 `deal.caseId`（曾因此重複建立成交）。
- **成交配件核對表**：成交時依「成交那張報價」的 addon＋實體贈品建 `deal.stockItems`（車輛售價、一般費用不算）；狀態 todo/inquiry/ready/installed/not_needed；待廠商確認需排再追日；交車日 ≤7 天且仍缺貨 → 工作頁「交車將近」警示；中央點貨彙總全案缺品。
- **報價單**：貸款以 4.5% 概算，客戶只看月付款（最高 84 期），**不顯示利率、不顯示貸款公司**；浮水印文字可設定（預設「報價僅供參考」，不用業務名）；一鍵輸出 PNG（html2canvas）。
- **客戶需求／用途**是內部備忘，**不進客戶報價預覽與 PNG**。
- **成本／利潤絕不進客戶報價圖片**；內部成本（業績與成本）用**數字密碼**保護（2026-11-12 使用者決定；現行入口為「成交與施工管理」，密碼在設定→後台密碼）。報價畫面不跳成本不足提示。
- **產品內容（車型／配件介紹）以原廠圖片文字為準，不可自己編**；型錄圖在 `public/catalog/`。
- 待辦有「處理日期」：排程（近到遠）／無期限；到期彙整到工作頁與行事曆。

## 6. 已決策事項與陷阱（別重蹈覆轍）

- **儲存隔離（重大）**：GitHub Pages 的 `/car/` 與 `/TEST/` 同 origin。本系統固定用 IndexedDB `car_sales_assistant_v1`、localStorage 前綴 `car-sales.`、cache 前綴 `car-sales-assistant-`。舊共用庫 `business_assistant_v2` **只准唯讀救援，不可自動遷移**（可能混有另一產業資料）。`/TEST/` 是使用者另一個系統，**不可去動**。
- **照片**：只存本機（`photos` store，Blob，上傳壓縮），**不進 GitHub `data.json`、不進備份**；跨裝置與客戶共享用客戶既有 LINE 相簿。**不要重新加入 Cloudflare R2 或任何需付費／維護的雲端照片服務**，除非使用者日後明確改變決定。
- 不要把大檔塞進同步用 `data.json`（GitHub 單檔與 repo 歷史膨脹，五年會爆）。
- 要求能運行 5 年、數千客戶不癱瘓：每日資料保養（`db.housekeep`）、批次寫入、虛擬捲動；新增資料量大的功能要想增長。
- 平板：manifest `orientation: any`；客戶追蹤 md(768) 起「列表＋詳情」兩欄，有醒目「放大詳情」收合鈕。
- **同步絕不清空資料表**：`db.applySyncedSnapshot` 只「補上較新的、刪掉有墓碑的」，本機獨有資料一律保留；合併決策在 `utils/dataMerge.js`（純函式、有測試）。不要改回 clear 後重寫（下載途中的修改會被洗掉）。
- **預設值不寫進資料庫**：客戶分類／階段／業績欄位的預設只留在記憶體；寫進 DB 會帶新 `_ts`，新裝置一連同步就蓋掉所有裝置的自訂設定。啟動時的資料整理只寫「真的有變」的紀錄（`db.putRaw` 不重蓋 `_ts`）。
- **照片只搬不刪**：合併客戶用 `db.reassignPhotos`；每日保養只刪「客戶有墓碑」的孤兒照片。刪客戶時，成交或報價還在的成本紀錄要保留。墓碑保留 2 年。
- **客戶頁建立成交也要建配件核對表**（`stockItemsFromQuote`），且先用 `findDealForCase` 找既有成交；客戶報價預覽／PNG 不可出現「年利率」字樣。
- 刪除類小按鈕一律用 `ui.jsx` 的 `ConfirmDeleteButton`（兩段式）；會寫資料的按鈕要有送出中鎖定，避免連點重複建立。
- 手機輸入框字級須 ≥16px（index.css 已設），否則 iPhone 點了會自動放大。
- 測試踩雷：Playwright 的勾選列會消失，用 `.click()` 不要 `.check()`；配件核對列的「狀態/數量/再追日」在折疊 `<details>` 內，要先點開；案件詳情是全螢幕覆蓋層，點底部導覽前要先按「←」返回。
- Pages 部署：Actions 只在改動 `assistant/**` 或 deploy.yml 時觸發；部署後已安裝的 PWA 需關掉重開才拿到新版（SW 網路優先）。

## 7. 現況與待辦

- 已完成：案件主流程、獨立報價工作區、成交報價指定與配件點貨／缺貨提醒、交車施工流程與廠商名冊、套餐與自訂品項、車高計算機、業績／成本中心、型錄、iOS 風工作頁、平板 RWD、雲端同步、PWA。
- 待處理：
  - 分支 `hotfix/pages-storage-isolation` 尚未與開發分支整理（Codex 處理 Pages 儲存隔離的修正線），動它前先問使用者。
  - 配件核對表目前每項的狀態/再追日藏在折疊區；若使用者覺得手機難操作，可把「再追日」直接露出。
  - 2026-11-11 全面檢視後已修：同步／還原掉資料、畫面 bug 共 24 項。**尚未做、等使用者決定**：(1) 簡化 10 項（報價拿掉 27 分類逐一確認、施工進度移出密碼區、客戶頁瘦身、移除「完整工作總覽」入口、用語統一等）；(2) 內部成本入口：本檔 §5 寫「設定＋就讀的國小」，程式實際是「成交與施工管理＋數字密碼」，以使用者回覆為準；(3) 同一客戶兩台裝置同時改只留一邊（需逐筆合併 `client.log`／`todos`，設計見 HANDOFF）。
  - 已知未修 bug：手機上「⏱ 提醒」膠囊蓋住「＋」；沒選客戶的報價重整後自動長出「未命名客戶」案件；交車完成後卡片仍顯示尚缺配件、缺配件可直接交車無提醒；新建案件產生兩張重複待辦；行事曆與完整工作總覽看不到案件追蹤日。
  - **2026-11-12 使用者決定走全面精簡**：依 `docs/SIMPLIFY_SPEC.md` 逐階段執行（**一次一階段**，先前三組同時跑三次撞用量上限）。**下一步＝階段 0**。尚未依規格改任何程式。
  - 使用者已回覆的決定：內部成本用**數字密碼**；業績與成本每天看、車高試算、產品型錄、K2500 規格（要從客戶接待獨立出來）要好找；廠商名冊要更顯眼；客戶接待、競品比較、紀念日、計時提醒不用，移除入口但資料保留。**交車後自動 3／7／30 天回訪提醒取消**（不再建立；既有資料不刪）；年度提醒（續保／驗車／舊換新）要不要留尚未問。
  - 半成品備份在遠端 `backup/simp-quote`、`backup/simp-delivery`、`backup/simp-work`（未合併、未完整驗證，部分 WIP 可能無法建置；內容與說明見規格階段 0）。
- 新需求：使用者會逐項口述；做完更新本段。

## 8. 文件地圖

| 檔案 | 用途 |
|---|---|
| `CLAUDE.md`（本檔）／`AGENTS.md` | AI 自動讀取的精簡專案說明 |
| `docs/HANDOFF.md` | 詳細交接：資料模型、各功能決策（頂部為最新補充，往下較舊） |
| `docs/SIMPLIFY_SPEC.md` | **全面精簡規格**（今天／案件／報價／客戶；分 0–6 階段，逐階段執行與驗收） |
| `docs/CODEX_KICKOFF.md` | 給 Codex 的開場指令 |
| `docs/PROGRESS_LOG.md` | git log 匯出（可能落後，以 `git log` 為準） |
| `.claude/skills/verify/SKILL.md` | 建置、啟動、端對端驗證步驟 |
