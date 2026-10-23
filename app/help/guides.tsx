import Image from "next/image";
import type { ReactNode } from "react";
import { WORK_EMAIL_DOMAIN } from "@/lib/accounts";
import type { UserRole } from "@/lib/roles";

/**
 * app/help/guides.tsx — les trois guides de la page d'aide (plan
 * gestion-contenu, étape 14)
 *
 * Un guide par rôle (D108) : l'utilisateur, le gestionnaire, l'admin ; chacun
 * ne voit que celui de son rôle (`guideFor`), pour ne pas noyer le lecteur
 * (le propriétaire, la page vue). Le texte décrit ce que fait le code, avec
 * les libellés exacts de l'interface : chaque `<Ui>` est relu contre le code
 * des écrans (test/help-page.test.ts). Les Word de `docs/guide/` sont un
 * autre texte (D112) : un changement d'écran se reporte dans les deux.
 *
 * Aucun nom d'application (D115) : « le site ». Le guide de l'admin dit où
 * vit la recherche IA, sans commande ni secret (D114).
 *
 * Des captures d'écran coupent le texte (D111, revu par le propriétaire :
 * sur la page comme dans les Word) : `public/help/`, une par écran, préfixée
 * par le guide qui la montre. Prises sur la base `dev`, sans adresse, sans le
 * compte de test ni le nom d'un collègue ; la barre de celles de
 * l'utilisateur est la sienne, sans « Back-office ».
 */

export type HelpGuideId = "user" | "manager" | "admin";

export interface HelpSection {
  /** Ancre de la section, préfixée par le guide : `user-connexion`. */
  id: string;
  title: string;
  body: ReactNode;
}

export interface HelpGuide {
  id: HelpGuideId;
  /** Le rôle qui lit ce guide, et lui seul. */
  role: UserRole;
  title: string;
  summary: string;
  sections: HelpSection[];
}

/** Un libellé de l'interface, tel qu'il s'affiche. */
function Ui({ children }: { children: string }) {
  return <span className="font-medium text-ink">«&nbsp;{children}&nbsp;»</span>;
}

/** Le domaine imposé des adresses (D5), d'un seul tenant : sur un téléphone, il ne se coupe pas au tiret. */
function Domain() {
  return <span className="whitespace-nowrap">@{WORK_EMAIL_DOMAIN}</span>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[70ch] text-sm leading-relaxed text-ink">{children}</p>;
}

/** Une suite d'étapes, dans l'ordre. */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex max-w-[70ch] list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink marker:text-ink-2">{children}</ol>;
}

function Items({ children }: { children: ReactNode }) {
  return <ul className="flex max-w-[70ch] list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink marker:text-ink-2">{children}</ul>;
}

/** Les captures d'écran de `public/help/` : dimensions en pixels et texte de remplacement. */
export const CAPTURES = {
  "user-connexion": {
    width: 440,
    height: 470,
    alt: "La page de connexion : les champs Adresse e-mail et Mot de passe, le bouton Se connecter, et dessous le lien Choisissez votre mot de passe.",
  },
  "user-accueil": {
    width: 1280,
    height: 720,
    alt: "L'accueil : la barre du site, le champ Rechercher une école, le nombre d'écoles, de campus et de programmes, puis les cartes des écoles.",
  },
  "user-fiche-ecole": {
    width: 1280,
    height: 860,
    alt: "La fiche d'une école : son nom, son site, le bouton Signaler une information, les onglets Programmes, Statistiques et Accréditations, les filtres Diplôme, Niveau et Campus, puis la liste des programmes.",
  },
  "user-fiche-programme": {
    width: 1280,
    height: 1069,
    alt: "La fiche d'un programme : le bouton Signaler une information, puis les sections Admissions, Tarifs de scolarité, Classements et Places disponibles, avec leurs liens Source.",
  },
  "user-signalement": {
    width: 1280,
    height: 830,
    alt: "Le formulaire Signaler une information : Ce que vous signalez, Catégorie, Ce qui est à corriger, Lien vers une source, et le bouton Envoyer le signalement.",
  },
  "manager-ecoles": {
    width: 1040,
    height: 530,
    alt: "Gestion des Écoles : le bouton Ajouter une école, le champ de recherche, et le tableau des écoles avec, sur chaque ligne, Gérer le contenu, Modifier et Supprimer.",
  },
  "manager-tarifs": {
    width: 1024,
    height: 820,
    alt: "La gestion d'une école : le lien de retour, les huit onglets, et l'onglet Tarifs ouvert, avec le choix de l'année et du programme, et le tableau des programmes avec Renseigner ou Éditer.",
  },
  "manager-signalements": {
    width: 1040,
    height: 270,
    alt: "L'écran Signalements : les onglets En attente et Fermés.",
  },
  "admin-ajouter-adresse": {
    width: 512,
    height: 279,
    alt: "La fenêtre Ajouter une adresse à la liste : le champ Adresse e-mail de travail, son aide, et les boutons Annuler et Ajouter à la liste.",
  },
} as const;

