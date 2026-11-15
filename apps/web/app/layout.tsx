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
    default: "Sorted · Field",
    template: "%s · Sorted",
  },
  description: "Sorted — field service operations. Run the work.",
  applicationName: "Sorted",
  appleWebApp: {
    capable: true,
    title: "Sorted",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#17365d",
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
