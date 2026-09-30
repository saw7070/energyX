"""Generate TypeScript analysis dataset from EliteIOT Office Excel file."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT.parent / "EliteIOT Office (15 June - 29 June).xlsx"
OUT_PATH = ROOT / "src" / "mock" / "eliteiotEnergyAnalysisData.ts"

ELITE_PROJECT_ID = "proj-eliteiot-energy-analysis"
ELITE_PROJECT_NAME = "EliteIOT"

REFERENCE_TARIFF_CENTS_PER_KWH: dict[str, float] = {
    "2026-06": 29.72,
}
REFERENCE_TARIFF_DEFAULT_CENTS_PER_KWH = 29.72

TAG_COLORS = {
    "F&B": "#C68656",
    "Lighting": "#4F9B86",
    "IT Devices": "#5B8BCF",
    "General Plug": "#9A8DBF",
}

NAP_HOURLY_CATEGORIES = ["Lighting", "Office Load", "Ventilation/Fan"]
ELITE_CATEGORIES = [
    "F&B",
    "Lighting",
    "IT Devices",
    "General Plug",
]

ELITE_CATEGORY_SCOPES: list[tuple[str, str, str | None]] = [
    ("incoming", "Incoming 3Phase", None),
    ("fnb", "F&B", "F&B"),
    ("lighting", "Lighting", "Lighting"),
    ("it_devices", "IT Devices", "IT Devices"),
    ("general_plug", "General Plug", "General Plug"),
]

ELITE_CATEGORY_TO_CHART_KEY = {
    "F&B": "fnb",
    "Lighting": "lighting",
    "IT Devices": "it_devices",
    "General Plug": "general_plug",
}

METER_META: dict[str, tuple[str, int]] = {
    "Incoming 3Phase": ("Incoming Source", 0),
    "A18P": ("F&B", 6),
    "B3B": ("F&B", 6),
    "B8P": ("F&B", 6),
    "B9P": ("F&B", 6),
    "B2R": ("Lighting", 6),
    "B11P": ("Lighting", 6),
    "B5B": ("IT Devices", 7),
    "B4B": ("IT Devices", 7),
    "B6B": ("General Plug", 7),  # Excel device code
    "B6P": ("General Plug", 7),  # Business mapping alias
}

ZONE_LABELS = {6: "F&B + Lighting", 7: "IT Devices + General Plug"}
MY_PUBLIC_HOLIDAYS: dict[str, str] = {
    "2026-06-17": "Hari Raya Haji",
}


def round1(value: float) -> float:
    return round(float(value), 1)


def round2(value: float) -> float:
    return round(float(value), 2)


def round2_money(value: float) -> float:
    return round(float(value), 2)


def tariff_sgd_for_month(month_key: str) -> float:
    cents = REFERENCE_TARIFF_CENTS_PER_KWH.get(month_key, REFERENCE_TARIFF_DEFAULT_CENTS_PER_KWH)
    return cents / 100.0


def resolve_day_type(date_val) -> str:
    ts = pd.Timestamp(date_val)
    date_str = ts.strftime("%Y-%m-%d")
    if date_str in MY_PUBLIC_HOLIDAYS:
        return "holiday"
    if ts.weekday() >= 5:
        return "weekend"
    return "weekday"


def load_elite_excel(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path)
    df.columns = ["device", "time", "kwh"]
    df = df.dropna(subset=["device", "time", "kwh"])
    df["device"] = df["device"].astype(str)
    df = df[df["device"].str.lower() != "device name"]
    df = df.drop_duplicates(subset=["device", "time"], keep="first")
    df["time"] = pd.to_datetime(df["time"])
    df = df.sort_values(["device", "time"])
    df["delta_kwh"] = df.groupby("device")["kwh"].diff()
    df = df.dropna(subset=["delta_kwh"])
    df["date"] = df["time"].dt.date
    df["hour"] = df["time"].dt.hour
    df["weekday"] = df["time"].dt.weekday
    df["day_type"] = df["date"].apply(resolve_day_type)
    df["category"] = df["device"].map(lambda name: METER_META.get(name, ("Other", 7))[0])
    df["level"] = df["device"].map(lambda name: METER_META.get(name, ("Other", 7))[1])
    return df


def format_clock_hour_window(date, hour: int) -> str:
    date_str = pd.Timestamp(date).strftime("%Y-%m-%d")
    end_hour = hour + 1
    return f"{date_str} {hour:02d}:00-{end_hour:02d}:00"


def compute_aggregate_hourly_totals(totals: pd.DataFrame) -> pd.DataFrame:
    return (
        totals.groupby(["date", "hour"], as_index=False)["delta_kwh"]
        .sum()
        .rename(columns={"delta_kwh": "kwh"})
    )


def compute_peak_metrics(totals: pd.DataFrame) -> tuple[float, str, pd.Timestamp]:
    hourly = compute_aggregate_hourly_totals(totals)
    if hourly.empty:
        return 0.0, "", pd.Timestamp.now()
    best = hourly.loc[hourly["kwh"].idxmax()]
    peak_value = round1(float(best["kwh"]))
    hour = int(best["hour"])
    date = best["date"]
    peak_start = pd.Timestamp(pd.Timestamp(date).strftime("%Y-%m-%d") + f" {hour:02d}:00")
    peak_window = format_clock_hour_window(date, hour)
    return peak_value, peak_window, peak_start


def aggregate_elite_daily(incoming: pd.DataFrame, subs: pd.DataFrame) -> pd.DataFrame:
    inc = incoming.groupby("date")["delta_kwh"].sum()
    l6 = subs[subs["level"] == 6].groupby("date")["delta_kwh"].sum()
    l7 = subs[subs["level"] == 7].groupby("date")["delta_kwh"].sum()
    dates = sorted(set(inc.index) | set(l6.index) | set(l7.index))
    rows = []
    for date in dates:
        rows.append(
            {
                "date": date,
                "total": float(inc.get(date, 0.0)),
                "level6": float(l6.get(date, 0.0)),
                "level7": float(l7.get(date, 0.0)),
            }
        )
    daily = pd.DataFrame(rows)
    daily["date_str"] = daily["date"].astype(str)
    daily["short_label"] = daily["date"].apply(lambda d: d.strftime("%m/%d"))
    daily["day_type"] = daily["date"].apply(resolve_day_type)
    return daily


def aggregate_scope_daily(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["date", "total", "level6", "level7", "date_str", "short_label", "day_type"])
    daily = frame.groupby("date", as_index=False)["delta_kwh"].sum().rename(columns={"delta_kwh": "total"})
    daily["level6"] = 0.0
    daily["level7"] = 0.0
    daily["date_str"] = daily["date"].astype(str)
    daily["short_label"] = daily["date"].apply(lambda d: pd.Timestamp(d).strftime("%m/%d"))
    daily["day_type"] = daily["date"].apply(resolve_day_type)
    return daily


def build_single_scope_baseline(daily: pd.DataFrame) -> dict:
    scope_means: dict[str, float] = {}
    scope_counts: dict[str, int] = {}
    for day_type in ["weekday", "weekend", "holiday"]:
        subset = daily[daily["day_type"] == day_type]
        scope_counts[day_type] = int(len(subset))
        scope_means[day_type] = round1(subset["total"].mean()) if len(subset) else 0.0
    return {
        **scope_means,
        "weekdayCount": scope_counts["weekday"],
        "weekendCount": scope_counts["weekend"],
        "holidayCount": scope_counts["holiday"],
    }


def build_scope_daily_rows(daily: pd.DataFrame, type_means: dict[str, float]) -> list[dict]:
    daily_mean = daily["total"].mean() if len(daily) else 0.0
    rows = []
    for _, row in daily.iterrows():
        expected = round1(type_means.get(row["day_type"], daily_mean))
        threshold = round1(expected * 1.15)
        total = round1(row["total"])
        rows.append(
            {
                "date": row["date_str"],
                "shortLabel": row["short_label"],
                "dayType": row["day_type"],
                "total": total,
                "level6": 0.0,
                "level7": 0.0,
                "expected": expected,
                "threshold": threshold,
                "anomaly": total > threshold,
                "deltaPct": round2(((total - expected) / expected * 100) if expected else 0),
            }
        )
    return rows


def build_scope_daily_hourly(frame: pd.DataFrame) -> dict[str, list]:
    by_date: dict[str, list] = {}
    if frame.empty:
        return by_date
    for date_val in sorted(frame["date"].unique()):
        date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
        day_frame = frame[frame["date"] == date_val]
        rows = []
        for hour in range(24):
            kwh = float(day_frame.loc[day_frame["hour"] == hour, "delta_kwh"].sum())
            rows.append({"hour": f"{hour:02d}", "total": round2(kwh)})
        by_date[date_str] = rows
    return by_date


def build_profile_hourly_by_day_type(frame: pd.DataFrame) -> dict[str, list]:
    return {
        "weekday": hourly_profile_total(frame[frame["day_type"] == "weekday"]),
        "weekend": hourly_profile_total(frame[frame["day_type"] == "weekend"]),
        "holiday": hourly_profile_total(frame[frame["day_type"] == "holiday"]),
    }


def build_elite_daily_category_splits(subs: pd.DataFrame) -> dict[str, dict[str, float]]:
    splits: dict[str, dict[str, float]] = {}
    for date_val in sorted(subs["date"].unique()):
        date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
        day_subs = subs[subs["date"] == date_val]
        splits[date_str] = {
            "fnb": round1(day_subs.loc[day_subs["category"] == "F&B", "delta_kwh"].sum()),
            "lighting": round1(day_subs.loc[day_subs["category"] == "Lighting", "delta_kwh"].sum()),
            "it_devices": round1(day_subs.loc[day_subs["category"] == "IT Devices", "delta_kwh"].sum()),
            "general_plug": round1(day_subs.loc[day_subs["category"] == "General Plug", "delta_kwh"].sum()),
        }
    return splits


def build_elite_category_chart_rows(subs: pd.DataFrame, daily_labels: dict[str, str]) -> list[dict]:
    rows = []
    for date_val in sorted(subs["date"].unique()):
        date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
        day_subs = subs[subs["date"] == date_val]
        fnb = round1(day_subs.loc[day_subs["category"] == "F&B", "delta_kwh"].sum())
        lighting = round1(day_subs.loc[day_subs["category"] == "Lighting", "delta_kwh"].sum())
        it_devices = round1(day_subs.loc[day_subs["category"] == "IT Devices", "delta_kwh"].sum())
        general_plug = round1(day_subs.loc[day_subs["category"] == "General Plug", "delta_kwh"].sum())
        total = round1(fnb + lighting + it_devices + general_plug)
        rows.append(
            {
                "label": daily_labels.get(date_str, pd.Timestamp(date_val).strftime("%m/%d")),
                "fnb": fnb,
                "lighting": lighting,
                "it_devices": it_devices,
                "general_plug": general_plug,
                "total": total,
            }
        )
    return rows


def build_elite_category_scopes(
    incoming: pd.DataFrame,
    subs: pd.DataFrame,
) -> dict[str, dict]:
    scopes: dict[str, dict] = {}
    for scope_key, label, category_filter in ELITE_CATEGORY_SCOPES:
        frame = incoming if scope_key == "incoming" else subs[subs["category"] == category_filter]
        daily_frame = aggregate_scope_daily(frame)
        baseline_scope = build_single_scope_baseline(daily_frame)
        daily_rows = build_scope_daily_rows(daily_frame, baseline_scope)
        devices = (
            ["Incoming 3Phase"]
            if scope_key == "incoming"
            else sorted(frame["device"].unique().tolist())
        )
        scopes[scope_key] = {
            "label": label,
            "category": category_filter or "Incoming Source",
            "devices": devices,
            "periodTotalKwh": round1(frame["delta_kwh"].sum()) if not frame.empty else 0.0,
            "baselineMeta": baseline_scope,
            "dailyTotals": daily_rows,
            "profileHourlyByDayType": build_profile_hourly_by_day_type(frame),
            "dailyHourlyByDate": build_scope_daily_hourly(frame),
        }
    return scopes


def build_baseline_meta(baseline_daily: pd.DataFrame, period_start: str, period_end: str) -> dict:
    scopes = {"all": "total", "level6": "level6", "level7": "level7"}
    by_scope: dict[str, dict] = {}
    for scope_key, column in scopes.items():
        scope_means: dict[str, float] = {}
        scope_counts: dict[str, int] = {}
        for day_type in ["weekday", "weekend", "holiday"]:
            subset = baseline_daily[baseline_daily["day_type"] == day_type]
            scope_counts[day_type] = int(len(subset))
            scope_means[day_type] = round1(subset[column].mean()) if len(subset) else 0.0
        by_scope[scope_key] = {
            **scope_means,
            "weekdayCount": scope_counts["weekday"],
            "weekendCount": scope_counts["weekend"],
            "holidayCount": scope_counts["holiday"],
        }
    return {
        "periodStart": period_start,
        "periodEnd": period_end,
        "dayCount": int(len(baseline_daily)),
        "byScope": by_scope,
    }


def build_daily_rows(daily: pd.DataFrame, type_means: dict[str, float]) -> list[dict]:
    daily_mean = daily["total"].mean() if len(daily) else 0.0
    rows = []
    for _, row in daily.iterrows():
        expected = round1(type_means.get(row["day_type"], daily_mean))
        threshold = round1(expected * 1.15)
        total = round1(row["total"])
        rows.append(
            {
                "date": row["date_str"],
                "shortLabel": row["short_label"],
                "dayType": row["day_type"],
                "total": total,
                "level6": round1(row["level6"]),
                "level7": round1(row["level7"]),
                "expected": expected,
                "threshold": threshold,
                "anomaly": total > threshold,
                "deltaPct": round2(((total - expected) / expected * 100) if expected else 0),
            }
        )
    return rows


def compute_period_estimated_cost(daily_rows: list[dict]) -> dict:
    monthly_kwh: dict[str, float] = {}
    for row in daily_rows:
        month_key = row["date"][:7]
        monthly_kwh[month_key] = monthly_kwh.get(month_key, 0.0) + row["total"]
    monthly_breakdown = []
    total_cost = 0.0
    total_kwh = 0.0
    for month_key in sorted(monthly_kwh.keys()):
        kwh = monthly_kwh[month_key]
        tariff = tariff_sgd_for_month(month_key)
        cost = round2_money(kwh * tariff)
        total_cost += cost
        total_kwh += kwh
        monthly_breakdown.append(
            {
                "month": month_key,
                "label": pd.Timestamp(f"{month_key}-01").strftime("%b %Y"),
                "kwh": round1(kwh),
                "tariffCentsInclGst": REFERENCE_TARIFF_CENTS_PER_KWH.get(
                    month_key, REFERENCE_TARIFF_DEFAULT_CENTS_PER_KWH
                ),
                "costSgd": cost,
            }
        )
    return {"totalSgd": round2_money(total_cost), "monthly": monthly_breakdown}


def map_elite_to_nap_category(category: str) -> str:
    if category == "Lighting":
        return "Lighting"
    if category == "IT Devices" or category == "General Plug":
        return "Ventilation/Fan"
    return "Office Load"


def hourly_by_category_filtered(filtered: pd.DataFrame) -> list[dict]:
    rows = []
    for hour in range(24):
        hour_df = filtered[filtered["hour"] == hour]
        row = {"hour": f"{hour:02d}"}
        for nap_cat in NAP_HOURLY_CATEGORIES:
            key = nap_cat.replace(" ", "_").replace("/", "_")
            values = []
            for elite_cat in ELITE_CATEGORIES:
                if map_elite_to_nap_category(elite_cat) != nap_cat:
                    continue
                subset = hour_df.loc[hour_df["category"] == elite_cat, "delta_kwh"]
                if len(subset):
                    values.append(float(subset.mean()))
            row[key] = round2(sum(values) / len(values) if values else 0)
        row["total"] = round2(hour_df["delta_kwh"].mean() if len(hour_df) else 0)
        rows.append(row)
    return rows


def hourly_profile_total(filtered: pd.DataFrame) -> list[dict]:
    if filtered.empty:
        return [{"hour": f"{hour:02d}", "total": 0} for hour in range(24)]
    dates = filtered["date"].unique()
    hour_sums = {hour: 0.0 for hour in range(24)}
    for date in dates:
        day_df = filtered[filtered["date"] == date]
        for hour in range(24):
            hour_sums[hour] += day_df.loc[day_df["hour"] == hour, "delta_kwh"].sum()
    day_count = len(dates)
    return [
        {"hour": f"{hour:02d}", "total": round2(hour_sums[hour] / day_count if day_count else 0)}
        for hour in range(24)
    ]


def is_light_meter(device: str, category: str) -> bool:
    return category == "Lighting" or "light" in device.lower()


def elite_meter_group(category: str) -> str:
    return "light" if category == "Lighting" else "load"


ELITE_HIGHLIGHT_LEVELS: list[tuple[int, str, str, bool]] = [
    (0, "Incoming 3Phase", "Incoming Source", True),
    (1, "F&B", "F&B", False),
    (2, "Lighting", "Lighting", False),
    (3, "IT Devices", "IT Devices", False),
    (4, "General Plug", "General Plug", False),
]


def build_elite_consumption_tree(incoming: pd.DataFrame, subs: pd.DataFrame, scale: float = 1.0) -> dict:
    def scaled_sum(subframe: pd.DataFrame) -> float:
        if subframe.empty:
            return 0.0
        return round1(subframe["delta_kwh"].sum() * scale)

    levels = []
    for level_num, label, cat_filter, is_incoming in ELITE_HIGHLIGHT_LEVELS:
        if is_incoming:
            total = scaled_sum(incoming)
            aggregates = [
                {
                    "name": "Incoming 3Phase",
                    "kwh": total,
                    "group": elite_meter_group(cat_filter),
                    "category": cat_filter,
                }
            ]
            sub_meters: list[dict] = []
        else:
            level_sub = subs[subs["category"] == cat_filter]
            total = scaled_sum(level_sub)
            aggregates = []
            sub_meters = []
            for device in sorted(level_sub["device"].unique()):
                device_rows = level_sub[level_sub["device"] == device]
                category = str(device_rows["category"].iloc[0])
                sub_meters.append(
                    {
                        "name": device,
                        "kwh": scaled_sum(device_rows),
                        "group": elite_meter_group(category),
                        "category": category,
                    }
                )
        levels.append(
            {
                "name": label,
                "level": level_num,
                "totalKwh": total,
                "aggregates": aggregates,
                "subMeters": sub_meters,
            }
        )

    return {"totalKwh": scaled_sum(incoming), "levels": levels}


def build_elite_peak_breakdown_tree(frame: pd.DataFrame) -> dict:
    incoming = frame[frame["category"] == "Incoming Source"]
    subs = frame[frame["category"] != "Incoming Source"]

    def sum_frame(subframe: pd.DataFrame) -> float:
        return round1(subframe["delta_kwh"].sum()) if not subframe.empty else 0.0

    levels = []
    for level_num, label, cat_filter, is_incoming in ELITE_HIGHLIGHT_LEVELS:
        if is_incoming:
            continue
        level_sub = subs[subs["category"] == cat_filter]
        sub_meters = []
        for device in sorted(level_sub["device"].unique()):
            device_rows = level_sub[level_sub["device"] == device]
            category = str(device_rows["category"].iloc[0])
            sub_meters.append(
                {
                    "name": device,
                    "kwh": sum_frame(device_rows),
                    "group": elite_meter_group(category),
                    "category": category,
                }
            )
        sub_meters.sort(key=lambda item: item["name"])
        levels.append(
            {
                "name": label,
                "level": level_num,
                "totalKwh": sum_frame(level_sub),
                "aggregates": [],
                "subMeters": sub_meters,
            }
        )
    return {"totalKwh": sum_frame(incoming), "levels": levels}


def build_consumption_tree(incoming: pd.DataFrame, subs: pd.DataFrame, scale: float = 1.0) -> dict:
    return build_elite_consumption_tree(incoming, subs, scale=scale)


def build_peak_breakdown_tree(frame: pd.DataFrame) -> dict:
    return build_elite_peak_breakdown_tree(frame)


def build_clock_hour_frame(all_df: pd.DataFrame, date, hour: int) -> pd.DataFrame:
    day = pd.Timestamp(date).strftime("%Y-%m-%d")
    hour_times = [
        pd.Timestamp(f"{day} {hour:02d}:00") + pd.Timedelta(minutes=15 * index) for index in range(4)
    ]
    return all_df[all_df["time"].isin(hour_times)].copy()


def compute_top_clock_hour_peaks(totals: pd.DataFrame, limit: int = 5) -> list[dict]:
    hourly = compute_aggregate_hourly_totals(totals).sort_values("kwh", ascending=False).head(limit)
    peaks: list[dict] = []
    for _, row in hourly.iterrows():
        hour = int(row["hour"])
        date = row["date"]
        peaks.append(
            {
                "kwh": round1(float(row["kwh"])),
                "date": pd.Timestamp(date).strftime("%Y-%m-%d"),
                "hour": hour,
                "window": format_clock_hour_window(date, hour),
            }
        )
    return peaks


def build_top_peaks(all_df: pd.DataFrame, totals: pd.DataFrame) -> list[dict]:
    top_peaks = []
    for rank, peak in enumerate(compute_top_clock_hour_peaks(totals, 5), start=1):
        frame = build_clock_hour_frame(all_df, peak["date"], peak["hour"])
        tree = build_peak_breakdown_tree(frame)
        top_peaks.append(
            {
                "rank": rank,
                "kwh": peak["kwh"],
                "window": peak["window"],
                "date": peak["date"],
                "totalKwh": tree["totalKwh"],
                "levels": tree["levels"],
            }
        )
    return top_peaks


def build_findings(
    period_start: str,
    period_end: str,
    day_count: int,
    incoming_total: float,
    sub_total: float,
    l6_total: float,
    l7_total: float,
    weekday_avg: float,
    weekend_avg: float,
    appliance_distribution: list[dict],
    circuit_rows: list[dict],
    after_hours: float,
    wd_total: float,
    office_hours: float,
    top_days: list[dict],
    anomaly_days: list[dict],
    baseline_meta: dict,
    peak_window: str,
    peak_value: float,
) -> list[dict]:
    coverage_pct = round1(sub_total / incoming_total * 100) if incoming_total else 0.0
    tag_text = ", ".join(f"{row['tag']} {row['percentage']}%" for row in appliance_distribution)
    baseline = baseline_meta["byScope"]["all"]
    peak_day = top_days[0] if top_days else None
    holiday_rows = [row for row in anomaly_days if row["dayType"] == "holiday"]
    holiday_note = "Holiday profile includes 2026-06-17 (Hari Raya Haji)." if baseline["holidayCount"] else "No holiday samples in monitoring window."

    sections = [
        {
            "title": "Monitoring scope",
            "items": [
                (
                    f"Period {period_start} to {period_end} ({day_count} days): "
                    f"{incoming_total:,.1f} kWh on incoming meter (Incoming 3Phase)."
                ),
                (
                    f"Sub-meter coverage: {sub_total:,.1f} kWh ({coverage_pct}% of incoming). "
                    "Unmetered load includes HVAC, lifts, and other circuits not on listed sub-meters."
                ),
                (
                    f"Anomaly baseline uses this monitoring window only ({baseline_meta['dayCount']} days): "
                    f"weekday {baseline['weekday']} kWh/day, weekend {baseline['weekend']} kWh/day, "
                    f"holiday {baseline['holiday']} kWh/day. No prior-period comparison is available."
                ),
            ],
        },
        {
            "title": "Consumption by type group (sub-meters)",
            "items": [
                (
                    f"F&B + Lighting: {l6_total:,.1f} kWh "
                    f"({round1(l6_total / sub_total * 100) if sub_total else 0}% of sub-metered load)."
                ),
                (
                    f"IT Devices + General Plug: {l7_total:,.1f} kWh "
                    f"({round1(l7_total / sub_total * 100) if sub_total else 0}% of sub-metered load)."
                ),
                (
                    f"Incoming daily averages: weekday {weekday_avg} kWh/day, "
                    f"weekend {weekend_avg} kWh/day (weekend ~{round1((1 - weekend_avg / weekday_avg) * 100) if weekday_avg else 0}% lower)."
                ),
            ],
        },
        {
            "title": "Category mix (sub-meters)",
            "items": [
                f"Tag split over sub-metered circuits: {tag_text}.",
                (
                    f"Highest circuit: {circuit_rows[0]['name']} "
                    f"({circuit_rows[0]['consumption']:,.1f} kWh, {circuit_rows[0]['category']})."
                ),
                "B6P/B6B (General Plug) is treated as unknown plug load and should be validated on-site when persistent standby is observed.",
            ],
        },
        {
            "title": "Day-type & hourly behaviour",
            "items": [
                (
                    f"Weekday office hours (08:00–18:00) on incoming: {round1(office_hours):,.1f} kWh "
                    f"({round1(office_hours / wd_total * 100) if wd_total else 0}% of weekday incoming total)."
                ),
                (
                    f"Weekday after-hours (22:00–06:00): {round1(after_hours):,.1f} kWh "
                    f"({round1(after_hours / wd_total * 100) if wd_total else 0}% of weekday incoming)."
                ),
                holiday_note,
            ],
        },
        {
            "title": "Peaks & anomalies",
            "items": [
                (
                    f"Highest daily incoming total: {peak_day['date']} at {peak_day['total']} kWh "
                    f"(sub-meter groups: F&B + Lighting {peak_day['level6']} kWh · IT Devices + General Plug {peak_day['level7']} kWh)."
                    if peak_day
                    else "Peak daily total not available."
                ),
                f"Peak clock-hour demand on incoming: {peak_value} kWh in window {peak_window}.",
            ],
        },
    ]

    if anomaly_days:
        weekday_anomalies = [row for row in anomaly_days if row["dayType"] == "weekday"]
        weekend_anomalies = [row for row in anomaly_days if row["dayType"] == "weekend"]
        anomaly_items = [
            (
                f"{len(anomaly_days)} day(s) exceeded the day-type baseline by >15% "
                f"({len(weekday_anomalies)} weekday, {len(weekend_anomalies)} weekend, {len(holiday_rows)} holiday)."
            )
        ]
        for row in anomaly_days[:3]:
            anomaly_items.append(
                f"{row['date']} ({row['dayType']}): {row['total']} kWh vs expected {row['expected']} kWh "
                f"(+{row['deltaPct']}%)."
            )
        if len(anomaly_days) > 3:
            anomaly_items.append(f"…and {len(anomaly_days) - 3} more anomaly day(s) in the list below.")
        sections.append({"title": "Anomaly flags", "items": anomaly_items})

    return sections


def build_recommendations(
    circuit_rows: list[dict],
    anomaly_days: list[dict],
    sub_total: float,
    incoming_total: float,
    after_hours: float,
    wd_total: float,
    weekday_avg: float,
    weekend_avg: float,
) -> list[dict]:
    recommendations: list[dict] = []
    coverage_pct = round1(sub_total / incoming_total * 100) if incoming_total else 0.0

    recommendations.append(
        {
            "id": "elite-rec-coverage",
            "title": "Expand sub-meter coverage beyond current circuits",
            "affectedArea": "EliteIOT Office",
            "estimatedSaving": "High — visibility on unmetered load",
            "priority": "High",
            "reason": (
                f"Only {coverage_pct}% of incoming energy is captured on listed sub-meters "
                f"({sub_total:,.1f} kWh of {incoming_total:,.1f} kWh). "
                "Major loads (likely HVAC and base building) are not attributed in category charts."
            ),
            "suggestedAction": (
                "Prioritise metering on largest unmetered circuits; reconcile incoming vs sub-meter sum monthly."
            ),
            "status": "New",
            "owner": "TBD",
        }
    )

    recommendations.append(
        {
            "id": "elite-rec-a18p-afterhours",
            "title": "Review A18P after-hours standby (coffee/warmer loads)",
            "affectedArea": "F&B",
            "estimatedSaving": "Medium — after schedule correction",
            "priority": "High",
            "reason": (
                "A18P includes coffee and warmer equipment. Continuous night load often indicates standby heating left active."
            ),
            "suggestedAction": (
                "Check shutdown policy after business hours and disable unnecessary keep-warm mode overnight."
            ),
            "status": "New",
            "owner": "TBD",
        }
    )

    top_circuit = circuit_rows[0] if circuit_rows else None
    if top_circuit and top_circuit["category"] == "F&B":
        recommendations.append(
            {
                "id": "elite-rec-fnb-peak",
                "title": f"Validate high spike windows on {top_circuit['name']}",
                "affectedArea": "F&B",
                "estimatedSaving": "Medium — after equipment inventory",
                "priority": "High",
                "reason": (
                    f"{top_circuit['name']} is the largest sub-meter at {top_circuit['consumption']:,.1f} kWh "
                    f"({round1(top_circuit['consumption'] / sub_total * 100) if sub_total else 0}% of sub-meter total)."
                ),
                "suggestedAction": (
                    "Use anomaly heatmaps to separate business-hour cooking/heating spikes from after-hours standby."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    lighting_circuits = [c for c in circuit_rows if c["category"] == "Lighting"]
    if lighting_circuits:
        lighting_kwh = sum(c["consumption"] for c in lighting_circuits)
        recommendations.append(
            {
                "id": "elite-rec-lighting",
                "title": "Optimise daytime lighting schedule (B2R, B11P)",
                "affectedArea": "Lighting",
                "estimatedSaving": "Medium — after hours audit",
                "priority": "Medium",
                "reason": (
                    f"Lighting circuits total {lighting_kwh:,.1f} kWh "
                    f"({round1(lighting_kwh / sub_total * 100) if sub_total else 0}% of sub-metered load)."
                ),
                "suggestedAction": (
                    "Audit daytime usage on balcony/staircase/signboard lights and keep emergency lighting as protected baseline."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    it_circuits = [c for c in circuit_rows if c["category"] == "IT Devices"]
    if it_circuits:
        it_kwh = sum(c["consumption"] for c in it_circuits)
        recommendations.append(
            {
                "id": "elite-rec-it-baseload",
                "title": "Treat B5B/B4B as expected 24h baseload, monitor for drift",
                "affectedArea": "IT Devices",
                "estimatedSaving": "Low — monitor stability",
                "priority": "Medium",
                "reason": (
                    f"IT/network/security circuits consume {it_kwh:,.1f} kWh and are expected to run 24/7 "
                    "(router, modem, server, cameras, POE)."
                ),
                "suggestedAction": (
                    "Flag only sudden jumps/drops as potential equipment faults; avoid marking stable overnight load as anomaly."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    b6b_row = next((row for row in circuit_rows if row["name"] in ("B6B", "B6P")), None)
    if b6b_row:
        recommendations.append(
            {
                "id": "elite-rec-b6b-site-check",
                "title": "Verify B6P/B6B plug loads on site when abnormal standby appears",
                "affectedArea": "General Plug",
                "estimatedSaving": "Case-by-case",
                "priority": "Medium",
                "reason": (
                    f"B6P/B6B total is {b6b_row['consumption']:,.1f} kWh and represents unknown connected loads."
                ),
                "suggestedAction": (
                    "Use night minimum and peak-hour profile to infer plug behavior, then confirm connected appliances on site."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    if weekend_avg < weekday_avg * 0.75:
        recommendations.append(
            {
                "id": "elite-rec-weekend",
                "title": "Validate weekend shutdown on incoming meter",
                "affectedArea": "Whole office",
                "estimatedSaving": "Low–medium — if baseload is unintended",
                "priority": "Medium",
                "reason": (
                    f"Weekend incoming average is {weekend_avg} kWh/day vs {weekday_avg} kWh/day on weekdays "
                    f"({round1((1 - weekend_avg / weekday_avg) * 100) if weekday_avg else 0}% lower)."
                ),
                "suggestedAction": (
                    "Confirm whether remaining weekend load is intentional (IT/cooling). "
                    "If not, extend BMS setbacks for HVAC and non-critical circuits."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    if after_hours / wd_total > 0.12 if wd_total else False:
        recommendations.append(
            {
                "id": "elite-rec-afterhours",
                "title": "Reduce weekday after-hours baseload (22:00–06:00)",
                "affectedArea": "EliteIOT Office",
                "estimatedSaving": "Medium — after setback policy",
                "priority": "Medium",
                "reason": (
                    f"Weekday incoming consumption between 22:00–06:00 was {round1(after_hours):,.1f} kWh "
                    f"({round1(after_hours / wd_total * 100)}% of weekday incoming total)."
                ),
                "suggestedAction": (
                    "Target after-hours F&B pre-heating and non-essential office plug loads while preserving IT/security baseload."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    if anomaly_days:
        recommendations.append(
            {
                "id": "elite-rec-anomaly",
                "title": "Investigate flagged anomaly days on incoming meter",
                "affectedArea": "Incoming 3Phase",
                "estimatedSaving": "Medium — after root-cause review",
                "priority": "High",
                "reason": (
                    f"{len(anomaly_days)} day(s) exceeded the day-type baseline. "
                    f"First flag: {anomaly_days[0]['date']} at {anomaly_days[0]['total']} kWh."
                ),
                "suggestedAction": (
                    "Use device heatmaps in the anomaly list to see which sub-meters drove excess use "
                    "on each flagged day."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    return recommendations


def main() -> None:
    all_df = load_elite_excel(SOURCE_PATH)
    incoming = all_df[all_df["category"] == "Incoming Source"].copy()
    subs = all_df[all_df["category"] != "Incoming Source"].copy()

    period_start = all_df["time"].min().strftime("%Y-%m-%d")
    period_end = all_df["time"].max().strftime("%Y-%m-%d")
    day_count = int(all_df["date"].nunique())

    incoming_total = round1(incoming["delta_kwh"].sum())
    sub_total = round1(subs["delta_kwh"].sum())
    l6_total = round1(subs[subs["level"] == 6]["delta_kwh"].sum())
    l7_total = round1(subs[subs["level"] == 7]["delta_kwh"].sum())
    daily_mean = round1(incoming_total / day_count) if day_count else 0.0
    zone7_share = round1(l7_total / sub_total * 100) if sub_total else 0.0
    peak_value, peak_window, _peak_start = compute_peak_metrics(incoming)

    daily_frame = aggregate_elite_daily(incoming, subs)
    baseline_meta = build_baseline_meta(daily_frame, period_start, period_end)
    daily_rows = build_daily_rows(daily_frame, baseline_meta["byScope"]["all"])
    elite_category_scopes = build_elite_category_scopes(incoming, subs)
    elite_daily_category_splits = build_elite_daily_category_splits(subs)
    daily_label_map = {row["date"]: row["shortLabel"] for row in daily_rows}
    elite_category_chart_rows = build_elite_category_chart_rows(subs, daily_label_map)
    category_totals = {
        scope_key: elite_category_scopes[scope_key]["periodTotalKwh"]
        for scope_key in elite_category_scopes
        if scope_key != "incoming"
    }
    current_cost = compute_period_estimated_cost(daily_rows)

    comparison = {
        "previousPeriodStart": period_start,
        "previousPeriodEnd": period_end,
        "previousTotalKwh": incoming_total,
        "previousDailyAverageKwh": daily_mean,
        "previousPeakDemand1hKwh": peak_value,
        "previousEstimatedCostSgd": current_cost["totalSgd"],
        "previousLevel6Kwh": l6_total,
        "previousLevel7Kwh": l7_total,
        "totalTrendPct": 0.0,
        "dailyAverageTrendPct": 0.0,
        "peakTrendPct": 0.0,
        "estimatedCostTrendPct": 0.0,
    }

    anomaly_days = [row for row in daily_rows if row["anomaly"]]
    weekday_rows = [row for row in daily_rows if row["dayType"] == "weekday"]
    weekend_rows = [row for row in daily_rows if row["dayType"] == "weekend"]
    weekday_daily_avg = round1(sum(row["total"] for row in weekday_rows) / max(len(weekday_rows), 1))
    weekend_daily_avg = round1(sum(row["total"] for row in weekend_rows) / max(len(weekend_rows), 1))

    weekday_mask = all_df["day_type"] == "weekday"
    weekend_mask = all_df["day_type"] == "weekend"
    holiday_mask = all_df["day_type"] == "holiday"

    hourly_weekday = hourly_profile_total(incoming.loc[weekday_mask])
    hourly_weekend = hourly_profile_total(incoming.loc[weekend_mask])
    hourly_holiday = hourly_profile_total(incoming.loc[holiday_mask])
    hourly_weekday_by_cat = hourly_by_category_filtered(subs.loc[weekday_mask])
    hourly_weekend_by_cat = hourly_by_category_filtered(subs.loc[weekend_mask])
    hourly_holiday_by_cat = hourly_by_category_filtered(subs.loc[holiday_mask])

    profile_hourly_by_space: dict = {}
    daily_hourly_by_space: dict = {}
    for scope_key, level_filter in [("all", None), ("level6", 6), ("level7", 7)]:
        scope_frame = subs if level_filter is None else subs[subs["level"] == level_filter]
        scope_incoming = incoming
        profile_hourly_by_space[scope_key] = {
            "weekday": hourly_by_category_filtered(scope_frame.loc[weekday_mask])
            if level_filter is not None
            else hourly_by_category_filtered(subs.loc[weekday_mask]),
            "weekend": hourly_by_category_filtered(scope_frame.loc[weekend_mask])
            if level_filter is not None
            else hourly_by_category_filtered(subs.loc[weekend_mask]),
            "holiday": hourly_by_category_filtered(scope_frame.loc[holiday_mask])
            if level_filter is not None
            else hourly_by_category_filtered(subs.loc[holiday_mask]),
        }
        if level_filter is None:
            profile_hourly_by_space[scope_key]["weekday"] = hourly_weekday_by_cat
            profile_hourly_by_space[scope_key]["weekend"] = hourly_weekend_by_cat
            profile_hourly_by_space[scope_key]["holiday"] = hourly_holiday_by_cat

        by_date: dict[str, list] = {}
        for date_val in sorted(scope_frame["date"].unique()):
            date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
            day_frame = scope_frame[scope_frame["date"] == date_val]
            rows = []
            for hour in range(24):
                hour_df = day_frame[day_frame["hour"] == hour]
                row = {"hour": f"{hour:02d}"}
                for nap_cat in NAP_HOURLY_CATEGORIES:
                    key = nap_cat.replace(" ", "_").replace("/", "_")
                    values = []
                    for elite_cat in ELITE_CATEGORIES:
                        if map_elite_to_nap_category(elite_cat) != nap_cat:
                            continue
                        subset = hour_df.loc[hour_df["category"] == elite_cat, "delta_kwh"]
                        if len(subset):
                            values.append(float(subset.sum()))
                    row[key] = round2(sum(values))
                row["total"] = round2(hour_df["delta_kwh"].sum())
                rows.append(row)
            by_date[date_str] = rows
        daily_hourly_by_space[scope_key] = by_date

    sub_by_category = subs.groupby("category")["delta_kwh"].sum()
    appliance_distribution = []
    for category in ELITE_CATEGORIES:
        value = round1(sub_by_category.get(category, 0.0))
        if value <= 0 and category != "General Plug":
            continue
        appliance_distribution.append(
            {
                "tag": category,
                "value": value,
                "percentage": round1(value / sub_total * 100) if sub_total else 0.0,
            }
        )
    appliance_distribution.sort(key=lambda item: item["value"], reverse=True)

    appliance_distribution_by_space = {
        "all": appliance_distribution,
        "level6": [
            {
                "tag": cat,
                "value": round1(subs[(subs["level"] == 6) & (subs["category"] == cat)]["delta_kwh"].sum()),
                "percentage": round1(
                    subs[(subs["level"] == 6) & (subs["category"] == cat)]["delta_kwh"].sum()
                    / l6_total
                    * 100
                )
                if l6_total
                else 0.0,
            }
            for cat in ELITE_CATEGORIES
            if subs[(subs["level"] == 6) & (subs["category"] == cat)]["delta_kwh"].sum() > 0
        ],
        "level7": [
            {
                "tag": cat,
                "value": round1(subs[(subs["level"] == 7) & (subs["category"] == cat)]["delta_kwh"].sum()),
                "percentage": round1(
                    subs[(subs["level"] == 7) & (subs["category"] == cat)]["delta_kwh"].sum()
                    / l7_total
                    * 100
                )
                if l7_total
                else 0.0,
            }
            for cat in ELITE_CATEGORIES
            if subs[(subs["level"] == 7) & (subs["category"] == cat)]["delta_kwh"].sum() > 0
        ],
    }

    circuit_rows = []
    for device in sorted(subs["device"].unique()):
        device_rows = subs[subs["device"] == device]
        circuit_rows.append(
            {
                "name": device,
                "level": int(device_rows["level"].iloc[0]),
                "category": str(device_rows["category"].iloc[0]),
                "consumption": round1(device_rows["delta_kwh"].sum()),
            }
        )
    circuit_rows.sort(key=lambda item: item["consumption"], reverse=True)

    def build_device_daily_readings(frame: pd.DataFrame) -> list[dict]:
        grouped = frame.groupby(["date", "device", "level", "category"])["delta_kwh"].sum().reset_index()
        return [
            {
                "date": str(row["date"]),
                "device": row["device"],
                "level": int(row["level"]),
                "category": row["category"],
                "kwh": round1(row["delta_kwh"]),
            }
            for _, row in grouped.iterrows()
        ]

    def build_device_hourly_profiles(frame: pd.DataFrame) -> list[dict]:
        rows = []
        for device, grp in frame.groupby("device"):
            dates = grp["date"].unique()
            hour_sums = {hour: 0.0 for hour in range(24)}
            for date in dates:
                day_df = grp[grp["date"] == date]
                for hour in range(24):
                    hour_sums[hour] += day_df.loc[day_df["hour"] == hour, "delta_kwh"].sum()
            day_count = len(dates)
            rows.append(
                {
                    "device": device,
                    "level": int(grp["level"].iloc[0]),
                    "category": str(grp["category"].iloc[0]),
                    "hourlyKwh": [
                        round2(hour_sums[hour] / day_count if day_count else 0) for hour in range(24)
                    ],
                }
            )
        rows.sort(key=lambda item: (item["level"], item["device"]))
        return rows

    def build_device_hourly_by_date(frame: pd.DataFrame) -> dict:
        by_date: dict[str, list] = {}
        for date_val in sorted(frame["date"].unique()):
            date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
            day_frame = frame[frame["date"] == date_val]
            profiles = []
            for device, grp in day_frame.groupby("device"):
                profiles.append(
                    {
                        "device": device,
                        "level": int(grp["level"].iloc[0]),
                        "category": str(grp["category"].iloc[0]),
                        "hourlyKwh": [
                            round2(grp.loc[grp["hour"] == hour, "delta_kwh"].sum()) for hour in range(24)
                        ],
                    }
                )
            profiles.sort(key=lambda item: (item["level"], item["device"]))
            by_date[date_str] = profiles
        return by_date

    device_daily_readings = build_device_daily_readings(subs)
    device_hourly_profiles = build_device_hourly_profiles(subs)
    device_hourly_by_date = build_device_hourly_by_date(subs)
    device_hourly_profiles_by_day_type = {
        day_type: build_device_hourly_profiles(subs[subs["day_type"] == day_type])
        for day_type in ["weekday", "weekend", "holiday"]
    }

    level_usage_by_day_type = {}
    for day_type in ["weekday", "weekend", "holiday"]:
        subset = subs[subs["day_type"] == day_type]
        level_usage_by_day_type[day_type] = {
            "level6Kwh": round1(subset[subset["level"] == 6]["delta_kwh"].sum()),
            "level7Kwh": round1(subset[subset["level"] == 7]["delta_kwh"].sum()),
            "sampleCount": int(len([row for row in daily_rows if row["dayType"] == day_type])),
        }

    wd_incoming = incoming.loc[weekday_mask]
    after_hours = wd_incoming[(wd_incoming["hour"] >= 22) | (wd_incoming["hour"] < 6)]["delta_kwh"].sum()
    office_hours = wd_incoming[(wd_incoming["hour"] >= 8) & (wd_incoming["hour"] < 18)]["delta_kwh"].sum()
    wd_total = wd_incoming["delta_kwh"].sum()

    daily_cat = subs.groupby(["date", "category"])["delta_kwh"].sum().unstack(fill_value=0).reset_index()

    def nap_cat_columns(cat_row) -> dict:
        lighting = round1(cat_row.get("Lighting", 0))
        office = round1(
            cat_row.get("F&B", 0)
        )
        general = round1(cat_row.get("IT Devices", 0) + cat_row.get("General Plug", 0))
        return {
            "lighting": lighting,
            "office_load": office,
            "ventilation_fan": general,
            "total": round1(lighting + office + general),
        }

    tag_chart_rows = []
    for day in daily_rows:
        date_key = pd.Timestamp(day["date"]).date()
        cat_row = daily_cat[daily_cat["date"] == date_key]
        cols = nap_cat_columns(cat_row.iloc[0]) if not cat_row.empty else {
            "lighting": 0,
            "office_load": 0,
            "ventilation_fan": 0,
            "total": 0,
        }
        tag_chart_rows.append({"label": day["shortLabel"], **cols})

    def build_space_chart_rows() -> list[dict]:
        rows = []
        for day in daily_rows:
            rows.append(
                {
                    "label": day["shortLabel"],
                    "level_6": day["level6"],
                    "level_7": day["level7"],
                    "total": day["total"],
                }
            )
        return rows

    def build_level_tag_chart_rows(level_num: int) -> list[dict]:
        level_subs = subs[subs["level"] == level_num]
        daily_cat_level = (
            level_subs.groupby(["date", "category"])["delta_kwh"].sum().unstack(fill_value=0).reset_index()
        )
        rows = []
        for day in daily_rows:
            date_key = pd.Timestamp(day["date"]).date()
            cat_row = daily_cat_level[daily_cat_level["date"] == date_key]
            cols = nap_cat_columns(cat_row.iloc[0]) if not cat_row.empty else {
                "lighting": 0,
                "office_load": 0,
                "ventilation_fan": 0,
                "total": 0,
            }
            rows.append({"label": day["shortLabel"], **cols})
        return rows

    top_days = sorted(daily_rows, key=lambda row: row["total"], reverse=True)[:5]
    devices_l6 = sorted(subs[subs["level"] == 6]["device"].unique().tolist())
    devices_l7 = sorted(subs[subs["level"] == 7]["device"].unique().tolist())

    cost_monthly_note = ", ".join(row["label"] for row in current_cost["monthly"])

    consumption_tree = build_elite_consumption_tree(incoming, subs)
    daily_avg_tree = build_elite_consumption_tree(incoming, subs, scale=1.0 / day_count if day_count else 1.0)
    cost_rate = current_cost["totalSgd"] / incoming_total if incoming_total else 0.0
    cost_tree = build_elite_consumption_tree(incoming, subs, scale=cost_rate)
    peak_date = peak_window.split()[0]
    peak_hour = int(peak_window.split()[1].split(":")[0])
    peak_tree = build_peak_breakdown_tree(build_clock_hour_frame(all_df, peak_date, peak_hour))
    highlight_breakdowns = {
        "total": {
            "key": "total",
            "label": "Total Consumption",
            "unit": "kWh",
            "note": (
                f"Incoming 3Phase over {period_start} to {period_end}. "
                f"Sub-meters capture {round1(sub_total / incoming_total * 100) if incoming_total else 0}% of incoming."
            ),
            "totalKwh": consumption_tree["totalKwh"],
            "previousTotalKwh": consumption_tree["totalKwh"],
            "totalTrendPct": 0.0,
            "levels": consumption_tree["levels"],
        },
        "daily_average": {
            "key": "daily_average",
            "label": "Daily Average",
            "unit": "kWh/day",
            "note": (
                f"Period totals divided by {day_count} days. "
                f"Weekday avg {weekday_daily_avg} kWh/day · weekend avg {weekend_daily_avg} kWh/day."
            ),
            "totalKwh": daily_avg_tree["totalKwh"],
            "previousTotalKwh": daily_avg_tree["totalKwh"],
            "totalTrendPct": 0.0,
            "levels": daily_avg_tree["levels"],
        },
        "peak": {
            "key": "peak",
            "label": "Peak 1h Consumption",
            "unit": "kWh",
            "note": f"Highest clock hour on incoming: {peak_window}.",
            "totalKwh": peak_tree["totalKwh"],
            "previousTotalKwh": peak_tree["totalKwh"],
            "totalTrendPct": 0.0,
            "levels": peak_tree["levels"],
        },
        "estimated_cost": {
            "key": "estimated_cost",
            "label": "Estimated Cost",
            "unit": "SGD",
            "note": f"Configured reference tariff Jun 2026 ({cost_monthly_note}).",
            "totalKwh": current_cost["totalSgd"],
            "previousTotalKwh": current_cost["totalSgd"],
            "totalTrendPct": 0.0,
            "levels": cost_tree["levels"],
        },
    }

    findings = build_findings(
        period_start,
        period_end,
        day_count,
        incoming_total,
        sub_total,
        l6_total,
        l7_total,
        weekday_daily_avg,
        weekend_daily_avg,
        appliance_distribution,
        circuit_rows,
        after_hours,
        wd_total,
        office_hours,
        top_days,
        anomaly_days,
        baseline_meta,
        peak_window,
        peak_value,
    )
    recommendations = build_recommendations(
        circuit_rows,
        anomaly_days,
        sub_total,
        incoming_total,
        after_hours,
        wd_total,
        weekday_daily_avg,
        weekend_daily_avg,
    )

    profile_meta = {
        "weekdayCount": len(weekday_rows),
        "weekendCount": len(weekend_rows),
        "holidayCount": len([row for row in daily_rows if row["dayType"] == "holiday"]),
        "holidayDays": [
            {
                "date": row["date"],
                "shortLabel": row["shortLabel"],
                "name": MY_PUBLIC_HOLIDAYS.get(row["date"], "Public Holiday"),
            }
            for row in daily_rows
            if row["dayType"] == "holiday"
        ],
        "periodLabel": f"{period_start} to {period_end}",
        "stackedProfileYMax": max(
            max(row.get("total", 0) for row in hourly_weekday_by_cat)
            if hourly_weekday_by_cat
            else 0,
            1,
        ),
    }

    payload = {
        "projectId": ELITE_PROJECT_ID,
        "projectName": ELITE_PROJECT_NAME,
        "meta": {
            "periodStart": period_start,
            "periodEnd": period_end,
            "dayCount": day_count,
            "intervalMinutes": 15,
            "sourceFiles": [SOURCE_PATH.name],
            "previousPeriodStart": period_start,
            "previousPeriodEnd": period_end,
            "previousSourceFiles": [],
        },
        "comparison": comparison,
        "summary": {
            "totalKwh": incoming_total,
            "level6Kwh": l6_total,
            "level7Kwh": l7_total,
            "dailyAverageKwh": daily_mean,
            "level7SharePct": zone7_share,
            "peakDemand1hKwh": peak_value,
            "peakWindow": peak_window,
            "weekdayDailyAvgKwh": weekday_daily_avg,
            "weekendDailyAvgKwh": weekend_daily_avg,
            "holidayDailyAvgKwh": 0.0,
            "afterHoursWeekdayKwh": round1(after_hours),
            "afterHoursWeekdayPct": round1(after_hours / wd_total * 100) if wd_total else 0.0,
            "officeHoursWeekdayKwh": round1(office_hours),
            "estimatedCostSgd": current_cost["totalSgd"],
            "costMonthlyBreakdown": current_cost["monthly"],
        },
        "highlights": [
            {
                "key": "total",
                "label": "Total Consumption",
                "value": incoming_total,
                "unit": "kWh",
                "trendPct": 0,
                "note": (
                    f"Incoming 3Phase · {period_start} to {period_end}. "
                    f"Sub-meter coverage: {round1(sub_total / incoming_total * 100) if incoming_total else 0}%."
                ),
                "icon": "bolt",
            },
            {
                "key": "daily_average",
                "label": "Daily Average",
                "value": daily_mean,
                "unit": "kWh/day",
                "trendPct": 0,
                "note": (
                    f"Weekday avg {weekday_daily_avg} kWh/day · weekend avg {weekend_daily_avg} kWh/day. "
                    "No prior-period comparison in this dataset."
                ),
                "icon": "clock",
            },
            {
                "key": "peak",
                "label": "Peak 1h Consumption",
                "value": peak_value,
                "unit": "kWh",
                "trendPct": 0,
                "note": f"Highest clock hour on incoming: {peak_window}. Click for top 5 breakdown.",
                "icon": "gauge",
            },
            {
                "key": "estimated_cost",
                "label": "Estimated Cost",
                "value": current_cost["totalSgd"],
                "unit": "SGD",
                "trendPct": 0,
                "note": (
                    f"Configured reference tariff Jun 2026: 29.72¢/kWh ({cost_monthly_note}). "
                    "Single monitoring window — no YoY or prior-period delta."
                ),
                "icon": "coins",
            },
        ],
        "applianceDistribution": appliance_distribution,
        "hourlyWeekdayTotal": hourly_weekday,
        "hourlyWeekendTotal": hourly_weekend,
        "hourlyWeekdayByCategory": hourly_weekday_by_cat,
        "hourlyWeekendByCategory": hourly_weekend_by_cat,
        "hourlyHolidayTotal": hourly_holiday,
        "hourlyHolidayByCategory": hourly_holiday_by_cat,
        "profileHourlyBySpace": profile_hourly_by_space,
        "dailyHourlyBySpace": daily_hourly_by_space,
        "applianceDistributionBySpace": appliance_distribution_by_space,
        "profileMeta": profile_meta,
        "baselineMeta": baseline_meta,
        "dailyTotals": daily_rows,
        "tagChartRows": tag_chart_rows,
        "spaceChartRows": build_space_chart_rows(),
        "level6TagChartRows": build_level_tag_chart_rows(6),
        "level7TagChartRows": build_level_tag_chart_rows(7),
        "topCircuits": circuit_rows[:10],
        "deviceDailyReadings": device_daily_readings,
        "deviceHourlyProfiles": device_hourly_profiles,
        "deviceHourlyByDate": device_hourly_by_date,
        "deviceHourlyProfilesByDayType": device_hourly_profiles_by_day_type,
        "levelUsageByDayType": level_usage_by_day_type,
        "findings": findings,
        "recommendations": recommendations,
        "anomalyDays": anomaly_days,
        "topDays": top_days,
        "devicesByLevel": {"level6": devices_l6, "level7": devices_l7},
        "topPeaks": build_top_peaks(all_df, incoming),
        "highlightBreakdowns": highlight_breakdowns,
        "eliteCategoryScopes": elite_category_scopes,
        "eliteDailyCategorySplits": elite_daily_category_splits,
        "eliteCategoryChartRows": elite_category_chart_rows,
        "eliteCategoryTotals": category_totals,
    }

    ts_content = f"""/**
 * @file eliteiotEnergyAnalysisData.ts
 * @brief EliteIOT office energy analysis data generated from Excel source file.
 * @note Auto-generated by scripts/generate_eliteiot_analysis_data.py — do not edit manually.
 */
