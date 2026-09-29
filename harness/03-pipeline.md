---
round: R3
status: confirmed
title: 파이프라인
---

# R3 — 파이프라인

## 1. 단계 구성

4단계로 나누고, 각 단계는 게이트 1개로 끝난다. 단계 사이에 책임을 겹치지 않는다.

| 단계 | 역할 | 주요 산출물 | 게이트 |
|---|---|---|---|
| S1 요구사항 | 요구사항·정책 확정, 미확정 사항 질문 | 요구사항 정의서, 질문 목록 | G1 |
| S2 명세·설계 | 확정된 요구사항을 기능·화면으로 구체화 | 기능명세서, 화면설계서 | G2 |
| S3 디자인 | 화면설계서를 UI로 변환·수정 | UI 디자인 + design-manifest, 디자인 검토 결과 | G3 |
| S4 구현 | 확정 UI 구현·검수·수정 | 웹앱, 검수 결과 | G4 |

```
request ─→ S1 ─→ G1 ─→ S2 ─→ G2 ─→ S3 ─→ G3 ─→ S4 ─→ G4 ─→ 최종 승인 ─→ completed
            ↑ B0 (질문 ≥ 1)
```

## 2. 단계별 입출력

파일명과 경로는 R4에서 확정한다. 여기서는 논리 이름만 정한다.

| 단계 | 입력 | 출력 |
|---|---|---|
| S1 | 업무 요청서, 기능 ID, 기준 문서 (`prd`, `story-service`), 참고 문서 (`userflow`) | 요구사항 정의서, 질문 목록, (B0 후) 답변 |
| S2 | 요구사항 정의서, B0 답변 | 기능명세서, 화면설계서 (화면 ID 포함) |
| S3 | 화면설계서, 기준 문서 (`design`), SSOT 토큰 | UI 디자인, design-manifest, 디자인 검토 결과 |
| S4 | 기능명세서, 확정 UI 디자인, design-manifest | 웹앱, 검수 결과 |

### S3 산출물 세트

UI 디자인은 특정 도구나 형식에 묶지 않는다. 디자인 결과와 판정용 manifest를 한 세트로 관리한다.

```
design/
├── design-manifest.yaml
├── screens/
└── review.md
```

```yaml
# design-manifest.yaml 최소 항목
screens:
  - id: ingredient-create     # 화면설계서의 화면 ID와 같아야 한다
    source: <디자인 결과 참조>
tokens:
  color: [primary, surface]
  radius: [card, button]
  typography: [heading, body]
```

- G3는 두 가지를 기계적으로 검사한다: 화면설계서 화면 ID ↔ manifest 화면 ID, SSOT 토큰 ↔ manifest 토큰.
- 디자인 도구와 산출물 상세 형식은 R4/R5에서 확정한다.

## 3. 실패와 복귀

| 항목 | 규칙 |
|---|---|
| 기본 복귀 | 게이트 BLOCK이 나면 현재 단계로 돌아간다. |
| 이전 단계 복귀 | 판정 결과가 이전 단계 산출물의 결함을 가리키면 `return_to: S<n>`으로 그 단계로 돌아간다. |
| 재판정 범위 | 이전 단계로 돌아가면 그 단계부터 이후 게이트를 모두 다시 판정한다. 이전 통과 기록은 재사용하지 않는다. |
| retry 계산 | 최초 실행은 retry가 아니다. BLOCK 후 수정 → 재판정 1회 = 일반 retry 1회. |
| retry 귀속 | retry는 BLOCK을 발생시킨 게이트의 단계에 귀속한다. `return_to` 대상 단계의 retry는 그 단계의 게이트가 BLOCK을 내지 않는 한 늘지 않는다. |
| retry 한도 | 단계별 일반 retry ≤ 3 AND 실행 전체 일반 retry ≤ 6. 어느 한도든 넘으면 escalation한다. |

예: G3 BLOCK → `return_to: S2`

```
S2 수정 → G2 → S3 → G3
                     └ S3(G3) retry +1   (G2가 통과하면 S2 retry는 그대로)
```

## 4. 사람 개입

