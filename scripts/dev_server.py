"""개발용 정적 서버. 브라우저가 예전 JS·카탈로그·음원을 캐시해 수정이 반영되지 않는 문제를 막기 위해
모든 응답에 Cache-Control: no-store 를 붙인다.

실행: python scripts/dev_server.py [포트=8000]   (프로젝트 루트를 서빙)
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("", port), handler) as httpd:
        print(f"http://localhost:{port}/demo/stage.html  (캐시 없음, Ctrl+C로 종료)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
