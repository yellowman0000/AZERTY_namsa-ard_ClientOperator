import type { Metadata } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "./sw-register";

export const metadata: Metadata = {
  title: "Nam Sa-ard | Operator",
  description: "Water volume entry and offline synchronization for Nam Sa-ard kiosk operators.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
