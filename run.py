import argparse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit

class CustomHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Never serve dotfiles or dot-directories (.git, .env, ...); an empty path yields a 404
        if any(part.startswith('.') for part in urlsplit(path).path.split('/')):
            return ''
        return super().translate_path(path)

    def do_GET(self):
        if self.path == '/':
            self.path = '/index.html'
        return super().do_GET()

def run_server():
    parser = argparse.ArgumentParser(description="Serve the Time Tracker app.")
    # Localhost only by default. Pass --host 0.0.0.0 to allow other devices on your network.
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    httpd = HTTPServer((args.host, args.port), CustomHandler)
    # Data lives in the browser per origin, so always open the same URL
    # (localhost and 127.0.0.1 are separate origins with separate data).
    shown_host = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "") else args.host
    print(f"Server running at http://{shown_host}:{args.port}/")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server safely.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
