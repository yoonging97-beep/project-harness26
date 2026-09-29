// 게이트 판정 (R5, R7 3장).
//   evaluate : schema → applies_to(n/a) → script 조건 → llm-judge 요청 목록 (gates/evidence/G<n>.pending.json)
//   finalize : gate-judge 결과 검증(R5-4) → 합치기 → P-1/P-2 → checkpoint(R7-7) → gates/G<n>.json
import path from "node:path";
import { type Config, isLeaf } from "./config.ts";
import { CHECKS, type Ctx } from "./checks.ts";
import { prefilter } from "./prefilter.ts";
import { SCHEMAS } from "./schema.ts";
import { exists, nowIso, readJson, readText, readYaml, sha256File, walkFiles, writeJson } from "./util.ts";

export type CondResult = {
  id: string;
  severity: "BLOCK" | "WARN";
  method: "script" | "llm-judge";
  result: "pass" | "block" | "warn" | "n/a";
  measure?: any;
  evidence?: any[];
  reason?: string;
  mapping?: "provisional" | "confirmed";
};

export type JudgeRequest = {
  id: string;
  severity: string;
  question: string;
  criteria: string[];
  targets: string[];
  candidates?: any[];
};

const conditionsFor = (cfg: Config, gate: string) => (cfg.harness.gates.conditions as any[]).filter((c) => c.gates.includes(gate));

function applies(c: any, featureId: string): boolean {
  return c.applies_to === "all" || (Array.isArray(c.applies_to) && c.applies_to.includes(featureId));
}

function stageDirOf(cfg: Config, gate: string): string {
  const sg = cfg.harness.run.stage_gate as Record<string, string>;
  const stage = Object.keys(sg).find((s) => sg[s] === gate)!;
  return cfg.harness.run.stage_dir[stage];
}

// P-1: 이번 게이트에서 "사용된" provisional 값. G3 = manifest 가 참조한 토큰, G4 = app 이 참조한 CSS 변수.
export function provisionalUsed(cfg: Config, rev: string, gate: string): string[] {
  const used = new Set<string>();
  const addIfProv = (ref: string) => {
    const [file, dotted] = ref.split(":");
    let node: any = file === "tokens" ? cfg.tokens : cfg.policy;
    for (const k of dotted.split(".")) node = node?.[k];
    if (isLeaf(node) && node.status === "provisional") used.add(ref);
  };
  if (gate === "G3") {
    const mp = path.join(rev, "s3/design-manifest.yaml");
    const m = exists(mp) ? readYaml(mp) ?? {} : {};
    for (const k of ["color", "radius", "shadow", "spacing"]) for (const t of m.tokens?.[k] ?? []) addIfProv(`tokens:${k}.${t}`);
    if ((m.typography ?? []).length) addIfProv("tokens:typography.min_size"); // G3-11 기준
  }
  if (gate === "G4") {
    const dir = path.join(rev, "s4/app");
    const groups: Record<string, string> = { color: "color", radius: "radius", shadow: "shadow", space: "spacing", duration: "motion.duration" };
    for (const f of walkFiles(dir, [...cfg.harness.checkpoint_ignore, ...cfg.harness.app_scan.exclude])) {
      if (!cfg.harness.app_scan.extensions.some((e: string) => f.endsWith(e))) continue;
      for (const m of readText(path.join(dir, f)).matchAll(/var\(--([a-z]+)-([a-z0-9-]+)\)/g)) {
        const g = groups[m[1]];
        if (g) addIfProv(`tokens:${g}.${m[2]}`);
      }
    }
    addIfProv("policy:allowed_domains"); // C-2b 기준
  }
  return [...used].sort();
}

