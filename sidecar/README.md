# audio_sidecar

Node 앱이 HTTP 로 부르는 로컬 파이썬 음성 서비스입니다. 화자 임베딩, 조각 간 화자 연결, 기준선 화자분리, DER 채점, 이미지 유사도를 맡습니다.
전사(STT)는 하지 않습니다. 전사는 계속 OpenRouter Grok STT 가 합니다.

```bash
# NoDam 저장소 루트에서 실행. Python 환경을 저장소 밖에 만든다.
npm run audio:server
curl http://127.0.0.1:8790/health
```

- Node 쪽 주소는 `http://127.0.0.1:${SIDECAR_PORT:-8790}` 입니다.
- 첫 요청 때 모델을 내려받고 올립니다 (ECAPA 약 80 MB, SigLIP 2 약 1.5 GB). 서버 시작은 가볍습니다.
- 모든 시간은 정수 밀리초, 오디오는 **절대 경로**로 넘깁니다. 파일은 ffmpeg 로 16 kHz mono 로 풀어서 쓰므로 m4a·mp3·webm·wav 모두 됩니다.

## 모델

| 용도 | 모델 | 라이선스 | 비고 |
|---|---|---|---|
| 음성 구간 | Silero VAD (`silero-vad` 6.2) | MIT | 패키지에 들어 있어 내려받지 않음 |
| 화자 임베딩 | `speechbrain/spkrec-ecapa-voxceleb` (ECAPA-TDNN, 192차원) | Apache-2.0 | 게이트 없음 |
| 이미지 임베딩 | `google/siglip2-base-patch16-224` (비전 타워만) | Apache-2.0 | 게이트 없음 |
| 채점 | `pyannote.metrics` 4.1 | MIT | 모델 아님 |

**ECAPA 를 고른 이유.** 후보 둘을 이 맥(arm64, CPU)에서 같은 음성으로 돌려 봤습니다.
두 모델 모두 같은 사람 0.76~0.91, 다른 사람 −0.01~0.50 으로 잘 갈랐고, ECAPA 쪽 여유가 조금 더 컸습니다 (가장 비슷한 다른 두 목소리 0.40 대 0.50).
결정적인 차이는 설치였습니다. `pyannote/wespeaker-voxceleb-resnet34-LM` 을 쓰려면 `pyannote.audio` 4 가 필요한데, 이것이 lightning·torchcodec·grpcio·opentelemetry 등 91개 패키지를 끌고 오고 모델 로드에 33 s 가 걸렸습니다. torchcodec 은 이 맥의 FFmpeg 8 과도 버전을 맞춰야 합니다.
speechbrain 은 torch 2.14 / torchaudio 2.11 과 그대로 맞물렸고 모델 로드 1~7 s, 4 s 음성 하나에 약 30 ms 입니다.
게이트가 걸린 `pyannote/speaker-diarization-community-1`·`segmentation-3.0` 은 쓰지 않습니다 (HF 토큰 없음).

## 동시성·메모리

- 모델 로드와 추론은 **전역 락 하나**(`models.MODEL_LOCK`, 재진입 가능)로 감쌉니다. 요청이 몰리면 줄을 섭니다. 다른 팀에서 MPS 추론 두 개가 겹쳐 서버가 죽은 일이 있어서입니다.
- 기본 장치는 CPU 입니다 (`SIDECAR_DEVICE=cpu|mps|auto`). ECAPA 는 CPU 로 충분히 빠릅니다.
- torch 스레드는 4개로 묶습니다 (`SIDECAR_TORCH_THREADS`). silero-vad 가 실행 중에 스레드를 1로 바꿔 놓아서 매 추론 전에 되돌립니다.
- 임베딩 배치는 4 입니다 (`SIDECAR_EMBED_BATCH`). 이 맥(스왑이 거의 찬 상태)에서 1.5 s 창 16~32개 배치는 1 s 이내가 아니라 45~60 s 가 걸렸습니다.
- SigLIP 2 는 `/image-sim` 을 처음 부를 때만 올라옵니다.

## 엔드포인트

