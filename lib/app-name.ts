/**
 * lib/app-name.ts — Le nom de l'application (plan gestion-contenu, D119)
 *
 * Le seul endroit où il s'écrit : la barre du site, la connexion, le menu du
 * back-office, le titre des onglets, la doc de l'API et l'aide l'importent.
 * Il remplace, depuis l'étape 15, les deux noms qu'avait l'écran (D115).
 * Le changer : cette ligne, puis les captures et les Word du guide
 * (`public/help/`, `docs/guide/`), qui le montrent (D112).
 *
 * Sans dépendance : des composants client l'importent.
 */
export const APP_NAME = "Veille concurrentielle";
