# 汽車銷售業務系統 — 交接文件（給新對話/新環境接手用）

> **2026-08-20 重大修復：瀏覽器儲存已永久隔離。** GitHub Pages 的 `/car/` 與
> `/TEST/` 路徑仍屬同一個 origin，不能共用 IndexedDB/localStorage/CacheStorage 名稱。
> 汽車系統現在固定使用 IndexedDB `car_sales_assistant_v1`、localStorage 前綴
> `car-sales.`、cache 前綴 `car-sales-assistant-`。舊共用庫 `business_assistant_v2`
> 只准唯讀救援，**不可自動遷移**，因內容可能已混有兩套不同產業資料。

> **2026-08-20 最新決策：** 報價已支援單項／整單多筆優惠，密碼區已加入
> 內部成本中心。照片跨裝置不採 Cloudflare R2，也不增加任何需付款或維護的
> 雲端服務；系統照片維持本機壓縮保存，跨裝置與客戶共享照片使用既有 LINE 相簿。
> DB 版本維持 v8，僅為相容曾開啟短暫 v8 版本的瀏覽器，不能降回 v7。

> 把這份文件連同原始碼交給任何 AI 或工程師，即可完整接手開發。
> 最新程式碼在 GitHub：`leoliaoinfo-cpu/car` 分支 `claude/car-sales-handoff-sht2ks`（自舊 repo `leoliaoinfo-cpu/TEST` 分支 `claude/caravan-truck-business-system-ul6st3` commit `95d5021` 遷移而來）。

## 一、專案定位

台灣商用貨車（KIA 卡旺 K2500 等）第一線業務的**單機版工作系統**。使用者是外勤業務，主戰場是手機、用 LINE 聯絡客戶。系統唯一目的：**不漏追蹤、報價跟得上、成交不掉單**。核心心法：商用車是生財工具，報價要能算出「這台車每月幫頭家淨賺多少」。

## 二、技術架構

- **前端**：React 18 + Vite（`vite-plugin-singlefile` 打包成單一 `dist/index.html`，離線可用、雙擊可開）
- **樣式**：Tailwind CSS 3，主題色全走 CSS 變數（`--c-*`，RGB channel 形式支援 alpha），深/淺雙主題
- **儲存**：瀏覽器 IndexedDB（`idb` 套件），汽車系統專用資料庫名 `car_sales_assistant_v1`；**無後端**
- **雲端同步**（選用）：`src/sync.js`——用使用者自己的 GitHub 私人 repo 存 `data.json`；`db.put` 自動蓋 `_ts`、`db.delete` 寫 tombstones（v4 新 store），逐筆 LWW 合併＋墓碑防復活，sha CAS 防互蓋；token 只存 localStorage（`sync.token`/`sync.repo`）。變動防抖 4 秒自動推、60 秒輪詢＋visibilitychange 自動拉
- **日期**：dayjs（zh-tw locale）
- **主程式目錄**：`assistant/`；啟動 `cd assistant && npm ci && npm run dev`；打包 `npm run build`
- 手機測試：`npm run dev -- --host --port 5173`，手機開 `http://電腦IP:5173`

## 三、頁面與功能總覽

### ☀️ 今日工作（預設首頁）
- 統計方塊：逾期追蹤／今日追蹤／即將簽約／久未聯繫
- 備份提醒：有客戶且 >7 天未備份（settings.lastBackupAt）顯示紅色橫幅＋一鍵備份
- 區塊（各自獨立、不混列）：⚠️逾期追蹤、📅今日追蹤（可一鍵已聯繫/撥號/跳詳情）、🎉紀念日（依自訂日期欄位**分組**顯示，「已問候」不清追蹤日期）、⏰提醒（timers）、📋**中央待辦**（輸入即新增雜事、勾選完成當日保留劃線、可刪）、👤**客戶待辦**（彙集所有客戶未完成簽約前待辦，逐一勾選，點客戶名跳詳情）、📊本日成果（自動彙總今天時間軸事件數量與金額，零手動）、📌即將簽約（置頂客戶＋重點備註＋待辦進度）

