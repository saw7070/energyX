"""Scrub sensitive strings from the NP share HTML before public distribution."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "dist-nap-export" / "nap-export.entry.html"
DST = ROOT / "nap-energy-analysis-share.html"

# Longer phrases first. Empty replacement removes the string.
REPLACEMENTS: list[tuple[str, str]] = [
    ("Ngee Ann Polytechnic, Singapore", ""),
    ("Ngee Ann Poly Level 6", "Level 6 meter data"),
    ("Ngee Ann Poly Level 7", "Level 7 meter data"),
    ("Ngee Ann Polytechnic", "Campus Site"),
    ("Ngee Ann Poly", "Campus Site"),
    ("NP Energy Analysis", "Energy Analysis Demo"),
    # Safety net: portfolio / demo site addresses from full-app bundles
    ("1 Raffles Place, Singapore", ""),
    ("45 Thomson Rd, Singapore", ""),
    ("Marina Blvd, Singapore", ""),
    ("Jurong West, Singapore", ""),
    ("Woodlands Ave, Singapore", ""),
    ("Changi North, Singapore", ""),
    ("Tuas South, Singapore", ""),
    ("Sentosa, Singapore", ""),
    ("12 Pioneer Road, Singapore", ""),
    ("88 Woodlands Ave, Singapore", ""),
    ("Airport Cargo Zone 5, Singapore", ""),
    ("220 Tampines Ave 4, Singapore", ""),
    ("VG HQ Tower", "Demo Tower"),
    ("Thomson Logistics Hub", "Demo Logistics Hub"),
    ("Marina Bay Office", "Demo Office"),
    ("Jurong Dormitory", "Demo Dormitory"),
    ("Woodlands Mall", "Demo Mall"),
    ("Changi Data Centre", "Demo Data Centre"),
    ("Tuas Industrial Park", "Demo Industrial Park"),
    ("Sentosa Resort", "Demo Resort"),
    ("ST Lodge Site A", ""),
    ("ST Lodge Site B", ""),
    ("CAG Dormitory", ""),
    ("HDB Utility Pilot", ""),
    ("Vector Green", "Demo Org"),
    ("ST Lodge", ""),
    ("EliteIOT Office, Singapore", ""),
    ("EliteIOT", ""),
]


def normalize_share_html(html: str) -> str:
    """Make single-file HTML open reliably via file:// (double-click)."""
    html = html.replace('<script type="module" crossorigin>', "<script>")
    html = html.replace('<script type="module">', "<script>")

    root_marker = '<div id="root"></div>'
    loading_root = (
        '<div id="root"><p style="padding:2rem;color:#94a3b8;font-family:system-ui,sans-serif">'
        "Loading demo...</p></div>"
    )
    if root_marker in html:
        html = html.replace(root_marker, loading_root, 1)
        root_marker = loading_root
    script_start = html.find("<script")
    script_end = html.rfind("</script>")
    if script_start >= 0 and script_end > script_start and root_marker in html:
        script_block = html[script_start : script_end + len("</script>")]
        html_without_script = html[:script_start] + html[script_end + len("</script>") :]
        html = html_without_script.replace(root_marker, f"{root_marker}\n    {script_block}", 1)

    return html


def scrub(text: str) -> str:
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    return normalize_share_html(text)


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Build output not found: {SRC}. Run vite nap-export build first.")

    raw = SRC.read_text(encoding="utf-8")
    cleaned = scrub(raw)
    DST.write_text(cleaned, encoding="utf-8")
    print(f"Wrote {DST} ({len(raw):,} -> {len(cleaned):,} bytes)")


if __name__ == "__main__":
    main()
