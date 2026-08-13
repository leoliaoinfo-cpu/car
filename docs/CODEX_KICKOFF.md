# 給 GPT Codex（或其他 AI）的接手指令

> 把下面「─── 複製這段給 Codex ───」之間的整段，貼進 Codex 的第一則訊息即可。
> 前提：Codex 已經 clone 本 repo（`leoliaoinfo-cpu/car`）並 checkout 分支 `claude/car-sales-handoff-sht2ks`。

─── 複製這段給 Codex ───

你要接手一個已經在開發中的專案，請完全延續現有風格與進度，不要重寫或另起爐灶。

**專案**：貨車銷售業務（KIA 卡旺／K2500）用的工作系統 PWA。程式在 `assistant/`（React 18 + Vite + Tailwind），資料存瀏覽器 IndexedDB，透過使用者自己的 GitHub 私人 repo 同步（見 `assistant/src/sync.js`）。建置產出單一檔 `dist/index.html`（vite-plugin-singlefile），可直接雙擊使用。

**第一步（務必先做）**：讀 `docs/HANDOFF.md` 全文，再看 `git log`。那是完整架構、資料模型、每個功能的決策紀錄與「待決策事項」。讀完再動手。

**指令**
- 開發：`cd assistant && npm ci && npm run dev`
- 建置：`npm run build`（成功後 `dist/index.html` 是交付物）
- 預覽：`npm run preview -- --port 4173`
- 驗證：用 Playwright（playwright-core）＋ Chromium 實際開頁面測試；測試前先清 DB（`indexedDB.deleteDatabase('business_assistant_v2')`）或用 seed。每次改完 UI 都要實際跑一遍、截圖確認，再回報。

**使用者是誰、偏好**（我是貨車業務本人，不是工程師）
- 用**繁體中文**溝通。回報要口語、講重點、附截圖。
- **直接動工**，不要問一堆才做；有取捨時給我「建議＋理由」再讓我選，不要丟一堆選項要我研究。
- 每個功能做完要：`git commit`（訊息用繁中、講清楚做了什麼）並 `git push` 到 `claude/car-sales-handoff-sht2ks` 分支。**不要**擅自開 PR 或推到 main。
- 設計：莫蘭迪藍灰色系、預設深色、**手機優先**、平板也要好用（可翻轉）。核心動作一鍵完成。
- **資料絕不能遺失**：改動資料層前先想清楚會不會覆蓋既有資料；破壞性操作要先確認。
- 報價單／業績相關規矩：報價單**不顯示利率**（只顯示月付款＋期數）、浮水印預設非業務名、業績表要密碼保護（別讓客人看到）。
- 產品內容（車型/配件介紹）**以原廠圖片文字為準，不可自己編**。

**現在最優先要處理的事**：`docs/HANDOFF.md`〈十二、待決策事項〉的「照片跨裝置」。目前客戶照片只存本機、不跨裝置；我要跨裝置，但要能撐五年、數千客戶不癱瘓。你先讀懂三個方案與技術結論（**絕不可把照片塞進 GitHub 同步的 data.json，也不要一張一檔塞 git repo**），然後用繁中跟我確認要走哪個方案（我傾向物件儲存如 Cloudflare R2）、需要我提供什麼（帳號、金鑰、CORS 設定），再開始實作，並把設定做成像現在「設定→雲端同步」那樣的引導畫面。

其餘待辦與新需求，我會逐項告訴你。先讓我知道你已讀完 HANDOFF、掌握現況，並針對照片跨裝置給我你的建議。

─── 複製結束 ───
