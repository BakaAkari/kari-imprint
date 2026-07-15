# Kari Imprint 静态资源

本目录用于存放不进 Git 仓库的大文件，主要包括：

- `fonts/` — 水印渲染所需字体
- `logos/` — 相机品牌 Logo

## 为什么不放在 Git 里

字体文件（如 NotoSansCJKsc）单个就有 16MB，会过度腥肿仓库，导致：

- `git clone` 和部署包传输超时
- GitHub 仓库体积过大
- 团队协作时每次拉取都要下载字体

## 本地开发

代码默认会在仓库根目录的 `assets/` 下查找字体和 logo。
如果 `assets/` 不存在，就会回退到项目内的 `packages/kari-core/config/fonts|logos`
（为了兼容过渡）。

```text
kari-imprint/
├── assets/
│   ├── fonts/NotoSansCJKsc-Regular.otf
│   ├── fonts/NotoSansCJKsc-Bold.otf
│   └── logos/nikon.png
├── packages/
│   └── kari-core/
```

## 服务器部署

部署时需要保证服务器上有 `KARI_IMPRINT_ASSETS_DIR` 指向的资源目录：

```bash
export KARI_IMPRINT_ASSETS_DIR=/var/lib/kari-imprint/assets
```

并且该目录下应该包含 `fonts/` 和 `logos/` 子目录。

## 同步方式

推荐使用以下任意一种方式管理 assets：

1. **私有云盘 / NAS**
   - 把 assets 放在你的 NAS 上
   - 部署脚本通过 rsync/Tailscale 同步到服务器
2. **对象存储 CDN**
   - 如腾讯云 COS / 阿里云 OSS
   - 通过 `awscli` / `coscli` 在服务器上拉取
3. **手动上传**
   - 打包 `assets` 目录，通过 scp/rsync 手动传到服务器
   - 适合不变动少的场景

## 默认资源列表

必需字体：

- `NotoSansCJKsc-Regular.otf`
- `NotoSansCJKsc-Bold.otf`

可选字体：

- `LiuJianMaoCao-Regular.ttf`
- `ZhiMangXing-Regular.ttf`
- `Roboto-Regular.ttf`
- `Roboto-Bold.ttf`
- `Roboto-Medium.ttf`
- `Roboto-Light.ttf`

Logo 图片与品牌名称对应，例如 `nikon.png`。
