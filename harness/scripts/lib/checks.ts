// script 조건 측정 (R5). 각 check 는 { ok, measure } 를 돌려준다.
// 판정 등급(BLOCK/WARN)과 결과 이름은 gate.ts 가 붙인다.
import path from "node:path";
import { type Config, leafKeys, val } from "./config.ts";
import { contrast } from "./color.ts";
import { exists, readFrontmatter, readJson, readText, readYaml, walkFiles } from "./util.ts";

export type Ctx = { cfg: Config; root: string; rev: string; featureId: string; gate: string };
export type CheckOut = { ok: boolean; measure: any; error?: boolean };

const fmOf = (ctx: Ctx, rel: string) => readFrontmatter(path.join(ctx.rev, rel)).data ?? {};
const manifest = (ctx: Ctx) => readYaml(path.join(ctx.rev, "s3/design-manifest.yaml")) ?? {};
const result = (violations: any[], extra: any = {}): CheckOut => ({
  ok: violations.length === 0,
  measure: { expected: 0, actual: violations.length, violations, ...extra },
});
const asList = (x: any): any[] => (Array.isArray(x) ? x : x === undefined || x === null || x === "" ? [] : [x]);

// ── G1 ────────────────────────────────────────────────────────────
function req_story_tag(ctx: Ctx): CheckOut {
  const reqs = fmOf(ctx, "s1/requirements.md").requirements ?? [];
  return result(reqs.filter((r: any) => asList(r.story).length === 0).map((r: any) => r.id));
}

// story-service.md 표: | # | 영역 | 유저스토리 | PRD 근거 |
function storyTable(ctx: Ctx): Map<string, string> {
  const txt = readText(path.join(ctx.root, ctx.cfg.harness.documents.baseline.story_service));
  const m = new Map<string, string>();
  for (const line of txt.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length >= 6 && /^\d+$/.test(cells[1])) m.set(cells[1], cells[4]);
  }
  return m;
}

