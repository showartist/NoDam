import os
from PIL import Image, ImageDraw

os.makedirs("public/images", exist_ok=True)

vrefs = [
    {
        "filename": "public/images/vref_r01.png",
        "title": "R-01 · 푸른 새벽 틸 톤 조명",
        "sub": "천창 색온도 조명과 파란 곰팡이 타일 미장센",
        "uploader": "🎬 박재인 감독 업로드",
        "color_bg": (12, 20, 35),
        "color_accent": (56, 189, 248),
    },
    {
        "filename": "public/images/vref_r02.png",
        "title": "R-02 · 적막 후 배수구 물방울 사운드/비주얼",
        "sub": "4초 적막 후 엔딩 수면 물방울 낙하 잔상",
        "uploader": "🎨 미술팀 업로드",
        "color_bg": (10, 15, 28),
        "color_accent": (244, 114, 182),
    },
]

for r in vrefs:
    img = Image.new("RGB", (600, 330), color=r["color_bg"])
    draw = ImageDraw.Draw(img)

    for y in range(30, 300, 35):
        draw.line([(30, y), (570, y)], fill=(20, 40, 60), width=1)

    draw.rectangle([40, 40, 560, 290], outline=r["color_accent"], width=2)
    draw.text((60, 60), r["title"], fill=(248, 250, 252))
    draw.text((60, 95), r["sub"], fill=r["color_accent"])
    draw.text((60, 130), r["uploader"], fill=(148, 163, 184))
    draw.text((60, 240), "VISUAL ALIGNMENT REFERENCE IMAGE", fill=(100, 116, 139))

    img.save(r["filename"])
    print(f"Created {r['filename']}")
