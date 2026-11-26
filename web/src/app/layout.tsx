import type { Metadata, Viewport } from "next";
import { Anton, Geist_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const anton = Anton({ variable: "--font-display", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Presence — Pastry Marketing", template: "%s · Pastry Presence" },
  description: "Face-recognition attendance, leave and payroll for Pastry Marketing.",
  applicationName: "Pastry Presence",
  authors: [{ name: "Pastry Marketing" }],
  creator: "Pastry Marketing",
  robots: { index: false, follow: false }, // internal application
  appleWebApp: { capable: true, title: "Pastry Presence", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a20" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