export function evaluate(cfg: Config, rev: string, runMeta: { run_id: string; revision: number; feature_id: string }, gate: string) {
  const featureId = runMeta.feature_id;
  const ctx: Ctx = { cfg, root: cfg.root, rev, featureId, gate };
  const mappingStatus = cfg.harness.gates.applies_to_mapping.status;
  const base = { gate, run_id: runMeta.run_id, revision: runMeta.revision, feature_id: featureId, evaluated_at: nowIso() };

  // ① schema (R5-10, R5-11)
  const scIds: string[] = cfg.harness.schema[gate] ?? [];
  const schemaErrors = scIds.flatMap((id) => SCHEMAS[id](rev).map((e) => `${id} ${e}`));
  if (schemaErrors.length) {
    return {
      ...base,
      schema: { checked: scIds, errors: schemaErrors },
      conditions: [{ id: "SCHEMA", severity: "BLOCK", method: "script", result: "block", measure: { expected: 0, actual: schemaErrors.length, violations: schemaErrors } }] as CondResult[],
      judge_requests: [] as JudgeRequest[],
    };
  }

  const conds: CondResult[] = [];
  const requests: JudgeRequest[] = [];
  const all = conditionsFor(cfg, gate).filter((c) => !["P-1", "P-2"].includes(c.id)); // P-* 는 finalize 에서
  const applicableIds = all.filter((c) => applies(c, featureId)).map((c) => c.id);
  // G4-2 는 G2 조건 적용 여부가 필요
  const g2Applicable = conditionsFor(cfg, "G2").filter((c) => applies(c, featureId)).map((c) => c.id);

  for (const c of all) {
    if (!applies(c, featureId)) {
      // ② n/a + reason (R5-7), provisional 매핑이면 P-2 대상
      conds.push({ id: c.id, severity: c.severity, method: c.method, result: "n/a", reason: `feature_id ${featureId} not in applies_to`, mapping: mappingStatus });
      continue;
    }
    const targets: string[] = c.targets?.[gate] ?? [];
    if (c.method === "script") {
      // ③ script 조건
      let out;
      try {
        out = CHECKS[c.check](ctx, c.id === "G4-2" ? g2Applicable : applicableIds);
      } catch (e: any) {
        out = { ok: false, error: true, measure: { error: String(e?.message ?? e) } };
      }
      const failRes = c.severity === "BLOCK" ? "block" : "warn";
      conds.push({ id: c.id, severity: c.severity, method: "script", result: out.ok ? "pass" : failRes, measure: out.measure });
    } else {
      // ④ llm-judge 요청 (prefilter 후보는 힌트)
      requests.push({
        id: c.id,
        severity: c.severity,
        question: c.question,
        criteria: (c.criteria ?? []).map((k: string) => cfg.harness.criteria[k]),
        targets: targets.map((t) => path.posix.join(`rev-${runMeta.revision}`, cfg.harness.targets[t])),
        ...(c.prefilter ? { candidates: prefilter(cfg, rev, c.prefilter, targets) } : {}),
      });
    }
  }
  return { ...base, schema: { checked: scIds, errors: [] }, conditions: conds, judge_requests: requests, consulted: [...cfg.consulted].sort() };
}

