import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import { connection } from "next/server";
import { APP_NAME } from "@/lib/app-name";
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
    default: APP_NAME,
    template: `%s — ${APP_NAME}`,
  },
  description:
    "Plateforme de centralisation des données de l'enseignement supérieur français : grilles tarifaires, classements, accréditations et places disponibles.",
  keywords: ["école", "formation", "enseignement supérieur", "tarifs", "classement", "france"],
  openGraph: {
    siteName: APP_NAME,
    locale: "fr_FR",
    type: "website",
  },
};

// Toutes les pages sont dynamiques (étape 15, D123) : la CSP porte un nonce
// neuf à chaque requête (proxy.ts, lib/csp.ts), que Next pose sur ses scripts
// au rendu. Une page prérendue ou en cache porterait le nonce d'une autre
// requête, ou aucun, et ses scripts seraient bloqués. Attendre la requête ici
// vaut pour chaque page de l'application.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html lang="fr" className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
