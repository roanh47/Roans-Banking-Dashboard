CATEGORY_RULES = [
    # Income
    (["salaris", "salary", "aab inz", "tikkie"], "income"),
    # Food & groceries
    (["albert heijn", "jumbo", "lidl", "aldi", "dirk", "plus", "coop", "hoogvliet",
      "ah to go", "ah station", "action", "luncherie", "deli"],
     "food"),
    # Dining out
    (["restaurant", "café", "cafe", "eetcafe", "lunchroom", "bistro", "pannekoek",
      "mcdonalds", "burger", "dominos", "pizza", "zushi", "sushi",
      "asian food", "lin zhu", "hotel de bourgondi"],
     "dining"),
    # Transport
    (["ns ", "ret", "gvb", "htm", "connexxion", "keolis", "arriva",
      "tank", "shell", "bp ", "totalenergies", "essoy",
      "ov-chipkaart", "kiosk ut"],
     "transport"),
    # Shopping
    (["h&m", "zara", "mediamarkt", "coolblue", "bol.com", "amazon",
      "aliexpress", "gamma", "karwei", "praxis", "hornbach",
      "edc retail", "g2a", "csfloat", "action"],
     "shopping"),
    # Housing
    (["huur", "woning", "vve", "waternet", "nuon", "eneco", "vattenfall",
      "essent", "huren"],
     "housing"),
    # Entertainment
    (["netflix", "spotify", "disney", "pathé", "vue", "videoland",
      "lasergame", "gamestate", "bol.com"],
     "entertainment"),
    # Health
    (["apotheek", "huisarts", "ziekenhuis", "dokter", "fysio",
      "tandarts"],
     "health"),
    # Subscriptions
    (["bitwarden", "icloud", "google", "microsoft 365", "adobe",
      "github", "digitalocean", "vercel", "dropbox"],
     "subscriptions"),
    # Transfers
    (["overschrijving", "overboeking", "deposit", "storting",
      "sepa", "belastingdienst", "duo "],
     "transfer"),
    # Shopping - bol.com webshop
    (["bol.com", "marktplaats"],
     "shopping"),
]


def categorize(merchant: str, description: str) -> str:
    """Categorize a transaction based on merchant name or description."""
    text = (merchant + " " + description).lower()
    for keywords, category in CATEGORY_RULES:
        for kw in keywords:
            if kw in text:
                return category
    return "other"
