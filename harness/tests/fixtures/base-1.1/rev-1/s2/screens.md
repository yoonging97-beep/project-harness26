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
