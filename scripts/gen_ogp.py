#!/usr/bin/env python3
"""OGP画像（SNS共有時のカード画像）を生成する。

  python3 scripts/gen_ogp.py

出力: web/public/ogp.png（1200x630）

文言やブランド色を変えたくなったら、下の定数を直して再実行する。
アプリアイコン（ios/OwnNews/Assets.xcassets/.../icon-1024.png）を左に置き、
右にサービス名・キャッチコピー・説明を組む構成。
"""

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BRAND = "#0E9F6E"
INK = "#111827"
MUTED = "#6B7280"
BG = "#FFFFFF"
BAND = "#F3F4F6"

TITLE = "ニュースを、食事のように。"
NAME = "OwnNews"
SUB = "情報的健康を保つニュースリーダー"
FOOT = "推薦エンジンはあなたの端末の中に。嗜好データはあなたに帰属します。"
DOMAIN = "ownnews-web.pages.dev"
STORE = "iOSアプリ / ブラウザ"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON = os.path.join(ROOT, "ios/OwnNews/Assets.xcassets/AppIcon.appiconset/icon-1024.png")
OUT = os.path.join(ROOT, "web/public/ogp.png")

# 日本語が出るフォント。太字/標準をttcのインデックスで指定する
FONT_TTC = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    # このttcは index 0=W3(標準) / 2=W6(太字)。1と3はUI用の別フェイス
    return ImageFont.truetype(FONT_TTC, size, index=2 if bold else 0)


def main() -> None:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 下端: ブランドバンドと、その上の情報帯（空白にせず出自を入れる）
    BAND_TOP = H - 96
    d.rectangle([0, BAND_TOP, W, H - 10], fill=BAND)
    d.rectangle([0, H - 10, W, H], fill=BRAND)

    band_font = font(24)
    band_y = BAND_TOP + (86 - 24) // 2 - 4
    d.text((90, band_y), DOMAIN, font=band_font, fill=MUTED)
    right = d.textlength(STORE, font=band_font)
    d.text((W - 90 - right, band_y), STORE, font=band_font, fill=MUTED)

    # コンテンツ領域（帯の上）の中央に、アイコンとテキストを配置する
    mid = BAND_TOP // 2

    icon = Image.open(ICON).convert("RGBA").resize((250, 250), Image.LANCZOS)
    mask = Image.new("L", (250, 250), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, 249, 249], radius=56, fill=255)
    img.paste(icon, (95, mid - 125), mask)

    # ブロックの実測高で中央を取る（見た目の重心が上に寄らないように）
    x = 400
    rows = [
        (NAME, font(44, bold=True), BRAND, 14),
        (SUB, font(23), MUTED, 30),
        (TITLE, font(56, bold=True), INK, 26),
        (FOOT, font(21), MUTED, 0),
    ]
    total = sum(f.getbbox(t)[3] - f.getbbox(t)[1] + gap for t, f, _, gap in rows)
    y = mid - total // 2
    for text, f, color, gap in rows:
        bbox = f.getbbox(text)
        d.text((x, y - bbox[1]), text, font=f, fill=color)
        y += bbox[3] - bbox[1] + gap

    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT}  ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
