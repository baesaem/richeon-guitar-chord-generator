/**
 * AI 악보생성기(리천 기타연습실)를 public/abc-studio로 복사한다.
 *
 * 기타교실의 「악보(ABC) 등록」은 그 앱의 악보생성·편집 화면을 그대로
 * iframe으로 띄운다. 같은 출처에서 열려야 postMessage와 localStorage가
 * 문제없이 돌아가므로 public 아래에 사본을 둔다.
 *
 * 원본을 고친 뒤 `npm run sync:abc`를 한 번 돌리면 사본이 따라온다.
 * 원본 위치가 다르면 SRC 환경변수로 알려 준다.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src =
  process.env.SRC ??
  resolve(here, "..", "..", "..", "악보생성", "index.html");
const dest = resolve(here, "..", "public", "abc-studio", "index.html");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`복사했습니다:\n  ${src}\n→ ${dest}`);
