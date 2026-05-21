import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "EduData France — Données de l'enseignement supérieur",
    template: "%s — EduData France",
  },
  description:
    "Plateforme de centralisation des données de l'enseignement supérieur français : grilles tarifaires, classements, accréditations et places disponibles.",
  keywords: ["école", "formation", "enseignement supérieur", "tarifs", "classement", "france"],
  openGraph: {
    siteName: "EduData France",
    locale: "fr_FR",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body style={{ fontFamily: "var(--font-inter, 'Inter', system-ui, sans-serif)" }}>
        {children}
      </body>
    </html>
  );
}
