#!/usr/bin/env python3
"""Draw the Relay app icon without third-party image libraries."""

import math
import struct
import zlib
from pathlib import Path


def clamp(value: float) -> float:
    return 0.0 if value < 0 else 1.0 if value > 1 else value


def coverage(distance: float) -> float:
    return clamp(0.5 - distance)


def round_box(px: float, py: float, cx: float, cy: float, half_w: float, half_h: float, radius: float) -> float:
    dx = abs(px - cx) - (half_w - radius)
    dy = abs(py - cy) - (half_h - radius)
    return math.hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - radius


def over(dst, rgb, alpha: float):
    src_a = clamp(alpha)
    dst_a = dst[3] / 255
    out_a = src_a + dst_a * (1 - src_a)
    if out_a <= 0:
        return (0, 0, 0, 0)
    channels = []
    for index in range(3):
        mixed = (rgb[index] * src_a + dst[index] * dst_a * (1 - src_a)) / out_a
        channels.append(int(mixed + 0.5))
    return (*channels, int(out_a * 255 + 0.5))


def render(size: int) -> bytes:
    pixels = bytearray()
    scale = size / 512
    purple = (88, 101, 242)
    white = (255, 255, 255)
    for y in range(size):
        for x in range(size):
            px = (x + 0.5) / scale
            py = (y + 0.5) / scale
            color = (0, 0, 0, 0)
            color = over(color, purple, coverage(round_box(px, py, 256, 256, 220, 220, 96)))
            color = over(color, white, coverage(round_box(px, py, 256, 236, 118, 78, 40)))
            color = over(color, white, coverage(math.hypot(px - 186, py - 304) - 30))
            for cx in (214, 256, 298):
                color = over(color, purple, coverage(math.hypot(px - cx, py - 236) - 13))
            pixels += bytes(color)
    return bytes(pixels)


def png(size: int, rgba: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + rgba[y * size * 4 : (y + 1) * size * 4] for y in range(size))
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
    )


def ico(png_bytes: bytes, size: int) -> bytes:
    header = struct.pack("<HHH", 0, 1, 1)
    dimension = 0 if size >= 256 else size
    entry = struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(png_bytes), 22)
    return header + entry + png_bytes


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "desktop" / "build"
    output.mkdir(parents=True, exist_ok=True)
    large = png(512, render(512))
    small = png(256, render(256))
    (output / "icon.png").write_bytes(large)
    (output / "icon.ico").write_bytes(ico(small, 256))
    print(output / "icon.png")


if __name__ == "__main__":
    main()
