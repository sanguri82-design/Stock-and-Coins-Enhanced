# Stocks & Coins Enhanced

Stocks & Coins Enhanced displays stock and cryptocurrency quotes in the GNOME Shell panel. It supports portfolios, transactions, configurable ticker presentation, and candlestick charts.

This project is an independently maintained fork of [Stocks Extension](https://github.com/internetstaff/stocks-extension). It uses its own name, UUID, settings schema, and release channel; it does not replace the original extension.

## Features

- Stock quotes from Yahoo Finance and Eastmoney
- Cryptocurrency quotes from Binance, CoinGecko, Coinbase, and Upbit
- Candlestick price charts
- Custom portfolios and transaction tracking
- Configurable font sizes, colors, ticker position, and refresh interval

Market data comes from third-party services and may be delayed or unavailable. This extension is for informational purposes only and is not financial advice.

## Installation

### GNOME Extensions

After approval, the public GNOME Extensions page will be linked here.

### Release package

Download a ZIP from the [releases page](https://github.com/sanguri82-design/Stock-and-Coins-Enhanced/releases), then install it with:

```bash
gnome-extensions install --force stocks-and-coins-enhanced-extension.zip
```

Log out and back in if GNOME Shell does not immediately recognize the extension.

### Build from source

```bash
git clone https://github.com/sanguri82-design/Stock-and-Coins-Enhanced.git
cd Stock-and-Coins-Enhanced
make package
```

The upload-ready archive is created at:

```text
_build/stocks-and-coins-enhanced-extension.zip
```

## Adding stocks or coins

1. Open the extension settings.
2. Add or select a portfolio.
3. Select the add button in the symbol list.
4. Choose Stock or Coin and select a provider.
5. Enter the provider-specific symbol or ID and a display name.

Examples include `BTCUSDT` for Binance, `bitcoin` for CoinGecko, `BTC-USD` for Coinbase, and `KRW-BTC` for Upbit.

## Development

Run an isolated GNOME Shell development session with:

```bash
dbus-run-session -- gnome-shell --devkit --wayland
```

## Origin and license

The original project is **Stocks Extension**, hosted at <https://github.com/internetstaff/stocks-extension> and originally published at <https://extensions.gnome.org/extension/1422/stocks-extension/>.

Original copyright notices, including the notice for Florijan Hamzic, are retained in the source. This fork was modified by sanguri82-design in 2026 to add cryptocurrency providers, candlestick charts, and visual changes.

This project is distributed under the GNU General Public License version 3 or later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
