# culture.machine 文化扭蛋機

Node.js 22 + Express 5 + MySQL，前端 React + Vite。設計決定見上一層的 `DECISIONS.md`。

```
server.cjs          cPanel 的 Application startup file（Passenger 用 require 載入，再轉交 app.js）
app.js              主程式
server/             API：auth（Email 驗證碼）、admin（後台）、participant（基本資料、投蛋、抽蛋）、public-api（QR 落地頁）
server/schema.sql   資料表，啟動時自動建立（CREATE TABLE IF NOT EXISTS）
web/                React 原始碼，build 到 ../public
public/             build 產物，由 Express 送出（不進版控）
scripts/e2e-draw.mjs  參與者流程與併發抽蛋的端到端測試（只能對本機跑，會清空本機資料）
```

## 本機開發

### 需要的東西

- **Node.js 22**（跟主機一致）。專案有 `.nvmrc`，用 fnm 的話 `cd` 進來會自動切到 22：

  ```bash
  brew install fnm
  echo 'eval "$(fnm env --use-on-cd)"' >> ~/.zshrc && source ~/.zshrc
  fnm install 22
  ```

  本機用更新版 Node 也能跑，但可能不小心用到 22 沒有的功能，上主機才壞。
- **Docker Desktop**：跑本機 MySQL。

### 第一次設定

```bash
npm install && npm --prefix web install
docker compose up -d
```

`.env` 是本機設定，已對應 `docker-compose.yml` 的資料庫；沒有的話從 `.env.example` 複製再填。它不會被部署（`.gitignore` 排除，部署 zip 也不包含）。

| 本機設定 | 值 |
|---|---|
| 資料庫 | `127.0.0.1:33306`，資料庫、帳號、密碼都是 `culture` |
| 管理者 | `admin@test.com` |
| 寄信 | `MAIL_DEV_LOG=1`：不寄信，驗證碼印在後端終端機 |

### 每天開發

開兩個終端機：

```bash
npm run dev                 # 終端機 1：後端 http://localhost:3000，改檔自動重啟，驗證碼印在這裡
npm --prefix web run dev    # 終端機 2：前端 http://localhost:5173，/api 自動轉給 3000
```

打開 http://localhost:5173/login，輸入 `admin@test.com`，到終端機 1 找「你的登入驗證碼是 xxxxxx」，輸入後就能進後台。

### 測試

後端開著（`npm run dev`）時執行：

```bash
node scripts/e2e-draw.mjs
```

會跑完登入、基本資料、投蛋、抽蛋、特別蛋備援、每人上限、輪次結束，以及 30 人同時抽蛋的併發檢查（沒有蛋被抽兩次、沒人抽到自己、雙擊不會多扣資格）。**它會清空本機資料庫**，而且拒絕對非本機的伺服器或資料庫執行。

### 本機資料庫

資料表不用手動建，後端啟動時會照 `server/schema.sql` 自動建立。資料存在 Docker volume 裡，重開機也會保留；Docker Desktop 開著時資料庫會自動啟動。

在 `culture.machine/` 裡執行：

| 要做什麼 | 指令 |
|---|---|
| 啟動 | `docker compose up -d` |
| 停止（資料保留） | `docker compose stop` |
| 清空資料重來 | `docker compose down -v` |
| 進資料庫下 SQL | `docker exec -it culture-machine-mysql mysql -uculture -pculture culture` |

用 GUI（TablePlus、DBeaver 等）：連 `127.0.0.1`、port `33306`，帳號密碼都是 `culture`。

本機資料庫故意設成美東時區，模擬 A2 主機；程式每條連線都強制用 UTC，所以時間不會錯。

## 部署到 cPanel

1. 本機 build：`npm run build`（產生 `public/`）。
2. 打包上傳這些：`server.cjs`、`app.js`、`package.json`、`server/`、`public/`。不要上傳 `node_modules`、`web/`。
3. cPanel → **MySQL Databases**：建資料庫、使用者，把使用者加進資料庫並給 ALL PRIVILEGES。
4. cPanel → **Domains**：建子網域（例如 `culture.inwave-studio.com`）。
5. cPanel → **Setup Node.js App** → Create：
   - Node.js version：22
   - Application mode：Production
   - Application root：上傳的資料夾（放在家目錄，不要放在 `public_html` 裡）
   - Application URL：子網域，路徑留空
   - Application startup file：`server.cjs`（不要填 app.js，Passenger 會載入失敗）
   - Environment variables：照 `.env.example`（`MAIL_DEV_LOG` 不要設）
