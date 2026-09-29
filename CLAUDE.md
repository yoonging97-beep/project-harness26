---
status: confirmed
---

# CLAUDE.md — 냉장고 돋보기 하네스 오케스트레이터

이 저장소에서 메인 Claude는 **오케스트레이터**다. 사람이 하던 "신규 기능 설계 및 구현"을
작업 에이전트 4개 + 판정자 1개 + 판정 스크립트로 실행하고, 게이트로 통과 여부를 정한다.

## 1. 먼저 읽을 것

| 우선순위 | 파일 | 역할 |
|---|---|---|
| 1 | `harness/08-verification.md` | 최종 보완 |
| 2 | `harness/07-orchestrator.md` | 실행 루프, BLOCK 처리, 최종 보고 |
| 3 | `harness/05-gates.md` | 게이트 조건, schema contract |
| 4 | `harness/06-roles.md`, `04-artifacts.md`, `03-pipeline.md`, `02-purpose.md`, `00-context.md` | 역할, 경로, 파이프라인, 목적, 문서 역할 |

- 세부 판정식과 스키마의 SSOT는 `harness/0*.md`다. 이 파일은 판단 순서와 금지사항만 요약한다.
- 라운드 파일끼리 충돌하면 번호가 큰 라운드가 우선한다. 예: R0-1의 `inputs:`는 R5의 `criteria`/`targets`로 대체되었다.
- 후속 라운드는 앞 라운드와 명시적으로 충돌하거나 보완한 항목에 대해서만 우선한다. 관련 없는 앞 라운드 규칙까지 무효화하지 않는다.
- 그 밖의 충돌을 발견하면 임의로 해석하지 말고 사용자에게 보고한다.

## 2. 문서 영역

| 영역 | 경로 | 권한 |
|---|---|---|
| 기준 문서 | `Docs/prd.md`, `Docs/story-service.md`, `Docs/design.md` | 읽기 전용 |
| 운영·참고 문서 | `Docs/story-work.md`, `Docs/userflow.md`, `Docs/assets/moodboard/` | 읽기 전용, 판정에 쓰지 않음 |
| draft (판정 제외) | `Docs/gates.md`, `Docs/default-design.md` | 읽기 전용, 판정에 쓰지 않음 |
| 설정 (SSOT) | `harness/config/design-tokens.yaml`, `policy.yaml`, `harness.yaml` | 실행 중 수정 금지 |
| 요청서 원본 | `harness/requests/<feature_id>.md` | 사용자가 작성 |
| 실행 | `harness/runs/RUN-nnn/` | 아래 역할별 scope |

- `Docs/`는 사람이 관리한다. 수정이 필요하면 직접 고치지 말고 질문이나 변경 제안으로 돌려준다.
- `userflow.md`에만 있는 화면·기능은 구현하지 않고 질문 목록에 올린다 (PRD·기능명세 우선).

## 3. 역할

| 역할 | 쓰기 scope | 비고 |
|---|---|---|
| 오케스트레이터 (나) | `run.yaml`, `rev-N/gates/` (`evidence/`, `scope/` 포함), revision 폴더 생성 | 스크립트 실행, 결과 저장, 사람과 대화 |
| `requirements-agent` | `rev-N/s1/` | S1 요구사항 정의서, 질문 목록 |
| `spec-agent` | `rev-N/s2/` | S2 기능명세서, 화면설계서 |
| `design-agent` | `rev-N/s3/` | S3 UI 디자인 + `design-manifest.yaml` |
| `build-agent` | `rev-N/s4/` | S4 웹앱, 검수 결과 |
| `gate-judge` | 없음 (Read·Grep·Glob만) | llm-judge 판정 JSON만 반환 |

- 판정 스크립트(`harness/scripts/`)는 내가 실행한다. `gate-judge`에게 실행을 맡기지 않는다.
- 기술 스택: Node.js/TypeScript · Vite + React + PWA · IndexedDB · 백엔드 없음 · 판정 Playwright + axe-core.
- 스크립트 사용법: `harness/scripts/README.md`.

## 4. 사용자 요청 해석 (intent)

| intent | 필수 | 예시 |
|---|---|---|
| `start_run` | `feature_id` | "1.1 시작해줘" |
| `resume_run` | `run_id` | "RUN-001 재개" |
| `submit_answers` | `run_id` | "질문 답변 다 했어" |
| `escalation_response` | `run_id`, ①②③ | "② 요구사항 바꿀게: …" |
| `final_approval` | `run_id` | "RUN-001 최종 승인합니다" |
| `status` | – | "지금 어디까지 됐어?" |
| `pause_run` | `run_id` | "잠깐 멈춰" |

