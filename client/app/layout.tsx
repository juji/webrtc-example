import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col">
        <ServiceWorkerRegistration />
        <SignalingConnection />
        <MessageStatusListener />
        {children}
      </body>
    </html>
  );
}
