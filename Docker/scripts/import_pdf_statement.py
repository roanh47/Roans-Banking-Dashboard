#!/usr/bin/env python3
"""Importeer oudere Rabobank-afschriften (PDF of uitgepakte tekst) als boekingen in het dashboard.

De PSD2-koppeling van de bank levert niets vóór 2019; dit script vult dat gat met de
afschrift-PDF's die je zelf downloadt. Rijen krijgen een eigen id (pdf-...) zodat de sync
ze nooit overschrijft, en de debet/credit-richting wordt gekalibreerd op de totalen die in
het afschrift zelf staan (Totaal afgeschreven / Totaal bijgeschreven) -- geen gokwerk.

Gebruik (in de container, PYTHONPATH=/app):
    python scripts/import_pdf_statement.py /path/afschrift.pdf --dry-run
    python scripts/import_pdf_statement.py /path/afschrift.pdf
    python scripts/import_pdf_statement.py /path/afschrift.txt --account-iban NL00BANK0123456789

Zonder --account-iban wordt het rekeningnummer uit het afschrift zelf gebruikt en opgezocht
in de accounts-tabel. Alleen periodes die de bank niet levert (ouder dan history_from) worden
toegevoegd; regels die al in de database staan worden overgeslagen.
"""
import argparse, itertools, json, re, sqlite3, sys, unicodedata
from collections import defaultdict
from datetime import datetime

DB_DEFAULT = '/app/data/dashboard.db'
SKIP = ('ac =', 'ba =', 'bc =', 'Rabo ', 'IBAN', 'BIC', 'RABONL2U', 'Datum aanmaak', 'Datum vanaf',
        'Datum tot en met', 'Beginsaldo', 'Eindsaldo', 'Totaal afgeschreven', 'Totaal bijgeschreven',
        'Ten name van', 'vervolg', 'Blad', 'Rente', 'CR = tegoed', 'D   = tekort')
HEADER_CUT = re.compile(r'(?:van\s+)?TD\s+datum\s+Type')
EDGE_NOISE = (r'\bBetaalautomaat\b', r'\bGeldautomaat\b', r'^\d+ van \d+$', r'^\d{4} [A-Z]{2}$',
              r'^\d{2}-\d{2}-\d{4}$', r'^0+$', r'^(?:TD|datum|Type|Tegenrekening|Naam/omschrijving|'
              r'Bedrag|af|bij|\(debet\)|\(credit\))$')


def eur(s):
    return float(s.replace('.', '').replace(',', '.'))


def tidy(s):
    s = HEADER_CUT.split(s)[0]
    toks = s.split()
    while toks and any(re.match(p, toks[0]) for p in EDGE_NOISE):
        toks.pop(0)
    while toks and any(re.match(p, toks[-1]) for p in EDGE_NOISE):
        toks.pop()
    s = re.sub(r'\s+\d+\s+van\s+\d+.*$', '', ' '.join(toks))
    s = re.sub(r'\s+\d{1,4}$', '', s)
    return re.sub(r'\s+', ' ', s).strip(' ,.-')


def extract_text(path):
    if path.lower().endswith('.pdf'):
        import fitz  # pymupdf
        doc = fitz.open(path)
        return '\n'.join(page.get_text() for page in doc)
    return open(path, encoding='utf-8', errors='replace').read()


