# DEPRECATED — Canonical B (과거 검증본)

## DO NOT EXECUTE

이 디렉터리의 SQL 과 검증 러너를 **실행하지 마십시오.**
Main / Test 어느 브랜치의 migration 실행 경로에도 포함하지 마십시오.

## 무엇인가

Phase 8 초기에 작성된 **Canonical B** 기준 Shot Recipe 스키마와 그 검증본이다.
Canonical B 는 `scene_purpose` · `blocking` · `sound_cue` · `split_generation_recommended` 같은
자체 어휘를 쓰는 36필드 정의였다.

| 파일 | 내용 |
| :--- | :--- |
| `001_shot_recipe_up.sql` | Canonical B UP |
| `002_shot_recipe_triggers.sql` | Canonical B 트리거 |
| `003_shot_recipe_down.sql` | Canonical B 롤백 |
| `verify-shot-recipe-migration.ts` | Canonical B T-01~T-20 러너 (실행 시 즉시 중단하도록 가드됨) |

## 왜 폐기되었나

`docs/phase8_field_mapping_audit.md` 감사에서 Canonical B 와 정본 계약이 서로 다른 어휘
체계임이 드러났고, **Canonical A 를 공식 계약으로 채택**하는 결정이 내려졌다.

또한 Canonical B 스키마에는 승인 제약 구멍 3건이 있었다.

1. `status='approved'` 직접 INSERT 로 승인 우회 가능
2. `approver_role` 부재로 감독·제작 구분 불가 (단독 승인으로 통과)
3. `EXISTS(approved)` 판정이라 철회 후에도 과거 승인 재사용 가능

## 현재 정본

**Shot Recipe Canonical v1 — 37 fields**

| 경로 | 내용 |
| :--- | :--- |
| `../../010_shot_recipe_a_up.sql` | 현재 UP |
| `../../011_shot_recipe_a_triggers.sql` | 현재 트리거 (위 구멍 3건 차단) |
| `../../012_shot_recipe_a_down.sql` | 현재 롤백 |
| `../../verify-shot-recipe-a.ts` | 현재 검증 러너 |
| `../../../docs/phase8_canonical_a_mapping.md` | 37필드 최종 매핑 · B 컬럼 분류표 |

## 보존 이유

감사 이력을 남기기 위해 삭제하지 않는다. Canonical B 의 실행·생성 필드는
버려지지 않고 `shot_recipe_generation_specs` 로 이관되었다 (분류표 참조).
