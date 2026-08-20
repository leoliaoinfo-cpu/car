# 開發進度全紀錄（自動由 git log 匯出）

## 2026-08-20 — 報價成本中心完成；照片維持本機並改用 LINE 相簿

- 報價車價／型錄改裝／手動項目支援多筆單項優惠，另有多筆整單優惠；客戶版不顯示成本與利潤。
- 密碼區新增成本設定、報價試算、單車利潤與成交成本快照；DB v7 新增 `pricingRecords`。
- 使用者決定不採用需開通付款設定的 Cloudflare R2；相關 Worker 與設定介面已撤回。
- 系統照片維持本機 IndexedDB 壓縮保存，跨裝置與客戶共享照片使用既有 LINE 相簿。
- 正式站曾短暫發布 DB v8，因此版本號保留 v8 防止已升級瀏覽器發生降版錯誤。

> 這是專案每一步的完整紀錄，最新在最上面。Codex 也可自行執行 `git log` 取得同樣內容。

## 2026-08-13 — 新增 Codex 接手開場指令（docs/CODEX_KICKOFF.md）

一段可直接貼給 GPT Codex 的第一則指令，涵蓋專案概述、建置/驗證
指令、使用者偏好與規矩、以及最優先的照片跨裝置待決策。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-08-13 — 交接文件更新至最新進度＋照片跨裝置待決策

補齊第九節之後的所有進度（型錄、iOS 今日工作、待辦處理日期、
預計交車、業績表密碼＋忘記密碼、平板 RWD、客戶照片 v6），
並記錄「照片跨裝置」三方案待決策與 GPT Codex 接手步驟。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-21 — 每個客戶新增照片 / 名片存檔（本機壓縮、刪客戶連帶刪）

- 客戶詳情新增「📷 照片 / 名片」區：名片與照片分區，可多選上傳、
  縮圖網格、點圖放大檢視、單張刪除，顯示張數與已用空間
- 上傳自動壓縮（名片 maxDim 1800/q0.78、照片 1600/q0.72）大幅省空間
  （實測 82KB PNG → 15KB）
- 照片存獨立 IndexedDB store（v6，存 Blob 非文字），本機專屬：
  不納入 SYNCED_STORES/備份，避免 data.json 爆量、同步變慢
- 刪除客戶（單筆＋批次）時 db.deletePhotosByClient 一併釋放其照片空間；
  每日保養再清孤兒照片（對應客戶已不存在者）
- objectURL 於卸載/刪除時 revoke，避免記憶體洩漏
- SW 快取升版 v3，讓裝置下次開啟取得新版

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-20 — 客戶詳情收合鈕改醒目並延伸到平板直向

先前收合鈕是灰色細框+難辨識的 emoji，藏在工具列中段，使用者找不到。

- 收合鈕移到工具列最左、改 btn-primary 藍底醒目色、文字「⤢ 放大詳情 / ◨ 展開列表」
- 顯示門檻由 lg 降到 md：平板直向(768)改為「客戶列表＋詳情」兩欄
  （側邊分類收成 ☰ 抽屜），選客戶後仍能看列表換客戶，詳情也夠寬編輯
- 電腦/平板橫向維持三欄；放大詳情時收合側欄與列表、詳情全寬，再點彈回

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-20 — 客戶詳情可專注收合、型錄浮動鈕上移、業績表密碼加忘記密碼

- 客戶追蹤（桌面/平板橫向）新增「⛶ 專注詳情」鈕：收合側邊分類與客戶列表、
  詳情全寬顯示；再點「◧ 展開列表」彈回三欄，收合時 ☰ 仍可叫出分類抽屜
- 手機型錄浮動按鈕由 bottom-20 上移到 bottom-28，不再與底部設定重疊
- 業績表密碼新增「忘記密碼」：安全問題固定為「就讀的國小」、答案兩個字，
  初次設定密碼時一併設定安全答案；忘記時答對即可重設新密碼
  安全答案同樣以 SHA-256 雜湊儲存、隨雲端同步

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 平板版優化：解鎖螢幕翻轉、客戶詳情不再壓縮、型錄滿版

