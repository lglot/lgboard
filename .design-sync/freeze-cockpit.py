#!/usr/bin/env python3
"""Freeze the captured Work cockpit DOM into a standalone page.

Same idea as freeze-dashboard.py, pointed at the cockpit: strip the scripts (a
design tool has no API behind them, and React would re-mount over the frozen
markup and blank the page), inline the stylesheet, keep the markup exactly as
it rendered.
"""
import json
import pathlib
import re

SRC = pathlib.Path.home() / ".claude/skills/claude-design-sync/scripts/dashboard-dom.html"
OUT = pathlib.Path(__file__).with_name("Work Cockpit (live).html")

raw = json.loads(SRC.read_text(encoding="utf-8"))
dom, css = raw["dom"], raw["css"]

dom = re.sub(r"<script\b[^>]*>.*?</script>", "", dom, flags=re.S)
dom = re.sub(r'<link[^>]*rel="stylesheet"[^>]*href="[^"]*style\.css[^"]*"[^>]*>', "", dom)
dom = re.sub(r'<link[^>]*id="lg-fonts-css"[^>]*>', "", dom)

# The home behind the cockpit is another page's design brief, and it doubles the
# file. The cockpit is `position: fixed` over it, so dropping it changes nothing.
dom = re.sub(r'<div class="wrap".*?(?=<div class="wc-page)', "", dom, flags=re.S)

fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700'
         '&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">')
head_close = dom.find("</head>")
dom = dom[:head_close] + fonts + f"<style>\n{css}\n</style>" + dom[head_close:]

banner = ("<!-- Frozen from the running Work cockpit (lgser.me/#work-cockpit, light theme).\n"
          "     Real tickets, real sessions, real counts. Scripts stripped and stylesheet\n"
          "     inlined: static on purpose. This is the UI as it ships today, not a mockup. -->\n")
out = "<!doctype html>\n" + banner + dom
OUT.write_text(out, encoding="utf-8")
print(f"{OUT.name}: {len(out) // 1024} KB")
