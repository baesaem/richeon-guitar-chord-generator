"use client";

/**
 * 상식 — 기타의 유래, 부위 명칭, 종류별 특징, 대표 브랜드.
 *
 * 악기를 손에 들기 전의 이야기들이라 기타 기초의 첫 탭에 둔다.
 * 수업에서 "브리지 쪽에서 쳐 보세요" 같은 말이 나올 때 찾아보는 곳.
 */

const HISTORY = [
  {
    title: "어디서 왔나",
    body: "줄을 뜯는 악기는 수천 년 전 서아시아의 류트류까지 거슬러 오릅니다. 무어인을 따라 스페인으로 건너가 비우엘라·바로크 기타를 거쳤고, 스페인이 기타의 고향이 된 이유입니다.",
  },
  {
    title: "지금 모양이 된 때",
    body: "1800년대 중반 스페인의 안토니오 토레스가 몸통을 키우고 부챗살 울림판을 넣어 지금의 클래식 기타 꼴을 완성했습니다. 여섯 줄·현재 조율(EADGBE)도 이 무렵 자리 잡았습니다.",
  },
  {
    title: "통기타와 일렉트릭",
    body: "1900년대 미국에서 쇠줄을 얹은 포크(통)기타가, 1930~50년대에 전기 픽업을 단 일렉트릭 기타가 나왔습니다. 우리가 수업에서 치는 것은 쇠줄 통기타입니다.",
  },
];

/** 부위 명칭. 그림의 번호와 같다 */
const PARTS = [
  { no: 1, ko: "헤드(머리)", en: "head", role: "줄감개가 달린 맨 위" },
  { no: 2, ko: "줄감개", en: "tuning peg", role: "돌려서 음을 맞춘다" },
  { no: 3, ko: "너트(상현주)", en: "nut", role: "줄이 걸리는 위쪽 턱" },
  { no: 4, ko: "넥(목)", en: "neck", role: "왼손이 잡는 자루" },
  { no: 5, ko: "지판·프렛", en: "fretboard·fret", role: "누르는 판과 쇠막대" },
  { no: 6, ko: "몸통(바디)", en: "body", role: "소리를 울리는 통" },
  { no: 7, ko: "사운드홀", en: "sound hole", role: "소리가 나오는 구멍" },
  { no: 8, ko: "브리지·새들", en: "bridge·saddle", role: "줄을 묶는 아래쪽 턱" },
];

const KINDS = [
  {
    name: "클래식 기타",
    body: "나일론 줄이라 손끝이 덜 아프고 소리가 부드럽습니다. 넥이 넓어 손가락 연주(아르페지오)에 좋습니다. 처음 배우기에 가장 순한 기타입니다.",
  },
  {
    name: "통기타(포크)",
    body: "쇠줄이라 소리가 크고 밝습니다. 피크 스트로크에 잘 맞아 가요 반주의 표준입니다. 처음엔 손끝이 아프지만 굳은살이 생기면 괜찮아집니다.",
  },
  {
    name: "일렉트릭 기타",
    body: "픽업이 줄의 떨림을 전기로 바꿔 앰프로 소리를 냅니다. 줄이 가늘어 누르기는 쉽지만 앰프 없이는 소리가 거의 없습니다.",
  },
];

const BRANDS = [
  {
    name: "마틴 (Martin)",
    body: "1833년 미국. 통기타의 표준 몸통(드레드넛)과 X 울림살을 만든 원조. 깊고 묵직한 저음.",
  },
  {
    name: "깁슨 (Gibson)",
    body: "미국. 통기타 J-45와 일렉 레스폴로 유명. 둥글고 따뜻한 소리.",
  },
  {
    name: "테일러 (Taylor)",
    body: "1974년 미국. 밝고 고른 소리에 넥이 편해 현대 통기타의 대표 주자.",
  },
  {
    name: "펜더 (Fender)",
    body: "미국. 스트라토캐스터·텔레캐스터로 일렉 기타를 대중화한 브랜드.",
  },
  {
    name: "야마하 (Yamaha)",
    body: "일본. 입문~중급 가성비의 정평. FG 시리즈는 첫 통기타로 가장 많이 권해집니다.",
  },
  {
    name: "콜트 (Cort) · 크래프터 (Crafter)",
    body: "한국 브랜드. 콜트는 세계 최대급 기타 생산으로, 크래프터는 통기타로 해외에서도 알아줍니다.",
  },
];

