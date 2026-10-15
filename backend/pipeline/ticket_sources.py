"""
backend/pipeline/ticket_sources.py — Les trois sources d'un ticket du pipeline

La colonne `urls` d'un ticket `Automated_AI` est le bloc « Sources » de l'inbox.
Elle portait toutes les pages lues par Tavily Research : des dizaines de liens,
dont aucun ne disait lequel prouvait la donnée. `validate` ne la lit pas : la
couper ne change aucune donnée de production.

Décisions du propriétaire du 15 octobre 2026 (journal du plan backend-local,
§11) :

  1. au plus 3 liens, quitte à ce que des informations ne soient plus
     vérifiables ;
  2. choisis dans cet ordre, sans doublon :
       a. les URL citées par les données extraites (`source_url`,
          `source_urls`, à toute profondeur de la charge, dans l'ordre de
          lecture) ;
       b. le domaine officiel de l'école, et la page catalogue en Phase 1 ;
       c. le reste, dans l'ordre de Tavily ;
  3. la coupe se fait à l'écriture du ticket, ici, pour la Phase 1, la Phase 2
     et le rattachement campus ; l'inbox plafonne en plus les tickets déjà en
     base (lib/ticket-sources.ts, même règle) ;
  4. les liens par ligne restent : la charge n'est pas touchée ;
  5. les contributions du public ne passent jamais par ici.

**La page catalogue garde la première place** (décision du même jour) : en
Phase 1, vingt à trente programmes portent chacun leur `source_url`, et le
groupe « citées » prendrait les trois places. Les URL prioritaires
(`priority_urls`, le catalogue) : la première occupe la première place, les
autres concourent avec le domaine officiel. Sans URL prioritaire, l'ordre
ci-dessus s'applique tel quel.

**La coupe n'ajoute rien.** Elle choisit parmi les URL citées, les URL
prioritaires et le réservoir (la liste que l'écrivain stockait jusqu'ici) : un
classement qui ne portait que sa propre URL n'en garde qu'une.

**Doublons.** Deux URL sont la même au schéma et à la casse de l'hôte près, à
un `www.` de tête de l'hôte près, au fragment `#…` près et à une barre `/`
finale près ; la première écriture rencontrée reste. Le schéma et l'hôte sont
insensibles à la casse (RFC 3986, §3.1 et §3.2.2). Le `www.` est une décision
du propriétaire (15 octobre 2026, option A) : sur le ticket ESSCA, l'extraction
cite `https://essca.eu/…` et Tavily donne `https://www.essca.eu/…`, et une même
page prenait deux des trois places. Un seul `www.` est retiré, en tête
seulement (`www2.`, `en.` restent distincts). Ni le chemin, ni la requête, ni
le port ne sont touchés.

**Écartées** : tout ce qui n'est pas une chaîne `http://` ou `https://` avec un
hôte. Les espaces autour d'une URL sont retirés : ils n'en font pas partie
(RFC 3986, annexe C) et un modèle peut en rendre.

**Domaine officiel** (`School.official_domain`) : l'hôte lui-même ou un de ses
sous-domaines (`www.`, `admissions.`), jamais une sous-chaîne —
`em-lyon.com.exemple.net` n'est pas officiel. La colonne est saisie à la main
et varie : `www.essca.eu/`, `em-strasbourg.com/fr`, `www.em-normandie.com`. Le
schéma, le chemin et le port en sont retirés, et un `www.` de tête aussi : sans
cela, `en.em-normandie.com` ne serait pas officiel pour Em Normandie.

Seul l'ASCII est replié en minuscules, ici comme dans le reflet TypeScript : le
DNS ne replie que l'ASCII (RFC 4343), et les deux suites doivent rendre la même
chose. `test/fixtures/ticket_sources_cases.json` les tient.
"""

import re
from typing import Any, Iterable, Optional, Sequence

# Le plafond du bloc « Sources » d'un ticket du pipeline.
MAX_TICKET_SOURCES = 3

# Schéma http(s) (sans `re.IGNORECASE`, qui replierait aussi des lettres non
# ASCII), autorité, puis tout le reste.
_URL_RE = re.compile(r"^([Hh][Tt][Tt][Pp][Ss]?)://([^/?#]*)([\s\S]*)$")
# Un schéma quelconque en tête du domaine officiel (`https://www.em-lyon.com/`).
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")
# Les blancs ASCII seulement : `str.strip()` en retire d'autres que `trim()` en
# JavaScript, et les deux implémentations doivent s'accorder.
_BLANKS = " \t\n\r\f\v"


def _ascii_lower(text: str) -> str:
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in text)