6. 按 **Run NPM Install**，再按 **Restart**。
7. 打開 `https://子網域/api/health`，看到 `"ok": true` 和資料庫版本就代表成功。
8. 打開 `https://子網域/login`，用 `ADMIN_EMAILS` 裡的信箱登入後台，到「寄信測試」寄一封信給自己。

更新程式：本機 build，上傳覆蓋 `server/`、`public/`、`app.js`、`server.cjs`，在 Setup Node.js App 按 Restart。有改 `package.json` 才需要再按 Run NPM Install。

rm -f ../culture.machine-deploy.zip
zip -rq ../culture.machine-deploy.zip server.cjs app.js package.json server public -x "*.DS_Store"

### 主機上的環境變數

| 變數 | 填什麼 | 從哪裡來 |
|---|---|---|
| `DB_HOST` | `localhost` | 固定 |
| `DB_PORT` | `3306` | 固定 |
| `DB_NAME` | 例如 `inwave_culture` | MySQL Databases，**含帳號前綴** |
| `DB_USER` | 例如 `inwave_culture` | MySQL Databases，**含帳號前綴** |
| `DB_PASSWORD` | 資料庫使用者密碼 | MySQL Databases |
| `ADMIN_EMAILS` | 管理者信箱，逗號分隔 | 自己決定 |
| `SMTP_HOST` | 例如 `mail.inwave-studio.com` | Email Accounts → Connect Devices |
| `SMTP_PORT` | `465` | Email Accounts → Connect Devices |
| `SMTP_USER` | `noreply@inwave-studio.com`（完整信箱） | Email Accounts |
| `SMTP_PASSWORD` | 信箱密碼 | Email Accounts |
| `SMTP_FROM` | `文化扭蛋機 <noreply@inwave-studio.com>` | 寄件人顯示名稱 |
| `LINE_CHANNEL_ID` | LINE Login channel 的 Channel ID | LINE Developers → channel → Basic settings |
| `LINE_CHANNEL_SECRET` | LINE Login channel 的 Channel secret | 同上 |
| `LINE_CALLBACK_URL` | 選填，例如 `https://culture-machine.org/api/auth/line/callback` | 不填就用目前網址自動組出來；要跟 LINE Developers 登記的 Callback URL 完全一樣 |

| `LOAD_TEST` | 只有壓測時設 `1` | 開啟壓測 API（見下方「壓力測試」）；Production 模式下設了也不會開，測完拿掉 |
| `DRAW_NOTIFY_MAIL` | 選填，`1` = 被抽中時寄信通知投蛋的人 | 預設不寄（decision 35）；壓測時一定不要設 |

`LINE_CHANNEL_ID` 和 `LINE_CHANNEL_SECRET` 沒設時，登入頁不會出現 LINE 按鈕，只剩 Email 登入。

`LINE_AUTHORIZE_URL`、`LINE_API_BASE` 只給 `scripts/e2e-line.mjs` 測試用，正式模式下會被忽略，主機上不要設。

不用設：`NODE_ENV`（Application mode 選 Production 會自動設）、`PORT`（Passenger 提供）。**主機上絕對不要設 `MAIL_DEV_LOG`**，設了驗證碼就不會寄出。

兩種設定方式都吃得到：
- **cPanel 介面（建議）**：在 Setup Node.js App 頁面逐一新增，重新上傳程式不會被覆蓋。
- **`.env` 檔**：放在應用程式根目錄（跟 `server.cjs` 同層）。程式從這個固定位置讀，不受啟動目錄影響；網站只送出 `public/`，所以 `.env` 不會被網路存取到。值裡有 `#` 或空白要用雙引號包起來。

同一個變數兩邊都有時，以 cPanel 介面的為準。改完參數要按 **Restart** 才會生效。

### 壓力測試：多人同時搶扭蛋

測的是「很多人同時抽的時候，規則還對不對」：同一顆蛋不會被兩人抽到、不會抽到自己的、連按兩次只扣一次。走的是真正的抽蛋 API，速度只記錄、不當通過標準。

