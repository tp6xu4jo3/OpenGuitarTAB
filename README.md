# OpenGuitarTAB

OpenGuitarTAB是吉他TAB編輯與共享平台。公開曲庫與登入後的個人曲譜改由Google Drive儲存，登入／Drive寫入透過Vercel Serverless Function處理，瀏覽器不再持有Google Drive API key或Drive寫入憑證。

## 帳號與曲庫邏輯

目前先提供兩個固定帳號，之後可替換成Google OAuth登入：

- `admin`：管理員。我的曲譜＝公共曲庫的實際Drive檔案。
- `test`：測試／遊客帳號。我的曲譜儲存在測試資料夾。

帳號密碼不寫進GitHub。請把密碼雜湊放在Vercel Environment Variables。

### 管理員

- 登入後「我的曲譜」直接顯示目前公共曲庫所有受管理曲譜。
- 儲存：直接更新同一個公共Drive檔案。
- 新增／匯入JSON：直接建立新的公共曲譜檔案。
- 刪除：直接刪除該公共Drive檔案。
- `⋯ → 隱藏`：檔案保留在管理員曲譜櫃，但公共曲庫不顯示；可再次取消隱藏。
- 不建立預設空白曲譜。

### test

- 私人測試曲譜資料夾：`1k11xZcK1irQ5fNtitcLHCq5sgAZoDW0g`
- 儲存：只更新測試資料夾中的同一個檔案。
- 上傳：發布到公共曲庫；第一次建立公共檔案，之後會記住公共file ID並更新同一個檔案，不重複建立。
- 從公共曲庫按「加入」：複製一份到test自己的Drive資料夾後再編輯。

> `test`資料夾目前依需求建立在公開`OpenTABs`資料夾下，因此它繼承公開讀取權限，只適合作為測試帳號。未來真實使用者資料應改成私人資料夾或各自Google OAuth授權。

## 未登入狀態

- 「我的曲譜」不顯示任何歌曲，只顯示登入按鈕。
- 點「個人曲譜櫃」會開啟置中的登入視窗。
- 公共曲庫與唯讀預覽仍可使用。
- 登入視窗目前使用帳號／密碼；Google登入按鈕的UI與設定開關已預留，`googleOAuthEnabled`目前為`false`。

## 新增曲譜

「我的曲譜」右側`＋`會先開啟選擇視窗：

- 空白曲譜 → 再選3拍或4拍。
- 上傳 → 選擇OpenGuitarTAB JSON。

舊版「直接把JSON丟到OpenTABs就自動公開」已取消。公共曲庫只接受目前既有受管理檔案，以及經網站管理員新增／使用者按「上傳」發布的檔案。

## 編輯器按鈕

- `儲存`：更新登入使用者自己的Drive檔案。
- `上傳`：發布／更新公共曲庫檔案。
  - admin：自己的Drive檔案本身就是公共檔案，因此等同更新公共版本。
  - test：使用已記錄的public file ID更新同一個公共檔案。

## 為什麼不能只用GitHub Pages

這個版本需要安全登入、HttpOnly session cookie，以及Google Drive建立／更新／刪除權限，因此需要server-side API。GitHub Pages仍可保存原始碼，但正式網站應部署到Vercel，讓靜態前端與`/api`同網域執行。

不要把密碼、密碼雜湊、Google Client Secret、refresh token或API key提交到GitHub。

## 環境變數

複製`.env.example`的欄位到Vercel Environment Variables：

```text
SESSION_SECRET
ADMIN_PASSWORD_HASH
TEST_PASSWORD_HASH
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
PUBLIC_DRIVE_FOLDER_ID
TEST_DRIVE_FOLDER_ID
```

目前資料夾：

```text
PUBLIC_DRIVE_FOLDER_ID=1_SZt4WOMakWa3aD54W2tYHtdOk44WUUP
TEST_DRIVE_FOLDER_ID=1k11xZcK1irQ5fNtitcLHCq5sgAZoDW0g
```

### admin/test密碼設為123

不要把`123`或固定SHA直接寫入repository。使用內建PBKDF2工具各產生一次不同salt的hash：

```bash
npm run hash-password -- 123
npm run hash-password -- 123
```

把兩次輸出分別設成：

```text
ADMIN_PASSWORD_HASH=<第一次輸出>
TEST_PASSWORD_HASH=<第二次輸出>
```

伺服器使用PBKDF2-HMAC-SHA256驗證，session則用`SESSION_SECRET`簽署並放在HttpOnly、Secure、SameSite=Lax cookie。

## Google Drive後端授權

網站使用的是「伺服器代表Drive擁有者」的Google OAuth refresh token，這與未來給一般使用者看的「使用Google登入」是兩件不同的事。

Vercel端需要：

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
```

這些只能存在Vercel環境變數，不得放在前端或GitHub。

## 目錄重點

```text
api/index.js                  # 登入session、Drive CRUD、公開/私人曲庫API
src/services/cloud-api.js     # 前端同網域API client
src/app-auth.js               # 登入視窗與session UI
src/config/app-config.js      # 未來Google登入功能開關
scripts/hash-password.mjs     # 產生PBKDF2密碼hash
```

舊的`src/config/drive-config.js`及前端Drive API key讀取流程已移除。

## 測試

```bash
npm test
```

## 部署

建議直接將此repository匯入Vercel。Vercel會提供靜態檔案並將`api/index.js`部署成Serverless Function，因此前端呼叫`/api`可保持同網域。
