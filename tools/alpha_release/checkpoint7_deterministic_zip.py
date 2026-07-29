#!/usr/bin/env python3
"""Build a deterministic ZIP from a directory tree.

Usage: checkpoint7_deterministic_zip.py <src_dir> <out_zip>

Determinism guarantees, independent of when/how many times this is run:
  - Entry order: sorted by POSIX-style relative path (not directory-walk
    order, which can vary by filesystem).
  - Per-entry date_time: fixed to 1980-01-01 00:00:00 (the ZIP format's
    epoch) rather than each file's real mtime, so two builds made at
    different wall-clock times still produce byte-identical archives.
  - Per-entry external_attr: fixed to a normal file (0644) permission bit
    pattern, not whatever the source filesystem reports, so builds on
    different machines/checkouts still match.
  - create_system: fixed to 0 (MS-DOS/FAT), a common deterministic-build
    convention, since Python's default varies by platform.
  - compression: ZIP_DEFLATED at a fixed compresslevel for every entry.
  - No extra fields are added (Python's zipfile does not add Zip64 extra
    fields unless a file individually needs them, which none here do).
"""
import os
import sys
import zipfile


def collect_files(src_dir):
    entries = []
    for root, dirs, files in os.walk(src_dir):
        dirs.sort()
        for name in sorted(files):
            abs_path = os.path.join(root, name)
            rel_path = os.path.relpath(abs_path, src_dir).replace(os.sep, '/')
            entries.append((rel_path, abs_path))
    entries.sort(key=lambda e: e[0])
    return entries


def build(src_dir, out_zip):
    entries = collect_files(src_dir)
    if os.path.exists(out_zip):
        os.remove(out_zip)
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel_path, abs_path in entries:
            if os.path.islink(abs_path):
                raise SystemExit(f'refusing to package a symlink: {rel_path}')
            info = zipfile.ZipInfo(rel_path, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0
            info.external_attr = (0o644 << 16)
            with open(abs_path, 'rb') as f:
                data = f.read()
            z.writestr(info, data, compresslevel=6)
    return [e[0] for e in entries]


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    src_dir, out_zip = sys.argv[1], sys.argv[2]
    names = build(src_dir, out_zip)
    print(f'wrote {out_zip} with {len(names)} entries')


if __name__ == '__main__':
    main()
