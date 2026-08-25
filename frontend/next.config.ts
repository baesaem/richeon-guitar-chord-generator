import type { NextConfig } from "next";

/**
 * 백엔드(:8000)를 프론트(:3000) 뒤로 프록시한다.
 *
 * 폰에서 접속할 때 포트를 두 개 열면 백엔드 실행 파일에도 방화벽 허용이 필요해진다.
 * 브라우저가 :3000 하나만 보게 만들면 그 문제가 사라지고, CORS도 필요 없어진다.
 */
const backend = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // 개발 모드 표시기(왼쪽 아래 N 배지)를 끈다. 폰 화면에서 마디 그리드를 가린다.
  devIndicators: false,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
