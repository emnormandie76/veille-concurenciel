import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import UsersManagerClient from "./UsersManagerClient";

export default async function UsersPage() {
  const session = await getServerSession(authOptions);

  // Sécurité renforcée côté serveur : redirection si pas de session (devrait déjà être intercepté par layout)
  if (!session) {
    return (
      <div className="forbidden-card">
        <h2>Non connecté</h2>
        <p>Veuillez vous connecter pour accéder à cette page.</p>
      </div>
    );
  }

  // Vérification de rôle : seuls les ADMINs ont accès
  if (session.user.role !== "ADMIN") {
    return (
      <div className="forbidden-container">
        <div className="forbidden-card">
          <div className="forbidden-icon">🛡️</div>
          <h2>Accès Interdit</h2>
          <p>
            Cette section est exclusivement réservée aux administrateurs de la plateforme. 
            Votre rôle actuel est <strong>{session.user.role}</strong>.
          </p>
        </div>
      </div>
    );
  }

  // Rendu de l'interface d'administration si ADMIN
  return <UsersManagerClient currentUserId={session.user.id} />;
}
