/**
 * 코드 라벨 표시.
 *
 * ♭·♯ 임시표를 위첨자로 올려 실제 악보처럼 보이게 한다.
 * 문자열 자체는 notation.spell()이 이미 기호로 바꿔 준 상태다.
 */
export function ChordLabel({ label }: { label: string }) {
  const parts = label.split(/([♭♯])/);
  return (
    <>
      {parts.map((part, i) =>
        part === "♭" || part === "♯" ? (
          <sup key={i} className="text-[0.62em] leading-none">
            {part}
          </sup>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
