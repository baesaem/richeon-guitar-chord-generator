/** 각 탭 내용 맨 아래에 들어가는 저작권 표시 */
export function Copyright() {
  return (
    <p className="py-4 text-center text-[10px] leading-relaxed text-[color-mix(in_srgb,var(--foreground)_55%,transparent)]">
      © {COPYRIGHT_YEAR} 리천 기타교실(조영민 강사님) · 기타 코드 자동 생성
      <br />
      개인 학습·연습용. 음원의 저작권은 각 권리자에게 있습니다.
    </p>
  );
}

// 배포 시점에 고정한다. 매 렌더 new Date()를 부르면 서버·클라이언트 렌더 결과가
// 연말에 어긋나 하이드레이션 경고가 난다.
const COPYRIGHT_YEAR = 2026;
