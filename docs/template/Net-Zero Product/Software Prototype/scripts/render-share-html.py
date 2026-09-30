import os
import subprocess
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler

base = r"c:\Users\henry\Desktop\Net-Zero Product\Software Prototype"
os.chdir(base)

chrome = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(chrome):
    chrome = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

html_name = "nap-energy-analysis-share.html"
file_url = "file:///" + os.path.join(base, html_name).replace("\\", "/")

port = 8766
server = HTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
time.sleep(0.5)
http_url = f"http://127.0.0.1:{port}/{html_name}"

for label, url in [("file", file_url), ("http", http_url)]:
    out_html = os.path.join(base, f"rendered-{label}.html")
    proc = subprocess.run(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=15000",
            f"--dump-dom={out_html}",
            url,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    dom = open(out_html, encoding="utf-8", errors="replace").read() if os.path.exists(out_html) else ""
    print(f"=== {label} exit={proc.returncode} dom={len(dom)} ===")
    print("Executive Summary:", "Executive Summary" in dom)
    print("Key Highlights:", "Key Highlights" in dom)
    print("Failed to load:", "Failed to load Energy Analysis demo" in dom)
    if "Failed to load" in dom:
        idx = dom.find("Failed to load")
        print(dom[idx : idx + 500])
    if proc.stderr:
        err = proc.stderr[-800:]
        if "error" in err.lower() or "failed" in err.lower():
            print("stderr tail:", err)

server.shutdown()
