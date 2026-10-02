import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CO2 Interference Analyzer",
  description: "Pressure interference analysis for multi-well CO2 injection into a saline aquifer",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
