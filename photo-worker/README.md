# 客戶照片跨裝置 Worker（Cloudflare R2）

這個 Worker 是 PWA 與 Cloudflare R2 之間的受保護通道。照片本體只進 R2；GitHub 私人資料庫的 `data.json` 只同步 `photoMeta` 小型索引與離線刪除佇列，不包含 Blob 或 base64 圖片。

## 第一次部署

1. 在 Cloudflare 建立 R2 bucket `car-client-photos`（改名時也要同步修改 `wrangler.jsonc`）。
2. 在本目錄執行 `npm install`，再執行 `npx wrangler login`。
3. 產生至少 24 字元的隨機金鑰，執行 `npx wrangler secret put PHOTO_SYNC_KEY` 後貼上；金鑰不可寫入 repo。
4. 確認 `wrangler.jsonc` 的 `ALLOWED_ORIGINS` 包含正式 PWA origin，再執行 `npm run deploy`。
5. 把部署完成的 `https://...workers.dev` 網址及同一把金鑰，填到 PWA「設定 → 雲端同步 → 照片跨裝置」。

本機開發可建立不提交 Git 的 `.dev.vars`：

```text
PHOTO_SYNC_KEY="至少 24 字元的測試金鑰"
```

## 驗證

```bash
npm test
npm run dev
```

API：`GET /v1/health`，以及 `PUT|GET|DELETE /v1/photos/:clientId/:photoId`。所有正式 API 都需要 `Authorization: Bearer <PHOTO_SYNC_KEY>`；單張上限 15 MB。
