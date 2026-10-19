import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed, Inter } from "next/font/google";
import "./globals.css";

// Les anciens écrans (globals.css, couche `legacy`) gardent Inter jusqu'à l'étape 9.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// La charte (app/charte.css) : Plex Sans pour le texte (un seul fichier, variable),
// Plex Sans Condensed pour les titres, Plex Mono pour les chiffres et les codes.
// Seul le texte courant est préchargé.
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
    <html lang="fr" className={`${inter.variable} ${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body style={{ fontFamily: "var(--font-inter, 'Inter', system-ui, sans-serif)" }}>
        {children}
      </body>
    </html>
  );
}
