"""Generate TypeScript analysis dataset from Ngee Ann Poly Excel files."""
from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
L6_CURRENT_PATH = ROOT.parent / "Ngee Ann Poly Level 6 (19 May - 17 June).xlsx"
L7_CURRENT_PATH = ROOT.parent / "Ngee Ann Poly Level 7 (19 May - 17 June).xlsx"
L6_PREVIOUS_PATH = ROOT.parent / "Ngee Ann Poly Level 6 (21 April - 20 May).xlsx"
L7_PREVIOUS_PATH = ROOT.parent / "Ngee Ann Poly Level 7 (21 April - 20 May).xlsx"
OUT_PATH = ROOT / "src" / "mock" / "napEnergyAnalysisData.ts"
SHARE_OUT_PATH = ROOT / "src" / "mock" / "napEnergyAnalysisData.share.ts"

NP_PROJECT_ID = "proj-nap-energy-analysis"
NP_PROJECT_NAME = "NP Energy Analysis"
NP_SHARE_PROJECT_NAME = "Energy Analysis Demo"

# SP Group regulated household electricity tariff (Low Tension, Domestic), cents/kWh.
# Q2 2026 (1 Apr – 30 Jun 2026): 27.27¢ ex GST / 29.72¢ incl. 9% GST.
# Sources: https://www.spgroup.com.sg/our-services/utilities/tariff-information
#          https://data.gov.sg (Electricity Tariff, Monthly)
SP_TARIFF_CENTS_INCL_GST: dict[str, float] = {
    "2026-04": 29.72,
    "2026-05": 29.72,
    "2026-06": 29.72,
}
SP_TARIFF_DEFAULT_CENTS_INCL_GST = 29.72

TAG_COLORS = {
    "Lighting": "#4F9B86",
    "Office Load": "#5B8BCF",
    "Ventilation/Fan": "#9A8DBF",
}

# Singapore public holidays within the NAP baseline / monitoring window (Apr–Jun 2026).
SG_PUBLIC_HOLIDAYS: dict[str, str] = {
    "2026-05-01": "Labour Day",
    "2026-05-27": "Vesak Day",
    "2026-06-01": "Public Holiday",
}

BASELINE_PERIOD_START = "2026-04-21"
BASELINE_PERIOD_END = "2026-06-17"


def resolve_day_type(date_val) -> str:
    """Return weekday, weekend, or holiday for a calendar date."""
    ts = pd.Timestamp(date_val)
    date_str = ts.strftime("%Y-%m-%d")
    if date_str in SG_PUBLIC_HOLIDAYS:
        return "holiday"
    if ts.weekday() >= 5:
        return "weekend"
    return "weekday"


def load_level_excel(path: Path, level: int) -> pd.DataFrame:
    raw = pd.read_excel(path, header=None)
    column_count = raw.shape[1]

    if column_count >= 7:
        left = raw.iloc[:, [0, 1, 2]].copy()
        right = raw.iloc[:, [4, 5, 6]].copy()
        left.columns = ["device", "time", "kwh"]
        right.columns = ["device", "time", "kwh"]
        df = pd.concat([left, right], ignore_index=True)
    else:
        df = pd.read_excel(path)
        df.columns = ["device", "time", "kwh"]

    df = df.dropna(subset=["device", "time", "kwh"])
    df["device"] = df["device"].astype(str)
    df = df[df["device"].str.lower() != "device name"]
    df = df.drop_duplicates(subset=["device", "time"], keep="first")
    df["time"] = pd.to_datetime(df["time"])
    df["level"] = level
    return df


def load_period_frames(l6_path: Path, l7_path: Path) -> pd.DataFrame:
    l6 = add_deltas(load_level_excel(l6_path, 6))
    l7 = add_deltas(load_level_excel(l7_path, 7))
    return pd.concat([l6, l7], ignore_index=True)