/** 부위 번호가 달린 통기타 그림. 번호는 PARTS 표와 같다 */
function GuitarDiagram() {
  const label = (no: number, x: number, y: number) => (
    <g>
      <circle cx={x} cy={y} r={7} fill="var(--accent)" />
      <text
        x={x}
        y={y + 3}
        textAnchor="middle"
        fontSize={9}
        fontWeight={700}
        fill="#fff"
      >
        {no}
      </text>
    </g>
  );
  return (
    <svg viewBox="0 0 200 330" className="mx-auto w-52 max-w-full" role="img">
      <g stroke="currentColor" strokeOpacity={0.7} fill="none" strokeWidth={1.4}>
        {/* 헤드 */}
        <rect x={86} y={8} width={28} height={44} rx={5} />
        {/* 줄감개 */}
        {[18, 30, 42].map((y) => (
          <g key={y}>
            <circle cx={80} cy={y} r={3} fill="currentColor" fillOpacity={0.5} />
            <circle cx={120} cy={y} r={3} fill="currentColor" fillOpacity={0.5} />
          </g>
        ))}
        {/* 너트 */}
        <line x1={86} y1={52} x2={114} y2={52} strokeWidth={3} />
        {/* 넥 */}
        <rect x={88} y={52} width={24} height={110} />
        {/* 프렛 */}
        {[68, 84, 100, 116, 132, 148].map((y) => (
          <line key={y} x1={88} y1={y} x2={112} y2={y} strokeOpacity={0.4} />
        ))}
        {/* 몸통 */}
        <path d="M100,162 c-32,0 -54,14 -54,38 c0,13 7,20 7,29 c0,10 -11,16 -11,35 c0,32 27,50 58,50 c31,0 58,-18 58,-50 c0,-19 -11,-25 -11,-35 c0,-9 7,-16 7,-29 c0,-24 -22,-38 -54,-38 z" />
        {/* 사운드홀 */}
        <circle cx={100} cy={222} r={17} />
        {/* 브리지 */}
        <rect x={78} y={266} width={44} height={9} rx={2} fill="currentColor" fillOpacity={0.25} />
        {/* 줄 */}
        {[91, 94.6, 98.2, 101.8, 105.4, 109].map((x) => (
          <line key={x} x1={x} y1={52} x2={x} y2={266} strokeWidth={0.5} strokeOpacity={0.5} />
        ))}
      </g>
      {label(1, 140, 16)}
      {label(2, 62, 30)}
      {label(3, 132, 52)}
      {label(4, 66, 100)}
      {label(5, 134, 130)}
      {label(6, 34, 300)}
      {label(7, 132, 222)}
      {label(8, 140, 270)}
    </svg>
  );
}

export function GuitarLore() {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold">기타의 유래</h3>
      <ul className="mb-3 space-y-1.5">
        {HISTORY.map((h) => (
          <li
            key={h.title}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-0.5 text-[13px] font-bold">{h.title}</div>
            <p className="text-[11px] leading-snug text-gray-500">{h.body}</p>
          </li>
        ))}
      </ul>

      <h3 className="mb-1 text-sm font-semibold">부위 명칭</h3>
      <GuitarDiagram />
      <div className="mb-3 mt-1 overflow-x-auto">
        <table className="w-full min-w-[300px] text-left text-xs">
          <thead>
            <tr className="text-[10px] text-gray-400">
              <th className="py-1 font-normal">번호</th>
              <th className="font-normal">이름</th>
              <th className="font-normal">영어</th>
              <th className="font-normal">하는 일</th>
            </tr>
          </thead>
          <tbody>
            {PARTS.map((p) => (
              <tr key={p.no} className="border-t border-gray-200 dark:border-gray-800">
                <td className="py-1.5 font-bold text-[var(--accent)]">{p.no}</td>
                <td className="font-medium">{p.ko}</td>
                <td className="text-gray-500">{p.en}</td>
                <td className="text-gray-500">{p.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-1.5 text-sm font-semibold">종류와 특징</h3>
      <ul className="mb-3 space-y-1.5">
        {KINDS.map((k) => (
          <li
            key={k.name}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-0.5 text-[13px] font-bold">{k.name}</div>
            <p className="text-[11px] leading-snug text-gray-500">{k.body}</p>
          </li>
        ))}
      </ul>

      <h3 className="mb-1.5 text-sm font-semibold">이름난 브랜드</h3>
      <ul className="space-y-1.5">
        {BRANDS.map((b) => (
          <li
            key={b.name}
            className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700"
          >
            <div className="mb-0.5 text-[13px] font-bold">{b.name}</div>
            <p className="text-[11px] leading-snug text-gray-500">{b.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-gray-400">
        브랜드보다 중요한 것은 내 손에 맞는 넥과 관리 상태입니다. 중고를
        살 때는 넥 휨과 줄 높이를 꼭 확인하세요.
      </p>
    </div>
  );
}