### 📅 行事曆
- 月曆網格，四種事件彩點：追蹤（橘）/提醒（紫）/成交（金）/紀念日（粉）
- 逾期追蹤日期紅字；點日期看當日清單；點事件跳到該客戶；追蹤事項可就地「已聯繫」；月份導覽＋「今天」鍵

### 👥 客戶追蹤（CRM）
- 側欄：快速篩選（全部/待聯繫/冷掉了）＋客戶分類＋業務進度（皆可自訂），各含計數
- 預設 9 階段管道：新名單→已聯絡→拜訪中→試乘→報價→議價→成交→交車→售後
- 客戶欄位:姓名/公司名、**個人戶/公司戶＋統編**、**產業標籤**（水電/市場攤商/物流貨運/營造工程/資源回收/餐飲/農牧/園藝造景，datalist 建議＋自由輸入）、電話、LINE ID、Email、地址（一鍵開 Google Maps）、來源、**多聯絡人**（角色/姓名/電話，各自可撥）、**轉介紹**（介紹人下拉＋介紹金；詳情自動反向顯示「介紹名單」）、意願度、備註、自訂欄位
- 搜尋涵蓋：姓名/電話/LINE ID/備註/產業/統編/聯絡人姓名電話
- 狀態色條（天數門檻可調，設定→追蹤規則，預設 180/365）：🟢追蹤中 🟡待聯繫 🟠久未聯繫 🔴冷掉了
- 客戶詳情：
  - 🚛 業務進度記錄：LINE摘要/報價/看車試乘/貸款補件/下訂/交車/售後回訪快速事件（報價、下訂含金額）
  - 交車自動建立：3/7/30 天回訪＋三個可勾選可調日期的年度提醒（🛡保險續保+11月、🔧驗車+11月、🔄舊換新評估+54月）
  - 🧾 報價單（見下）；🏆 成交歸檔（見業績表）；📌 即將簽約（置頂/重點備註/簽約前待辦＋一鍵套用範本）
  - ⏰ 計時提醒；📜 互動時間軸（**每筆可編輯**日期/內容/金額、可刪除兩段確認）；未接達 5 次提示考慮移除
  - 編輯基本資料採**欄位白名單合併**（EDITABLE_FIELDS），永不覆蓋報價單/時間軸/待辦（重要 bug 修復，見第六節）

### 🧾 商用車報價器（客戶詳情內）
- 車體配備快選 chips（框式/篷式/冷凍廂/升降尾門/貨斗加高，含價格一鍵帶入）
- 補助折抵快選（汰舊換新、貨物稅減免→**負數扣抵**，報價單綠色顯示）
- 兩組選單皆可在「設定→🚚報價選單」自訂名稱與金額
- 貸款試算：頭期/期數/年利率→本息平均攤還**月付金**；填「每月幫客戶賺多少」→報價單印出「**每月淨賺**」話術
- 預覽固定淺色（不受深色主題影響），適合截圖傳 LINE；業務署名（姓名/電話）記在 settings.quoteProfile 自動帶入
- 報價存於 `client.quotes[]`（含 items/loan），**可回頭編輯**（時間軸事件金額同步更新，不重複建事件）；刪除報價保留時間軸歷史

### 📈 業績表（成交歸檔）
- 客戶詳情「🏆 歸檔到業績表」：日期/成交金額（自動預填最近報價或下訂金額）/自訂金額欄位（預設：保險金額、收入，設定→業績欄位可增減）/備註
- 單月檢視：月份切換、該月細項、各欄位加總；總表檢視：歷月分組（每月小計）＋全部總計
- 列可編輯/刪除（兩段確認）；點客戶名跳詳情；歸檔寫入時間軸；「本日成果」計入

### ⚙️ 設定
分頁：💾備份還原（匯出 JSON／匯入前驗格式+顯示摘要+自動先下載現況備份）、🏷客戶分類、📶業務進度、✏️自訂欄位（日期型可設**紀念日循環**：每年/一次性/連續N年→出現在今日工作與行事曆）、🏆業績欄位、📋待辦範本（可編輯）、🚚報價選單、⏱追蹤規則（久未聯繫/冷掉天數）、📖使用說明。右上角 🌙/☀️ 主題切換（localStorage.theme，預設 dark）

## 四、資料模型（IndexedDB `business_assistant_v2`，v3）

