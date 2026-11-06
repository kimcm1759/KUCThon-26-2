import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "빠각",
  description: "찍은 물건을 3D로 만들어 사진 속 그 자리에서 부숴 보기",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18171c",
  // Draw under notches / gesture bars; screens pad with safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full bg-bg font-sans text-white">{children}</body>
    </html>
  );
}
