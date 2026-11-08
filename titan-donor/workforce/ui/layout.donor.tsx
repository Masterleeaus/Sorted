import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { ServiceWorkerRegistrar } from "./ServiceWorkerRegistrar";

const archivo = Archivo({ subsets:["latin"], display:"swap", variable:"--font-archivo" });

export const metadata: Metadata = {
  title: { default:"Titan Zero | Employ an AI Workforce", template:"%s | Titan Zero" },
  description:"Titan Zero installs and manages an Advanced Intelligence workforce inside your existing business systems—more capacity, less admin, governed automation.",
  applicationName:"Titan Zero",
  appleWebApp:{ capable:true, title:"Titan Zero", statusBarStyle:"black-translucent" },
};

export const viewport: Viewport = { themeColor:"#f97316" };

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en" className={archivo.variable}><body>{children}<ServiceWorkerRegistrar/></body></html>;
}