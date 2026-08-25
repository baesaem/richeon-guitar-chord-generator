import type { NextConfig } from "next";

/**
 * 두 가지 모드로 빌드된다.
 *
 * 1) 기본(개발·집 안 사용): 백엔드(:8000)를 프론트(:3000) 뒤로 프록시한다.
 *    브라우저가 포트 하나만 보게 되어 폰에서 방화벽·CORS 문제가 없다.
 *
 * 2) STATIC_EXPORT=1 (GitHub Pages 등 정적 호스팅): 서버가 없으므로 프록시도 없다.
 *    분석 API는 NEXT_PUBLIC_API_BASE로 지정한 주소를 직접 호출한다.
 *    지정하지 않으면 분석 기능은 동작하지 않고 코드리스트만 쓸 수 있다.
 */
const backend = process.env.BACKEND_ORIGIN ?? "http://127.0.0.1:8000";
const staticExport = process.env.STATIC_EXPORT === "1";

// 프로젝트 페이지는 https://<사용자>.github.io/<저장소>/ 아래에 놓인다
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // 개발 모드 표시기(왼쪽 아래 N 배지)를 끈다. 폰 화면에서 마디 그리드를 가린다.
  devIndicators: false,

  ...(staticExport
    ? {
        output: "export" as const,
        basePath: basePath || undefined,
        // 정적 호스팅에는 이미지 최적화 서버가 없다
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
        },
      }),
};

export default nextConfig;
