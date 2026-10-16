import { requirePage } from "@/lib/auth";

/**
 * L'inbox est réservée à ADMIN (plan gestion-contenu, étape 1) : tous ses
 * tickets viennent du pipeline IA ou passent par lui. La page est un composant
 * client : le contrôle serveur se fait ici, et ses API sont en `guardAdmin`.
 * Un gestionnaire est renvoyé vers les écoles.
 */
export default async function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePage("admin");
  return <>{children}</>;
}