def parse_statements(text):
    """Levert per afschrift (rekening + periode) de regels, plus de totalen uit de kop."""
    lines = [l.rstrip() for l in text.replace('\u00a0', ' ').split('\n')]
    stmts, cur = [], None
    i = 0
    while i < len(lines):
        l = lines[i].strip()
        if l == 'IBAN / Rekeningnummer' and i + 3 < len(lines):
            iban = re.sub(r'\s+', '', lines[i + 1].split('EUR')[0])
            blk = [x.strip() for x in lines[max(0, i - 22):i + 45]]
            tot_af = tot_bij = None
            for j, x in enumerate(blk):
                if x in ('Totaal afgeschreven',) and j + 1 < len(blk):
                    tot_af = blk[j + 1]
                if x in ('Totaal bijgeschreven',) and j + 1 < len(blk):
                    tot_bij = blk[j + 1]
            if tot_af is not None and tot_bij is not None:      # eerste pagina van een afschrift
                van = None
                for j, x in enumerate(blk):
                    if x == 'Datum vanaf' and j + 1 < len(blk):
                        van = blk[j + 1].strip()
                cur = {'iban': iban, 'af': eur(tot_af), 'bij': eur(tot_bij), 'van': van, 'rows': []}
                stmts.append(cur)
            elif cur is None or cur['iban'] != iban:            # vervolgpagina zonder totalen
                cur = {'iban': iban, 'af': None, 'bij': None, 'van': None, 'rows': []}
                stmts.append(cur)
        if cur is not None and i + 1 < len(lines):
            m = re.match(r'^(\d{2})-(\d{2})\s+([a-z]{2})$', l)
            nxt = lines[i + 1].strip()
            if m and (re.match(r'^NL\d{2} ?[A-Z]{4}', nxt) or nxt and not nxt[0].isdigit()):
                blk, j = [], i + 1
                while j < len(lines) and not re.match(r'^(\d{2})-(\d{2})\s+([a-z]{2})$', lines[j].strip()) \
                        and not lines[j].strip().startswith('Totaal ') and lines[j].strip() != 'Blad 1 van 1':
                    if any(lines[j].strip().startswith(p) for p in SKIP) or re.match(r'^Blad \d+ van', lines[j].strip()):
                        j += 1
                        continue
                    blk.append(lines[j].strip())
                    j += 1
                    if len(blk) > 14:
                        break
                amount, desc, iban_t, verwerk = None, [], None, None
                for b in blk:
                    vm = re.match(r'^Verwerkingsdatum:\s*(\d{2})-(\d{2})-(\d{4})$', b)
                    if vm:
                        verwerk = f'{vm.group(3)}-{vm.group(2)}-{vm.group(1)}'
                    elif re.match(r'^\d{1,3}(?:\.\d{3})*,\d{2}$', b):
                        amount = eur(b)
                    elif re.match(r'^NL\d{2} ?[A-Z]{4}', b):
                        iban_t = re.sub(r'\s+', '', b)
                    elif b and not re.match(r'^\d+([.,]\d+)?$', b):
                        desc.append(b)
                if amount:
                    cur['rows'].append({'d': int(m.group(1)), 'm': int(m.group(2)), 'type': m.group(3),
                                        'amount': amount, 'desc': ' '.join(desc), 'iban': iban_t,
                                        'verwerk': verwerk})
                i = j
                continue
        i += 1
    return stmts


def resolve_years(rows, start_year):
    year, prev = start_year, None
    for r in rows:
        if prev == 12 and r['m'] == 1:
            year += 1
        r['year'] = year
        prev = r['m']
        iso = r['verwerk'] or f"{r['year']:04d}-{r['m']:02d}-{r['d']:02d}"
        r['date'] = iso
    return rows


