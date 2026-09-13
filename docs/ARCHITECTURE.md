# SceneNote 아키텍처

## 목표 데이터 흐름

```text
[음성 또는 녹음 파일]
        ↓
[1-2. STT·화자 분리]
        ↓  TranscriptUtterance[]
[3. 구조화·동상이몽 분석]
        ↓  DongSangAnalysis
[4. 경보·진단]
        ↓  DiagnosisResult
┌──────────────────────────────┐
│ 5. 무드보드·콘티 생성       │
│ 6. 대시보드 검토·수정·확정  │
└──────────────────────────────┘
        ↓
[7. DB·버전 이력·배포]
```

## 현재와 목표의 차이

**1-2 → 3 구간은 실제로 연결되어 있습니다.** 오디오를 올리면 OpenRouter STT 가 실제로 호출되고, 그 결과가 DB 를 거쳐 OpenRouter LLM 분석기로 들어갑니다. 하드코딩된 전사나 고정 안건은 제거됐습니다.

4~7 구간은 아직 화면과 사전 준비 데이터로 흐름만 확인하는 단계입니다. 목표는 각 파트의 실제 출력으로 교체하되 대시보드가 같은 데이터 구조를 계속 쓰게 하는 것입니다.

## 실제 디렉터리

저장소 루트가 곧 Next.js 프로젝트 루트입니다.

```text
app/                      Next.js App Router
  m/[id]/                 회의 화면 (5단계 + 참고 화면)
    MeetingPipelinePanel.tsx   업로드 → 화자 매핑 → 분석 UI
  api/meetings/[id]/
    audio-transcribe/     업로드 → 실제 STT → 저장 트랜잭션
    analyze-alignment/    동상이몽 분석 실행·조회
    speakers/             SPEAKER_01 → 이름 매핑
lib/
  transcription/          STT 공급자 계층
    providers/openrouter.ts   Grok STT + diarization
  analysis/               동상이몽 LLM 분석
  domain/                 순수 규칙 (DB·HTTP 모름)
  services/               도메인 + 저장소 조율   ← 복수형
  repositories/           DB 접근                ← 복수형
  db.ts                   SQLite 스키마·마이그레이션
tests/                    계약·단위 테스트
scripts/                  평가·유틸 스크립트
fixtures/film/            데모 회의 시드 데이터
```

> 이전 문서에 `app/lib/service/`, `app/lib/repository/` 로 적혀 있었으나 실제 경로는 **복수형** `lib/services/`, `lib/repositories/` 이며 저장소 루트 기준입니다.

## 데이터 타입

전사 결과는 공급사 응답 형태를 그대로 쓰지 않고 내부 표준 타입으로 변환한 뒤에만 상위로 넘어갑니다 (`lib/transcription/types.ts`).

```ts
type TranscriptUtterance = {
  speakerId: string | null;   // SPEAKER_01. 화자 정보가 없으면 null
  speakerName: string | null; // 사람이 붙인 이름. 전사 시점에는 null
  startMs: number | null;
  endMs: number | null;
  text: string;
  confidence: number | null;  // 없으면 null. 지어내지 않는다
};
```

공급자를 바꿔도 이 타입 이후 로직은 바뀌지 않습니다.

## 상태 흐름

구조화된 항목은 최소한 다음 상태를 가집니다.

```text
suggested → confirmed
     ↘ revised → confirmed
     ↘ unresolved
```

- `suggested`: 회의에서 제안됐지만 합의 전
- `confirmed`: 발화 또는 사용자 조작으로 확정
- `revised`: 기존 항목을 수정한 제안
- `unresolved`: 근거가 부족하거나 충돌 상태

전사·분석 실행 자체의 상태는 따로 기록합니다.

- `transcription_runs` — 어떤 파일을 어떤 모델로 처리했고 화자분리가 됐는지 (`diarization_status`: `ok` / `unsupported` / `failed`)
- `alignment_analysis_runs` — 분석 1회 = 1행. `status` 가 `completed` 일 때만 결과가 있습니다. 실패도 기록합니다.

## 공통 메시지 봉투

파트 사이 데이터는 다음 공통 필드를 권장합니다.

```json
{
  "schema_version": "0.1",
  "meeting_id": "meeting-20260803-001",
  "event_id": "evt-0001",
  "created_at": "2026-08-03T12:00:00+09:00",
  "producer": "part-1-2",
  "payload": {}
}
```

`schema_version` 이 바뀌면 PR 에서 변경 이유와 하위 호환 여부를 설명합니다. 상세 payload 예시는 [PART_INTEGRATION_GUIDE.md](PART_INTEGRATION_GUIDE.md) 에 있습니다.

## 경계 원칙

1. UI 는 모델 내부 구현을 알지 않고 JSON 결과만 사용합니다.
2. 분석 결과에는 점수뿐 아니라 **근거 발화 U-ID** 가 포함되어야 합니다. 근거 없는 해석은 분석기가 버립니다.
3. 생성 이미지는 URL 만 전달하지 않고 prompt, model, source reference 를 함께 기록합니다.
4. 사전 준비 데이터와 실제 결과를 화면에서 구분합니다. 현재는 쇼트 이미지에 `데모용 사전 생성 이미지` 배지로 표시하며, 파트별 API 에는 `data_mode` 필드를 권장합니다. *(공통 필드로는 아직 미적용)*
5. **외부 API 실패는 빈 성공 응답으로 숨기지 않습니다.** 키가 없으면 `NOT_CONFIGURED`, 공급자 오류는 그 메시지를 그대로 올립니다. 픽스처로 자동 대체하지 않습니다 — `lib/transcription/index.ts` 에서 강제되고 `tests/wiring-contract.mjs` 가 검사합니다.
