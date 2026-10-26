
import csv
import io
import json
import os
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import unquote_plus

import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ["TABLE_NAME"]
REPORTS_BUCKET = os.environ["REPORTS_BUCKET"]
MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


def analyze_csv(csv_text):
    reader = csv.DictReader(io.StringIO(csv_text))
    columns = reader.fieldnames

    if not columns or not any(columns):
        raise ValueError("CSV is empty or has no header row")

    rows = list(reader)

    if len(rows) > 10000:
        raise ValueError("MVP limit: 10,000 data rows")

    column_stats = {}
    missing_cells = 0
    total_cells = len(rows) * len(columns)

    for column in columns:
        values = [row.get(column) for row in rows]
        non_empty = [
            value.strip()
            for value in values
            if value is not None and value.strip() != ""
        ]

        missing = len(rows) - len(non_empty)
        missing_cells += missing

        stats = {
            "missing_count": missing,
            "missing_percentage": round(
                missing / len(rows) * 100, 2
            ) if rows else 0,
            "non_empty_count": len(non_empty),
        }

        numeric_values = []
        numeric = True

        for value in non_empty:
            try:
                numeric_values.append(float(value))
            except ValueError:
                numeric = False
                break

        if numeric and numeric_values:
            stats["detected_type"] = "numeric"
            stats["minimum"] = min(numeric_values)
            stats["maximum"] = max(numeric_values)
            stats["mean"] = round(
                sum(numeric_values) / len(numeric_values), 2
            )
        else:
            stats["detected_type"] = "text"

        column_stats[column] = stats

    row_signatures = [
        tuple(row.get(column) or "" for column in columns)
        for row in rows
    ]

    counts = Counter(row_signatures)
    duplicate_rows = sum(
        count - 1 for count in counts.values() if count > 1
    )

    missing_fraction = (
        missing_cells / total_cells if total_cells else 0
    )
    duplicate_fraction = (
        duplicate_rows / len(rows) if rows else 0
    )

    # Demonstration heuristic, not an industry-standard score.
    quality_score = round(
        max(
            0,
            100
            - 70 * missing_fraction * 100 / 100
            - 30 * duplicate_fraction * 100 / 100,
        ),
        1,
    )

    # Flag numeric values that are outside the simple
    # expected range for student marks, if that column exists.
    warnings = []

    if "marks" in column_stats:
        mark_values = []
        for row in rows:
            try:
                mark_values.append(float(row["marks"]))
            except (ValueError, TypeError):
                pass

        if any(mark < 0 or mark > 100 for mark in mark_values):
            warnings.append(
                "The marks column contains values outside 0–100."
            )

    if missing_cells:
        warnings.append(
            f"Found {missing_cells} missing or blank cells."
        )

    if duplicate_rows:
        warnings.append(
            f"Found {duplicate_rows} duplicate row(s)."
        )

    return {
        "row_count": len(rows),
        "column_count": len(columns),
        "columns": columns,
        "missing_cells": missing_cells,
        "duplicate_rows": duplicate_rows,
        "quality_score": quality_score,
        "column_stats": column_stats,
        "warnings": warnings,
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:s3":
            continue

        bucket = record["s3"]["bucket"]["name"]
        file_id = unquote_plus(record["s3"]["object"]["key"])

        if not file_id.startswith("uploads/"):
            continue

        if not file_id.lower().endswith(".csv"):
            continue

        report_key = "reports/" + file_id.replace("/", "__") + ".json"

        try:
            table.put_item(Item={
                "file_id": file_id,
                "status": "PROCESSING",
                "processed_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            })

            obj = s3.get_object(Bucket=bucket, Key=file_id)
            body = obj["Body"].read()

            if len(body) > MAX_FILE_BYTES:
                raise ValueError("CSV exceeds the 5 MB MVP limit")

            csv_text = body.decode("utf-8-sig")
            report = analyze_csv(csv_text)

            report.update({
                "file_id": file_id,
                "report_key": report_key,
                "processed_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            })

            s3.put_object(
                Bucket=REPORTS_BUCKET,
                Key=report_key,
                Body=json.dumps(report, indent=2).encode("utf-8"),
                ContentType="application/json",
            )

            table.put_item(Item={
                "file_id": file_id,
                "status": "COMPLETED",
                "report_key": report_key,
                "row_count": report["row_count"],
                "column_count": report["column_count"],
                "missing_cells": report["missing_cells"],
                "duplicate_rows": report["duplicate_rows"],
                "quality_score": str(report["quality_score"]),
                "processed_at": report["processed_at"],
            })

        except Exception as exc:
            print(f"Processing failed for {file_id}: {exc}")

            table.put_item(Item={
                "file_id": file_id,
                "status": "FAILED",
                "error_message": str(exc)[:500],
                "processed_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            })

            raise

    return {"statusCode": 200, "body": "Processing complete"}
