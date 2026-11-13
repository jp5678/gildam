"""PWA 아이콘 생성 (Pillow). 실행: python3 scripts/make-icons.py

녹색 배경 위에 산 능선과 길(점선 경로)을 그린 단순한 아이콘.
maskable 아이콘은 안전 영역(가운데 80%) 안에 그림을 둠.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
GREEN_TOP = (46, 158, 91)
GREEN_BOTTOM = (20, 92, 54)
SCALE = 4  # 초과 샘플링 후 축소해 가장자리를 부드럽게


def draw_icon(size: int, safe: float, rounded: bool) -> Image.Image:
    big = size * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    bg = Image.new("RGBA", (big, big))
    grad = ImageDraw.Draw(bg)
    for y in range(big):
        t = y / (big - 1)
        grad.line([(0, y), (big, y)], fill=tuple(int(GREEN_TOP[i] * (1 - t) + GREEN_BOTTOM[i] * t) for i in range(3)))
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22) if rounded else 0, fill=255)
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    pad = big * (1 - safe) / 2
    s = big * safe

    def p(x: float, y: float) -> tuple[float, float]:
        return (pad + x * s, pad + y * s)

    # 산 능선
    d.polygon([p(0.0, 0.78), p(0.3, 0.36), p(0.46, 0.55), p(0.66, 0.22), p(1.0, 0.78)], fill=(255, 255, 255, 235))
    d.polygon([p(0.58, 0.34), p(0.66, 0.22), p(0.74, 0.34), p(0.68, 0.31), p(0.64, 0.36)], fill=(200, 236, 214, 255))
    # 길 (점선 곡선)
    path = [p(0.12, 0.95), p(0.3, 0.86), p(0.5, 0.88), p(0.66, 0.8), p(0.8, 0.7)]
    for (x1, y1), (x2, y2) in zip(path, path[1:]):
        steps = 6
        for i in range(steps):
            if i % 2 == 0:
                a = i / steps
                b = (i + 1) / steps
                d.line([(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a), (x1 + (x2 - x1) * b, y1 + (y2 - y1) * b)], fill=(255, 214, 102, 255), width=int(s * 0.045))
    # 현재 위치 점
    cx, cy = p(0.8, 0.7)
    r = s * 0.05
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(232, 96, 60, 255), outline=(255, 255, 255, 255), width=int(s * 0.018))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    targets = {
        "icon-192.png": (192, 0.86, True),
        "icon-512.png": (512, 0.86, True),
        "maskable-512.png": (512, 0.72, False),
        "apple-touch-icon.png": (180, 0.8, False),
    }
    for name, (size, safe, rounded) in targets.items():
        draw_icon(size, safe, rounded).save(OUT / name, optimize=True)
        print(f"icons/{name}")


if __name__ == "__main__":
    main()
