"""Build the local EnergyIQ DuckDB fact store from supported Excel sources.

Ngee Ann exports contain cumulative ``Active Energy`` readings at 15-minute
intervals.  Preschool exports contain hourly interval usage by centre and
circuit.  Both adapters retain source lineage and materialise the same canonical
``energy_interval_facts`` table.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from datetime import UTC
from pathlib import Path
from typing import Iterable

import duckdb
import pandas as pd


NGEE_ANN_PROJECT_ID = "ngee-ann-polytechnic"
PRESCHOOL_PROJECT_ID = "preschool-demo"
NGEE_ANN_WORKSPACE_ID = "default"
PRESCHOOL_WORKSPACE_ID = "preschool-demo-org"
RESOURCE = "electricity"
EXPECTED_INTERVAL_MINUTES = 15
SINGAPORE_TIMEZONE = "Asia/Singapore"


@dataclass(frozen=True)
class SourceFile:
    path: Path
    sha256: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the EnergyIQ DuckDB fact store.")
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("data/raw_excel"),
        help="Directory containing the Ngee Ann cumulative-reading .xlsx exports.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("storage/energy/default/energy.duckdb"),
        help="DuckDB file to replace.",
    )
    parser.add_argument(
        "--preschool-input",
        type=Path,
        help="Optional Preschool May 2026 workbook to add to the same fact store.",
    )
    parser.add_argument(
        "--preschool-output",
        type=Path,
        default=Path("storage/energy/preschool-demo-org/energy.duckdb"),
        help="Workspace-isolated Preschool DuckDB file to replace.",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover_sources(input_dir: Path) -> list[SourceFile]:
    paths = sorted(input_dir.glob("Ngee Ann Poly Level *.xlsx"))
    if not paths:
        raise SystemExit(f"No Ngee Ann Excel files found under {input_dir.resolve()}")
    return [SourceFile(path=path, sha256=sha256_file(path)) for path in paths]


def classify_meter(device_name: str) -> tuple[str, str, str, str]:
    level_match = re.match(r"Lvl\s+(\d+)\s+(.+)", device_name, re.IGNORECASE)
    if not level_match:
        raise ValueError(f"Unsupported Device Name: {device_name}")
    level = level_match.group(1)
    label = level_match.group(2)
    level_id = f"level-{level}"
    prefix = f"l{level}-"
    normalized = label.lower()

    if normalized == "total office light":
        return f"{prefix}total-light", level_id, "light", "total"
    if normalized == "total office load":
        return f"{prefix}total-load", level_id, "load", "total"
    if "office light-left" in normalized:
        return f"{prefix}light-left", level_id, "light", "submeter"
    if "office light-right" in normalized:
        return f"{prefix}light-right", level_id, "light", "submeter"
    for position in ("front", "middle", "back"):
        if f"{position} row office light" in normalized:
            return f"{prefix}{position}-light", level_id, "light", "submeter"
    load_match = re.search(r"office load\s+(\d+)", normalized)
    if load_match:
        return f"{prefix}load-{load_match.group(1)}", level_id, "load", "submeter"
    raise ValueError(f"Unsupported Device Name: {device_name}")


def read_source(source: SourceFile) -> pd.DataFrame:
    frame = pd.read_excel(
        source.path,
        usecols=["Device Name", "Time", "Active Energy"],
        engine="openpyxl",
    )
    frame = frame.rename(
        columns={
            "Device Name": "device_name",
            "Time": "event_time",
            "Active Energy": "active_energy_kwh",
        }
    )
    frame["device_name"] = frame["device_name"].astype("string").str.strip()
    frame["event_time"] = pd.to_datetime(frame["event_time"], errors="coerce")
    frame["active_energy_kwh"] = pd.to_numeric(frame["active_energy_kwh"], errors="coerce")
    frame["source_file"] = source.path.name
    frame["source_sha256"] = source.sha256
    frame["source_row_number"] = range(2, len(frame) + 2)
    frame["source_coverage_end"] = frame["event_time"].max()
    frame["workspace_id"] = NGEE_ANN_WORKSPACE_ID
    frame["project_id"] = NGEE_ANN_PROJECT_ID
    frame["resource"] = RESOURCE
    return frame


def normalize_sources(sources: Iterable[SourceFile]) -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = pd.concat([read_source(source) for source in sources], ignore_index=True)
    raw["is_valid"] = (
        raw["device_name"].notna()
        & raw["event_time"].notna()
        & raw["active_energy_kwh"].notna()
        & (raw["active_energy_kwh"] >= 0)
    )
    raw["validation_error"] = ""
    raw.loc[raw["device_name"].isna(), "validation_error"] = "missing_device_name"
    raw.loc[raw["event_time"].isna(), "validation_error"] = "invalid_timestamp"
    raw.loc[raw["active_energy_kwh"].isna(), "validation_error"] = "invalid_active_energy"
    raw.loc[raw["active_energy_kwh"] < 0, "validation_error"] = "negative_active_energy"

    valid = raw[raw["is_valid"]].copy()
    mapping = valid["device_name"].map(classify_meter)
    valid["meter_node_id"] = mapping.map(lambda value: value[0])
    valid["level_node_id"] = mapping.map(lambda value: value[1])
    valid["category"] = mapping.map(lambda value: value[2])
    valid["meter_role"] = mapping.map(lambda value: value[3])
    valid["event_time"] = (
        valid["event_time"]
        .dt.tz_localize("Asia/Singapore", ambiguous="raise", nonexistent="raise")
        .dt.tz_convert(UTC)
    )

    conflict_counts = (
        valid.groupby(["project_id", "meter_node_id", "event_time"])["active_energy_kwh"]
        .nunique()
    )
    conflicts = conflict_counts[conflict_counts > 1]
    conflict_keys = set(conflicts.index.tolist())
    raw["is_overlap_conflict"] = raw.apply(
        lambda row: (
            row["project_id"],
            classify_meter(str(row["device_name"]))[0],
            (
                pd.Timestamp(row["event_time"])
                .tz_localize("Asia/Singapore")
                .tz_convert(UTC)
                if pd.notna(row["event_time"]) and pd.notna(row["device_name"])
                else None
            ),
        )
        in conflict_keys
        if row["is_valid"]
        else False,
        axis=1,
    )

    valid = (
        valid.sort_values(
            ["meter_node_id", "event_time", "source_coverage_end", "source_file"]
        )
        .drop_duplicates(["project_id", "meter_node_id", "event_time"], keep="last")
        .reset_index(drop=True)
    )
    return raw, valid


def build_intervals(readings: pd.DataFrame) -> pd.DataFrame:
    intervals = readings.copy()
    grouped = intervals.groupby(["project_id", "meter_node_id"], sort=False)
    intervals["interval_start"] = grouped["event_time"].shift(1)
    intervals["interval_end"] = intervals["event_time"]
    intervals["previous_active_energy_kwh"] = grouped["active_energy_kwh"].shift(1)
    intervals["elapsed_minutes"] = (
        (intervals["event_time"] - intervals["interval_start"]).dt.total_seconds() / 60
    )
    intervals["raw_delta_kwh"] = (
        intervals["active_energy_kwh"] - intervals["previous_active_energy_kwh"]
    )

    intervals["quality_status"] = "ok"
    intervals.loc[intervals["interval_start"].isna(), "quality_status"] = "boundary"
    intervals.loc[intervals["raw_delta_kwh"] < 0, "quality_status"] = "negative_delta"
    intervals.loc[
        intervals["elapsed_minutes"] > EXPECTED_INTERVAL_MINUTES + 0.1,
        "quality_status",
    ] = "gap"
    intervals.loc[
        (intervals["elapsed_minutes"] > 0)
        & (intervals["elapsed_minutes"] < EXPECTED_INTERVAL_MINUTES - 0.1),
        "quality_status",
    ] = "irregular_interval"
    intervals["usage_kwh"] = intervals["raw_delta_kwh"].where(
        intervals["quality_status"] == "ok"
    )
    intervals["average_kw"] = intervals["usage_kwh"] / (
        intervals["elapsed_minutes"] / 60
    )
    intervals["parent_node_id"] = intervals["level_node_id"]
    intervals["source_reading_kind"] = "cumulative_energy"
    local_start = intervals["interval_start"].dt.tz_convert(SINGAPORE_TIMEZONE)
    intervals["local_date"] = local_start.dt.date
    intervals["local_hour"] = local_start.dt.hour.astype("Int64")
    intervals["day_type"] = pd.NA
    intervals["is_operating"] = pd.NA
    intervals["appliance"] = intervals["category"]
    intervals["circuit_name"] = intervals["device_name"]
    return intervals


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")


def build_preschool_facts(
    source: SourceFile,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    energy = pd.read_excel(
        source.path,
        sheet_name="Energy Consumption",
        engine="openpyxl",
    )
    schedule = pd.read_excel(
        source.path,
        sheet_name="Operation Schedule",
        header=1,
        engine="openpyxl",
    )
    required_energy_columns = {
        "Preschool Number",
        "Date",
        "Month",
        "Year",
        "Appliance",
        "Power Meter",
    }
    required_schedule_columns = {
        "Date",
        "Month",
        "Year",
        "Preschool Number",
        "Day Type",
        "Operating Hours",
    }
    if missing := required_energy_columns - set(energy.columns):
        raise ValueError(f"Preschool energy sheet is missing columns: {sorted(missing)}")
    if missing := required_schedule_columns - set(schedule.columns):
        raise ValueError(f"Preschool schedule sheet is missing columns: {sorted(missing)}")

    hour_columns = [
        column
        for column in energy.columns
        if isinstance(column, str) and re.fullmatch(r"\d{4}-\d{4}", column)
    ]
    if len(hour_columns) != 24:
        raise ValueError(
            f"Expected 24 Preschool hourly columns, found {len(hour_columns)}"
        )

    energy = energy.copy()
    energy["source_row_number"] = range(2, len(energy) + 2)
    long = energy.melt(
        id_vars=[
            "Preschool Number",
            "Date",
            "Month",
            "Year",
            "Appliance",
            "Power Meter",
            "source_row_number",
        ],
        value_vars=hour_columns,
        var_name="source_column",
        value_name="usage_kwh",
    )
    long = long.rename(
        columns={
            "Preschool Number": "centre_code",
            "Date": "day",
            "Month": "month",
            "Year": "year",
            "Appliance": "appliance",
            "Power Meter": "circuit_name",
        }
    )
    long["centre_code"] = long["centre_code"].astype("string").str.strip()
    long["appliance"] = long["appliance"].astype("string").str.strip()
    long["circuit_name"] = long["circuit_name"].astype("string").str.strip()
    long["usage_kwh"] = pd.to_numeric(long["usage_kwh"], errors="coerce")
    long["local_hour"] = (
        long["source_column"].str.slice(0, 2).astype("Int64")
    )

    schedule = schedule.rename(
        columns={
            "Preschool Number": "centre_code",
            "Date": "day",
            "Month": "month",
            "Year": "year",
            "Day Type": "day_type",
            "Operating Hours": "operating_hours",
        }
    )
    schedule = schedule[
        ["centre_code", "day", "month", "year", "day_type", "operating_hours"]
    ].copy()
    schedule["centre_code"] = schedule["centre_code"].astype("string").str.strip()
    for column in ("day", "month", "year"):
        schedule[column] = pd.to_numeric(schedule[column], errors="raise").astype(int)
        long[column] = pd.to_numeric(long[column], errors="raise").astype(int)
    if schedule.duplicated(["centre_code", "year", "month", "day"]).any():
        raise ValueError("Preschool schedule contains duplicate centre-day rows")

    long = long.merge(
        schedule,
        how="left",
        on=["centre_code", "year", "month", "day"],
        validate="many_to_one",
    )
    if long["day_type"].isna().any():
        raise ValueError("Preschool energy rows are missing operation schedule matches")

    local_start = (
        pd.to_datetime(
            {
                "year": long["year"],
                "month": long["month"],
                "day": long["day"],
            }
        )
        + pd.to_timedelta(long["local_hour"], unit="h")
    )
    long["interval_start"] = (
        local_start.dt.tz_localize(
            SINGAPORE_TIMEZONE,
            ambiguous="raise",
            nonexistent="raise",
        )
        .dt.tz_convert(UTC)
    )
    long["interval_end"] = long["interval_start"] + pd.Timedelta(hours=1)
    long["local_date"] = local_start.dt.date
    opening_hour = pd.to_numeric(
        long["operating_hours"].str.extract(r"^(\d{2})")[0],
        errors="coerce",
    )
    closing_hour = pd.to_numeric(
        long["operating_hours"].str.extract(r"-(\d{2})\d{2}$")[0],
        errors="coerce",
    )
    long["is_operating"] = (
        opening_hour.notna()
        & closing_hour.notna()
        & (long["local_hour"] >= opening_hour)
        & (long["local_hour"] < closing_hour)
    )
    long["workspace_id"] = PRESCHOOL_WORKSPACE_ID
    long["project_id"] = PRESCHOOL_PROJECT_ID
    long["resource"] = RESOURCE
    long["parent_node_id"] = (
        "preschool-centre-" + long["centre_code"].str.lower()
    )
    long["meter_node_id"] = (
        long["parent_node_id"] + "-" + long["circuit_name"].map(slugify)
    )
    category_by_appliance = {
        "Aircon": "aircon",
        "Lighting": "light",
        "Plugload": "load",
        "Heater": "load",
    }
    long["category"] = long["appliance"].map(category_by_appliance)
    if long["category"].isna().any():
        unsupported = sorted(long.loc[long["category"].isna(), "appliance"].unique())
        raise ValueError(f"Unsupported Preschool appliances: {unsupported}")
    long["meter_role"] = "component"
    long["source_reading_kind"] = "interval_usage"
    long["device_name"] = long["circuit_name"]
    long["level_node_id"] = pd.NA
    long["elapsed_minutes"] = 60.0
    long["active_energy_kwh"] = pd.NA
    long["previous_active_energy_kwh"] = pd.NA
    long["raw_delta_kwh"] = long["usage_kwh"]
    long["average_kw"] = long["usage_kwh"]
    long["quality_status"] = "ok"
    long.loc[long["usage_kwh"].isna(), "quality_status"] = "invalid_usage"
    long.loc[long["usage_kwh"] < 0, "quality_status"] = "negative_usage"
    long.loc[long["quality_status"] != "ok", ["usage_kwh", "average_kw"]] = pd.NA
    long["source_file"] = source.path.name
    long["source_sha256"] = source.sha256

    raw_columns = [
        "workspace_id",
        "project_id",
        "resource",
        "centre_code",
        "appliance",
        "circuit_name",
        "local_date",
        "local_hour",
        "usage_kwh",
        "day_type",
        "operating_hours",
        "is_operating",
        "source_file",
        "source_sha256",
        "source_row_number",
        "source_column",
        "quality_status",
    ]
    raw_usage = long[raw_columns].copy()
    summary = {
        "workspace_id": PRESCHOOL_WORKSPACE_ID,
        "project_id": PRESCHOOL_PROJECT_ID,
        "source_files": [{"path": str(source.path), "sha256": source.sha256}],
        "source_rows": int(len(energy)),
        "interval_rows": int(len(long)),
        "centre_count": int(long["centre_code"].nunique()),
        "circuit_count_per_centre": int(
            long[["centre_code", "circuit_name"]]
            .drop_duplicates()
            .groupby("centre_code")
            .size()
            .min()
        ),
        "quality_counts": {
            str(key): int(value)
            for key, value in long["quality_status"].value_counts().items()
        },
        "total_usage_kwh": round(float(long["usage_kwh"].sum()), 6),
        "operating_usage_kwh": round(
            float(long.loc[long["is_operating"], "usage_kwh"].sum()),
            6,
        ),
        "non_operating_usage_kwh": round(
            float(long.loc[~long["is_operating"], "usage_kwh"].sum()),
            6,
        ),
    }
    return raw_usage, long, summary


def build_snapshot_id(
    project_slug: str,
    sources: list[SourceFile],
    row_count: int,
) -> str:
    digest = hashlib.sha256()
    for source in sources:
        digest.update(source.path.name.encode("utf-8"))
        digest.update(source.sha256.encode("ascii"))
    digest.update(str(row_count).encode("ascii"))
    return f"{project_slug}-{digest.hexdigest()[:16]}"


def write_fact_store(
    output: Path,
    sources: list[SourceFile],
    raw: pd.DataFrame,
    readings: pd.DataFrame,
    intervals: pd.DataFrame,
    preschool_source: SourceFile | None = None,
    preschool_raw: pd.DataFrame | None = None,
    preschool_intervals: pd.DataFrame | None = None,
    preschool_summary: dict[str, object] | None = None,
) -> dict[str, object]:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".building.duckdb")
    temporary.unlink(missing_ok=True)
    connection = duckdb.connect(str(temporary))
    try:
        snapshot_id = build_snapshot_id("ngee-ann", sources, len(readings))
        fact_columns = [
            "workspace_id",
            "project_id",
            "resource",
            "meter_node_id",
            "parent_node_id",
            "level_node_id",
            "device_name",
            "appliance",
            "circuit_name",
            "category",
            "meter_role",
            "source_reading_kind",
            "interval_start",
            "interval_end",
            "elapsed_minutes",
            "active_energy_kwh",
            "previous_active_energy_kwh",
            "raw_delta_kwh",
            "usage_kwh",
            "average_kw",
            "quality_status",
            "local_date",
            "local_hour",
            "day_type",
            "is_operating",
            "source_file",
            "source_sha256",
        ]
        fact_frames = [
            intervals.loc[intervals["interval_start"].notna(), fact_columns].copy()
        ]
        if preschool_intervals is not None:
            fact_frames.append(preschool_intervals[fact_columns].copy())
        facts = pd.concat(fact_frames, ignore_index=True)

        connection.register("raw_import_frame", raw)
        connection.register("reading_frame", readings)
        connection.register("fact_frame", facts)
        connection.execute(
            """
            CREATE TABLE raw_meter_readings AS
            SELECT
              workspace_id, project_id, resource, device_name, event_time,
              active_energy_kwh, source_file, source_sha256, source_row_number,
              is_valid, validation_error, is_overlap_conflict
            FROM raw_import_frame
            """
        )
        connection.execute(
            """
            CREATE TABLE normalized_meter_readings AS
            SELECT
              workspace_id, project_id, resource, meter_node_id, level_node_id,
              device_name, category, meter_role, event_time, active_energy_kwh,
              source_file, source_sha256, source_row_number
            FROM reading_frame
            """
        )
        connection.execute(
            """
            CREATE TABLE energy_interval_facts AS
            SELECT
              workspace_id, project_id, resource, meter_node_id, parent_node_id,
              level_node_id, device_name, appliance, circuit_name, category,
              meter_role, source_reading_kind, interval_start, interval_end,
              elapsed_minutes, active_energy_kwh, previous_active_energy_kwh,
              raw_delta_kwh, usage_kwh, average_kw, quality_status, local_date,
              local_hour, day_type, is_operating, source_file, source_sha256
            FROM fact_frame
            """
        )
        if preschool_raw is not None:
            connection.register("preschool_raw_frame", preschool_raw)
            connection.execute(
                """
                CREATE TABLE raw_interval_usage AS
                SELECT * FROM preschool_raw_frame
                """
            )
        else:
            connection.execute(
                """
                CREATE TABLE raw_interval_usage (
                  workspace_id VARCHAR,
                  project_id VARCHAR,
                  resource VARCHAR,
                  centre_code VARCHAR,
                  appliance VARCHAR,
                  circuit_name VARCHAR,
                  local_date DATE,
                  local_hour INTEGER,
                  usage_kwh DOUBLE,
                  day_type VARCHAR,
                  operating_hours VARCHAR,
                  is_operating BOOLEAN,
                  source_file VARCHAR,
                  source_sha256 VARCHAR,
                  source_row_number INTEGER,
                  source_column VARCHAR,
                  quality_status VARCHAR
                )
                """
            )
        connection.execute(
            """
            CREATE VIEW energy_daily_facts AS
            SELECT
              workspace_id,
              project_id,
              resource,
              meter_node_id,
              parent_node_id,
              level_node_id,
              device_name,
              appliance,
              circuit_name,
              category,
              meter_role,
              local_date,
              SUM(usage_kwh) FILTER (WHERE quality_status = 'ok') AS usage_kwh,
              MAX(average_kw) FILTER (WHERE quality_status = 'ok') AS peak_average_kw,
              COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
              COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
            FROM energy_interval_facts
            GROUP BY ALL
            """
        )
        ngee_ann_summary = {
            "snapshot_id": snapshot_id,
            "workspace_id": NGEE_ANN_WORKSPACE_ID,
            "project_id": NGEE_ANN_PROJECT_ID,
            "source_files": [
                {"path": str(source.path), "sha256": source.sha256}
                for source in sources
            ],
            "raw_rows": int(len(raw)),
            "normalized_rows": int(len(readings)),
            "interval_rows": int(len(intervals) - intervals["interval_start"].isna().sum()),
            "invalid_raw_rows": int((~raw["is_valid"]).sum()),
            "overlap_conflict_rows": int(raw["is_overlap_conflict"].sum()),
            "quality_counts": {
                str(key): int(value)
                for key, value in intervals["quality_status"].value_counts().items()
            },
        }
        import_summaries = [ngee_ann_summary]
        if preschool_source is not None and preschool_summary is not None:
            preschool_snapshot_id = build_snapshot_id(
                "preschool",
                [preschool_source],
                int(preschool_summary["interval_rows"]),
            )
            preschool_summary = {
                **preschool_summary,
                "snapshot_id": preschool_snapshot_id,
            }
            import_summaries.append(preschool_summary)
        connection.execute(
            """
            CREATE TABLE energy_import_batches (
              snapshot_id VARCHAR PRIMARY KEY,
              imported_at TIMESTAMPTZ NOT NULL DEFAULT current_timestamp,
              manifest_json JSON NOT NULL
            )
            """
        )
        connection.executemany(
            "INSERT INTO energy_import_batches (snapshot_id, manifest_json) VALUES (?, ?)",
            [
                [summary["snapshot_id"], json.dumps(summary)]
                for summary in import_summaries
            ],
        )
        connection.execute("CHECKPOINT")
    finally:
        connection.close()
    output_wal = Path(f"{output}.wal")
    output.unlink(missing_ok=True)
    output_wal.unlink(missing_ok=True)
    temporary.replace(output)
    return {
        "output": str(output),
        "fact_rows": int(len(facts)),
        "projects": import_summaries,
    }


def isolate_workspace_store(source: Path, output: Path, workspace_id: str) -> int:
    """Copy and prune the staged store so one file contains one Organisation."""
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    Path(f"{temporary}.wal").unlink(missing_ok=True)
    shutil.copy2(source, temporary)
    connection = duckdb.connect(str(temporary))
    try:
        for table in (
            "raw_meter_readings",
            "normalized_meter_readings",
            "energy_interval_facts",
            "raw_interval_usage",
        ):
            connection.execute(
                f"DELETE FROM {table} WHERE workspace_id <> ?",
                [workspace_id],
            )
        connection.execute(
            """
            DELETE FROM energy_import_batches
            WHERE json_extract_string(manifest_json, '$.workspace_id') <> ?
            """,
            [workspace_id],
        )
        fact_rows = int(
            connection.execute("SELECT COUNT(*) FROM energy_interval_facts").fetchone()[0]
        )
        connection.execute("CHECKPOINT")
    finally:
        connection.close()
    output.unlink(missing_ok=True)
    Path(f"{output}.wal").unlink(missing_ok=True)
    temporary.replace(output)
    return fact_rows


def main() -> None:
    args = parse_args()
    sources = discover_sources(args.input_dir)
    raw, readings = normalize_sources(sources)
    intervals = build_intervals(readings)
    if args.preschool_input and not args.preschool_input.exists():
        raise SystemExit(
            f"Preschool workbook not found: {args.preschool_input.resolve()}"
        )
    preschool_source = (
        SourceFile(
            path=args.preschool_input,
            sha256=sha256_file(args.preschool_input),
        )
        if args.preschool_input
        else None
    )
    preschool_raw: pd.DataFrame | None = None
    preschool_intervals: pd.DataFrame | None = None
    preschool_summary: dict[str, object] | None = None
    if preschool_source:
        (
            preschool_raw,
            preschool_intervals,
            preschool_summary,
        ) = build_preschool_facts(preschool_source)
    summary = write_fact_store(
        args.output,
        sources,
        raw,
        readings,
        intervals,
        preschool_source=preschool_source,
        preschool_raw=preschool_raw,
        preschool_intervals=preschool_intervals,
        preschool_summary=preschool_summary,
    )
    if preschool_source is not None:
        preschool_rows = isolate_workspace_store(
            args.output,
            args.preschool_output,
            PRESCHOOL_WORKSPACE_ID,
        )
        ngee_ann_rows = isolate_workspace_store(
            args.output,
            args.output,
            NGEE_ANN_WORKSPACE_ID,
        )
        summary["workspace_outputs"] = {
            NGEE_ANN_WORKSPACE_ID: {
                "output": str(args.output),
                "fact_rows": ngee_ann_rows,
            },
            PRESCHOOL_WORKSPACE_ID: {
                "output": str(args.preschool_output),
                "fact_rows": preschool_rows,
            },
        }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
