#!/usr/bin/env bash
# =============================================================================
# LifeOS · 局域网一键部署
# -----------------------------------------------------------------------------
# 作用：在本机启动一个静态服务，并生成二维码，平板扫码即可打开 LifeOS，
#       然后点浏览器菜单「添加到主屏幕」就能变成一个全屏 App（无需签名/DevEco/证书）。
# 用法：
#   ./start.sh            # 默认端口 8080
#   ./start.sh 9000       # 指定端口
# 退出：Ctrl + C
# 说明：平板与电脑需连同一个 Wi-Fi；首次打开为「演示模式」，在设置里填 AI
#       接口即可联网调用。
# Windows 用户：请用 WSL / Git Bash 运行，或直接执行 `python3 -m http.server 8080`。
# =============================================================================
set -e

PORT="${1:-8080}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRV="$ROOT/src"
[ -d "$SRV" ] || { echo "找不到 $SRV，请在 lifeos 项目根目录运行本脚本"; exit 1; }

# 取局域网 IP（优先 ip / ifconfig）
get_ip() {
  if command -v ip >/dev/null 2>&1; then
    ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig | awk '/inet / && $2 !~ /^127\./ {print $2; exit}'
  fi
}
IP="$(get_ip)"
URL="http://${IP:-localhost}:${PORT}/"

echo "============================================================"
echo "  LifeOS 局域网部署"
echo "  电脑本机 :  http://localhost:${PORT}/"
echo "  平板访问 :  ${URL}"
echo "  （平板与电脑请连同一个 Wi-Fi）"
echo "============================================================"

# 终端二维码：优先用 qrcode 库，没有就自动 pip 安装，再失败则仅打印 URL
python3 - "$URL" <<'PY' 2>/dev/null || true
import sys
url = sys.argv[1]
try:
    import qrcode
except Exception:
    try:
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "qrcode"])
        import qrcode
    except Exception:
        qrcode = None
if qrcode:
    qr = qrcode.QRCode(border=1)
    qr.add_data(url); qr.make(fit=True)
    qr.print_ascii(invert=True)
    print("\n↑ 用平板相机/浏览器扫上面的码即可打开")
else:
    print("提示：浏览器访问上方 URL，再「添加到主屏幕」即可变 App。")
PY

echo ""
echo "  服务已启动，按 Ctrl+C 停止。"
echo ""
cd "$SRV"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
