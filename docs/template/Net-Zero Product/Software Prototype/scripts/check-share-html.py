import os
import subprocess
import threading
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler

html_dir = r"c:\Users\henry\Desktop\Net-Zero Product\Software Prototype"
os.chdir(html_dir)

port = 8765
server = HTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
time.sleep(0.5)

chrome_candidates = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
chrome = next((path for path in chrome_candidates if os.path.exists(path)), None)
if not chrome:
    raise SystemExit("No Chrome/Edge found")

url = f"http://127.0.0.1:{port}/nap-energy-analysis-share.html"
file_url = "file:///" + os.path.join(html_dir, "nap-energy-analysis-share.html").replace("\\", "/")

for label, target in [("http", url), ("file", file_url)]:
    log_path = os.path.join(html_dir, f"browser-{label}.txt")
    with open(log_path, "w", encoding="utf-8") as log_file:
        proc = subprocess.run(
            [
                chrome,
                "--headless=new",
                "--disable-gpu",
                "--enable-logging=stderr",
                "--v=1",
                f"--virtual-time-budget=10000",
                target,
                "--dump-dom",
            ],
            stdout=log_file,
            stderr=subprocess.STDOUT,
            timeout=40,
        )
    dom = open(log_path, encoding="utf-8", errors="replace").read()
    print(f"=== {label} exit={proc.returncode} dom_len={len(dom)} ===")
    print("Executive Summary:", "Executive Summary" in dom)
    print("Key Highlights:", "Key Highlights" in dom)
    print("Energy Analysis Demo:", "Energy Analysis Demo" in dom)
    root_idx = dom.find('id="root"')
    if root_idx >= 0:
        print("root snippet:", dom[root_idx : root_idx + 300].replace("\n", " ")[:300])
    else:
        print("root not found; head:", dom[:400].replace("\n", " "))

server.shutdown()
