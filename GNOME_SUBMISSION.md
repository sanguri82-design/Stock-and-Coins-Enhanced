# GNOME Extensions submission checklist

## Project identity

- Name: `Stocks & Coins Enhanced`
- UUID: `stocks-and-coins-enhanced@sanguri82-design.github.io`
- Repository: <https://github.com/sanguri82-design/Stock-and-Coins-Enhanced>
- License: `GPL-3.0-or-later`

## 1. Test the release locally

```bash
make package
gnome-extensions install --force _build/stocks-and-coins-enhanced-extension.zip
```

Log out and back in, then enable **Stocks & Coins Enhanced** in the Extensions application. Verify the panel menu, preferences, stock quotes, cryptocurrency quotes, and candlestick charts.

This fork has a new settings schema, so it starts with separate settings instead of changing the original Stocks Extension settings.

## 2. Push this source to GitHub

This local repository does not currently have a Git remote. Connect and push it with:

```bash
git add -A
git commit -m "Prepare Stocks & Coins Enhanced for GNOME Extensions"
git remote add origin https://github.com/sanguri82-design/Stock-and-Coins-Enhanced.git
git branch -M main
git push -u origin main
```

Do not use a force push if GitHub rejects the push. Resolve any existing remote README or LICENSE commit first.

## 3. Upload to GNOME Extensions

1. Sign in at <https://extensions.gnome.org/>.
2. Open **Add yours**.
3. Upload `_build/stocks-and-coins-enhanced-extension.zip`.
4. Submit it for review.
5. Respond to reviewer comments and upload a rebuilt ZIP if changes are requested.

## Reviewer note

Paste this into the reviewer comments:

```text
This is an independently maintained fork of Stocks Extension:
https://github.com/internetstaff/stocks-extension

It has a new name, UUID, GSettings schema, gettext domain, CSS namespace,
and GObject type namespace, so it can coexist with the original extension.

Original copyright and GPL notices are retained. LICENSE and NOTICE are
included in the submitted archive.

Major changes:
- Added cryptocurrency support using Binance, CoinGecko, Coinbase, and Upbit
- Added candlestick chart representation
- Updated font sizes, colors, and UI presentation

No API keys, telemetry, bundled binaries, or external packages are used.
```

## 4. After approval

Add the new GNOME Extensions page URL to `README.md`, rebuild the ZIP, commit the documentation update, and create a GitHub release using the same ZIP.
