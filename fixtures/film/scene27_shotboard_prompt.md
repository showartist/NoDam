# SCENE 27 Shot Board 이미지 생성 프롬프트

용도: `public/images/scene27_shot1~6.png` 로 잘라 쓸 6컷 보드 한 장.
**레이아웃을 SCENE 12 보드와 동일하게 유지해야** 기존 크롭 스크립트가 그대로 작동합니다.

---

## A. 통합 보드 프롬프트 (권장 — 이거 하나면 됨)

```
A film storyboard contact sheet, 6 panels in a 2-column × 3-row grid on a near-black
background (#0d0d0d) with clean dark gutters between panels.

Header at top-left in bold condensed white type:
"SCENE 27  /  EXT. SCHOOLYARD – DAWN"

Each panel is a cinematic 21:10 widescreen still with a small dark label chip in its
top-left corner reading exactly:
Shot 01  WS   /   Shot 02  MS   /   Shot 03  MCU
Shot 04  CU   /   Shot 05  INSERT   /   Shot 06  WIDE END

Story: a Korean father and daughter part ways at dawn in an abandoned rural
schoolyard. She buries his old radio in the dirt and leaves without looking back.

Panel content, in order:
1. WS — Wide shot of an empty schoolyard at first light. YOUNG WOMAN (late 20s, dark
   coat) stands holding a shovel. An OLD MAN (early 60s) waits by a small blue truck
   at frame right. Bare goalposts, cracked ground, low mist.
2. MS — Medium shot of the old man beside the truck, unlit cigarette in his mouth,
   looking at his daughter off-frame. Weathered face, resigned.
3. MCU — Medium close-up of the young woman, eyes lowered, not answering. Cold dawn
   light on one side of her face.
4. CU — Close-up of a battered vintage portable radio resting on bare soil, antenna
   bent, dial scratched. Shallow depth of field.
5. INSERT — Insert shot of hands and a shovel blade pushing dark soil over the radio.
   Only hands, soil and the shovel edge in frame.
6. WIDE END — Wide shot of the schoolyard, truck gone, nobody in frame. A single fresh
   patch of turned earth in the middle of the empty ground.

Photographic style: anamorphic cinema look, magic-hour dawn, heavily desaturated —
ONLY earth browns and pale sky blue, no other colors. Soft natural light, no artificial
lamps, no lens flare. Grain of 35mm film. Quiet, restrained, unsentimental.

No text inside the images other than the corner label chips. No watermarks.
Aspect ratio 4:3, high resolution.
```

## B. 컷별 개별 프롬프트 (보드가 마음에 안 들 때만)

공통 접미사 — 모든 컷 끝에 붙일 것:

```
anamorphic 35mm film still, dawn magic hour, heavily desaturated palette of earth
brown and pale sky blue only, soft natural light, film grain, no text, no watermark,
cinematic 21:10 widescreen
```

| 컷 | 프롬프트 본문 |
|---|---|
| 01 WS | `Wide shot, abandoned rural Korean schoolyard at first light. A woman in her late 20s stands alone holding a shovel; an old man waits beside a small blue truck at frame right. Bare goalposts, cracked dirt ground, low mist.` |
| 02 MS | `Medium shot of a Korean man in his early 60s standing beside a small blue truck, unlit cigarette in his mouth, looking off-frame at his daughter. Weathered face, worn jacket, resigned expression.` |
| 03 MCU | `Medium close-up of a Korean woman in her late 20s in a dark coat, eyes lowered, jaw set, not speaking. Cold dawn light rims one side of her face.` |
| 04 CU | `Close-up of a battered vintage portable radio resting on bare soil, bent antenna, scratched dial, shallow depth of field, dawn light.` |
| 05 INSERT | `Insert shot: bare hands and the edge of a shovel blade pushing dark soil over a small vintage radio. Only hands, soil and shovel edge visible in frame.` |
| 06 WIDE END | `Wide shot of an empty rural schoolyard at dawn, no people, no vehicles. A single fresh patch of turned dark earth in the middle of the cracked ground.` |

---

## 받은 뒤 처리 방법

보드 한 장으로 받으면 패널 경계를 자동 검출해 6장으로 자릅니다.

```bash
python3 scripts/crop-shotboard.py ~/Downloads/<받은파일>.png scene27
```

컷별로 따로 받으면 `public/images/scene27_shot1.png` … `scene27_shot6.png` 로 저장하면 됩니다.

## 의도 연결 (이미지가 들어오면 이렇게 매핑)

| 쇼트 | 담는 의도 | 역할 |
|---|---|---|
| 04 CU 라디오 | `key_object` 라디오 | 설정(setup) |
| 05 INSERT 묻는 손 | `key_action` 라디오를 흙에 묻는다 | 담당(primary) |
| 05 INSERT 묻는 손 | `key_object` 라디오 | 강조(emphasis) |
| 06 WIDE END 흙자국 | `last_image` 흙자국만 남은 화면 | 담당(primary) |
| 06 WIDE END 흙자국 | `key_object` 라디오 | 회수(payoff) |
