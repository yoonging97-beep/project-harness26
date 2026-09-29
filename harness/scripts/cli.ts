#!/usr/bin/env node
// 하네스 CLI. 오케스트레이터(메인 Claude)만 실행한다 (R6-4). 사용법: harness/scripts/README.md
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserCheck } from "./lib/browser.ts";
import { loadConfig } from "./lib/config.ts";
import { configCheck, gatesSync } from "./lib/consistency.ts";
import { evaluate, finalize, verifyImmutable, verifyReport } from "./lib/gate.ts";
import { preflight } from "./lib/preflight.ts";
import * as st from "./lib/runstate.ts";
import { scopeCheck, snapshot } from "./lib/scope.ts";
import { exists, HarnessError, nowIso, readFrontmatter, readJson, writeJson } from "./lib/util.ts";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv: string[]) {
  const [cmd, ...rest] = argv;
  const o: Record<string, any> = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) o[k] = true;
      else o[k] = rest[++i];
    } else o._.push(a);
  }
  return { cmd, o };
}

function out(x: unknown, code = 0) {
  process.stdout.write(JSON.stringify(x, null, 2) + "\n");
  process.exitCode = code;
}

function need(o: Record<string, any>, k: string): string {
  if (o[k] === undefined || o[k] === true) throw new HarnessError(`--${k} 가 필요하다`);
  return String(o[k]);
}