export type CaptureName = keyof typeof CAPTURES;

/**
 * Une capture et sa légende. `unoptimized` : le navigateur demande l'image
 * lui-même, avec sa session ; l'optimiseur d'images de Next la demanderait
 * sans, et le proxy, qui exige une session partout, la lui refuserait.
 */
function Shot({ name, caption }: { name: CaptureName; caption: string }) {
  const { width, height, alt } = CAPTURES[name];
  return (
    <figure className="flex flex-col gap-1.5">
      <Image
        src={`/help/${name}.png`}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className="h-auto max-w-full self-start rounded-card border border-line"
      />
      <figcaption className="text-xs text-ink-2">{caption}</figcaption>
    </figure>
  );
}

/** Ce qu'il faut savoir avant d'agir : un bloc teinté, sans rôle de message (rien ne s'y annonce). */
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-[70ch] rounded-control border border-accent/25 bg-accent-soft px-3 py-2.5 text-sm leading-relaxed text-ink">
      {children}
    </div>
  );
}

const USER_GUIDE: HelpGuide = {
  id: "user",
  role: "USER",
  title: "Guide de l'utilisateur",
  summary: "Pour toute personne qui se connecte : consulter les écoles, signaler une information, tenir son compte.",
  sections: [
    {
      id: "connexion",
      title: "Se connecter",
      body: (
        <>
          <P>
            Le site est réservé à l'équipe : tout y demande une connexion. Il n'y a pas d'inscription libre : un
            administrateur ajoute votre adresse de travail, en <Domain />, à la liste des comptes. Aucun e-mail ne
            vous est envoyé : il vous prévient lui-même.
          </P>
          <P>La première fois :</P>
          <Steps>
            <li>
              sur la page de connexion, suivez le lien <Ui>Choisissez votre mot de passe</Ui> ;
            </li>
            <li>
              saisissez votre <Ui>Adresse e-mail de travail</Ui>, votre <Ui>Nom affiché</Ui> (déjà rempli d'après
              votre adresse : il signera vos modifications et vos signalements) et votre <Ui>Mot de passe</Ui>, deux
              fois, de 12 caractères au moins ;
            </li>
            <li>
              cliquez sur <Ui>Choisir mon mot de passe</Ui> : la connexion se fait aussitôt.
            </li>
          </Steps>
          <Shot name="user-connexion" caption="La page de connexion ; la première connexion part du lien du bas." />
          <P>
            Ensuite, sur la page de connexion : votre <Ui>Adresse e-mail</Ui>, votre <Ui>Mot de passe</Ui>, puis{" "}
            <Ui>Se connecter</Ui>. Une session dure huit heures au plus ; le site vous redemande ensuite de vous
            connecter. Pour partir, <Ui>Se déconnecter</Ui>, à droite de la barre du site.
          </P>
          <P>
            Mot de passe oublié : demandez à un administrateur de remettre votre compte en première connexion, puis
            refaites la première connexion avec votre adresse. Personne, administrateur compris, ne connaît ni ne
            choisit votre mot de passe.
          </P>
          <Note>
            Une connexion réussie ne compte jamais ; les échecs, si. Après cinq échecs sur une même adresse, le site
            bloque la connexion de cette adresse pendant un quart d'heure, même avec le bon mot de passe (vingt échecs
            depuis un même réseau, toutes adresses confondues, le bloquent aussi). La page dit alors{" "}
            <Ui>Trop de tentatives de connexion. Réessayez dans quelques minutes.</Ui> : patientez avant de réessayer.
          </Note>
        </>
      ),
    },
    {
      id: "consulter",
      title: "Consulter les écoles",
      body: (
        <>
          <P>
            La barre du site mène partout : <Ui>Écoles</Ui> (l'accueil), <Ui>API</Ui>, <Ui>Aide</Ui> (cette page),{" "}
            <Ui>Mon compte</Ui>.
          </P>
          <P>
            <strong className="font-medium">L'accueil</strong> liste les écoles. Tapez une partie d'un nom dans{" "}
            <Ui>Rechercher une école</Ui>, puis cliquez sur une école pour ouvrir sa fiche.
          </P>
          <Shot name="user-accueil" caption="L'accueil : la recherche, puis les écoles." />
          <P>
            <strong className="font-medium">La fiche d'une école</strong> donne son site officiel, ses campus et trois
            onglets : <Ui>Programmes</Ui>, que filtrent <Ui>Diplôme</Ui>, <Ui>Niveau</Ui> et <Ui>Campus</Ui> ;{" "}
            <Ui>Statistiques</Ui>, les chiffres clés ; <Ui>Accréditations</Ui>. Cliquez sur un programme pour ouvrir sa
            fiche.
          </P>
          <Shot name="user-fiche-ecole" caption="La fiche d'une école, sur l'onglet des programmes." />
          <P>
            <strong className="font-medium">La fiche d'un programme</strong> donne ses <Ui>Admissions</Ui> (en quelle
            année on entre, avec quel niveau, par quelle voie), ses <Ui>Tarifs de scolarité</Ui>, ses{" "}
            <Ui>Classements</Ui> et ses <Ui>Places disponibles</Ui> par campus.
          </P>
          <Shot name="user-fiche-programme" caption="La fiche d'un programme : admissions, tarifs, classements, places." />
          <P>
            Sous une donnée, une ligne dit d'où elle vient : <Ui>Source ↗</Ui> ouvre la page où elle a été relevée, et
            «&nbsp;Modifié par … le …&nbsp;» nomme la dernière personne qui l'a modifiée, avec la date. «&nbsp;Validé par …, depuis une
            recherche IA&nbsp;» : la donnée vient de la recherche IA, vérifiée par un administrateur. Sans cette ligne, la
            donnée n'a pas changé depuis la mise en place de ce suivi. Une donnée modifiée par un gestionnaire se voit
            sur le site dès la visite suivante.
          </P>
        </>
      ),
    },
    {
      id: "signaler",
      title: "Signaler une information",
      body: (
        <>
          <P>
            Une donnée vous semble fausse ou dépassée ? Sur la fiche de l'école ou du programme, cliquez sur{" "}
            <Ui>Signaler une information</Ui>, puis remplissez :
          </P>
          <Items>
            <li>
              <Ui>Ce que vous signalez</Ui> : l'école en général, un de ses campus ou un de ses programmes (depuis la
              fiche d'un programme, il est déjà choisi) ;
            </li>
            <li>
              <Ui>Catégorie</Ui> : elle dit aux gestionnaires où corriger ;
            </li>
            <li>
              <Ui>Ce qui est à corriger</Ui> : de 10 à 2 000 caractères ;
            </li>
            <li>
              <Ui>Lien vers une source (facultatif)</Ui> : une adresse web (https://…) où vérifier l'information.
            </li>
          </Items>
          <Shot name="user-signalement" caption="Le formulaire, ouvert depuis la fiche d'un programme : le programme est déjà choisi." />
          <P>
            Puis <Ui>Envoyer le signalement</Ui>. Le signalement va aux gestionnaires, sans e-mail ; dix par heure au
            plus. Suivez-en la suite sur <Ui>Mon compte</Ui>, dans <Ui>Vos signalements</Ui> : <Ui>En attente</Ui>,{" "}
            <Ui>Traité</Ui> ou <Ui>Rejeté</Ui>, avec la réponse du gestionnaire s'il en a laissé une.
          </P>
        </>
      ),
    },
    {
      id: "compte",
      title: "Mon compte",
      body: (
        <>
          <P>
            <Ui>Mon compte</Ui>, dans la barre du site, montre votre adresse et votre rôle, et vous laisse changer :
          </P>
          <Items>
            <li>
              votre <Ui>Nom affiché</Ui> : <Ui>Prénom et nom</Ui>, puis <Ui>Enregistrer le nom</Ui> ; il signe vos
              modifications et vos signalements ;
            </li>
            <li>
              votre <Ui>Mot de passe</Ui> : <Ui>Mot de passe actuel</Ui>, <Ui>Nouveau mot de passe</Ui> (12 caractères
              au moins), <Ui>Confirmer le nouveau mot de passe</Ui>, puis <Ui>Changer le mot de passe</Ui>.
            </li>
          </Items>
          <P>
            En bas de la page, <Ui>Vos signalements</Ui> : ceux que vous avez envoyés, leur état et la réponse des
            gestionnaires.
          </P>
        </>
      ),
    },
    {
      id: "api",
      title: "L'API",
      body: (
        <P>
          <Ui>API</Ui> ouvre la documentation de l'API du site : quinze adresses qui rendent les mêmes données, en
          lecture seule, pour un usage technique (un programme qui lit les données). Comme le reste du site, elle ne
          répond qu'aux personnes connectées.
        </P>
      ),
    },
  ],
};