### `GET /health`
```json
{"ok": true, "device": "cpu", "models": {"vad": "loaded", "embedding": "not_loaded", "siglip": "not_loaded"}}
```

### `POST /embed`
```json
{"audio_path": "/abs/meeting.wav", "segments": [{"start_ms": 1200, "end_ms": 4800}]}
```
→ `{dim: 192, model, embeddings: [[...] | null], skipped: [{index, reason}], padded: [index]}`
- 임베딩은 L2 정규화되어 있고 입력 순서와 같습니다. 건너뛴 구간은 `null`.
- 400 ms 보다 짧은 구간은 앞뒤 실제 음성으로 넓혀 400 ms 로 만들고 `padded` 에 적습니다. 150 ms 미만, 파일 범위 밖, 무음은 `skipped` 에 이유와 함께 적습니다.

### `POST /link-speakers`
긴 회의나 실시간 마이크 입력을 조각으로 나눠 전사할 때, 조각마다 따로 붙은 화자 번호를 회의 전체에서 같은 사람으로 이어 줍니다.
```json
{"chunks": [{"audio_path": "/abs/chunk_00.wav", "offset_ms": 0,
             "words": [{"start_ms": 800, "end_ms": 1300, "speaker": 0}]}],
 "threshold": 0.5, "num_speakers": null}
```
- `words` 시간은 조각 파일 기준입니다. `speaker` 는 공급사가 준 조각 안 번호(int/str/null)입니다.
- (조각, 지역 화자)마다 그 사람 말을 모읍니다. 같은 화자의 인접 단어는 300 ms 이내면 한 구간으로 합치고, 긴 구간부터 최대 60 s 까지 임베딩해 길이 가중 평균(센트로이드)을 냅니다. 말한 시간이 1 s 미만이면 `low_confidence`.
- 전체 센트로이드를 코사인 거리 평균 연결(average linkage) 병합 군집으로 묶습니다. `threshold` 는 **코사인 거리**(1 − cos) 상한이고, 같은 조각의 두 지역 화자는 절대 합치지 않습니다(cannot-link). `num_speakers` 를 주면 임계값 대신 그 수가 될 때까지 합칩니다.
- 응답
  ```json
  {"mapping": [{"chunk_index": 0, "local": 0, "global": "G1", "confidence": 0.84, "low_confidence": false,
                "speech_ms": 29216, "segments_used": 7, "sim_own_cluster": 0.92, "sim_best_other_cluster": 0.57}],
   "global_speakers": ["G1", "G2"], "pairwise": [{"a": "0:0", "b": "1:2", "cos": 0.91, "same_chunk": false}],
   "threshold": 0.5, "method": "..."}
  ```
  G1..Gn 은 처음 등장한 순서입니다. `confidence` = clip(0.5 + (자기 군집 나머지와의 cos − 가장 가까운 다른 군집 cos), 0, 1), 혼자인 군집은 자기 쪽 값을 1 − threshold 로 둡니다. 말한 시간이 1 s 미만이면 그 비율만큼 깎습니다. `confidence < 0.6` 이거나 1 s 미만이면 `low_confidence: true`.

### `POST /diarize`
```json
{"audio_path": "/abs/meeting.wav", "num_speakers": 5, "min_speakers": 1, "max_speakers": 10}
```
→ `{segments: [{start_ms, end_ms, speaker: "S1"}], num_speakers, method, windows, speech_ms}`

Silero VAD → 음성 구간 안에서 1.5 s 창 / 0.75 s 간격 ECAPA 임베딩 → 군집 → 20 ms 프레임 단위로 겹치는 창의 다수결 → 같은 화자 연속 구간 병합(250 ms 미만 조각은 이웃에 흡수).
군집은 평균 연결 AHC 를 코사인 거리 0.7(`SIDECAR_DIARIZE_THRESHOLD`)에서 잘라 순도 높은 작은 군집을 만든 뒤, 창 수 max(3, 2%) 미만 군집은 이상치로 보고 큰 군집 중심으로 다시 배정하고, 화자 수(주어진 값 또는 찾은 큰 군집 수를 min/max 로 자른 값)가 될 때까지 가장 가까운 중심끼리 합칩니다(모자라면 가장 퍼진 군집을 둘로 나눔). 마지막에 구형 k-means 로 다듬습니다.
처음에는 AHC 를 바로 k개로 잘랐는데, 이상치 창 몇 개가 따로 군집을 차지하고 실제 두 사람이 합쳐져 DER 36% 가 나왔습니다. 위 방식으로 바꾼 뒤 같은 회의가 11% 입니다.
STT 공급사 화자분리와 비교하는 기준선이지 겹쳐 말하기(overlap)는 다루지 않습니다.