- manifest orientation 由 portrait 改為 any，允許橫向/翻轉
- 客戶追蹤三欄佈局斷點由 md(768) 提高到 lg(1024)：
  平板直向改為單欄全寬詳情＋抽屜式篩選側欄，詳情不再被擠壓到無法編輯；
  平板橫向/桌面才三欄並排，列表寬度改 lg:w-72 xl:w-96 讓詳情更寬
- 型錄放大檢視改滿版全螢幕：圖片撐滿螢幕置中（完整不裁），
  標題/頁碼/箭頭/圓點改浮層漸層疊在圖上，隨螢幕翻轉自動填滿

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 業績表移入設定並加密碼保護，避免給客人看到

- 從主導覽移除業績表（桌面 header tab、手機底部導覽都拿掉）
- 設定新增「📈 業績表」分頁作為唯一入口：
  - 開啟業績表（有密碼需先解鎖，全螢幕開啟，可關閉）
  - 密碼設定區：自訂密碼、雙重輸入確認、可修改（需目前密碼）或取消
- 密碼以 SHA-256 雜湊儲存（不存明文），隨 settings 雲端同步到其他裝置
- 業績表改為全螢幕覆蓋層，點客戶會關閉並跳到該客戶詳情

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 產品型錄放大檢視支援手滑換頁

- lightbox 加單指左右滑動手勢：左滑下一張、右滑上一張（雙指縮放不觸發）
- 底部新增頁數圓點指示器，點圓點可直接跳到該頁
- 手機顯示「← 滑動換頁 →」提示；左右箭頭與鍵盤操作保留

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 待辦處理日期串到今日工作頂部與行事曆

問題：待辦設了處理日期（今天）卻沒浮現在今日工作、也沒進日曆，
要展開客戶待辦才看得到，等於設日期沒意義。

- 今日工作頂部新增「🗓 今日待辦」彙整卡片：把所有處理日期≤今天且未完成的
  待辦（中央待辦＋各客戶待辦）集中顯示，逾期紅標、今天橘標，可直接勾選、
  點客戶名跳詳情——不用再展開客戶待辦
- 行事曆新增「✅ 待辦」型別：有處理日期的待辦（中央＋客戶）顯示在對應日期格，
  當天清單可直接按「完成」勾掉；圖例同步新增

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 客戶檔案待辦也可設處理日期，並與今日工作同步顯示

- 客戶詳情「待辦事項」：新增可填處理日期、既有項目點日期標籤即可改
- 依日期由近到遠排序，逾期紅標「逾期 N 天」、今天橘標、未來灰標日期、無日期虛線「＋日期」
- 日期存在 client.todos[].due，透過既有雲端同步（LWW）自動同步
- 今日工作的「客戶待辦」分組區同步顯示日期標籤、並依日期排序

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 待辦事項加處理日期，分「排程／無期限」兩區

- 每筆待辦可設處理日期：新增時可填、既有待辦點日期標籤即可改
- 有日期→「排程」區，依日期由近到遠排序（越緊急越前面）
  逾期紅標「逾期 N 天」、今天橘標、未來灰標日期
- 沒填日期→「無期限」區，標籤顯示虛線「＋日期」可隨時補上
- 未來還沒到的排程預設收合為「之後還有 N 則」，不會每天都佔版面
- 今天勾完的仍保留（劃線可反悔）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 新增「預計交車日」欄位與首頁「今日交車」提醒

- 客戶詳情新增「🚚 預計交車日」欄位（日期＋今天/明天/3天/7天快速鈕、可清除）
- 首頁最上方新增「今日交車」卡片：列出今日交車＋逾期未交車，置頂客戶優先
  逾期以紅色標「逾期 N 天未交車」，今日以橘色標「今天交車」，附撥號與開啟
- 上方統計方塊新增「今日交車」為第一格（最醒目）
- 記錄「交車」事件時自動清除預計交車日（已交車不再提醒）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 客戶待辦改為分組收合：依客戶／依項目、可篩選、置頂優先

- 依客戶：每位客戶一列顯示剩餘待辦數，點擊才展開全部待辦；置頂客戶（📌）排最前
- 依項目：相同待辦名稱合併成一組，展開看有哪些客戶還沒完成，數量多者在前
- 篩選框：輸入客戶名或項目關鍵字即時過濾，符合的群組自動展開
- 兩種模式皆可直接勾選完成、點客戶名跳詳情
- 解決待辦攤平後越來越長的問題

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-19 — 今日工作改為 iOS 小工具風介面

