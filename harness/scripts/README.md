# 하네스 스크립트

오케스트레이터(메인 Claude)만 실행한다 (R6-4). Node 24 이상, TypeScript 를 빌드 없이 실행한다.
모든 명령은 JSON 을 출력하고, 실패·BLOCK 이면 exit code ≠ 0 이다. 설치: `cd harness && npm install`.

```
node harness/scripts/cli.ts <명령> [옵션]
```

## 실행 루프 순서 (CLAUDE.md 5장)

| 단계 | 명령 |
|---|---|
| 실행 전 검사 | `preflight --feature 1.1` |
| 실행 생성 | `start --feature 1.1` (preflight 포함, `harness/requests/1.1.md` 복사) |
| 에이전트 호출 전 | `snapshot --run RUN-001 --stage S1` |
| 에이전트 호출 후 | `scope-check --run RUN-001 --stage S1` (위반 시 BLOCK + escalation, restore 없음) |
| S1 뒤 B0 | `wait-b0 --run RUN-001` → 사용자 답변을 requirements-agent 가 기록 → `submit-answers --run RUN-001` |
| 게이트 1차 | `gate --run RUN-001 --gate G1` → `gates/evidence/G1.pending.json` |
| llm-judge | pending 파일을 gate-judge 에 넘기고, 반환 JSON 을 `gates/evidence/G1.judge.json` 로 저장 |
| 게이트 확정 | `gate-finalize --run RUN-001 --gate G1 --judge <judge.json> [--return-to S1]` (exit 2 = 재판정 필요 → 재판정 후 `--final`) |
| S4 전 | `can-start-s4 --run RUN-001` |
| G4 증거 | `test-app --run RUN-001`, `browser-check --run RUN-001 --url http://localhost:4173` |
| escalation | `escalation --run RUN-001 --choice 1\|2\|3 [--note "..."]` |
| 멈춤·재개 | `pause --run RUN-001`, `resume --run RUN-001` |
| 최종 | `final-report --run RUN-001` → 사용자에게 6항목 보고 → `final-approve --run RUN-001 --text "<사용자 원문>"` |

## 점검

| 명령 | 내용 |
|---|---|
| `status [--run RUN-001]` | 실행 목록 / run.yaml |
| `verify-immutable --run RUN-001` | checkpoint·이전 revision 봉인 대비 변경 (R7-8, R4-2) |
| `verify-report --run RUN-001 --gate G3` | P-1 / P-2 보고 누락 |
| `approval-check --text "..."` | 명시적 최종 승인 표현인지 (R6-6) |
| `config-check` | R4-3, R4-5, R4-6 |
| `gates-sync` | `05-gates.md` ↔ `harness.yaml` 조건 일치 |

## self-test (R8)

```
node harness/tests/run.ts                   # T0~T18 + golden 판정 결과 확인 → harness/tests/last-result.json
node harness/tests/run.ts --prepare-golden  # gate-judge 용 golden 작업 폴더 생성 (T3~T5)
```

golden 판정: `--prepare-golden` 출력의 pending 파일을 gate-judge 에 넘기고, 결과를 `harness/tests/golden/results.json` 에
`[{ "case": "T3", "id": "C-1", "result": "pass" }, ...]` 형식으로 저장한 뒤 self-test 를 다시 실행한다.

## 산출물 형식 보충 (R5 schema contract 구현 시 추가한 것)

- `screens.md` 의 각 화면에 `kind` 필수 (`harness.yaml screen_kinds.allowed`). G2-10·G2-15 대상 화면을 가른다.
- G1-1 `story`, G1-3 `source` 누락은 schema 가 아니라 해당 조건이 measure 와 함께 BLOCK 한다 (위반 ID 를 정확히 남기기 위해).
- G4 테스트 증거: 앱 `package.json` 의 `test:harness` 가 vitest JSON 을 `$HARNESS_TEST_OUTPUT` 에 쓴다. 테스트 이름 태그 `[AC-x]`, `[G2-n]`, `[midnight]`, `[daily-alert]`.
- G4 브라우저 증거: `s4/qa.md` frontmatter `screens: [{screen_id, route}]`.
- CSS 변수 이름: `--color-*`, `--radius-*`, `--shadow-*`, `--space-*`, `--duration-*` (`src/styles/tokens.css` 에만 값 정의).
