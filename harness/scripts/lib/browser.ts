// G4 브라우저 증거 수집 (G4-6 스크린샷, G4-7~10, G4-13). Playwright + axe-core 필요.
// 결과: gates/evidence/G4-browser.json, gates/evidence/screens/<screen_id>.png
import { createRequire } from "node:module";
import path from "node:path";
import { type Config, val } from "./config.ts";
import { fail, readFrontmatter, readText, writeJson } from "./util.ts";

export async function browserCheck(cfg: Config, rev: string, baseUrl: string) {
  const require = createRequire(path.join(cfg.root, "harness", "package.json"));
  let chromium: any, axePath: string;
  try {
    chromium = (await import(require.resolve("playwright"))).chromium;
    axePath = require.resolve("axe-core/axe.min.js");
  } catch {
    fail("playwright / axe-core 가 없다. harness/ 에서 'npm i -D playwright axe-core && npx playwright install chromium' 실행");
  }
  const qa = readFrontmatter(path.join(rev, "s4/qa.md")).data ?? {};
  const screens: { screen_id: string; route: string }[] = qa.screens ?? [];
  if (!screens.length) fail("s4/qa.md frontmatter 에 screens[{screen_id, route}] 가 없다");
  const vw = val(cfg, "tokens:layout.viewport_min");
  const touch = val(cfg, "tokens:layout.touch_min");
  const inputMin = val(cfg, "tokens:typography.input_min_size");
  const evDir = path.join(rev, "gates", "evidence");
  const browser = await chromium.launch();
  const out: any[] = [];
  try {
    for (const s of screens) {
      const url = new URL(s.route, baseUrl).toString();
      const page = await browser.newPage({ viewport: { width: vw, height: 800 } });
      await page.goto(url, { waitUntil: "networkidle" });
      const shot = path.join("screens", `${s.screen_id}.png`);
      await page.screenshot({ path: path.join(evDir, shot), fullPage: true });
      await page.addScriptTag({ content: readText(axePath!) });
      const axe = await page.evaluate(async () => {
        // @ts-ignore
        const r = await window.axe.run(document, { runOnly: ["color-contrast"] });
        return r.violations.flatMap((v: any) => v.nodes.map((n: any) => n.target.join(" ")));
      });
      const metrics = await page.evaluate(
        ({ touch, inputMin }: any) => {
          const sel = "a,button,input,select,textarea,[role=button]";
          const small = [...document.querySelectorAll(sel)]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && (r.width < touch || r.height < touch))
            .map(({ el, r }) => `${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)}`);
          const inputs = [...document.querySelectorAll("input,textarea,select")]
            .filter((el) => parseFloat(getComputedStyle(el).fontSize) < inputMin)
            .map((el) => `${el.tagName.toLowerCase()} ${getComputedStyle(el).fontSize}`);
          return { scroll_width: document.documentElement.scrollWidth, small_touch_targets: small, small_inputs: inputs };
        },
        { touch, inputMin },
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      const reduced = await page.evaluate(() =>
        [...document.querySelectorAll("*")].filter((el) => {
          const cs = getComputedStyle(el);
          const moving = /transform|all/.test(cs.transitionProperty) && parseFloat(cs.transitionDuration) > 0.001;
          const anim = cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.001;
          return moving || anim;
        }).length,
      );
      out.push({ screen_id: s.screen_id, route: s.route, viewport: vw, screenshot: shot, axe_contrast_violations: axe, ...metrics, reduced_motion_transform_transitions: reduced });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const result = { collected_at: new Date().toISOString(), base_url: baseUrl, screens: out };
  writeJson(path.join(evDir, "G4-browser.json"), result);
  return result;
}
