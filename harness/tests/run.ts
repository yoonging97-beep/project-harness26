#!/usr/bin/env node
// 하네스 self-test (R8 4장). T0 + T1~T18. 결과: harness/tests/last-result.json (preflight R8-5 가 읽는다)
//   node harness/tests/run.ts                   전체 실행
//   node harness/tests/run.ts --prepare-golden  gate-judge 용 golden 작업 폴더 생성 (T3~T5)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import YAML from "yaml";
import { configHashes, loadConfig, type Config } from "../scripts/lib/config.ts";
import { configCheck, gatesSync } from "../scripts/lib/consistency.ts";
import { checkpointFiles, diffCheckpoint, evaluate, finalize, provisionalUsed, verifyReport } from "../scripts/lib/gate.ts";
import { prefilter } from "../scripts/lib/prefilter.ts";
import { preflight } from "../scripts/lib/preflight.ts";
import * as st from "../scripts/lib/runstate.ts";
import { scopeCheck, snapshot } from "../scripts/lib/scope.ts";
import { readJson, readText, writeJson } from "../scripts/lib/util.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const FIX = path.join(HERE, "fixtures");
const GOLDEN = path.join(HERE, "golden");

// ── 테스트 환경 ─────────────────────────────────────────────────────
function cp(src: string, dst: string) {
  fs.cpSync(src, dst, { recursive: true });
}

function makeRoot(dir?: string): string {
  const root = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "harness-selftest-"));
  cp(path.join(REPO, "harness", "config"), path.join(root, "harness", "config"));
  for (const d of ["prd.md", "story-service.md", "design.md"]) cp(path.join(REPO, "Docs", d), path.join(root, "Docs", d));
  cp(path.join(REPO, "harness", "05-gates.md"), path.join(root, "harness", "05-gates.md"));
  fs.symlinkSync(path.join(REPO, "harness", "node_modules"), path.join(root, "harness", "node_modules"));
  return root;
}

function gitInit(root: string) {
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "selftest@local");
  g("config", "user.name", "selftest");
  g("add", "-A");
  g("commit", "-qm", "fixture");
}

type Meta = { run_id: string; revision: number; feature_id: string };
const META: Meta = { run_id: "RUN-001", revision: 1, feature_id: "1.1" };

function makeRun(root: string, overlay?: string, runYaml: Partial<st.RunYaml> = {}): { cfg: Config; rev: string; run: st.RunYaml } {
  const runDir = path.join(root, "harness", "runs", "RUN-001");
  cp(path.join(FIX, "base-1.1"), runDir);
  if (overlay) cp(path.join(FIX, overlay), runDir);
  for (const d of ["gates/evidence", "gates/scope"]) fs.mkdirSync(path.join(runDir, "rev-1", d), { recursive: true });
  const run: st.RunYaml = {
    run_id: "RUN-001",
    feature_id: "1.1",
    status: "running",
    waiting_for: null,
    revision: 1,
    current_stage: "S1",
    retry: { stage: { S1: 0, S2: 0, S3: 0, S4: 0 }, total: 0 },
    supervised_retry: 0,
    supervised_active: false,
    blocked_stage: null,
    gate_results: { G1: null, G2: null, G3: null, G4: null },
    baseline: { prd: "x", story_service: "x", design: "x", config: {} },
    history: [],
    ...runYaml,
  } as st.RunYaml;
  fs.writeFileSync(path.join(runDir, "run.yaml"), YAML.stringify(run));
  const cfg = loadConfig(root);
  return { cfg, rev: path.join(runDir, "rev-1"), run };
}

const cond = (pending: any, id: string) => pending.conditions.find((c: any) => c.id === id);
const passAll = (pending: any) => pending.judge_requests.map((q: any) => ({ id: q.id, result: "pass" }));
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ── 테스트 ─────────────────────────────────────────────────────────
type T = { id: string; name: string; rules: string; run: () => { ok: boolean; detail?: any } };

