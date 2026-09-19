# OpenGuitarTAB

OpenGuitarTAB是吉他TAB編輯與共享平台。公開曲庫與登入後的個人曲譜由Google Drive儲存，登入與Drive寫入透過Vercel Serverless Function處理，瀏覽器不持有Drive寫入憑證。

## 帳號

目前先提供兩個固定帳號，未來可替換成Google OAuth登入：

- `admin`：管理員。
- `test`：測試／遊客帳號。

帳號密碼不寫進GitHub；密碼雜湊與Google憑證放在Vercel Environment Variables。

## 曲譜權限模型

每首曲譜只保留一個真正的Drive JSON，權限由`_opentab`管理：

```json
{
  "_opentab": {
    "owner": "test",
    "uploadedBy": "test",
    "updatedBy": "admin",
    "public": true,
    "publishedAt": 1780000000000
  }
}
```

- `owner`：曲譜擁有者，建立後不可被前端或管理員改寫。
- `uploadedBy`：公共曲庫顯示「由誰上傳」，公開後固定為owner。
- `updatedBy`：最後修改曲譜的人。
- `public`：是否出現在公共曲庫。
- `publishedAt`：曾經發布過的標記；下架後仍保留，因此可以重新上架。

後端才是權限的最終判斷來源，不信任前端送來的`owner`。

### 權限規則

| 操作 | owner | admin管理別人的已發布曲譜 | 其他使用者 |
| --- | --- | --- | --- |
| 預覽公共曲譜 | ✅ | ✅ | ✅ |
| 編輯原檔 | ✅ | ✅ | ❌ |
| 下架／重新上架 | ✅ | ✅ | ❌ |
| 刪除原始檔 | ✅ | ❌ | ❌ |

admin編輯test曲譜時，`owner=test`與「由test上傳」都不會改變，只會把`updatedBy`記成`admin`。

## Drive配置

```text
OpenTABs（公共／admin）
└─ admin建立的JSON

OpenTABs/test
└─ test建立的JSON
```

### admin

- 新增／匯入JSON：建立在公共資料夾，預設`public=true`。
- 儲存：更新同一個Drive檔案。
- 下架：只把`public=false`，不刪除JSON。
- 重新上架：把同一個JSON改回`public=true`。
- 可編輯／下架test已發布過的曲譜，但不能刪除test原檔。

### test

- 新增／匯入JSON：只建立在test資料夾，預設`public=false`。
- 儲存：永遠更新test資料夾中的同一個JSON。
- 上傳：直接把該JSON設成`public=true`，不再建立第二份Public JSON。
- 下架：同一個JSON改成`public=false`。
- 刪除：只有test本人可以刪除自己的原始JSON。
- 從別人的公共曲譜按「加入」：建立一份新的test私人副本。

> `test`資料夾目前位於`OpenTABs`下面，只適合作為測試帳號。未來真正多使用者應改成私人使用者資料夾或各自Google OAuth授權。

## 公共曲庫UI

公共卡片會顯示「由xxx上傳」。

- 未登入／非owner：只有預覽與加入。
- owner看到自己的公共譜：右上角`⋯`提供「編輯／下架」。
- admin看到test公共譜：右上角`⋯`提供「編輯／下架」，沒有刪除。
- admin自己的公共譜：同樣在公共卡片只提供「編輯／下架」。
- 真正「刪除」只放在「我的曲譜」，而且只有owner看得到。
- 已下架曲譜不出現在公共曲庫，但owner與admin仍能在「我的曲譜」重新上架。

## 未登入狀態

- 「我的曲譜」不顯示任何歌曲，只顯示登入按鈕。
- 點「個人曲譜櫃」會開啟置中的登入視窗。
- 公共曲庫與唯讀預覽仍可使用。
- Google登入UI已預留，但`googleOAuthEnabled`目前為`false`。

## 編輯器

- `儲存`：更新目前原始Drive JSON。
- `上傳`：將目前原始JSON發布／重新發布到公共曲庫，不複製第二份檔案。

## 為什麼需要Vercel

這個版本需要安全登入、HttpOnly session cookie，以及Google Drive建立／更新／刪除權限，因此需要server-side API。GitHub負責原始碼與版本管理；Vercel負責正式網站與`/api`Serverless Function。

## 環境變數

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

密碼hash可用：

```bash
npm run hash-password -- 123
```

Google Drive後端refresh token可用：

```bash
npm run drive-auth
```

不要把密碼、密碼hash、Google Client Secret、refresh token或API key提交到GitHub。

## 主要檔案

```text
api/index.js                       # session、Drive CRUD與後端權限
src/core/song-permissions.js       # owner/admin權限規則
src/services/cloud-api.js          # 前端同網域API client
src/app-auth.js                    # 登入UI
src/app-library.js                 # 我的曲譜權限UI
src/app-catalog.js                 # 公共曲庫與管理選單
```

## 測試

```bash
npm test
npm run check
```

## 部署

Repository連接Vercel後，`main`部署為Production，其他branch／PR部署為Preview。Vercel提供靜態前端並將`api/index.js`部署為Serverless Function。