function prdHasRef(prd: string, ref: string): boolean {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{2,4}\\s+${esc(ref)}\\s`, "m").test(prd);
}

// PRD 근거 칸의 참조를 PRD 제목으로 해석: "1.1" → ### 1.1, "정책 1" → ### 1., "2번 수용 기준" → ## 2.
function basisResolves(prd: string, basis: string): boolean {
  if (!basis) return false;
  const refs: string[] = [];
  for (const m of basis.matchAll(/(\d+\.\d+)/g)) refs.push(m[1]);
  for (const m of basis.matchAll(/정책\s*(\d+)/g)) refs.push(`${m[1]}.`);
  for (const m of basis.matchAll(/(\d+)번\s*수용\s*기준/g)) refs.push(`${m[1]}.`);
  return refs.length > 0 && refs.every((r) => prdHasRef(prd, r));
}

function story_prd_basis(ctx: Ctx): CheckOut {
  const reqs = fmOf(ctx, "s1/requirements.md").requirements ?? [];
  const table = storyTable(ctx);
  const prd = readText(path.join(ctx.root, ctx.cfg.harness.documents.baseline.prd));
  const used = new Set<string>(reqs.flatMap((r: any) => asList(r.story).map(String)));
  const bad = [...used].filter((s) => !table.has(s) || !basisResolves(prd, table.get(s)!));
  return result(bad.map((s) => ({ story: s, basis: table.get(s) ?? null })));
}

function req_source(ctx: Ctx): CheckOut {
  const reqs = fmOf(ctx, "s1/requirements.md").requirements ?? [];
  const prd = readText(path.join(ctx.root, ctx.cfg.harness.documents.baseline.prd));
  const qs = new Set((fmOf(ctx, "s1/questions.md").questions ?? []).map((q: any) => q.id));
  const bad: any[] = [];
  for (const r of reqs) {
    const srcs = asList(r.source);
    if (srcs.length === 0) bad.push({ id: r.id, reason: "source 없음" });
    for (const s of srcs) {
      const m = String(s).match(/^(prd|answer|config):(.+)$/);
      if (!m) bad.push({ id: r.id, source: s, reason: "형식" });
      else if (m[1] === "prd" && !prdHasRef(prd, m[2]) && !basisResolves(prd, m[2])) bad.push({ id: r.id, source: s, reason: "PRD 섹션 없음" });
      else if (m[1] === "answer" && !qs.has(m[2])) bad.push({ id: r.id, source: s, reason: "질문 없음" });
      else if (m[1] === "config") {
        const [file, dotted] = m[2].split(":");
        let node: any = file === "tokens" ? ctx.cfg.tokens : file === "policy" ? ctx.cfg.policy : undefined;
        for (const k of (dotted ?? "").split(".")) node = node?.[k];
        if (node === undefined) bad.push({ id: r.id, source: s, reason: "config 키 없음" });
      }
    }
  }
  return result(bad);
}

function questions_answered(ctx: Ctx): CheckOut {
  const qs = fmOf(ctx, "s1/questions.md").questions ?? [];
  const ap = path.join(ctx.rev, "s1/answers.md");
  const as = exists(ap) ? readFrontmatter(ap).data?.answers ?? [] : [];
  const answered = new Set(as.filter((a: any) => String(a.answer ?? "").trim()).map((a: any) => a.id));
  return result(qs.filter((q: any) => !answered.has(q.id)).map((q: any) => q.id), { questions: qs.length, answers: answered.size });
}

// ── G2 ────────────────────────────────────────────────────────────
const specFeatures = (ctx: Ctx) => fmOf(ctx, "s2/spec.md").features ?? [];
const screens = (ctx: Ctx) => fmOf(ctx, "s2/screens.md").screens ?? [];

function features_have_screens(ctx: Ctx): CheckOut {
  const covered = new Set(screens(ctx).flatMap((s: any) => s.features ?? []));
  return result(specFeatures(ctx).filter((f: any) => !covered.has(f.id)).map((f: any) => f.id));
}

function screens_have_features(ctx: Ctx): CheckOut {
  const ids = new Set(specFeatures(ctx).map((f: any) => f.id));
  return result(
    screens(ctx)
      .filter((s: any) => !(s.features ?? []).length || (s.features ?? []).some((f: string) => !ids.has(f)))
      .map((s: any) => ({ screen_id: s.screen_id, features: s.features ?? [] })),
  );
}

function feature_prd_screens(ctx: Ctx): CheckOut {
  const need: string[] = val(ctx.cfg, "policy:feature_screens")[ctx.featureId] ?? [];
  const have = new Set(screens(ctx).map((s: any) => s.prd_screen).filter(Boolean));
  return result(need.filter((n) => !have.has(n)), { required: need });
}

function item_states_defined(ctx: Ctx): CheckOut {
  const need: string[] = val(ctx.cfg, "policy:item_states");
  const have = new Set(fmOf(ctx, "s2/screens.md").item_states ?? []);
  return result(need.filter((s) => !have.has(s)));
}

function imminent_days_match(ctx: Ctx): CheckOut {
  const want = val(ctx.cfg, "policy:imminent_days");
  const got = fmOf(ctx, "s2/spec.md").policy_values?.imminent_days;
  return result(got === want ? [] : [{ expected: want, actual: got ?? null }]);
}

function empty_states_defined(ctx: Ctx): CheckOut {
  const kinds: string[] = ctx.cfg.harness.screen_kinds.empty_state_required;
  return result(
    screens(ctx)
      .filter((s: any) => kinds.includes(s.kind) && !String(s.empty_state ?? "").trim())
      .map((s: any) => s.screen_id),
  );
}

function disclaimer_present(ctx: Ctx): CheckOut {
  const kinds: string[] = ctx.cfg.harness.screen_kinds.disclaimer_required;
  const text = val(ctx.cfg, "policy:disclaimer");
  return result(screens(ctx).filter((s: any) => kinds.includes(s.kind) && s.disclaimer !== text).map((s: any) => s.screen_id));
}

// ── G3 (manifest) ─────────────────────────────────────────────────
function manifest_covers_screens(ctx: Ctx): CheckOut {
  const man = new Map<string, any>((manifest(ctx).screens ?? []).map((s: any) => [s.id, s]));
  const bad: any[] = [];
  for (const s of screens(ctx)) {
    const m = man.get(s.screen_id);
    if (!m) bad.push({ screen_id: s.screen_id, missing: "screen" });
    else for (const st of s.states ?? []) if (!(m.states ?? []).includes(st)) bad.push({ screen_id: s.screen_id, missing_state: st });
  }
  return result(bad);
}

const tokenSubset = (ctx: Ctx, kind: string, group: string, exclude: string[] = []) => {
  const allowed = new Set(leafKeys(ctx.cfg, group).filter((k) => !exclude.includes(k)));
  return result((manifest(ctx).tokens?.[kind] ?? []).filter((t: string) => !allowed.has(t)));
};
const manifest_colors = (ctx: Ctx) => tokenSubset(ctx, "color", "tokens:color");
const manifest_radius = (ctx: Ctx) => tokenSubset(ctx, "radius", "tokens:radius", ["card_range"]);
const manifest_shadow = (ctx: Ctx) => tokenSubset(ctx, "shadow", "tokens:shadow");
const manifest_spacing = (ctx: Ctx) => tokenSubset(ctx, "spacing", "tokens:spacing", ["scale"]);

function manifest_contrast(ctx: Ctx): CheckOut {
  const body = val(ctx.cfg, "tokens:contrast.body_min");
  const large = val(ctx.cfg, "tokens:contrast.large_min");
  const colorKeys = new Set(leafKeys(ctx.cfg, "tokens:color"));
  const bad: any[] = [];
  for (const p of manifest(ctx).pairs ?? []) {
    if (!colorKeys.has(p.text) || !colorKeys.has(p.background)) {
      bad.push({ ...p, reason: "토큰 아님" });
      continue;
    }
    const ratio = contrast(val(ctx.cfg, `tokens:color.${p.text}`), val(ctx.cfg, `tokens:color.${p.background}`));
    const min = p.large ? large : body;
    if (ratio < min) bad.push({ ...p, ratio: Number(ratio.toFixed(2)), min });
  }
  return result(bad);
}

function manifest_fonts(ctx: Ctx): CheckOut {
  const allowed = new Set([val(ctx.cfg, "tokens:typography.families.primary"), val(ctx.cfg, "tokens:typography.families.secondary")]);
  return result((manifest(ctx).typography ?? []).filter((t: any) => !allowed.has(t.family)).map((t: any) => t.family));
}

function manifest_type_scale(ctx: Ctx): CheckOut {
  const scale = ctx.cfg.tokens.typography.scale;
  const pairs = new Set(Object.keys(scale).map((k) => `${scale[k].value.size}/${scale[k].value.line_height}`));
  return result((manifest(ctx).typography ?? []).filter((t: any) => !pairs.has(`${t.size}/${t.line_height}`)).map((t: any) => `${t.size}/${t.line_height}`));
}

function manifest_min_size(ctx: Ctx): CheckOut {
  const min = val(ctx.cfg, "tokens:typography.min_size");
  return result((manifest(ctx).typography ?? []).filter((t: any) => Number(t.size) < min).map((t: any) => t.size), { min });
}

// ── G4 (정적 검사: s4/app/) ────────────────────────────────────────
function appFiles(ctx: Ctx): { rel: string; text: string }[] {
  const sc = ctx.cfg.harness.app_scan;
  const dir = path.join(ctx.rev, "s4/app");
  return walkFiles(dir, [...ctx.cfg.harness.checkpoint_ignore, ...sc.exclude])
    .filter((f) => sc.extensions.some((e: string) => f.endsWith(e)))
    .map((rel) => ({ rel, text: readText(path.join(dir, rel)) }));
}

function scanLines(files: { rel: string; text: string }[], re: RegExp, skip?: (f: string) => boolean) {
  const hits: any[] = [];
  for (const f of files) {
    if (skip?.(f.rel)) continue;
    f.text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")))
        hits.push({ file: f.rel, line: i + 1, match: m[0] });
    });
  }
  return hits;
}

function external_domains(ctx: Ctx): CheckOut {
  const allowed = new Set([...val(ctx.cfg, "policy:allowed_domains"), ...val(ctx.cfg, "policy:namespace_domains"), "localhost", "127.0.0.1"]);
  const hits = scanLines(appFiles(ctx), /https?:\/\/([^/"'`\s)]+)/g).filter((h) => {
    const host = h.match.replace(/^https?:\/\//, "").split(":")[0];
    return !allowed.has(host);
  });
  return result(hits);
}

