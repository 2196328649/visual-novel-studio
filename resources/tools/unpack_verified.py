"""Extract a verified tool archive into a fresh, private staging directory."""
import os
import pathlib
import shutil
import stat
import sys
import zipfile

archive, destination = map(pathlib.Path, sys.argv[1:3])
destination = destination.resolve(strict=True)
if any(destination.iterdir()):
    raise ValueError("The extraction directory must be empty.")
with zipfile.ZipFile(archive) as source:
    entries = source.infolist()
    if len(entries) > 100_000 or sum(item.file_size for item in entries) > 8 * 1024**3:
        raise ValueError("Tool archive is too large.")
    for entry in entries:
        relative = pathlib.PurePosixPath(entry.filename.replace("\\", "/"))
        if relative.is_absolute() or ".." in relative.parts or any(":" in part for part in relative.parts):
            raise ValueError("Unsafe archive path.")
        if stat.S_ISLNK(entry.external_attr >> 16):
            raise ValueError("Symbolic links are not supported in tool archives.")
        target = destination.joinpath(*relative.parts).resolve()
        if target != destination and destination not in target.parents:
            raise ValueError("Archive path leaves the extraction directory.")
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as reader, target.open("wb") as writer:
                shutil.copyfileobj(reader, writer, 1024 * 1024)
print("Tool archive extracted.", flush=True)
