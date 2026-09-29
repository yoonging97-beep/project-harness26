// 공용 유틸: 파일, YAML, frontmatter, 해시, 디렉터리 순회, git.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export function exists(p: string): boolean {
  return fs.existsSync(p);
}

export function readText(p: string): string {
  return fs.readFileSync(p, "utf8");
}

export function writeText(p: string, s: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}

export function readYaml(p: string): any {
  return YAML.parse(readText(p));
}

export function writeYaml(p: string, data: unknown): void {
  writeText(p, YAML.stringify(data, { lineWidth: 0 }));
}

export function readJson(p: string): any {
  return JSON.parse(readText(p));
}

export function writeJson(p: string, data: unknown): void {
  writeText(p, JSON.stringify(data, null, 2) + "\n");
}

// Markdown frontmatter (--- yaml ---). 없으면 data = null.
export function readFrontmatter(p: string): { data: any; body: string } {
  const s = readText(p);
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: null, body: s };
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

export function sha256File(p: string): string {
  return "sha256:" + createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

// ignore 패턴: "dir/" = 경로 조각이 dir 인 디렉터리, "*.ext" = 확장자, 그 외 = 파일 이름.
export function isIgnored(rel: string, ignore: string[]): boolean {
  const parts = rel.split("/");
  const base = parts[parts.length - 1];
  for (const pat of ignore) {
    if (pat.endsWith("/")) {
      if (parts.slice(0, -1).includes(pat.slice(0, -1))) return true;
    } else if (pat.startsWith("*.")) {
      if (base.endsWith(pat.slice(1))) return true;
    } else if (base === pat) {
      return true;
    }
  }
  return false;
}

// dir 아래 모든 파일의 상대 경로 (정렬). ignore 목록 제외.
export function walkFiles(dir: string, ignore: string[] = []): string[] {
  const out: string[] = [];
  if (!exists(dir)) return out;
  const rec = (d: string, prefix: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!isIgnored(rel + "/x", ignore)) rec(path.join(d, ent.name), rel);
      } else if (!isIgnored(rel, ignore)) {
        out.push(rel);
      }
    }
  };
  rec(dir, "");
  return out.sort();
}

export function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function fail(msg: string): never {
  throw new HarnessError(msg);
}

export class HarnessError extends Error {}
