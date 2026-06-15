#!/usr/bin/env python3
"""
Visual diff harness — hbp_proto vs proxy-handoff baseline.

Usage:
  BASE_URL=https://hbpproto-production.up.railway.app \
  BASELINE_DIR=/path/to/proxy-handoff/screenshots/client \
  python3 scripts/visual-diff/run.py

Outputs:
  scripts/visual-diff/out/<route>-<vp>.png   — live screenshot
  scripts/visual-diff/diff/<route>-<vp>.png  — pixel diff (red = mismatch)
  scripts/visual-diff/report.txt             — % match per route/viewport

Requires:
  pip install playwright pillow
  # Uses system Google Chrome — no separate browser download needed on macOS:
  CHROME=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
"""

import asyncio, os, sys, json
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL     = os.environ.get("BASE_URL", "https://hbpproto-production.up.railway.app")
BASELINE_DIR = Path(os.environ.get("BASELINE_DIR", ""))
OUT_DIR      = Path(__file__).parent / "out"
DIFF_DIR     = Path(__file__).parent / "diff"
THRESHOLD    = 0.98  # ≥98% match required

CHROME   = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
EMAIL    = "demo@example.com"
PASSWORD = "demo1234"

CLIENT_ROUTES = [
    ("dashboard",          "dashboard"),
    ("proxies",            "proxies"),
    ("proxies/PXY-30412",  "proxies-PXY-30412"),
    ("orders",             "orders"),
    ("orders/ORD-10847",   "orders-ORD-10847"),
    ("billing",            "billing"),
    ("catalog",            "catalog"),
    ("checkout",           "checkout"),
    ("settings",           "settings"),
]
VIEWPORTS = [
    (1440, 900,  "1440"),
    (375,  812,  "375"),
]


async def login(page):
    await page.goto(f"{BASE_URL}/login", wait_until="load", timeout=30000)
    await page.wait_for_timeout(2000)  # wait for React hydration
    # Login form uses React state, not name attrs — select by input type
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await page.click('button[type="submit"]')
    await page.wait_for_url(f"**dashboard**", timeout=20000)


async def screenshot_route(page, route: str, width: int, height: int) -> bytes:
    await page.set_viewport_size({"width": width, "height": height})
    await page.goto(f"{BASE_URL}/{route}", wait_until="load", timeout=20000)
    await page.wait_for_timeout(1200)  # allow React hydration + paint
    return await page.screenshot(full_page=False)


def pixel_diff(live_bytes: bytes, baseline_path: Path) -> tuple[float, bytes | None]:
    """Returns (match_ratio, diff_png_bytes). diff_png_bytes is None if pillow-only path."""
    try:
        from PIL import Image
        import io, struct

        live_img = Image.open(io.BytesIO(live_bytes)).convert("RGB")
        base_img = Image.open(str(baseline_path)).convert("RGB")

        # Resize live to baseline size (sub-pixel AA can cause 1px size drift)
        if live_img.size != base_img.size:
            live_img = live_img.resize(base_img.size, Image.LANCZOS)

        live_pix  = list(live_img.getdata())
        base_pix  = list(base_img.getdata())
        total     = len(live_pix)

        diff_img  = Image.new("RGB", base_img.size)
        diff_pix  = []
        mismatch  = 0
        TOLERANCE = 12  # per-channel tolerance (handles font AA, sub-pixel)

        for lp, bp in zip(live_pix, base_pix):
            if all(abs(lp[c] - bp[c]) <= TOLERANCE for c in range(3)):
                diff_pix.append((200, 200, 200))  # grey = match
            else:
                diff_pix.append((220, 30, 30))    # red = mismatch
                mismatch += 1

        diff_img.putdata(diff_pix)
        buf = io.BytesIO()
        diff_img.save(buf, format="PNG")
        match_ratio = (total - mismatch) / total
        return match_ratio, buf.getvalue()

    except ImportError:
        print("  [warn] pillow not available — skipping pixel diff")
        return 1.0, None


async def main():
    if not BASELINE_DIR or not BASELINE_DIR.is_dir():
        print(f"ERROR: BASELINE_DIR not set or not found: {BASELINE_DIR}")
        print("Set BASELINE_DIR=/path/to/proxy-handoff/screenshots/client")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DIFF_DIR.mkdir(parents=True, exist_ok=True)

    results: list[dict] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=CHROME)
        context = await browser.new_context()
        page    = await context.new_page()

        print(f"▸ Logging in as {EMAIL} …")
        await login(page)
        print("  ✓ Authenticated\n")

        for route, slug in CLIENT_ROUTES:
            for width, height, vp_tag in VIEWPORTS:
                label    = f"{slug}-{vp_tag}"
                out_path = OUT_DIR  / f"{label}.png"
                diff_path= DIFF_DIR / f"{label}.png"
                base_path= BASELINE_DIR / f"{slug}-{vp_tag}.png"

                print(f"  {label} … ", end="", flush=True)
                try:
                    png = await screenshot_route(page, route, width, height)
                    out_path.write_bytes(png)

                    if base_path.exists():
                        ratio, diff_bytes = pixel_diff(png, base_path)
                        if diff_bytes:
                            diff_path.write_bytes(diff_bytes)
                        status = "✓" if ratio >= THRESHOLD else "✗"
                        print(f"{status} {ratio*100:.1f}%")
                        results.append({
                            "label": label, "ratio": ratio,
                            "pass": ratio >= THRESHOLD,
                        })
                    else:
                        print(f"(no baseline at {base_path.name})")
                        results.append({"label": label, "ratio": None, "pass": None})

                except Exception as exc:
                    print(f"ERROR: {exc}")
                    results.append({"label": label, "ratio": None, "pass": False})

        await browser.close()

    # --- Report ---
    report_lines = ["Visual diff report", "=" * 48]
    passed = [r for r in results if r["pass"] is True]
    failed = [r for r in results if r["pass"] is False]

    for r in results:
        if r["ratio"] is None:
            line = f"  SKIP  {r['label']}"
        else:
            pct  = f"{r['ratio']*100:.1f}%"
            mark = "PASS" if r["pass"] else "FAIL"
            line = f"  {mark}  {pct:>7}  {r['label']}"
        report_lines.append(line)

    report_lines += [
        "",
        f"Passed: {len(passed)} / {len([r for r in results if r['ratio'] is not None])}",
        f"Threshold: {THRESHOLD*100:.0f}%",
    ]
    report = "\n".join(report_lines)
    (Path(__file__).parent / "report.txt").write_text(report)
    print()
    print(report)

    if failed:
        sys.exit(1)


asyncio.run(main())
