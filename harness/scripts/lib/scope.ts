// write scope 사후 검사 (R6-1). 자동 restore 하지 않는다 (R7-4).
// snapshot = git status 에 나타난 경로 → 현재 파일 sha256 ("deleted" = 없음)
import path from "node:path";
import { exists, git, sha256File } from "./util.ts";

export type Snapshot = { taken_at: string; files: Record<string, string> };

export function snapshot(root: string): Snapshot {
  const out = git(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const parts = out.split("\0").filter(Boolean);
  const files: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const p = parts[i].slice(3);
    if (code.startsWith("R") || code.startsWith("C")) i++; // -z 에서 rename 원본 경로가 다음 항목
    const abs = path.join(root, p);
    files[p] = exists(abs) ? sha256File(abs) : "deleted";
  }
  return { taken_at: new Date().toISOString(), files };
}

export function scopeCheck(pre: Snapshot, post: Snapshot, allowedPrefixes: string[]) {
  const keys = new Set([...Object.keys(pre.files), ...Object.keys(post.files)]);
  const changed = [...keys].filter((k) => pre.files[k] !== post.files[k]).sort();
  const outside = changed
    .filter((k) => !allowedPrefixes.some((p) => k.startsWith(p)))
    .map((k) => ({ path: k, pre_existing_change: k in pre.files }));
  return { ok: outside.length === 0, changed: changed.length, outside };
}
