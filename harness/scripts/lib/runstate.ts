// 실행 상태(run.yaml)와 상태 전이. R3 retry·escalation, R4 재개, R6 최종 승인, R7 active 실행.
import nodefs from "node:fs";
import path from "node:path";
import { type Config, configHashes, val } from "./config.ts";
import { exists, fail, git, nowIso, readFrontmatter, readYaml, sha256File, walkFiles, writeJson, writeYaml } from "./util.ts";

export type RunYaml = {
  run_id: string;
  feature_id: string;
  status: "running" | "paused" | "completed" | "aborted";
  waiting_for: null | "B0" | "escalation" | "final_approval";
  revision: number;
  current_stage: "S1" | "S2" | "S3" | "S4" | null;
  retry: { stage: Record<string, number>; total: number };
  supervised_retry: number;
  supervised_active: boolean;
  blocked_stage: string | null;
  gate_results: Record<string, null | "pass" | "block">;
  baseline: { prd: string; story_service: string; design: string; config: Record<string, string> };
  history: { at: string; event: string; detail?: any }[];
};

export function runsDir(cfg: Config): string {
  return path.join(cfg.root, cfg.harness.paths.runs);
}

export function runDir(cfg: Config, runId: string): string {
  return path.join(runsDir(cfg), runId);
}

export function revDir(cfg: Config, runId: string, revision: number): string {
  return path.join(runDir(cfg, runId), `rev-${revision}`);
}

export function loadRun(cfg: Config, runId: string): RunYaml {
  const p = path.join(runDir(cfg, runId), "run.yaml");
  if (!exists(p)) fail(`실행 없음: ${runId}`);
  return readYaml(p);
}

export function saveRun(cfg: Config, run: RunYaml): void {
  const allowed = [null, ...cfg.harness.run.waiting_for];
  if (!allowed.includes(run.waiting_for)) fail(`waiting_for 허용값 아님: ${run.waiting_for}`); // R4-12
  if (run.waiting_for !== null && run.status !== "paused") fail("waiting_for 가 있으면 status 는 paused 여야 한다"); // R4-13
  writeYaml(path.join(runDir(cfg, run.run_id), "run.yaml"), run);
}

function log(run: RunYaml, event: string, detail?: any) {
  run.history.push({ at: nowIso(), event, ...(detail === undefined ? {} : { detail }) });
}

export function listRuns(cfg: Config): RunYaml[] {
  const d = runsDir(cfg);
  if (!exists(d)) return [];
  return nodefs
    .readdirSync(d)
    .filter((n) => n.startsWith(cfg.harness.run.id_prefix) && exists(path.join(d, n, "run.yaml")))
    .sort()
    .map((n) => readYaml(path.join(d, n, "run.yaml")));
}

export function activeRuns(cfg: Config): RunYaml[] {
  return listRuns(cfg).filter((r) => cfg.harness.run.active_statuses.includes(r.status)); // R7-1
}

// 기준 문서: 마지막으로 그 파일을 바꾼 commit hash
export function docCommit(root: string, rel: string): string {
  return git(root, ["log", "-1", "--format=%H", "--", rel]).trim();
}

export function currentBaseline(cfg: Config): RunYaml["baseline"] {
  const b = cfg.harness.documents.baseline;
  return {
    prd: docCommit(cfg.root, b.prd),
    story_service: docCommit(cfg.root, b.story_service),
    design: docCommit(cfg.root, b.design),
    config: configHashes(cfg.root),
  };
}

function stageDirs(cfg: Config, runId: string, revision: number) {
  const rd = revDir(cfg, runId, revision);
  for (const s of Object.values(cfg.harness.run.stage_dir) as string[]) nodefs.mkdirSync(path.join(rd, s), { recursive: true });
  nodefs.mkdirSync(path.join(rd, "gates", "evidence"), { recursive: true }); // R8-3
  nodefs.mkdirSync(path.join(rd, "gates", "scope"), { recursive: true });
}

// start_run (preflight 통과 후 호출)
export function createRun(cfg: Config, featureId: string): RunYaml {
  const existing = listRuns(cfg).map((r) => parseInt(r.run_id.slice(cfg.harness.run.id_prefix.length), 10));
  const n = (existing.length ? Math.max(...existing) : 0) + 1;
  const runId = cfg.harness.run.id_prefix + String(n).padStart(cfg.harness.run.id_digits, "0");
  const rd = runDir(cfg, runId);
  nodefs.mkdirSync(rd, { recursive: true });
  // R8-1: 요청서 원본을 복사
  const src = path.join(cfg.root, cfg.harness.paths.requests, `${featureId}.md`);
  nodefs.copyFileSync(src, path.join(rd, "request.md"));
  stageDirs(cfg, runId, 1);
  const stages = cfg.harness.run.stages as string[];
  const run: RunYaml = {
    run_id: runId,
    feature_id: featureId,
    status: "running",
    waiting_for: null,
    revision: 1,
    current_stage: "S1",
    retry: { stage: Object.fromEntries(stages.map((s) => [s, 0])), total: 0 },
    supervised_retry: 0,
    supervised_active: false,
    blocked_stage: null,
    gate_results: { G1: null, G2: null, G3: null, G4: null },
    baseline: currentBaseline(cfg),
    history: [],
  };
  log(run, "start_run", { feature_id: featureId, request_sha256: sha256File(src) });
  saveRun(cfg, run);
  return run;
}

