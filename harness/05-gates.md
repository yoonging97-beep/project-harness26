---
round: R5
status: confirmed
title: 게이트
---

# R5 — 게이트

> 원본 초안: `Docs/gates.md` (R0 컨텍스트상 draft). 57개 조건을 이 파일로 변환했다.
> 🆕 = R5 신규 조건, ✏️ = 원본에서 범위·문구·등급 변경, 🟠 = Claude 임의값 (provisional)

## 1. R0-1 용어 확장

R0-1의 `inputs:`를 R5에서 `criteria:`와 `targets:`로 확장한다.

| 필드 | 뜻 | 허용 범위 |
|---|---|---|
| `criteria` | 무엇을 기준으로 판정하는가 | R0 기준 문서 3개 + `harness/config/*` |
| `targets` | 무엇을 검사하는가 | 현재 revision 폴더 안 파일 |

- 각 게이트는 필요한 criteria만 선언한다. 모든 게이트가 모든 기준 문서를 읽을 필요는 없다.

**약어**

| criteria | 파일 | | targets | 파일 (`rev-N/` 기준) |
|---|---|---|---|---|
| `prd` | `Docs/prd.md` | | `req` `q` `ans` | `s1/requirements.md`, `s1/questions.md`, `s1/answers.md` |
| `svc` | `Docs/story-service.md` | | `spec` `scr` | `s2/spec.md`, `s2/screens.md` |
| `dsn` | `Docs/design.md` | | `man` `img` `rev` | `s3/design-manifest.yaml`, `s3/screens/`, `s3/review.md` |
| `tok` | `harness/config/design-tokens.yaml` | | `app` `qa` | `s4/app/`, `s4/qa.md` |
| `pol` | `harness/config/policy.yaml` | | | |
| `hns` | `harness/config/harness.yaml` | | | |

## 2. 조건 형식

```yaml
id: G3-17
severity: BLOCK          # BLOCK | WARN — method와 독립
method: llm-judge        # script | llm-judge
prefilter: null          # script 후보 탐지를 먼저 할 때 script 이름
applies_to: all          # all | [기능 ID 목록]
criteria: [dsn]
targets: [man, img]
```

- `severity`와 `method`는 서로 독립이다. `llm-judge`도 BLOCK을 낼 수 있다.
- 자동 판정이 어렵다는 이유만으로 WARN으로 내리지 않는다.

### 판정 결과 기록 (`gates/G<n>.json`)

| result | 반드시 남길 것 |
|---|---|
| `block` + `script` | `measure`: 측정값, 기대값, 위반 항목 목록 |
| `block` + `llm-judge` | `evidence[]`: `criterion`(판정 질문), `target`(파일·화면 ID), `finding`(구체적 관찰), `location` |
| `n/a` | `reason` |

```json
{
  "id": "G3-17", "result": "block", "method": "llm-judge",
  "evidence": [{
    "criterion": "핵심 정보 또는 액션을 장식 요소가 가리는가",
    "target": "s3/screens/ingredient-create",
    "finding": "누끼 이미지가 저장 버튼 상단 40%를 덮음",
    "location": "하단 CTA 영역"
  }]
}
```

```json
{ "id": "G2-4", "result": "n/a", "reason": "feature_id 1.1 not in applies_to" }
```

### applies_to와 n/a

- 현재 기능 ID가 `applies_to`에 없으면 `n/a`로 처리한다. `n/a`는 pass와 block 어느 쪽으로도 세지 않는다.
- `n/a`마다 `reason`을 기록한다.
- 🟠 현재 `applies_to` 매핑은 모두 provisional이다. provisional 매핑으로 `n/a`가 된 조건은 최종 승인 전에 WARN으로 보고한다.

### 판정 순서

```
게이트 실행 → ① targets schema 검사 (6장) → ② 조건 검사 → gates/G<n>.json
```

- schema가 맞지 않아 게이트를 정상 판정할 수 없으면 BLOCK이다.

---

## 3. 공통 — 어기면 안 되는 것 ★

정책은 기준 문서에서 확정된 내용이라 `confirmed`이다. 탐지 패턴은 Claude가 만든 것이라 🟠 `provisional`이다.
**문자열 일치만으로 BLOCK하지 않는다:** script 후보 탐지 → llm-judge 문맥 판정 → 실제 정책 위반이면 BLOCK.

