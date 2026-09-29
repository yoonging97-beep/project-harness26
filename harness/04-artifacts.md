---
round: R4
status: confirmed
title: 산출물
---

# R4 — 산출물

## 1. 실행별 폴더 구조

`request.md`, `run.yaml`은 실행 전체에 속하고, 나머지는 revision 단위로 나눈다.

```
harness/runs/RUN-001/
├── request.md
├── run.yaml
├── rev-1/
│   ├── s1/  requirements.md, questions.md, answers.md
│   ├── s2/  spec.md, screens.md
│   ├── s3/  design-manifest.yaml, screens/, review.md
│   ├── s4/  app/, qa.md
│   └── gates/  G1.json, G2.json, G3.json, G4.json
└── rev-2/
    └── ...
```

| 단계 | 산출물 (R3 논리 이름 → 파일) |
|---|---|
| S1 | 요구사항 정의서 → `requirements.md`, 질문 목록 → `questions.md`, B0 답변 → `answers.md` |
| S2 | 기능명세서 → `spec.md`, 화면설계서 → `screens.md` (화면 ID 목록 포함) |
| S3 | UI 디자인 → `screens/`, design-manifest → `design-manifest.yaml`, 디자인 검토 결과 → `review.md` |
| S4 | 웹앱 → `app/`, 검수 결과 → `qa.md` |
| 게이트 | 판정 결과 → `gates/G<n>.json` |

- 이전 revision은 immutable이다.
- 디자인 도구는 고정하지 않는다. Figma 링크나 이미지 같은 원본은 `screens/`에 두고 `design-manifest.yaml`이 참조한다.

## 2. 설정 파일 (SSOT)

SSOT는 "파일 1개"가 아니라 **값마다 권위 있는 출처가 1개**라는 뜻이다.

```
harness/config/
├── design-tokens.yaml
├── policy.yaml
└── harness.yaml
```

| 파일 | 관리하는 값 | 메타데이터 |
|---|---|---|
| `design-tokens.yaml` | color, typography, radius, spacing, shadow, motion 등 디자인 토큰 | 적용 |
| `policy.yaml` | 서비스 정책 상수 (임박 기준 3일 등) | 적용 |
| `harness.yaml` | 기준 문서 목록, draft 지정 문서, retry 한도 3/6, 경로, 실행 규칙 | 적용하지 않음 |

- `Docs/default-design.md`는 사람이 읽는 설명 문서로 남긴다. 실행에 쓰는 디자인 값의 SSOT는 `design-tokens.yaml`이다.
- `Docs/gates.md`의 판정 규칙은 R5에서 다룬다.

### 값 기록 형식 (`design-tokens.yaml`, `policy.yaml`)

추적 대상 leaf value는 `value`, `status`, `origin`을 함께 가진다.

```yaml
radius:
  card:
    value: 20px
    status: provisional     # confirmed | provisional
    origin: claude-default  # 값의 출처
```

| 필드 | 값 |
|---|---|
| `status` | `confirmed` 확정값 / `provisional` 임시값 |
| `origin` | `prd`, `design`, `user`, `claude-default` 등 출처 |

- 원본 값을 옮길 때 임의로 바꾸거나 확정하지 않는다. `default-design.md`의 🟠 임의값은 같은 값으로 옮기고 `status: provisional`, `origin: claude-default`로 기록한다.
- 게이트별로 provisional 값을 허용할지는 R5에서 정한다.

`harness.yaml`은 단순 설정 구조로 쓴다.

```yaml
retry:
  stage: 3
  total: 6
```

## 3. 실행 상태와 재개

| 상태 | 재개 | 의미 |
|---|---|---|
| `running` | – | 진행 중 |
| `paused` | ✅ | 멈춤. `waiting_for`로 이유를 구분한다 |
| `completed` | ❌ terminal | R2 완료 기준 충족 |
| `aborted` | ❌ terminal | escalation ③ 또는 supervised retry 실패 |

### 사람 입력 대기

별도 `waiting` 상태를 두지 않고 `paused` + `waiting_for`로 기록한다.

| `waiting_for` | 의미 |
|---|---|
| `B0` | 질문 목록 답변 대기 |
| `escalation` | escalation 응답 대기 |
| `final_approval` | 최종 승인 대기 |
| `null` | 사용자가 직접 멈춤 |

- 사람의 입력이 들어오면 `waiting_for: null`, `status: running`으로 돌아간다.

### checkpoint

- checkpoint = 현재 revision에서 마지막으로 PASS한 게이트.
- 단계 중간 진행 상태는 checkpoint로 인정하지 않는다. 부분 생성된 산출물을 정상 산출물로 오인하지 않기 위해서다.