- 卡片改大圓角、標頭「圖示＋標題＋右側件數徽章」（仿 iOS 提醒小工具）
- 條列改為圓點項目符號＋名稱＋時間/子標題
- 統計方塊改淡色底大數字
- 桌面版兩欄瀑布流排版、手機版單欄堆疊
- 功能全數保留（新增/勾選待辦、@提及、電話、已聯繫、匯出等）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 新增產品型錄展示：原廠行銷型錄圖片，可當場展示給客戶

- 13 張 KIA 卡旺 2026 行銷型錄圖片（車型/配件/報價），壓縮後放 public/catalog/
  由 manifest.json 決定順序與分類標題，縮圖 lazy-load、SW 快取可離線開啟
- 新增 ProductCatalog 元件：響應式縮圖牆＋點圖放大檢視（lightbox）
  支援 ← → 切換、Esc 關閉；桌面/平板/手機皆適用
- 三個入口：電腦版 header「型錄」分頁、手機右下角浮動按鈕、報價單「看型錄」鈕

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 修正下載報價單圖片底部（免責聲明）被裁切

- 擷取前先複製報價單到畫面外、完整展開（脫離捲動容器），
  再用 html2canvas 擷取，並明確指定 width/height 與 windowHeight
- 解決長報價單在手機上底部免責聲明被裁掉的問題
- 驗證：13+ 項長報價單，輸出 PNG 高度＝完整元素高度，底部聲明完整呈現

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 報價單一鍵下載完整 PNG（解決太長截不完）

- 新增「📥 下載報價單圖片」：用 html2canvas 把整張報價單（不論多長）
  輸出成一張完整 PNG，不必手動捲動截圖
- 手機優先叫系統分享（可存相簿或直接傳 LINE），桌面則下載檔案
- 檔名含客戶名與日期
- 記錄報價鈕移為次要、下載鈕為主要動作；總計金額仍醒目顯示於預覽

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 頭期改百分比按鈕、免責聲明改嚴謹版

- 頭期款改為按鈕【免頭款/10%/20%/30%】，依總價自動算頭期金額並顯示；
  另保留自訂金額輸入（輸入後取消百分比選取）
- 百分比會依總價即時計算，加配備後頭期跟著更新
- 報價單免責聲明改為：本內容所有分期款項僅供參考，實際申貸條件、額度及利率，
  均以金融機構最終審核及正式合約為準

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 貸款改期數按鈕：選期數自動算月付，後台設各期年利率

- 報價單改用期數按鈕【12/24/36/48/60/72 期】，點選即算出對應月付款
- 後台「設定 → 報價選單 → 🏦 貸款期數與年利率」設定每個期數的年利率
  （期數越長利率越高，預設值取自常見市場區間，可自由增刪調整）
- 月付款用該期數年利率以本息平均攤還計算；報價單只顯示月付與期數、不顯示利率
- 移除月利率設定，改為年利率制

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 報價單浮水印文字改由設定自訂（預設不用業務名字）

- 設定 → 報價選單 新增「💧 報價單浮水印」，可填公司名/電話等文字
- 預設浮水印為「報價僅供參考」，不再使用業務姓名
- 留空則報價單不顯示浮水印
- 設定隨雲端同步，報價單自動套用

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 貸款利率移至設定、報價單只顯示月付款與期數

- 報價單移除利率顯示，分期區只呈現「分 N 期」與「每月只要 NT$ X」
- 貸款月利率改到「設定 → 報價選單 → 🏦 貸款月利率」設定，隨雲端同步
- 報價視窗移除月利率輸入欄，改由設定帶入；表單內部仍提示目前利率供業務參考
- 月付金計算不變（月利率×12 換算年利率）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 報價單：移除每月淨賺、改月利率無痛框架、加淡浮水印

- 移除「每月預估淨賺」與營收輸入，簡化貸款試算
- 利率改為「月利率」輸入與呈現（0.5% 比 6% 更無壓力），
  數學換算正確（月利率×12 帶入本息攤還）