def _host_of(hostport: str) -> str:
    """L'hôte d'un `hôte:port` : sans le port, crochets IPv6 gardés."""
    if hostport.startswith("["):
        end = hostport.find("]")
        return hostport[: end + 1] if end != -1 else hostport
    return hostport.split(":", 1)[0]


def _parse(url: Any) -> Optional[tuple[str, str, str, str, str]]:
    """
    `(url nettoyée, schéma, informations d'utilisateur avec leur @, hôte:port, reste)`,
    ou None si ce n'est pas une URL http(s) avec un hôte.
    """
    if not isinstance(url, str):
        return None
    text = url.strip(_BLANKS)
    match = _URL_RE.match(text)
    if not match:
        return None
    scheme, authority, rest = match.groups()
    at = authority.rfind("@")
    userinfo, hostport = authority[: at + 1], authority[at + 1:]
    if not _host_of(hostport):
        return None
    return text, scheme, userinfo, hostport, rest


def url_key(url: Any) -> Optional[str]:
    """
    La clé des doublons, ou None pour une URL écartée.

    Schéma et hôte en minuscules, un `www.` de tête de l'hôte retiré, fragment
    retiré, puis une barre `/` finale.
    """
    parsed = _parse(url)
    if parsed is None:
        return None
    _text, scheme, userinfo, hostport, rest = parsed
    host = _ascii_lower(hostport)
    if host.startswith("www."):
        host = host[4:]
    key = f"{_ascii_lower(scheme)}://{userinfo}{host}{rest.split('#', 1)[0]}"
    return key[:-1] if key.endswith("/") else key


def official_host(official_domain: Any) -> Optional[str]:
    """L'hôte officiel tiré de `School.official_domain`, sans `www.` de tête ; None s'il est vide."""
    if not isinstance(official_domain, str):
        return None
    text = _SCHEME_RE.sub("", official_domain.strip(_BLANKS), count=1)
    authority = re.split(r"[/?#]", text, maxsplit=1)[0]
    host = _ascii_lower(_host_of(authority[authority.rfind("@") + 1:]))
    if host.startswith("www."):
        host = host[4:]
    return host or None


def _is_official(url: Any, host: Optional[str]) -> bool:
    parsed = _parse(url)
    if parsed is None or not host:
        return False
    url_host = _ascii_lower(_host_of(parsed[3]))
    return url_host == host or url_host.endswith("." + host)


def is_official_url(url: Any, official_domain: Any) -> bool:
    """Vrai si l'URL est sur le domaine officiel ou sur un de ses sous-domaines."""
    return _is_official(url, official_host(official_domain))


def cited_urls(payload: Any) -> list[str]:
    """
    Les URL citées par une charge : toute clé `source_url` (une chaîne) ou
    `source_urls` (une liste de chaînes), à toute profondeur, dans l'ordre de
    lecture. Les valeurs sont rendues telles quelles : le tri vient après.
    """
    found: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key == "source_url":
                    if isinstance(value, str):
                        found.append(value)
                elif key == "source_urls":
                    if isinstance(value, list):
                        found.extend(item for item in value if isinstance(item, str))
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return found


def select_ticket_sources(
    reservoir: Iterable[Any],
    payload: Any = None,
    *,
    official_domain: Any,
    priority_urls: Sequence[Any] = (),
    limit: int = MAX_TICKET_SOURCES,
) -> list[str]:
    """
    Les liens du bloc « Sources » d'un ticket du pipeline, `limit` au plus.

    `reservoir` : la liste que l'écrivain stockait jusqu'ici, dans son ordre
    (les sources de Tavily). `payload` : la charge du ticket, où sont relevées
    les URL citées. `priority_urls` : la page catalogue en Phase 1 — la
    première valide prend la première place, les suivantes concourent avec le
    domaine officiel. `official_domain` est obligatoire : un oubli ferait
    disparaître ce groupe en silence.

    Ordre : [catalogue] → citées → autres pages catalogue et officielles du
    réservoir → reste du réservoir. Ni les entrées ni la charge ne sont
    modifiées.
    """
    chosen: list[str] = []
    seen: set[str] = set()

    def offer(url: Any) -> None:
        if len(chosen) >= limit:
            return
        parsed = _parse(url)
        if parsed is None:
            return
        key = url_key(parsed[0])
        if key in seen:
            return
        seen.add(key)
        chosen.append(parsed[0])

    pool = list(reservoir or ())
    priority = [url for url in (priority_urls or ()) if _parse(url) is not None]
    host = official_host(official_domain)

    if priority:
        offer(priority[0])
    for url in cited_urls(payload):
        offer(url)
    for url in priority[1:]:
        offer(url)
    for url in pool:
        if _is_official(url, host):
            offer(url)
    for url in pool:
        offer(url)
    return chosen