| 마지막 PASS | 재개 시작점 |
|---|---|
| 없음 | S1 처음부터 |
| G1 | S2 처음부터 |
| G2 | S3 처음부터 |
| G3 | S4 처음부터 |

### 재개 절차

1. `status: paused`인지 확인한다. `completed`, `aborted`는 재개하지 않는다.
2. `run.yaml`의 `baseline` hash와 현재 기준 문서 hash를 비교한다.
3. 같으면 checkpoint 다음 단계를 처음부터 실행한다.
4. 다르면 바로 이어 가지 않고 escalation ②처럼 revision +1 → S1부터 다시 진행한다.

### run.yaml 최소 항목

```yaml
run_id: RUN-001          # 하네스가 실행 생성 시 부여
status: running          # running | paused | completed | aborted
waiting_for: null        # B0 | escalation | final_approval | null
revision: 1
current_stage: S1
retry:
  stage: { S1: 0, S2: 0, S3: 0, S4: 0 }
  total: 0
supervised_retry: 0
gate_results:
  G1: null               # pass | block | null(미판정)
  G2: null
  G3: null
  G4: null
baseline:
  prd: <commit hash>
  story_service: <commit hash>
  design: <commit hash>
```

## 4. 업무 요청서 (`request.md`)

`run_id`는 사람이 쓰지 않는다. 하네스가 만들어서 `run.yaml`에 기록한다.

```markdown
---
feature_id: "1.1"
requested_at: "2026-09-29"
---

## 배경

## 요구사항

## 제약

## 범위 밖
```

- 네 섹션은 모두 있어야 한다. `제약`과 `범위 밖`은 내용이 없어도 된다(`없음` 허용).

## 5. 기준 문서 메타데이터

- 사용자가 `prd.md`, `story-service.md`, `design.md`를 확정할 때 직접 frontmatter에 `status: confirmed`를 넣는다.
- 에이전트는 넣지 않는다 (R0-5). R4에서는 규칙만 정하고 지금 `Docs/` 파일은 수정하지 않는다.
- 첫 실행 preflight가 검사한다 (R4-11).

## 6. 규칙 (스크립트가 셀 수 있는 형태)

| ID | 규칙 | 판정 |
|---|---|---|
| R4-1 | 산출물은 1장의 정해진 경로에만 만든다. | 정해진 경로 밖 산출물 수 = 0 |
| R4-2 | 이전 revision은 immutable이다. | 현재 revision보다 작은 revision의 파일 수정 수 = 0 |
| R4-3 | 값마다 정의 위치는 1곳이다. | config 3개 파일 사이 중복 키 수 = 0 |
| R4-4 | 판정 스크립트는 규칙 값을 config에서만 읽는다. | 스크립트 안 하드코딩된 규칙 값 수 = 0 |
| R4-5 | `design-tokens.yaml`과 `policy.yaml`의 leaf value는 `value`, `status`, `origin`을 가진다. `harness.yaml`의 하네스 운영 설정은 제외한다. | 메타데이터 대상 leaf 중 세 필드 누락 수 = 0 |
| R4-6 | 🟠 임의값은 provisional로 기록한다. | `origin: claude-default` AND `status: confirmed`인 값 수 = 0 |
| R4-7 | `completed`, `aborted` 실행은 재개하지 않는다. | terminal 상태에서 재개된 수 = 0 |
| R4-8 | 재개 시 baseline hash가 다르면 revision +1 후 S1부터 진행한다. | hash 불일치 상태에서 이어진 재개 수 = 0 |
| R4-9 | `run_id`는 하네스가 부여한다. | `request.md`의 `run_id` 필드 수 = 0 |
| R4-10 | `request.md`는 실행 시작 조건을 만족한다. | `feature_id` = 1 AND `requested_at` = 1 AND 필수 섹션 누락 수 = 0 |
| R4-11 | 첫 실행 preflight는 기준 문서를 검사한다. | `status: confirmed` 기준 문서 수 = 3 AND commit hash 기록 수 = 3 AND uncommitted changes 수 = 0 |
| R4-12 | `waiting_for`는 허용값만 쓴다. | `B0`, `escalation`, `final_approval`, `null` 외 값 수 = 0 |
| R4-13 | `waiting_for`가 null이 아니면 `status`는 `paused`다. | `waiting_for` ≠ null AND `status` ≠ `paused`인 수 = 0 |
| R4-14 | 재개는 checkpoint 다음 단계의 시작점에서만 한다. | 단계 중간에서 이어진 재개 수 = 0 |
