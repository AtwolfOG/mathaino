import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mathaino",
  description: "A lightweight Bible memorisation application.",
};
export const viewport: Viewport = { themeColor: "#f4f7f6" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
