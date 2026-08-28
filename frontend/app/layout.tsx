import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "리천 기타교실(조영민 강사님)",
  description:
    "YouTube 영상이나 오디오 파일에서 비트·조성·기타 코드를 자동으로 뽑아 재생과 함께 보여줍니다.",
  // 홈 화면에 앱으로 설치할 수 있게 한다(PWA)
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "리천 기타교실",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  themeColor: "#0c101c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