- 主打文案「每月只要 NT$ X」強化無痛消費心理
- 報價單加淡浮水印（業務署名淡淡鋪滿）：截圖轉傳時品牌隨行、
  也防止他人竄改數字；透明度極低不影響閱讀

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 報價配備：已選反白區別、可再點取消、同類擇一自動取代

- 點選配備後 chip/卡片反白並顯示 ✓，一眼看出已選哪些；再點即取消
- 補助折抵同樣有已選反白狀態
- 設定擇一群組（專業判斷，物理上只能選一個）：
  · 車身烤漆改色（單廂/大單廂/雙廂）— 客戶車型只有一種
  · 防刮漆料（尾門 3 尺寸）— 一個尾門一種尺寸
  · 後照鏡（LED韓版 / 全視線）— 後照鏡只換一次
  選新的自動取代同組舊選項；消光霧面等非擇一項可與底色併存
- 整個類別同屬一擇一群組時標「擇一」徽章，並加操作提示說明

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 報價配備版面優化：組內金額由高到低、RWD 分組卡片、手機架移至配件類

- 每個類別內配備依金額由高到低排序
- 手機架從音響移到新增的「配件」類別
- 報價單配備區重新設計：類別標題加色條、桌面雙欄/手機單欄響應式卡片
- 展開介紹為卡片式（名稱+價格+介紹+加入報價），收合為彩色價格 chips
- 報價視窗桌面加寬（max-w-2xl）以容納雙欄型錄瀏覽

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 報價型錄補齊：外觀/音響/改色/防刮/尾燈/霧燈/鋁圈/大燈＋產品介紹

新增 16 項配件（依圖片價格）：
- 外觀空力 NLD：空力套裝/前下巴/鏡蓋/側燈殼
- 音響 TLSOUND 4喇叭升級 8800
- 車身烤漆改色 單/大單/雙廂 + 消光霧面
- roberlo 防刮漆料 3 尺寸
- LED光環尾燈 11800、魚眼霧燈 5800
- GTR大燈升級三階切線 27000、OMEGA鋁圈 33800（新增鋁圈類別）

- 每項配件補上「產品介紹」desc，內容嚴格取自型錄圖片文字、未自行增添
- 報價單配備改為依 9 類別分組顯示，並可展開「看產品介紹」逐項瀏覽介紹+一鍵加入
- 型錄升級至 35 配件 + 8 車型；未客製者自動套用

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 整合 Kia 彰化卡旺 2026 原廠車型與配件報價型錄

- 8 款車型含售價（單廂/大單廂/雙廂/4WD × 手排/自排，79.8萬~105.8萬）
- 19 項配件含實際價格（配備版本/燈組/底盤強化/金屬製研）
- 報價單新增「選車型帶入」下拉：選車型自動填入車輛售價
- 設定→報價選單新增車型編輯，並區分車型/配備/補助三區
- 「載入原廠型錄」一鍵套用（含確認），未客製的舊型錄自動升級
- _catalog 版本標記：已客製者保留資料僅補車型欄位，不覆蓋

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 300 組極限壓力測試通過；到期提醒新增「全部確認」

極限壓測（300 客戶 / 3426 筆互動紀錄 / 100 活動 / 75 提醒 / 60 成交）：
- 冷啟動渲染 ~400ms、客戶列表 125ms、搜尋 74ms、看板(300卡) 167ms、
  行事曆 135ms、業績加總(60筆) 326ms、.ics 匯出(156 事件) 65ms
- 同步快照 404KB（1MB 內，且已有 raw fallback）
- 全程零 JS 錯誤，系統不癱瘓

優化（壓測發現的真實痛點）：
- 一次累積多筆到期提醒時，強制彈窗需逐一點確認（19 筆要點 19 次）
- 新增「全部確認（N 則）」按鈕，一鍵清光；清除時間 6570ms→272ms
- 單筆時維持原樣，僅顯示「確認已知道」

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 新增重複客戶偵測；20 組客戶壓力測試通過

重複偵測：
- 新增客戶時即時比對電話（正規化，忽略符號）與姓名
- 偵測到可能重複時顯示警告與現有客戶，可「開啟現有」或「仍要新增」
- 非阻擋式：同公司不同聯絡人等情況仍可強制新增

壓力測試（20 組不同狀態客戶）：
- 逾期/今日追蹤、冷掉/久未聯繫、置頂、多產業、報價/下訂/成交、
  生日活動、到期提醒等混合狀態
