// C-1 / C-2 / C-3 후보 탐지 (R5 3장). 결과는 후보일 뿐이며, 단독으로 BLOCK 근거가 되지 않는다 (R5-6).
import path from "node:path";
import { type Config, val } from "./config.ts";
import { exists, readText, walkFiles } from "./util.ts";

export type Candidate = { file: string; line: number; phrase: string; text: string };

const TEXT_EXT = [".md", ".yaml", ".yml", ".txt", ".svg", ".html", ".ts", ".tsx", ".js", ".jsx", ".css", ".json"];

function phraseRegex(p: string): RegExp {
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 영문 단어는 단어 경계로만 (예: isGood 은 Good 후보가 아니다)
  return /^[A-Za-z]+$/.test(p) ? new RegExp(`(?<![A-Za-z])${esc}(?![A-Za-z])`) : new RegExp(esc);
}

// targets(약어) 를 파일 목록으로 펼친다
export function targetFiles(cfg: Config, rev: string, targets: string[]): string[] {
  const out: string[] = [];
  for (const t of targets) {
    const rel: string = cfg.harness.targets[t];
    const abs = path.join(rev, rel);
    if (rel.endsWith("/")) {
      const ignore = [...cfg.harness.checkpoint_ignore, ...(t === "app" ? cfg.harness.app_scan.exclude : [])];
      for (const f of walkFiles(abs, ignore)) if (TEXT_EXT.some((e) => f.endsWith(e))) out.push(path.join(rel, f));
    } else if (exists(abs)) out.push(rel);
  }
  return out;
}

export function prefilter(cfg: Config, rev: string, rule: "C-1" | "C-2" | "C-3", targets: string[]): Candidate[] {
  const phrases: string[] = val(cfg, `policy:rules.${rule}.detection.phrases`);
  const exceptions: string[] = rule === "C-2" ? val(cfg, "policy:rules.C-2.exceptions") : [];
  const out: Candidate[] = [];
  for (const rel of targetFiles(cfg, rev, targets)) {
    readText(path.join(rev, rel))
      .split("\n")
      .forEach((line, i) => {
        if (exceptions.some((e) => line.includes(e))) return;
        for (const p of phrases) if (phraseRegex(p).test(line)) out.push({ file: rel, line: i + 1, phrase: p, text: line.trim().slice(0, 200) });
      });
  }
  return out;
}
