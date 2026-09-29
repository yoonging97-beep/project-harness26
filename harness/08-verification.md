---
round: R8
status: confirmed
title: 검증과 리뷰
---

# R8 — 검증과 리뷰

## 1. 정합성 리뷰

| # | 발견 | 관련 | 처리 |
|---|---|---|---|
| F1 | `request.md`는 `runs/<run_id>/` 안에 있는데, `run_id`는 실행 생성 시 부여된다. 사용자가 요청서를 쓸 위치가 없다. | R2, R4 | 기본값 반영: 2장 |
| F2 | `gate-judge`는 Read·Grep·Glob만 있어 Figma 링크를 볼 수 없다. G3 llm-judge 조건을 판정할 수 없다. | R3, R5, R6 | 기본값 반영: 2장 |
| F3 | G4-6(디자인 vs 구현) 스크린샷과 scope snapshot을 저장할 경로가 R4 구조에 없다. | R4, R7 | 기본값 반영: 2장 |
| F4 | Pretendard를 CDN에서 불러오면 C-2b 허용 도메인이 필요하다. | R5, R6 | 기본값 반영: 2장 |
| F5 | config 파일이 `baseline`에 없어서, 멈춘 사이에 config가 바뀌어도 재개 때 잡지 못한다. | R4, R7 | 기본값 반영: 2장 |
| F6 | `00-context.md`의 R0-1은 아직 `inputs:` 표현이다. | R0, R5 | 변경 없음. R5 1장이 확장을 기록했다. CLAUDE.md에 "R5가 우선"으로 명시한다. |
| F7 | `Docs/gates.md`, `Docs/default-design.md`의 최종 상태가 정해지지 않았다. | R0 | 변경 없음. 계속 draft로 판정에서 제외한다. 대체 문서: `05-gates.md`, `design-tokens.yaml`. `Docs/`는 수정하지 않는다. |
| F8 | 1.1의 OCR 결정을 어디에 기록하는지 충돌한다. hook은 실행 중 config 쓰기를 막고, F5에 따라 config 변경은 revision +1을 일으킨다. | R6, R7 | 확정: 3장 |
| F9 | 기준 문서 3개에 `status: confirmed`가 없고, `design.md`에 커밋되지 않은 변경이 있다. 이대로면 첫 실행 preflight가 실패한다. | R4-11 | 사용자 작업: 7장 |

## 2. 기본값으로 반영한 보완

| # | 보완 | 규칙 |
|---|---|---|
| F1 | 사용자는 `harness/requests/<feature_id>.md`에 요청서를 쓴다. `start_run`이 R4-10을 검사한 뒤 `runs/RUN-nnn/request.md`로 복사한다. 원본은 그대로 둔다. | R8-1 |
| F2 | `design-manifest.yaml`의 `screens[].source`는 **로컬 이미지 파일**이어야 한다. Figma 링크는 선택 필드 `figma_url`로 함께 둘 수 있다. | R8-2 (SC-5 보완) |
| F3 | 오케스트레이터 소유 `gates/` 아래에 `gates/evidence/`(판정 증거·스크린샷), `gates/scope/`(scope snapshot)를 둔다. | R8-3 |
| F4 | 폰트는 npm 패키지로 self-host한다. 초기 C-2b 허용 도메인 목록은 비어 있다. | – |
| F5 | `run.yaml.baseline`에 config 3개 파일의 SHA-256도 기록한다. 재개할 때 다르면 기준 문서가 바뀐 경우와 같이 revision +1로 처리한다. | R8-4 |

## 3. F8 — 실행 중 기술 결정 (R6-7 보완)

실행 중 결정은 실행 안에 남긴다.

| 위치 | 담는 것 |
|---|---|
| `harness/config/policy.yaml` | **어떤 기술 결정이 필요한가** (`required_technical_decisions`) |
| `rev-N/s1/answers.md` | 이번 실행에서 **선택한 값** |

```yaml
# policy.yaml
required_technical_decisions:
  - id: ocr
    applies_to: ["1.1"]
```

```yaml
# s1/answers.md
decision:
  ocr: tesseract-js
```

- 실행 중에는 `policy.yaml`을 수정하지 않는다.
- 여러 실행에서 계속 쓸 결정이면, 그 실행이 끝난 뒤 사용자가 `policy.yaml`에 `confirmed` 값으로 따로 올린다.

**R6-7 보완:** 현재 기능에 필요한 `required_technical_decisions` 중 현재 실행의 `answers.md`에 결정값이 없는 항목이 있으면 S4를 시작하지 않는다.
판정: required decision 수 = `answers.md`에서 resolved된 decision 수

## 4. 하네스 자체 검증 (self-test)

첫 실행 전에 하네스가 규칙대로 동작하는지 fixture로 검사한다.
위치: `harness/tests/fixtures/<시나리오>/` (가짜 run 폴더)