1. **選正式站沒有活動的時間**：測試站和正式站在同一個 cPanel 帳號，共用資源。
2. 測試站的 Setup Node.js App 加環境變數 `LOAD_TEST=1`，確認 `DRAW_NOTIFY_MAIL` 沒設，按 Restart。
3. 用管理者帳號登入測試站後台，從瀏覽器開發者工具 → Application → Cookies 複製 `cm_session` 的值。
4. 在本機執行（會要你貼上 `cm_session`，不會顯示也不會存檔）：
   ```bash
   node scripts/load-draw.mjs --base https://dev.culture.machine.inwave-studio.com --mode drain
   node scripts/load-draw.mjs --base https://dev.culture.machine.inwave-studio.com --mode timed --duration 20
   ```
   跑的時候同時開著後台「系統狀態」頁和 cPanel 的 Resource Usage。
5. 測完把 `LOAD_TEST` 拿掉，按 Restart。

| 參數 | 預設 | 說明 |
|---|---|---|
| `--mode` | `drain` | `drain` 量 200 顆全部抽完要幾秒（目標 60 秒）；`timed` 量固定秒數內成功幾次 |
| `--concurrency` | 5 | 同時幾條連線在搶 |
| `--duration` | 20 | `timed` 模式的秒數 |
| `--users` | 200 | 測試帳號數（每人投 1 顆） |
| `--double-tap` | 0.15 | 有多少比例的人同時按兩次 |

腳本會先請伺服器建一個「【壓測】」QR 點位、200 個 `@loadtest.invalid` 測試帳號和它們的登入狀態（1 小時過期），不碰真實資料。正式站網址會被腳本直接拒絕。

**測完資料會保留**，可以到後台「活動」看「【壓測】多人搶扭蛋」的每一筆抽取。看完自己清除，下一次壓測前也一定要先清除：
```bash
node scripts/load-draw.mjs --base https://dev.culture.machine.inwave-studio.com --cleanup
```
真正的活動或 QR 點位，名稱不要用「【壓測】」開頭，清除時會被當成測試資料刪掉。

### SSL 憑證

用 cPanel 的 **AutoSSL**（Let's Encrypt 或 Sectigo 簽發的正式憑證，免費、自動續約，不是 self-signed）。**登入前一定要先有 SSL**：正式模式下登入 cookie 只走 HTTPS，沒有 SSL 會一直登不進去。

1. **確認子網域指向主機**：DNS 由這個 cPanel 管理的話，建子網域時就自動加好了。DNS 在別處（Cloudflare 等）時，自己加一筆 A 紀錄 `culture` → 主機 IP（cPanel 首頁的 Shared IP Address）；Cloudflare 要先關掉橘雲（DNS only）。可用 `dig +short culture.inwave-studio.com` 檢查。
2. cPanel → **SSL/TLS Status** → 勾選子網域 → **Run AutoSSL**，等幾分鐘出現綠色鎖頭。
3. cPanel → **Domains** → 子網域打開 **Force HTTPS Redirect**。
4. 瀏覽器點網址列的鎖頭確認簽發者是 Let's Encrypt／Sectigo／cPanel CA。

AutoSSL 失敗多半是 DNS 沒指對、剛加的紀錄還沒生效，或 Cloudflare 橘雲沒關。`www.` 開頭用不到的子網域失敗沒關係。

### 出問題時

| 症狀 | 原因 |
|---|---|
| health 顯示 `ER_ACCESS_DENIED_ERROR` | 帳密錯，或使用者沒加進資料庫、沒給權限 |
| health 顯示 `ER_BAD_DB_ERROR` | `DB_NAME` 少了帳號前綴 |
| 驗證碼正確但一直沒登入 | SSL 還沒好 |
| 寄信 `EAUTH` | `SMTP_USER` 沒填完整信箱，或密碼錯 |
| 寄信 `ETIMEDOUT` | Port 錯，465 不行試 587 |
| 寄信出現 certificate／hostname 錯誤 | `mail.` 子網域沒有憑證；`SMTP_HOST` 改用 Connect Devices 上寫的主機名稱 |
| 網頁顯示 Passenger error | 看應用程式目錄裡的 `stderr.log` |
