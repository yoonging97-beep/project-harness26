---
round: R6
status: confirmed
title: 역할
---

# R6 — 역할

## 1. 구성

| 역할 | 종류 | 하는 일 | 쓰기 |
|---|---|---|---|
| 오케스트레이터 | 메인 Claude (CLAUDE.md) | 실행 생성·상태 변경, 에이전트 호출, 판정 스크립트 실행, 결과 저장, 사람과 대화 | `run.yaml`, `rev-N/gates/`, revision 폴더 생성 |
| `requirements-agent` | 작업 에이전트 | S1 | `rev-N/s1/` |
| `spec-agent` | 작업 에이전트 | S2 | `rev-N/s2/` |
| `design-agent` | 작업 에이전트 | S3 | `rev-N/s3/` |
| `build-agent` | 작업 에이전트 | S4 | `rev-N/s4/` |
| `gate-judge` | 판정 에이전트 | G1~G4의 llm-judge 조건 판정 | 없음 |
| gate scripts | `harness/scripts/` | G1~G4의 script 조건 측정, schema 검사 | 판정 결과를 표준 출력으로 반환 |

## 2. 작업 에이전트 — write scope

- 에이전트마다 write scope는 1개다. scope 아래 하위 경로(예: `s3/screens/`)는 scope에 포함된다.
- 그 외는 모두 read-only다: `Docs/`, `harness/config/`, 다른 단계 산출물, `run.yaml`, `gates/`.
- 이전 revision은 immutable이다 (R4-2).

| 에이전트 | write scope | 주로 읽는 것 |
|---|---|---|
| `requirements-agent` | `runs/<id>/rev-N/s1/` | `request.md`, `prd`, `svc`, `userflow`(참고), `policy.yaml` |
| `spec-agent` | `runs/<id>/rev-N/s2/` | `s1/*`, `prd`, `svc`, `dsn`, `policy.yaml` |
| `design-agent` | `runs/<id>/rev-N/s3/` | `s2/screens.md`, `dsn`, `design-tokens.yaml`, 무드보드(참고) |
| `build-agent` | `runs/<id>/rev-N/s4/` | `s2/spec.md`, `s3/*`, `design-tokens.yaml`, `policy.yaml` |

- 작업 에이전트는 자기 단계의 게이트 결과(`gates/G<n>.json`)를 읽고 retry 시 수정 근거로 쓴다.

### write scope 강제 — 사후 검사

에이전트 정의의 도구 목록만으로는 Write·Edit를 경로별로 제한할 수 없으므로, 실행 전후 비교로 강제한다.

1. 에이전트 호출 전에 오케스트레이터가 작업 트리 상태(`git status`/`git diff`)를 기록한다.
2. 호출 후 다시 비교해 새로 생긴 변경 중 write scope 밖 파일을 찾는다.
3. scope 밖 변경이 있으면 해당 단계를 **BLOCK**하고 변경 파일 목록을 기록한다.

- 자동 `git restore`는 하지 않는다. 실행 전부터 있던 사용자 변경까지 되돌릴 위험이 있다.
- 안전한 rollback·사전 차단 hook은 R7에서 정한다.

## 3. 판정 — 역할 분리

```
오케스트레이터 ─ 실행 ─→ gate scripts ─→ script 조건 측정값
       │
       └─ 호출 ─→ gate-judge ─→ llm-judge 판정 JSON 반환
       │
       └─ 저장 ─→ gates/G<n>.json, run.yaml
```

| 역할 | 권한 |
|---|---|
| `gate-judge` | **Read, Grep, Glob만.** Write·Edit·Bash 없음. `05-gates.md` 기준으로 판정 결과만 반환 |
| gate scripts | `harness/scripts/`의 허용된 판정 명령만. 오케스트레이터가 실행한다 |
| 오케스트레이터 | 판정 스크립트 실행, 필요한 측정값을 `gate-judge`에 전달, `gates/G<n>.json` 저장, `run.yaml` 변경 |

- `gate-judge` 1개가 G1~G4를 모두 판정한다. 판정 기준은 `05-gates.md`가 정하므로 게이트별 에이전트를 두지 않는다.

## 4. 자연어 트리거 (intent)

정확한 문구가 아니라 intent로 정의한다.