### `POST /der`
```json
{"reference": [{"start_ms": 0, "end_ms": 4000, "speaker": "A"}], "hypothesis": [...],
 "collar_ms": 250, "skip_overlap": false,
 "utterances": [{"uid": "U01", "start_ms": 0, "end_ms": 4000, "speaker": "A"}]}
```
→ `{der, jer, confusion, missed_detection, false_alarm, total_ms, ...}` (비율은 total 대비, `*_ms` 는 절대값)
- `pyannote.metrics` 의 `DiarizationErrorRate`, `JaccardErrorRate`. **collar 는 pyannote 의미**입니다: `collar_ms` 250 이면 정답 경계마다 ±125 ms 를 뺍니다 (NIST md-eval 의 "0.25 s collar" 는 ±250 ms 이므로 그 값을 원하면 500 을 넣으십시오).
- 평가 구간(UEM)은 정답과 가설을 모두 덮는 한 구간입니다.
- `utterances` 를 주면 `utterance_speaker_accuracy` 를 더합니다: 정답 발언마다 가장 많이 겹친 가설 화자를 고르고, 가설→정답 라벨을 헝가리안으로 최적 대응시킨 뒤 맞은 비율과 발언별 행을 돌려줍니다.

### `POST /image-sim`
```json
{"image_path": "/abs/generated.png", "reference_paths": ["/abs/ref1.jpg", "/abs/ref2.jpg"]}
```
→ `{model: "google/siglip2-base-patch16-224", similarities: [0.83, 0.41]}` (SigLIP 2 이미지 임베딩 코사인)

## CLI

HTTP 없이 같은 함수를 부릅니다. 결과 JSON 을 stdout 으로 냅니다.
```bash
uv run python -m audio_sidecar.cli {embed|link|diarize|der|image-sim} request.json   # '-' 면 stdin
```

## 테스트

```bash
uv run pytest -q        # 17개, 이 맥에서 약 30 s (첫 실행은 모델 내려받기 때문에 더 걸림)
```
음성은 테스트 중에 macOS `say` 로 만듭니다(Samantha·Daniel·Karen). 한국어 `say` 목소리는 쓰지 않습니다: 이 맥에서는 ko_KR 목소리 이름을 무엇으로 주든 한국어 문장이면 Yuna 와 바이트까지 같은 소리가 나옵니다.
`test_image_sim` 은 SigLIP 2 가 HF 캐시에 있을 때만 돕니다.

## 임계값을 정한 근거 (합성 회의 기준)

- `/diarize` 자동 모드 0.7: `fixtures/eval/audio/scene27`, `scene12` 에서 0.6 은 한 목소리를 2~4개로 쪼갰고(쪼개진 조각끼리 중심 cos 0.73~0.79) 0.8 은 다른 목소리를 합쳤습니다(0.49~0.57). 같은 회의로 정한 값이라 그 두 회의의 자동 모드 수치는 표본 안 결과입니다.
- `/link-speakers` 기본 0.4 (`SIDECAR_LINK_THRESHOLD`): 세 합성 회의에서 0.3·0.4·0.5 가 모두 같은 연결 결과를 냈습니다. 다른 목소리의 센트로이드끼리는 cos 최대 0.57, 같은 목소리의 조각 간 센트로이드는 0.74 이상이어서 그 사이 가운데쯤(cos 0.6)을 골랐습니다. 결과는 `fixtures/eval/results/diarization-20260911.md`.
- 둘 다 TTS 목소리로 정한 값입니다. TTS 는 같은 사람 목소리가 녹음마다 흔들리지 않으므로, 실제 사람 녹음으로 다시 맞춰야 합니다.
