---
screens:
  - screen_id: ingredient-create
    prd_screen: 식재료 등록
    kind: form
    features: [F-1]
    states: [default, ocr-loading, ocr-review, saved]
    empty_state: null
    disclaimer: null
---
## ingredient-create
촬영 → 추출값 확인·수정(ocr-review) → 저장.
저장 화면 하단 안내: "섭취 전 실제 제품 표시와 상태를 우선 확인하세요. 상했는지 여부는 서비스가 판단하지 않습니다."
