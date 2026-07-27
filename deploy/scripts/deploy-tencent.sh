#!/usr/bin/env bash
# deploy-tencent.sh — kari-imprint 部署脚本（for baka-akari.zone Caddy stack）
#
# 与 site-analytics 相同风格：ubuntu 用户 + uv venv + 127.0.0.1 反代 + Caddyfile 追加
#
# 用法:
#   bash deploy/scripts/deploy-tencent.sh          # 完整部署
#   bash deploy/scripts/deploy-tencent.sh code     # 仅同步代码 + 重启后端
#   bash deploy/scripts/deploy-tencent.sh web      # 仅同步前端 dist
#   bash deploy/scripts/deploy-tencent.sh caddy    # 仅更新 Caddyfile
#   bash deploy/scripts/deploy-tencent.sh check    # 部署后健康检查

set -euo pipefail

REMOTE="tencent-ubuntu"
DOMAIN="baka-akari.zone"
URL_PREFIX="/tools/kari-imprint"
PORT="21832"

REMOTE_CODE_DIR="/opt/kari-imprint"
REMOTE_WEB_DIR="/var/www/personal-home/tools/kari-imprint"
REMOTE_DATA_DIR="/var/lib/kari-imprint"
LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}   $*"; }
err()  { echo -e "${RED}[err]${NC}    $*" >&2; exit 1; }

STEP="${1:-all}"

deploy_web() {
    log "[web] 本地构建（VITE_API_BASE=${URL_PREFIX} VITE_PUBLIC_BASE=${URL_PREFIX}）"
    (cd "${LOCAL_DIR}/apps/web" && VITE_API_BASE="${URL_PREFIX}" VITE_PUBLIC_BASE="${URL_PREFIX}" npm run build)

    log "[web] 远端准备目录"
    ssh "${REMOTE}" "sudo mkdir -p '${REMOTE_WEB_DIR}' && sudo chown -R www-data:www-data '${REMOTE_WEB_DIR}'"

    log "[web] rsync dist -> ${REMOTE_WEB_DIR}/"
    rsync -avz --delete \
        --rsync-path="sudo rsync" \
        "${LOCAL_DIR}/apps/web/dist/" \
        "${REMOTE}:${REMOTE_WEB_DIR}/"

    log "[web] 修正 ownership（www-data，Caddy 需要读）"
    ssh "${REMOTE}" "sudo chown -R www-data:www-data '${REMOTE_WEB_DIR}'"
}

deploy_code() {
    log "[code] 远端准备目录（ubuntu 拥有）"
    ssh "${REMOTE}" "sudo mkdir -p '${REMOTE_CODE_DIR}' '${REMOTE_DATA_DIR}'/{uploads,outputs,tmp,resources/logo,resources/signature} && sudo chown -R ubuntu:ubuntu '${REMOTE_CODE_DIR}' '${REMOTE_DATA_DIR}'"

    log "[code] rsync 源码 -> ${REMOTE_CODE_DIR}/"
    # 只同步运行时需要的部分。剔除：git、venv、node_modules、pycache、web 前端 src（web 走 dist 通道）、tests（部署不需要）、dist（前端产物已上）
    rsync -avz --delete \
        --exclude='.git' \
        --exclude='.venv' \
        --exclude='node_modules' \
        --exclude='__pycache__' \
        --exclude='*.pyc' \
        --exclude='.DS_Store' \
        --exclude='*.log' \
        --exclude='apps/web/dist' \
        --exclude='apps/web/node_modules' \
        --exclude='apps/web/src' \
        --exclude='apps/web/public' \
        --exclude='apps/web/scripts' \
        --exclude='apps/api/tests' \
        --exclude='packages/kari-core/tests' \
        --exclude='RENAME_BRIEF.md' \
        --exclude='RENAME_REPORT.md' \
        --exclude='design/' \
        --exclude='docs/archive/' \
        "${LOCAL_DIR}/" "${REMOTE}:${REMOTE_CODE_DIR}/"

    log "[code] 远端 uv sync（runtime deps only，不含 dev）"
    ssh "${REMOTE}" "cd '${REMOTE_CODE_DIR}' && /home/ubuntu/.local/bin/uv sync --all-packages --no-dev"

    log "[code] 上传 systemd unit"
    scp "${LOCAL_DIR}/deploy/kari-imprint.service" "${REMOTE}:/tmp/kari-imprint.service"
    ssh "${REMOTE}" "sudo mv /tmp/kari-imprint.service /etc/systemd/system/kari-imprint.service && sudo systemctl daemon-reload"

    log "[code] enable + restart 服务"
    ssh "${REMOTE}" "sudo systemctl enable kari-imprint.service && sudo systemctl restart kari-imprint.service && sleep 2 && systemctl is-active kari-imprint.service"

    log "[code] 后端本地端口自检（127.0.0.1:${PORT}/tools/kari-imprint/api/health）"
    ssh "${REMOTE}" "curl -sS -o /dev/null -w 'local:%{http_code}\n' http://127.0.0.1:${PORT}${URL_PREFIX}/api/health"
}