import type {{ NapEnergyAnalysisData }} from "@/mock/napEnergyAnalysisData";

export const ELITE_PROJECT_ID = "{ELITE_PROJECT_ID}";
export const ELITE_PROJECT_NAME = "{ELITE_PROJECT_NAME}";

export type EliteCategoryScope = "incoming" | "fnb" | "lighting" | "it_devices" | "general_plug";

export interface EliteCategoryBaselineMeta {{
  weekday: number;
  weekend: number;
  holiday: number;
  weekdayCount: number;
  weekendCount: number;
  holidayCount: number;
}}

export interface EliteCategoryScopeBundle {{
  label: string;
  category: string;
  devices: string[];
  periodTotalKwh: number;
  baselineMeta: EliteCategoryBaselineMeta;
  dailyTotals: NapEnergyAnalysisData["dailyTotals"];
  profileHourlyByDayType: Record<"weekday" | "weekend" | "holiday", Array<{{ hour: string; total: number }}>>;
  dailyHourlyByDate: Record<string, Array<{{ hour: string; total: number }}>>;
}}

export interface EliteCategoryChartRow {{
  label: string;
  fnb: number;
  lighting: number;
  it_devices: number;
  general_plug: number;
  total: number;
}}

export interface EliteDailyCategorySplit {{
  fnb: number;
  lighting: number;
  it_devices: number;
  general_plug: number;
}}

export interface EliteEnergyAnalysisData extends NapEnergyAnalysisData {{
  eliteCategoryScopes: Record<EliteCategoryScope, EliteCategoryScopeBundle>;
  eliteDailyCategorySplits: Record<string, EliteDailyCategorySplit>;
  eliteCategoryChartRows: EliteCategoryChartRow[];
  eliteCategoryTotals: Record<Exclude<EliteCategoryScope, "incoming">, number>;
}}

export const eliteiotEnergyAnalysisData: EliteEnergyAnalysisData = {json.dumps(payload, indent=2)};
"""
    OUT_PATH.write_text(ts_content, encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(daily_rows)} days, {incoming_total} kWh incoming)")


if __name__ == "__main__":
    main()