| ID | 조건 | sev | method | prefilter | criteria | targets (게이트) | BLOCK 근거 |
|---|---|---|---|---|---|---|---|
| C-1 | 서비스가 식품 섭취 안전 여부·변질을 판정하지 않는다 | BLOCK | llm-judge | 🟠 금지 phrase 후보 탐지 | svc, pol | spec·scr (G2), man·img·rev (G3), app (G4) | 확정 위반 수 > 0. evidence: 후보 위치 + 판정 문장이 사용자에게 안전을 단정하는지 |
| C-2a ✏️ | 외부 쇼핑몰 주문·결제를 자동 실행하지 않는다 (UI·흐름) | BLOCK | llm-judge | 🟠 주문·결제 phrase 후보 탐지 | svc, pol | spec·scr (G2), img (G3), app (G4) | 확정 위반 수 > 0. `정기 구매` 일정(PRD 2.2)은 예외 |
| C-2b ✏️ | 허용 목록 밖 외부 도메인 호출이 없다 | BLOCK | script | – | pol | app (G4) | 🟠 허용 목록 밖 URL·fetch·XHR·form action 수 = 0 |
| C-3 | 공유 냉장고 기능이 구현되지 않았다 | BLOCK | llm-judge | 🟠 공유 phrase 후보 탐지 | svc | spec·scr (G2), img (G3), app (G4) | 실제 공유 기능(초대·권한·타인 데이터 접근) 존재 수 = 0 |

`policy.yaml` 기록 예:

```yaml
C-1:
  rule:
    value: "식품의 섭취 안전 여부를 서비스가 판정하지 않는다."
    status: confirmed
    origin: prd
  detection:
    phrases:
      value: ["먹어도 됩니다", "안전합니다"]
      status: provisional
      origin: claude-default
```

## 4. 공통 — provisional 보고

| ID | 조건 | sev | method | criteria | targets | 판정 |
|---|---|---|---|---|---|---|
| P-1 🆕 | 사용한 provisional 값을 모두 WARN으로 보고한다 (G3, G4) | BLOCK | script | tok, pol | man (G3), app (G4) | 사용된 provisional 수 = 보고된 provisional WARN 수 |
| P-2 🆕 | provisional `applies_to` 매핑으로 생긴 `n/a`를 WARN으로 보고한다 (G1~G4) | BLOCK | script | pol | – | provisional 매핑 `n/a` 수 = 보고된 해당 WARN 수 |

> provisional 값을 쓰는 것 자체는 BLOCK이 아니다. 보고가 빠지면 BLOCK이다.

---

## 5. 게이트별 조건

### G1 — 요구사항·정책이 충분히 정의됐는가

```yaml
gate: G1
criteria: [prd, svc, pol]
targets: [req, q, ans]
```

| ID | 조건 | sev | method | applies | criteria | BLOCK 근거 |
|---|---|---|---|---|---|---|
| G1-1 | 모든 요구사항이 유저스토리에 연결된다 | BLOCK | script | all | svc | `story:` 태그 없는 요구사항 수 = 0 |
| G1-2 ✏️ | 현재 기능에 사용된 모든 유저스토리가 PRD 근거를 가진다 | BLOCK | script | all | prd, svc | `req`에서 참조된 story 중 PRD 근거를 찾을 수 없는 story 수 = 0 |
| G1-3 ✏️ | 요구사항마다 값의 출처가 있다 | BLOCK | script | all | prd, pol | `source:` ∉ {`prd:<섹션>`, `answer:Q-n`, `config:<key>`}인 요구사항 수 = 0 |
| G1-4 | 기존 정책과 충돌하는 요구사항이 질문 목록에 있다 | BLOCK | llm-judge | all | prd | evidence: 충돌 요구사항 ID + PRD 정책 위치 + 질문 목록에 없음 |
| G1-5 | PRD와 다른 사용자 결정이 기록되어 있다 | WARN | llm-judge | all | prd, svc | – |
| G1-6 🆕 | 질문이 있으면 모두 답변되었다 | BLOCK | script | all | – | `q` 항목 수 = `ans` 답변 수 |

