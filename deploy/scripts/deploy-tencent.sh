#!/usr/bin/env bash
set -euo pipefail

# deploy-tencent.sh
# 腾讯云轻量服务器部署脚本（一键打包+上传）
# 由于腾讯云 SSH 可能需要二次验证，远程部署部分需要用户手动 ssh 登录后执行。
#
# 使用方式：
#   1. 在 Mac 上运行 deploy/scripts/deploy-tencent.sh
#   2. 等待上传完成
#   3. 按提示 ssh 登录服务器，执行 /tmp/kari-imprint-deploy-remote.sh
#
# 要求本地 Mac 环境：
#   - 已安装 uv (https://astral.sh/uv)
#   - 已安装 npm/node
#   - 配置好 SSH config 中的 tencent-ubuntu Host

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEPLOY_HOST="${DEPLOY_HOST:-tencent-ubuntu}"
REMOTE_DIR="${REMOTE_DIR:-/opt/kari-imprint}"
REMOTE_WEB_DIR="${REMOTE_WEB_DIR:-/var/www/personal-home/tools/watermark-v3}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/var/lib/kari-imprint}"
REMOTE_ASSETS_DIR="${REMOTE_ASSETS_DIR:-/var/lib/kari-imprint/assets}"
REMOTE_PORT="${REMOTE_PORT:-2192}"
API_PREFIX="${API_PREFIX:-/tools/watermark-v3/api}"

DEPLOY_TAG="$(date +%Y%m%d-%H%M%S)"
TMP_TARBALL="/tmp/kari-imprint-${DEPLOY_TAG}.tgz"
TMP_ASSETS_TARBALL="/tmp/kari-imprint-assets-${DEPLOY_TAG}.tgz"
REMOTE_TARBALL="/tmp/kari-imprint-latest.tgz"
REMOTE_ASSETS_TARBALL="/tmp/kari-imprint-assets-latest.tgz"

echo "==> 检查本地 assets"
if [ ! -d "${PROJECT_ROOT}/assets/fonts" ] || [ ! -d "${PROJECT_ROOT}/assets/logos" ]; then
  echo "ERROR: 本地 assets/fonts 或 assets/logos 不存在，请先准备静态资源" >&2
  exit 1
fi

echo "==> 清理并重新构建前端"
cd "${PROJECT_ROOT}/apps/web"
npm install
VITE_API_BASE="${API_PREFIX%/api}" npm run build

echo "==> 本地验证 Python 测试"
cd "${PROJECT_ROOT}"
uv run ruff check .
cd packages/kari-core && uv run pytest
cd ../../apps/api && uv run pytest

echo "==> 打包源码（不含 .git/node_modules/.venv/assets）"
cd "${PROJECT_ROOT}"
tar -czf "${TMP_TARBALL}" \
  --exclude='node_modules' \
  --exclude='.venv' \
  --exclude='venv' \
  --exclude='dist' \
  --exclude='__pycache__' \
  --exclude='.pytest_cache' \
  --exclude='.mypy_cache' \
  --exclude='*.pyc' \
  --exclude='.DS_Store' \
  --exclude='.vite' \
  --exclude='*.tsbuildinfo' \
  --exclude='.git' \
  --exclude='assets' \
  .

echo "==> 打包 assets（字体 + logo）"
cd "${PROJECT_ROOT}"
tar -czf "${TMP_ASSETS_TARBALL}" \
  --exclude='.DS_Store' \
  assets/fonts assets/logos assets/README.md

echo "==> 上传代码包、assets 和远程部署脚本"
cat > /tmp/kari-imprint-deploy-remote.sh <<'REMOTE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR="/opt/kari-imprint"
REMOTE_WEB_DIR="/var/www/personal-home/tools/watermark-v3"
REMOTE_DATA_DIR="/var/lib/kari-imprint"
REMOTE_ASSETS_DIR="/var/lib/kari-imprint/assets"
REMOTE_PORT="2192"
API_PREFIX="/tools/watermark-v3/api"

echo "    -> 清理旧版并解压代码"
sudo systemctl stop kari-imprint.service 2>/dev/null || true
sudo rm -rf \
  /opt/aka-semi-utils-web \
  /opt/aka-semi-utils-web-v2 \
  "${REMOTE_DIR}" \
  /var/www/personal-home/tools/watermark \
  /var/www/personal-home/tools/watermark-v3

sudo mkdir -p "${REMOTE_DIR}"
sudo chown -R "$(whoami)":"$(whoami)" "${REMOTE_DIR}"
tar -xzf /tmp/kari-imprint-latest.tgz -C "${REMOTE_DIR}"
find "${REMOTE_DIR}" -name '._*' -delete

