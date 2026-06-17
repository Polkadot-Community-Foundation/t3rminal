import type { Metadata, Viewport } from "next";
import { Inter, Unbounded } from "next/font/google";
import { Web3Provider } from "@/lib/web3";
import { ReportJobProvider } from "@/lib/components/report-job-provider";
import { ServiceWorkerRegister } from "@/lib/components/service-worker-register";
import { SentryTags } from "@/lib/components/sentry-tags";
import { TestHook } from "@/lib/components/test-hook";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "T3rminal — Payment Terminal",
  description: "Accept payments instantly with Polkadot. Private by default.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "T3rminal",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  other: {
    "theme-color": "#0f172a",
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${unbounded.variable} font-sans antialiased`}
      >
        <Web3Provider>
          <SentryTags />
          <TestHook />
          <ReportJobProvider>
            {children}
          </ReportJobProvider>
        </Web3Provider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