async function main() {
  const { cmd, o } = parseArgs(process.argv.slice(2));
  const root = path.resolve(o.root ?? DEFAULT_ROOT);
  const cfg = loadConfig(root);
  const run = () => st.loadRun(cfg, need(o, "run"));
  const rev = (r: st.RunYaml) => st.revDir(cfg, r.run_id, r.revision);
  const evDir = (r: st.RunYaml) => path.join(rev(r), "gates", "evidence");

  switch (cmd) {
    case "preflight": {
      const fids = String(need(o, "feature")).split(",").map((s) => s.trim()).filter(Boolean);
      const r = preflight(cfg, fids, { skipSelftest: !!o["skip-selftest"] });
      return out(r, r.ok ? 0 : 1);
    }
    case "start": {
      const fid = need(o, "feature");
      const pf = preflight(cfg, [fid]);
      if (!pf.ok) return out({ started: false, preflight: pf }, 1);
      const r = st.createRun(cfg, fid);
      return out({ started: true, run_id: r.run_id, revision: r.revision, current_stage: r.current_stage });
    }
    case "status": {
      if (o.run) return out(run());
      return out(st.listRuns(cfg).map((r) => ({ run_id: r.run_id, feature_id: r.feature_id, status: r.status, waiting_for: r.waiting_for, revision: r.revision, current_stage: r.current_stage, gate_results: r.gate_results })));
    }
    case "snapshot": {
      const r = run();
      const stage = need(o, "stage");
      const dir = path.join(rev(r), "gates", "scope");
      const n = fs.readdirSync(dir).filter((f) => f.startsWith(`${stage}-`) && f.endsWith(".pre.json")).length + 1;
      const file = path.join(dir, `${stage}-${n}.pre.json`);
      writeJson(file, snapshot(cfg.root));
      return out({ snapshot: path.relative(cfg.root, file), attempt: n });
    }
    case "scope-check": {
      const r = run();
      const stage = need(o, "stage");
      const dir = path.join(rev(r), "gates", "scope");
      const pres = fs.readdirSync(dir).filter((f) => f.startsWith(`${stage}-`) && f.endsWith(".pre.json")).sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));
      if (!pres.length) throw new HarnessError("snapshot 이 없다 (R7-2: 에이전트 호출 전에 snapshot)");
      const last = pres[pres.length - 1];
      const pre = readJson(path.join(dir, last));
      const post = snapshot(cfg.root);
      const scopeRel = path.relative(cfg.root, path.join(rev(r), cfg.harness.run.stage_dir[stage])) + "/";
      const res = scopeCheck(pre, post, [scopeRel]);
      writeJson(path.join(dir, last.replace(".pre.json", ".result.json")), { ...res, scope: scopeRel, checked_at: nowIso() });
      if (!res.ok) {
        // R6-1: BLOCK + 파일 목록 기록, R7: escalation. restore 하지 않는다.
        const gate = cfg.harness.run.stage_gate[stage];
        writeJson(path.join(rev(r), "gates", `${gate}.json`), { gate, run_id: r.run_id, revision: r.revision, result: "block", blocks: ["SCOPE"], conditions: [{ id: "SCOPE", severity: "BLOCK", method: "script", result: "block", measure: res }], judged_at: nowIso() });
        r.gate_results[gate] = "block";
        r.blocked_stage = stage;
        r.status = "paused";
        r.waiting_for = "escalation";
        r.history.push({ at: nowIso(), event: "scope_violation", detail: { stage, outside: res.outside } });
        st.saveRun(cfg, r);
      }
      return out({ scope: scopeRel, ...res }, res.ok ? 0 : 1);
    }
    case "wait-b0": {
      const r = run();
      const q = readFrontmatter(path.join(rev(r), "s1", "questions.md")).data?.questions ?? [];
      if (q.length === 0) return out({ b0: "skip", questions: 0 }); // R3-7
      st.saveRun(cfg, st.waitFor(r, "B0"));
      return out({ b0: "waiting", questions: q.map((x: any) => x.id) });
    }
    case "submit-answers": {
      const r = st.submitAnswers(cfg, run());
      st.saveRun(cfg, r);
      return out({ status: r.status, current_stage: r.current_stage });
    }
    case "gate": {
      const r = run();
      const gate = need(o, "gate");
      if (r.status !== "running") throw new HarnessError(`running 상태에서만 판정한다: ${r.status}/${r.waiting_for}`);
      const pending = evaluate(cfg, rev(r), r, gate);
      writeJson(path.join(evDir(r), `${gate}.pending.json`), pending);
      if (pending.judge_requests.length === 0) {
        const fin = finalize(cfg, rev(r), pending, [], true);
        writeJson(path.join(rev(r), "gates", `${gate}.json`), fin.gate_json);
        st.saveRun(cfg, st.applyGateResult(cfg, r, gate, fin.gate_json.result, o["return-to"]));
        return out({ gate, result: fin.gate_json.result, blocks: fin.gate_json.blocks, judge_needed: false, run: summary(st.loadRun(cfg, r.run_id)) }, fin.gate_json.result === "pass" ? 0 : 1);
      }
      return out({ gate, judge_needed: true, pending: path.relative(cfg.root, path.join(evDir(r), `${gate}.pending.json`)), judge_requests: pending.judge_requests.map((q: any) => q.id), script_blocks: pending.conditions.filter((c: any) => c.result === "block").map((c: any) => c.id) });
    }
    case "gate-finalize": {
      const r = run();
      const gate = need(o, "gate");
      const pending = readJson(path.join(evDir(r), `${gate}.pending.json`));
      const judgeFile = path.resolve(need(o, "judge"));
      const judge = readJson(judgeFile);
      const fin: any = finalize(cfg, rev(r), pending, judge, !!o.final);
      if (fin.needs_rejudge) return out({ gate, needs_rejudge: fin.needs_rejudge, next: "gate-judge 재판정 후 --final 로 다시 실행 (R7-3)" }, 2);
      writeJson(path.join(rev(r), "gates", `${gate}.json`), fin.gate_json);
      st.saveRun(cfg, st.applyGateResult(cfg, r, gate, fin.gate_json.result, o["return-to"]));
      return out({ gate, result: fin.gate_json.result, blocks: fin.gate_json.blocks, warnings: fin.gate_json.warnings.length, run: summary(st.loadRun(cfg, r.run_id)) }, fin.gate_json.result === "pass" ? 0 : 1);
    }
    case "can-start-s4": {
      const r = run();
      const missing = st.missingDecisions(cfg, r);
      return out({ ok: missing.length === 0, missing }, missing.length ? 1 : 0);
    }
    case "escalation": {
      const choice = Number(need(o, "choice")) as 1 | 2 | 3;
      if (![1, 2, 3].includes(choice)) throw new HarnessError("--choice 는 1, 2, 3 중 하나 (R3-12)");
      const r = st.escalationResponse(cfg, run(), choice, o.note === true ? undefined : o.note);
      st.saveRun(cfg, r);
      return out(summary(r));
    }
    case "pause": {
      const r = st.pauseRun(run());
      st.saveRun(cfg, r);
      return out(summary(r));
    }
    case "resume": {
      const res = st.resumeRun(cfg, run());
      st.saveRun(cfg, res.run);
      return out({ ...summary(res.run), baseline_changed: res.changed });
    }
    case "approval-check": {
      const text = need(o, "text");
      const ok = st.isExplicitApproval(cfg, text);
      return out({ text, explicit_final_approval: ok }, ok ? 0 : 1);
    }
    case "final-report": {
      const r = run();
      if (!(r.status === "paused" && r.waiting_for === "final_approval")) throw new HarnessError("최종 승인 대기 상태가 아니다");
      const gates = ["G1", "G2", "G3", "G4"].map((g) => readJson(path.join(rev(r), "gates", `${g}.json`)));
      const report = {
        run_id: r.run_id,
        feature_id: r.feature_id,
        "1_blocks": gates.map((g) => ({ gate: g.gate, result: g.result, blocks: g.blocks })),
        "2_warn_conditions": gates.flatMap((g) => g.warnings.filter((w: any) => w.type === "condition").map((w: any) => ({ gate: g.gate, ...w }))),
        "3_provisional_used": [...new Set(gates.flatMap((g) => g.warnings.filter((w: any) => w.type === "provisional").map((w: any) => w.key)))].sort(),
        "4_na_provisional": gates.flatMap((g) => g.warnings.filter((w: any) => w.type === "na_provisional").map((w: any) => ({ gate: g.gate, id: w.id }))),
        "5_decisions_and_questions": {
          decision: readFrontmatter(path.join(rev(r), "s1", "answers.md")).data?.decision ?? {},
          questions: readFrontmatter(path.join(rev(r), "s1", "questions.md")).data?.questions ?? [],
        },
        "6_notice": "최종 승인하려면 명시적으로 승인해 주세요. 예: \"" + r.run_id + " 최종 승인합니다\"",
        generated_at: nowIso(),
      };
      writeJson(path.join(evDir(r), "final-report.json"), report);
      return out(report);
    }
    case "final-approve": {
      const r = run();
      const text = need(o, "text");
      const shown = exists(path.join(evDir(r), "final-report.json")); // R7-5
      const done = st.finalApprove(cfg, r, text, shown);
      st.saveRun(cfg, done);
      return out(summary(done));
    }
    case "verify-immutable": {
      const r = run();
      const res = verifyImmutable(cfg, st.runDir(cfg, r.run_id), r);
      return out(res, res.ok ? 0 : 1);
    }
    case "verify-report": {
      const r = run();
      const gate = need(o, "gate");
      const res = verifyReport(cfg, rev(r), readJson(path.join(rev(r), "gates", `${gate}.json`)));
      return out(res, res.p1.ok && res.p2.ok ? 0 : 1);
    }
    case "test-app": {
      const r = run();
      const app = path.join(rev(r), "s4", "app");
      const outFile = path.join(evDir(r), "G4-tests.json");
      const res = spawnSync("npm", ["run", "test:harness"], { cwd: app, env: { ...process.env, HARNESS_TEST_OUTPUT: outFile }, encoding: "utf8" });
      return out({ exit: res.status, evidence: exists(outFile) ? path.relative(cfg.root, outFile) : null, stderr: res.stderr?.slice(-2000) }, exists(outFile) ? 0 : 1);
    }
    case "browser-check": {
      const r = run();
      const res = await browserCheck(cfg, rev(r), need(o, "url"));
      return out({ screens: res.screens.length, evidence: "gates/evidence/G4-browser.json" });
    }
    case "config-check": {
      const res = configCheck(cfg);
      return out(res, res.ok ? 0 : 1);
    }
    case "gates-sync": {
      const res = gatesSync(cfg);
      return out(res, res.ok ? 0 : 1);
    }
    default:
      return out({ error: `알 수 없는 명령: ${cmd}`, see: "harness/scripts/README.md" }, 2);
  }
}

function summary(r: st.RunYaml) {
  return { run_id: r.run_id, status: r.status, waiting_for: r.waiting_for, revision: r.revision, current_stage: r.current_stage, retry: r.retry, supervised_retry: r.supervised_retry, gate_results: r.gate_results };
}

main().catch((e) => {
  if (e instanceof HarnessError) out({ error: e.message }, 1);
  else {
    process.stderr.write(String(e?.stack ?? e) + "\n");
    process.exitCode = 3;
  }
});