const STAGE_INDEX: Record<string, number> = { S1: 0, S2: 1, S3: 2, S4: 3 };

function stageOfGate(cfg: Config, gate: string): string {
  const sg = cfg.harness.run.stage_gate as Record<string, string>;
  return Object.keys(sg).find((s) => sg[s] === gate)!;
}

function invalidateFrom(cfg: Config, run: RunYaml, stage: string) {
  const sg = cfg.harness.run.stage_gate as Record<string, string>;
  for (const [s, g] of Object.entries(sg)) if (STAGE_INDEX[s] >= STAGE_INDEX[stage]) run.gate_results[g] = null; // R3-6
}

// 이전 revision 봉인: 모든 파일의 sha256 을 gates/seal.json 에 남긴다 (R4-2 검사용)
function sealRevision(cfg: Config, run: RunYaml) {
  const rd = revDir(cfg, run.run_id, run.revision);
  const files: Record<string, string> = {};
  for (const f of walkFiles(rd, cfg.harness.checkpoint_ignore)) if (f !== "gates/seal.json") files[f] = sha256File(path.join(rd, f));
  writeJson(path.join(rd, "gates", "seal.json"), { revision: run.revision, sealed_at: nowIso(), files });
}

function bumpRevision(cfg: Config, run: RunYaml, reason: string, detail?: any) {
  sealRevision(cfg, run);
  run.revision += 1;
  stageDirs(cfg, run.run_id, run.revision);
  run.gate_results = { G1: null, G2: null, G3: null, G4: null }; // R3-14
  // 새 revision 은 새 요구사항 기준이므로 일반 retry 를 0 부터 센다. supervised 는 실행당 1회 유지.
  run.retry = { stage: { S1: 0, S2: 0, S3: 0, S4: 0 }, total: 0 };
  run.supervised_active = false;
  run.blocked_stage = null;
  run.current_stage = "S1";
  log(run, "revision_bump", { revision: run.revision, reason, ...(detail ? { detail } : {}) });
}

// 게이트 결과 반영. result 는 게이트 전체 결과.
export function applyGateResult(cfg: Config, run: RunYaml, gate: string, result: "pass" | "block", returnTo?: string): RunYaml {
  if (run.status !== "running") fail(`running 이 아닌 실행에 게이트 결과를 반영할 수 없다: ${run.status}`);
  const stage = stageOfGate(cfg, gate);
  run.gate_results[gate] = result;
  if (result === "pass") {
    if (run.supervised_active && run.blocked_stage === stage) run.supervised_active = false;
    if (run.blocked_stage === stage) run.blocked_stage = null;
    const next = cfg.harness.run.stages[STAGE_INDEX[stage] + 1];
    if (next) {
      run.current_stage = next;
      log(run, "gate_pass", { gate });
    } else {
      run.current_stage = null;
      run.status = "paused";
      run.waiting_for = "final_approval";
      log(run, "gate_pass", { gate, next: "final_approval" });
    }
    return run;
  }
  // block
  if (run.supervised_active) {
    run.status = "aborted"; // R3-13
    run.waiting_for = null;
    log(run, "aborted", { reason: "supervised retry 에서 다시 BLOCK", gate });
    return run;
  }
  const limStage = cfg.harness.retry.stage as number;
  const limTotal = cfg.harness.retry.total as number;
  run.blocked_stage = stage;
  if (run.retry.stage[stage] >= limStage || run.retry.total >= limTotal) {
    run.status = "paused"; // R3-5, R3-11
    run.waiting_for = "escalation";
    log(run, "escalation", { gate, stage_retry: run.retry.stage[stage], total_retry: run.retry.total });
    return run;
  }
  run.retry.stage[stage] += 1; // R3-10: BLOCK 낸 단계에 귀속
  run.retry.total += 1;
  const target = returnTo ?? stage;
  if (STAGE_INDEX[target] === undefined || STAGE_INDEX[target] > STAGE_INDEX[stage]) fail(`return_to 가 올바르지 않다: ${target}`);
  invalidateFrom(cfg, run, target);
  run.current_stage = target as RunYaml["current_stage"];
  log(run, "gate_block", { gate, retry_stage: stage, return_to: target });
  return run;
}

