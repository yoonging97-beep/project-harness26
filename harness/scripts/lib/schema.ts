// R5 6장 schema contract (SC-1~SC-5). 구조만 검사한다.
// 필드 내용(예: story 태그 누락)은 해당 조건(G1-1 등)이 measure 와 함께 판정한다.
import path from "node:path";
import { exists, readFrontmatter, readYaml } from "./util.ts";

type Errs = string[];
const isArr = (x: any) => Array.isArray(x);
const isStr = (x: any) => typeof x === "string" && x.length > 0;

function fm(p: string, errs: Errs, name: string): any {
  if (!exists(p)) {
    errs.push(`${name}: 파일 없음`);
    return null;
  }
  const d = readFrontmatter(p).data;
  if (!d) errs.push(`${name}: frontmatter 없음`);
  return d;
}

export function sc1(rev: string): Errs {
  const e: Errs = [];
  const d = fm(path.join(rev, "s1/requirements.md"), e, "requirements.md");
  if (!d) return e;
  if (!isArr(d.requirements) || d.requirements.length === 0) e.push("requirements.md: requirements 배열 없음");
  else d.requirements.forEach((r: any, i: number) => !isStr(r?.id) && e.push(`requirements.md: requirements[${i}].id 없음`));
  return e;
}

export function sc2(rev: string): Errs {
  const e: Errs = [];
  const d = fm(path.join(rev, "s1/questions.md"), e, "questions.md");
  if (!d) return e;
  if (!isArr(d.questions)) {
    e.push("questions.md: questions 배열 없음 (질문이 없으면 [])");
    return e;
  }
  d.questions.forEach((q: any, i: number) => !/^Q-\d+$/.test(q?.id ?? "") && e.push(`questions.md: questions[${i}].id 가 Q-n 형식이 아님`));
  const ap = path.join(rev, "s1/answers.md");
  if (d.questions.length > 0 || exists(ap)) {
    const a = fm(ap, e, "answers.md");
    if (a && !isArr(a.answers)) e.push("answers.md: answers 배열 없음");
    else if (a) a.answers.forEach((x: any, i: number) => !/^Q-\d+$/.test(x?.id ?? "") && e.push(`answers.md: answers[${i}].id 가 Q-n 형식이 아님`));
  }
  return e;
}

export function sc3(rev: string): Errs {
  const e: Errs = [];
  const d = fm(path.join(rev, "s2/spec.md"), e, "spec.md");
  if (!d) return e;
  if (!isArr(d.features) || d.features.length === 0) {
    e.push("spec.md: features 배열 없음");
    return e;
  }
  d.features.forEach((f: any, i: number) => {
    if (!/^F-\d+$/.test(f?.id ?? "")) e.push(`spec.md: features[${i}].id 가 F-n 형식이 아님`);
    if (!isArr(f?.acceptance) || f.acceptance.length === 0) e.push(`spec.md: features[${i}].acceptance 없음`);
    else f.acceptance.forEach((a: any, j: number) => !/^AC-[\w.-]+$/.test(a?.id ?? "") && e.push(`spec.md: features[${i}].acceptance[${j}].id 가 AC- 형식이 아님`));
  });
  return e;
}

export function sc4(rev: string): Errs {
  const e: Errs = [];
  const d = fm(path.join(rev, "s2/screens.md"), e, "screens.md");
  if (!d) return e;
  if (!isArr(d.screens) || d.screens.length === 0) {
    e.push("screens.md: screens 배열 없음");
    return e;
  }
  d.screens.forEach((s: any, i: number) => {
    if (!isStr(s?.screen_id)) e.push(`screens.md: screens[${i}].screen_id 없음`);
    if (!isArr(s?.features)) e.push(`screens.md: screens[${i}].features 배열 없음`);
    if (!isArr(s?.states) || s.states.length === 0) e.push(`screens.md: screens[${i}].states 없음`);
    if (!isStr(s?.kind)) e.push(`screens.md: screens[${i}].kind 없음`);
    if (!("empty_state" in (s ?? {}))) e.push(`screens.md: screens[${i}].empty_state 키 없음 (해당 없으면 null)`);
  });
  return e;
}

export function sc5(rev: string): Errs {
  const e: Errs = [];
  const p = path.join(rev, "s3/design-manifest.yaml");
  if (!exists(p)) return ["design-manifest.yaml: 파일 없음"];
  const m = readYaml(p) ?? {};
  if (!isArr(m.screens) || m.screens.length === 0) e.push("manifest: screens 배열 없음");
  else
    m.screens.forEach((s: any, i: number) => {
      if (!isStr(s?.id)) e.push(`manifest: screens[${i}].id 없음`);
      if (!isArr(s?.states)) e.push(`manifest: screens[${i}].states 없음`);
      // R8-2: source 는 존재하는 로컬 파일
      if (!isStr(s?.source) || /^[a-z]+:\/\//i.test(s.source)) e.push(`manifest: screens[${i}].source 가 로컬 파일 경로가 아님`);
      else if (!exists(path.join(rev, "s3", s.source))) e.push(`manifest: screens[${i}].source 파일 없음: ${s.source}`);
    });
  const t = m.tokens;
  if (!t || typeof t !== "object") e.push("manifest: tokens 없음");
  else for (const k of ["color", "radius", "shadow", "spacing"]) if (!isArr(t[k])) e.push(`manifest: tokens.${k} 배열 없음`);
  if (!isArr(m.typography) || m.typography.length === 0) e.push("manifest: typography 배열 없음");
  else m.typography.forEach((x: any, i: number) => ["size", "line_height", "family"].forEach((k) => x?.[k] === undefined && e.push(`manifest: typography[${i}].${k} 없음`)));
  if (!isArr(m.pairs)) e.push("manifest: pairs 배열 없음");
  else m.pairs.forEach((x: any, i: number) => (!isStr(x?.text) || !isStr(x?.background)) && e.push(`manifest: pairs[${i}] text/background 없음`));
  return e;
}

export const SCHEMAS: Record<string, (rev: string) => Errs> = { "SC-1": sc1, "SC-2": sc2, "SC-3": sc3, "SC-4": sc4, "SC-5": sc5 };
