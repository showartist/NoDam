import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs("public/images", exist_ok=True)

shots = [
    {
        "n": 1,
        "title": "SHOT 01 · Wide · 24mm",
        "action": "INT. 폐쇄된 실내수영장 - 새벽 틸 톤",
        "sub": "관람석에서 수영장 전체 및 수현/민규 원경",
        "color_bg": (15, 23, 42),
        "color_tile": (20, 50, 70),
        "color_accent": (56, 189, 248),
    },
    {
        "n": 2,
        "title": "SHOT 02 · Medium · 35mm",
        "action": "수영장 바닥 수영모 발견",
        "sub": "수현과 민규가 발견하고 멈춰 서는 투샷",
        "color_bg": (15, 23, 42),
        "color_tile": (15, 45, 65),
        "color_accent": (20, 184, 166),
    },
    {
        "n": 3,
        "title": "SHOT 03 · MCU · 50mm (핵심 행동)",
        "action": "이름표 몰래 찢어 숨김",
        "sub": "수영모 안쪽 찢어진 이름표를 손안에 은닉",
        "color_bg": (15, 23, 42),
        "color_tile": (10, 40, 60),
        "color_accent": (244, 114, 182),
    },
    {
        "n": 4,
        "title": "SHOT 04 · Medium · 50mm",
        "action": "민규의 증거 요구 & 수현의 은닉",
        "sub": "주머니 속 손과 형사의 증거물 요구 대립",
        "color_bg": (15, 23, 42),
        "color_tile": (15, 35, 55),
        "color_accent": (251, 191, 36),
    },
    {
        "n": 5,
        "title": "SHOT 05 · Closeup · 50mm",
        "action": "증거봉투 보관",
        "sub": "민규가 수영모를 투명 증거봉투에 봉인",
        "color_bg": (15, 23, 42),
        "color_tile": (20, 30, 50),
        "color_accent": (168, 85, 247),
    },
    {
        "n": 6,
        "title": "SHOT 06 · Wide · 24mm (엔딩)",
        "action": "빈 수영장과 배수구 물방울",
        "sub": "퇴장 후 배수구 낙하 물방울 파문 잔상",
        "color_bg": (10, 15, 30),
        "color_tile": (10, 35, 55),
        "color_accent": (56, 189, 248),
    },
]

for s in shots:
    img = Image.new("RGB", (640, 360), color=s["color_bg"])
    draw = ImageDraw.Draw(img)

    # 타일 패턴 및 시네마틱 라인
    for y in range(40, 320, 40):
        draw.line([(40, y), (600, y)], fill=s["color_tile"], width=1)
    for x in range(40, 600, 70):
        draw.line([(x, 40), (x, 320)], fill=s["color_tile"], width=1)

    # 중앙 그래픽 콘티 구도 상자
    draw.rectangle([60, 50, 580, 310], outline=s["color_accent"], width=2)
    
    # 텍스트 오버레이
    draw.text((80, 70), s["title"], fill=(248, 250, 252))
    draw.text((80, 110), s["action"], fill=s["color_accent"])
    draw.text((80, 140), s["sub"], fill=(148, 163, 184))
    
    draw.text((80, 260), "SCENE 34 STORYBOARD CONCEPT BOARD", fill=(100, 116, 139))

    filename = f"public/images/scene34_shot{s['n']}.png"
    img.save(filename)
    print(f"Created {filename}")