> G1-2: story → PRD 근거 매핑은 `story-service.md`에 있으므로 criteria에 `svc`를 함께 둔다.

### G2 — 기능명세와 화면설계가 일치하고 상태·예외가 빠지지 않았는가

```yaml
gate: G2
criteria: [prd, svc, dsn, pol]
targets: [req, spec, scr]
```

| ID | 조건 | sev | method | applies 🟠 | BLOCK 근거 |
|---|---|---|---|---|---|
| G2-1 | 모든 기능(`F-n`)이 화면을 가진다 | BLOCK | script | all | 화면 없는 `F-n` 수 = 0 |
| G2-2 | 모든 화면이 기능에 연결된다 | BLOCK | script | all | `features:` 비어 있는 화면 수 = 0 |
| G2-3 ✏️ | 기능 ID에 해당하는 PRD 화면이 있다 (전체 5화면 → 기능별) | BLOCK | script | all | 🟠 `pol.feature_screens[기능ID]` 중 누락 화면 수 = 0 |
| G2-4 | 홈 첫 화면에서 임박 식재료가 보인다 | BLOCK | llm-judge | 2.1 | evidence: 홈 화면 첫 뷰포트 구성 |
| G2-5 | 식재료 상태 5종 표시가 정의되어 있다 | BLOCK | script | 1.2, 2.1 | `scr` 상태 표에 없는 상태 수 = 0 |
| G2-6 | 임박 기준 = `pol.imminent_days` | BLOCK | script | 1.2, 2.1 | spec 값 ≠ policy 값인 수 = 0 |
| G2-7 | 처리 → 보관 중 되돌리기 흐름이 있다 | BLOCK | llm-judge | 1.2 | evidence: 흐름 누락 위치 |
| G2-8 | 폐기 시 사유 입력 흐름이 있다 | BLOCK | llm-judge | 1.2, 4.1 | evidence: 폐기 흐름 단계 |
| G2-9 | 선택·완료·비활성 상태가 컴포넌트마다 정의되어 있다 | BLOCK | llm-judge | all | evidence: 상태 누락 컴포넌트 |
| G2-10 | 빈 화면이 정의되어 있다 | BLOCK | script | 1.2, 4.1, 4.2 | `empty_state` 없는 대상 화면 수 = 0 |
| G2-11 | OCR 추출값을 저장 전에 확인·수정할 수 있다 | BLOCK | llm-judge | 1.1 | evidence: 추출 → 저장 사이 편집 단계 |
| G2-12 | 보관 방법이 없으면 일반 안내를 표시한다 | BLOCK | llm-judge | 1.3 | evidence: 예외 분기 |
| G2-13 | 소비기한 없는 식재료는 알림에서 제외된다 | BLOCK | llm-judge | 2.1 | evidence: 알림 대상 조건 |
| G2-14 | 가격 없는 식재료는 금액 집계에서 제외된다 | BLOCK | llm-judge | 4.1 | evidence: 집계 조건 |
| G2-15 | 보관·영양 화면에 참고용 안내 문구가 있다 | BLOCK | script | 1.3, 4.2 | 🟠 `pol.disclaimer` 문구 없는 대상 화면 수 = 0 |
| G2-16 | 알림 유형별 끄기가 가능하고, 끈 유형은 발송하지 않는다 | BLOCK | llm-judge | 2.1, 2.2 | evidence: 설정 → 발송 조건 |

### G3 — UI 디자인이 요구사항·화면설계와 일치하는가

```yaml
gate: G3
criteria: [dsn, tok, pol]
targets: [man, img, rev]
```

