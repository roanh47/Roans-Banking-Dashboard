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
in de accounts-tabel (en anders in external_accounts, de voorspelde rekeningen).
Alleen periodes die de bank niet levert (ouder dan history_from) worden
toegevoegd; regels die al in de database staan worden overgeslagen.

Twee afschrift-layouts worden herkend (automatisch):
  * betaalrekening: TD / Verwerkingsdatum / Type / Tegenrekening / Naam / Bedrag,
    alle bedragen in één kolom. De richting (debet of credit) volgt hier uit het
    transactietype en wordt gekalibreerd op Totaal afgeschreven / bijgeschreven.
  * spaarrekening: Rente datum / Type / Tegenrekening / Naam / Bedrag af (debet) /
    Bedrag bij (credit). Daar is het type altijd 'db' en bepaalt de kolom waarin
    het bedrag staat de richting; de controle gebeurt met beginsaldo + bij - af = eindsaldo.
"""
import argparse, hashlib, itertools, json, os, re, sqlite3, sys, unicodedata
from collections import Counter, defaultdict
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
    s = re.sub(r'\s+Blad\b.*$', '', ' '.join(toks))
    s = re.sub(r'\s+(?:vervolg\s+)?Rekeningafschrift\b.*$', '', s)
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


def _layout(text):
    """Spaarrekening-afschriften zetten debet en credit in twee aparte kolommen."""
    return 'spaar' if 'Bedrag bij (credit)' in text else 'betaal'


SPAAR_ROW = re.compile(r'^(\d{2})-(\d{2})\s+([a-z]{2})\s+(.*)$')
SPAAR_NUM = re.compile(r'^\d{1,3}(?:\.\d{3})*,\d{2}$')
SPAAR_STOP = re.compile(r'^(Blad\b.*|(?:vervolg\s+)?Rekeningafschrift\b.*|Totaal |IBAN / Rekeningnummer|ac =|ba =|bc =|bg =|cb =|cc =|'
                        r'cp =|db =|eb =|ec =|ei =|ga =|gb =|id =|kh =|ok =|pc =|sb =|sp =|st =|tb =|'
                        r'te =|wb =|we =|wr =|bv =)')
SPAAR_HEAD = ('Rente', 'Type Tegenrekening', 'Naam/omschrijving', 'vervolg Rekeningafschrift')
# Regels in de voettekst van een afschrift die niets met een boeking te maken hebben.
# Algemene gevallen staan hieronder; je eigen naam en adres horen niet in een publieke
# repo en komen uit config/private-categorize.json ("statement_noise").
SPAAR_FOOT = re.compile(r'^(Ten name van|Rabo |IBAN|BIC|RABONL2U)$')
PRIVE_PAD = os.environ.get(
    "PRIVATE_CATEGORIZE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "config", "private-categorize.json"),
)


def _eigen_ruis():
    """Extra voettekst-regels van jouw afschrift (naam, adres) uit de prive-config."""
    try:
        with open(PRIVE_PAD, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return set()
    return {str(w).strip().upper() for w in data.get("statement_noise", []) if str(w).strip()}


EIGEN_RUIS = _eigen_ruis()


def parse_savings(text):
    """Boekingen uit een spaarrekening-afschrift.

    Hier is het type van elke regel 'db', dus de tekenkalibratie op type werkt niet:
    de richting lees je uit de kolom waarin het bedrag staat (Bedrag af (debet) links
    van de kolom Bedrag bij (credit)). Alle bedragen en de saldi worden daarna met de
    kop van het afschrift gecontroleerd.
    """
    lines = [l.rstrip() for l in text.replace('\u00a0', ' ').split('\n')]
    stmts, cur, cut, pending = [], None, None, {}
    i = 0
    while i < len(lines):
        raw = lines[i]
        l = raw.strip()

        if 'Beginsaldo' in raw and 'Datum vanaf' in raw:
            m = re.match(r'(\d{2}-\d{2}-\d{4})\s+([\d.,]+)\s*(CR|D)?',
                         (lines[i + 1] if i + 1 < len(lines) else '').strip())
            if m:
                pending['van'] = m.group(1)
                pending['begin'] = eur(m.group(2)) * (-1 if m.group(3) == 'D' else 1)
        if 'Eindsaldo' in raw and 'Datum tot en met' in raw:
            m = re.match(r'(\d{2}-\d{2}-\d{4})\s+([\d.,]+)\s*(CR|D)?',
                         (lines[i + 1] if i + 1 < len(lines) else '').strip())
            if m:
                pending['tot'] = m.group(1)
                pending['eind'] = eur(m.group(2)) * (-1 if m.group(3) == 'D' else 1)

        if l.startswith('IBAN / Rekeningnummer'):
            val = lines[i + 1] if i + 1 < len(lines) else ''
            iban = re.sub(r'\s+', '', val.split('EUR')[0])
            nummers = re.findall(r'\d{1,3}(?:\.\d{3})*,\d{2}', val)
            if cur is None or cur['iban'] != iban:
                cur = {'iban': iban, 'rows': []}
                cur.update(pending)
                if len(nummers) >= 2:
                    cur['af'], cur['bij'] = eur(nummers[-2]), eur(nummers[-1])
                stmts.append(cur)
                pending = {}
            elif len(nummers) >= 2:
                cur['af'], cur['bij'] = eur(nummers[-2]), eur(nummers[-1])

        if 'Bedrag bij (credit)' in raw:
            cut = raw.index('Bedrag bij (credit)')

        m = SPAAR_ROW.match(l)
        if cur is not None and m:
            rest, bedrag = m.group(4), None
            nm = re.search(r'([\d.]+,\d{2})\s*$', raw)
            if nm and SPAAR_NUM.match(nm.group(1)):
                bedrag = nm.group(1)
                rest = re.sub(r'^\d{2}-\d{2}\s+[a-z]{2}\s*', '', raw[:nm.start()].rstrip())
            tegen, im = None, re.match(r'^(NL\d{2}\s*[A-Z]{4}(?:\s*\d{4})*\s*\d{2}|\d{10})', rest.strip())
            if im:
                tegen = re.sub(r'\s+', '', im.group(1))
                rest = rest.strip()[im.end():]
            desc, verwerk, j = [rest.strip()], None, i + 1
            while j < len(lines):
                b = lines[j].strip()
                if SPAAR_ROW.match(b) or SPAAR_STOP.match(b) or any(b.startswith(h) for h in SPAAR_HEAD) or b == '':
                    break
                vm = re.match(r'^Verwerkingsdatum:\s*(\d{2})-(\d{2})-(\d{4})$', b)
                if vm:
                    verwerk = f'{vm.group(3)}-{vm.group(2)}-{vm.group(1)}'
                elif SPAAR_NUM.match(b):
                    if bedrag is None:
                        bedrag = b
                elif not SPAAR_FOOT.match(b) and b.upper() not in EIGEN_RUIS and not b.startswith('Verwerkingsdatum'):
                    desc.append(b)
                j += 1
            if bedrag:
                amt = eur(bedrag)
                eind_kolom = raw.rfind(bedrag) + len(bedrag)
                cur['rows'].append({
                    'd': int(m.group(1)), 'm': int(m.group(2)), 'type': m.group(3),
                    'tegen': tegen, 'iban': tegen,
                    'desc': _plak(WISSEL.join(x for x in desc if x)),
                    'amount': amt, 'bedrag': amt, 'verwerk': verwerk,
                    'richting': 'debet' if (cut is not None and eind_kolom < cut) else 'credit',
                })
            i = j
            continue
        i += 1
    return [s for s in stmts if s['rows']]


WISSEL = '\x00'
NIET_PLAKKEN = {'te', 'de', 'en', 'in', 'op', 'om', 'is', 'je', 'ze', 'we', 'er', 'of', 'zo', 'ik', 'me', 'ge',
                'eo', 'ad', 'af', 'uw', 'ex', 'bv', 'ie', 'ii'}


def _plak(desc):
    """Afschriftregels zijn hard afgebroken: plak afgebroken woorden weer aan elkaar.

    Alleen een kort fragment (1-2 letters) direct achter een woord wordt geplakt; losse
    woorden als 'eo' in 'A. Voorbeeld eo' blijven staan. De WISSEL-markering zet de parser
    tussen de regels, zodat een echte spatie nooit per ongeluk verdwijnt.
    """
    def _een(m):
        heel, frag = m.group(1), m.group(2)
        return frag if frag in NIET_PLAKKEN else heel + frag
    s = re.sub(r'([a-z]{2,})' + WISSEL + r'([a-z]{1,2})(?=' + WISSEL + r'|\s|$)', _een, desc)
    s = re.sub(r'([a-z]{1,2})' + WISSEL + r'([a-z]{1,2})(?=[\s:.,]|$)',
               lambda m: m.group(0) if (m.group(1) in NIET_PLAKKEN or m.group(2) in NIET_PLAKKEN)
               else m.group(1) + m.group(2), s)
    s = s.replace(WISSEL, ' ')
    s = re.sub(r'\s+([:,.])', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip(' ,.-')


def resolve_savings_years(stmt):
    """Jaartal per regel: uit de verwerkingsdatum, anders doorlopend vanaf 'Datum vanaf'."""
    if not stmt.get('van'):
        raise SystemExit(f"geen 'Datum vanaf' in het afschrift van {stmt['iban']}")
    jaar, vorige = int(stmt['van'][-4:]), None
    for r in stmt['rows']:
        if r['verwerk']:
            jaar = int(r['verwerk'][:4])
        elif vorige == 12 and r['m'] == 1:
            jaar += 1
        r['jaar'] = jaar
        r['date'] = r['verwerk'] or f"{jaar:04d}-{r['m']:02d}-{r['d']:02d}"
        vorige = r['m']
    loop = stmt.get('begin') or 0.0
    for r in stmt['rows']:
        loop += r['amount'] if r['richting'] == 'credit' else -r['amount']
        r['saldo'] = round(loop, 2)
    return stmt


def vind_rekening(con, iban):
    """Zoek de rekening op zijn IBAN: eerst een echte bankrekening, dan een voorspelde."""
    for r in con.execute('SELECT * FROM accounts'):
        if (r['iban'] or '').replace(' ', '') == iban:
            return {'id': r['id'], 'key': None, 'external': False, 'row': r}
    for r in con.execute('SELECT * FROM external_accounts'):
        for veld in (r['iban'], r['account_number']):
            if (veld or '').replace(' ', '') == iban:
                return {'id': r['key'], 'key': r['key'], 'external': True, 'row': r}
    return None


def _iso(datum):
    return f"{datum[6:10]}-{datum[3:5]}-{datum[0:2]}" if datum else None


def import_savings(con, text, account_iban, dry_run=False):
    """Schrijf de regels van een spaarrekening-afschrift weg als boekingen."""
    stmts = [resolve_savings_years(s) for s in parse_savings(text)]
    if not stmts:
        print('geen boekingen gevonden (spaar-layout)')
        return 1
    added = skipped = 0
    for s in stmts:
        iban = (account_iban or s['iban']).replace(' ', '')
        acc = vind_rekening(con, iban)
        if acc is None:
            print(f"  ! rekening {iban} staat niet in accounts of external_accounts -- overgeslagen")
            continue
        debet = round(sum(r['amount'] for r in s['rows'] if r['richting'] == 'debet'), 2)
        credit = round(sum(r['amount'] for r in s['rows'] if r['richting'] == 'credit'), 2)
        print(f"  {iban} -> {acc['id']}: {len(s['rows'])} regels, {s.get('van')} t/m {s.get('tot')}"
              f", debet {debet:.2f} / credit {credit:.2f}")
        if s.get('begin') is not None and s.get('eind') is not None:
            if abs(round(s['begin'] + credit - debet, 2) - s['eind']) > 0.01:
                print(f"    ! saldo klopt niet: {s['begin']:.2f} + {credit:.2f} - {debet:.2f} "
                      f"!= {s['eind']:.2f} -- overgeslagen")
                continue
            print(f"    controle: {s['begin']:.2f} + {credit:.2f} - {debet:.2f} = {s['eind']:.2f} klopt")
        # Vangnet tegen dubbel importeren: tel hoeveel keer een (datum, bedrag, omschrijving)
        # al in de database staat. Twee keer 50,00 met dezelfde tekst mag dus wel, zolang het
        # afschrift ze ook twee keer heeft.
        hebben = Counter((r[0], round(r[1], 2), r[2] or '') for r in con.execute(
            'SELECT booking_date, amount, description FROM transactions WHERE account_id=?', (acc['id'],)))
        per_sleutel = defaultdict(int)
        for r in s['rows']:
            amt = round(-r['amount'] if r['richting'] == 'debet' else r['amount'], 2)
            desc = tidy(r['desc']) or r['tegen'] or 'onbekend'
            # Id is op inhoud gebaseerd (datum, bedrag, tegenrekening + volgnummer voor
            # gelijke regels), niet op de omschrijving: een latere import van hetzelfde
            # afschrift overschrijft dus dezelfde rij in plaats van hem te dupliceren.
            sleutel = (r['date'], amt, r['tegen'] or '')
            per_sleutel[sleutel] += 1
            rid = 'pdf-%s-%s-%s-%s%.2f-%02d' % (iban[-4:], r['date'], (r['tegen'] or 'x')[-4:],
                                                'm' if amt < 0 else 'p', abs(amt), per_sleutel[sleutel])
            if hebben[(r['date'], amt, desc)] > 0 or con.execute(
                    'SELECT 1 FROM transactions WHERE id=?', (rid,)).fetchone():
                hebben[(r['date'], amt, desc)] -= 1
                skipped += 1
                continue
            con.execute("""INSERT OR REPLACE INTO transactions
                (id, account_id, amount, currency, description, booking_date, category,
                 merchant_name, running_balance, inserted_at, counterparty_iban,
                 value_date, type_sub_code, raw_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (rid, acc['id'], amt, 'EUR', desc, r['date'], _categorize(desc), _name(desc),
                 r.get('saldo'), datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                 (r['tegen'] or '') if (r['tegen'] or '') != '0000000000' else '',
                 r['date'], r['type'], _ruw(r, amt)))
            added += 1
            print(f"    + {rid} {r['date']} {amt:>9.2f}  saldo {r.get('saldo')}  {desc}")
        if acc['external'] and s.get('eind') is not None:
            con.execute("""UPDATE external_accounts SET balance=?, balance_date=?, source=?, updated_at=?
                           WHERE key=?""",
                        (round(s['eind'], 2), _iso(s['tot']), 'statement (Rabobank PDF)',
                         datetime.now().strftime('%Y-%m-%d %H:%M:%S'), acc['key']))
            print(f"    ijkpunt {acc['key']}: {acc['row']['balance']} -> {s['eind']:.2f} per {_iso(s['tot'])}")
        elif not acc['external'] and s.get('van'):
            lo_iso = _iso(s['van'])
            if lo_iso and lo_iso < (acc['row']['history_from'] or '9999'):
                con.execute('UPDATE accounts SET history_from=? WHERE id=?', (lo_iso, acc['id']))
                print(f"    history_from -> {lo_iso}")
    if dry_run:
        con.rollback()
        print(f"DRY-RUN (spaar): {added} toe te voegen, {skipped} al aanwezig (niets weggeschreven)")
    else:
        con.commit()
        print(f"klaar (spaar): {added} toegevoegd, {skipped} al aanwezig")
    return 0


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
    if _layout(text) == 'spaar':
        return import_savings(con, text, a.account_iban, a.dry_run)
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
