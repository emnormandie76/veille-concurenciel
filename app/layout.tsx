import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School Data Pipeline",
  description: "Plateforme de centralisation des données de l'enseignement supérieur français",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
