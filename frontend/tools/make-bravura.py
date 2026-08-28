"""악보 글꼴(Bravura)에서 우리가 쓰는 글자만 잘라 CSS로 만든다.

음표를 손으로 그리면 아무리 손봐도 인쇄된 악보를 못 따라간다. 악보
프로그램은 모두 **전용 글꼴**에서 모양을 가져다 놓고, 오선·기둥 같은
선만 직접 긋는다. 우리도 그렇게 한다.

Bravura는 SMuFL 표준 글꼴이다(OFL, 무료·재배포 가능). vexflow가
base64 woff2로 담아 두었으므로 인터넷을 다시 오갈 일이 없다.

통째로는 247KB다. 쓰는 글자가 서른 남짓이라 잘라 내면 20KB 아래로
떨어진다 — 수강생이 곡마다 받는 파일에 얹힐 무게라 아깝다.

    python tools/make-bravura.py

를 실행하면 app/bravura.css를 다시 만든다.
"""

from __future__ import annotations

import base64
import io
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "node_modules/vexflow/build/esm/src/fonts/bravura.js"
OUT = HERE.parent / "app/bravura.css"

#: 쓰는 글자. SMuFL 표준 코드포인트다.
GLYPHS = {
    "E050": "높은음자리표",
    "E052": "높은음자리표(한 옥타브 아래)",
    "E080": "박자표 0", "E081": "1", "E082": "2", "E083": "3", "E084": "4",
    "E085": "5", "E086": "6", "E087": "7", "E088": "8", "E089": "9",
    "E0A2": "온음표 머리", "E0A3": "２분음표 머리", "E0A4": "４분음표 머리",
    "E1E7": "점",
    "E240": "８분 꼬리(위)", "E241": "８분 꼬리(아래)",
    "E242": "16분 꼬리(위)", "E243": "16분 꼬리(아래)",
    "E244": "32분 꼬리(위)", "E245": "32분 꼬리(아래)",
    "E260": "♭", "E261": "♮", "E262": "♯",
    "E4E3": "온쉼표", "E4E4": "２분쉼표", "E4E5": "４분쉼표",
    "E4E6": "８분쉼표", "E4E7": "16분쉼표",
    "E883": "잇단음표 3",
}


def main() -> int:
    if not SRC.exists():
        print(f"vexflow를 찾을 수 없습니다: {SRC}", file=sys.stderr)
        print("frontend에서 npm install vexflow 를 먼저 하십시오.", file=sys.stderr)
        return 1

    text = SRC.read_text("utf-8")
    m = re.search(r"base64,([A-Za-z0-9+/=]+)", text)
    if not m:
        print("글꼴 자료를 찾지 못했습니다.", file=sys.stderr)
        return 1

    raw = base64.b64decode(m.group(1))
    font = TTFont(io.BytesIO(raw))

    options = subset.Options()
    options.layout_features = []
    options.hinting = False
    options.desubroutinize = True
    options.drop_tables += ["GPOS", "GSUB", "DSIG"]
    options.name_IDs = ["*"]
    options.notdef_outline = True

    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=[int(code, 16) for code in GLYPHS])
    sub.subset(font)

    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    small = buf.getvalue()

    css = f"""/* 만들어진 파일입니다. tools/make-bravura.py 를 고치고 다시 실행하십시오.

   Bravura — SMuFL 표준 악보 글꼴 (Steinberg, SIL Open Font License 1.1).
   쓰는 글자 {len(GLYPHS)}자만 잘라 담았습니다({len(raw) // 1024}KB → {len(small) // 1024}KB).
   글꼴 파일을 안에 담아 두므로 인터넷 없이도 악보가 그려집니다. */

@font-face {{
  font-family: "Bravura";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(data:font/woff2;base64,{base64.b64encode(small).decode()}) format("woff2");
}}
"""
    OUT.write_text(css, "utf-8")
    print(f"{OUT.name}: 글자 {len(GLYPHS)}자 · {len(raw)//1024}KB → {len(small)//1024}KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
