import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadSalt",
  description: "Winter road conditions, and where road salt could harm nearby water, wetlands and farmland.",
  icons: {
    icon: "/assets/favicon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
