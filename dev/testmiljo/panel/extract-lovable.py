#!/usr/bin/env python3
"""Plockar ut butikspanelens filer ur en sparad Lovable-diff mot git:s tomma träd.

  get_diff(project_id, sha=<utkastets commit>, base_sha="4b825dc642cb6eb9a060e54bf8d69288fbee4904")
  → svaret sparas som fil (för stort) → python3 extract-lovable.py <diff-fil> <panel-katalog>

Logotypen (src/assets/brand/tappass-wordmark.svg) är binär i diffen — hämta den med read_file.
"""
import os, re, sys

WANT = ["src/routes/m.tsx", "src/lib/i18n.tsx", "src/styles.css", "src/lib/merchant-supabase.ts"]
src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding="utf-8").read().split("\n")
found = set()
for i, l in enumerate(lines):
    if l.startswith("+++ b/") and l[6:] in WANT:
        path = l[6:]
        m = re.match(r"^@@ -0,0 \+1(?:,(\d+))? @@", lines[i + 1])
        n = int(m.group(1) or 1)
        body, j = [], i + 2
        while len(body) < n:
            s = lines[j]
            if s.startswith("\\"):
                j += 1
                continue
            assert s.startswith("+"), (path, j, s[:40])
            body.append(s[1:])
            j += 1
        newline = not (j < len(lines) and lines[j].startswith("\\ No newline"))
        dest = os.path.join(out, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "w", encoding="utf-8").write("\n".join(body) + ("\n" if newline else ""))
        found.add(path)
        print(path, n, "rader")
missing = [p for p in WANT if p not in found]
if missing:
    sys.exit("saknas i diffen: " + ", ".join(missing))