| Store | Key | 內容 |
|---|---|---|
| `clients` | id | name, clientType('personal'/'company'), taxId, industry, phone, lineId, email, address, source, contacts[{id,role,name,phone}], referrerId, referralFee, catId, stageId, intentLevel(0-4), notes, customFieldValues{fieldId:value}, nextDate, lastContact, missedCalls, pinned, signingNote, todos[{id,text,done}], quotes[{id,date,model,items[{id,name,price}],note,total,loan{down,months,rate,revenue}}], log[{id,date,type,text,amount?,quoteId?}], createdAt, updatedAt |
| `cats` / `stages` | id | name, colorIdx, order |
| `customFields` | id | name, type(text/number/date), colorIdx, recur('none'/'yearly'/'once'/'count'), recurCount |
| `deals` | id | clientId, clientName, date, amount, fields{dealFieldId:金額}, note |
| `dealFields` | id | name, colorIdx, order |
| `tasks` | id | text, done, doneAt, createdAt（中央待辦） |
| `timers` | id | clientId?, clientName?, note, triggerAt(ISO), confirmedAt |
| `settings` | key | crmThresholds{coldDays,deadDays}、todoTemplate{items[]}、quotePresets{addons[{id,name,price}],subsidies[{id,name,amount}]}、quoteProfile{name,phone}、lastBackupAt{value} |
| `tombstones` | id(`store:key`) | store, key, ts——刪除墓碑（雲端同步合併時防止已刪資料復活，保留 90 天） |
| `journalEntries`/`archivedJournal`/`salaryMonths`/`timerHistory` | — | 已下架功能，僅為舊備份相容保留 |

時間軸 `log.type`：contact/missed/line/quote/visit/loan/order/delivery/aftercare/deal/occasion。
備份格式：`{_v:2, exportedAt, ...所有store陣列}`；亦支援舊版 `{_v:1, crm, jnl, sal}` 匯入。

## 五、設計系統（莫蘭迪藍灰）

CSS 變數（`assistant/src/index.css`，RGB channel）：
- 淺色 `:root`：bg 236,240,243｜s1 247,249,250｜s2 227,233,237｜s3 214,222,228｜bdr 199,209,216｜accent 95,127,150｜on-accent 255,255,255｜danger 178,94,94｜ok 125,155,118｜ink 46,58,66｜ink2 90,107,119｜ink3 143,160,172
- 深色 `html.dark`（**預設**）：bg 23,28,33｜s1 31,38,44｜s2 41,50,58｜s3 51,62,71｜bdr 63,76,87｜accent 147,180,205｜on-accent 23,28,33｜danger 208,140,140｜ok 154,184,148｜ink 226,233,238｜ink2 168,182,192｜ink3 118,133,145
- 彩色標記（雙主題通用中間調）：STATUS_COLOR ok#7d9b76/warn#bf8a5e/hot#c0764f/cold#b26b6b；CAT_COLORS、FIELD_COLORS、EVENT_TYPES 色票見 `utils/crm.js`
- 主題切換：index.html 內聯 script 於 React 前套用（防閃色）；按鈕在設定面板右上
- 手機優先：桌面頂欄 hidden md:flex；手機底部導覽（今日/行事曆/客戶/業績/設定）；報價單預覽固定淺色

## 六、關鍵設計決策與已修的坑（新接手必讀）

1. **增量更新一律走 `context.updateClient(id, updater)`**：內部用同步 clientsRef 鏡射，避免快速連續操作的 lost-update race。絕不要拿舊的 client 快照整筆 `saveClient` 覆蓋。
2. **編輯表單白名單**：`ClientDetail` 的 EDITABLE_FIELDS 只含基本欄位；儲存用 `updateClient` 合併。曾發生整筆快照覆蓋導致報價單/時間軸被清空的 bug（已修）。
3. **表單重置在 async 儲存之前**：先 setState 清空/關閉再 await，否則儲存期間輸入的新內容會被遲到的清空洗掉、連點會重複記錄。
4. **設定清單刪除要同步刪 DB**：用 context 的 `overwriteStore`（寫入現有＋刪除移除項），否則重整後復活。
5. **刪除業績/報價不刪時間軸事件**（帳可改、歷史保留）；報價編輯用 `log.quoteId` 找到原事件同步金額。
6. **DB 升版**：新增 store 就 DB_VERSION+1，upgrade 內用 `objectStoreNames.contains` 防呆；`db.js ALL_STORES` 同步加，備份匯出入自動涵蓋。
7. 通知只含數量不含客戶資料（隱私）；行事曆/今日的勾選列會消失，Playwright 測試用 `.click()` 不要 `.check()`。

