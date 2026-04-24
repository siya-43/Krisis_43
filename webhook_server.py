import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8090

# ANSI color codes for terminal
GREEN = "\033[92m"
BLUE = "\033[94m"
RESET = "\033[0m"

class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path.startswith("/twilio/"):
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return

            if "sms" in self.path:
                print(f"\n{GREEN}📱 [SMS SENT] To: {payload.get('recipient')} - {payload.get('message')}{RESET}")
            elif "voice" in self.path:
                print(f"\n{BLUE}📞 [VOICE CALL] Ringing: {payload.get('recipient')} - MSG: {payload.get('message')}{RESET}")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "delivered"}).encode("utf-8"))
            return

        self.send_error(404, "Not found")

    def log_message(self, format, *args):
        # Suppress standard HTTP logging
        pass

def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), WebhookHandler)
    print(f"Mock Twilio Webhook Service listening on http://{HOST}:{PORT}")
    server.serve_forever()

if __name__ == "__main__":
    main()
