import http.server
import os
import socket
import sys
import threading
import webbrowser

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

LAN = '--lan' in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith('--')]
PORT = 8000
if args:
    try:
        PORT = int(args[0])
    except ValueError:
        pass

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src')
os.chdir(ROOT)


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('223.5.5.5', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return '127.0.0.1'


IP = local_ip()

PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>记账 App 预览</title>
<style>
body{{margin:0;background:#f4f5f7;color:#1b1b1f;
 font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;}}
.wrap{{max-width:520px;margin:0 auto;padding:28px 16px 40px;}}
h1{{font-size:21px;margin:0 0 4px;}}
.sub{{color:#8a8a92;font-size:13px;margin-bottom:20px;}}
.card{{background:#fff;border-radius:14px;padding:16px;margin-bottom:12px;}}
.lb{{font-size:13px;color:#8a8a92;margin-bottom:8px;}}
a.btn{{display:block;text-align:center;background:#2f6fed;color:#fff;text-decoration:none;
 padding:13px;border-radius:12px;font-size:16px;font-weight:500;}}
.addr{{font-family:ui-monospace,Consolas,monospace;font-size:19px;font-weight:600;
 background:#f0f4ff;color:#18478f;padding:12px;border-radius:10px;text-align:center;
 word-break:break-all;}}
.tip{{font-size:13px;color:#8a8a92;margin-top:8px;}}
.warn{{background:#fbf7ec;}}
ol{{margin:8px 0 0;padding-left:20px;font-size:13px;color:#5a5a62;}}
li{{margin-bottom:4px;}}
</style>
</head>
<body>
<div class="wrap">
  <h1>记账 App 预览版</h1>
  <div class="sub">服务已在运行 · 电脑端口 {port}</div>

  <div class="card">
    <div class="lb">在电脑上继续</div>
    <a class="btn" href="/">打开记账 App</a>
  </div>

  <div class="card">
    <div class="lb">在手机上打开（推荐，能看真实布局）</div>
    {phone}
  </div>

  <div class="card warn">
    <div class="lb">三个容易踩的坑</div>
    <ol>
      <li>手机必须和这台电脑连<b>同一个 WiFi</b>，用流量不行</li>
      <li>不要直接双击 <b>index.html</b> —— file:// 协议下会白屏，必须从这里进</li>
      <li>要停止服务：回到那个黑色命令行窗口，按 <b>Ctrl + C</b></li>
    </ol>
  </div>

  <div class="tip">数据是存在浏览器里的（IndexedDB）。<b>清浏览器缓存 = 账没了</b>，
  所以现在先随便记几笔试手感，别急着写真实数据。<br>
  打包成 APK 之后数据会挪到 App 私有目录。</div>
</div>
</body>
</html>
"""


def landing_html():
    if LAN:
        phone = ('<div class="addr">http://' + IP + ':' + str(PORT) + '</div>'
                 '<div class="tip">在手机浏览器里输入上面这串地址</div>')
    else:
        phone = ('<div class="addr" style="font-size:15px">当前没有开启手机访问</div>'
                 '<div class="tip">关闭本窗口后，用 <b>start-preview.bat</b> 重新启动即可（它默认开启手机访问）</div>')
    return PAGE.replace('{port}', str(PORT)).replace('{phone}', phone)


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path in ('/start', '/start.html'):
            body = landing_html().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *a):
        pass


bind = '0.0.0.0' if LAN else '127.0.0.1'
srv = None
for _ in range(8):
    try:
        srv = http.server.ThreadingHTTPServer((bind, PORT), Handler)
        break
    except OSError:
        PORT += 1

if srv is None:
    print('')
    print('  [ERROR] 端口被占用，换一个：python scripts/serve.py 8123')
    print('')
    sys.exit(1)

print('')
print('  记账 App 预览版已启动')
print('  ----------------------------------------')
print('  电脑上：  http://127.0.0.1:' + str(PORT))
if LAN:
    print('  手机上：  http://' + IP + ':' + str(PORT) + '   （手机需连同一个 WiFi）')
print('  ----------------------------------------')
print('  浏览器会自动打开引导页，手机地址也在那一页上')
print('  按 Ctrl+C 停止')
print('')

if '--no-open' not in sys.argv:
    threading.Timer(1.2, lambda: webbrowser.open('http://127.0.0.1:' + str(PORT) + '/start')).start()

try:
    srv.serve_forever()
except KeyboardInterrupt:
    print('')
    print('  已停止')
    print('')