- 驗證：載入 215ms、統計數字正確、篩選/搜尋/看板分佈、重複偵測、
  行事曆標籤、.ics 匯出、業績加總、批次刪除、全程零 JS 錯誤

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 健檢修正：交車未歸檔提示、刪除客戶清除孤兒關聯

實際演練發現的兩個問題：
- 交車/下訂後業績表仍為空（歸檔是另一步、易忘）→ 客戶詳情成交歸檔區
  在有下訂/交車但未歸檔時顯示「立即歸檔」提示，一鍵帶入金額歸檔
- 刪除客戶後其生日/重要日子與未完成提醒仍留在行事曆變孤兒 →
  刪除客戶（單筆與批次）時一併清除關聯的活動與未完成提醒，各留墓碑同步

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 今日工作新增「久沒匯出」提醒

- 有「上次匯出後才新增/修改」的活動或提醒時，今日工作頂端顯示匯出提示
- 只在真的有新東西時提醒，沒新增就不會一直吵
- 提示可一鍵「匯出」（直接下載 .ics）或按 ✕ 暫時關閉（有更新的項目才再出現）
- 匯出/關閉狀態存 localStorage（本裝置對應本手機行事曆）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 介紹人改搜尋輸入；活動/提醒可匯出 .ics 到手機系統行事曆

介紹人（轉介紹）：
- 從下拉選單改為 ClientPicker 搜尋輸入，客戶量大也好找
- 排除客戶本人，不會把自己列為自己的介紹人

.ics 匯出（讓提醒真正發揮功效）：
- 新增 utils/ics.js 產生標準 iCalendar
- 行事曆頁「📲 匯出到手機行事曆」把活動與未完成提醒下載成 .ics
- 生日/紀念日用 RRULE:FREQ=YEARLY 每年自動重複；整天活動當天 9:00 提醒
- 定時活動前 30 分、計時提醒前 10 分以 VALARM 提醒
- 匯入 iPhone / Google 行事曆後靠手機原生提醒準時通知，
  繞過網頁 App 無法背景推播的限制
- 中文長行依 RFC5545 折行、特殊字元轉義，相容主流行事曆

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-18 — 關聯客戶改為輸入即時篩選（取代下拉選單）

- 新增共用 ClientPicker 元件：輸入姓名或電話即時篩選、鍵盤上下選取、
  已選顯示為可移除標籤，客戶量大也能快速找到人
- 行事曆活動的「關聯客戶」改用 ClientPicker
- 下拉浮層不影響版面、點元件外自動關閉

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 新增行事曆活動：點日期記生日/紀念日/重要日子（Google 日曆式）

- 資料層新增 events store（DB v5），納入雲端同步與每日保養範圍
- 行事曆點任一天「＋新增活動」可建活動：名稱、日期、時間、每年重複、關聯客戶、備註
- 每年重複的活動（生日/紀念日）每年同月日自動出現，並顯示「滿 N 年」
- 活動以文字標籤顯示於日曆日格；當日清單可點擊編輯/刪除，關聯客戶可一鍵跳轉
- 今日工作新增「今日活動」區塊，當天生日/重要日子一目了然
- 客戶詳情新增「生日 / 重要日子」區塊，可直接為該客戶記錄並每年提醒
- 取代隱晦的自訂欄位紀念日流程，讓記錄客戶生日變得直覺

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 報價單重新設計：專業排版取代陽春收據

- 深色信頭：報價單標題＋QUOTATION＋報價單編號（依單號固定）＋日期
- 客戶／業務專員雙欄署名，車型用金色左框標示
- 項目表加表頭，折抵項以綠色並標「折抵」，金額等寬對齊
- 總計改深色漸層金額帶，NT$ 金色點綴，更顯眼專業
- 分期試算改為金色卡片，月付與每月預估淨賺分層呈現
- 移除散落的 emoji（🚛🏛🏦💪），改用排版層次，截圖給客人更體面

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 產業下拉管理＋側欄篩選、客戶待辦獨立顯示、改名業務系統、Q版圖示、行事曆文字化

