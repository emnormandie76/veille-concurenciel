/**
 * app/(admin-auth)/layout.tsx — Route group pour les pages d'auth admin
 * Ce layout est minimal : pas de vérification de session, pas de sidebar.
 * URL : /admin/login (identique à avant)
 */
export default function AdminAuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
