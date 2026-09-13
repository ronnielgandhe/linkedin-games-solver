#!/usr/bin/env python3
"""
Sunday intraday trend for crypto USD pairs.

For every Sunday, take the price at 9:00 AM US/Eastern (EDT in summer, EST in
winter; DST-aware) and compare it with the price at each later hour of that
Sunday (12 PM .. 11 PM, plus midnight). Reports the percent move and whether
it was positive or negative.

Input CSVs need a unix-seconds `timestamp` (or `time`) column plus `open` and
`close` columns. Minute candles, hourly candles, and price snapshots
(open == close) all work. The same asset name may be given several times; the
files are merged into one series (e.g. exchange candles + a snapshot feed that
covers the most recent days).

Usage:
    python3 sunday_trend.py BTC=btc.csv SOL=sol_1h.csv SOL=sol_snapshots.csv \
        [--since YYYY-MM-DD] [--max-gap MINUTES] [--out out.csv] [--md out.md]
"""
import bisect
import csv
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
START_HOUR = 9
END_HOURS = list(range(12, 24))  # 12 PM .. 11 PM; midnight is handled as hour 24
DEFAULT_MAX_GAP_MIN = 30  # accept the first candle up to this long after the target time


def load(paths):
    rows = []
    for path in paths:
        with open(path, newline="") as f:
            r = csv.DictReader(f)
            cols = {c.lower(): c for c in r.fieldnames}
            tcol = cols.get("timestamp") or cols.get("time") or cols.get("unix")
            ocol, ccol = cols["open"], cols["close"]
            for row in r:
                t = int(float(row[tcol]))
                if t > 10**11:  # milliseconds
                    t //= 1000
                rows.append((t, float(row[ocol]), float(row[ccol])))
    rows.sort()
    return [r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows]


def price_at(series, when_ts, max_gap_s):
    """Open of the first candle starting at/after `when` (within max_gap).
    Returns (price, offset_seconds) or (None, None)."""
    ts, opens, _ = series
    i = bisect.bisect_left(ts, when_ts)
    if i < len(ts) and ts[i] - when_ts <= max_gap_s:
        return opens[i], ts[i] - when_ts
    return None, None


def last_close_before(series, when_ts):
    """Close of the last candle that starts within an hour before `when`."""
    ts, _, closes = series
    i = bisect.bisect_left(ts, when_ts) - 1
    if i >= 0 and when_ts - ts[i] <= 3600:
        return closes[i]
    return None


def sundays_between(first_ts, last_ts):
    d = datetime.fromtimestamp(first_ts, NY).date()
    d += timedelta(days=(6 - d.weekday()) % 7)  # next Sunday (weekday 6)
    last = datetime.fromtimestamp(last_ts, NY).date()
    while d <= last:
        yield d
        d += timedelta(days=7)


def analyze(name, series, since=None, max_gap_min=DEFAULT_MAX_GAP_MIN):
    gap = max_gap_min * 60
    rows = []
    for day in sundays_between(series[0][0], series[0][-1]):
        if since and day.isoformat() < since:
            continue
        start = datetime(day.year, day.month, day.day, START_HOUR, tzinfo=NY)
        p0, off0 = price_at(series, int(start.timestamp()), gap)
        if p0 is None:
            continue
        row = {"sunday": day.isoformat(), "asset": name, "tz": start.tzname(),
               "price_09": p0, "max_offset_min": off0 // 60}
        for h in END_HOURS + [24]:
            t = datetime(day.year, day.month, day.day, tzinfo=NY) + timedelta(hours=h)
            p, off = price_at(series, int(t.timestamp()), gap)
            if p is None and h == 24:  # hourly data: use the 11 PM candle's close
                p, off = last_close_before(series, int(t.timestamp())), 0
            row[f"price_{h:02d}"] = p
            row[f"pct_{h:02d}"] = None if p is None else (p / p0 - 1) * 100
            if off is not None:
                row["max_offset_min"] = max(row["max_offset_min"], off // 60)
        rows.append(row)
    return rows


def sign(v):
    return "n/a" if v is None else ("+" if v > 0 else "-" if v < 0 else "0")


def fmt_pct(v):
    return "n/a" if v is None else f"{v:+.2f}%"


def write_csv(rows, out):
    fields = ["sunday", "asset", "tz", "price_09", "max_offset_min"]
    for h in END_HOURS + [24]:
        fields += [f"price_{h:02d}", f"pct_{h:02d}"]
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if v is None else f"{v:.4f}" if isinstance(v, float) else v)
                        for k, v in r.items()})


