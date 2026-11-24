import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Roboto, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mercato · Gestão comercial",
  description: "Gestão comercial, estoque, compras, vendas e frente de caixa.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${roboto.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased"><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
