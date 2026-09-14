import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["200", "400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "RGE Hub — Editing Platform",
  description: "The editing-focused community & resource platform for Indian railway editors. Images, clips, files, speed ramp studio, and community — powered by OnyxBase.",
  keywords: ["RGE Hub", "Indian railways", "editing", "speed ramp", "OnyxBase", "clips", "files"],
  authors: [{ name: "RGE Hub" }],
  // Favicon + app icons come from the file convention:
  // src/app/favicon.ico, src/app/icon.png, src/app/apple-icon.png.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${inter.variable} ${manrope.variable} antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
