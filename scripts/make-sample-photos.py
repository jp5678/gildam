"""등산 샘플 경로에 맞춘 테스트 사진 3장 생성 (Pillow 필요).

- photo-1-ascent.jpg : GPS EXIF 있음 (오르막 30% 지점)
- photo-2-summit.jpg : GPS EXIF 있음 (정상)
- photo-3-descent.jpg: GPS 없음, 촬영 시각(+09:00)만 있음 → 시각으로 매칭

실행: python3 scripts/make-sample-photos.py
"""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
GPX = ROOT / "sample" / "hiking-bukhansan.gpx"
OUT = ROOT / "sample" / "photos"
KST = timezone(timedelta(hours=9))

EXIF_IFD = 0x8769
GPS_IFD = 0x8825
DATETIME_ORIGINAL = 0x9003
OFFSET_TIME_ORIGINAL = 0x9011


def load_points():
    pattern = re.compile(r'lat="([\d.]+)" lon="([\d.]+)"><ele>([\d.-]+)</ele><time>([^<]+)</time>')
    return [
        (float(lat), float(lon), float(ele), datetime.fromisoformat(t.replace("Z", "+00:00")))
        for lat, lon, ele, t in pattern.findall(GPX.read_text(encoding="utf-8"))
    ]


def to_dms(value):
    value = abs(value)
    deg = int(value)
    minutes_full = (value - deg) * 60
    minutes = int(minutes_full)
    seconds = round((minutes_full - minutes) * 60, 4)
    return (float(deg), float(minutes), seconds)


def make_image(label, colors):
    img = Image.new("RGB", (1600, 1200), colors[0])
    draw = ImageDraw.Draw(img)
    for y in range(1200):  # 하늘 → 산 그라데이션
        t = y / 1199
        c = tuple(int(colors[0][i] * (1 - t) + colors[1][i] * t) for i in range(3))
        draw.line([(0, y), (1600, y)], fill=c)
    draw.polygon([(0, 1200), (420, 560), (760, 820), (1100, 380), (1600, 1000), (1600, 1200)], fill=(46, 94, 62))
    draw.rectangle([60, 60, 1540, 200], fill=(0, 0, 0))
    draw.text((90, 100), label, fill=(255, 255, 255))
    return img


def save(img, path, when, gps=None):
    exif = Image.Exif()
    # 하위 IFD 는 dict 로 직접 넣어야 저장됨 (get_ifd 수정분은 저장되지 않음)
    exif[EXIF_IFD] = {
        DATETIME_ORIGINAL: when.astimezone(KST).strftime("%Y:%m:%d %H:%M:%S"),
        OFFSET_TIME_ORIGINAL: "+09:00",
    }
    if gps:
        lat, lon = gps
        exif[GPS_IFD] = {
            1: "N" if lat >= 0 else "S",
            2: to_dms(lat),
            3: "E" if lon >= 0 else "W",
            4: to_dms(lon),
        }
    img.save(path, "JPEG", quality=82, exif=exif)


def main():
    points = load_points()
    peak = max(range(len(points)), key=lambda i: points[i][2])
    ascent = int(peak * 0.3)
    descent = peak + int((len(points) - peak) * 0.7)
    OUT.mkdir(parents=True, exist_ok=True)

    lat, lon, _, t = points[ascent]
    save(make_image("Sample 1 - ascent (GPS)", ((150, 200, 240), (220, 235, 245))), OUT / "photo-1-ascent.jpg", t, (lat, lon))
    lat, lon, _, t = points[peak]
    save(make_image("Sample 2 - summit (GPS)", ((90, 150, 230), (250, 220, 170))), OUT / "photo-2-summit.jpg", t + timedelta(minutes=5), (lat, lon))
    _, _, _, t = points[descent]
    save(make_image("Sample 3 - descent (time only)", ((240, 180, 120), (250, 230, 200))), OUT / "photo-3-descent.jpg", t)

    for f in sorted(OUT.glob("*.jpg")):
        exif = Image.open(f).getexif()
        print(f.name, exif.get_ifd(EXIF_IFD).get(DATETIME_ORIGINAL), dict(exif.get_ifd(GPS_IFD)) or "GPS 없음")


if __name__ == "__main__":
    main()
