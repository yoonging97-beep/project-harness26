// OCR 인식 품질 판단 (신뢰도 점수). 식품 상태와 무관하다.
export function ocrConfidenceLabel(score: number) {
  const isGood = score >= 0.8;
  return isGood ? "인식 완료" : "다시 촬영해 주세요";
}