產業：
- 產業選項移到設定「🏭 產業選項」可增刪排序（存 settings，隨雲端同步）
- 新增/編輯客戶的產業改為下拉選單（不再自由填寫）
- 客戶頁側欄新增「產業」篩選分組，可依產業列出名單
- 相容早期自由填寫值：下拉與篩選會併入客戶既有產業

客戶待辦：
- 待辦事項從「即將簽約」（限置頂客戶）獨立成常駐區塊，未置頂也能新增/勾銷

品牌與介面：
- 系統更名「汽車銷售業務系統」→「業務系統」（標題/manifest/SW/通知/頁首）
- PWA 圖示改為 Q 版業務員（西裝領帶、莫蘭迪藍灰底），含 maskable 安全區版本
- 行事曆日格事件由彩色圓點改為文字標籤，一眼看清當天有誰要追蹤
- SW 快取升版 v2 並清除舊版，更名換圖示不留殘影

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 底層五年穩健化：同步大檔支援、每日資料保養、持久儲存

- 修復致命隱患：GitHub Contents API 超過 1MB 不回傳內容，
  資料累積數年後同步會永久壞死——加入 raw 媒體類型 fallback（支援到 100MB）
- 每日資料保養 housekeep：清過期墓碑（涵蓋未開同步情況）、
  刪 30 天前已完成待辦與已確認提醒，防止同步檔無限膨脹
- 啟動時申請 navigator.storage.persist()，空間吃緊時瀏覽器不得清掉資料庫
- 同步 401 改顯示「金鑰無效或已過期」友善訊息（金鑰效期最長一年，到期須換）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 新增桌面看板視圖與批次刪除客戶功能

- 客戶頁新增列表/看板切換（桌面限定，偏好記憶於 localStorage）
- 看板依業務進度分欄，卡片可拖曳換階段、點擊開右側詳情抽屜
- stageId 對不到的客戶落入「未分進度」補救欄
- 批次選取模式：全選（配合篩選）、勾選多筆、確認彈窗後一次刪除
- 批次刪除走既有墓碑機制，同步後其他裝置一併刪除
- 手機維持列表模式，看板切換鈕不顯示

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 📲 PWA 化＋到期提醒手機原生系統通知

- public/manifest.webmanifest + 三組圖示（含 maskable）+ sw.js：
  可「加入主畫面」變成真正的 App（全螢幕、獨立圖示）
- Service Worker 網路優先＋離線快取：有網路永遠拿最新版（不會卡舊版），
  斷網時用上次快取照常開啟；GitHub API 等外部請求原樣放行
- 到期提醒通知改走 SW showNotification（src/notify.js）：Android 從此可用
  （原本 new Notification 在 Android 直接失敗）、桌面通用；
  Android 安裝 PWA 後註冊 periodic background sync，關 App 也能背景檢查
- 設定 → 🔔 通知：權限狀態/一鍵開啟/發送測試通知/依裝置顯示
  加入主畫面教學（iPhone 需先加入主畫面才能收通知）
- 通知內容只含數量、不含客戶資料（隱私原則不變）
- file:// 雙擊單檔模式自動略過 SW 註冊，單檔用法不受影響

驗證：SW 註冊/manifest 圖示可取/到期提醒觸發系統通知（getNotifications）/
測試通知/斷網重載仍可開啟 5 項全過；smoke/feature/sync/loadspeed/coldstart
回歸全綠（離線冷啟動 164ms）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — ☁️ 手機↔電腦全自動雲端同步（GitHub 私人 repo 免費方案）

- src/sync.js 同步引擎：資料存使用者自己的 GitHub 私人 repo（data.json），
  變動後防抖 4 秒自動上傳；開啟/切回頁面/每 60 秒自動下載合併
- 逐筆「新的贏」合併（db.put 自動蓋 _ts）；刪除靠墓碑（tombstones，
  DB v4 新 store）不會被別台裝置的舊資料復活；上傳用 sha 樂觀鎖，
  衝突自動重拉合併重傳
- 設定 → ☁️ 雲端同步：內建 3 分鐘設定教學、貼金鑰啟用、狀態顯示、
  立即同步、中斷連線；金鑰只存本機 localStorage 不會上傳
- 啟用同步後今日工作的 7 天備份提醒不再顯示（資料已在雲端）
- 拒絕公開 repo（客戶資料保護）、檢查金鑰寫入權限

