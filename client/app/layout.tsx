import type { Metadata } from "next";
import { Geist, Geist_Mono, Libertinus_Math } from "next/font/google";
import "vistaview/style.css";
import "./globals.css";
import { DevPanel } from "@/components/dev-panel";
import { MessageStatusListener } from "./message-status-listener";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import { SignalingConnection } from "./signaling-connection";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const libertinusMath = Libertinus_Math({
  variable: "--font-libertinus-math",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Primssg",
  description: "Post-quantum encrypted messaging over WebRTC",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon-512.png",
    apple: "/icon-512.png",
  },
};

export const viewport = {
  themeColor: "#171717",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${libertinusMath.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <ServiceWorkerRegistration />
        <SignalingConnection />
        <MessageStatusListener />
        {children}
        {process.env.NEXT_PUBLIC_DEV && <DevPanel />}
      </body>
    </html>
  );
}
