import os

base = r"c:\Users\henry\Desktop\Net-Zero Product\Software Prototype"
files = [
    "nap-energy-analysis-share.html",
    os.path.join("dist-nap-export", "nap-export.entry.html"),
    os.path.join("dist", "index.html"),
]

for rel in files:
    path = os.path.join(base, rel)
    text = open(path, encoding="utf-8").read()
    script_idx = text.find("<script")
    root_idx = text.find('<div id="root">')
    print("===", rel, "===")
    print("size:", os.path.getsize(path))
    print("module script:", 'type="module"' in text[:1000])
    print("root before script:", root_idx < script_idx if script_idx >= 0 else "n/a")
    print("has Key Highlights:", "Key Highlights" in text)
    if root_idx >= 0:
        print("root context:", text[max(0, root_idx - 40) : root_idx + 120].replace("\n", " "))
    if script_idx >= 0:
        print("script context:", text[script_idx : script_idx + 80].replace("\n", " "))
    print("tail:", text[-220:].replace("\n", " "))
    print()
