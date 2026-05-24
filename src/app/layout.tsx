import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Clovie Router — API Gateway",
  description: "OpenAI-compatible API gateway with key management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-[#06060a] text-gray-100 antialiased`}>
        {children}
      </body>
    </html>
  );
}
