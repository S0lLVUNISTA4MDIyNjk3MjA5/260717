#!/usr/bin/env python3
"""Compare an actual α版 output JSON against the shipped expected fixture.

Usage:
    python3 compare_expected.py sample_expected_normal.json actual_normal.json
    python3 compare_expected.py sample_expected_table.json actual_table.json

Volatile fields (any key literally named "created_at" or "generated_at", wherever
they appear in the tree) are excluded before comparison, since they legitimately
change on every run. All other fields are compared for exact equality.
Exit code 0 = match, 1 = mismatch.
"""
import json
import sys

VOLATILE_KEYS = {"created_at", "generated_at"}


def strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: strip_volatile(v) for k, v in obj.items() if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [strip_volatile(v) for v in obj]
    return obj


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    expected = strip_volatile(json.load(open(sys.argv[1], encoding='utf-8')))
    actual = strip_volatile(json.load(open(sys.argv[2], encoding='utf-8')))
    if expected == actual:
        print("MATCH: stable fields are identical (created_at/generated_at excluded).")
        sys.exit(0)
    print("MISMATCH")
    print("expected:", json.dumps(expected, ensure_ascii=False, indent=2))
    print("actual:  ", json.dumps(actual, ensure_ascii=False, indent=2))
    sys.exit(1)


if __name__ == '__main__':
    main()
