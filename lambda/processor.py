
import csv
import io
import json
import os
import statistics
import traceback
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import unquote_plus

import boto3

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

TABLE_NAME = os.environ["TABLE_NAME"]
REPORTS_BUCKET = os.environ["REPORTS_BUCKET"]

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_ROWS = 10000

# Project-specific validation rules.
# These are applied only when the corresponding column exists.
VALIDATION_RULES = {
    "marks": (0, 100),
    "attendance": (0, 100),
    "age": (1, None),
}

QUALITY_WEIGHTS = {
    "completeness": 0.35,
    "uniqueness": 0.25,
    "validity": 0.25,
    "consistency": 0.15,
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def is_missing(value):
    """Treat empty strings, whitespace and missing CSV cells as missing."""
    return value is None or str(value).strip() == ""


def parse_number(value):
    """Return a float for numeric values, otherwise None."""
    if is_missing(value):
        return None

    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def detect_delimiter(csv_text):
    """Detect common CSV delimiters, with comma as the fallback."""
    sample = csv_text[:8192]

    try:
        dialect = csv.Sniffer().sniff(
            sample,
            delimiters=",\t;|"
        )
        return dialect
    except csv.Error:
        return csv.excel


def analyze_csv(csv_text, file_size_bytes=0):
    dialect = detect_delimiter(csv_text)

    reader = csv.DictReader(
        io.StringIO(csv_text),
        dialect=dialect
    )

    raw_columns = reader.fieldnames

    if not raw_columns or not any(
        column and column.strip() for column in raw_columns
    ):
        raise ValueError("CSV is empty or has no header row")

    columns = [column.strip() for column in raw_columns]

    if len(set(columns)) != len(columns):
        raise ValueError("CSV contains duplicate column names")

    if any(not column for column in columns):
        raise ValueError("CSV contains an empty column name")

    rows = list(reader)

    if len(rows) > MAX_ROWS:
        raise ValueError("MVP limit: 10,000 data rows")

    # Normalise column names while preserving the original row values.
    normalized_rows = []
    inconsistent_rows = 0
    extra_cells = 0

    for row in rows:
        if None in row:
            extra_values = row.get(None) or []
            extra_cells += len(extra_values)
            inconsistent_rows += 1

        normalized = {}

        for original_name, clean_name in zip(raw_columns, columns):
            normalized[clean_name] = row.get(original_name)

        normalized_rows.append(normalized)

    row_count = len(normalized_rows)
    column_count = len(columns)
    total_cells = row_count * column_count

    column_stats = {}
    missing_cells = 0
    numeric_columns = 0
    categorical_columns = 0
    invalid_cells = 0
    validation_cells = 0
    consistency_issues = inconsistent_rows

    # ---------------------------------------------------------
    # COLUMN-LEVEL PROFILING
    # ---------------------------------------------------------

    for column in columns:
        values = [
            row.get(column)
            for row in normalized_rows
        ]

        non_empty = [
            str(value).strip()
            for value in values
            if not is_missing(value)
        ]

        missing = row_count - len(non_empty)
        missing_cells += missing

        unique_values = set(non_empty)

        numeric_values = [
            parse_number(value)
            for value in non_empty
        ]

        all_numeric = (
            len(non_empty) > 0
            and all(value is not None for value in numeric_values)
        )

        stats = {
            # Names below are compatible with the current React UI.
            "missing": missing,
            "unique": len(unique_values),
            "type": "numeric" if all_numeric else "text",

            # Additional useful report fields.
            "missing_count": missing,
            "missing_percentage": round(
                missing / row_count * 100, 2
            ) if row_count else 0,
            "non_empty_count": len(non_empty),
        }

        if all_numeric:
            numeric_columns += 1

            numbers = numeric_values
            is_integer = all(
                number.is_integer() for number in numbers
            )

            stats["type"] = (
                "integer" if is_integer else "float"
            )
            stats["detected_type"] = stats["type"]

            stats["min"] = round(min(numbers), 2)
            stats["max"] = round(max(numbers), 2)
            stats["mean"] = round(
                statistics.mean(numbers), 2
            )
            stats["median"] = round(
                statistics.median(numbers), 2
            )

            stats["std_dev"] = round(
                statistics.pstdev(numbers), 2
            ) if len(numbers) > 1 else 0

            # Histogram distribution for the frontend.
            bin_count = min(8, max(1, len(set(numbers))))

            minimum = min(numbers)
            maximum = max(numbers)

            if minimum == maximum:
                histogram = [{
                    "start": round(minimum, 2),
                    "end": round(maximum, 2),
                    "count": len(numbers)
                }]
            else:
                bin_width = (maximum - minimum) / bin_count

                bins = [{
                    "start": round(minimum + i * bin_width, 2),
                    "end": round(
                        minimum + (i + 1) * bin_width, 2
                    ),
                    "count": 0
                } for i in range(bin_count)]

                for number in numbers:
                    index = min(
                        int((number - minimum) / bin_width),
                        bin_count - 1
                    )
                    bins[index]["count"] += 1

                histogram = bins

            stats["distribution"] = histogram

        else:
            categorical_columns += 1

            stats["detected_type"] = "text"

            if non_empty:
                frequencies = Counter(non_empty)
                most_common_value, frequency = (
                    frequencies.most_common(1)[0]
                )

                stats["most_frequent_value"] = most_common_value
                stats["most_frequent_count"] = frequency

        column_stats[column] = stats

    # ---------------------------------------------------------
    # DUPLICATE ROW DETECTION
    # ---------------------------------------------------------

    row_signatures = [
        tuple(
            (row.get(column) or "").strip()
            for column in columns
        )
        for row in normalized_rows
    ]

    row_counts = Counter(row_signatures)

    duplicate_rows = sum(
        count - 1
        for count in row_counts.values()
        if count > 1
    )

    complete_rows = sum(
        1
        for row in normalized_rows
        if all(
            not is_missing(row.get(column))
            for column in columns
        )
    )

    # ---------------------------------------------------------
    # VALIDATION RULES
    # ---------------------------------------------------------

    warnings = []
    validation_issues = []

    for column, (minimum, maximum) in VALIDATION_RULES.items():
        if column not in columns:
            continue

        for row_index, row in enumerate(normalized_rows, start=1):
            value = row.get(column)

            if is_missing(value):
                continue

            number = parse_number(value)

            validation_cells += 1

            if number is None:
                invalid_cells += 1
                validation_issues.append({
                    "column": column,
                    "row": row_index,
                    "value": str(value),
                    "issue": "Non-numeric value"
                })
                continue

            if (
                (minimum is not None and number < minimum)
                or (maximum is not None and number > maximum)
            ):
                invalid_cells += 1

                validation_issues.append({
                    "column": column,
                    "row": row_index,
                    "value": number,
                    "issue": "Value outside permitted range"
                })

    if validation_issues:
        for column in sorted({
            issue["column"] for issue in validation_issues
        }):
            count = sum(
                1 for issue in validation_issues
                if issue["column"] == column
            )

            minimum, maximum = VALIDATION_RULES[column]

            if minimum is not None and maximum is not None:
                rule_text = f"{minimum}–{maximum}"
            elif minimum is not None:
                rule_text = f"at least {minimum}"
            else:
                rule_text = f"at most {maximum}"

            warnings.append(
                f"The {column} column contains {count} invalid "
                f"value(s). Expected range: {rule_text}."
            )

    if missing_cells:
        warnings.append(
            f"Found {missing_cells} missing or blank cells."
        )

    if duplicate_rows:
        warnings.append(
            f"Found {duplicate_rows} duplicate row(s)."
        )

    if inconsistent_rows:
        warnings.append(
            f"Found {inconsistent_rows} row(s) with an "
            "inconsistent number of CSV fields."
        )

    if extra_cells:
        warnings.append(
            f"Found {extra_cells} unexpected extra cell(s)."
        )

    # ---------------------------------------------------------
    # DATA QUALITY SCORE
    # ---------------------------------------------------------

    completeness_score = (
        100 * (1 - missing_cells / total_cells)
        if total_cells else 100
    )

    uniqueness_score = (
        100 * (1 - duplicate_rows / row_count)
        if row_count else 100
    )

    validity_score = (
        100 * (1 - invalid_cells / validation_cells)
        if validation_cells else 100
    )

    consistency_score = (
        100 * (1 - inconsistent_rows / row_count)
        if row_count else 100
    )

    quality_dimensions = {
        "completeness": round(completeness_score, 2),
        "uniqueness": round(uniqueness_score, 2),
        "validity": round(validity_score, 2),
        "consistency": round(consistency_score, 2),
    }

    quality_score = round(
        sum(
            quality_dimensions[name] * weight
            for name, weight in QUALITY_WEIGHTS.items()
        ),
        1
    )

    # ---------------------------------------------------------
    # FINAL REPORT
    # ---------------------------------------------------------

    return {
        "row_count": row_count,
        "column_count": column_count,
        "columns": columns,

        "missing_cells": missing_cells,
        "complete_rows": complete_rows,
        "duplicate_rows": duplicate_rows,

        "quality_score": quality_score,
        "quality_dimensions": quality_dimensions,

        "column_stats": column_stats,
        "warnings": warnings,

        "validation_issue_count": len(validation_issues),
        "validation_issues": validation_issues[:100],

        "numeric_columns": numeric_columns,
        "categorical_columns": categorical_columns,

        "inconsistent_rows": inconsistent_rows,
        "file_size_bytes": file_size_bytes,
    }


def lambda_handler(event, context):
    table = dynamodb.Table(TABLE_NAME)

    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:s3":
            continue

        bucket = record["s3"]["bucket"]["name"]

        file_id = unquote_plus(
            record["s3"]["object"]["key"]
        )

        if not file_id.startswith("uploads/"):
            continue

        if not file_id.lower().endswith(".csv"):
            continue

        report_key = (
            "reports/"
            + file_id.replace("/", "__")
            + ".json"
        )

        try:
            # Update instead of put_item so the API-created
            # original_filename and created_at are preserved.
            table.update_item(
                Key={"file_id": file_id},
                UpdateExpression=(
                    "SET #status = :status, processed_at = :time"
                ),
                ExpressionAttributeNames={
                    "#status": "status"
                },
                ExpressionAttributeValues={
                    ":status": "PROCESSING",
                    ":time": now_iso()
                }
            )

            obj = s3.get_object(
                Bucket=bucket,
                Key=file_id
            )

            body = obj["Body"].read()

            if len(body) > MAX_FILE_BYTES:
                raise ValueError(
                    "CSV exceeds the 5 MB MVP limit"
                )

            csv_text = body.decode("utf-8-sig")

            report = analyze_csv(
                csv_text,
                file_size_bytes=len(body)
            )

            processed_at = now_iso()

            report.update({
                "file_id": file_id,
                "report_key": report_key,
                "processed_at": processed_at,
            })

            # Save JSON report in S3.
            s3.put_object(
                Bucket=REPORTS_BUCKET,
                Key=report_key,
                Body=json.dumps(
                    report,
                    indent=2,
                    ensure_ascii=False
                ).encode("utf-8"),
                ContentType="application/json",
            )

            # Preserve existing DynamoDB attributes.
            table.update_item(
                Key={"file_id": file_id},
                UpdateExpression=(
                    "SET #status = :status, "
                    "report_key = :report_key, "
                    "row_count = :rows, "
                    "column_count = :columns, "
                    "missing_cells = :missing, "
                    "duplicate_rows = :duplicates, "
                    "quality_score = :quality, "
                    "processed_at = :time"
                ),
                ExpressionAttributeNames={
                    "#status": "status"
                },
                ExpressionAttributeValues={
                    ":status": "COMPLETED",
                    ":report_key": report_key,
                    ":rows": report["row_count"],
                    ":columns": report["column_count"],
                    ":missing": report["missing_cells"],
                    ":duplicates": report["duplicate_rows"],
                    ":quality": str(report["quality_score"]),
                    ":time": processed_at,
                }
            )

            print(
                f"Successfully processed {file_id}. "
                f"Quality score: {report['quality_score']}"
            )

        except Exception as exc:
            print(
                f"Processing failed for {file_id}: {repr(exc)}"
            )
            traceback.print_exc()

            # Preserve the existing DynamoDB record.
            try:
                table.update_item(
                    Key={"file_id": file_id},
                    UpdateExpression=(
                        "SET #status = :status, "
                        "error_message = :error, "
                        "processed_at = :time"
                    ),
                    ExpressionAttributeNames={
                        "#status": "status"
                    },
                    ExpressionAttributeValues={
                        ":status": "FAILED",
                        ":error": str(exc)[:500],
                        ":time": now_iso(),
                    }
                )
            except Exception as update_error:
                print(
                    "Could not update failure status:",
                    repr(update_error)
                )
                traceback.print_exc()

            raise

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": "Processing complete"
        })
    }
