"""Local dev server: like `python -m http.server`, but never lets the browser cache files,
so edits show up on a normal reload. Usage: python dev/serve.py [port]"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
