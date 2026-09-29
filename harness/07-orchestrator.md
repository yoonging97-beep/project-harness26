---
round: R7
status: confirmed
title: 오케스트레이터
---

# R7 — 오케스트레이터

오케스트레이터 = 메인 Claude. 동작 규칙은 저장소 루트의 `CLAUDE.md`에 둔다.
이 파일은 R0~R6 결정을 실행 순서로 다시 엮은 것이며, 새 규칙은 🆕로 표시한다.

## 1. 실행 상태 분류

| 분류 | 상태 |
|---|---|
| active | `running`, `paused` |
| inactive | `completed`, `aborted` |

- 전체 active 실행은 최대 1개다. 새 실행은 active 실행이 0개일 때만 시작한다.

## 2. 실행 루프

```
start_run
  └ preflight ──(실패)→ 실행하지 않고 실패 항목 보고
  └ RUN-nnn 생성, run.yaml(status: running, revision: 1, baseline)
  └ for stage in S1..S4:
        ① (S4만) required_technical_decisions unresolved 확인 → 있으면 escalation (R6-7)
        ② 작업 트리 상태 기록 (scope snapshot)
        ③ 해당 작업 에이전트 호출
        ④ scope 사후 검사 → 위반 시 BLOCK (R6-1)
        ⑤ (S1만) questions ≥ 1 → paused, waiting_for: B0 → 답변 후 계속
        ⑥ 게이트 판정 (3장)
        ⑦ pass → checkpoint manifest 저장 (4장), 다음 단계
           block → 5장
  └ G4 pass → paused, waiting_for: final_approval → 최종 보고 (6장)
  └ final_approval → completed
```

### preflight

| 검사 | 근거 |
|---|---|
| 기능 ID 수 = 1 | R2-1 |
| `request.md` 필수 필드·섹션 | R4-10 |
| 기준 문서 3개 `status: confirmed`, uncommitted changes = 0 | R4-11 |
| 기준 문서 commit hash 기록 | R2-3 |
| active 실행 수 = 0 🆕 | R7-1 |

## 3. 게이트 판정 절차

1. schema 검사 스크립트 실행 → 실패면 게이트 BLOCK (R5-10, R5-11)
2. `applies_to`로 조건 분류 → 해당 없음은 `n/a` + reason
3. script 조건 → 판정 스크립트 실행
4. llm-judge 조건 → prefilter 결과와 targets를 `gate-judge`에 넘기고 JSON을 받음
5. 합치기: BLOCK 조건 중 `block`이 1개라도 있으면 게이트 `block`
6. `gates/G<n>.json` 저장, `run.yaml.gate_results` 갱신
7. 🆕 R5-4·R5-5 검사: evidence·measure가 없는 판정은 무효로 보고 1회 재판정한다

## 4. checkpoint manifest와 immutable 검사

자동 git commit은 만들지 않는다. 하네스 실행 추적과 Git 히스토리 관리를 섞지 않는다.

게이트 PASS 시 그 단계 산출물의 `path + SHA-256` manifest를 `G<n>.json`에 저장한다.

```json
{
  "gate": "G2",
  "result": "pass",
  "checkpoint": {
    "files": {
      "s2/spec.md": "sha256:...",
      "s2/screens.md": "sha256:..."
    }
  }
}
```

| 항목 | 규칙 |
|---|---|
| 대상 | PASS한 게이트 단계의 write scope 전체. `screens/`, `app/` 같은 디렉터리는 재귀적으로 모든 파일 포함 |
| 제외 | `harness.yaml`의 `checkpoint_ignore` 목록에 명시된 생성물만 (예: `node_modules/`, `dist/`, 빌드 캐시) |
| immutable 판정 | checkpoint의 파일 경로 집합 = 현재 파일 경로 집합 AND 각 파일 SHA-256 일치 |

- 경로 집합을 비교하므로 파일 내용 변경뿐 아니라 추가·삭제도 잡는다.
- R4-2(이전 revision immutable)와 checkpoint 이후 단계 산출물 변조 검사에 쓴다.

## 5. BLOCK 처리

| 상황 | 처리 | 근거 |
|---|---|---|
| 일반 BLOCK | `return_to` 단계 결정 → retry +1 (BLOCK 낸 단계) → 재실행 | R3 |
| 이전 단계 복귀 | 그 단계부터 이후 게이트 통과 기록 무효화 | R3-6 |
| 단계 retry > 3 또는 전체 > 6 | `paused`, `waiting_for: escalation` | R3-5, R3-11 |
| scope 위반 BLOCK | 변경 파일 목록 보고 + escalation. 자동 restore 없음 | R6-1 |
| escalation ① | supervised retry 1회, 실패 시 `aborted` | R3-13 |
| escalation ② | revision +1, 이전 통과 기록 무효화, S1부터 | R3-14 |
| escalation ③ | `aborted` | R3 |

### scope 위반 처리 🆕

- 오케스트레이터는 파일을 되돌리지 않는다.
- 사용자에게 "scope 밖 변경 파일 목록 + 에이전트 실행 전부터 있던 변경인지 여부"를 보여 준다.
- 되돌릴지는 사용자가 정한다. 그 뒤 escalation 응답 ①②③ 중 하나로 이어 간다.

### 사전 차단 hook 🆕

- `PreToolUse` hook으로, active 실행 중 `running` 상태일 때 `Docs/**`, `harness/config/**`에 대한 Write·Edit를 막는다.
- 단계별 write scope는 hook으로 막지 않고 사후 검사로만 판정한다. hook이 호출 주체(에이전트)를 구분하지 못하기 때문이다.

## 6. 최종 보고 (final_approval 전)

반드시 아래 순서로 보여 준다.

1. G1~G4 BLOCK = 0 확인
2. WARN 조건 목록 (게이트별)
3. provisional 값 사용 목록 (P-1)
4. provisional 매핑으로 생긴 `n/a` 목록 (P-2)
5. 결정 사항·미해결 질문
6. "최종 승인하려면 명시적으로 승인해 주세요" 안내 (R6-6)

## 7. 규칙

| ID | 규칙 | 판정 |
|---|---|---|
| R7-1 🆕 | active(`running` \| `paused`) 실행은 최대 1개다. 새 실행은 active 실행이 없을 때만 시작한다. | 새 실행 preflight 시 active 실행 수 = 0 AND 전체 active 실행 수 ≤ 1 |
| R7-2 | 모든 단계는 2장의 순서(①~⑦)를 따른다. | scope snapshot 없이 호출된 에이전트 수 = 0 |
| R7-3 🆕 | evidence·measure가 없는 판정은 무효로 보고 1회 재판정한다. | 누락 판정이 저장된 `G<n>.json` 수 = 0 |
| R7-4 | 오케스트레이터는 파일을 자동 restore하지 않는다. | 오케스트레이터가 실행한 restore·checkout·reset 수 = 0 |
| R7-5 | 최종 보고 6항목을 모두 보여 준 뒤에만 `final_approval`을 받는다. | 보고 누락 상태의 `completed` 수 = 0 |
| R7-6 🆕 | 자동 git commit을 만들지 않는다. | 하네스가 만든 commit 수 = 0 |
| R7-7 🆕 | 게이트 PASS 시 checkpoint manifest를 저장한다. | `result: pass`인데 `checkpoint.files`가 없는 `G<n>.json` 수 = 0 |
| R7-8 🆕 | immutable 검사는 경로 집합과 SHA-256을 모두 비교한다. | checkpoint 대비 추가·삭제·변경 파일 수 = 0 (ignore 목록 제외) |