echo "    -> 解压 assets 到服务器"
sudo rm -rf "${REMOTE_ASSETS_DIR}"
sudo mkdir -p "${REMOTE_ASSETS_DIR}"
tar -xzf /tmp/kari-imprint-assets-latest.tgz -C "${REMOTE_DATA_DIR}"
sudo chown -R "$(whoami)":"$(whoami)" "${REMOTE_ASSETS_DIR}"

echo "    -> 创建运行时目录"
sudo mkdir -p "${REMOTE_DATA_DIR}"{"/uploads","/outputs","/resources","/tmp"}
sudo chown -R "$(whoami)":"$(whoami)" "${REMOTE_DATA_DIR}"

echo "    -> 配置 Python 解释器和依赖"
mkdir -p "$HOME/.config/uv"
cat > "$HOME/.config/uv/uv.toml" <<'UVCONF'
[pip]
index-url = "https://mirrors.aliyun.com/pypi/simple/"
UVCONF

export PATH="$HOME/.local/bin:$PATH"
UV_PYTHON="/opt/uv-python/cpython-3.13/bin/python3.13"

cd "${REMOTE_DIR}"
rm -rf .venv
uv venv --python "$UV_PYTHON"
uv pip install -e ./packages/kari-core -e ./apps/api
chmod -R 755 .venv/bin

echo "    -> 部署编译前端静态文件"
sudo mkdir -p "${REMOTE_WEB_DIR}"
sudo cp -r "${REMOTE_DIR}/apps/web/dist/"* "${REMOTE_WEB_DIR}/"
sudo chown -R www-data:www-data "${REMOTE_WEB_DIR}"

echo "    -> 配置环境变量"
sudo tee /etc/kari-imprint.env > /dev/null <<ENV
KARI_IMPRINT_DATA_DIR=${REMOTE_DATA_DIR}
KARI_IMPRINT_ASSETS_DIR=${REMOTE_ASSETS_DIR}
KARI_IMPRINT_RESOURCE_DIR=${REMOTE_DATA_DIR}/resources
KARI_IMPRINT_UPLOAD_DIR=${REMOTE_DATA_DIR}/uploads
KARI_IMPRINT_OUTPUT_DIR=${REMOTE_DATA_DIR}/outputs
KARI_IMPRINT_TMP_DIR=${REMOTE_DATA_DIR}/tmp
KARI_IMPRINT_API_PREFIX=${API_PREFIX}
KARI_IMPRINT_MAX_UPLOAD_SIZE=33554432
KARI_IMPRINT_OUTPUT_TTL=3600
KARI_IMPRINT_CLEANUP_INTERVAL=300
KARI_IMPRINT_LOG_LEVEL=info
ENV
sudo chmod 600 /etc/kari-imprint.env

echo "    -> 配置 systemd 服务"
sudo tee /etc/systemd/system/kari-imprint.service > /dev/null <<SERVICE
[Unit]
Description=Kari Imprint Web API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
Group=$(whoami)
WorkingDirectory=${REMOTE_DIR}
EnvironmentFile=/etc/kari-imprint.env
Environment=PATH=${REMOTE_DIR}/.venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=${REMOTE_DIR}/.venv/bin/uvicorn apps.api.src.api.main:app --host 127.0.0.1 --port ${REMOTE_PORT} --workers 1 --limit-concurrency 8 --timeout-keep-alive 5 --no-server-header
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=yes
ReadWritePaths=${REMOTE_DATA_DIR} ${REMOTE_ASSETS_DIR}
MemoryMax=1200M
TasksMax=64

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable kari-imprint.service
sudo systemctl start kari-imprint.service

echo "    -> 检查服务状态"
sleep 3
systemctl is-active kari-imprint.service
REMOTE_SCRIPT

chmod +x /tmp/kari-imprint-deploy-remote.sh
scp "${TMP_TARBALL}" "${DEPLOY_HOST}:${REMOTE_TARBALL}"
scp "${TMP_ASSETS_TARBALL}" "${DEPLOY_HOST}:${REMOTE_ASSETS_TARBALL}"
scp /tmp/kari-imprint-deploy-remote.sh "${DEPLOY_HOST}:/tmp/kari-imprint-deploy-remote.sh"

echo ""
echo "==> 代码包和 assets 已上传，请手动登录服务器完成部署："
echo "    ssh ${DEPLOY_HOST}"
echo "    bash /tmp/kari-imprint-deploy-remote.sh"
echo ""
echo "==> 部署完成后访问: https://baka-akari.zone/tools/watermark-v3/"

rm -f "${TMP_TARBALL}" "${TMP_ASSETS_TARBALL}" /tmp/kari-imprint-deploy-remote.sh