const tests: T[] = [
  {
    id: "T0",
    name: "config 규칙 + 05-gates.md ↔ harness.yaml 동기화",
    rules: "R4-3, R4-5, R4-6",
    run: () => {
      const cfg = loadConfig(REPO);
      const c = configCheck(cfg);
      const g = gatesSync(cfg);
      return { ok: c.ok && g.ok, detail: { config: c.problems, gates: { md: g.md_conditions, yaml: g.yaml_conditions, problems: g.problems } } };
    },
  },
  {
    id: "T0b",
    name: "base fixture: G1~G3 script 조건 BLOCK 0",
    rules: "기준선",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot());
      const blocks = ["G1", "G2", "G3"].flatMap((g) => evaluate(cfg, rev, META, g).conditions.filter((c: any) => c.result === "block").map((c: any) => `${g}:${c.id}`));
      return { ok: blocks.length === 0, detail: blocks };
    },
  },
  {
    id: "T1",
    name: "story 없는 요구사항 → G1 block, measure 에 해당 ID",
    rules: "G1-1, R5-5",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T1");
      const p = evaluate(cfg, rev, META, "G1");
      const fin: any = finalize(cfg, rev, p, passAll(p), true);
      const c = fin.gate_json.conditions.find((x: any) => x.id === "G1-1");
      return { ok: fin.gate_json.result === "block" && c.result === "block" && c.measure?.violations?.includes("REQ-03"), detail: c };
    },
  },
  {
    id: "T2",
    name: "spec.md 에 F-n 없음 → schema 실패 → G2 block",
    rules: "R5-10, R5-11",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T2");
      const p = evaluate(cfg, rev, META, "G2");
      const s = cond(p, "SCHEMA");
      return { ok: s?.result === "block" && p.judge_requests.length === 0 && s.measure.violations.some((v: string) => v.includes("F-n")), detail: s?.measure };
    },
  },
  {
    id: "T3",
    name: "참고 안내 속 '상했' → C-1 후보 O, script 만으로 block 아님",
    rules: "R5-6",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T3");
      const cands = prefilter(cfg, rev, "C-1", ["spec", "scr"]);
      const p = evaluate(cfg, rev, META, "G2");
      const c1 = p.judge_requests.find((q: any) => q.id === "C-1");
      return { ok: cands.length > 0 && !cond(p, "C-1") && !!c1 && c1.candidates.length > 0, detail: cands };
    },
  },
  {
    id: "T4",
    name: "'먹어도 됩니다' → C-1 후보 O + judge block 이면 evidence 필수",
    rules: "C-1, R5-4",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T4");
      const p = evaluate(cfg, rev, META, "G2");
      const c1 = p.judge_requests.find((q: any) => q.id === "C-1");
      const noEvidence = finalize(cfg, rev, p, [...passAll(p).filter((r: any) => r.id !== "C-1"), { id: "C-1", result: "block" }], false) as any;
      const withEvidence = finalize(cfg, rev, p, [...passAll(p).filter((r: any) => r.id !== "C-1"), { id: "C-1", result: "block", evidence: [{ criterion: "섭취 안전 단정", target: "rev-1/s2/screens.md", finding: "'이 식재료는 먹어도 됩니다'" }] }], false) as any;
      const ok = c1?.candidates?.some((x: any) => x.phrase === "먹어도 됩니다") && noEvidence.needs_rejudge?.[0]?.id === "C-1" && withEvidence.gate_json?.result === "block";
      return { ok, detail: { candidates: c1?.candidates, rejudge: noEvidence.needs_rejudge, final: withEvidence.gate_json?.blocks } };
    },
  },
  {
    id: "T5",
    name: "코드 변수 isGood → C-1 후보 아님, block 아님",
    rules: "R5-6",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T5");
      const cands = prefilter(cfg, rev, "C-1", ["app"]);
      const p = evaluate(cfg, rev, META, "G4");
      return { ok: cands.length === 0 && !cond(p, "C-1"), detail: cands };
    },
  },
  {
    id: "T6",
    name: "허용 목록 밖 fetch → C-2b block",
    rules: "C-2b",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T6");
      const c = cond(evaluate(cfg, rev, META, "G4"), "C-2b");
      return { ok: c?.result === "block" && c.measure.violations.some((v: any) => v.match.includes("shop.example.com")), detail: c?.measure };
    },
  },
  {
    id: "T7",
    name: "manifest 에 토큰 밖 색 #FF0000 → G3-3 block",
    rules: "G3-3",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot(), "T7");
      const c = cond(evaluate(cfg, rev, META, "G3"), "G3-3");
      return { ok: c?.result === "block" && c.measure.violations.includes("#FF0000"), detail: c?.measure };
    },
  },
  {
    id: "T8",
    name: "provisional 사용 N개인데 WARN N-1개 보고 → P-1 block",
    rules: "R5-8",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot());
      const p = evaluate(cfg, rev, META, "G3");
      const fin: any = finalize(cfg, rev, p, passAll(p), true);
      const g = fin.gate_json;
      const provWarns = g.warnings.filter((w: any) => w.type === "provisional");
      const drop = provisionalUsed(cfg, rev, "G3")[0]; // manifest 가 실제로 쓴 provisional 토큰 1개의 보고를 뺀다
      const tampered = { ...g, warnings: g.warnings.filter((w: any) => !(w.type === "provisional" && w.key === drop)) };
      const v = verifyReport(cfg, rev, tampered);
      return { ok: provWarns.length >= 3 && g.conditions.find((c: any) => c.id === "P-1").result === "pass" && v.p1.ok === false && v.p1.missing.length === 1, detail: { used: provWarns.length, tampered: v.p1 } };
    },
  },
  {
    id: "T9",
    name: "1.1 실행의 G2-4 → n/a + reason + P-2 WARN",
    rules: "R5-7, R5-9",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot());
      const p = evaluate(cfg, rev, META, "G2");
      const na = cond(p, "G2-4");
      const fin: any = finalize(cfg, rev, p, passAll(p), true);
      const w = fin.gate_json.warnings.find((x: any) => x.type === "na_provisional" && x.id === "G2-4");
      const p2 = fin.gate_json.conditions.find((c: any) => c.id === "P-2");
      return { ok: na?.result === "n/a" && !!na.reason && !!w && p2?.result === "pass", detail: { na, warning: w, p2: p2?.measure } };
    },
  },
  {
    id: "T10",
    name: "scope 밖 Docs/prd.md 수정 → block + 파일 목록, restore 없음",
    rules: "R6-1, R7-4",
    run: () => {
      const root = makeRoot();
      makeRun(root);
      gitInit(root);
      const pre = snapshot(root);
      const prd = path.join(root, "Docs", "prd.md");
      fs.appendFileSync(prd, "\n<!-- agent edit -->\n");
      fs.writeFileSync(path.join(root, "harness/runs/RUN-001/rev-1/s1/extra.md"), "in scope\n");
      const res = scopeCheck(pre, snapshot(root), ["harness/runs/RUN-001/rev-1/s1/"]);
      const stillEdited = readText(prd).includes("agent edit");
      return { ok: !res.ok && res.outside.length === 1 && res.outside[0].path === "Docs/prd.md" && stillEdited, detail: res };
    },
  },
  {
    id: "T11",
    name: "G2 pass 뒤 spec.md 변경 + 파일 추가 → immutable 위반 2건",
    rules: "R7-8",
    run: () => {
      const { cfg, rev } = makeRun(makeRoot());
      const files = checkpointFiles(cfg, rev, "G2");
      fs.appendFileSync(path.join(rev, "s2/spec.md"), "x");
      fs.writeFileSync(path.join(rev, "s2/extra.md"), "added\n");
      const d = diffCheckpoint(cfg, rev, files);
      return { ok: !d.ok && d.changed.length + d.added.length + d.removed.length === 2, detail: d };
    },
  },
  {
    id: "T12",
    name: "S3 retry 3회 상태에서 BLOCK → escalation",
    rules: "R3-5",
    run: () => {
      const { cfg, run } = makeRun(makeRoot(), undefined, { current_stage: "S3", retry: { stage: { S1: 0, S2: 0, S3: 3, S4: 0 }, total: 3 } });
      const r = st.applyGateResult(cfg, run, "G3", "block");
      return { ok: r.status === "paused" && r.waiting_for === "escalation" && r.retry.stage.S3 === 3, detail: { status: r.status, waiting_for: r.waiting_for, retry: r.retry } };
    },
  },
  {
    id: "T13",
    name: "전체 retry 6회 상태에서 BLOCK(7회째) → escalation",
    rules: "R3-11",
    run: () => {
      const { cfg, run } = makeRun(makeRoot(), undefined, { current_stage: "S2", retry: { stage: { S1: 2, S2: 2, S3: 2, S4: 0 }, total: 6 } });
      const r = st.applyGateResult(cfg, run, "G2", "block");
      return { ok: r.waiting_for === "escalation" && r.retry.total === 6, detail: { waiting_for: r.waiting_for, retry: r.retry } };
    },
  },
  {
    id: "T14",
    name: "escalation ① 후 다시 BLOCK → aborted",
    rules: "R3-13",
    run: () => {
      const { cfg, run } = makeRun(makeRoot(), undefined, { status: "paused", waiting_for: "escalation", current_stage: "S3", blocked_stage: "S3", retry: { stage: { S1: 0, S2: 0, S3: 3, S4: 0 }, total: 3 } });
      const r1 = st.escalationResponse(cfg, run, 1, "대비를 높여 다시");
      const r2 = st.applyGateResult(cfg, r1, "G3", "block");
      const again = throws(() => st.escalationResponse(cfg, { ...r2, status: "paused", waiting_for: "escalation" } as st.RunYaml, 1, "또"));
      return { ok: r2.status === "aborted" && again, detail: { status: r2.status, supervised_retry: r2.supervised_retry, second_supervised_rejected: again } };
    },
  },
  {
    id: "T15",
    name: "paused 중 prd.md hash 변경 후 재개 → revision +1, S1 부터",
    rules: "R4-8, R8-4",
    run: () => {
      const root = makeRoot();
      const { cfg } = makeRun(root);
      gitInit(root);
      const base = st.currentBaseline(cfg);
      const run = { ...st.loadRun(cfg, "RUN-001"), status: "paused", waiting_for: null, current_stage: "S3", gate_results: { G1: "pass", G2: "pass", G3: null, G4: null }, baseline: base } as st.RunYaml;
      fs.appendFileSync(path.join(root, "Docs/prd.md"), "\n변경\n");
      execFileSync("git", ["-C", root, "commit", "-qam", "prd 변경"]);
      const { run: r, changed } = st.resumeRun(cfg, run);
      const sealed = fs.existsSync(path.join(root, "harness/runs/RUN-001/rev-1/gates/seal.json"));
      return { ok: r.revision === 2 && r.current_stage === "S1" && changed.includes("prd") && r.gate_results.G1 === null && sealed, detail: { revision: r.revision, stage: r.current_stage, changed, sealed } };
    },
  },
  {
    id: "T16",
    name: "RUN-001 paused 상태에서 새 실행 preflight → 실패",
    rules: "R7-1",
    run: () => {
      const root = makeRoot();
      const { cfg } = makeRun(root, undefined, { status: "paused", waiting_for: null });
      gitInit(root);
      const pf = preflight(cfg, ["1.1"], { skipSelftest: true });
      const c = pf.checks.find((x) => x.id.startsWith("R7-1"));
      return { ok: !pf.ok && c?.ok === false, detail: c };
    },
  },
  {
    id: "T17",
    name: "final_approval 대기에서 '좋아' → completed 아님",
    rules: "R6-6",
    run: () => {
      const { cfg, run } = makeRun(makeRoot(), undefined, { status: "paused", waiting_for: "final_approval", current_stage: null });
      const soft = ["좋아", "오케이", "진행해", "아직 최종 승인합니다 말고"].map((t) => st.isExplicitApproval(cfg, t));
      const rejected = throws(() => st.finalApprove(cfg, { ...run }, "좋아", true));
      const explicit = st.isExplicitApproval(cfg, "RUN-001 최종 승인합니다");
      const noReport = throws(() => st.finalApprove(cfg, { ...run }, "RUN-001 최종 승인합니다", false));
      return { ok: soft.every((x) => !x) && rejected && explicit && noReport, detail: { soft, rejected, explicit, report_required: noReport } };
    },
  },
  {
    id: "T18",
    name: "1.1 실행, answers.md 에 decision.ocr 없음 → S4 시작 안 함",
    rules: "R6-7 (R8 보완)",
    run: () => {
      const root = makeRoot();
      const { cfg, rev, run } = makeRun(root);
      fs.writeFileSync(path.join(rev, "s1/answers.md"), "---\nanswers:\n  - id: Q-01\n    answer: \"나중에 정할게요\"\n---\n");
      const missing = st.missingDecisions(cfg, run);
      return { ok: missing.length === 1 && missing[0] === "ocr", detail: missing };
    },
  },
];

