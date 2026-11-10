"""Local dev server with caching off, so edits show up on reload.

    python3 scripts/serve.py          # http://127.0.0.1:5178
    python3 scripts/serve.py --lan    # also reachable from your phone on the same Wi-Fi
"""
import http.server, os, socketserver, sys

PORT = 5178
HOST = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "text/javascript"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer((HOST, PORT), NoCache) as httpd:
    print(f"Ledger on http://{'localhost' if HOST == '127.0.0.1' else HOST}:{PORT}", flush=True)
    httpd.serve_forever()
