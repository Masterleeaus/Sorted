import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";

const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: {
    default: "Titan Go · Field",
    template: "%s · Titan Go",
  },
  description: "Titan Go — Field mode. Run the work.",
  applicationName: "Titan Go",
  appleWebApp: {
    capable: true,
    title: "Titan Go",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#070708",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable} data-theme="dark">
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