const MANAGER_GUIDE: HelpGuide = {
  id: "manager",
  role: "GESTIONNAIRE",
  title: "Guide du gestionnaire",
  summary: "Tenir à jour les données des écoles et traiter les signalements. Le site se consulte comme pour tout le monde.",
  sections: [
    {
      id: "back-office",
      title: "Le back-office",
      body: (
        <>
          <P>
            <Ui>Back-office</Ui> apparaît dans la barre du site pour les gestionnaires et les administrateurs. Son menu,
            à gauche : <Ui>Écoles & Campus</Ui>, <Ui>Signalements</Ui>, puis, au pied, <Ui>Voir le site</Ui>,{" "}
            <Ui>Aide</Ui>, <Ui>Mon compte</Ui> et <Ui>Déconnexion</Ui>. Pour revenir au site :{" "}
            <Ui>Voir le site</Ui>, ou le nom du site, en haut du menu. Sur un téléphone ou dans une fenêtre étroite,
            le menu se replie derrière le bouton <Ui>Menu</Ui>.
          </P>
          <P>
            Ce que vous modifiez se voit sur le site dès la visite suivante, signé de votre nom affiché : sous chaque
            donnée, «&nbsp;Modifié par … le …&nbsp;» dit qui l'a modifiée en dernier, et quand. Seule la dernière modification est
            connue, et une suppression ne laisse pas de trace.
          </P>
        </>
      ),
    },
    {
      id: "ecoles",
      title: "Les écoles",
      body: (
        <>
          <P>
            <Ui>Écoles & Campus</Ui> ouvre <Ui>Gestion des Écoles</Ui> : la liste, avec <Ui>Rechercher une école</Ui>{" "}
            (par son nom ou son domaine).
          </P>
          <Shot name="manager-ecoles" caption="La liste des écoles du back-office." />
          <Items>
            <li>
              <Ui>Ajouter une école</Ui> : <Ui>Nom de l'école</Ui> et <Ui>Domaine internet officiel</Ui>, puis{" "}
              <Ui>Créer</Ui>. Une école créée est active : elle paraît aussitôt sur le site.
            </li>
            <li>
              Sur la ligne d'une école : <Ui>Gérer le contenu</Ui> (ses données, ci-dessous), <Ui>Modifier</Ui> (son
              nom et son domaine), <Ui>Supprimer</Ui>. Le nombre de ses campus ouvre la page de ses campus : ajouter,
              modifier, supprimer un campus.
            </li>
            <li>
              Supprimer une école se confirme en saisissant son nom, puis <Ui>Supprimer définitivement</Ui> : ses
              campus, ses programmes, toutes leurs données et ses signalements partent avec elle. C'est irréversible.
            </li>
          </Items>
        </>
      ),
    },
    {
      id: "contenu",
      title: "Gérer le contenu d'une école",
      body: (
        <>
          <P>
            <Ui>Gérer le contenu</Ui> ouvre les données d'une école en huit onglets ;{" "}
            <Ui>← Retour à la liste des écoles</Ui> ramène à la liste.
          </P>
          <Shot name="manager-tarifs" caption="Les huit onglets d'une école, ici sur les tarifs d'une année." />
          <Items>
            <li>
              <Ui>Infos</Ui> : le nom, le domaine officiel et le <Ui>Statut</Ui>, puis{" "}
              <Ui>Enregistrer les modifications</Ui>. Seule une école <Ui>ACTIVE</Ui> paraît sur le site ;{" "}
              <Ui>INACTIVE</Ui> et <Ui>DRAFT</Ui> la cachent, sans rien effacer.
            </li>
            <li>
              <Ui>Accréditations</Ui> : <Ui>Ajouter une accréditation</Ui>, avec son nom, son type (International,
              État ou Label), son année d'obtention ; décochez <Ui>Accréditation encore active</Ui> quand elle ne l'est
              plus.
            </li>
            <li>
              <Ui>Statistiques</Ui> : les chiffres clés d'une année (étudiants, diplômés, partenaires, professeurs…).{" "}
              <Ui>Nouvelle année</Ui> en ajoute une, <Ui>Copier depuis :</Ui> reprend les chiffres d'une autre année ;
              puis <Ui>Enregistrer les statistiques</Ui>, ou <Ui>Supprimer cette année</Ui>.
            </li>
            <li>
              <Ui>Campus & Programmes</Ui> : <Ui>Ajouter un campus</Ui> (son nom, sa ville) et{" "}
              <Ui>Ajouter un programme</Ui> (son nom, le concours, l'alternance, l'expatriation, les durées, et les
              campus qui le dispensent : un au moins, créez donc d'abord le campus). Un programme appartient à l'école
              et peut ouvrir sur plusieurs campus.
            </li>
            <li>
              <Ui>Tarifs</Ui> : par année, un tableau des programmes ; <Ui>Renseigner</Ui> (ou <Ui>Éditer</Ui>) ouvre
              la grille d'un programme : les frais de chaque année, le total, les frais internationaux, des notes. Puis{" "}
              <Ui>Enregistrer la grille tarifaire</Ui>, ou <Ui>Supprimer ce tarif</Ui>.
            </li>
            <li>
              <Ui>Classements</Ui> : par année et par programme ; <Ui>Ajouter un classement</Ui>, avec le nom du
              classement (le média ou l'organisme), le rang et l'année.
            </li>
            <li>
              <Ui>Capacités</Ui> : les places d'un programme sur un campus, par année ; <Ui>Ajouter une capacité</Ui>.
              Pour corriger un nombre, cliquez dessus, tapez le nouveau, puis Entrée (Échap annule).
            </li>
            <li>
              <Ui>Admissions</Ui> : les entrées possibles dans un programme ; <Ui>Ajouter une entrée</Ui>, avec l'année
              d'entrée (de la 1re à la 5e année), le niveau requis (du Bac au Bac+5), la voie (Parcoursup, concours,
              admission sur titre, candidats internationaux ou non précisée) et une note (le nom du concours, les
              diplômes acceptés). Une même entrée ne s'enregistre qu'une fois par programme.
            </li>
          </Items>
          <P>
            Chaque saisie a son champ de source (<Ui>URL de la source</Ui>) : une adresse web en https://… où vérifier
            la donnée, que le site affiche en lien <Ui>Source ↗</Ui>. Une adresse d'une autre forme est refusée, et
            rien n'est enregistré.
          </P>
          <Note>
            Une suppression se confirme, puis emporte ce qui en dépend : supprimer un campus retire ses rattachements
            aux programmes et ses places ; supprimer un programme retire ses tarifs, ses classements, ses places et ses
            admissions.
          </Note>
        </>
      ),
    },
    {
      id: "signalements",
      title: "Traiter les signalements",
      body: (
        <>
          <P>
            <Ui>Signalements</Ui> réunit ce que les collègues signalent depuis les fiches, en deux onglets :{" "}
            <Ui>En attente</Ui>, les plus anciens d'abord, et <Ui>Fermés</Ui>, les cent derniers. Chacun dit l'école,
            ce qui est visé, la catégorie, le message, le lien éventuel et le nom de son auteur.
          </P>
          <Shot name="manager-signalements" caption="L'écran des signalements, sans signalement en attente." />
          <Steps>
            <li>
              <Ui>Ouvrir l'onglet de gestion</Ui> mène à l'onglet de la catégorie : corrigez-y la donnée ;
            </li>
            <li>
              <Ui>Traiter</Ui>, puis <Ui>Marquer traité</Ui> ; ou, si la donnée était juste, <Ui>Rejeter</Ui>, puis{" "}
              <Ui>Rejeter le signalement</Ui> ;
            </li>
            <li>
              dans les deux cas, <Ui>Réponse à l'auteur (facultative)</Ui> : elle s'affiche sur la page «&nbsp;Mon compte&nbsp;»
              de l'auteur, seul retour qu'il reçoit.
            </li>
          </Steps>
          <P>
            Marquer un signalement traité ne corrige rien sur la fiche : la correction se fait dans l'onglet. Un
            signalement fermé ne se rouvre pas.
          </P>
        </>
      ),
    },
  ],
};

