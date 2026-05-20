import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import SidebarClient from "./SidebarClient";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  // Redirection côté serveur si aucune session active n'existe
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
