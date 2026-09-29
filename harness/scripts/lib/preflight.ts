// 실행 전 검사 (R2-1, R2-3, R4-10, R4-11, R7-1, R8-5)
import path from "node:path";
import { type Config, configHashes } from "./config.ts";
import { activeRuns } from "./runstate.ts";
import { exists, git, readFrontmatter, readJson, readText } from "./util.ts";

export type Check = { id: string; ok: boolean; detail?: any };

export function preflight(cfg: Config, featureIds: string[], opts: { skipSelftest?: boolean } = {}): { ok: boolean; checks: Check[] } {
  const checks: Check[] = [];
  const root = cfg.root;

  // R2-1: 기능 ID 정확히 1개, PRD 에 존재
  const prd = readText(path.join(root, cfg.harness.documents.baseline.prd));
  const fid = featureIds[0];
  checks.push({ id: "R2-1 기능 ID 1개", ok: featureIds.length === 1, detail: featureIds });
  if (featureIds.length === 1)
    checks.push({ id: "기능 ID 가 PRD 에 있음", ok: new RegExp(`^###\\s+${fid.replace(".", "\\.")}\\s`, "m").test(prd), detail: fid });

  // R4-10: 요청서
  const rp = path.join(root, cfg.harness.paths.requests, `${fid}.md`);
  if (!exists(rp)) checks.push({ id: "R4-10 요청서", ok: false, detail: `없음: ${path.relative(root, rp)}` });
  else {
    const { data, body } = readFrontmatter(rp);
    const miss: string[] = [];
    for (const k of cfg.harness.request.required_frontmatter) if (!data?.[k]) miss.push(`frontmatter.${k}`);
    for (const k of cfg.harness.request.forbidden_frontmatter) if (data && k in data) miss.push(`금지 필드 ${k} (R4-9)`);
    if (data?.feature_id !== undefined && String(data.feature_id) !== fid) miss.push(`feature_id 불일치: ${data.feature_id}`);
    for (const s of cfg.harness.request.required_sections) if (!new RegExp(`^##\\s+${s}\\s*$`, "m").test(body)) miss.push(`섹션 ## ${s}`);
    checks.push({ id: "R4-10 요청서", ok: miss.length === 0, detail: miss.length ? miss : path.relative(root, rp) });
  }

  // R4-11 / R2-3: 기준 문서 confirmed + uncommitted 0 + commit hash
  for (const [k, rel] of Object.entries(cfg.harness.documents.baseline) as [string, string][]) {
    const abs = path.join(root, rel);
    const status = exists(abs) ? readFrontmatter(abs).data?.status : undefined;
    checks.push({ id: `R4-11 ${k} status: confirmed`, ok: status === "confirmed", detail: status ?? "status 없음" });
    const dirty = git(root, ["status", "--porcelain", "--", rel]).trim();
    checks.push({ id: `R4-11 ${k} uncommitted 0`, ok: dirty === "", detail: dirty || "clean" });
    const hash = git(root, ["log", "-1", "--format=%H", "--", rel]).trim();
    checks.push({ id: `R2-3 ${k} commit hash`, ok: hash.length === 40, detail: hash || "커밋 기록 없음" });
  }

  // R7-1: active 실행 0개
  const active = activeRuns(cfg);
  checks.push({ id: "R7-1 active 실행 0", ok: active.length === 0, detail: active.map((r) => `${r.run_id}:${r.status}`) });

  // R8-5: self-test 통과 + 그 뒤 config 변경 없음
  if (!opts.skipSelftest) {
    const sp = path.join(root, "harness", "tests", "last-result.json");
    if (!exists(sp)) checks.push({ id: "R8-5 self-test", ok: false, detail: "결과 없음: node harness/tests/run.ts" });
    else {
      const r = readJson(sp);
      const sameCfg = JSON.stringify(r.config_hashes) === JSON.stringify(configHashes(root));
      checks.push({ id: "R8-5 self-test", ok: r.failed === 0 && sameCfg, detail: { failed: r.failed, config_unchanged: sameCfg, at: r.at } });
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}