| # | 시나리오 | 기대 결과 | 검사 규칙 |
|---|---|---|---|
| T1 | `story:` 없는 요구사항 1개 | G1 block, measure에 해당 ID | G1-1, R5-5 |
| T2 | `spec.md`에 `F-n` 없음 | schema 실패 → G2 block | R5-10, R5-11 |
| T3 | 보관 안내 문구에 "실제 제품 표시를 우선 확인" | C-1 후보 탐지 O, **block 아님** | R5-6 |
| T4 | 화면 문구 "이 식재료는 먹어도 됩니다" | C-1 block + evidence | C-1, R5-4 |
| T5 | 코드 변수명 `isGood` | C-1 block 아님 | R5-6 |
| T6 | `app/`에 허용 목록 밖 `fetch("https://shop…")` | C-2b block | C-2b |
| T7 | manifest에 토큰 밖 색 `#FF0000` | G3-3 block | G3-3 |
| T8 | provisional 토큰 3개 사용, WARN 2개 보고 | P-1 block | R5-8 |
| T9 | 1.1 실행에서 G2-4 | `n/a` + reason + P-2 WARN | R5-7, R5-9 |
| T10 | 에이전트가 scope 밖 `Docs/prd.md` 수정 | block + 파일 목록, restore 없음 | R6-1, R7-4 |
| T11 | G2 pass 뒤 `s2/spec.md` 1바이트 변경, 파일 1개 추가 | immutable 위반 2건 | R7-8 |
| T12 | S3 retry 3회 초과 | `paused`, `waiting_for: escalation` | R3-5 |
| T13 | 전체 retry 7회째 | escalation | R3-11 |
| T14 | escalation ① 후 다시 block | `aborted` | R3-13 |
| T15 | `paused` 중 `prd.md` hash 변경 후 재개 | revision +1, S1부터 | R4-8 |
| T16 | `RUN-001 paused` 상태에서 `start_run` | preflight 실패 | R7-1 |
| T17 | `waiting_for: final_approval`에서 "좋아" | `completed` 아님 | R6-6 |
| T18 | 1.1 실행, `answers.md`에 `decision.ocr` 없음 + S4 진입 | S4 시작 안 함 | R6-7 (3장 보완) |

- script 판정 규칙은 fixture 테스트로 자동 검사한다.
- llm-judge 조건(T3, T4 등)은 golden 예시로 검사한다. 기대 `result`와 일치하는지 검사하고, 다르면 self-test 실패로 기록한다. 반복 판정의 동일성은 요구하지 않는다.

## 5. 구축 순서

| 순서 | 만드는 것 | 위치 |
|---|---|---|
| 1 | config 3개 (`default-design.md` 값 옮기기, provisional 유지) | `harness/config/` |
| 2 | 판정·schema·scope·checkpoint 스크립트 | `harness/scripts/` |
| 3 | 에이전트 5개 | `.claude/agents/` |
| 4 | `PreToolUse` hook | `.claude/settings.json` |
| 5 | `CLAUDE.md` | 저장소 루트 |
| 6 | self-test T1~T18 | `harness/tests/` |
| 7 | 첫 실행 준비 (7장) → `start_run 1.1` | – |

## 6. 규칙

| ID | 규칙 | 판정 |
|---|---|---|
| R8-1 | 요청서 원본은 `harness/requests/`에 두고, 실행 시 복사한다. | `start_run` 후 `runs/<id>/request.md`와 원본의 SHA-256 일치 |
| R8-2 | manifest `source`는 로컬 파일이다. | 존재하지 않는 로컬 경로 또는 URL인 `source` 수 = 0 |
| R8-3 | 판정 증거와 scope snapshot은 `gates/evidence/`, `gates/scope/`에만 둔다. | 두 경로 밖에 저장된 증거·snapshot 수 = 0 |
| R8-4 | baseline에 config 3개 hash를 포함한다. | `baseline` config hash 기록 수 = 3 |
| R8-5 | self-test T1~T18이 모두 통과해야 첫 실행을 시작한다. | 실패한 self-test 수 = 0 |
| R8-6 | llm-judge golden 예시는 기대 `result`와 일치한다. | 기대 `result`와 다른 golden 예시 수 = 0 |
| R8-7 | 실행 중 기술 결정은 `answers.md`에 기록하고 `policy.yaml`은 수정하지 않는다. | 실행 중 변경된 `policy.yaml` 수 = 0 |

## 7. 첫 실행 전 사용자 작업

- [ ] `Docs/prd.md`, `Docs/story-service.md`, `Docs/design.md` 맨 위에 `status: confirmed` frontmatter 추가
- [ ] 세 파일 커밋 (현재 `design.md` 변경 미커밋)
- [ ] `harness/requests/1.1.md` 작성
