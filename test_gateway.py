from __future__ import annotations

import http.client
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000
VISION_HOST = "127.0.0.1"
VISION_PORT = 8010
GATEWAY_HOST = "127.0.0.1"
GATEWAY_PORT = 8080


class GatewayHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/frontend") or self._is_frontend_asset():
            self._serve_frontend()
            return

        if self.path.startswith("/api/"):
            self._proxy_request(BACKEND_HOST, BACKEND_PORT, "/api")
            return

        if self.path.startswith("/visionapi/"):
            self._proxy_request(VISION_HOST, VISION_PORT, "/visionapi")
            return

        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request(BACKEND_HOST, BACKEND_PORT, "/api")
            return

        if self.path.startswith("/visionapi/"):
            self._proxy_request(VISION_HOST, VISION_PORT, "/visionapi")
            return

        self.send_error(404, "Not found")

    def _is_frontend_asset(self) -> bool:
        return self.path.endswith(".html") or self.path.endswith(".css") or self.path.endswith(".js")

    def _serve_frontend(self) -> None:
        relative = self.path.removeprefix("/frontend").lstrip("/") or "index.html"
        target = (FRONTEND_DIR / relative).resolve()
        if not str(target).startswith(str(FRONTEND_DIR.resolve())) or not target.exists() or not target.is_file():
            self.send_error(404, "Frontend file not found")
            return

        content_type, _ = mimetypes.guess_type(target.name)
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(target.read_bytes())

    def _proxy_request(self, host: str, port: int, prefix: str) -> None:
        target_path = self.path.removeprefix(prefix)
        parsed = urlparse(target_path)
        forward_path = parsed.path
        if parsed.query:
            forward_path = f"{forward_path}?{parsed.query}"

        body = None
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            body = self.rfile.read(content_length)

        connection = http.client.HTTPConnection(host, port, timeout=10)
        headers = {
          "Content-Type": self.headers.get("Content-Type", "application/json"),
        }

        try:
            connection.request(self.command, forward_path, body=body, headers=headers)
            response = connection.getresponse()

            self.send_response(response.status)
            for k, v in response.getheaders():
                if k.lower() not in ("transfer-encoding", "connection"):
                    self.send_header(k, v)
            self.send_header("Connection", "close")
            self.end_headers()

            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except OSError as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "error": "backend_unreachable",
                        "detail": str(exc),
                        "expected_backend": f"http://{host}:{port}",
                    }
                ).encode("utf-8")
            )
        finally:
            connection.close()


def main() -> None:
    server = ThreadingHTTPServer((GATEWAY_HOST, GATEWAY_PORT), GatewayHandler)
    print(f"Gateway serving frontend on http://{GATEWAY_HOST}:{GATEWAY_PORT}")
    print(f"Proxying backend API from http://{BACKEND_HOST}:{BACKEND_PORT} to /api/*")
    print(f"Proxying vision API from http://{VISION_HOST}:{VISION_PORT} to /visionapi/*")
    server.serve_forever()


if __name__ == "__main__":
    main()
