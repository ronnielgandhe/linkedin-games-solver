#!/usr/bin/env bash
# Downloads the price sources and rebuilds sunday_trend.csv / sunday_trend.md.
# Sources (all public GitHub repos refreshed by their own GitHub Actions):
#   BTC/USD  1-min candles, Bitstamp            ff137/bitstamp-btcusd-minute-data
#   SOL/USDT 1-hour candles, Binance spot       DaruFinance/quant-research-framework
#   SOL/USD  hourly CoinGecko snapshots          kairenndev/solstate (fills the days
#                                                the Binance file hasn't reached yet)
set -euo pipefail
cd "$(dirname "$0")"
RAW=https://raw.githubusercontent.com
curl -fsSL "$RAW/ff137/bitstamp-btcusd-minute-data/main/data/updates/btcusd_bitstamp_1min_latest.csv" -o data/btcusd_bitstamp_1min.csv
curl -fsSL "$RAW/DaruFinance/quant-research-framework/main/data/SOLUSDT_1h.csv" -o data/solusdt_binance_1h.csv
curl -fsSL "$RAW/kairenndev/solstate/main/history/snapshots.jsonl" -o data/sol_usd_snapshots.jsonl
python3 - <<'PY'
import json, csv
from datetime import datetime, timezone
rows = []
for line in open("data/sol_usd_snapshots.jsonl"):
    line = line.strip()
    if not line:
        continue
    d = json.loads(line)
    t = int(datetime.fromisoformat(d["ts"]).astimezone(timezone.utc).timestamp())
    rows.append((t, d["sol_usd"]))
rows.sort()
with open("data/sol_usd_snapshots.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["timestamp", "open", "close"])
    for t, p in rows:
        w.writerow([t, p, p])
print(f"snapshots: {len(rows)} rows, {datetime.fromtimestamp(rows[0][0], timezone.utc):%Y-%m-%d} -> {datetime.fromtimestamp(rows[-1][0], timezone.utc):%Y-%m-%d}")
PY
python3 sunday_trend.py \
  BTC=data/btcusd_bitstamp_1min.csv \
  SOL=data/solusdt_binance_1h.csv SOL=data/sol_usd_snapshots.csv \
  --since 2025-01-12 --out sunday_trend.csv --md sunday_trend.md
