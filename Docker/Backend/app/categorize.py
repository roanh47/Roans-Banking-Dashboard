"""Categorieën bepalen zonder LLM en zonder netwerkcall per transactie.

Drie lagen, in deze volgorde:

0. **De eigen boekhouding** — overboekingen tussen je eigen rekeningen, spaargeld,
   zakgeld en betaalverzoeken. Die horen nooit bij een winkel thuis.
1. **Trefwoorden** — één tabel met Nederlandse (en internationale) ketens,
   betaalprocessoren en banktermen. Puur tekst, dus geen model en geen kosten.
2. **Wat je eerder deed** — per tegenpartij de categorie die daar het vaakst op
   staat (`learned_map`). Leert van de eigen historie, blijft offline, en pakt de
   namen die geen enkele lijst kent.

De categorieën zijn dezelfde als in `frontend/css/style.css` (`.category-badge.*`):
food, dining, transport, shopping, housing, health, entertainment, subscriptions,
education, income, transfer, other. Nieuwe naam toevoegen = daar ook een kleur zetten.

Trefwoorden met een spatie erachter ("ns ", "ah ") matchen op woordgrens, niet als
losse letters midden in een naam: anders wordt "Jans Bakkerij" ineens vervoer.
"""

import json
import os
import re

# Eigen namen en IBAN's horen niet in een publieke repo: die komen uit
# config/private-categorize.json (buiten git). Ontbreekt dat bestand, dan werkt
# alles behalve de persoonlijke trefwoorden gewoon door.
PRIVE_PAD = os.environ.get("PRIVATE_CATEGORIZE", "/app/config/private-categorize.json")