// R5-4: llm-judge 결과 검증
export function validateJudge(requests: JudgeRequest[], judge: any): { valid: Map<string, any>; invalid: { id: string; reason: string }[] } {
  const list: any[] = Array.isArray(judge) ? judge : judge?.results ?? [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const valid = new Map<string, any>();
  const invalid: { id: string; reason: string }[] = [];
  for (const q of requests) {
    const r = byId.get(q.id);
    if (!r) invalid.push({ id: q.id, reason: "판정 없음" });
    else if (!["pass", "block"].includes(r.result)) invalid.push({ id: q.id, reason: `result 값 오류: ${r.result}` });
    else if (r.result === "block" && !(Array.isArray(r.evidence) && r.evidence.length && r.evidence.every((e: any) => e.criterion && e.target && e.finding)))
      invalid.push({ id: q.id, reason: "block 인데 evidence(criterion·target·finding) 없음" });
    else valid.set(q.id, r);
  }
  return { valid, invalid };
}

export function checkpointFiles(cfg: Config, rev: string, gate: string): Record<string, string> {
  const sd = stageDirOf(cfg, gate);
  const files: Record<string, string> = {};
  for (const f of walkFiles(path.join(rev, sd), cfg.harness.checkpoint_ignore)) files[`${sd}/${f}`] = sha256File(path.join(rev, sd, f));
  return files;
}

export function finalize(cfg: Config, rev: string, pending: any, judge: any, finalAttempt: boolean) {
  const gate = pending.gate;
  const conds: CondResult[] = [...pending.conditions];
  const requests: JudgeRequest[] = pending.judge_requests ?? [];
  const { valid, invalid } = validateJudge(requests, judge ?? []);
  if (invalid.length && !finalAttempt) return { needs_rejudge: invalid }; // R7-3: 1회 재판정
  for (const q of requests) {
    const r = valid.get(q.id);
    if (!r) {
      conds.push({ id: q.id, severity: q.severity as any, method: "llm-judge", result: q.severity === "BLOCK" ? "block" : "warn", measure: { error: "재판정 후에도 유효한 판정 없음", invalid: invalid.find((x) => x.id === q.id) } });
      continue;
    }
    const res = r.result === "pass" ? "pass" : q.severity === "BLOCK" ? "block" : "warn";
    conds.push({ id: q.id, severity: q.severity as any, method: "llm-judge", result: res as any, ...(r.evidence ? { evidence: r.evidence } : {}) });
  }

  const warnings: any[] = [];
  for (const c of conds) if (c.result === "warn") warnings.push({ type: "condition", id: c.id, ...(c.measure ? { measure: c.measure } : {}), ...(c.evidence ? { evidence: c.evidence } : {}) });
  const used = [...new Set([...provisionalUsed(cfg, rev, gate), ...(pending.consulted ?? [])])].sort();
  const pGates = (id: string) => (cfg.harness.gates.conditions as any[]).find((c) => c.id === id)?.gates ?? [];
  if (pGates("P-1").includes(gate)) for (const key of used) warnings.push({ type: "provisional", key });
  const naProv = conds.filter((c) => c.result === "n/a" && c.mapping === "provisional");
  for (const c of naProv) warnings.push({ type: "na_provisional", id: c.id, reason: c.reason });

  const draft = { ...pending, conditions: conds, warnings, provisional_used: used };
  // P-1 / P-2 는 방금 만든 보고를 독립 계산값과 대조한다
  const ver = verifyReport(cfg, rev, draft);
  if (pGates("P-1").includes(gate)) conds.push({ id: "P-1", severity: "BLOCK", method: "script", result: ver.p1.ok ? "pass" : "block", measure: ver.p1 });
  if (pGates("P-2").includes(gate)) conds.push({ id: "P-2", severity: "BLOCK", method: "script", result: ver.p2.ok ? "pass" : "block", measure: ver.p2 });

  const blocked = conds.filter((c) => c.severity === "BLOCK" && c.result === "block");
  const result = blocked.length ? "block" : "pass";
  delete (draft as any).judge_requests;
  const out: any = { ...draft, result, conditions: conds, judged_at: nowIso(), blocks: blocked.map((c) => c.id) };
  if (result === "pass") out.checkpoint = { files: checkpointFiles(cfg, rev, gate) }; // R7-7
  return { gate_json: out };
}

// P-1: 사용된 provisional 수 = 보고된 provisional WARN 수 / P-2: provisional 매핑 n/a 수 = 보고된 해당 WARN 수
export function verifyReport(cfg: Config, rev: string, g: any) {
  const used = provisionalUsed(cfg, rev, g.gate);
  const reportedProv = new Set((g.warnings ?? []).filter((w: any) => w.type === "provisional").map((w: any) => w.key));
  const missing = used.filter((k) => !reportedProv.has(k));
  const naProv = (g.conditions ?? []).filter((c: any) => c.result === "n/a" && c.mapping === "provisional").map((c: any) => c.id);
  const reportedNa = new Set((g.warnings ?? []).filter((w: any) => w.type === "na_provisional").map((w: any) => w.id));
  const naMissing = naProv.filter((id: string) => !reportedNa.has(id));
  const naNoReason = (g.conditions ?? []).filter((c: any) => c.result === "n/a" && !c.reason).map((c: any) => c.id);
  return {
    p1: { ok: missing.length === 0, used: used.length, reported: reportedProv.size, missing },
    p2: { ok: naMissing.length === 0 && naNoReason.length === 0, na_provisional: naProv.length, reported: reportedNa.size, missing: naMissing, no_reason: naNoReason },
  };
}

// R7-8: checkpoint 대비 경로 집합 + SHA-256 비교
export function diffCheckpoint(cfg: Config, rev: string, files: Record<string, string>) {
  const dirs = new Set(Object.keys(files).map((f) => f.split("/")[0]));
  const now: Record<string, string> = {};
  for (const d of dirs) for (const f of walkFiles(path.join(rev, d), cfg.harness.checkpoint_ignore)) now[`${d}/${f}`] = sha256File(path.join(rev, d, f));
  const added = Object.keys(now).filter((f) => !(f in files));
  const removed = Object.keys(files).filter((f) => !(f in now));
  const changed = Object.keys(files).filter((f) => f in now && now[f] !== files[f]);
  return { ok: !added.length && !removed.length && !changed.length, added, removed, changed };
}

export function verifyImmutable(cfg: Config, runDirAbs: string, run: { revision: number; gate_results: Record<string, any> }) {
  const problems: any[] = [];
  const cur = path.join(runDirAbs, `rev-${run.revision}`);
  for (const g of ["G1", "G2", "G3", "G4"]) {
    if (run.gate_results[g] !== "pass") continue;
    const gp = path.join(cur, "gates", `${g}.json`);
    if (!exists(gp)) continue;
    const d = diffCheckpoint(cfg, cur, readJson(gp).checkpoint?.files ?? {});
    if (!d.ok) problems.push({ revision: run.revision, gate: g, ...d });
  }
  for (let r = 1; r < run.revision; r++) {
    const rd = path.join(runDirAbs, `rev-${r}`);
    const sp = path.join(rd, "gates", "seal.json");
    if (!exists(sp)) {
      problems.push({ revision: r, error: "seal.json 없음" });
      continue;
    }
    const sealed = readJson(sp).files as Record<string, string>;
    const now: Record<string, string> = {};
    for (const f of walkFiles(rd, cfg.harness.checkpoint_ignore)) if (f !== "gates/seal.json") now[f] = sha256File(path.join(rd, f));
    const added = Object.keys(now).filter((f) => !(f in sealed));
    const removed = Object.keys(sealed).filter((f) => !(f in now));
    const changed = Object.keys(sealed).filter((f) => f in now && now[f] !== sealed[f]);
    if (added.length || removed.length || changed.length) problems.push({ revision: r, added, removed, changed });
  }
  return { ok: problems.length === 0, problems };
}

