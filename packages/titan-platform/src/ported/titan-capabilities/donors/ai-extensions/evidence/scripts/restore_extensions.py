#!/usr/bin/env python3
"""Restore the lossless AI extension dataset into an extensions/ tree."""
from __future__ import annotations
import argparse, base64, hashlib, os, pathlib, shutil, sys, tempfile, urllib.request, zlib


def download(url: str, target: pathlib.Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "ai-extensions-materializer/1.0"})
    with urllib.request.urlopen(req, timeout=180) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)


def safe_target(root: pathlib.Path, relative: str) -> pathlib.Path:
    rel = pathlib.PurePosixPath(relative)
    if rel.is_absolute() or ".." in rel.parts or not rel.parts or rel.parts[0] != "extensions":
        raise ValueError(f"Unsafe dataset path: {relative!r}")
    target = (root / pathlib.Path(*rel.parts)).resolve()
    expected = (root / "extensions").resolve()
    if target != expected and expected not in target.parents:
        raise ValueError(f"Path escapes extensions root: {relative!r}")
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--root", default=".")
    parser.add_argument("--clean", action="store_true")
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve()
    destination = root / "extensions"
    if args.clean and destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)

    try:
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise SystemExit("pyarrow is required: python -m pip install pyarrow") from exc

    with tempfile.TemporaryDirectory(prefix="ai-ext-") as td:
        parquet = pathlib.Path(td) / "archive.parquet"
        download(args.url, parquet)
        pf = pq.ParquetFile(parquet)
        restored = 0
        raw_bytes = 0
        for batch in pf.iter_batches(columns=["Path", "Bytes", "Sha256", "Codec", "Content"], batch_size=128):
            data = batch.to_pydict()
            for path, expected_bytes, expected_sha, codec, content in zip(
                data["Path"], data["Bytes"], data["Sha256"], data["Codec"], data["Content"]
            ):
                if codec != "zlib+base64":
                    raise ValueError(f"Unsupported codec {codec!r} for {path}")
                payload = zlib.decompress(base64.b64decode(content, validate=True))
                if len(payload) != int(expected_bytes):
                    raise ValueError(f"Size mismatch for {path}: {len(payload)} != {expected_bytes}")
                actual_sha = hashlib.sha256(payload).hexdigest()
                if actual_sha != expected_sha:
                    raise ValueError(f"SHA-256 mismatch for {path}: {actual_sha} != {expected_sha}")
                target = safe_target(root, path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(payload)
                restored += 1
                raw_bytes += len(payload)
        print(f"Restored {restored} files ({raw_bytes} bytes) into {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
