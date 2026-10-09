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

不用設：`NODE_ENV`（Application mode 選 Production 會自動設）、`PORT`（Passenger 提供）。**主機上絕對不要設 `MAIL_DEV_LOG`**，設了驗證碼就不會寄出。

兩種設定方式都吃得到：
- **cPanel 介面（建議）**：在 Setup Node.js App 頁面逐一新增，重新上傳程式不會被覆蓋。
- **`.env` 檔**：放在應用程式根目錄（跟 `server.cjs` 同層）。程式從這個固定位置讀，不受啟動目錄影響；網站只送出 `public/`，所以 `.env` 不會被網路存取到。值裡有 `#` 或空白要用雙引號包起來。

同一個變數兩邊都有時，以 cPanel 介面的為準。改完參數要按 **Restart** 才會生效。

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