| 경계 | 사람 개입 | 조건 |
|---|---|---|
| B0 질문 목록 → 답변 | 조건부 필수 | 질문 수 ≥ 1일 때만 |
| B1 화면설계서 → 디자인 | 자동 | |
| B2 디자인 수정 요청 | 자동 | retry 한도를 넘으면 escalation |
| B3 디자인 → 개발 | 자동 | |
| B4 검수 → 수정 | 자동 | retry 한도를 넘으면 escalation |
| 최종 승인 | 필수 | 항상 |

### escalation 응답

escalation은 다음 처리 방향을 정하기 위한 것이다. BLOCK을 예외로 승인하는 수단이 아니다. 완료 시 G1~G4 BLOCK은 0건이어야 한다 (R2-4).

사람은 아래 3개 중 1개만 고른다.

| 응답 | 의미 | 이후 처리 |
|---|---|---|
| ① 수정 방향 지시 | 요구사항은 바꾸지 않고 수정 방향만 정한다. | supervised retry 1회. 일반 retry 한도를 늘리는 것이 아니며, 실행당 최대 1회다. 이 시도에서도 BLOCK이면 ③으로 처리한다. |
| ② 요구사항·정책 변경 | 요구사항이 바뀐다. 기존 실행의 retry가 아니다. | B0 → S1부터 다시 진행한다. 기존 G1~G4 통과 기록을 모두 무효화한다. 같은 `run_id`에서 `revision` +1. |
| ③ 실행 중단 | 현재 실행을 끝낸다. | 상태 `aborted`. `completed`와 구분한다. |

```yaml
run_id: RUN-001
revision: 2
```

## 5. 실행 상태

| 상태 | 의미 |
|---|---|
| `completed` | G1~G4 BLOCK 0건 + WARN 전체 보고 + 최종 승인 (R2 완료 기준) |
| `aborted` | escalation ③ 또는 supervised retry 실패 |

## 6. 규칙 (스크립트가 셀 수 있는 형태)

| ID | 규칙 | 판정 |
|---|---|---|
| R3-1 | 단계는 4개이고 각 단계는 게이트 1개로 끝난다. | 단계 수 = 4 AND 단계별 게이트 수 = 1 |
| R3-2 | 한 산출물을 만드는 단계는 1개다. | 산출물별 생성 단계 수 = 1 |
| R3-3 | 화면설계서의 화면 ID와 manifest 화면 ID가 1:1로 대응한다. | 대응되지 않는 화면 ID 수 = 0 |
| R3-4 | manifest의 토큰은 모두 SSOT 토큰이다. | SSOT에 없는 토큰 수 = 0 |
| R3-5 | 단계별 일반 retry는 3회 이하다. | 단계별 일반 retry 수 ≤ 3 |
| R3-6 | 이전 단계로 돌아가면 이후 게이트 통과 기록을 무효화한다. | 복귀 후 재사용된 통과 기록 수 = 0 |
| R3-7 | B0는 질문이 있을 때만 사람에게 넘긴다. | 질문 수 = 0인데 B0가 실행된 수 = 0 |
| R3-8 | 사람 개입은 B0, escalation, 최종 승인에서만 일어난다. | 목록 밖에서 사람을 기다린 수 = 0 |
| R3-9 | escalation으로 BLOCK을 통과 처리하지 않는다. | escalation으로 통과한 BLOCK 수 = 0 |
| R3-10 | retry는 BLOCK을 발생시킨 게이트 단계에 귀속한다. | BLOCK 없는 단계에 증가한 retry 수 = 0 |
| R3-11 | 실행 전체 일반 retry는 최대 6회다. | 전체 일반 retry 수 ≤ 6 |
| R3-12 | escalation 응답은 수정 방향, 요구사항 변경, 실행 중단 중 하나다. | 허용 목록 밖 응답 수 = 0 |
| R3-13 | 수정 방향 선택 후 supervised retry는 최대 1회다. | supervised retry 수 ≤ 1 |
| R3-14 | 요구사항 변경 시 revision을 증가시키고 G1부터 다시 진행한다. | 변경 후 재사용된 기존 게이트 통과 기록 수 = 0 |