// ── golden (llm-judge) ─────────────────────────────────────────────
function prepareGolden() {
  const cases = YAML.parse(readText(path.join(GOLDEN, "cases.yaml")));
  const work = path.join(GOLDEN, "work");
  fs.rmSync(work, { recursive: true, force: true });
  const out: any[] = [];
  for (const c of cases) {
    const root = path.join(work, c.case);
    fs.mkdirSync(root, { recursive: true });
    makeRoot(root);
    const { cfg, rev } = makeRun(root, c.fixture);
    const p = evaluate(cfg, rev, META, c.gate);
    const req = p.judge_requests.filter((q: any) => q.id === c.condition);
    const pendingPath = path.join(rev, "gates/evidence", `${c.gate}.pending.json`);
    writeJson(pendingPath, { ...p, judge_requests: req });
    out.push({ case: c.case, pending: path.relative(REPO, pendingPath), run_dir: path.relative(REPO, path.join(root, "harness/runs/RUN-001")) });
  }
  return out;
}

function goldenTests(): T[] {
  const cases = YAML.parse(readText(path.join(GOLDEN, "cases.yaml")));
  const rp = path.join(GOLDEN, "results.json");
  const results: any[] = fs.existsSync(rp) ? readJson(rp) : [];
  return cases.map((c: any) => ({
    id: `${c.case}-judge`,
    name: `golden: ${c.note}`,
    rules: "R8-6",
    run: () => {
      const r = results.find((x) => x.case === c.case);
      if (!r) return { ok: false, detail: "golden 판정 결과 없음 (gate-judge 로 판정 후 golden/results.json 기록)" };
      const evidenceOk = r.result !== "block" || (Array.isArray(r.evidence) && r.evidence.length > 0);
      return { ok: r.result === c.expected && evidenceOk, detail: { expected: c.expected, actual: r.result, evidence: r.evidence } };
    },
  }));
}

// ── 실행 ───────────────────────────────────────────────────────────
if (process.argv.includes("--prepare-golden")) {
  process.stdout.write(JSON.stringify(prepareGolden(), null, 2) + "\n");
} else {
  const all = [...tests, ...goldenTests()];
  const results = all.map((t) => {
    let r: { ok: boolean; detail?: any };
    try {
      r = t.run();
    } catch (e: any) {
      r = { ok: false, detail: { error: String(e?.stack ?? e) } };
    }
    return { id: t.id, name: t.name, rules: t.rules, ok: r.ok, detail: r.detail };
  });
  const failed = results.filter((r) => !r.ok).length;
  const summary = { at: new Date().toISOString(), passed: results.length - failed, failed, config_hashes: configHashes(REPO), results };
  writeJson(path.join(HERE, "last-result.json"), summary);
  for (const r of results) process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.id.padEnd(9)} ${r.name}  [${r.rules}]\n`);
  process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
  process.exitCode = failed ? 1 : 0;
}


