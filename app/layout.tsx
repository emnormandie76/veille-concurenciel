import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

// La charte (app/charte.css) : Plex Sans pour le texte (un seul fichier, variable),
// Plex Sans Condensed pour les titres, Plex Mono pour les chiffres et les codes.
// Seul le texte courant est préchargé. Le preflight en fait la police du
// document (étape 9, lot 6 : Inter, celle de l'ancien style, est partie).
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: "600",
  variable: "--font-plex-condensed",
  display: "swap",
  preload: false,
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
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
    <html lang="fr" className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