function hardcoded_values(ctx: Ctx): CheckOut {
  const sc = ctx.cfg.harness.app_scan;
  const files = appFiles(ctx);
  const hits = sc.hardcoded_patterns.flatMap((p: string) => scanLines(files, new RegExp(p, "g"), (f) => f === sc.tokens_file));
  return result(hits);
}

function motion_durations(ctx: Ctx): CheckOut {
  const sc = ctx.cfg.harness.app_scan;
  const ranges = Object.keys(ctx.cfg.tokens.motion.range).map((k) => val(ctx.cfg, `tokens:motion.range.${k}`) as [number, number]);
  const lineRe = new RegExp(sc.motion_line_pattern);
  const hits: any[] = [];
  for (const f of appFiles(ctx))
    f.text.split("\n").forEach((line, i) => {
      if (!lineRe.test(line)) return;
      for (const m of line.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
        const ms = m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
        if (ms < sc.motion_ignore_below_ms) continue;
        if (!ranges.some(([lo, hi]) => ms >= lo && ms <= hi)) hits.push({ file: f.rel, line: i + 1, ms });
      }
    });
  return result(hits, { ranges });
}

function no_infinite_animation(ctx: Ctx): CheckOut {
  const files = appFiles(ctx);
  return result(ctx.cfg.harness.app_scan.infinite_patterns.flatMap((p: string) => scanLines(files, new RegExp(p, "g"))));
}

