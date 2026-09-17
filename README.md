# OpenGuitarTAB

OpenGuitarTAB是純前端吉他TAB編輯與共享平台，可直接部署至GitHub Pages。

## 目前完成

### Phase 1 — Pure Client-Side
- 完全移除Node.js後端與`/api/library`依賴
- `src/core/song-codec.js`負責`sparse-v3`與編輯器資料雙向轉換
- localStorage作為本機個人曲譜儲存
- 單曲JSON匯入與下載
- 公共曲譜改為`public/catalog/songs/<id>.json`
- `public/catalog/index.json`作為輕量曲庫索引
- CSS依功能模組化

### Phase 2 — Catalog UI（進行中）
- Spotify風格深色導覽與曲譜卡片
- `#/catalog`公共曲庫首頁
- 公共曲譜搜尋
- 公共曲譜唯讀預覽
- 一鍵加入個人曲譜櫃
- `#/library`個人曲譜櫃
- `#/editor/:id`編輯器Hash路由

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

目前不需要Node.js後端或Vercel，GitHub Pages可直接部署此repository。