def trend_pct(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0
    return round1((current - previous) / previous * 100)


def format_clock_hour_window(date, hour: int) -> str:
    date_str = pd.Timestamp(date).strftime("%Y-%m-%d")
    end_hour = hour + 1
    return f"{date_str} {hour:02d}:00-{end_hour:02d}:00"


def compute_aggregate_hourly_totals(totals: pd.DataFrame) -> pd.DataFrame:
    """Sum aggregate meter deltas into fixed clock-hour buckets (HH:00 to HH+1:00)."""
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


def summarize_period(all_df: pd.DataFrame) -> dict:
    totals = all_df[all_df["category"] == "Aggregate"].copy()
    period_start = all_df["time"].min().strftime("%Y-%m-%d")
    period_end = all_df["time"].max().strftime("%Y-%m-%d")
    day_count = int(all_df["date"].nunique())
    total_kwh = round1(totals["delta_kwh"].sum())
    l6_total = round1(totals[totals["level"] == 6]["delta_kwh"].sum())
    l7_total = round1(totals[totals["level"] == 7]["delta_kwh"].sum())
    daily_mean = round1(total_kwh / day_count) if day_count else 0.0
    level7_share = round1(l7_total / total_kwh * 100) if total_kwh else 0.0
    peak_value, peak_window, peak_start = compute_peak_metrics(totals)
    return {
        "periodStart": period_start,
        "periodEnd": period_end,
        "dayCount": day_count,
        "totalKwh": total_kwh,
        "level6Kwh": l6_total,
        "level7Kwh": l7_total,
        "dailyAverageKwh": daily_mean,
        "level7SharePct": level7_share,
        "peakDemand1hKwh": peak_value,
        "peakWindow": peak_window,
        "peakStart": peak_start,
    }


def load_level6() -> pd.DataFrame:
    return load_level_excel(L6_CURRENT_PATH, 6)


def load_level7() -> pd.DataFrame:
    return load_level_excel(L7_CURRENT_PATH, 7)


def categorize(device: str) -> str:
    name = device.lower()
    if "total" in name:
        return "Aggregate"
    if "light" in name:
        return "Lighting"
    if "fan" in name or "isol" in name:
        return "Ventilation/Fan"
    if "load" in name:
        return "Office Load"
    return "Other"


def add_deltas(df: pd.DataFrame) -> pd.DataFrame:
    out = df.sort_values(["device", "time"]).copy()
    out["delta_kwh"] = out.groupby("device")["kwh"].diff()
    out = out.dropna(subset=["delta_kwh"])
    out["date"] = out["time"].dt.date
    out["hour"] = out["time"].dt.hour
    out["weekday"] = out["time"].dt.weekday
    out["category"] = out["device"].map(categorize)
    return out


def round1(value: float) -> float:
    return round(float(value), 1)


def round2_money(value: float) -> float:
    return round(float(value), 2)


def round2(value: float) -> float:
    return round(float(value), 2)


def tariff_sgd_for_month(month_key: str) -> float:
    cents = SP_TARIFF_CENTS_INCL_GST.get(month_key, SP_TARIFF_DEFAULT_CENTS_INCL_GST)
    return cents / 100.0


def aggregate_daily_totals(totals: pd.DataFrame) -> pd.DataFrame:
    """Aggregate meter rows into one row per calendar day with level split."""
    daily = (
        totals.groupby(["date", "level"])["delta_kwh"]
        .sum()
        .unstack(fill_value=0)
        .reset_index()
    )
    daily.columns = ["date", "level6", "level7"]
    daily["total"] = daily["level6"] + daily["level7"]
    daily["date_str"] = daily["date"].astype(str)
    daily["short_label"] = daily["date"].apply(lambda d: d.strftime("%m/%d"))
    daily["day_type"] = daily["date"].apply(resolve_day_type)
    return daily


def build_baseline_daily_frame(previous_totals: pd.DataFrame, current_totals: pd.DataFrame) -> pd.DataFrame:
    """Merge previous + current aggregate daily totals for baseline window, dedupe overlapping dates."""
    previous_daily = aggregate_daily_totals(previous_totals)
    current_daily = aggregate_daily_totals(current_totals)
    combined = pd.concat([previous_daily, current_daily], ignore_index=True)
    combined = combined.sort_values("date").drop_duplicates(subset=["date_str"], keep="last")
    start = pd.Timestamp(BASELINE_PERIOD_START).date()
    end = pd.Timestamp(BASELINE_PERIOD_END).date()
    return combined[(combined["date"] >= start) & (combined["date"] <= end)].copy()


def build_baseline_meta(baseline_daily: pd.DataFrame) -> dict:
    """Day-type mean baselines for all scopes over the baseline calibration window."""
    scopes = {
        "all": "total",
        "level6": "level6",
        "level7": "level7",
    }
    by_scope: dict[str, dict] = {}
    for scope_key, column in scopes.items():
        scope_means: dict[str, float] = {}
        scope_counts: dict[str, int] = {}
        for day_type in ["weekday", "weekend", "holiday"]:
            subset = baseline_daily[baseline_daily["day_type"] == day_type]
            scope_counts[day_type] = int(len(subset))
            scope_means[day_type] = (
                round1(subset[column].mean()) if len(subset) else 0.0
            )
        by_scope[scope_key] = {
            **scope_means,
            "weekdayCount": scope_counts["weekday"],
            "weekendCount": scope_counts["weekend"],
            "holidayCount": scope_counts["holiday"],
        }

    return {
        "periodStart": BASELINE_PERIOD_START,
        "periodEnd": BASELINE_PERIOD_END,
        "dayCount": int(len(baseline_daily)),
        "byScope": by_scope,
    }


def build_findings_sections(
    period_start: str,
    period_end: str,
    day_count: int,
    total_kwh: float,
    comparison: dict,
    previous_period: dict,
    daily_mean: float,
    l6_total: float,
    l7_total: float,
    weekday_daily_avg: float,
    weekend_daily_avg: float,
    holiday_daily_avg: float,
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
    """Build grouped findings for the executive summary."""
    tag_text = ", ".join(f"{row['tag']} {row['percentage']}%" for row in appliance_distribution)
    baseline = baseline_meta["byScope"]["all"]
    peak_day = top_days[0] if top_days else None

    sections = [
        {
            "title": "Monitoring scope",
            "items": [
                (
                    f"Period {period_start} to {period_end} ({day_count} days): "
                    f"{total_kwh:,.1f} kWh on aggregate Level 6 + Level 7 meters."
                ),
                (
                    f"vs previous period ({previous_period['periodStart']} to {previous_period['periodEnd']}): "
                    f"{comparison['totalTrendPct']:+.1f}% total energy; daily average {daily_mean:.1f} kWh/day "
                    f"({comparison['dailyAverageTrendPct']:+.1f}% vs prior period)."
                ),
                (
                    f"Anomaly baseline calibrated over {baseline_meta['periodStart']} to {baseline_meta['periodEnd']} "
                    f"({baseline_meta['dayCount']} days): weekday {baseline['weekday']} kWh/day, "
                    f"weekend {baseline['weekend']} kWh/day, holiday {baseline['holiday']} kWh/day."
                ),
            ],
        },
        {
            "title": "Consumption by level",
            "items": [
                (
                    f"Level 7: {l7_total:,.1f} kWh ({round1(l7_total / total_kwh * 100)}% of total) — "
                    f"about {round(l7_total / l6_total, 2)}× Level 6 ({l6_total:,.1f} kWh)."
                ),
                (
                    f"Monitoring-period daily averages (aggregate): weekday {weekday_daily_avg} kWh/day, "
                    f"weekend {weekend_daily_avg} kWh/day, holiday {holiday_daily_avg} kWh/day."
                ),
            ],
        },
        {
            "title": "Category mix (sub-meters)",
            "items": [
                f"Tag split over the period: {tag_text}.",
                (
                    f"Highest circuit: {circuit_rows[0]['name']} "
                    f"({circuit_rows[0]['consumption']:,.1f} kWh, {circuit_rows[0]['category']})."
                ),
            ],
        },
        {
            "title": "Day-type & hourly behaviour",
            "items": [
                (
                    f"Weekday office hours (08:00–18:00) account for {round1(office_hours):,.1f} kWh "
                    f"({round1(office_hours / wd_total * 100) if wd_total else 0}% of weekday aggregate)."
                ),
                (
                    f"Weekday after-hours (22:00–06:00): {round1(after_hours):,.1f} kWh "
                    f"({round1(after_hours / wd_total * 100) if wd_total else 0}% of weekday total)."
                ),
                (
                    "Early-weekend profiles show near-zero fan load; mid-June weekends show much higher "
                    "ventilation use — review BMS schedules for consistency."
                ),
            ],
        },
        {
            "title": "Peaks & anomalies",
            "items": [
                (
                    f"Highest daily total: {peak_day['date']} at {peak_day['total']} kWh "
                    f"(Level 6 {peak_day['level6']} kWh · Level 7 {peak_day['level7']} kWh)."
                    if peak_day
                    else "Peak daily total not available."
                ),
                f"Peak clock-hour demand: {peak_value} kWh in window {peak_window}.",
            ],
        },
    ]

    if anomaly_days:
        weekday_anomalies = [row for row in anomaly_days if row["dayType"] == "weekday"]
        weekend_anomalies = [row for row in anomaly_days if row["dayType"] == "weekend"]
        anomaly_items = [
            (
                f"{len(anomaly_days)} day(s) exceeded the day-type baseline by >15% "
                f"({len(weekday_anomalies)} weekday, {len(weekend_anomalies)} weekend)."
            )
        ]
        for row in anomaly_days[:5]:
            anomaly_items.append(
                f"{row['date']} ({row['dayType']}): {row['total']} kWh vs expected {row['expected']} kWh "
                f"(+{row['deltaPct']}%)."
            )
        if len(anomaly_days) > 5:
            anomaly_items.append(f"…and {len(anomaly_days) - 5} more anomaly day(s) in the list below.")
        sections.append({"title": "Anomaly flags", "items": anomaly_items})

    return sections


def build_recommendations(
    circuit_rows: list[dict],
    daily_rows: list[dict],
    anomaly_days: list[dict],
    top_days: list[dict],
    after_hours: float,
    wd_total: float,
    subs: pd.DataFrame,
) -> list[dict]:
    """Build operational recommendations from observed patterns."""
    recommendations: list[dict] = []

    fan_circuits = [circuit for circuit in circuit_rows if circuit["category"] == "Ventilation/Fan"]
    if fan_circuits:
        fan = fan_circuits[0]
        sub_meter_total = sum(circuit["consumption"] for circuit in circuit_rows)
        fan_share_pct = round1(fan["consumption"] / sub_meter_total * 100) if sub_meter_total else 0
        recommendations.append(
            {
                "id": "nap-rec-fan",
                "title": "Audit ventilation schedule — Level 7 Fan ISOL1/2 (Load 4)",
                "affectedArea": f"Level {fan['level']}",
                "estimatedSaving": "High — measure after BMS review",
                "priority": "High",
                "reason": (
                    f"This fan circuit recorded {fan['consumption']:,.1f} kWh ({fan_share_pct}% of sub-meter total). "
                    "Hourly profiles show low overnight use on holidays and early weekends, but near-24h operation from mid-June onward."
                ),
                "suggestedAction": (
                    "Confirm BMS isolation / fan schedules for teaching vs non-teaching hours, weekends, and public holidays. "
                    "Align overnight and weekend setbacks with actual occupancy."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    load4_l6 = next((circuit for circuit in circuit_rows if "Lvl 6 Office Load 4" in circuit["name"]), None)
    if load4_l6:
        recommendations.append(
            {
                "id": "nap-rec-l6-load4",
                "title": "Investigate Level 6 Office Load 4 (L1P19–L3P24)",
                "affectedArea": "Level 6",
                "estimatedSaving": "Medium — after load inventory",
                "priority": "High",
                "reason": (
                    f"Load 4 is the dominant Level 6 sub-meter at {load4_l6['consumption']:,.1f} kWh "
                    f"({round1(load4_l6['consumption'] / sum(c['consumption'] for c in circuit_rows if c['level'] == 6) * 100) if any(c['level'] == 6 for c in circuit_rows) else 0}% of Level 6 sub-meter total)."
                ),
                "suggestedAction": (
                    "Verify connected equipment, operating hours, and whether loads can be shed outside office hours."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    mid_june_anomalies = [
        row for row in anomaly_days if row["date"] >= "2026-06-05" and row["dayType"] == "weekday"
    ]
    if mid_june_anomalies:
        peak_day = top_days[0]["date"] if top_days else mid_june_anomalies[0]["date"]
        recommendations.append(
            {
                "id": "nap-rec-mid-june",
                "title": "Review mid-June operational drivers (5–17 Jun)",
                "affectedArea": "Level 6 & Level 7",
                "estimatedSaving": "Medium — after event/HVAC cross-check",
                "priority": "High",
                "reason": (
                    f"{len(mid_june_anomalies)} weekday anomaly day(s) occurred from 5 Jun, including peak day {peak_day}. "
                    "Level 7 aggregate load rose sharply while Level 6 remained relatively stable."
                ),
                "suggestedAction": (
                    "Cross-check room bookings, events, HVAC setpoints, and fan isolation for 10–14 Jun. "
                    "Use anomaly drill-down hourly charts to identify category and hour of excess use."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    weekend_anomalies = [row for row in anomaly_days if row["dayType"] == "weekend"]
    if weekend_anomalies:
        dates = ", ".join(row["date"] for row in weekend_anomalies[:3])
        recommendations.append(
            {
                "id": "nap-rec-weekend-anomaly",
                "title": "Investigate high-load weekends (Jun 13–14)",
                "affectedArea": "Level 7 (primary)",
                "estimatedSaving": "Medium — after schedule audit",
                "priority": "Medium",
                "reason": (
                    f"Weekend days {dates} exceeded the weekend baseline by >15%. "
                    "Level 7 ventilation load on 13–14 Jun resembles weekday fan profiles rather than early-May weekend shutdown."
                ),
                "suggestedAction": (
                    "Confirm whether extended weekend operation was intentional. If not, restore weekend fan isolation "
                    "and validate heatmap profiles against the weekday reference."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    if after_hours / wd_total > 0.08 if wd_total else False:
        recommendations.append(
            {
                "id": "nap-rec-afterhours",
                "title": "Reduce weekday after-hours baseload (22:00–06:00)",
                "affectedArea": "Level 6 & Level 7",
                "estimatedSaving": "Low–medium — after setback policy",
                "priority": "Medium",
                "reason": (
                    f"Weekday consumption between 22:00–06:00 was {round1(after_hours):,.1f} kWh "
                    f"({round1(after_hours / wd_total * 100)}% of weekday aggregate total)."
                ),
                "suggestedAction": (
                    "Implement lighting and ventilation setbacks when spaces are unoccupied; "
                    "target fan and plug loads visible in the hourly heatmap."
                ),
                "status": "New",
                "owner": "TBD",
            }
        )

    early_weekend = [row for row in daily_rows if row["dayType"] == "weekend" and row["date"] < "2026-06-06"]
    late_weekend = [row for row in daily_rows if row["dayType"] == "weekend" and row["date"] >= "2026-06-06"]
    if early_weekend and late_weekend:
        early_avg = round1(sum(row["total"] for row in early_weekend) / len(early_weekend))
        late_avg = round1(sum(row["total"] for row in late_weekend) / len(late_weekend))
        if late_avg > early_avg * 1.5:
            recommendations.append(
                {
                    "id": "nap-rec-weekend-schedule",
                    "title": "Standardise weekend shutdown policy",
                    "affectedArea": "Level 6 & Level 7",
                    "estimatedSaving": "Medium — if late-June pattern is unintended",
                    "priority": "Medium",
                    "reason": (
                        f"Early-period weekend average was {early_avg} kWh/day vs {late_avg} kWh/day from 6 Jun onward. "
                        "Heatmaps show fans largely off in May weekends but active overnight in mid-June weekends."
                    ),
                    "suggestedAction": (
                        "Document intended weekend operating mode and enforce consistent BMS fan/lighting schedules "
                        "unless extended operation is approved."
                    ),
                    "status": "New",
                    "owner": "TBD",
                }
            )

    return recommendations


def build_daily_rows(totals: pd.DataFrame, type_means: dict[str, float]) -> list[dict]:
    daily = aggregate_daily_totals(totals)
    daily_mean = daily["total"].mean()

    daily_rows = []
    for _, row in daily.iterrows():
        expected = round1(type_means.get(row["day_type"], daily_mean))
        threshold = round1(expected * 1.15)
        total = round1(row["total"])
        entry = {
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
        if row["day_type"] == "holiday":
            entry["holidayName"] = SG_PUBLIC_HOLIDAYS[row["date_str"]]
        daily_rows.append(entry)
    return daily_rows


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
        month_label = pd.Timestamp(f"{month_key}-01").strftime("%b %Y")
        monthly_breakdown.append(
            {
                "month": month_key,
                "label": month_label,
                "kwh": round1(kwh),
                "tariffCentsInclGst": SP_TARIFF_CENTS_INCL_GST.get(
                    month_key, SP_TARIFF_DEFAULT_CENTS_INCL_GST
                ),
                "costSgd": cost,
            }
        )

    return {
        "totalSgd": round2_money(total_cost),
        "monthly": monthly_breakdown,
        "blendedTariffSgd": round2_money(total_cost / total_kwh) if total_kwh else 0.0,
    }


def scale_tree_to_cost(tree: dict, tariff_sgd: float) -> dict:
    def scale_meters(meters: list[dict]) -> list[dict]:
        return [{**meter, "kwh": round2_money(meter["kwh"] * tariff_sgd)} for meter in meters]

    levels = []
    for level in tree["levels"]:
        levels.append(
            {
                **level,
                "totalKwh": round2_money(level["totalKwh"] * tariff_sgd),
                "aggregates": scale_meters(level["aggregates"]),
                "subMeters": scale_meters(level["subMeters"]),
            }
        )
    return {
        "totalKwh": round2_money(tree["totalKwh"] * tariff_sgd),
        "levels": levels,
    }


def is_light_meter(device: str) -> bool:
    return "light" in device.lower()


def build_consumption_tree(frame: pd.DataFrame, scale: float, round_fn=round1) -> dict:
    """Build Level -> aggregate totals -> sub-meters tree from delta_kwh sums."""

    def scaled_sum(subframe: pd.DataFrame) -> float:
        if subframe.empty:
            return 0.0
        return round_fn(subframe["delta_kwh"].sum() * scale)

    aggregate_frame = frame[frame["category"] == "Aggregate"].copy()
    sub_frame = frame[frame["category"] != "Aggregate"].copy()

    levels = []
    for level_num in (6, 7):
        level_aggregate = aggregate_frame[aggregate_frame["level"] == level_num]
        level_sub = sub_frame[sub_frame["level"] == level_num]

        aggregates = []
        for device in sorted(level_aggregate["device"].unique()):
            device_rows = level_aggregate[level_aggregate["device"] == device]
            aggregates.append(
                {
                    "name": device,
                    "kwh": scaled_sum(device_rows),
                    "group": "light" if is_light_meter(device) else "load",
                }
            )
        aggregates.sort(key=lambda item: (0 if item["group"] == "light" else 1, item["name"]))

        sub_meters = []
        for device in sorted(level_sub["device"].unique()):
            device_rows = level_sub[level_sub["device"] == device]
            sub_meters.append(
                {
                    "name": device,
                    "kwh": scaled_sum(device_rows),
                    "group": "light" if is_light_meter(device) else "load",
                }
            )
        sub_meters.sort(key=lambda item: (0 if item["group"] == "light" else 1, item["name"]))

        levels.append(
            {
                "name": f"Level {level_num}",
                "level": level_num,
                "totalKwh": scaled_sum(level_aggregate),
                "aggregates": aggregates,
                "subMeters": sub_meters,
            }
        )

    return {
        "totalKwh": scaled_sum(aggregate_frame),
        "levels": levels,
    }


def attach_comparison(tree: dict, previous_tree: dict) -> dict:
    """Attach previous-period values and trend percentages to a consumption tree."""

    def enrich_meters(current_meters: list, previous_meters: list) -> None:
        previous_by_name = {item["name"]: item for item in previous_meters}
        for meter in current_meters:
            previous = previous_by_name.get(meter["name"])
            if previous is not None:
                meter["previousKwh"] = previous["kwh"]
                meter["trendPct"] = trend_pct(meter["kwh"], previous["kwh"])
            else:
                meter["previousKwh"] = 0.0
                meter["trendPct"] = 0.0

    tree["previousTotalKwh"] = previous_tree["totalKwh"]
    tree["totalTrendPct"] = trend_pct(tree["totalKwh"], previous_tree["totalKwh"])

    previous_by_level = {level["level"]: level for level in previous_tree["levels"]}
    for level in tree["levels"]:
        previous_level = previous_by_level.get(
            level["level"],
            {"totalKwh": 0.0, "aggregates": [], "subMeters": []},
        )
        level["previousTotalKwh"] = previous_level.get("totalKwh", 0.0)
        level["totalTrendPct"] = trend_pct(level["totalKwh"], level["previousTotalKwh"])
        enrich_meters(level["aggregates"], previous_level.get("aggregates", []))
        enrich_meters(level["subMeters"], previous_level.get("subMeters", []))

    return tree


def build_highlight_breakdown(
    key: str,
    label: str,
    unit: str,
    note: str,
    current_tree: dict,
    previous_tree: dict,
) -> dict:
    return {
        "key": key,
        "label": label,
        "unit": unit,
        "note": note,
        **attach_comparison(current_tree, previous_tree),
    }


def build_clock_hour_frame(all_df: pd.DataFrame, date, hour: int) -> pd.DataFrame:
    day = pd.Timestamp(date).strftime("%Y-%m-%d")
    hour_times = [
        pd.Timestamp(f"{day} {hour:02d}:00") + pd.Timedelta(minutes=15 * index)
        for index in range(4)
    ]
    return all_df[all_df["time"].isin(hour_times)].copy()


def compute_top_clock_hour_peaks(totals: pd.DataFrame, limit: int = 5) -> list[dict]:
    """Return the highest fixed clock-hour windows across the monitoring period."""
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


def build_peak_breakdown_tree(frame: pd.DataFrame, scale: float = 1.0, round_fn=round1) -> dict:
    """Peak breakdown uses aggregate totals for floor split; device rows are sub-meters only."""

    def scaled_sum(subframe: pd.DataFrame) -> float:
        if subframe.empty:
            return 0.0
        return round_fn(subframe["delta_kwh"].sum() * scale)

    aggregate_frame = frame[frame["category"] == "Aggregate"].copy()
    sub_frame = frame[frame["category"] != "Aggregate"].copy()

    levels = []
    for level_num in (6, 7):
        level_aggregate = aggregate_frame[aggregate_frame["level"] == level_num]
        level_sub = sub_frame[sub_frame["level"] == level_num]

        sub_meters = []
        for device in sorted(level_sub["device"].unique()):
            device_rows = level_sub[level_sub["device"] == device]
            sub_meters.append(
                {
                    "name": device,
                    "kwh": scaled_sum(device_rows),
                    "group": "light" if is_light_meter(device) else "load",
                }
            )
        sub_meters.sort(key=lambda item: (0 if item["group"] == "light" else 1, item["name"]))

        levels.append(
            {
                "name": f"Level {level_num}",
                "level": level_num,
                "totalKwh": scaled_sum(level_aggregate),
                "aggregates": [],
                "subMeters": sub_meters,
            }
        )

    return {
        "totalKwh": scaled_sum(aggregate_frame),
        "levels": levels,
    }


def build_top_peaks(all_df: pd.DataFrame, limit: int = 5) -> list[dict]:
    """Build top clock-hour peaks with Level 6/7 breakdown (no previous-period comparison)."""
    totals = all_df[all_df["category"] == "Aggregate"].copy()
    clock_peaks = compute_top_clock_hour_peaks(totals, limit)
    top_peaks = []
    for rank, peak in enumerate(clock_peaks, start=1):
        frame = build_clock_hour_frame(all_df, peak["date"], peak["hour"])
        tree = build_peak_breakdown_tree(frame, scale=1.0)
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


def write_share_dataset(payload: dict) -> None:
    share_payload = copy.deepcopy(payload)
    share_payload["projectName"] = NP_SHARE_PROJECT_NAME
    share_payload["meta"]["sourceFiles"] = [
        "Level 6 meter data (19 May - 17 June).xlsx",
        "Level 7 meter data (19 May - 17 June).xlsx",
    ]
    share_payload["meta"]["previousSourceFiles"] = [
        "Level 6 meter data (21 April - 20 May).xlsx",
        "Level 7 meter data (21 April - 20 May).xlsx",
    ]
    share_content = f"""/**
 * @file napEnergyAnalysisData.share.ts
 * @brief Desensitized NP energy analysis data for public HTML export.
 * @note Auto-generated by scripts/generate_nap_analysis_data.py. Do not edit manually.
 */
import type {{ NapEnergyAnalysisData }} from "./napEnergyAnalysisData";

export const napEnergyAnalysisDataShare: NapEnergyAnalysisData = {json.dumps(share_payload, indent=2)};
"""
    SHARE_OUT_PATH.write_text(share_content, encoding="utf-8")
    print(f"Wrote {SHARE_OUT_PATH}")


def main() -> None:
    all_df = load_period_frames(L6_CURRENT_PATH, L7_CURRENT_PATH)
    previous_df = load_period_frames(L6_PREVIOUS_PATH, L7_PREVIOUS_PATH)
    current_period = summarize_period(all_df)
    previous_period = summarize_period(previous_df)

    totals = all_df[all_df["category"] == "Aggregate"].copy()
    subs = all_df[all_df["category"] != "Aggregate"].copy()
    previous_totals = previous_df[previous_df["category"] == "Aggregate"].copy()

    period_start = current_period["periodStart"]
    period_end = current_period["periodEnd"]
    day_count = current_period["dayCount"]
    total_kwh = current_period["totalKwh"]
    l6_total = current_period["level6Kwh"]
    l7_total = current_period["level7Kwh"]
    daily_mean = current_period["dailyAverageKwh"]
    prev_period_label = f"{previous_period['periodStart']} to {previous_period['periodEnd']}"

    baseline_daily = build_baseline_daily_frame(previous_totals, totals)
    baseline_meta = build_baseline_meta(baseline_daily)
    all_type_means = baseline_meta["byScope"]["all"]

    daily_rows = build_daily_rows(totals, all_type_means)
    previous_daily_rows = build_daily_rows(previous_totals, all_type_means)
    current_cost = compute_period_estimated_cost(daily_rows)
    previous_cost = compute_period_estimated_cost(previous_daily_rows)

    comparison = {
        "previousPeriodStart": previous_period["periodStart"],
        "previousPeriodEnd": previous_period["periodEnd"],
        "previousTotalKwh": previous_period["totalKwh"],
        "previousDailyAverageKwh": previous_period["dailyAverageKwh"],
        "previousPeakDemand1hKwh": previous_period["peakDemand1hKwh"],
        "previousEstimatedCostSgd": previous_cost["totalSgd"],
        "previousLevel6Kwh": previous_period["level6Kwh"],
        "previousLevel7Kwh": previous_period["level7Kwh"],
        "totalTrendPct": trend_pct(total_kwh, previous_period["totalKwh"]),
        "dailyAverageTrendPct": trend_pct(daily_mean, previous_period["dailyAverageKwh"]),
        "peakTrendPct": trend_pct(
            current_period["peakDemand1hKwh"],
            previous_period["peakDemand1hKwh"],
        ),
        "estimatedCostTrendPct": trend_pct(current_cost["totalSgd"], previous_cost["totalSgd"]),
    }

    anomaly_days = [row for row in daily_rows if row["anomaly"]]
    weekday_rows = [row for row in daily_rows if row["dayType"] == "weekday"]
    weekend_rows = [row for row in daily_rows if row["dayType"] == "weekend"]
    holiday_rows = [row for row in daily_rows if row["dayType"] == "holiday"]
    weekday_daily_avg = round1(sum(row["total"] for row in weekday_rows) / max(len(weekday_rows), 1))
    weekend_daily_avg = round1(sum(row["total"] for row in weekend_rows) / max(len(weekend_rows), 1))
    holiday_daily_avg = round1(sum(row["total"] for row in holiday_rows) / max(len(holiday_rows), 1))

    # Hourly profiles: per clock hour, sum all sub-meters in each tag, then average across days in the profile.
    def hourly_profile(frame: pd.DataFrame, mask) -> list[dict]:
        subset = frame.loc[mask].copy()
        if subset.empty:
            return [{"hour": f"{hour:02d}", "total": 0} for hour in range(24)]
        dates = subset["date"].unique()
        hour_sums = {hour: 0.0 for hour in range(24)}
        for date in dates:
            day_df = subset[subset["date"] == date]
            for hour in range(24):
                hour_sums[hour] += day_df.loc[day_df["hour"] == hour, "delta_kwh"].sum()
        day_count = len(dates)
        rows = []
        for hour in range(24):
            rows.append(
                {
                    "hour": f"{hour:02d}",
                    "total": round2(hour_sums[hour] / day_count if day_count else 0),
                }
            )
        return rows

    def hourly_by_category(frame: pd.DataFrame, mask: pd.Series) -> list[dict]:
        return hourly_by_category_filtered(frame.loc[mask].copy())

    def hourly_by_category_filtered(filtered: pd.DataFrame) -> list[dict]:
        categories = ["Lighting", "Office Load", "Ventilation/Fan"]
        if filtered.empty:
            return [
                {"hour": f"{hour:02d}", "Lighting": 0, "Office_Load": 0, "Ventilation_Fan": 0, "total": 0}
                for hour in range(24)
            ]

        dates = filtered["date"].unique()
        hour_category_sums = {
            hour: {cat: 0.0 for cat in categories} for hour in range(24)
        }

        for date in dates:
            day_df = filtered[filtered["date"] == date]
            for hour in range(24):
                hour_df = day_df[day_df["hour"] == hour]
                for cat in categories:
                    hour_category_sums[hour][cat] += hour_df.loc[
                        hour_df["category"] == cat, "delta_kwh"
                    ].sum()

        day_count = len(dates)
        rows = []
        for hour in range(24):
            row = {"hour": f"{hour:02d}"}
            category_totals = []
            for cat in categories:
                key = cat.replace(" ", "_").replace("/", "_")
                value = round2(hour_category_sums[hour][cat] / day_count if day_count else 0)
                row[key] = value
                category_totals.append(value)
            row["total"] = round2(sum(category_totals))
            rows.append(row)
        return rows

    def profile_stacked_y_max(profile_hourly: dict) -> float:
        peak = 0.0
        for space_profiles in profile_hourly.values():
            for profile_rows in space_profiles.values():
                for row in profile_rows:
                    stacked = row.get("Lighting", 0) + row.get("Office_Load", 0) + row.get("Ventilation_Fan", 0)
                    peak = max(peak, stacked)
        if peak <= 0:
            return 10.0
        return round1(peak * 1.08)

    def build_appliance_distribution(frame: pd.DataFrame) -> list[dict]:
        cat_totals = frame.groupby("category")["delta_kwh"].sum()
        cat_total_sum = cat_totals.sum()
        rows = []
        for cat in ["Office Load", "Lighting", "Ventilation/Fan"]:
            value = round1(cat_totals.get(cat, 0))
            rows.append(
                {
                    "tag": cat,
                    "value": value,
                    "percentage": round1(value / cat_total_sum * 100) if cat_total_sum else 0,
                }
            )
        return rows

    def build_profile_hourly_by_space(source: pd.DataFrame) -> dict:
        profiles: dict[str, dict] = {}
        for space_key, level_num in [("all", None), ("level6", 6), ("level7", 7)]:
            scoped = source if level_num is None else source[source["level"] == level_num]
            profiles[space_key] = {
                "weekday": hourly_by_category_filtered(scoped[scoped["day_type"] == "weekday"]),
                "weekend": hourly_by_category_filtered(scoped[scoped["day_type"] == "weekend"]),
                "holiday": hourly_by_category_filtered(scoped[scoped["day_type"] == "holiday"]),
            }
        return profiles

    def hourly_rows_for_day(day_df: pd.DataFrame) -> list[dict]:
        categories = ["Lighting", "Office Load", "Ventilation/Fan"]
        rows = []
        for hour in range(24):
            hour_df = day_df[day_df["hour"] == hour]
            lighting = round2(hour_df[hour_df["category"] == "Lighting"]["delta_kwh"].sum())
            office_load = round2(hour_df[hour_df["category"] == "Office Load"]["delta_kwh"].sum())
            ventilation_fan = round2(hour_df[hour_df["category"] == "Ventilation/Fan"]["delta_kwh"].sum())
            rows.append(
                {
                    "hour": f"{hour:02d}",
                    "Lighting": lighting,
                    "Office_Load": office_load,
                    "Ventilation_Fan": ventilation_fan,
                    "total": round2(lighting + office_load + ventilation_fan),
                }
            )
        return rows

    def build_daily_hourly_by_space(source: pd.DataFrame) -> dict:
        profiles: dict[str, dict] = {}
        for space_key, level_num in [("all", None), ("level6", 6), ("level7", 7)]:
            scoped = source if level_num is None else source[source["level"] == level_num]
            by_date: dict[str, list] = {}
            for date_val in sorted(scoped["date"].unique()):
                date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
                by_date[date_str] = hourly_rows_for_day(scoped[scoped["date"] == date_val])
            profiles[space_key] = by_date
        return profiles

    totals["day_type"] = totals["date"].apply(resolve_day_type)
    subs["day_type"] = subs["date"].apply(resolve_day_type)
    weekday_mask_totals = totals["day_type"] == "weekday"
    weekend_mask_totals = totals["day_type"] == "weekend"
    holiday_mask_totals = totals["day_type"] == "holiday"
    weekday_mask_subs = subs["day_type"] == "weekday"
    weekend_mask_subs = subs["day_type"] == "weekend"
    holiday_mask_subs = subs["day_type"] == "holiday"
    hourly_weekday = hourly_profile(totals, weekday_mask_totals)
    hourly_weekend = hourly_profile(totals, weekend_mask_totals)
    hourly_holiday = hourly_profile(totals, holiday_mask_totals)
    hourly_weekday_by_cat = hourly_by_category(subs, weekday_mask_subs)
    hourly_weekend_by_cat = hourly_by_category(subs, weekend_mask_subs)
    hourly_holiday_by_cat = hourly_by_category(subs, holiday_mask_subs)
    profile_hourly_by_space = build_profile_hourly_by_space(subs)
    daily_hourly_by_space = build_daily_hourly_by_space(subs)

    # Category totals (sub-meters)
    appliance_distribution = build_appliance_distribution(subs)
    appliance_distribution_by_space = {
        "all": appliance_distribution,
        "level6": build_appliance_distribution(subs[subs["level"] == 6]),
        "level7": build_appliance_distribution(subs[subs["level"] == 7]),
    }

    holiday_days = [
        {
            "date": row["date"],
            "shortLabel": row["shortLabel"],
            "name": row.get("holidayName", "Public Holiday"),
        }
        for row in holiday_rows
    ]
    profile_meta = {
        "weekdayCount": len(weekday_rows),
        "weekendCount": len(weekend_rows),
        "holidayCount": len(holiday_rows),
        "holidayDays": holiday_days,
        "periodLabel": f"{period_start} to {period_end}",
        "stackedProfileYMax": profile_stacked_y_max(profile_hourly_by_space),
    }

    # Circuit ranking (sub-meters)
    circuit_rows = []
    for device, grp in subs.groupby("device"):
        kwh = round1(grp["delta_kwh"].sum())
        level = int(grp["level"].iloc[0])
        circuit_rows.append(
            {
                "name": device,
                "level": level,
                "category": categorize(device),
                "consumption": kwh,
            }
        )
    circuit_rows.sort(key=lambda item: item["consumption"], reverse=True)

    def build_device_daily_readings(frame: pd.DataFrame) -> list[dict]:
        usable = frame[frame["category"].isin(["Lighting", "Office Load", "Ventilation/Fan"])]
        grouped = (
            usable.groupby(["date", "device", "level", "category"])["delta_kwh"].sum().reset_index()
        )
        rows = []
        for _, row in grouped.iterrows():
            rows.append(
                {
                    "date": str(row["date"]),
                    "device": row["device"],
                    "level": int(row["level"]),
                    "category": row["category"],
                    "kwh": round1(row["delta_kwh"]),
                }
            )
        return rows

    device_daily_readings = build_device_daily_readings(subs)

    def build_device_hourly_profiles(frame: pd.DataFrame) -> list[dict]:
        usable = frame[frame["category"].isin(["Lighting", "Office Load", "Ventilation/Fan"])]
        if usable.empty:
            return []
        rows = []
        for device, grp in usable.groupby("device"):
            level = int(grp["level"].iloc[0])
            category = str(grp["category"].iloc[0])
            dates = grp["date"].unique()
            hour_sums = {hour: 0.0 for hour in range(24)}
            for date in dates:
                day_df = grp[grp["date"] == date]
                for hour in range(24):
                    hour_sums[hour] += day_df.loc[day_df["hour"] == hour, "delta_kwh"].sum()
            day_count = len(dates)
            hourly = [
                round2(hour_sums[hour] / day_count if day_count else 0) for hour in range(24)
            ]
            rows.append(
                {
                    "device": device,
                    "level": level,
                    "category": category,
                    "hourlyKwh": hourly,
                }
            )
        rows.sort(key=lambda item: (item["level"], item["device"]))
        return rows

    def build_device_hourly_by_date(frame: pd.DataFrame) -> dict:
        """Per calendar date, per sub-meter clock-hour kWh (single-day totals, not averaged)."""
        usable = frame[frame["category"].isin(["Lighting", "Office Load", "Ventilation/Fan"])]
        if usable.empty:
            return {}
        by_date: dict[str, list] = {}
        for date_val in sorted(usable["date"].unique()):
            date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
            day_frame = usable[usable["date"] == date_val]
            profiles = []
            for device, grp in day_frame.groupby("device"):
                level = int(grp["level"].iloc[0])
                category = str(grp["category"].iloc[0])
                hourly = [
                    round2(grp.loc[grp["hour"] == hour, "delta_kwh"].sum()) for hour in range(24)
                ]
                profiles.append(
                    {
                        "device": device,
                        "level": level,
                        "category": category,
                        "hourlyKwh": hourly,
                    }
                )
            profiles.sort(key=lambda item: (item["level"], item["device"]))
            by_date[date_str] = profiles
        return by_date

    def build_level_usage_by_day_type(frame: pd.DataFrame, day_counts: dict[str, int]) -> dict:
        usable = frame[frame["category"].isin(["Lighting", "Office Load", "Ventilation/Fan"])]
        summary: dict[str, dict] = {}
        for day_type in ["weekday", "weekend", "holiday"]:
            subset = usable[usable["day_type"] == day_type]
            sample_count = int(day_counts.get(day_type, 0))
            level6_kwh = round1(subset[subset["level"] == 6]["delta_kwh"].sum())
            level7_kwh = round1(subset[subset["level"] == 7]["delta_kwh"].sum())
            summary[day_type] = {
                "level6Kwh": level6_kwh,
                "level7Kwh": level7_kwh,
                "sampleCount": sample_count,
            }
        return summary

    device_hourly_profiles = build_device_hourly_profiles(subs)
    device_hourly_by_date = build_device_hourly_by_date(subs)
    device_hourly_profiles_by_day_type = {
        day_type: build_device_hourly_profiles(subs[subs["day_type"] == day_type])
        for day_type in ["weekday", "weekend", "holiday"]
    }
    level_usage_by_day_type = build_level_usage_by_day_type(
        subs,
        {
            "weekday": len(weekday_rows),
            "weekend": len(weekend_rows),
            "holiday": len(holiday_rows),
        },
    )

    # Peak clock-hour window (aggregate Total Office Light + Total Office Load meters)
    peak_value = current_period["peakDemand1hKwh"]
    peak_window = current_period["peakWindow"]

    # Daily breakdown for charts (by category and level)
    daily_cat = (
        subs.groupby(["date", "category"])["delta_kwh"].sum().unstack(fill_value=0).reset_index()
    )
    daily_level = (
        totals.groupby(["date", "level"])["delta_kwh"].sum().unstack(fill_value=0).reset_index()
    )

    def build_tag_chart_rows() -> list[dict]:
        rows = []
        for day in daily_rows:
            date_key = pd.Timestamp(day["date"]).date()
            cat_row = daily_cat[daily_cat["date"] == date_key]
            if cat_row.empty:
                continue
            cat = cat_row.iloc[0]
            rows.append(
                {
                    "label": day["shortLabel"],
                    "lighting": round1(cat.get("Lighting", 0)),
                    "office_load": round1(cat.get("Office Load", 0)),
                    "ventilation_fan": round1(cat.get("Ventilation/Fan", 0)),
                    "total": round1(day["total"]),
                }
            )
        return rows

    def build_space_chart_rows() -> list[dict]:
        rows = []
        for day in daily_rows:
            date_key = pd.Timestamp(day["date"]).date()
            lvl = daily_level[daily_level["date"] == date_key]
            if lvl.empty:
                continue
            lv = lvl.iloc[0]
            rows.append(
                {
                    "label": day["shortLabel"],
                    "level_6": round1(lv.get(6, 0)),
                    "level_7": round1(lv.get(7, 0)),
                    "total": round1(day["total"]),
                }
            )
        return rows

    def build_level_tag_chart_rows(level_num: int) -> list[dict]:
        level_subs = subs[subs["level"] == level_num]
        daily_cat_level = (
            level_subs.groupby(["date", "category"])["delta_kwh"]
            .sum()
            .unstack(fill_value=0)
            .reset_index()
        )
        rows = []
        for day in daily_rows:
            date_key = pd.Timestamp(day["date"]).date()
            cat_row = daily_cat_level[daily_cat_level["date"] == date_key]
            if cat_row.empty:
                lighting = office_load = ventilation_fan = 0.0
            else:
                cat = cat_row.iloc[0]
                lighting = round1(cat.get("Lighting", 0))
                office_load = round1(cat.get("Office Load", 0))
                ventilation_fan = round1(cat.get("Ventilation/Fan", 0))
            total = round1(lighting + office_load + ventilation_fan)
            rows.append(
                {
                    "label": day["shortLabel"],
                    "lighting": lighting,
                    "office_load": office_load,
                    "ventilation_fan": ventilation_fan,
                    "total": total,
                }
            )
        return rows

    level6_tag_chart_rows = build_level_tag_chart_rows(6)
    level7_tag_chart_rows = build_level_tag_chart_rows(7)

    # After-hours vs office hours (weekdays, aggregate)
    wd = totals[weekday_mask_totals].copy()
    after_hours = wd[(wd["hour"] >= 22) | (wd["hour"] < 6)]["delta_kwh"].sum()
    office_hours = wd[(wd["hour"] >= 8) & (wd["hour"] < 18)]["delta_kwh"].sum()
    wd_total = wd["delta_kwh"].sum()

    top_days = sorted(daily_rows, key=lambda r: r["total"], reverse=True)[:5]

    findings = build_findings_sections(
        period_start=period_start,
        period_end=period_end,
        day_count=day_count,
        total_kwh=total_kwh,
        comparison=comparison,
        previous_period=previous_period,
        daily_mean=daily_mean,
        l6_total=l6_total,
        l7_total=l7_total,
        weekday_daily_avg=weekday_daily_avg,
        weekend_daily_avg=weekend_daily_avg,
        holiday_daily_avg=holiday_daily_avg,
        appliance_distribution=appliance_distribution,
        circuit_rows=circuit_rows,
        after_hours=after_hours,
        wd_total=wd_total,
        office_hours=office_hours,
        top_days=top_days,
        anomaly_days=anomaly_days,
        baseline_meta=baseline_meta,
        peak_window=peak_window,
        peak_value=peak_value,
    )

    recommendations = build_recommendations(
        circuit_rows=circuit_rows,
        daily_rows=daily_rows,
        anomaly_days=anomaly_days,
        top_days=top_days,
        after_hours=after_hours,
        wd_total=wd_total,
        subs=subs,
    )

    devices_l6 = sorted(subs[subs["level"] == 6]["device"].unique().tolist())
    devices_l7 = sorted(subs[subs["level"] == 7]["device"].unique().tolist())

    prev_day_count = previous_period["dayCount"]

    top_peaks = build_top_peaks(all_df, limit=5)

    cost_monthly_note = "; ".join(
        f"{item['label']}: {item['kwh']} kWh × {item['tariffCentsInclGst']:.2f}¢"
        for item in current_cost["monthly"]
    )
    cost_breakdown_note = (
        "Estimated from aggregate meter consumption × SP regulated tariff (incl. 9% GST). "
        f"Apr/May/Jun 2026: 29.72¢/kWh (27.27¢ ex GST). {cost_monthly_note}."
    )

    current_breakdown_trees = {
        "total": build_consumption_tree(all_df, scale=1.0),
        "daily_avg": build_consumption_tree(all_df, scale=1.0 / day_count),
    }
    previous_breakdown_trees = {
        "total": build_consumption_tree(previous_df, scale=1.0),
        "daily_avg": build_consumption_tree(previous_df, scale=1.0 / prev_day_count),
    }
    current_cost_tree = scale_tree_to_cost(current_breakdown_trees["total"], current_cost["blendedTariffSgd"])
    previous_cost_tree = scale_tree_to_cost(previous_breakdown_trees["total"], previous_cost["blendedTariffSgd"])

    highlight_breakdowns = {
        "total": build_highlight_breakdown(
            "total",
            "Total Consumption",
            "kWh",
            "Sum of four aggregate meters (Total Office Light + Total Office Load per floor).",
            current_breakdown_trees["total"],
            previous_breakdown_trees["total"],
        ),
        "daily_avg": build_highlight_breakdown(
            "daily_avg",
            "Daily Average",
            "kWh/day",
            f"Period totals divided by {day_count} days.",
            current_breakdown_trees["daily_avg"],
            previous_breakdown_trees["daily_avg"],
        ),
        "estimated_cost": build_highlight_breakdown(
            "estimated_cost",
            "Estimated Cost",
            "SGD",
            cost_breakdown_note,
            current_cost_tree,
            previous_cost_tree,
        ),
    }

    payload = {
        "projectId": NP_PROJECT_ID,
        "projectName": NP_PROJECT_NAME,
        "meta": {
            "periodStart": period_start,
            "periodEnd": period_end,
            "dayCount": day_count,
            "intervalMinutes": 15,
            "sourceFiles": [
                "Ngee Ann Poly Level 6 (19 May - 17 June).xlsx",
                "Ngee Ann Poly Level 7 (19 May - 17 June).xlsx",
            ],
            "previousPeriodStart": previous_period["periodStart"],
            "previousPeriodEnd": previous_period["periodEnd"],
            "previousSourceFiles": [
                "Ngee Ann Poly Level 6 (21 April - 20 May).xlsx",
                "Ngee Ann Poly Level 7 (21 April - 20 May).xlsx",
            ],
        },
        "comparison": comparison,
        "summary": {
            "totalKwh": total_kwh,
            "level6Kwh": l6_total,
            "level7Kwh": l7_total,
            "dailyAverageKwh": round1(daily_mean),
            "level7SharePct": round1(l7_total / total_kwh * 100),
            "peakDemand1hKwh": round1(peak_value),
            "peakWindow": peak_window,
            "weekdayDailyAvgKwh": weekday_daily_avg,
            "weekendDailyAvgKwh": weekend_daily_avg,
            "holidayDailyAvgKwh": holiday_daily_avg,
            "afterHoursWeekdayKwh": round1(after_hours),
            "afterHoursWeekdayPct": round1(after_hours / wd_total * 100),
            "officeHoursWeekdayKwh": round1(office_hours),
            "estimatedCostSgd": current_cost["totalSgd"],
            "costMonthlyBreakdown": current_cost["monthly"],
        },
        "highlights": [
            {
                "key": "total",
                "label": "Total Consumption",
                "value": total_kwh,
                "unit": "kWh",
                "trendPct": comparison["totalTrendPct"],
                "note": f"vs previous period ({prev_period_label}): {previous_period['totalKwh']} kWh.",
                "icon": "bolt",
            },
            {
                "key": "daily_avg",
                "label": "Daily Average",
                "value": round1(daily_mean),
                "unit": "kWh/day",
                "trendPct": comparison["dailyAverageTrendPct"],
                "note": f"Previous period daily average: {previous_period['dailyAverageKwh']} kWh/day.",
                "icon": "clock",
            },
            {
                "key": "peak",
                "label": "Peak 1h Consumption",
                "value": round1(peak_value),
                "unit": "kWh",
                "trendPct": 0,
                "note": f"Highest clock hour: {peak_window}. Click for top 5 breakdown.",
                "icon": "gauge",
            },
            {
                "key": "estimated_cost",
                "label": "Estimated Cost",
                "value": current_cost["totalSgd"],
                "unit": "SGD",
                "trendPct": comparison["estimatedCostTrendPct"],
                "note": (
                    f"SP regulated tariff Apr–Jun 2026: 29.72¢/kWh incl. GST "
                    f"({cost_monthly_note}). Previous period: SGD {previous_cost['totalSgd']:.2f}."
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
        "tagChartRows": build_tag_chart_rows(),
        "spaceChartRows": build_space_chart_rows(),
        "level6TagChartRows": level6_tag_chart_rows,
        "level7TagChartRows": level7_tag_chart_rows,
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
        "topPeaks": top_peaks,
        "highlightBreakdowns": highlight_breakdowns,
    }

    ts_content = f"""/**
 * @file napEnergyAnalysisData.ts
 * @brief Ngee Ann Poly energy analysis data generated from Excel source files.
 * @note Auto-generated by scripts/generate_nap_analysis_data.py — do not edit manually.
 */
import {{ AnalysisHighlight, RecommendationItem }} from "@/mock/types";

export const NP_PROJECT_ID = "{NP_PROJECT_ID}";
export const NP_PROJECT_NAME = "{NP_PROJECT_NAME}";

export interface NapDailyTotalRow {{
  date: string;
  shortLabel: string;
  dayType: "weekday" | "weekend" | "holiday";
  holidayName?: string;
  total: number;
  level6: number;
  level7: number;
  expected: number;
  threshold: number;
  anomaly: boolean;
  deltaPct: number;
}}

export interface NapHourlyRow {{
  hour: string;
  total: number;
  Lighting?: number;
  Office_Load?: number;
  Ventilation_Fan?: number;
}}

export interface NapCircuitRow {{
  name: string;
  level: number;
  category: string;
  consumption: number;
}}

export interface NapDeviceDailyReading {{
  date: string;
  device: string;
  level: 6 | 7;
  category: string;
  kwh: number;
}}

export interface NapDeviceHourlyProfile {{
  device: string;
  level: 6 | 7;
  category: string;
  hourlyKwh: number[];
}}

export interface NapBreakdownMeterRow {{
  name: string;
  kwh: number;
  group: "light" | "load";
  previousKwh?: number;
  trendPct?: number;
}}

export interface NapBreakdownLevelRow {{
  name: string;
  level: number;
  totalKwh: number;
  previousTotalKwh?: number;
  totalTrendPct?: number;
  aggregates: NapBreakdownMeterRow[];
  subMeters: NapBreakdownMeterRow[];
}}

export interface NapHighlightBreakdown {{
  key: string;
  label: string;
  unit: string;
  note: string;
  totalKwh: number;
  previousTotalKwh?: number;
  totalTrendPct?: number;
  levels: NapBreakdownLevelRow[];
}}

export interface NapPeakLevelRow {{
  name: string;
  level: number;
  totalKwh: number;
  aggregates: NapBreakdownMeterRow[];
  subMeters: NapBreakdownMeterRow[];
}}

export interface NapPeakWindow {{
  rank: number;
  kwh: number;
  window: string;
  date: string;
  totalKwh: number;
  levels: NapPeakLevelRow[];
}}

export interface NapCostMonthRow {{
  month: string;
  label: string;
  kwh: number;
  tariffCentsInclGst: number;
  costSgd: number;
}}

export interface NapFindingSection {{
  title: string;
  items: string[];
}}

export interface NapEnergyAnalysisData {{
  projectId: string;
  projectName: string;
  meta: {{
    periodStart: string;
    periodEnd: string;
    dayCount: number;
    intervalMinutes: number;
    sourceFiles: string[];
    previousPeriodStart: string;
    previousPeriodEnd: string;
    previousSourceFiles: string[];
  }};
  comparison: {{
    previousPeriodStart: string;
    previousPeriodEnd: string;
    previousTotalKwh: number;
    previousDailyAverageKwh: number;
    previousPeakDemand1hKwh: number;
    previousEstimatedCostSgd: number;
    previousLevel6Kwh: number;
    previousLevel7Kwh: number;
    totalTrendPct: number;
    dailyAverageTrendPct: number;
    peakTrendPct: number;
    estimatedCostTrendPct: number;
  }};
  summary: {{
    totalKwh: number;
    level6Kwh: number;
    level7Kwh: number;
    dailyAverageKwh: number;
    level7SharePct: number;
    peakDemand1hKwh: number;
    peakWindow: string;
    weekdayDailyAvgKwh: number;
    weekendDailyAvgKwh: number;
    holidayDailyAvgKwh: number;
    afterHoursWeekdayKwh: number;
    afterHoursWeekdayPct: number;
    officeHoursWeekdayKwh: number;
    estimatedCostSgd: number;
    costMonthlyBreakdown: NapCostMonthRow[];
  }};
  highlights: AnalysisHighlight[];
  applianceDistribution: Array<{{ tag: string; value: number; percentage: number }}>;
  hourlyWeekdayTotal: Array<{{ hour: string; total: number }}>;
  hourlyWeekendTotal: Array<{{ hour: string; total: number }}>;
  hourlyWeekdayByCategory: NapHourlyRow[];
  hourlyWeekendByCategory: NapHourlyRow[];
  hourlyHolidayTotal: Array<{{ hour: string; total: number }}>;
  hourlyHolidayByCategory: NapHourlyRow[];
  profileHourlyBySpace: Record<
    "all" | "level6" | "level7",
    Record<"weekday" | "weekend" | "holiday", NapHourlyRow[]>
  >;
  dailyHourlyBySpace: Record<"all" | "level6" | "level7", Record<string, NapHourlyRow[]>>;
  applianceDistributionBySpace: Record<
    "all" | "level6" | "level7",
    Array<{{ tag: string; value: number; percentage: number }}>
  >;
  profileMeta: {{
    weekdayCount: number;
    weekendCount: number;
    holidayCount: number;
    holidayDays: Array<{{ date: string; shortLabel: string; name: string }}>;
    periodLabel: string;
    stackedProfileYMax: number;
  }};
  baselineMeta: {{
    periodStart: string;
    periodEnd: string;
    dayCount: number;
    byScope: Record<
      "all" | "level6" | "level7",
      {{
        weekday: number;
        weekend: number;
        holiday: number;
        weekdayCount: number;
        weekendCount: number;
        holidayCount: number;
      }}
    >;
  }};
  dailyTotals: NapDailyTotalRow[];
  tagChartRows: Array<{{ label: string; lighting: number; office_load: number; ventilation_fan: number; total: number }}>;
  spaceChartRows: Array<{{ label: string; level_6: number; level_7: number; total: number }}>;
  level6TagChartRows: Array<{{ label: string; lighting: number; office_load: number; ventilation_fan: number; total: number }}>;
  level7TagChartRows: Array<{{ label: string; lighting: number; office_load: number; ventilation_fan: number; total: number }}>;
  topCircuits: NapCircuitRow[];
  deviceDailyReadings: NapDeviceDailyReading[];
  deviceHourlyProfiles: NapDeviceHourlyProfile[];
  deviceHourlyByDate: Record<string, NapDeviceHourlyProfile[]>;
  deviceHourlyProfilesByDayType: Record<
    "weekday" | "weekend" | "holiday",
    NapDeviceHourlyProfile[]
  >;
  levelUsageByDayType: Record<
    "weekday" | "weekend" | "holiday",
    {{ level6Kwh: number; level7Kwh: number; sampleCount: number }}
  >;
  findings: NapFindingSection[];
  recommendations: RecommendationItem[];
  anomalyDays: NapDailyTotalRow[];
  topDays: NapDailyTotalRow[];
  devicesByLevel: {{ level6: string[]; level7: string[] }};
  topPeaks: NapPeakWindow[];
  highlightBreakdowns: Record<string, NapHighlightBreakdown>;
}}

export const napEnergyAnalysisData: NapEnergyAnalysisData = {json.dumps(payload, indent=2)};
"""
    OUT_PATH.write_text(ts_content, encoding="utf-8")
    write_share_dataset(payload)
    print(f"Wrote {OUT_PATH}")
    print(
        f"Total kWh: {total_kwh} ({comparison['totalTrendPct']:+.1f}% vs previous), "
        f"days: {day_count}, anomalies: {len(anomaly_days)}"
    )


if __name__ == "__main__":
    main()