## 七、驗證方式（.claude/skills/verify/SKILL.md 有完整版）

```bash
cd assistant && npm ci && npm run build
npm run preview -- --port 4173 &
# Playwright（playwright-core）+ Chromium 實駕，測試前清 DB：
# indexedDB.deleteDatabase('business_assistant_v2')
```
既有 10 套端對端腳本涵蓋全部功能（本文件撰寫時全綠）。

## 八、部署現況與注意

- GitHub：`leoliaoinfo-cpu/car`（本系統專屬 repo），開發分支 `claude/car-sales-handoff-sht2ks`
- GitHub Pages：deploy.yml 已改為部署本 repo（push 到 main 或開發分支即建置部署）。`/car/` 與 `/TEST/` 雖是不同路徑，瀏覽器儲存仍共享同一 origin，因此所有儲存鍵必須維持上述專屬命名空間。舊 repo `leoliaoinfo-cpu/TEST` 的 Pages 由使用者另一個系統使用，不可去動
- 單檔 `dist/index.html` 可直接給使用者雙擊使用

## 九、路線圖（未做）

- ~~雲端同步~~（已完成：GitHub 私人 repo 方案，見 src/sync.js）
- ~~PWA 安裝＋到期提醒系統通知~~（已完成：public/{manifest,sw.js,icons}，SW 網路優先+離線快取；
  通知走 SW showNotification（src/notify.js），Android 支援 periodic background sync 背景檢查；
  設定→🔔通知 有權限管理與加入主畫面教學。file:// 雙擊單檔模式自動略過 SW）
- P1：報價單 PDF、業績 CSV 匯出、管道看板（桌面）、交車照片上傳（可用同步的私人 repo 存）
- P2：KPI 視覺化、AI 話術/優先客戶分析（API key 走後端代理）

## 十、給新對話的啟動提示

把原始碼 zip 解開（或 clone 上述分支），讀完本文件即可接手。使用者是貨車業務本人，偏好：直接動工、每輪附截圖與單檔版、莫蘭迪藍灰深色、手機優先、資料絕不遺失（改動前先想清楚會不會覆蓋既有資料）。

---

## 十一、最新進度（接手前必讀，截至 commit `9f3d964`）

第九節之後又完成了以下（皆已 push 到 `claude/car-sales-handoff-sht2ks`，每個 commit 訊息都有詳細說明，`git log` 即進度紀錄）：

**報價單／型錄**
- 整合 KIA 卡旺 2026 原廠車型（8 款）與配件（35 項，含價格與忠於圖片的介紹文字）到報價器；配件依 10 類分組、組內金額由高到低、已選反白、同類擇一自動取代。
- 貸款改「期數按鈕」：選期數自動算月付；各期年利率在「設定→報價選單」設定，報價單只顯示月付款＋期數、不顯示利率。頭期改 %按鈕。免責聲明嚴謹版。浮水印文字可在設定自訂（預設「報價僅供參考」，非業務名）。
- 報價單一鍵下載完整 PNG（html2canvas，clone 到畫面外避免裁切）。
- **產品型錄**（`components/catalog/ProductCatalog.jsx`）：13 張行銷圖壓縮放 `public/catalog/`＋`manifest.json`，響應式縮圖牆＋放大檢視（滿版全螢幕、手滑換頁、圓點指示）。入口：桌面 header「型錄」分頁、手機右下浮動鈕、報價單內「看型錄」。SW 網路優先自動快取。

