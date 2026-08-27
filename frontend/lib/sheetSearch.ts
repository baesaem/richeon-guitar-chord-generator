/**
 * 웹에서 실제 악보 찾기.
 *
 * 악보 이미지를 가져와 앱 안에 띄우지 않는다. 남이 만든 악보를 복제해
 * 보여주는 일이라 저작권에 걸린다. 대신 **악보가 있는 곳으로 연결**한다 —
 * 사용자는 그 사이트에서 정식으로 보고, 우리는 검색어를 잘 만들어 준다.
 *
 * 검색어는 영상 제목을 그대로 쓰면 안 된다. "[MV]", "[가사]", 채널명이
 * 섞여 있어 악보 사이트에서 하나도 안 나온다. 그 부분을 걷어낸다.
 */

/** 악보 검색에 방해되는 홍보 문구 */
const NOISE =
  /(official|lyrics?|lyric video|m\/?v|music video|audio|visualizer|live|performance|가사|자막|공식|풀버전|full ver\.?|4k|hd|hq|remaster(ed)?|arttrack|art track|color coded)/gi;

/** 영상 제목 → 악보 검색어 */
export function sheetQuery(title: string): string {
  let text = title.split("|")[0];               // "… | KBS 방송" 잘라내기
  text = text.replace(/\[[^\]]*\]/g, " ");      // [MV] [가사] …
  text = text.replace(/\([^)]*\)/g, (m) => (NOISE.test(m) ? " " : m));
  text = text.replace(NOISE, " ");
  text = text.replace(/\(\d{4}\)|\b(19|20)\d{2}\b/g, " "); // 연도
  text = text.replace(/[-–—_/·]+/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export interface SheetSource {
  name: string;
  /** 무엇을 볼 수 있는 곳인지 한 줄 설명 */
  note: string;
  url: (query: string) => string;
}

/**
 * 찾아볼 만한 곳들. 한국 가요가 많으므로 국내 사이트를 앞에 둔다.
 *
 * 링크는 각 사이트의 검색 페이지로 연다. 곡이 실제로 있는지는 열어 봐야
 * 알 수 있으므로, 여러 곳을 함께 제시해 하나라도 걸리게 한다.
 */
export const SHEET_SOURCES: SheetSource[] = [
  {
    name: "구글에서 코드 찾기",
    note: "가장 확실합니다. 여러 사이트를 한 번에 훑습니다.",
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(`${q} 기타 코드 악보`)}`,
  },
  {
    name: "악보바다",
    note: "국내 가요 코드 악보. 원키·카포 표기가 함께 있습니다.",
    url: (q) => `https://www.akbobada.com/search.html?keyword=${encodeURIComponent(q)}`,
  },
  {
    name: "뮤직스코어",
    note: "국내 악보. 기타·피아노 편곡을 함께 찾습니다.",
    url: (q) =>
      `https://www.musicscore.co.kr/search/search_result.asp?search_text=${encodeURIComponent(q)}`,
  },
  {
    name: "Chordify",
    note: "곡을 들으며 코드를 따라 봅니다. 해외 곡에 강합니다.",
    url: (q) => `https://chordify.net/search/${encodeURIComponent(q)}`,
  },
  {
    name: "Ultimate Guitar",
    note: "세계 최대 기타 탭 사이트. 팝·록에 특히 많습니다.",
    url: (q) =>
      `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`,
  },
];
