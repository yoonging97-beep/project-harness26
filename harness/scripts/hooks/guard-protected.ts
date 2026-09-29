// PreToolUse hook (R7 사전 차단): running 실행이 있는 동안 Docs/**, harness/config/** 쓰기를 막는다.
// 단계별 write scope 는 막지 않는다 (사후 검사 R6-1 담당). 막을 때 exit 2 + stderr.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
const PROTECTED = ["Docs/", "harness/config/"];

function runningRuns(): string[] {
  const dir = path.join(root, "harness", "runs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => {
    const p = path.join(dir, n, "run.yaml");
    return fs.existsSync(p) && /^status:\s*running\s*$/m.test(fs.readFileSync(p, "utf8"));
  });
}

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let data: any = {};
  try {
    data = JSON.parse(input || "{}");
  } catch {
    process.exit(0);
  }
  const target: string | undefined = data?.tool_input?.file_path ?? data?.tool_input?.notebook_path;
  if (!target) process.exit(0);
  const rel = path.relative(root, path.resolve(data.cwd ?? root, target)).split(path.sep).join("/");
  if (!PROTECTED.some((p) => rel.startsWith(p))) process.exit(0);
  const running = runningRuns();
  if (running.length === 0) process.exit(0);
  process.stderr.write(`하네스 실행 중(${running.join(", ")})에는 ${rel} 을(를) 수정할 수 없다. Docs/ 와 harness/config/ 는 실행 중 읽기 전용이다 (CLAUDE.md 10장). 필요하면 질문이나 변경 제안으로 돌려준다.\n`);
  process.exit(2);
});
