#!/usr/bin/env python3
"""Zet de saldo's uit Firefly in het banking-dashboard.

Draait op de host, want daar is Firefly bereikbaar op 127.0.0.1:8085. Het
dashboard draait in een container en kan daar niet bij.

Het dashboard gebruikt deze bedragen als ijkpunt voor rekeningen die niet in de
PSD2-consent zitten (spaarrekeningen, IBKR). Daarna telt het zelf elke
overboeking van of naar de betaalrekening erbij op.

Gebruik:
    python3 firefly_bridge.py             # een keer pushen
    python3 firefly_bridge.py --dry-run   # laat de payload zien, stuurt niets

Config: bridge-config.json naast dit script (staat niet in git).
    {
      "firefly_url": "http://127.0.0.1:8085",
      "dashboard_url": "http://127.0.0.1:8200",
      "push_token": "<hetzelfde als PUSH_TOKEN in de .env van het dashboard>",
      "firefly_token_file": "/tmp/ff_token.txt",
      "accounts": [
        {"firefly_id": 3,   "kind": "savings", "keywords": ["vrij spaargeld"]},
        {"firefly_id": 272, "kind": "savings", "keywords": []},
        {"firefly_id": 274, "kind": "broker",  "keywords": ["ibkr"]}
      ]
    }

De sleutel per rekening wordt "firefly:<id>". keywords zijn de woorden waarop
het dashboard een overboeking op de betaalrekening aan deze rekening koppelt
(naast het IBAN, als de bank dat levert).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HIER = Path(__file__).resolve().parent
CONFIG_PAD = HIER / "bridge-config.json"


def lees_config() -> dict:
    if not CONFIG_PAD.exists():
        sys.exit(f"Geen {CONFIG_PAD}. Kopieer bridge-config.example.json en vul hem in.")
    with CONFIG_PAD.open(encoding="utf-8") as fh:
        return json.load(fh)


def firefly_token(cfg: dict) -> str:
    if os.environ.get("FIREFLY_TOKEN"):
        return os.environ["FIREFLY_TOKEN"].strip()
    pad = Path(cfg.get("firefly_token_file") or "/tmp/ff_token.txt")
    if not pad.exists():
        sys.exit(f"Geen Firefly-token: {pad} bestaat niet en FIREFLY_TOKEN is leeg.")
    return pad.read_text(encoding="utf-8").strip()


def api(url: str, token: str) -> dict:
    verzoek = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(verzoek, timeout=30) as antwoord:
            return json.loads(antwoord.read().decode("utf-8"))
    except urllib.error.HTTPError as fout:
        sys.exit(f"Firefly gaf {fout.code} op {url}: {fout.read().decode('utf-8', 'replace')[:200]}")
    except urllib.error.URLError as fout:
        sys.exit(f"Firefly niet bereikbaar op {url}: {fout.reason}")


def laatste_transactiedatum(basis: str, token: str, rekening_id: int) -> str | None:
    """Nieuwste boekdatum van deze rekening in Firefly, of None."""
    query = urllib.parse.urlencode({"limit": 1, "page": 1, "sort": "-date"})
    try:
        data = api(f"{basis}/api/v1/accounts/{rekening_id}/transactions?{query}", token)
    except SystemExit:
        return None
    rijen = (data.get("data") or [])
    if not rijen:
        return None
    attributen = rijen[0].get("attributes") or {}
    return (attributen.get("transactions") or [{}])[0].get("date")


def bouw_payload(cfg: dict) -> dict:
    basis = (cfg.get("firefly_url") or "http://127.0.0.1:8085").rstrip("/")
    token = firefly_token(cfg)

    alle = api(f"{basis}/api/v1/accounts?type=asset&limit=100", token).get("data") or []
    per_id = {int(r["id"]): r for r in alle}

    rekeningen = []
    for wens in cfg.get("accounts") or []:
        rekening_id = int(wens["firefly_id"])
        rij = per_id.get(rekening_id)
        if not rij:
            print(f"! Firefly-rekening {rekening_id} niet gevonden, overgeslagen")
            continue
        attr = rij.get("attributes") or {}
        ijkpunt = attr.get("opening_balance_date")
        laatste = laatste_transactiedatum(basis, token, rekening_id)
        # Het ijkpunt is het moment waarop dit bedrag gold. Overboekingen daarna
        # telt het dashboard er zelf bij op.
        datum = max([d for d in (attr.get("opening_balance_date"), laatste) if d] or [""])[:10]
        rekeningen.append({
            "key": f"firefly:{rekening_id}",
            "label": attr.get("name") or f"Firefly {rekening_id}",
            "kind": wens.get("kind") or "savings",
            "iban": attr.get("iban") or None,
            "account_number": attr.get("account_number") or None,
            "balance": float(attr.get("current_balance") or 0),
            "balance_date": datum,
            "keywords": [k.lower() for k in (wens.get("keywords") or [])],
        })
    return {"source": "firefly", "accounts": rekeningen}


def push(cfg: dict, payload: dict) -> dict:
    doel = (cfg.get("dashboard_url") or "http://127.0.0.1:8200").rstrip("/")
    verzoek = urllib.request.Request(
        f"{doel}/api/external/accounts",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Push-Token": cfg.get("push_token") or "",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(verzoek, timeout=30) as antwoord:
            return json.loads(antwoord.read().decode("utf-8"))
    except urllib.error.HTTPError as fout:
        sys.exit(f"Dashboard gaf {fout.code}: {fout.read().decode('utf-8', 'replace')[:300]}")
    except urllib.error.URLError as fout:
        sys.exit(f"Dashboard niet bereikbaar op {doel}: {fout.reason}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Firefly-saldo's naar het banking-dashboard")
    parser.add_argument("--dry-run", action="store_true", help="alleen laten zien, niets sturen")
    args = parser.parse_args()

    cfg = lees_config()
    payload = bouw_payload(cfg)

    if args.dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    antwoord = push(cfg, payload)
    for rekening in antwoord.get("accounts") or []:
        print(f'{rekening["name"]}: ijkpunt {rekening["baseline"]:.2f} op {rekening["baseline_date"]} '
              f'-> {rekening["balance"]:.2f} ({rekening["delta"]:+.2f} aan overboekingen)')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
