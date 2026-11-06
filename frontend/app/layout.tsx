import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ApiStatus } from "@/components/ApiStatus";

export const metadata: Metadata = {
  title: "Supply Chain Control Tower | Multi-Agent AI",
  description:
    "Multi-agent AI system for autonomous supply-chain and inventory management for SMEs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b bg-[rgb(var(--panel))]/90 px-6 py-3 backdrop-blur">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  Multi-Agent Supply Chain Automation
                </p>
                <p className="truncate text-xs muted">
                  SME distribution · demand, inventory, procurement and disruption intelligence
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ApiStatus />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
            <footer className="border-t px-6 py-4 text-xs muted">
              Synthetic demonstration data · purchase orders and disruptions are simulated
              planning records · no LLM required for core decisions
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
