import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Term Shield Sales Desk",
  description: "AI insurance sales agent grounded in your policy document",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
