from pathlib import Path

html = Path(__file__).resolve().parents[1] / "nap-energy-analysis-share.html"
text = html.read_text(encoding="utf-8")
marker = '<script type="module">'
start = text.rfind(marker) + len(marker)
end = text.rfind("</script>")
js = text[start:end]
out = Path(__file__).resolve().parents[1] / "tmp-share.js"
out.write_text(js, encoding="utf-8")
print(f"wrote {out} ({len(js)} bytes)")