| intent | 필수 파라미터 | 동작 | 예시 |
|---|---|---|---|
| `start_run` | `feature_id` | preflight → `RUN-nnn` 생성 → S1 | "새 실행 시작 1.1", "1.1 시작해줘", "식재료 빠른 등록 작업 시작" |
| `resume_run` | `run_id` | R4 재개 절차 | "RUN-001 재개", "아까 하던 거 이어서" (진행 중 실행이 1개일 때만) |
| `submit_answers` | `run_id` | `answers.md` 확인 → `waiting_for: null` → G1 | "질문 답변 다 했어", "B0 완료" |
| `escalation_response` | `run_id`, `choice` (①②③), ①②일 때 내용 | R3 escalation 처리 | "② 요구사항 바꿀게: …", "중단해" |
| `final_approval` | `run_id` | WARN 보고 확인 → `completed` | "RUN-001 최종 승인합니다" |
| `status` | (`run_id`) | `run.yaml` 요약 | "지금 어디까지 됐어?" |
| `pause_run` | `run_id` | `paused`, `waiting_for: null` | "잠깐 멈춰" |

### intent 규칙

- intent 1개와 필수 파라미터가 모두 확정되면 실행한다.
- intent가 2개 이상으로 해석되거나 필수 파라미터가 없으면 실행하지 않고 후보나 누락값을 묻는다.
- 진행 중인 실행이 1개뿐이면 `run_id`를 생략해도 그 실행으로 본다.
- **`final_approval`은 명시적인 최종 승인 의도가 있을 때만 인정한다.** "좋아", "오케이", "진행해"는 최종 승인이 아니다.

## 5. 기술 스택

| 구분 | 값 | 상태 |
|---|---|---|
| 런타임 | Node.js, TypeScript | 확정 |
| 판정 | Playwright, axe-core | 확정 |
| 웹앱 | Vite, React, TypeScript, PWA | 확정 |
| 데이터 저장 | IndexedDB | 확정 (현재 범위) |
| 백엔드 | 없음 | 확정 (현재 범위) |

### 기능별 기술 결정 (`required_technical_decisions`)

> R8(F8)에서 보완: 필요한 결정 목록은 `policy.yaml`, 실행에서 선택한 값은 `s1/answers.md`에 둔다. 실행 중 `policy.yaml`은 수정하지 않는다.

```yaml
# policy.yaml — 어떤 기술 결정이 필요한가
required_technical_decisions:
  - id: ocr
    applies_to: ["1.1"]
```

```yaml
# rev-N/s1/answers.md — 이번 실행에서 선택한 값
decision:
  ocr: tesseract-js
```

- 1.1의 필수 기술 결정은 OCR이다. 첫 실행의 S1/B0에서 정한다.
- 여러 실행에서 계속 쓸 결정이면 실행이 끝난 뒤 사용자가 `policy.yaml`에 `confirmed` 값으로 올린다.
- 외부 OCR을 선택하면 `policy.yaml`의 허용 도메인에 명시적으로 등록해야 하고 C-2b를 통과해야 한다.
- C-2b는 외부 쇼핑몰 주문·결제와 허용되지 않은 외부 도메인을 막는 정책이다. 모든 외부 API를 금지하는 정책으로 넓히지 않는다.
- 이후 다른 기능의 지도 API, 인증 방식 같은 미결 결정도 같은 방식으로 관리한다.

## 6. 규칙 (스크립트가 셀 수 있는 형태)

| ID | 규칙 | 판정 |
|---|---|---|
| R6-1 | 작업 에이전트는 자기 write scope 밖을 수정하지 않는다. 위반 시 BLOCK하고 변경 파일을 기록한다. 자동 restore하지 않는다. | 에이전트 실행 전후 diff에서 write scope 밖 수정 파일 수 = 0 |
| R6-2 | `run.yaml`, `gates/`는 오케스트레이터만 수정한다. | 작업 에이전트·`gate-judge`가 수정한 두 경로 파일 수 = 0 |
| R6-3 | `gate-judge` 도구는 Read·Grep·Glob만이다. | `gate-judge` 정의에서 세 도구 외 도구 수 = 0 |
| R6-4 | 판정 스크립트는 `harness/scripts/` 아래 허용 목록만, 오케스트레이터가 실행한다. | 허용 목록 밖 판정 명령 실행 수 = 0 |
| R6-5 | 모호한 intent로는 실행 상태를 바꾸지 않는다. | intent 후보 ≥ 2 또는 필수 파라미터 누락 상태에서 바뀐 `run.yaml` 수 = 0 |
| R6-6 | 최종 승인은 명시적 의도와 대기 상태가 있을 때만 받는다. | `waiting_for ≠ final_approval` 상태에서 `completed`로 바뀐 수 = 0 |
| R6-7 | 현재 기능에 필요한 `required_technical_decisions` 중 현재 실행의 `answers.md`에 결정값이 없는 항목이 있으면 S4를 시작하지 않는다. (R8 보완) | required decision 수 = `answers.md`에서 resolved된 decision 수 |