export function escalationResponse(cfg: Config, run: RunYaml, choice: 1 | 2 | 3, note?: string): RunYaml {
  if (!(run.status === "paused" && run.waiting_for === "escalation")) fail("escalation 대기 상태가 아니다");
  if (choice === 1) {
    if (run.supervised_retry >= cfg.harness.retry.supervised) fail("supervised retry 는 실행당 1회뿐이다 (R3-13)");
    if (!note) fail("① 은 수정 방향이 필요하다");
    run.supervised_retry += 1;
    run.supervised_active = true;
    run.status = "running";
    run.waiting_for = null;
    run.current_stage = run.blocked_stage as RunYaml["current_stage"];
    log(run, "escalation_1", { note });
  } else if (choice === 2) {
    if (!note) fail("② 는 변경할 요구사항·정책이 필요하다");
    run.status = "running";
    run.waiting_for = null;
    bumpRevision(cfg, run, "escalation_2", { note });
  } else {
    run.status = "aborted";
    run.waiting_for = null;
    log(run, "escalation_3");
  }
  return run;
}

export function waitFor(run: RunYaml, what: "B0" | "final_approval"): RunYaml {
  run.status = "paused";
  run.waiting_for = what;
  log(run, "wait", { for: what });
  return run;
}

export function submitAnswers(cfg: Config, run: RunYaml): RunYaml {
  if (!(run.status === "paused" && run.waiting_for === "B0")) fail("B0 대기 상태가 아니다");
  const s1 = path.join(revDir(cfg, run.run_id, run.revision), "s1");
  const q = readFrontmatter(path.join(s1, "questions.md")).data?.questions ?? [];
  const ap = path.join(s1, "answers.md");
  const a = exists(ap) ? readFrontmatter(ap).data?.answers ?? [] : [];
  const answered = new Set(a.map((x: any) => x.id));
  const missing = q.filter((x: any) => !answered.has(x.id)).map((x: any) => x.id);
  if (missing.length) fail(`답변 없는 질문: ${missing.join(", ")}`);
  run.status = "running";
  run.waiting_for = null;
  log(run, "answers_submitted", { count: q.length });
  return run;
}

export function pauseRun(run: RunYaml): RunYaml {
  if (run.status !== "running") fail("running 실행만 멈출 수 있다");
  run.status = "paused";
  run.waiting_for = null;
  log(run, "pause");
  return run;
}

// R4 재개 절차
export function resumeRun(cfg: Config, run: RunYaml, baselineNow = currentBaseline(cfg)): { run: RunYaml; changed: string[] } {
  if (cfg.harness.run.terminal_statuses.includes(run.status)) fail(`${run.status} 실행은 재개하지 않는다 (R4-7)`);
  if (run.status !== "paused") fail("paused 실행만 재개한다");
  if (run.waiting_for !== null) fail(`사람 입력 대기 중이다: ${run.waiting_for}`);
  const changed: string[] = [];
  for (const k of ["prd", "story_service", "design"] as const) if (run.baseline[k] !== baselineNow[k]) changed.push(k);
  for (const k of Object.keys(baselineNow.config)) if (run.baseline.config?.[k] !== baselineNow.config[k]) changed.push(`config.${k}`);
  run.status = "running";
  if (changed.length) {
    bumpRevision(cfg, run, "baseline_changed", { changed }); // R4-8, R8-4
    run.baseline = baselineNow;
  } else {
    // checkpoint = 마지막 PASS 게이트 → 그 다음 단계 처음부터 (R4-14)
    const order = ["G1", "G2", "G3", "G4"];
    let lastPass = -1;
    for (let i = 0; i < order.length; i++) if (run.gate_results[order[i]] === "pass") lastPass = i;
    else break;
    run.current_stage = (cfg.harness.run.stages[lastPass + 1] ?? null) as RunYaml["current_stage"];
    log(run, "resume", { from: run.current_stage });
  }
  return { run, changed };
}

// R6-7 (R8 보완): 필요한 기술 결정이 answers.md 에 모두 있어야 S4 시작
export function missingDecisions(cfg: Config, run: RunYaml): string[] {
  const req = (val(cfg, "policy:required_technical_decisions") as any[]).filter((d) => d.applies_to.includes(run.feature_id));
  const ap = path.join(revDir(cfg, run.run_id, run.revision), "s1", "answers.md");
  const decision = exists(ap) ? readFrontmatter(ap).data?.decision ?? {} : {};
  return req.filter((d) => decision[d.id] === undefined || decision[d.id] === null || decision[d.id] === "").map((d) => d.id);
}

// R6-6: 명시적 최종 승인 표현만 인정
export function isExplicitApproval(cfg: Config, text: string): boolean {
  const a = cfg.harness.approval;
  const t = text.trim();
  if (!a.explicit_patterns.some((p: string) => t.includes(p))) return false;
  return !a.negations.some((n: string) => t.includes(n));
}

export function finalApprove(cfg: Config, run: RunYaml, text: string, reportShown: boolean): RunYaml {
  if (!(run.status === "paused" && run.waiting_for === "final_approval")) fail("최종 승인 대기 상태가 아니다 (R6-6)");
  if (!isExplicitApproval(cfg, text)) fail("명시적 최종 승인 표현이 아니다 (R6-6)");
  if (!reportShown) fail("최종 보고 6항목을 먼저 보여 줘야 한다 (R7-5)");
  run.status = "completed";
  run.waiting_for = null;
  log(run, "completed", { approval_text: text });
  return run;
}