驗證：Playwright 模擬兩台獨立裝置共用攔截的 GitHub API——A 建客戶
B 自動收到、B 待辦 A 收到、刪除不復活、雙邊同時改逐筆合併、重整後
設定保留，7 項全過；既有 smoke/feature/blocked/coldstart/loadspeed
回歸全綠

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 移除 Google Fonts 外部下載，改用裝置內建字體，載入從數秒降到 0.2 秒

真正拖慢載入的元凶：index.html 每次開啟都以「render-blocking」方式
向 fonts.googleapis.com 下載 Noto Sans TC 繁中字體。繁中字體檔案龐大，
從台灣連 Google 字體伺服器又常常很慢甚至連不到，導致畫面一直等、
甚至打不開——這對號稱離線可用的單機系統是矛盾設計。

- 移除 index.html 的 Google Fonts <link> 與 preconnect
- 字體改為裝置內建繁中字體優先（iOS/macOS 蘋方、Windows 微軟正黑、
  Android 思源），全部免下載、瞬間顯示（index.css + tailwind.config.js）
- dist 現在完全無任何外部資源引用，真正離線可用

驗證：完全封鎖外部網路（模擬連不到 Google）下冷啟動仍在 166ms 內開啟，
外部請求 0 次；字體渲染正常，既有 smoke/feature 測試全數通過。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 修復:上一版的逾時保護機制自己造成資料庫連線卡死

上一版加的「開啟逾時就重開一次」邏輯有自我矛盾的 bug：如果單純是
第一次建立資料庫需要多一點時間（例如手機效能較慢），會被誤判成
「卡住」而另外再開一條連線，兩條連線互搶造成原本沒有的當機、
跳出「無法連接」錯誤——即使使用者完全沒開其他分頁。

修正為只維護單一連線，不因等待時間長短做任何猜測性重試；改用
IndexedDB 原生的 blocked 事件（只有真的被其他分頁的舊版連線擋住
時才會觸發）顯示提示，且該情況下連線仍會在背景繼續等待、對方
分頁一關閉就自動接續完成，不需使用者手動重新整理。

已用 6x CPU 節流模擬慢速手機驗證：全新資料庫首次建立耗時 13.6 秒
情況下不再誤判失敗；並驗證真正被擋住時 100ms 內自動恢復。

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 修復:IndexedDB 開啟卡死時永遠顯示載入中

- 開啟資料庫加入超時與重試(Safari 首次開啟無回應的 WebKit bug、
  同網域其他分頁佔用舊版本連線導致升級被 blocked 的情況)
- 全部嘗試失敗改為進入記憶體模式並顯示明確警告(可關閉其他分頁後
  重新整理恢復),不再無限轉圈
- 警告橫幅文字更新,說明原因與解法

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-17 — 待辦 @ 提及客戶＋全表單固定欄位標籤

- 今日工作待辦輸入 @ 彈出客戶選單（依姓名/電話過濾、方向鍵/Enter/Esc 操作），
  選擇後待辦連結該客戶，列表中 @客戶名 顯示強調色、點擊跳客戶詳情；
  tasks store 增加 clientId/clientName（免升版，備份自動涵蓋）
- 新增共用 Field 元件：欄位名稱固定顯示在輸入框上方，輸入內容後標題不再消失
- 套用範圍：新增客戶、客戶編輯（基本資料/轉介紹/意願度）、聯繫備註、
  業務事件內容與金額、即將簽約重點備註、計時提醒、時間軸編輯、
  報價單產生器（車型/項目/貸款試算/署名）、成交歸檔備註、設定報價選單表頭

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8


## 2026-07-16 — 遷移汽車銷售業務系統至專屬 repo（自 TEST@95d5021）

- 原始碼、交接文件、verify skill 自舊 repo leoliaoinfo-cpu/TEST
  分支 claude/caravan-truck-business-system-ul6st3 完整遷入
- deploy.yml 改為部署本 repo 的 GitHub Pages（main + 開發分支，
  enablement: true 自動啟用 Pages），不再與舊 repo 衝突
- HANDOFF.md 更新 repo/分支/部署資訊
- 補 .gitignore（node_modules、dist）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RBjrj2FhtszQs9j1B88ab8

