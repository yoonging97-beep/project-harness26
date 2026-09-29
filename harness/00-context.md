---
round: R0
status: confirmed
title: 준비물 확인 (컨텍스트 문서)
---

# R0 — 컨텍스트 문서

## 1. 도구와 위치

| 항목 | 값 |
|---|---|
| 하네스 도구 | Claude Code |
| 에이전트 정의 | `.claude/agents/` |
| 하네스 스크립트·라운드 산출물 | `harness/` |
| 사람이 관리하는 원본 | `Docs/` |

## 2. 문서 역할

| 역할 | 파일 | 게이트 판정에 사용 |
|---|---|---|
| 기준 문서 | `Docs/prd.md`, `Docs/story-service.md`, `Docs/design.md` | ✅ |
| 운영 문서 | `Docs/story-work.md` (작업 흐름, 게이트 순서) | ❌ 순서만 정의 |
| 참고 문서 | `Docs/userflow.md`, `Docs/assets/moodboard/*` | ❌ |
| 입력 자료 (R0 컨텍스트상 draft) | `Docs/gates.md` → R5, `Docs/default-design.md` → R4 | ❌ 확정 전까지 |

- 게이트마다 읽는 기준 문서가 다를 수 있다. 게이트별 `inputs:`는 R5에서 정한다.
- `story-service.md`(무엇을 만드는가)는 판정 기준이고, `story-work.md`(어떻게 만드는가)의 재료가 아니다. 두 문서를 섞지 않는다.

### draft 지정 문서

아래 문서는 이 파일에서만 draft로 선언한다. 실제 파일의 frontmatter는 바꾸지 않는다.
R4/R5에서 확정할 때 해당 문서에 상태를 정식 반영한다.

| 파일 | 상태 | 확정 라운드 |
|---|---|---|
| `Docs/gates.md` | draft | R5 |
| `Docs/default-design.md` | draft | R4 |

## 3. 규칙 (스크립트가 셀 수 있는 형태)

| ID | 규칙 | 판정 |
|---|---|---|
| R0-1 | 각 게이트는 판정에 사용할 파일을 `inputs:`로 명시한다. `inputs:`에는 R0에서 허용된 기준 문서만 지정할 수 있다. | 허용 기준 문서 외 `inputs` 수 = 0 |
| R0-2 | `00-context.md`에서 draft로 지정되었거나 파일 자체가 `status: draft`인 문서는 게이트 판정에 사용하지 않는다. | 판정 입력 중 draft 지정 파일 수 = 0 |
| R0-3 | 충돌 시 우선순위는 PRD·기능명세 > userflow. | – |
| R0-4 | userflow에만 있는 화면·기능은 구현하지 않고 질문 목록에 올린다. | 기능명세에 없는데 구현된 화면 수 = 0 |
| R0-5 | 하네스 에이전트는 `Docs/`에 쓰지 않는다. 수정이 필요하면 질문 또는 변경 제안으로 반환한다. | `Docs/` 아래 에이전트가 변경한 파일 수 = 0 |
| R0-6 | 하네스 파일은 `harness/`, `.claude/agents/` 아래에만 만든다. | 두 경로 밖에 새로 생긴 하네스 파일 수 = 0 |

`inputs:` 선언 예시 (R5에서 확정):

```yaml
gate: G1
inputs:
  - Docs/prd.md
  - Docs/story-service.md
```

## 4. 현재 충돌·보류 항목

| # | 항목 | 출처 | 처리 |
|---|---|---|---|
| Q-01 | 온보딩 화면 | userflow s1 | 질문 목록 (보류) |
| Q-02 | 로그인 화면 | userflow s1 | 질문 목록 (보류) |
| Q-03 | 회원가입 화면 | userflow s1 | 질문 목록 (보류) |
| X-01 | 공유 냉장고 관리 화면 | userflow s7 | 범위 제외 (C-3) |

## 5. 다음 라운드로 넘기는 것

- R4: `default-design.md` (draft) → SSOT 확정
- R5: `gates.md` (draft) → 게이트 확정, 게이트별 `inputs:` 선언
- 질문 목록 Q-01~03 → R3 파이프라인의 B0 입력
