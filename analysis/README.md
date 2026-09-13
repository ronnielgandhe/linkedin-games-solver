# Sunday trend: BTC/USD and SOL/USD from 9:00 AM Eastern

For every Sunday, this folder answers one question: starting from the price at
**9:00 AM Eastern**, was the move to a given evening hour positive or negative?

Everything is in US Eastern local time (EDT in summer, EST in winter), so
"9 AM" is always 9 AM on the clock in New York.

## Files

| File | What it is |
|---|---|
| `sunday_trend.md` | Readable table: one row per Sunday, 9 AM price and the move to 5 PM, 9 PM and midnight for BTC and SOL, plus a tally. |
| `sunday_trend.csv` | Full output: 9 AM price plus the price and percent move at **every** hour from 12 PM to 11 PM and midnight (`price_12`..`price_24`, `pct_12`..`pct_24`). Pick whichever end hour you mean. |
| `sunday_trend.py` | The calculation. Takes candle CSVs, DST-aware, no dependencies beyond Python 3.9+. |
| `fetch_data.sh` | Downloads the sources below into `data/` and rebuilds the two outputs. |
| `data/sol_usd_snapshots.csv` | Small hourly SOL/USD snapshot feed (see caveats). The two large candle files are downloaded, not committed. |

Rebuild with:

```bash
cd analysis && ./fetch_data.sh
```

## Sources

| Asset | Data | Source |
|---|---|---|
| BTC/USD | 1-minute candles, Bitstamp (a true USD market) | [ff137/bitstamp-btcusd-minute-data](https://github.com/ff137/bitstamp-btcusd-minute-data), refreshed nightly by GitHub Actions |
| SOL/USD | 1-hour candles, Binance spot SOL/USDT | [DaruFinance/quant-research-framework](https://github.com/DaruFinance/quant-research-framework) (`data/SOLUSDT_1h.csv`) |
| SOL/USD (recent days) | Hourly CoinGecko price snapshots | [kairenndev/solstate](https://github.com/kairenndev/solstate) (`history/snapshots.jsonl`), refreshed hourly by GitHub Actions |

Exchange APIs (Coinbase, Kraken, Binance, Bitstamp, CoinGecko, Yahoo) are not
reachable from the environment this was built in, so the data comes from public
GitHub repositories that mirror those feeds.

## How the numbers are computed

* 9 AM price = open of the first candle at or after 9:00:00 AM Eastern.
* Price at hour H = open of the first candle at or after H:00 Eastern.
  Midnight uses the candle at 12:00 AM Monday, or the close of the 11 PM candle
  for hourly data.
* Percent move = price at H / 9 AM price - 1.
* A candle is accepted only if it starts within 30 minutes of the target time
  (`--max-gap`), otherwise the cell is left empty.
* `max_offset_min` records the largest such delay used in a row. It is 0 for
  every row except ones built from the snapshot feed.

## Caveats

* SOL is quoted in USDT on Binance rather than USD. The difference is normally a
  few hundredths of a percent, far smaller than any Sunday move in the table.
* The Binance SOL file ends a few days before the run date. The most recent
  Sunday (2026-09-06) is filled from the CoinGecko snapshot feed, whose samples
  land about 25 minutes past each hour, so that row is approximate. Its sign
  was the same (negative) for the 5 PM, 9 PM and midnight windows no matter
  which nearby snapshot is used as the 9 AM reference.
* Only complete Sundays are included. A Sunday in progress shows up after the
  source repositories refresh overnight.
