# Static server for the project + POST /save/<name> to write mocap output into capture/.
import http.server, os, re, sys
ROOT = sys.argv[1]; OUT = os.path.join(ROOT, 'capture')
os.makedirs(OUT, exist_ok=True)
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def do_POST(self):
        m = re.fullmatch(r'/save/([A-Za-z0-9_-]+\.(?:json|png|jpg))', self.path)
        if not m: self.send_error(400); return
        n = int(self.headers['Content-Length'])
        open(os.path.join(OUT, m.group(1)), 'wb').write(self.rfile.read(n))
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
http.server.ThreadingHTTPServer(('127.0.0.1', 8922), H).serve_forever()
