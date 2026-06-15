"""One-shot repair: PowerShell 5.1 read UTF-8 files as cp1252 and re-wrote them
as UTF-8(+BOM), mangling every non-ASCII char (e.g. '—' -> 'â€"'). The damage
is a deterministic roundtrip, so invert it: utf8_decode(cp1252_encode(text)).
Only files showing mojibake signatures are touched; BOMs are stripped."""
import sys
from pathlib import Path

MARKERS = ("â€", "Â·", "âœ", "âš", "Â ", "â—", "â–", "â")

def cp1252_bytes(text: str) -> bytes | None:
    out = bytearray()
    for ch in text:
        try:
            out += ch.encode("cp1252")
        except UnicodeEncodeError:
            o = ord(ch)
            if o < 0x100:  # C1 controls PowerShell passed through
                out.append(o)
            else:
                return None
    return bytes(out)

root = Path(sys.argv[1])
fixed, skipped = [], []
for p in list(root.rglob("*.tsx")) + list(root.rglob("*.ts")) + list(root.rglob("*.css")):
    if "node_modules" in p.parts:
        continue
    text = p.read_bytes().decode("utf-8", errors="strict")
    if text.startswith("﻿"):
        text = text[1:]
    if not any(m in text for m in MARKERS):
        # still strip BOM if that's the only damage
        if p.read_bytes().startswith(b"\xef\xbb\xbf"):
            p.write_bytes(text.encode("utf-8"))
            fixed.append(f"{p.name} (bom only)")
        continue
    b = cp1252_bytes(text)
    if b is None:
        skipped.append(p.name)
        continue
    try:
        repaired = b.decode("utf-8")
    except UnicodeDecodeError:
        skipped.append(p.name)
        continue
    p.write_bytes(repaired.encode("utf-8"))
    fixed.append(p.name)

print("FIXED:", len(fixed))
for f in fixed:
    print("  ", f)
print("SKIPPED (manual review needed):", skipped)
