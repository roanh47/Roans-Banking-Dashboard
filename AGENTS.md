# AGENTS.md — Roans-Banking-Dashboard (repo)

Dit bestand gaat over **deze repo**. De draaiende kopie staat in
`/home/roan/docker/Roans-Banking-Dashboard`; daar staat een `AGENTS.md` met
dezelfde regels plus de commando's om te bouwen en te herstarten.

## Wat dit is

Privé-geldbeheer voor één persoon: bankieren via PSD2 (Enable Banking),
spaarrekeningen en IBKR erbij gerekend, inzicht in waar het geld heen gaat.
Geen product voor anderen, geen multi-user.

## Harde regels

1. **Nooit persoonlijke data in git.** Geen IBAN's, rekeningnummers, saldi,
   namen van tegenpartijen, tokens of sleutels — niet in code, docs, tests,
   voorbeelden of commits. Die horen in `.env` en `scripts/bridge-config.json`
   en die staan in `.gitignore`. **De repo mag publiek zijn; de inhoud niet.**
2. **Nooit historie wissen.** Een sync werkt bij (upsert) en voegt toe, maar
   verwijdert niets. Loskoppelen laat de historiek staan. Rabobank gaat maar
   een jaar of acht terug: wat eenmaal weg is, is niet meer op te halen.
3. **Backups zijn onderdeel van het product**, niet een extraatje. Zie
   `scripts/backup-dashboard.sh` en `scripts/restore-dashboard.sh`.
4. **Geen aannames over de bank-API.** Wat de consent wel en niet levert is
   getest gedrag, geen documentatie: Enable Banking geeft alleen de
   betaalrekening en geen tegenpartij-IBAN. Rekeningen daarbuiten worden
   voorspeld (`backend/app/derive.py`).
5. **Bewijs boven belofte.** Een wijziging is pas klaar als er echte output
   is: endpoint-antwoord, testresultaat of een teruggezette backup.

## Structuur

- `Docker/Backend/app/` — FastAPI: `main.py`, `database.py`, `derive.py`,
  `routers/`.
- `Docker/Frontend/` — `index.html`, `js/app.js`, `css/style.css`.
- `Docker/scripts/` — brug naar Firefly, backup, terugzetten.
- `.env.example` — welke variabelen nodig zijn, zonder waarden.