def calibrate(rows, tot_af, tot_bij):
    """Zoek de teken-toekenning per transactietype die de afschrifttotalen exact reproduceert."""
    types = sorted({r['type'] for r in rows})
    hits = []
    for bits in itertools.product([-1, 1], repeat=len(types)):
        sign = dict(zip(types, bits))
        debit = sum(r['amount'] for r in rows if sign[r['type']] < 0)
        credit = sum(r['amount'] for r in rows if sign[r['type']] > 0)
        if abs(debit - tot_af) < 0.005 and abs(credit - tot_bij) < 0.005:
            hits.append(sign)
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--db', default=DB_DEFAULT)
    ap.add_argument('--account-iban', default=None)
    ap.add_argument('--start-year', type=int, default=None, help='jaar van de eerste regel')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    con = sqlite3.connect(a.db)
    con.row_factory = sqlite3.Row
    text = extract_text(a.file)
    stmts = [s for s in parse_statements(text) if s['rows']]
    if not stmts:
        print('geen boekingen gevonden in', a.file)
        return 1

    added = skipped = 0
    for s in stmts:
        acc = None
        iban = a.account_iban.replace(' ', '') if a.account_iban else s['iban']
        for r in con.execute('SELECT * FROM accounts'):
            if (r['iban'] or '').replace(' ', '') == iban:
                acc = r
        if acc is None:
            print(f"  ! rekening {iban} niet in de accounts-tabel -- overgeslagen")
            continue
        start_year = a.start_year
        if start_year is None and s.get('van'):
            start_year = int(s['van'].strip()[-4:])
        if start_year is None:
            print(f"  ! jaar onbekend voor {iban} -- geef --start-year mee")
            continue
        all_rows = resolve_years(list(s['rows']), start_year)
        bank_lo = con.execute("SELECT MIN(booking_date) FROM transactions WHERE account_id=? AND id NOT LIKE 'pdf-%'",
                              (acc['id'],)).fetchone()[0] or '9999-12-31'
        rows = [r for r in all_rows if r['date'] < bank_lo]
        in_bank = len(all_rows) - len(rows)
        hits = calibrate(all_rows, s['af'], s['bij']) if s['af'] is not None else []
        if not hits:
            print(f"  ! {iban} {start_year}: teken niet te kalibreren op de afschrifttotalen -- overgeslagen")
            continue
        if len(hits) > 1:
            print(f"  ! {iban}: {len(hits)} mogelijke tekentoekenningen -- eerste gebruikt")
        sign = hits[0]
        print(f"  {iban}: {len(all_rows)} regels in het afschrift ({in_bank} vallen binnen het bereik van de bank, "
              f"{len(rows)} ouder), tekens {sign}, totalen af {s['af']} / bij {s['bij']} kloppen exact")
        have = {(r[0], round(r[1], 2)) for r in con.execute(
            'SELECT booking_date, amount FROM transactions WHERE account_id=?', (acc['id'],))}
        seq = 0
        for r in rows:
            amt = round(sign[r['type']] * r['amount'], 2)
            if (r['date'], amt) in have:
                # Rij bestaat al. Kwam die uit een oudere import, dan vullen we de
                # velden bij die toen nog niet werden opgeslagen -- zonder bedrag,
                # datum of omschrijving aan te raken.
                oud = con.execute(
                    'SELECT id, value_date FROM transactions WHERE account_id=? AND booking_date=? AND amount=?',
                    (acc['id'], r['date'], amt)).fetchone()
                if oud and oud['value_date'] is None:
                    con.execute(
                        'UPDATE transactions SET value_date=?, type_sub_code=?, raw_json=? WHERE id=?',
                        (f"{r['year']:04d}-{r['m']:02d}-{r['d']:02d}", r['type'], _ruw(r, amt), oud['id']))
                    print(f"    ~ {oud['id']} {r['date']} {amt:>8.2f}  velden bijgevuld")
                skipped += 1
                continue
            seq += 1
            rid = f"pdf-{iban[-4:]}-{r['date'][:4]}-{seq:03d}"
            desc = tidy(r['desc']) or (r['iban'] or 'onbekend')
            con.execute("""INSERT OR REPLACE INTO transactions
                (id, account_id, amount, currency, description, booking_date, category,
                 merchant_name, running_balance, inserted_at, counterparty_iban,
                 value_date, type_sub_code, raw_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (rid, acc['id'], amt, 'EUR', desc, r['date'],
                 _categorize(desc), _name(desc), None,
                 datetime.now().strftime('%Y-%m-%d %H:%M:%S'), r['iban'] or '',
                 f"{r['year']:04d}-{r['m']:02d}-{r['d']:02d}", r['type'], _ruw(r, amt)))
            have.add((r['date'], amt))
            added += 1
            print(f"    + {rid} {r['date']} {amt:>8.2f}  {desc}")
        lo = min(r['date'] for r in rows)
        if lo < (acc['history_from'] or '9999'):
            con.execute('UPDATE accounts SET history_from=? WHERE id=?', (lo, acc['id']))
            print(f"    history_from -> {lo}")
    if a.dry_run:
        con.rollback()
        print(f"DRY-RUN: {added} toe te voegen, {skipped} al aanwezig (niets weggeschreven)")
    else:
        con.commit()
        print(f"klaar: {added} toegevoegd, {skipped} al aanwezig")
    return 0


def _categorize(desc):
    try:
        sys.path.insert(0, '/app')
        from app.categorize import categorize
        return categorize(desc, desc)
    except Exception:
        return 'other'


def _name(desc):
    m = re.match(r'^(.{2,40}?)(?:\s+(?:Zakgeld|Geld|Tandenfee|Sims|Betaalautomaat)\b)', desc)
    return m.group(1) if m else desc


def _ruw(r, amt):
    """De afschriftregel zoals hij in de PDF staat, zodat niets verloren gaat."""
    return json.dumps({
        'td': f"{r['d']:02d}-{r['m']:02d}",
        'type': r['type'],
        'verwerkingsdatum': r['verwerk'],
        'tegenrekening': r['iban'],
        'naam_omschrijving': r['desc'],
        'bedrag': r['amount'],
        'richting': 'debet' if amt < 0 else 'credit',
    }, ensure_ascii=False, sort_keys=True)


if __name__ == '__main__':
    sys.exit(main())