// ── G4 (테스트·브라우저 증거: 오케스트레이터가 cli test-app / browser-check 로 만든다) ──
function evidence(ctx: Ctx, name: string): any | null {
  const p = path.join(ctx.rev, "gates/evidence", name);
  return exists(p) ? readJson(p) : null;
}

function testCases(ctx: Ctx): { name: string; status: string }[] | null {
  const ev = evidence(ctx, "G4-tests.json");
  if (!ev) return null;
  return (ev.testResults ?? []).flatMap((t: any) =>
    (t.assertionResults ?? []).map((a: any) => ({ name: a.fullName ?? a.title ?? "", status: a.status })),
  );
}

const missingEvidence = (name: string, cmd: string): CheckOut => ({ ok: false, error: true, measure: { error: `증거 없음: gates/evidence/${name}. 먼저 '${cmd}' 실행` } });

function tagged(cases: { name: string; status: string }[], tag: string) {
  const hit = cases.filter((c) => c.name.includes(tag));
  return { passed: hit.filter((c) => c.status === "passed").length, failed: hit.filter((c) => c.status !== "passed").length };
}

function acceptance_tests(ctx: Ctx): CheckOut {
  const cases = testCases(ctx);
  if (!cases) return missingEvidence("G4-tests.json", "cli test-app");
  const fmt: string = ctx.cfg.harness.test_tags.acceptance;
  const acs = specFeatures(ctx).flatMap((f: any) => (f.acceptance ?? []).map((a: any) => a.id));
  const bad = acs.map((id: string) => ({ id, ...tagged(cases, fmt.replace("{id}", id)) })).filter((x: any) => x.passed === 0 || x.failed > 0);
  return { ok: bad.length === 0, measure: { expected: acs.length, actual: acs.length - bad.length, violations: bad } };
}

function g2_condition_tests(ctx: Ctx, applicable: string[] = []): CheckOut {
  const cases = testCases(ctx);
  if (!cases) return missingEvidence("G4-tests.json", "cli test-app");
  const fmt: string = ctx.cfg.harness.test_tags.g2_condition;
  const ids = (ctx.cfg.harness.behavioral_g2 as string[]).filter((id) => applicable.includes(id));
  const bad = ids.map((id) => ({ id, ...tagged(cases, fmt.replace("{id}", id)) })).filter((x) => x.passed === 0 || x.failed > 0);
  return result(bad, { conditions: ids });
}

function tagTest(ctx: Ctx, key: string): CheckOut {
  const cases = testCases(ctx);
  if (!cases) return missingEvidence("G4-tests.json", "cli test-app");
  const t = tagged(cases, ctx.cfg.harness.test_tags[key]);
  return result(t.passed === 0 || t.failed > 0 ? [{ tag: ctx.cfg.harness.test_tags[key], ...t }] : []);
}

function browser(ctx: Ctx, pick: (s: any) => any[] | number): CheckOut {
  const ev = evidence(ctx, "G4-browser.json");
  if (!ev) return missingEvidence("G4-browser.json", "cli browser-check");
  const bad: any[] = [];
  for (const s of ev.screens ?? []) {
    const v = pick(s);
    if (Array.isArray(v) ? v.length : v) bad.push({ screen_id: s.screen_id, value: v });
  }
  return result(bad);
}

export const CHECKS: Record<string, (ctx: Ctx, applicable?: string[]) => CheckOut> = {
  req_story_tag,
  story_prd_basis,
  req_source,
  questions_answered,
  features_have_screens,
  screens_have_features,
  feature_prd_screens,
  item_states_defined,
  imminent_days_match,
  empty_states_defined,
  disclaimer_present,
  manifest_covers_screens,
  manifest_colors,
  manifest_contrast,
  manifest_fonts,
  manifest_type_scale,
  manifest_min_size,
  manifest_radius,
  manifest_shadow,
  manifest_spacing,
  external_domains,
  hardcoded_values,
  motion_durations,
  no_infinite_animation,
  acceptance_tests,
  g2_condition_tests,
  midnight_tests: (ctx) => tagTest(ctx, "midnight"),
  daily_alert_tests: (ctx) => tagTest(ctx, "daily_alert"),
  axe_contrast: (ctx) => browser(ctx, (s) => s.axe_contrast_violations ?? []),
  no_hscroll_360: (ctx) => browser(ctx, (s) => (s.scroll_width > s.viewport ? [s.scroll_width] : [])),
  touch_targets: (ctx) => browser(ctx, (s) => s.small_touch_targets ?? []),
  input_font_size: (ctx) => browser(ctx, (s) => s.small_inputs ?? []),
  reduced_motion: (ctx) => browser(ctx, (s) => s.reduced_motion_transform_transitions ?? 0),
};

