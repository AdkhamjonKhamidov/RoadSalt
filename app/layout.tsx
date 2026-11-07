import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadSalt",
  description: "A practical winter road awareness demo for Salisbury, Maryland.",
  icons: {
    icon: "/assets/favicon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-[#F9F7F7] text-[#112D4E]">{children}</body>
    </html>
  );
}