**今日工作／待辦／行事曆**
- 今日工作改 **iOS 小工具風**（`components/today/TodayPage.jsx`）：卡片＋件數徽章、圓點條列、桌面 2 欄瀑布流。
- **客戶待辦分組收合**（`ClientTodosSection`）：依客戶／依項目切換、篩選、置頂優先。
- 待辦（中央 `tasks` 與客戶 `client.todos`）新增**處理日期 `due`**：分「排程（近到遠）／無期限」，未來預設收合；到期彙整到今日工作頂部「今日待辦」卡片、並顯示在行事曆對應日期（`EV.todo`，可按完成）。
- **預計交車日** `client.deliveryDate`：客戶詳情可設，到期／逾期在今日工作頂部「今日交車」卡片提醒；記錄「交車」事件時自動清除。

**業績表 / 安全**
- 業績表**移出主導覽**，改由「設定→📈 業績表」進入；可設**密碼保護**（SHA-256 雜湊、雙重輸入、隨 settings 同步）。
- **忘記密碼**：安全問題固定「就讀的國小」、答案兩個字，初次設定密碼時一併設定；答對可重設。相關：`utils/lock.js`、`SettingsPanel.jsx` 的 `DealsSection`。

**平板／RWD**
- `manifest.orientation` 改 `any`（可翻轉）。
- 客戶追蹤三欄佈局斷點 md→lg；平板直向改「列表＋詳情」兩欄＋抽屜側欄；工具列最左有醒目藍底「⤢ 放大詳情／◨ 展開列表」可收合側欄與列表、詳情全寬（`focusDetail` state）。

**客戶照片 / 名片（DB 升到 v6）**
- `components/crm/ClientPhotos.jsx`＋`utils/image.js`：客戶詳情可上傳名片與照片，**上傳自動壓縮**（canvas，名片 1800px/q.78、照片 1600px/q.72）。
- 存**獨立 IndexedDB store `photos`**（存 Blob，keyPath id、index clientId）。**刻意不納入 `ALL_STORES`/`SYNCED_STORES`/備份**——避免 data.json 爆量。db 方法：`getPhotos/putPhoto/deletePhoto/deletePhotosByClient/photosUsage`。
- 刪客戶（單筆＋批次）時 `db.deletePhotosByClient` 一併刪；`housekeep` 清孤兒照片；顯示用 objectURL 於卸載/刪除時 revoke。
- SW 快取升 `assistant-v3`。

## 十二、最新決策與後續事項

**照片跨裝置已決策**：不註冊 Cloudflare R2，不增加付款設定或需維護的照片後端。系統內照片維持本機 IndexedDB 壓縮保存，不進 GitHub `data.json` 或備份；需要跨手機、電腦查看或與客戶共享時，使用客戶既有 LINE 相簿。LINE 相簿與本系統不做 API 串接，避免登入、權限及額外維護負擔。

**報價與成本中心已完成**：車價、型錄改裝及手動項目可新增多筆單項優惠，另有多筆整單優惠；客戶報價不顯示成本／利潤。DB v7 新增 `pricingRecords`，密碼保護區提供成本設定、報價試算與單車利潤，儲存或分享前會檢查缺成本及低於成本。

**資料庫相容性**：照片雲端版本曾短暫把正式站升到 DB v8，之後即使撤回功能也不可降版；目前程式保留 `DB_VERSION = 8`，但不建立或同步 R2 照片資料。

其他可做未做：報價單 PDF、業績 CSV（使用者說不用）、KPI 視覺化、把「有處理日期的待辦」也納入 .ics 匯出（目前只匯出活動與提醒）。

## 十三、給 GPT Codex／其他 AI 接手的啟動步驟

1. `git clone https://github.com/leoliaoinfo-cpu/car && cd car`
2. `git checkout claude/car-sales-handoff-sht2ks`（最新進度都在這條分支）
3. 讀本文件（`docs/HANDOFF.md`）＋ `git log` 了解每步決策。
4. 開發：`cd assistant && npm ci && npm run dev`；建置：`npm run build`（產出單檔 `dist/index.html`）。
5. 接手開場可貼給 Codex：「這是一個 React+Vite 的貨車業務 PWA，程式在 assistant/，資料存 IndexedDB、透過 GitHub 私人 repo 同步；照片只存本機，跨裝置使用 LINE 相簿。請先讀 docs/HANDOFF.md 和 git log 掌握現況，再依後續事項逐項進行。」
