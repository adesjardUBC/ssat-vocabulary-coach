#!/usr/bin/env python3
"""Convert the quiz workbook to browser-friendly JSON using only Python's standard library."""

from __future__ import annotations

import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "vocabulary_words.xlsx"
OUTPUT = ROOT / "site" / "vocabulary.json"

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def capitalise_first(value: object) -> str:
    text = clean(value)
    return text[:1].upper() + text[1:] if text else ""


def column_index(cell_reference: str) -> int:
    match = re.match(r"([A-Z]+)", cell_reference)
    if not match:
        raise ValueError(f"Invalid cell reference: {cell_reference}")
    result = 0
    for character in match.group(1):
        result = result * 26 + (ord(character) - ord("A") + 1)
    return result - 1


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    path = "xl/sharedStrings.xml"
    if path not in archive.namelist():
        return []
    root = ET.fromstring(archive.read(path))
    strings: list[str] = []
    for item in root.findall(f"{{{MAIN_NS}}}si"):
        pieces = [node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t")]
        strings.append("".join(pieces))
    return strings


def find_vocabulary_sheet(archive: zipfile.ZipFile) -> str:
    workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
    rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relationships = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels_root.findall(f"{{{PKG_REL_NS}}}Relationship")
    }

    sheets = workbook_root.find(f"{{{MAIN_NS}}}sheets")
    if sheets is None or len(sheets) == 0:
        raise ValueError("The workbook contains no worksheets.")

    selected = None
    for sheet in sheets:
        if sheet.attrib.get("name") == "Vocabulary":
            selected = sheet
            break
    if selected is None:
        selected = sheets[0]

    relation_id = selected.attrib[f"{{{REL_NS}}}id"]
    target = relationships[relation_id]
    if target.startswith("/"):
        return target.lstrip("/")
    return f"xl/{target}" if not target.startswith("xl/") else target


def read_rows(archive: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[list[str]]:
    root = ET.fromstring(archive.read(sheet_path))
    sheet_data = root.find(f"{{{MAIN_NS}}}sheetData")
    if sheet_data is None:
        return []

    rows: list[list[str]] = []
    for row_node in sheet_data.findall(f"{{{MAIN_NS}}}row"):
        values: dict[int, str] = {}
        max_column = -1
        for cell in row_node.findall(f"{{{MAIN_NS}}}c"):
            reference = cell.attrib.get("r", "")
            index = column_index(reference)
            max_column = max(max_column, index)
            cell_type = cell.attrib.get("t")
            value_node = cell.find(f"{{{MAIN_NS}}}v")
            inline_node = cell.find(f"{{{MAIN_NS}}}is")

            value = ""
            if cell_type == "inlineStr" and inline_node is not None:
                value = "".join(node.text or "" for node in inline_node.iter(f"{{{MAIN_NS}}}t"))
            elif value_node is not None:
                raw = value_node.text or ""
                if cell_type == "s":
                    try:
                        value = shared_strings[int(raw)]
                    except (ValueError, IndexError):
                        value = raw
                else:
                    value = raw
            values[index] = value

        rows.append([values.get(index, "") for index in range(max_column + 1)])
    return rows


def main() -> int:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Vocabulary workbook not found: {SOURCE}")

    with zipfile.ZipFile(SOURCE) as archive:
        shared_strings = read_shared_strings(archive)
        sheet_path = find_vocabulary_sheet(archive)
        rows = read_rows(archive, sheet_path, shared_strings)

    if len(rows) < 2:
        raise ValueError("The workbook contains no vocabulary rows.")

    entries: list[dict[str, object]] = []
    seen_words: set[str] = set()
    warnings: list[str] = []

    for spreadsheet_row, row in enumerate(rows[1:], start=2):
        word = capitalise_first(row[0] if row else "")
        if not word:
            continue

        key = word.casefold()
        if key in seen_words:
            raise ValueError(f"Duplicate word on spreadsheet row {spreadsheet_row}: {word}")
        seen_words.add(key)

        row = row + [""] * max(0, 5 - len(row))
        distractors = [capitalise_first(value) for value in row[1:5] if clean(value)]
        if len(distractors) != 4 or len({value.casefold() for value in distractors}) != 4:
            raise ValueError(
                f"Spreadsheet row {spreadsheet_row} ({word}) must contain four different incorrect meanings in columns B-E."
            )

        meanings: list[dict[str, str]] = []
        for column in range(5, len(row), 2):
            definition = capitalise_first(row[column] if column < len(row) else "")
            example = capitalise_first(row[column + 1] if column + 1 < len(row) else "")
            if not definition and not example:
                continue
            if not definition and example:
                warnings.append(f"Ignored an example without a meaning for {word} on row {spreadsheet_row}.")
                continue
            if not example:
                warnings.append(f"Missing example sentence for one meaning of {word} on row {spreadsheet_row}.")
            meanings.append({"definition": definition, "example": example})

        if not meanings:
            raise ValueError(f"Spreadsheet row {spreadsheet_row} ({word}) has no correct meaning.")

        answer_texts = [*distractors, *(item["definition"] for item in meanings)]
        if len({value.casefold() for value in answer_texts}) != len(answer_texts):
            raise ValueError(f"Spreadsheet row {spreadsheet_row} ({word}) contains a repeated answer meaning.")

        entries.append({"word": word, "distractors": distractors, "meanings": meanings})

    if not entries:
        raise ValueError("No valid vocabulary entries were found.")

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceWorkbook": SOURCE.name,
        "entryCount": len(entries),
        "meaningCount": sum(len(entry["meanings"]) for entry in entries),
        "warnings": warnings,
        "entries": entries,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Generated {OUTPUT} with {payload['entryCount']} words and {payload['meaningCount']} meanings.")
    for warning in warnings:
        print(f"WARNING: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
