#!/usr/bin/env python3
"""
Serve a built sharp-pen review page on localhost.

    python3 scripts/serve.py review.html            # pick a free port, print the URL
    python3 scripts/serve.py review.html --port 8765
    python3 scripts/serve.py review.html --open     # also try to open a browser

Foreground process, stdlib only. Ctrl-C stops it. Bound to 127.0.0.1 — nothing
is exposed outside the machine, and the page itself never makes a network call.
"""

import argparse
import functools
import http.server
import socket
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def free_port(preferred=None):
    if preferred:
        return preferred
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", help="the built HTML file")
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--open", action="store_true", help="open a browser window")
    args = ap.parse_args()

    path = Path(args.file).resolve()
    if not path.is_file():
        print("error: {} does not exist".format(path), file=sys.stderr)
        return 1

    port = free_port(args.port)
    handler = functools.partial(QuietHandler, directory=str(path.parent))

    try:
        socketserver.TCPServer.allow_reuse_address = True
        httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    except OSError as exc:
        print("error: could not bind port {} ({})".format(port, exc), file=sys.stderr)
        return 1

    url = "http://127.0.0.1:{}/{}".format(port, path.name)
    print("\n  sharp-pen review ready:\n")
    print("      {}\n".format(url))
    print("  Ctrl-C to stop the server.\n")

    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
