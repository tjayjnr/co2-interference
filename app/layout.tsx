import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CO2 Interference Analyzer",
  description: "Pressure interference and CO2 saturation analysis for multi-well CO2 injection into a saline aquifer",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="sitefoot">
          <div className="logos">
            <a href="https://www.nmt.edu" target="_blank" rel="noopener noreferrer" aria-label="New Mexico Tech">
              <img src="/logos/nmt-logo.svg" alt="New Mexico Tech" />
            </a>
            <a href="https://www.lanl.gov" target="_blank" rel="noopener noreferrer" aria-label="Los Alamos National Laboratory">
              <img src="/logos/lanl-logo.png" alt="Los Alamos National Laboratory" />
            </a>
            <a href="https://science.osti.gov" target="_blank" rel="noopener noreferrer" aria-label="U.S. Department of Energy, Office of Science">
              <img className="logo-doe" src="/logos/doe-logo.png" alt="U.S. Department of Energy, Office of Science" />
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