def write_md(rows, assets, out):
    by_day = {}
    for r in rows:
        by_day.setdefault(r["sunday"], {})[r["asset"]] = r
    cols = [("17", "5 PM"), ("21", "9 PM"), ("24", "12 AM")]
    with open(out, "w") as f:
        f.write("# Sunday trend from 9:00 AM Eastern\n\n")
        f.write("Move from the 9:00 AM ET price to the price at 5 PM, 9 PM and midnight ET "
                "(local Eastern time, so EDT in summer and EST in winter).\n\n")
        head = "| Sunday |" + "".join(f" {a} 9 AM |" + "".join(f" {a} {lbl} |" for _, lbl in cols)
                                    for a in assets)
        f.write(head + "\n")
        f.write("|" + "---|" * (1 + len(assets) * (1 + len(cols))) + "\n")
        for day in sorted(by_day, reverse=True):
            line = f"| {day} |"
            for a in assets:
                r = by_day[day].get(a)
                if not r:
                    line += " n/a |" * (1 + len(cols)); continue
                line += f" {r['price_09']:,.2f} |"
                for key, _ in cols:
                    v = r[f"pct_{key}"]
                    line += f" {sign(v)} {fmt_pct(v)} |" if v is not None else " n/a |"
            f.write(line + "\n")
        f.write("\n## Tally\n\n| Asset | Window | Up | Down | Flat | Avg move |\n|---|---|---|---|---|---|\n")
        for a in assets:
            for key, lbl in cols:
                vals = [r[f"pct_{key}"] for r in rows if r["asset"] == a and r[f"pct_{key}"] is not None]
                up = sum(v > 0 for v in vals); down = sum(v < 0 for v in vals)
                avg = sum(vals) / len(vals) if vals else 0
                f.write(f"| {a} | 9 AM -> {lbl} | {up} | {down} | {len(vals) - up - down} | {avg:+.2f}% |\n")


def main(argv):
    out, md, since, max_gap = "sunday_trend.csv", None, None, DEFAULT_MAX_GAP_MIN
    inputs = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            print(__doc__); return 0
        if a == "--out":
            out = argv[i + 1]; i += 2; continue
        if a == "--md":
            md = argv[i + 1]; i += 2; continue
        if a == "--since":
            since = argv[i + 1]; i += 2; continue
        if a == "--max-gap":
            max_gap = int(argv[i + 1]); i += 2; continue
        name, path = a.split("=", 1)
        inputs.setdefault(name, []).append(path)
        i += 1
    if not inputs:
        print(__doc__); return 1

    assets = list(inputs)
    all_rows = []
    for name in assets:
        all_rows += analyze(name, load(inputs[name]), since, max_gap)
    all_rows.sort(key=lambda r: (r["sunday"], r["asset"]))
    write_csv(all_rows, out)
    if md:
        write_md(all_rows, assets, md)

    print(f"{'Sunday':<11} {'Asset':<5} {'9AM':>10} {'5PM':>8} {'9PM':>8} {'12AM':>8}   5PM 9PM 12AM  offset")
    for r in all_rows:
        print(f"{r['sunday']:<11} {r['asset']:<5} {r['price_09']:>10.2f} "
              f"{fmt_pct(r['pct_17']):>8} {fmt_pct(r['pct_21']):>8} {fmt_pct(r['pct_24']):>8}   "
              f"{sign(r['pct_17']):^3} {sign(r['pct_21']):^3} {sign(r['pct_24']):^4}  "
              f"{r['max_offset_min']:>3}m")
    for name in assets:
        for key, label in (("17", "9AM->5PM"), ("21", "9AM->9PM"), ("24", "9AM->midnight")):
            vals = [r[f"pct_{key}"] for r in all_rows if r["asset"] == name and r[f"pct_{key}"] is not None]
            up = sum(v > 0 for v in vals)
            print(f"{name} {label}: {up} up / {len(vals) - up} down of {len(vals)} Sundays; "
                  f"avg {sum(vals) / len(vals):+.2f}%" if vals else f"{name} {label}: no data")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
