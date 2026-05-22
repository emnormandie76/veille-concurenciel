J'ai des probleme dans l'app a réglé deja,

probleme lors de l'import de certaine statistique, par exemple la capacity, l'ia a detecté un cursus a 230 place mais dans la boite de l'admin elle ne precise pas le campus n le cursus auquel les informations sont rattachable.

Dans le inbox admin aussi ne pas mettre l'id de l'école pour laquel l'info la concerne mais directement mettre le nom car c'est a destination des utilisateur. Dans le meme cas, trouver un moyen dans ce tableau d ajouter campus concerné mais également le parcours concerné dans les cas ou c'est le cas. trouver un moyen de bien l'ajouté. Et également permettre le faite que lorsque le tableau est trop grand pouvoir scroll horizontalement sur les petits ecran pour l'ux. sinon le bouton est caché.
Je veux que ces infos soit également ajouté dans le panel-header de la proposition pour que l'utilisateur comprenne facilement que les information concerne tel ecole de tel campus de tel parcours.


Probleme dans le corwdsourcing, l'ia met donne à l'admin des données incomplete exemple = sur capacity, on me donne pas les places alors que l'info est obligatoire (si ce genre d'info est non présente alors rejeté) de plus, pour ce genre de type capacity, ranking, pricing il doivent etre rataché à un parcours ! 
J'ai eu justement une erreur sur capacity = programId manquant pour un ticket Capacity sachant que le json de sortie de l'ia été = 
{
  "source_url": "https://www.letudiant.fr/fiches/etudes/fiche/em-normandie-2.html",
  "year_assumed": false,
  "academic_year": 2025,
  "spots_available": null
}
la forme du json doit obligatoirement avoir un programe id pour les type de ticket capacity, ranking, pricing en plus de respecté les valeurs obligatoire en non null