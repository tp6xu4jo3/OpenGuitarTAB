# OpenGuitarTAB

OpenGuitarTAB是純前端吉他TAB編輯與共享平台，可直接部署至GitHub Pages。

## 目前完成

### Phase 1 — Pure Client-Side
- 完全移除Node.js後端與`/api/library`依賴
- `src/core/song-codec.js`負責`sparse-v3`與編輯器資料雙向轉換
- localStorage作為本機個人曲譜儲存
- 單曲JSON匯入與下載
- 公共曲譜資料已搬到Google Drive公開資料夾
- CSS依功能模組化

### Phase 2 — Catalog UI
- Spotify風格深色導覽與曲譜卡片
- `#/catalog`公共曲庫首頁
- 公共曲譜搜尋
- 公共曲譜唯讀預覽
- 一鍵加入個人曲譜櫃
- `#/library`個人曲譜櫃
- `#/editor/:id`編輯器Hash路由
- 編輯器／播放／曲庫／Catalog程式模組化

### Phase 3 — Public Google Drive Catalog
- 暫不加入Google OAuth
- 公共曲庫改由Google Drive API讀取
- 固定公開資料夾ID：`1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP`
- 前端使用受HTTP參照網址與Google Drive API限制的API key
- 啟動時直接列出Drive資料夾中的所有`application/json`檔案
- `index.json`會被排除，不再作為新增歌曲的必要索引
- 每個歌曲JSON會直接解析`id`、`name`、`artist`、`album`、`cover`、`tempo`、`capo`、`beatsPerMeasure`
- 新增歌曲只要把有效的歌曲JSON上傳到`OpenTABs`資料夾，重新整理網站後就會自動出現在公共曲庫
- 單一JSON格式錯誤時只略過該檔案，不會讓整個公共曲庫失效
- 現有`index.json`只保留作為舊曲目的metadata／排序相容性fallback，不需要再手動更新
- 預覽／加入曲譜時使用Drive `files.get?alt=media`讀取JSON
- 個人曲譜仍使用localStorage，不做Google登入或雲端同步

## 新增公共曲譜

1. 準備一個有效的OpenGuitarTAB歌曲JSON。
2. 直接上傳到Google Drive的`OpenTABs`資料夾。
3. 不需要修改`index.json`。
4. 重新整理網站，歌曲就會自動被Drive API掃描並加入公共曲庫。

建議歌曲JSON本身包含以下metadata，這樣不依賴任何外部索引也能完整顯示卡片：

```json
{
  "id": "song-example",
  "name": "歌曲名稱",
  "artist": "歌手",
  "album": "專輯",
  "cover": "https://...",
  "tempo": 120,
  "capo": 0,
  "beatsPerMeasure": 4,
  "rows": []
}
```

`artist`、`album`、`cover`不是載入曲譜的必要欄位；缺少時仍可顯示與預覽，只是卡片資訊較少。

## Google Drive設定

Drive設定位於：

```text
src/config/drive-config.js
```

設定內容包含：

```js
export const DRIVE_CATALOG_CONFIG = Object.freeze({
  folderId: '1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP',
  apiKey: '<Google Drive API key>',
  apiBaseUrl: 'https://www.googleapis.com/drive/v3'
});
```

API key應限制為：

- 應用程式限制：HTTP參照網址（網站）
- 允許GitHub Pages網站來源
- API限制：只允許Google Drive API

Drive公共曲庫資料夾應設為：

```text
知道連結的任何人 → 檢視者
```

不要設為編輯者，因為公共網站只需要讀取JSON。

## 本機預覽

```bash
python -m http.server 8080
```

開啟`http://localhost:8080/`。

若API key只允許正式GitHub Pages網址，本機`localhost`預覽Drive曲庫會被Google拒絕；若需要本機測試，可暫時將本機來源加入HTTP參照網址限制，測試完成後再移除。

## 測試

```bash
npm test
```

## 部署

不需要Node.js後端或Vercel，GitHub Pages可直接部署此repository。