| ID | 조건 | sev | method | BLOCK 근거 |
|---|---|---|---|---|
| G3-1 | 화면설계의 화면·상태가 모두 디자인에 있다 | BLOCK | script | `scr` 화면·상태 ID 중 `man`에 없는 수 = 0 |
| G3-2 | 화면설계에 없는 기능·버튼이 추가되지 않았다 | BLOCK | llm-judge | evidence: 화면 ID + 추가 요소 |
| G3-3 | 색 토큰 외 색상이 없다 | BLOCK | script | `man.tokens.color` ⊄ `tok.color`인 수 = 0 |
| G3-4 | content 색이 UI 요소(버튼·내비)에 쓰이지 않는다 | BLOCK | llm-judge | evidence: 요소 + 사용 색 |
| G3-5 ✏️ | primary는 주요 액션·선택 상태에만 쓴다 | **WARN** | llm-judge | – (디자인 일관성 원칙, 사용성 훼손 아님) |
| G3-6 | 텍스트 대비 AA (본문 4.5 / 큰 글자 3.0) | BLOCK | script | `man.pairs` 대비 미달 수 = 0 |
| G3-7 | 상태를 색만으로 표현하지 않는다 | BLOCK | llm-judge | evidence: 라벨·아이콘 없는 상태 표시 |
| G3-8 ✏️ | 강한 그라데이션이 정보 위계·텍스트 가독성을 방해하지 않는다 | **WARN** | llm-judge | – |
| G3-9 | Pretendard·Inter 외 서체가 없다 | BLOCK | script | 허용 목록 밖 font-family 수 = 0 |
| G3-10 | 글자 크기·행간이 Type Scale 8단계 중 하나다 | BLOCK | script | scale 밖 조합 수 = 0 |
| G3-11 | 12px 미만 글자가 없다 | BLOCK | script | `< tok.type.min` 수 = 0 |
| G3-12 | 숫자 영역에 Tabular Numbers | WARN | llm-judge | – (G4-5에서 코드로 재확인) |
| G3-13 | 크기·굵기·여백만으로 위계가 보인다 | WARN | llm-judge | – |
| G3-14 | 카드 radius가 토큰 값이다 | BLOCK | script | 토큰 밖 radius 수 = 0 |
| G3-15 | 그림자가 토큰 2단계만이다 | BLOCK | script | 토큰 밖 shadow 수 = 0 |
| G3-16 | 좌우 여백·간격이 spacing 토큰이다 | WARN | script | – |
| G3-17 | 장식 요소가 핵심 정보·액션을 가리지 않는다 | BLOCK | llm-judge | evidence: 화면 ID + 가려진 요소 |
| G3-18 | 3D·Glass는 선택적으로만 쓴다 | WARN | llm-judge | – |
| G3-19 | 카드가 박스의 반복처럼 보이지 않는다 | WARN | llm-judge | – |
| G3-20 | 기본은 차분하고, 재미는 상호작용에 있다 | WARN | llm-judge | – |

### G4 — 구현된 웹앱이 기능명세·확정 UI대로 동작하는가

```yaml
gate: G4
criteria: [svc, dsn, tok, pol]
targets: [spec, man, app, qa]
```

| ID | 조건 | sev | method | applies | BLOCK 근거 |
|---|---|---|---|---|---|
| G4-1 ✏️ | 기능 ID의 수용 기준이 모두 동작한다 (전체 스토리 → 기능별) | BLOCK | script | all | 통과한 수용 기준 테스트 수 = `spec` 수용 기준 수 |
| G4-2 | G2 상태·예외가 구현에서 동작한다 | BLOCK | script | all | 해당 G2 조건별 테스트 실패 수 = 0 |
| G4-3 | 임박·경과 판정이 자정 경계에서 정확하다 | BLOCK | script | 1.2, 2.1 | 고정 시계 테스트 실패 수 = 0 |
| G4-4 | 경과 알림은 처리될 때까지 매일 발송된다 | BLOCK | script | 2.1 | 스케줄 테스트 실패 수 = 0 |
| G4-5 | 색·radius·그림자·글자 크기를 토큰(CSS 변수)으로 쓴다 | BLOCK | script | all | 하드코딩 값 수 = 0 |
| G4-6 | 확정 UI 디자인과 화면이 일치한다 | BLOCK | llm-judge | all | evidence: 화면 ID + 디자인 vs 구현 차이 |
| G4-7 | 자동 접근성 검사에서 대비 오류가 없다 | BLOCK | script | all | 대비 위반 수 = 0 |
| G4-8 | 360px 너비에서 가로 스크롤이 없다 | BLOCK | script | all | `scrollWidth > 360`인 화면 수 = 0 |
| G4-9 | 터치 영역이 44×44px 이상이다 | WARN | script | all | – |
| G4-10 | 입력 글자 크기가 16px 이상이다 | WARN | script | all | – |
| G4-11 | 전환 시간이 design.md 범위 안이다 | BLOCK | script | all | 범위 밖 duration 수 = 0 |
| G4-12 | 무한 반복·과도한 바운스가 없다 | BLOCK | script | all | `infinite` 애니메이션 수 = 0 |
| G4-13 | reduced-motion에서 이동 애니메이션이 꺼진다 | BLOCK | script | all | reduced-motion 적용 후 transform 전환 수 = 0 |