deploy_caddy() {
    log "[caddy] 备份当前 Caddyfile"
    ssh "${REMOTE}" "sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.\$(date +%Y%m%d_%H%M%S)"

    log "[caddy] 检查是否已配置 /tools/kari-imprint 路由"
    if ssh "${REMOTE}" "grep -q 'tools/kari-imprint' /etc/caddy/Caddyfile"; then
        warn "Caddyfile 里已有 /tools/kari-imprint 路由，跳过追加（如需覆盖请手工编辑）"
        return
    fi

    log "[caddy] 追加新 handle 到 baka-akari.zone 块（在最后 file_server 之前）"
    # 用 python 做 in-place 编辑：找到 'baka-akari.zone' 块内最后一个 handle 之后、file_server 之前插入
    cat "${LOCAL_DIR}/deploy/caddy-snippet.conf" | ssh "${REMOTE}" 'cat > /tmp/kari-imprint-caddy-snippet.conf'
    ssh "${REMOTE}" 'sudo python3 -c "
import re, sys
p = \"/etc/caddy/Caddyfile\"
with open(p) as f: src = f.read()
snippet = open(\"/tmp/kari-imprint-caddy-snippet.conf\").read()
# 在 baka-akari.zone 块的最后一个 handle 之后、结尾 file_server / } 之前插入
m = re.search(r\"(baka-akari\.zone[^{]*{)(.*?)(\n\tfile_server\n})\", src, re.S)
if not m:
    print(\"ERR: baka-akari.zone block not found in expected pattern\", file=sys.stderr); sys.exit(2)
head, body, tail = m.group(1), m.group(2), m.group(3)
new_body = body.rstrip() + \"\n\n\" + \"\n\".join(\"\t\"+l if l.strip() else l for l in snippet.splitlines()) + \"\n\"
new_src = src[:m.start()] + head + new_body + tail + src[m.end():]
with open(p, \"w\") as f: f.write(new_src)
print(\"OK: Caddyfile patched\")
"'

    log "[caddy] validate"
    ssh "${REMOTE}" "sudo caddy validate --config /etc/caddy/Caddyfile"

    log "[caddy] reload"
    ssh "${REMOTE}" "sudo systemctl reload caddy"
}

deploy_check() {
    log "[check] 后端健康"
    ssh "${REMOTE}" "curl -sS -w '\nlocal-status:%{http_code}\n' http://127.0.0.1:${PORT}${URL_PREFIX}/api/health"
    log "[check] Caddy → 前端"
    curl -sS -o /dev/null -w "web:%{http_code}\n" "https://${DOMAIN}${URL_PREFIX}/"
    log "[check] Caddy → 后端 API"
    curl -sS -o /dev/null -w "api-health:%{http_code}\n" "https://${DOMAIN}${URL_PREFIX}/api/health"
    log "[check] 服务状态"
    ssh "${REMOTE}" "systemctl is-active kari-imprint.service; systemctl is-active caddy.service"
    log "[check] 若 web=200 且 api-health=200 且服务 active，则 OK"
}

case "${STEP}" in
    all)
        deploy_web
        deploy_code
        deploy_caddy
        deploy_check
        ;;
    web)   deploy_web ;;
    code)  deploy_code ;;
    caddy) deploy_caddy ;;
    check) deploy_check ;;
    *)     err "未知参数: ${STEP}（合法: all/web/code/caddy/check）" ;;
esac

log "完成: ${STEP}"
