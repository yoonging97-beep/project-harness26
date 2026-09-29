// config 3개 로드와 leaf(value/status/origin) 접근. 규칙 값은 여기서만 읽는다 (R4-4).
import path from "node:path";
import { readYaml, sha256File } from "./util.ts";

export type Leaf = { value: any; status: "confirmed" | "provisional"; origin: string };

export type Config = {
  root: string;
  tokens: any;
  policy: any;
  harness: any;
  // 이번 판정에서 읽은 provisional leaf 경로 (P-1)
  consulted: Set<string>;
};

export function loadConfig(root: string): Config {
  const dir = path.join(root, "harness", "config");
  return {
    root,
    tokens: readYaml(path.join(dir, "design-tokens.yaml")),
    policy: readYaml(path.join(dir, "policy.yaml")),
    harness: readYaml(path.join(dir, "harness.yaml")),
    consulted: new Set(),
  };
}

export function isLeaf(x: any): x is Leaf {
  return x !== null && typeof x === "object" && "value" in x && "status" in x && "origin" in x;
}

// "tokens:color.primary" 형식 경로로 leaf 조회. provisional 이면 consulted 에 기록한다.
export function leaf(cfg: Config, ref: string): Leaf {
  const [file, dotted] = ref.split(":");
  let node: any = file === "tokens" ? cfg.tokens : file === "policy" ? cfg.policy : undefined;
  for (const k of dotted.split(".")) node = node?.[k];
  if (!isLeaf(node)) throw new Error(`config leaf 없음: ${ref}`);
  if (node.status === "provisional") cfg.consulted.add(ref);
  return node;
}

export function val(cfg: Config, ref: string): any {
  return leaf(cfg, ref).value;
}

// 그룹 아래 leaf 키 목록 (예: tokens:color → [bg, surface, ...])
export function leafKeys(cfg: Config, group: string): string[] {
  const [file, dotted] = group.split(":");
  let node: any = file === "tokens" ? cfg.tokens : cfg.policy;
  for (const k of dotted.split(".")) node = node?.[k];
  return Object.keys(node ?? {}).filter((k) => isLeaf(node[k]));
}

// 메타데이터 대상 leaf 전체 순회 (R4-5, R4-6 검사용)
export function allLeaves(obj: any, prefix = ""): { path: string; node: any }[] {
  const out: { path: string; node: any }[] = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return out;
  if ("value" in obj || "status" in obj || "origin" in obj) return [{ path: prefix, node: obj }];
  for (const [k, v] of Object.entries(obj)) out.push(...allLeaves(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

export function configHashes(root: string): Record<string, string> {
  const dir = path.join(root, "harness", "config");
  return {
    design_tokens: sha256File(path.join(dir, "design-tokens.yaml")),
    policy: sha256File(path.join(dir, "policy.yaml")),
    harness: sha256File(path.join(dir, "harness.yaml")),
  };
}