---

## 6. 산출물 형식 요구 (schema contract)

새 산출물을 추가하는 것이 아니라, 게이트가 R4의 기존 산출물을 기계 판정하기 위한 계약이다. R4는 수정하지 않는다.
각 게이트는 조건 검사 전에 해당 targets의 schema를 먼저 검사한다.

| ID | 파일 | 필수 필드 | 검사 게이트 |
|---|---|---|---|
| SC-1 | `s1/requirements.md` | 요구사항마다 `id`, `story:`, `source:` | G1 |
| SC-2 | `s1/questions.md`, `s1/answers.md` | 질문 `Q-n`, 답변 `Q-n` 대응 | G1 |
| SC-3 | `s2/spec.md` | 기능 `F-n`, 기능별 수용 기준 목록 | G2, G4 |
| SC-4 | `s2/screens.md` | 화면마다 `screen_id`, `features:`, 상태 표, `empty_state` (대상 화면) | G2, G3 |
| SC-5 | `s3/design-manifest.yaml` | `screens[].id`, `screens[].source`, `screens[].states`, `tokens`(color·radius·shadow·spacing), `typography`(크기·행간·font-family), `pairs`(텍스트/배경 토큰 쌍) | G3, G4 |

## 7. 사람 승인

- 사람 승인은 1곳이다: **G4 통과 후 `final_approval`**.
- 승인 전에 WARN 전체를 보여 준다: 조건 WARN, provisional 값 보고(P-1), provisional 매핑 `n/a` 보고(P-2) (R2-5).
- escalation은 승인이 아니다 (R3-9).

## 8. 규칙 (스크립트가 셀 수 있는 형태)

| ID | 규칙 | 판정 |
|---|---|---|
| R5-1 | criteria는 허용 범위 안에 있다. | 기준 문서 3개 + `harness/config/*` 밖 criteria 수 = 0 |
| R5-2 | targets는 현재 revision 안에 있다. | 현재 revision 밖 targets 수 = 0 |
| R5-3 | 조건마다 severity와 method가 있다. | 둘 중 하나라도 빠진 조건 수 = 0 |
| R5-4 | llm-judge BLOCK에는 evidence가 있다. | `result: block` AND `method: llm-judge` AND evidence 0개인 수 = 0 |
| R5-5 | script BLOCK에는 measure가 있다. | `result: block` AND `method: script` AND measure 없는 수 = 0 |
| R5-6 | phrase 일치만으로 BLOCK하지 않는다. | prefilter 결과만 있고 llm-judge 판정이 없는 BLOCK 수 = 0 |
| R5-7 | `n/a`는 통과로 세지 않고 사유를 남긴다. | `n/a`를 pass로 기록한 수 = 0 AND reason 없는 `n/a` 수 = 0 |
| R5-8 | provisional 사용을 모두 보고한다. | 사용된 provisional 수 = 보고된 provisional WARN 수 |
| R5-9 | provisional 매핑으로 생긴 `n/a`를 보고한다. | provisional 매핑 `n/a` 수 = 보고된 해당 WARN 수 |
| R5-10 | 조건 검사 전에 schema를 검사한다. | schema 검사 없이 실행된 게이트 수 = 0 |
| R5-11 | schema 위반은 BLOCK이다. | schema 위반 AND `result ≠ block`인 게이트 수 = 0 |

## 9. 🟠 임의값 목록 (provisional)

| 항목 | 위치 |
|---|---|
| 모든 `applies_to` 매핑 | 5장 |
| C-1, C-2a, C-3 탐지 phrase | `policy.yaml` |
| C-2b 도메인 허용 목록 | `policy.yaml` |
| `feature_screens` (기능 ID → PRD 화면) | `policy.yaml` |
| `disclaimer` 문구 | `policy.yaml` |