def _prive():
    """Lees eigen namen, inkomensnamen en eigen IBAN's uit de privé-config."""
    try:
        with open(PRIVE_PAD, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return [], []
    eigen = [str(x).strip().lower() for x in data.get("eigen", []) if str(x).strip()]
    inkomen = [str(x).strip().lower() for x in data.get("inkomen", []) if str(x).strip()]
    return eigen, inkomen


_EIGEN_PRIVE, _INKOMEN_PRIVE = _prive()

# Betaalprocessoren zetten hun eigen naam voor die van de winkel:
# "Zettle_*E Golge Foodt", "NYX*VendingWork", "CCV*Bakkerij Jansen".
PROCESSORS = (
    "mol*",
    "stichting mollie",
    "via stichting mollie",
    "zettle", "izettle", "nyx", "sumup", "sum up", "ccv", "mollie", "adyen",
    "buckaroo", "paypal", "sq *", "worldline", "globalcollect", "global collect",
    "stripe", "multisafepay", "pay.nl", "paynl", "easypay", "ems ", "ingenico",
    "weareplanet", "planet ", "bunq", "stichting dri", "currence",
    "ppro payment", "online payment platform", "mollie b.v.",
)

# Draaien tegen je eigen rekeningen of die van familie: geen winkel, geen uitgave.
EIGEN_PUBLIEK = (
    "spaarrekening", "spaargeld", "studiespaarrekening", "studiesparen",
    "interactive brokers", "ibkr", "naar:", "van:", "overschrijving",
    "overboeking", "eigen rekening", "revolut", "wise europe",
)
EIGEN = EIGEN_PUBLIEK + tuple(_EIGEN_PRIVE)

# Geld dat binnenkomt en geen salaris is: familie, toeslagen, teruggaven.
INKOMEN_PUBLIEK = (
    "salaris", "loon", "salary", "studiefinanciering", "duo ", "zorgtoeslag",
    "huurtoeslag", "kindgebonden", "kinderbijslag", "toeslag", "zakgeld",
    "storting", "deposit", "terugstorting", "schenking",
    "rvo", "rente over", "subsidie",
)
INKOMEN = INKOMEN_PUBLIEK + tuple(_INKOMEN_PRIVE)

# (trefwoorden, categorie, richting) — richting is -1 voor af (uitgave),
# +1 voor bij (inkomst), None als het niet uitmaakt. Eerste treffer wint.
CATEGORY_RULES = [
    # --- Inkomen (belastingdienst alleen bij geld dat terugkomt) ---
    (INKOMEN, "income", None),
    (["belastingdienst"], "income", 1),
    (["belastingdienst"], "other", -1),

    # --- Overboeken tussen eigen rekeningen ---
    (EIGEN, "transfer", None),
    (["betaalverzoek", "tikkie", "verzoek", "betaalverzoeken"], "income", 1),
    (["betaalverzoek", "tikkie", "verzoek", "betaalverzoeken"], "transfer", -1),

    # --- Boodschappen ---
    (["albert heijn", "ah to go", "ah station", "ah ", "jumbo", "lidl", "aldi",
      "dirk", "plus supermarkt", "coop", "hoogvliet", "vomar", "spar ",
      "spar dekker", "nettorama", "poiesz", "boni ", "jan linders",
      "bas van der heijden", "agrimarkt", "picnic", "flink", "gorillas",
      "getir", "hello fresh", "hellofresh", "marley spoon", "crisp",
      "versmarkt", "groenteboer", "slager", "bakker", "bakkerij", "viswinkel",
      "kaaswinkel", "toko", "action", "big bazar", "wibra", "xenos",
      "blokker", "kruidvat", "etos", "trekpleister", "drogist", "cigo",
      "kiosk", "primera", "bruna", "jamin", "vending", "vendingwork",
      "selecta", "automaat", "snoep", "chocolade", "gall&gall",
      "slijterij", "dunkin", "nandos", "mcd ", "avondwinkel"],
     "food", None),

    # --- Eten buiten de deur ---
    (["restaurant", "restaurante", "café", "cafe", "eetcafe", "eetcafé",
      "cafetaria", "snackbar", "snack", "friet", "patat", "grillroom",
      "shoarma", "kebab", "döner", "doner", "pizzeria", "pizza", "domino",
      "new york pizza", "mcdonald", "burger king", "kfc", "five guys",
      "subway", "taco", "wok", "sushi", "zushi", "noodle", "lin zhu",
      "thuisbezorgd", "takeaway", "uber eats", "ubereats", "deliveroo",
      "just eat", "justeat", "foodt", "food truck", "foodtruck", "e golge",
      "lunchroom", "bistro", "brasserie", "grand café", "grand cafe",
      "coffee", "koffie", "starbucks", "coffeelovers", "bagels", "ijssalon",
      "gelato", "ijswinkel", "poffertjes", "pannenkoek", "pannekoek",
      "bourgondi", "hotel", "bar ", "borrel", "diner", "eetc.", "zusje",
      "gildehuus", "horeca", "frituur"],
     "dining", None),

    # --- Vervoer: OV, taxi, brandstof, parkeren, auto ---
    (["ns reizigers", "ns-kaartje", "ns groep", "ns ", "ret ", "ret-",
      "gvb", "htm", "connexxion", "keolis", "arriva", "qbuzz", "u-ov",
      "ov-chipkaart", "9292", "tfl travel", "transport for london",
      "uber", "bolt.eu", "snappcar", "greenwheels", "sixt", "hertz",
      "avis", "parkmobile", "q-park", "qpark", "easypark", "yellowbrick",
      "tankstation", "shell", "bp ", "totalenergies", "total ", "esso",
      "q8", "tango", "tinq", "firezone", "wasstraat", "carwash", "anwb",
      "apk", "garage", "banden", "autobedrijf", "trein", "bus ", "metro",
      "taxi", "ov ", "vliegticket", "ryanair", "easyjet", "transavia",
      "klm", "ev charge", "laadpas", "laadstation", "allego", "laadpunt",
      "shell recharge", "vandebron", "avia", "trans link systems",
      "dfds", "ns-kaartje", "laadkaart"],
     "transport", None),

    # --- Kleding, spullen, elektronica ---
    (["h&m", "h en m", "zara", "primark", "c&a", "wehkamp", "zalando",
      "about you", "asos", "amazon", "amzn", "bol.com", "bol ", "coolblue",
      "mediamarkt", "media markt", "bcc", "expert", "hema", "ikea",
      "leenbakker", "kwantum", "karwei", "gamma", "praxis", "hornbach",
      "intratuin", "bouwmaat", "toolstation", "decathlon", "intersport",
      "perry sport", "sport 2000", "fietsen", "bike", "so low", "solow",
      "aliexpress", "temu", "shein", "tradingshenzhen", "trading shenzhen",
      "alipay", "g2a", "kinguin", "eneba", "csfloat", "marktplaats",
      "megekko", "mac voor minder", "bb-nothing",
      "vinted", "catawiki", "cex", "gamemania", "intertoys", "bart smit",
      "kijkshop", "juwelier", "opticien", "brillen", "schoenen",
      "sportwinkel", "edc retail", "meubel", "bedden", "wonen", "mobielwerkt",
      "gsm", "telefoon", "laptop", "computer", "coolstore", "azerty",
      "alternate", "amazon.de", "amazon.com", "online payment platform",
      "paypal", "gamivo", "g2g", "keak", "nanonoble", "uniqlo", "nike",
      "vidaxl", "tegeltje", "matrasconcurrent", "philips", "okaphone",
      "via worldpay", "via stripe", "via pay.nl", "via paynl", "etsy",
      "fiverr", "brand access", "flawless shopping", "stockroom",
      "etsy.com", "shopify"],
     "shopping", None),

    # --- Wonen, energie, gemeente ---
    (["huur", "woningbouw", "woningcorporatie", "woningstichting", "vve",
      "hypotheek", "waternet", "vitens", "evides", "dunea", "brabant water",
      "eneco", "vattenfall", "essent", "nuon", "greenchoice", "budget energie",
      "oxxio", "energiedirect", "innova", "meander", "coteq", "stedin",
      "liander", "netbeheer", "gemeente", "waterschap", "afval", "riool",
      "belastingen", "woz", "vastgoed", "makelaar", "opstalverzekering",
      "inboedel", "wierden en borgen", "huurwoning", "lefier", "ymere",
      "woonbron", "woonstichting"],
     "housing", None),

    # --- Zorg ---
    (["apotheek", "huisarts", "ziekenhuis", "umcg", "martini", "dokter",
      "fysio", "tandarts", "orthodontist", "menzis", "cz ", "vgz",
      "zilveren kruis", "achmea", "unive", "ohra", "bewuzt", "asr ",
      "ditzo", "salland", "envelop", "zorgverzekeraar", "zorgverzekering",
      "optiek", "bril", "lenzen", "ggz", "psycholoog", "podotherapeut", "infomedics",
      "medic", "zorg"],
     "health", None),

    # --- Abonnementen en diensten die maandelijks terugkomen ---
    (["netflix", "spotify", "disney", "videoland", "hbo", "sky ",
      "ziggo", "kpn", "odido", "t-mobile", "vodafone", "simyo", "youfone",
      "lebar", "ben ", "50plus", "torbox", "mullvad", "nordvpn", "proton",
      "icloud", "apple", "itunes", "google", "microsoft", "adobe",
      "bitwarden", "openai", "anthropic", "claude", "github", "digitalocean",
      "vercel", "hetzner", "cloudflare", "namecheap", "transip", "combell",
      "patreon", "discord", "twitch", "youtube", "chatgpt", "copilot",
      "usenet", "newsgroup", "dropbox", "onedrive", "notion", "openclaw",
      "cursor", "perplexity", "elevenlabs", "huggingface", "ollama",
      "mobile payment", "telecom", "openrouter", "opencode", "cline",
      "windsurf", "strato", "lm studio"],
     "subscriptions", None),

    # --- Studie ---
    (["hanzehogeschool", "hanze", "hogeschool", "universiteit", "collegegeld",
      "studystore", "studieboeken", "studiemateriaal", "schoolkosten",
      "noorderpoort", "rug ", "school ", "opleiding", "cursus",
      "rijvaardigheid", "cbr", "scholengemeenschap", "stichting scholeng",
      "studie", "lesgeld", "collegegeld "],
     "education", None),

    # --- Vermaak ---
    (["pathé", "pathe", "vue", "kinepolis", "bioscoop", "bios ", "cinema",
      "efteling", "duinrell", "slagharen", "walibi", "dierentuin",
      "zwembad", "concert", "ticketmaster", "ticketswap", "eventim",
      "mojo", "festival", "lowlands", "pinkpop", "pretpark", "bowlen",
      "lasergame", "gamestate", "arcade", "museum", "theater", "schouwburg",
      "playstation", "xbox", "nintendo", "steam", "steampowered", "riot",
      "epic games", "roblox", "hoyoverse", "genshin", "globalcollect",
      "global collect", "ubisoft", "bethesda", "ea games", "games",
      "game "],
     "entertainment", None),

    # --- Bankkosten en overige vaste lasten ---
    (["bankkosten", "kosten ", "rente", "contributie", "lidmaatschap",
      "abonnement", "verzekering", "premie", "polis", "centraal beheer",
      "aegon", "nationale-nederlanden", "nn group", "fbto", "promovendum",
      "anderson", "inshared", "allianz", "sns"],
     "other", None),
]

# Woorden die alleen op woordgrens mogen matchen: "ah ", "ns ", "bar " zouden
# anders midden in een andere naam toeslaan ("Jans Bakkerij" -> vervoer).
_GRENS = {}

_ONNODIG = re.compile(r"[^a-z0-9&.\s]")


def _schoon(tekst: str) -> str:
    """Kleed een omschrijving uit tot iets waar trefwoorden op passen."""
    t = (tekst or "").lower()
    t = t.replace("’", "'").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", t).strip()


def _ruw(tekst: str) -> str:
    """""Zonder processor ervoor: "zettle_*e golge foodt" -> "e golge foodt"."""
    t = _schoon(tekst)
    for p in PROCESSORS:
        if t.startswith(p):
            return t[len(p):].lstrip(" *_-.0123456789")
    for p in PROCESSORS:
        if p + "*" in t or p + "_" in t:
            return t.split(p, 1)[1].lstrip(" *_-.0123456789")
    return t


def _treffer(tekst: str, kw: str) -> bool:
    """Trefwoord zoeken; korte woorden alleen op woordgrens."""
    if kw != kw.strip():
        patroon = _GRENS.get(kw)
        if patroon is None:
            patroon = re.compile(r"\b" + re.escape(kw.strip()) + r"\b")
            _GRENS[kw] = patroon
        return patroon.search(tekst) is not None
    return kw in tekst


def _richting(amount) -> int:
    """-1 voor geld dat eraf gaat, +1 voor geld dat erbij komt, 0 onbekend."""
    try:
        waarde = float(amount)
    except (TypeError, ValueError):
        return 0
    if waarde > 0:
        return 1
    if waarde < 0:
        return -1
    return 0


def categorize(merchant: str = "", description: str = "", amount=None,
               counterparty_iban: str = "", learned: dict | None = None) -> str:
    """Bepaal de categorie uit context, trefwoorden en eerdere boekingen."""
    volledig = _schoon(f"{merchant or ''} {description or ''}")
    kaal = _ruw(f"{merchant or ''} {description or ''}")
    richting = _richting(amount)

    for tekst in (kaal, volledig):
        if not tekst:
            continue
        for keywords, category, alleen in CATEGORY_RULES:
            if alleen is not None and richting and alleen != richting:
                continue
            for kw in keywords:
                if _treffer(tekst, kw):
                    return category
        # Richting onbekend (geen bedrag): de eerste twee lagen alsnog toepassen.
        if not richting:
            break

    if not richting:
        for keywords, category, _ in CATEGORY_RULES[:2]:
            for kw in keywords:
                if _treffer(volledig, kw):
                    return category

    # Laag 2: hoe is deze tegenpartij eerder ingedeeld?
    if learned:
        sleutel = _tegenpartij(merchant, description)
        if sleutel and sleutel in learned:
            return learned[sleutel]

    return "other"


def _tegenpartij(merchant: str, description: str) -> str:
    """Sleutel waaronder de leerlaag een tegenpartij onthoudt."""
    basis = _schoon(merchant or "") or _schoon(description or "")
    basis = _ONNODIG.sub(" ", basis)
    return re.sub(r"\s+", " ", basis).strip()[:60]


def learned_map(conn, min_aantal: int = 2, drempel: float = 0.6) -> dict:
    """Per tegenpartij de categorie die daar het vaakst op staat.

    Alleen tegenpartijen die je vaker bent tegengekomen (standaard 2×) en waar
    één categorie duidelijk de baas is (standaard 60%). Zo leert het dashboard
    van je eigen indeling zonder per transactie een model te vragen.
    """
    rijen = conn.execute(
        """SELECT COALESCE(merchant_name, '') AS m, COALESCE(description, '') AS d,
                  category AS c, COUNT(*) AS n
           FROM transactions
           WHERE category IS NOT NULL AND category != 'other'
           GROUP BY m, d, c"""
    ).fetchall()

    per_tegenpartij: dict[str, dict] = {}
    for r in rijen:
        sleutel = _tegenpartij(r["m"], r["d"])
        if not sleutel:
            continue
        vak = per_tegenpartij.setdefault(sleutel, {})
        vak[r["c"]] = vak.get(r["c"], 0) + r["n"]

    uit = {}
    for sleutel, vak in per_tegenpartij.items():
        totaal = sum(vak.values())
        categorie, aantal = max(vak.items(), key=lambda kv: kv[1])
        if aantal >= min_aantal and aantal / totaal >= drempel:
            uit[sleutel] = categorie
    return uit
