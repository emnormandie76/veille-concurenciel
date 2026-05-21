import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import SidebarClient from "./SidebarClient";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // /admin/login est dans app/(admin-auth)/admin/login/ (route group séparé)
  // → ce layout ne s'applique JAMAIS à /admin/login → aucune boucle possible.

  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    // JWEDecryptionFailed ou autre erreur JWT : cookie corrompu
    // Rediriger vers login (les cookies seront effacés par NextAuth au signIn)
    redirect("/admin/login");
  }

  if (!session) {
    redirect("/admin/login");
  }

  return (
    <div className="admin-layout-wrapper">
      <SidebarClient user={session.user} />
      <div className="admin-content-area">
        <div className="admin-container">{children}</div>
      </div>
    </div>
  );
}