const ADMIN_GUIDE: HelpGuide = {
  id: "admin",
  role: "ADMIN",
  title: "Guide de l'administrateur",
  summary: "Les comptes et leurs rôles, et les tickets de la recherche IA. Le contenu se gère comme pour un gestionnaire.",
  sections: [
    {
      id: "comptes",
      title: "Les comptes",
      body: (
        <>
          <P>
            <Ui>Comptes</Ui>, dans le menu du back-office, liste chaque compte : son nom et son adresse, son rôle, son
            état, la date de sa première connexion. Votre propre ligne porte <Ui>(vous)</Ui>.
          </P>
          <Items>
            <li>
              Les rôles : <Ui>Utilisateur</Ui> consulte et signale ; <Ui>Gestionnaire</Ui> tient aussi le contenu à
              jour et traite les signalements ; <Ui>Administrateur</Ui> gère aussi les comptes et la recherche IA.
            </li>
            <li>
              Les états : <Ui>Invité</Ui> (l'adresse est sur la liste, la première connexion reste à faire),{" "}
              <Ui>Actif</Ui>, <Ui>Désactivé</Ui> (plus de connexion).
            </li>
          </Items>
        </>
      ),
    },
    {
      id: "ajouter",
      title: "Ajouter un collègue",
      body: (
        <>
          <Steps>
            <li>
              <Ui>Ajouter une adresse</Ui> : son adresse de travail, en <Domain /> (le seul domaine accepté),
              puis <Ui>Ajouter à la liste</Ui>. Le compte est <Ui>Invité</Ui>, en <Ui>Utilisateur</Ui> ;
            </li>
            <li>
              prévenez le collègue aussitôt, de vive voix ou par Teams : aucun e-mail n'est envoyé. Il fait sa première
              connexion depuis la page de connexion (<Ui>Choisissez votre mot de passe</Ui>) ;
            </li>
            <li>
              au besoin, <Ui>Changer le rôle</Ui>, avant ou après sa première connexion.
            </li>
          </Steps>
          <Shot name="admin-ajouter-adresse" caption="La fenêtre qui ajoute une adresse à la liste." />
          <Note>
            Tant qu'un invité n'a pas fait sa première connexion, quiconque connaît son adresse peut choisir le mot de
            passe à sa place. D'où le prévenir juste après l'ajout, et retirer l'adresse s'il ne s'en sert pas. Un
            collègue qui ne peut pas faire sa première connexion alors que son compte paraît <Ui>Actif</Ui> : quelqu'un
            l'a peut-être faite avant lui. <Ui>Désactiver</Ui>, puis <Ui>Réactiver</Ui>, et prévenez-le.
          </Note>
        </>
      ),
    },
    {
      id: "changer",
      title: "Changer un compte",
      body: (
        <>
          <Items>
            <li>
              <Ui>Changer le rôle</Ui>, puis <Ui>Enregistrer le rôle</Ui> : le changement vaut dès la page suivante,
              sans nouvelle connexion.
            </li>
            <li>
              Un mot de passe oublié : <Ui>Remettre en première connexion</Ui>. Le mot de passe est effacé, les
              sessions ouvertes sont coupées, le rôle et le nom sont gardés ; prévenez le collègue, qui choisit un
              nouveau mot de passe par la première connexion.
            </li>
            <li>
              Un collègue qui part : <Ui>Désactiver</Ui>, puis <Ui>Désactiver le compte</Ui>. Plus de connexion, ses
              sessions sont coupées, son nom reste dans «&nbsp;Modifié par&nbsp;». <Ui>Réactiver</Ui> le remet en première
              connexion.
            </li>
            <li>
              <Ui>Retirer</Ui> efface une adresse de la liste, pour un invité seulement. Un compte qui a modifié une
              donnée, envoyé ou traité un signalement ne se retire pas : désactivez-le.
            </li>
            <li>
              <Ui>Renseigner l'adresse</Ui> : pour un compte créé avant la liste des adresses, qui se connecte encore
              par un ancien identifiant ; une fois l'adresse posée, l'identifiant ne sert plus.
            </li>
          </Items>
          <P>
            Sur votre propre ligne, <Ui>Mon compte</Ui> remplace ces boutons : on ne se retire, ne se désactive ni ne
            se remet en première connexion soi-même. Le site garde toujours au moins un administrateur actif : il
            refuse de rétrograder ou de désactiver le dernier.
          </P>
          <Note>
            Un compte désactivé ou remis en première connexion perd aussitôt le back-office, «&nbsp;Mon compte&nbsp;» et toute
            écriture. La simple lecture du site peut lui rester jusqu'à huit heures, le temps que sa session expire.
          </Note>
          <P>
            Un collègue bloqué après cinq échecs de connexion attend un quart d'heure : rien, dans le back-office, ne lève
            le blocage plus tôt, pas même la remise en première connexion.
          </P>
        </>
      ),
    },
    {
      id: "inbox",
      title: "La Validation Inbox",
      body: (
        <>
          <P>
            <Ui>Validation Inbox</Ui> ouvre <Ui>Boîte de Réception — Validation IA</Ui> : les données trouvées par la
            recherche IA, en tickets, à vérifier avant qu'elles n'entrent dans les fiches. Ouvrez un ticket, corrigez-le
            au besoin, puis validez-le (ses données s'écrivent à votre nom, «&nbsp;Validé par …, depuis une recherche IA&nbsp;»)
            ou <Ui>Rejeter ce ticket</Ui>. <Ui>Purger</Ui> supprime les tickets déjà validés ou rejetés.
          </P>
          <P>
            Les signalements des collègues n'y arrivent jamais : ils sont dans <Ui>Signalements</Ui>.
          </P>
        </>
      ),
    },
    {
      id: "ia",
      title: "La recherche IA",
      body: (
        <>
          <P>
            La recherche IA est gelée : elle n'est pas en ligne. Sa console vit sur la branche local du dépôt, sur le
            poste de l'administrateur, et ne se lance que là. Le README de cette branche dit comment la lancer. En
            ligne, il n'en reste que la Validation Inbox, dont un bandeau compte les contributions qui attendent ce
            lancement.
          </P>
          <Note>
            Lancer la recherche IA peut payer des services externes (Tavily, Gemini) : jamais sans l'accord du
            propriétaire du projet.
          </Note>
        </>
      ),
    },
  ],
};

/** Un guide par rôle, dans l'ordre des rôles. */
export const HELP_GUIDES: HelpGuide[] = [USER_GUIDE, MANAGER_GUIDE, ADMIN_GUIDE];

/** Le guide que `role` voit : celui de son rôle, et lui seul (D108). */
export function guideFor(role: UserRole): HelpGuide {
  const guide = HELP_GUIDES.find((candidate) => candidate.role === role);
  if (!guide) throw new Error(`Aucun guide pour le rôle ${role}`);
  return guide;
}
