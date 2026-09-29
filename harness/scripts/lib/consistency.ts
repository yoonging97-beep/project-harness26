// config 규칙 검사 (R4-3, R4-5, R4-6) 와 05-gates.md ↔ harness.yaml 동기화 검사 (self-test T0)
import path from "node:path";
import { allLeaves, type Config } from "./config.ts";
import { readText } from "./util.ts";

export function configCheck(cfg: Config) {
  const problems: any[] = [];
  // R4-3: config 파일 사이 중복 최상위 키
  const tops = [
    ["design-tokens", Object.keys(cfg.tokens)],
    ["policy", Object.keys(cfg.policy)],
    ["harness", Object.keys(cfg.harness)],
  ] as const;
  const seen = new Map<string, string>();
  for (const [file, keys] of tops)
    for (const k of keys) {
      if (seen.has(k)) problems.push({ rule: "R4-3", key: k, files: [seen.get(k), file] });
      seen.set(k, file);
    }
  // R4-5 / R4-6: tokens·policy leaf 메타데이터
  for (const [file, obj] of [["design-tokens", cfg.tokens], ["policy", cfg.policy]] as const)
    for (const { path: p, node } of allLeaves(obj)) {
      const miss = ["value", "status", "origin"].filter((k) => !(k in node));
      if (miss.length) problems.push({ rule: "R4-5", file, leaf: p, missing: miss });
      if (node.status && !["confirmed", "provisional"].includes(node.status)) problems.push({ rule: "R4-5", file, leaf: p, status: node.status });
      if (node.origin === "claude-default" && node.status === "confirmed") problems.push({ rule: "R4-6", file, leaf: p });
    }
  return { ok: problems.length === 0, problems };
}

// 05-gates.md 표의 조건 행에서 id / severity / method 를 읽어 harness.yaml 과 비교한다.
export function gatesSync(cfg: Config) {
  const md = readText(path.join(cfg.root, "harness", "05-gates.md"));
  const fromMd = new Map<string, { severity: string; method: string }>();
  for (const line of md.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const id = cells[1].replace(/[^\w-].*$/u, "").trim();
    if (!/^(C-\d[ab]?|P-\d|G[1-4]-\d+)$/.test(id)) continue;
    if (cells[1].includes("~~")) continue; // 취소선 행
    const sev = cells.find((c) => /^\**(BLOCK|WARN)\**$/.test(c))?.replace(/\*/g, "");
    const method = cells.find((c) => /^(script|llm-judge)$/.test(c));
    if (sev && method) fromMd.set(id, { severity: sev, method });
  }
  const fromYaml = new Map<string, { severity: string; method: string }>(
    (cfg.harness.gates.conditions as any[]).map((c) => [c.id, { severity: c.severity, method: c.method }]),
  );
  const problems: any[] = [];
  for (const [id, m] of fromMd) {
    const y = fromYaml.get(id);
    if (!y) problems.push({ id, issue: "harness.yaml 에 없음" });
    else if (y.severity !== m.severity || y.method !== m.method) problems.push({ id, md: m, yaml: y });
  }
  for (const id of fromYaml.keys()) if (!fromMd.has(id)) problems.push({ id, issue: "05-gates.md 에 없음" });
  return { ok: problems.length === 0, md_conditions: fromMd.size, yaml_conditions: fromYaml.size, problems };
}
