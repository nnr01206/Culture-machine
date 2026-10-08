#!/usr/bin/env bash
# Sends N test mails through the deployed admin mail-test endpoint, to find the host's SMTP limit.
# Usage: bash scripts/mail-test.sh            (prompts for everything)
#        COUNT=50 DELAY=2 bash scripts/mail-test.sh
set -u

BASE_URL="${BASE_URL:-https://dev.culture.machine.inwave-studio.com}"
COUNT="${COUNT:-200}"
DELAY="${DELAY:-1}"   # seconds between mails

read -r -s -p "cm_session（登入後台後，從瀏覽器 cookie 複製，輸入時不會顯示）: " SESSION; echo
[ -z "${SESSION}" ] && { echo "沒有輸入 cm_session"; exit 1; }
read -r -p "收件 Email: " TO
[ -z "${TO}" ] && { echo "沒有輸入收件 Email"; exit 1; }

echo
echo "目標：${BASE_URL}/api/admin/mail-test"
echo "寄給：${TO}，共 ${COUNT} 封，每封間隔 ${DELAY} 秒"
read -r -p "確定開始？(y/N) " OK
[ "${OK}" = "y" ] || { echo "取消"; exit 0; }

ok=0; fail=0; first_fail=""
start=$(date +%s)
for i in $(seq 1 "${COUNT}"); do
  resp=$(curl -sS --max-time 30 -w $'\n%{http_code}' \
    -X POST "${BASE_URL}/api/admin/mail-test" \
    -H 'content-type: application/json' \
    -H "cookie: cm_session=${SESSION}" \
    --data "{\"to\":\"${TO}\"}" 2>&1)
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  if [ "${code}" = "200" ] && [[ "${body}" == *'"ok":true'* ]]; then
    ok=$((ok + 1))
    printf '[%3d/%d] OK\n' "${i}" "${COUNT}"
  else
    fail=$((fail + 1))
    printf '[%3d/%d] FAIL  HTTP %s  %s\n' "${i}" "${COUNT}" "${code}" "${body}"
    [ -z "${first_fail}" ] && first_fail="第 ${i} 封：HTTP ${code} ${body}"
    if [ "${code}" = "401" ]; then
      echo "cm_session 無效或過期（管理者登入只維持 1 天），停止。"
      break
    fi
  fi
  [ "${i}" -lt "${COUNT}" ] && sleep "${DELAY}"
done

echo
echo "=== 結果 ==="
echo "成功：${ok}　失敗：${fail}　耗時：$(( $(date +%s) - start )) 秒"
[ -n "${first_fail}" ] && echo "第一次失敗：${first_fail}"
echo "成功代表主機 SMTP 收下了，不代表已送達；請到收件匣（和垃圾信匣）數實際收到幾封。"