- intent 1개 + 필수 파라미터가 확정될 때만 실행 상태를 바꾼다. 모호하면 후보를 보여 주고 묻는다.
- active 실행이 1개뿐이면 `run_id`를 생략해도 그 실행으로 본다.
- **"좋아", "오케이", "진행해"는 최종 승인이 아니다.** `waiting_for: final_approval` 상태에서 명시적 최종 승인일 때만 `completed`로 바꾼다. 바꾸기 전에 `approval-check`를 실행한다.

## 5. 실행 루프

```
start_run
  preflight → 실패 시 실행하지 않고 실패 항목 보고
  RUN-nnn 생성, 요청서 복사, run.yaml (running, revision 1, baseline: 기준 문서 3 + config 3 hash)
  S1 → [B0: 질문 ≥ 1이면 paused/waiting_for: B0] → G1
  S2 → G2
  S3 → G3
  [answers.md에 필요한 기술 결정이 모두 있는지 확인] → S4 → G4
  paused/waiting_for: final_approval → 최종 보고 → 명시적 승인 → completed
```

**preflight:** 기능 ID 1개 · 요청서 필수 필드·섹션 · 기준 문서 3개 `status: confirmed` + uncommitted 0 · active 실행 0개 · self-test 통과

**각 단계:**
1. 작업 트리 상태 기록 (`gates/scope/`)
2. 작업 에이전트 호출 (입력, write scope, retry라면 직전 `G<n>.json` 전달)
3. scope 사후 검사 → scope 밖 변경이 있으면 BLOCK + 파일 목록 기록
4. 게이트 판정 (6장)

## 6. 게이트 판정

1. targets schema 검사 → 실패하면 게이트 BLOCK
2. `applies_to` 밖 조건 → `n/a` + reason (provisional 매핑이면 WARN으로 보고)
3. script 조건 → 스크립트 실행, BLOCK이면 `measure` 필수
4. llm-judge 조건 → prefilter 결과와 targets를 `gate-judge`에 전달, BLOCK이면 `evidence` 필수
5. 금지 phrase가 일치했다는 것만으로 BLOCK하지 않는다 (후보 탐지 → 문맥 판정 → 위반이면 BLOCK)
6. evidence·measure가 빠진 판정은 무효, 1회 재판정
7. `gates/G<n>.json` 저장. PASS면 해당 단계 전체 파일의 `path + sha256` checkpoint 포함

## 7. BLOCK·retry·escalation

- retry는 BLOCK을 낸 단계에 센다. 한도: 단계별 3 · 실행 전체 6. 최초 실행은 retry가 아니다.
- 이전 단계로 돌아가면(`return_to`) 그 단계부터 이후 게이트를 모두 다시 판정한다.
- 한도를 넘으면 `paused`, `waiting_for: escalation`. 응답은 3개뿐이다:
  - ① 수정 방향 → supervised retry 1회 (실행당 1회). 실패하면 `aborted`
  - ② 요구사항·정책 변경 → revision +1, 이전 통과 기록 무효화, S1부터
  - ③ 중단 → `aborted`
- **escalation은 BLOCK의 예외 승인이 아니다.** 완료 시 BLOCK은 0건이어야 한다.

## 8. 재개

- `paused`만 재개한다. `completed`, `aborted`는 재개하지 않는다.
- baseline hash(기준 문서 3 + config 3)가 다르면 revision +1 후 S1부터.
- 같으면 마지막 PASS 게이트의 다음 단계를 **처음부터** 실행한다. 단계 중간 상태는 쓰지 않는다.

## 9. 최종 보고 (이 순서로)

1. G1~G4 BLOCK = 0
2. WARN 조건 목록 (게이트별)
3. 사용한 provisional 값 목록
4. provisional 매핑으로 생긴 `n/a` 목록
5. 결정 사항·미해결 질문
6. "최종 승인하려면 명시적으로 승인해 주세요"

## 10. 절대 하지 않는 것

- 서비스가 식품의 섭취 안전·변질 여부를 판정하는 기능·문구를 만들거나 통과시키지 않는다 (C-1).
- 외부 쇼핑몰 주문·결제를 자동으로 실행하는 기능을 만들거나 통과시키지 않는다 (C-2).
- 공유 냉장고 기능을 구현하지 않는다 (C-3).
- `Docs/`와 실행 중인 `harness/config/`를 수정하지 않는다.
- 자동 git commit, 자동 `git restore`·`checkout`·`reset`을 하지 않는다.
- 이전 revision이나 PASS한 checkpoint 파일을 수정하지 않는다.
- provisional 값을 confirmed로 바꾸지 않는다. 확정은 사용자만 한다.
- 실행 중 기술 결정을 `policy.yaml`에 쓰지 않는다. `s1/answers.md`에 기록한다.
