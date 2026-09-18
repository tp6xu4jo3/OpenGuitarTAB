# OpenGuitarTAB

OpenGuitarTAB是純前端吉他TAB編輯與共享平台，可直接部署至GitHub Pages。

## 目前架構

### 個人曲譜
- localStorage作為目前個人曲譜儲存
- 單曲JSON匯入與下載
- 暫不加入Google OAuth

### 公共曲庫
- 公共曲譜JSON改存放於Google Drive公開資料夾
- Drive資料夾ID：`1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP`
- `index.json`保留公共曲譜的名稱、作者、封面、BPM、Capo等索引資訊
- 網站透過Google Drive API列出資料夾內容，再依檔名將`index.json`項目對應至Drive檔案ID
- 預覽或加入個人曲譜櫃時，使用Drive API `files.get?alt=media`讀取對應JSON
- 不需要Google OAuth；公開資料夾使用Google Drive API key存取

## Google Drive API key設定

編輯`src/config/drive-config.js`：

```js
export const DRIVE_CATALOG_CONFIG = Object.freeze({
  folderId: '1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP',
  apiKey: '你的Google Drive API key',
  apiBaseUrl: 'https://www.googleapis.com/drive/v3'
});
```

Google Cloud端需要：
- 啟用Google Drive API
- 建立API key
- 將API key限制為Google Drive API
- 將網站限制設定為實際GitHub Pages／Vercel網域

這個階段不需要OAuth Client ID，也不需要使用者登入Google帳號。

## Drive資料夾內容

Drive根目錄目前採用：

```text
OpenTABs/
├─ index.json
├─ song-*.json
└─ seed-uploaded-image-draft-v1.json
```

`index.json`中的`file`仍可保留原本`./songs/<filename>.json`格式；程式只取最後的檔名，再對應Drive資料夾內同名檔案。

## 已完成

- `src/core/song-codec.js`負責`sparse-v3`與編輯器資料雙向轉換
- localStorage個人曲譜儲存
- Spotify風格公共曲庫與曲譜卡片
- 公共曲譜搜尋
- 公共曲譜唯讀預覽
- 一鍵加入個人曲譜櫃
- Hash路由
- Google Drive公共曲庫資料來源

## 延後階段

Google OAuth／Google Identity Services暫不加入。未來若需要「每位使用者自己的Drive同步」，再加入：
- Google Identity Services登入
- Google Drive `drive.file`授權
- 個人曲譜一歌一JSON同步
- localStorage離線快取與雲端同步
- 衝突處理

## 本機預覽

```bash
python -m http.server 8080
```

開啟`http://localhost:8080/`。

## 測試

```bash
npm test
```

## 部署

公共曲庫Drive API key設定完成後，不需要Node.js後端；GitHub Pages可直接部署此repository。
