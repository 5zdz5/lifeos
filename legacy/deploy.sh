#!/usr/bin/env bash
# =============================================================================
# LifeOS · PWA 一键托管
# -----------------------------------------------------------------------------
# 把 src/ 部署到免费 HTTPS 静态托管，平板点链接即可「添加到主屏幕」安装成 App。
# 比局域网更持久（不依赖电脑开机），比传文件更方便（一个链接搞定）。
#
# 用法：
#   bash deploy.sh            # 交互选择平台并部署
#   bash deploy.sh --preview  # 仅本机起一个本地 HTTP 服务自检（不部署公网）
#
# 部署前准备（首次）：
#   Netlify : 先执行  npx netlify-cli login
#   Vercel  : 先执行  npx vercel login
#   Surge   : 无需准备，部署时按提示填邮箱+密码
# =============================================================================
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/src"

# ---- 本地预览（自检 / 本机体验，不部署） ----
if [ "$1" = "--preview" ]; then
  PORT="${2:-8088}"
  echo "============================================================"
  echo "  LifeOS 本地预览（HTTP，仅本机自检 / 体验）"
  echo "  打开: http://localhost:${PORT}/"
  echo "  按 Ctrl+C 停止"
  echo "============================================================"
  cd "$DIR"
  exec python3 -m http.server "$PORT" --bind 127.0.0.1
fi

echo "============================================================"
echo "  LifeOS · PWA 一键托管（部署到免费 HTTPS 静态托管）"
echo "  部署目录: $DIR"
echo "============================================================"
echo "选择平台："
echo "  1) Netlify      — 需 netlify login，免费 HTTPS，推荐"
echo "  2) Vercel       — 需 vercel login，免费 HTTPS"
echo "  3) Surge        — 仅需邮箱+密码，最省事"
echo "  4) GitHub Pages — 需 git 与 GitHub 仓库"
read -r -p "输入序号 [1-4，默认1]: " C
C="${C:-1}"

case "$C" in
  1)
    echo "→ 部署到 Netlify ..."
    npx --yes netlify-cli deploy --prod --dir="$DIR" --yes
    ;;
  2)
    echo "→ 部署到 Vercel ..."
    npx --yes vercel --prod --yes "$DIR"
    ;;
  3)
    echo "→ 部署到 Surge ...（按提示填邮箱+密码，域名可留空随机）"
    npx --yes surge "$DIR"
    ;;
  4)
    echo "→ GitHub Pages 步骤："
    echo "  1) 在 GitHub 新建一个空仓库（如 lifeos）"
    echo "  2) 在本机执行以下命令（把 <仓库URL> 换成你的）："
    echo "       cd $DIR"
    echo "       git init -q && git add -A && git commit -qm 'LifeOS'"
    echo "       git branch -M main"
    echo "       git remote add origin <仓库URL>"
    echo "       git push -u origin main"
    echo "  3) 仓库 Settings → Pages → Source 选 main 分支 /(root) → Save"
    echo "  4) 几分钟后访问 https://<用户名>.github.io/<仓库名>/"
    ;;
  *)
    echo "无效选择"; exit 1
    ;;
esac

echo ""
echo "部署成功后，用平板浏览器打开输出的 HTTPS 地址 → 菜单「添加到主屏幕」即完成安装。"
echo "（该地址即一个可安装的 PWA 链接，全屏离线可用。）"
