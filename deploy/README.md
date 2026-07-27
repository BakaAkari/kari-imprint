# 腾讯云部署

当前线上：

```text
https://baka-akari.zone/tools/kari-imprint/
```

## 路径与服务

- 前端静态文件：`/var/www/personal-home/tools/kari-imprint/`
- 后端代码：`/opt/kari-imprint/`
- systemd：`kari-imprint.service`
- 端口：`127.0.0.1:2190`
- API prefix：`/tools/kari-imprint/api`
- 数据目录：`/var/lib/kari-imprint/`

## 前端部署

```bash
cd apps/web
VITE_API_BASE=/tools/kari-imprint npm run build
cd dist
tar czf - . | ssh tencent-ubuntu "sudo tar xzf - -C /var/www/personal-home/tools/kari-imprint/ && sudo chown -R www-data:www-data /var/www/personal-home/tools/kari-imprint/"
```

## 后端部署

```bash
rsync -avz --delete \
  --exclude='apps/web/node_modules' --exclude='apps/web/dist' \
  --exclude='.venv' --exclude='__pycache__' --exclude='.git' \
  --exclude='*.pyc' --exclude='.DS_Store' \
  --exclude='archive' --exclude='design' --exclude='docs' \
  --exclude='.pytest_cache' --exclude='.ruff_cache' --exclude='.mypy_cache' \
  --exclude='build' --exclude='static' --exclude='gui' \
  --exclude='kari-imprint.env' \
  --rsync-path='sudo rsync' \
  ./ tencent-ubuntu:/opt/kari-imprint/
```

注意：`config/logos/` 是自动 Logo 资源目录，保留在源码中并同步到线上，不要排除。如需排除 `config/` 中其他内容，请显式列出子目录。

```bash
ssh tencent-ubuntu "sudo chown -R www-data:www-data /opt/kari-imprint/ && sudo chmod 755 /opt/kari-imprint && sudo systemctl restart kari-imprint.service"
```

重启后验证：

```bash
ssh tencent-ubuntu "systemctl is-active kari-imprint.service && curl -sS -o /dev/null -w 'api:%{http_code}\n' https://baka-akari.zone/tools/kari-imprint/api/health && curl -sS -o /dev/null -w 'logo:%{http_code}\n' https://baka-akari.zone/tools/kari-imprint/api/logos/default.png"
```

## 验证

```bash
curl -sS -o /dev/null -w 'web:%{http_code}\n' https://baka-akari.zone/tools/kari-imprint/
curl -sS -w '\napi:%{http_code}\n' https://baka-akari.zone/tools/kari-imprint/api/health
```

期望：

```text
web:200
api:200
```

服务器侧：

```bash
ssh tencent-ubuntu '
  systemctl list-units --type=service --all "*kari-imprint*" --no-pager
  sudo ss -ltnp | grep -E ":2190" || true
'
```

期望只剩 `kari-imprint.service` active，只有 `127.0.0.1:2190` 监听。
