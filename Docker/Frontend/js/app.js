// Roan's Banking Dashboard - App Logic

const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `API error: ${res.status}`);
    }
    return res.json();
  },
  async put(path, body) {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
};

// AI Settings cache
let aiSettings = null;

async function loadAiSettings() {
  try {
    aiSettings = await API.get("/api/ai/settings");
  } catch {
    aiSettings = { location: "sidebar", endpoint: "", api_key: "", model: "" };
  }
  return aiSettings;
}

// Page Renderers
const Pages = {
  async home() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading your finances...</p></div>`;

    try {
      const [summary, accounts, banks, ext] = await Promise.all([
        API.get("/api/accounts/summary"),
        API.get("/api/accounts"),
        API.get("/api/accounts/banks").catch(() => ({ banks: [] })),
        API.get("/api/external/accounts").catch(() => ({ accounts: [], candidates: [] })),
      ]);

      const external = ext.accounts || [];
      const euro = (v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(v || 0);
      const datum = (s) => (s ? new Date(String(s).replace(" ", "T")).toLocaleDateString("en-GB") : "--");

      const total = summary.net_worth !== undefined && summary.net_worth !== null
        ? summary.net_worth
        : (summary.total_balance || 0);
      const count = (summary.account_count || 0) + (summary.external_account_count || 0);
      const formattedTotal = euro(total);

      let sessionWarning = "";
      (banks.banks || []).filter((b) => b.state && b.state !== "ok").forEach((b) => {
        const isExpired = b.state === "verlopen";
        const isDisconnected = b.state === "losgekoppeld";
        sessionWarning += `
          <div class="alert ${isExpired ? "alert-red" : "alert-orange"}">
            <div class="alert-body">
              <div class="alert-title">${isDisconnected ? "Bank disconnected" : isExpired ? "Bank session expired" : `Bank session expires soon (${b.days_left} days left)`} · ${b.bank_name}</div>
              <div class="alert-text">${isDisconnected ? "No new transactions will come in. The history is kept." : isExpired ? "New transactions are no longer coming in. The amounts below are the last retrieved state." : "Reconnect to keep syncing."}</div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="reconnectBank(${b.id}, '${b.bank_name}', '${b.bank_country || ""}')">Reconnect</button>
          </div>`;
      });

      let accountsHtml = "";
      (accounts.accounts || []).forEach((a) => {
        const bal = new Intl.NumberFormat("en-EU", {
          style: "currency",
          currency: a.currency || "EUR",
        }).format(a.balance);
        accountsHtml += `
          <div class="balance-card">
            <div class="balance-label">${a.name}</div>
            <div class="balance-amount">${bal}</div>
            <div class="balance-sub">${a.iban ? a.iban.slice(0, 18) + "..." : a.account_type || ""}</div>
          </div>`;
      });

      (external || []).forEach((a) => {
        accountsHtml += `
          <div class="balance-card">
            <div class="balance-label">${a.name} <span class="badge badge-warn">predicted</span></div>
            <div class="balance-amount">${euro(a.balance)}</div>
            <div class="balance-sub">baseline ${euro(a.baseline)} on ${a.baseline_date || "--"}${a.delta ? ` · ${a.delta >= 0 ? "+" : ""}${euro(a.delta)} in transfers` : ""}</div>
          </div>`;
      });

      if (!accountsHtml) {
        accountsHtml = `
          <div class="balance-card" style="grid-column:1/-1;text-align:center;padding:40px;">
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v4M10 13h4"/></svg>
              <p>No accounts connected yet.</p>
              <p style="margin-top:4px;font-size:13px;">Connect one on the Banks page to get started.</p>
            </div>
          </div>`;
      }

      page.innerHTML = `
        ${sessionWarning}
        <div class="balance-grid">
          <div class="balance-card">
            <div class="balance-label">Net Worth</div>
            <div class="balance-amount">${formattedTotal}</div>
            <div class="balance-sub">${count} accounts${summary.external_balance ? ` · ${euro(summary.external_balance)} predicted` : ""}</div>
          </div>
          <div class="balance-card">
            <div class="balance-label">Spending this month</div>
            <div class="balance-amount balance-negative" id="monthSpending">--</div>
            <div class="balance-sub">vs last month</div>
          </div>
          <div class="balance-card">
            <div class="balance-label">Income this month</div>
            <div class="balance-amount balance-positive" id="monthIncome">--</div>
            <div class="balance-sub">Net: <span id="monthNet">--</span></div>
          </div>
        </div>
        <div class="balance-grid">${accountsHtml}</div>
        <div class="charts-grid">
          <div class="chart-card full">
            <div class="card-header">
              <span class="card-title">Monthly Overview</span>
            </div>
            <canvas id="monthlyChart"></canvas>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Spending by Category</span>
            </div>
            <canvas id="categoryChart" style="max-height:260px;"></canvas>
          </div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Top Merchants</span>
            </div>
            <div id="topMerchantsList">
              <div class="loading" style="padding:20px;"><div class="spinner" style="width:24px;height:24px;"></div></div>
            </div>
          </div>
        </div>
      `;

      this._loadCharts();
      this._loadTopMerchants();
    } catch (e) {
      page.innerHTML = `
        <div class="error-banner">Could not load dashboard: ${e.message}</div>
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p>Make sure your Enable Banking keys are configured and you have connected a bank.</p>
        </div>`;
    }
  },

  async _loadCharts() {
    try {
      const [monthly, spending] = await Promise.all([
        API.get("/api/insights/monthly"),
        API.get("/api/insights/spending"),
      ]);

      const months = (monthly.months || []).reverse();
      if (months.length && document.getElementById("monthlyChart")) {
        new Chart(document.getElementById("monthlyChart"), {
          type: "bar",
          data: {
            labels: months.map((m) => {
              const [y, mo] = m.month.split("-");
              const d = new Date(y, mo - 1);
              return d.toLocaleString("default", { month: "short", year: "2-digit" });
            }),
            datasets: [
              {
                label: "Income",
                data: months.map((m) => m.income),
                backgroundColor: "rgba(0, 214, 143, 0.3)",
                borderColor: "#00d68f",
                borderWidth: 1,
                borderRadius: 4,
              },
              {
                label: "Spending",
                data: months.map((m) => m.spending),
                backgroundColor: "rgba(255, 107, 107, 0.3)",
                borderColor: "#ff6b6b",
                borderWidth: 1,
                borderRadius: 4,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: {
                position: "top",
                labels: { color: "#8888a0", font: { size: 12 } },
              },
            },
            scales: {
              x: {
                grid: { color: "rgba(42,42,58,0.5)" },
                ticks: { color: "#8888a0" },
              },
              y: {
                grid: { color: "rgba(42,42,58,0.5)" },
                ticks: { color: "#8888a0", callback: (v) => "€" + v.toLocaleString() },
              },
            },
          },
        });
      }

      if (spending.insights?.length && document.getElementById("categoryChart")) {
        const colors = {
          food: "#ff6b6b", transport: "#5b9aff", shopping: "#6c5ce7",
          housing: "#ff9f43", entertainment: "#ff7675", health: "#74b9ff",
          transfer: "#ffa726", income: "#00d68f", other: "#8888a0",
          dining: "#e17055", subscriptions: "#a29bfe", education: "#00c2a8",
        };
        new Chart(document.getElementById("categoryChart"), {
          type: "doughnut",
          data: {
            labels: spending.insights.map((s) => s.category.charAt(0).toUpperCase() + s.category.slice(1)),
            datasets: [{
              data: spending.insights.map((s) => s.total),
              backgroundColor: spending.insights.map((s) => colors[s.category] || "#8888a0"),
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
              legend: {
                position: "right",
                labels: { color: "#8888a0", font: { size: 12 }, padding: 12 },
              },
            },
            cutout: "65%",
          },
        });
      }

      if (months.length > 0) {
        const latest = months[months.length - 1];
        const elIncome = document.getElementById("monthIncome");
        const elSpend = document.getElementById("monthSpending");
        const elNet = document.getElementById("monthNet");
        if (elIncome) elIncome.textContent = "€" + latest.income.toLocaleString();
        if (elSpend) elSpend.textContent = "-€" + latest.spending.toLocaleString();
        if (elNet) {
          const net = latest.income - latest.spending;
          elNet.textContent = (net >= 0 ? "+" : "") + "€" + net.toLocaleString();
          elNet.className = net >= 0 ? "balance-positive" : "balance-negative";
        }
      }
    } catch (e) {
      console.error("Charts error:", e);
    }
  },

  async _loadTopMerchants() {
    try {
      const data = await API.get("/api/insights/top-merchants?days=30&limit=5");
      const list = document.getElementById("topMerchantsList");
      if (!list) return;
      if (!data.merchants?.length) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No merchant data yet.</p>';
        return;
      }
      list.innerHTML = data.merchants
        .map((m) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <span>${m.merchant}</span>
          <span style="font-weight:600;color:var(--red);">-€${m.total.toLocaleString()}</span>
        </div>`)
        .join("");
    } catch (e) {
      console.error("Merchants error:", e);
    }
  },

  // ── Insights ────────────────────────────────────────────────────────────
  // Alles hier wordt uit je eigen boekingen gerekend: één keer ophalen, daarna
  // alleen hergroeperen als je een andere periode kiest. Geen schattingen.
  async insights() {
    const page = document.getElementById("page-content");
    if (!window.__insightsTx || Date.now() - (window.__insightsTx.tijd || 0) > 60000) {
      page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Crunching your transactions...</p></div>`;
      try {
        const [data, overzicht] = await Promise.all([
          API.get("/api/transactions?limit=50000"),
          API.get("/api/accounts/overview"),
        ]);
        window.__insightsTx = {
          tx: data.transactions || [],
          accounts: overzicht.accounts || [],
          links: data.links || {},
          tijd: Date.now(),
        };
      } catch (e) {
        page.innerHTML = `<div class="error-banner">Could not load insights: ${escapeHtml(e.message)}</div>`;
        return;
      }
    }
    this._tekenInsights(this._insightPeriode || "12m");
  },

  _tekenInsights(periodeId) {
    this._insightPeriode = periodeId;
    const page = document.getElementById("page-content");
    const staat = window.__insightsTx || { tx: [], accounts: [], links: {} };
    const alles = staat.tx;

    const euro = (v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Math.abs(v || 0));
    const kort = (v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v || 0);
    const bedrag = (t) => Number(t.amount) || 0;
    const dag = (t) => String(t.booking_date || "").slice(0, 10);
    const maand = (t) => dag(t).slice(0, 7);
    const naam = (t) => String(t.merchant_name || t.description || "Unknown").trim();
    const isoLokaal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const pct = (v, decimalen = 1) => v.toLocaleString("nl-NL", { minimumFractionDigits: decimalen, maximumFractionDigits: decimalen }) + "%";
    const maandLabel = (m) => {
      const [j, mm] = m.split("-");
      return new Date(Number(j), Number(mm) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
    };

    const PERIODES = [
      { id: "30d", label: "30 days", dagen: 30 },
      { id: "90d", label: "90 days", dagen: 90 },
      { id: "12m", label: "12 months", dagen: 365 },
      { id: "all", label: "All time", dagen: null },
    ];
    const periode = PERIODES.find((p) => p.id === periodeId) || PERIODES[2];

    // De laatste boeking in de data is "vandaag": de bank is de baas, niet de klok.
    const datums = alles.map(dag).filter(Boolean).sort();
    const laatste = datums.length ? datums[datums.length - 1] : new Date().toISOString().slice(0, 10);
    const eind = new Date(laatste + "T00:00:00");
    const begin = periode.dagen ? new Date(eind.getTime() - periode.dagen * 86400000) : null;
    const vorigeEind = begin ? new Date(begin.getTime() - 86400000) : null;
    const vorigeBegin = periode.dagen ? new Date(begin.getTime() - periode.dagen * 86400000) : null;
    const op = (t) => new Date(dag(t) + "T00:00:00");
    const inPeriode = (t) => !begin || op(t) >= begin;
    const inVorige = (t) => !!vorigeBegin && op(t) >= vorigeBegin && op(t) <= vorigeEind;

    const tx = alles.filter(inPeriode);
    const vorige = alles.filter(inVorige);
    const somIn = (rijen) => rijen.reduce((a, t) => a + Math.max(bedrag(t), 0), 0);
    const somUit = (rijen) => rijen.reduce((a, t) => a + Math.max(-bedrag(t), 0), 0);
    const netto = (rijen) => rijen.reduce((a, t) => a + bedrag(t), 0);

    const inNu = somIn(tx), uitNu = somUit(tx), netNu = netto(tx);
    const inVorig = somIn(vorige), uitVorig = somUit(vorige), netVorig = netto(vorige);
    const maanden = [...new Set(tx.map(maand).filter(Boolean))].sort();
    const perMaand = maanden.map((m) => {
      const rij = tx.filter((t) => maand(t) === m);
      return { maand: m, in: somIn(rij), uit: somUit(rij), net: netto(rij), aantal: rij.length };
    });
    const gemPerMaand = perMaand.length ? uitNu / perMaand.length : 0;
    const dagen = Math.max(1, Math.round((eind - (begin || new Date((datums[0] || laatste) + "T00:00:00"))) / 86400000) + 1);

    // Categorieën (alleen geld dat eruit ging; inkomsten horen niet in een uitgaven-grafiek)
    const perCat = {};
    tx.filter((t) => bedrag(t) < 0).forEach((t) => {
      const c = t.category || "other";
      const r = (perCat[c] = perCat[c] || { cat: c, uit: 0, aantal: 0, grootste: null });
      r.uit += -bedrag(t);
      r.aantal += 1;
      if (!r.grootste || -bedrag(t) > -bedrag(r.grootste)) r.grootste = t;
    });
    const catRijen = Object.values(perCat).sort((a, b) => b.uit - a.uit);

    // Tegenpartijen
    const perHandelaar = {};
    tx.forEach((t) => {
      const n = naam(t);
      const r = (perHandelaar[n] = perHandelaar[n] || { naam: n, uit: 0, in: 0, aantal: 0, maanden: new Set(), bedragen: [] });
      if (bedrag(t) < 0) { r.uit += -bedrag(t); r.bedragen.push(-bedrag(t)); } else { r.in += bedrag(t); }
      r.aantal += 1;
      r.maanden.add(maand(t));
    });
    const handelaren = Object.values(perHandelaar).sort((a, b) => b.uit + b.in - (a.uit + a.in));
    const topHandelaren = handelaren.filter((h) => h.uit > 0).slice(0, 10);

    // Terugkerende bedragen: zelfde tegenpartij, in meerdere maanden, steeds ongeveer gelijk.
    const minMaanden = Math.max(3, Math.ceil(maanden.length / 2));
    const terugkerend = handelaren
      .filter((h) => h.bedragen.length >= 3 && h.maanden.size >= minMaanden)
      .map((h) => {
        const gem = h.bedragen.reduce((a, b) => a + b, 0) / h.bedragen.length;
        const afwijking = Math.max(...h.bedragen.map((b) => Math.abs(b - gem))) / (gem || 1);
        return { naam: h.naam, gem, afwijking, maanden: h.maanden.size, aantal: h.aantal, totaal: h.uit };
      })
      .filter((h) => h.afwijking <= 0.25 && h.gem >= 1)
      .sort((a, b) => b.gem - a.gem);
    const vastPerMaand = terugkerend.reduce((a, h) => a + h.gem, 0);

    // Grootste losse boekingen
    const grootste = [...tx].sort((a, b) => Math.abs(bedrag(b)) - Math.abs(bedrag(a))).slice(0, 8);

    // Feiten
    const feiten = [];
    const grootsteUit = tx.filter((t) => bedrag(t) < 0).sort((a, b) => bedrag(a) - bedrag(b))[0];
    const grootsteIn = tx.filter((t) => bedrag(t) > 0).sort((a, b) => bedrag(b) - bedrag(a))[0];
    const duursteMaand = [...perMaand].sort((a, b) => b.uit - a.uit)[0];
    const vaakst = [...handelaren].sort((a, b) => b.aantal - a.aantal)[0];
    if (grootsteUit) feiten.push({ label: "Biggest single expense", waarde: euro(-bedrag(grootsteUit)), sub: `${naam(grootsteUit)} · ${dag(grootsteUit)}` });
    if (grootsteIn) feiten.push({ label: "Biggest single income", waarde: euro(bedrag(grootsteIn)), sub: `${naam(grootsteIn)} · ${dag(grootsteIn)}` });
    if (catRijen.length) feiten.push({ label: "Biggest category", waarde: catRijen[0].cat, sub: `${euro(catRijen[0].uit)} · ${pct((catRijen[0].uit / (uitNu || 1)) * 100, 0)} of all spending` });
    if (duursteMaand) feiten.push({ label: "Most expensive month", waarde: maandLabel(duursteMaand.maand), sub: `${euro(duursteMaand.uit)} out · ${euro(duursteMaand.in)} in` });
    feiten.push({ label: "Average per day", waarde: euro(uitNu / dagen), sub: `over ${dagen} days` });
    if (vaakst) feiten.push({ label: "Most frequent", waarde: vaakst.naam, sub: `${vaakst.aantal}× · ${euro(vaakst.uit + vaakst.in)} total` });

    // Vorige periode: alleen tonen als die er echt is.
    const delta = (nu, vorig, stijgingIsGoed) => {
      if (!vorige.length) return "no earlier period in the data";
      if (!vorig) return nu ? "nothing in the period before" : "—";
      const d = ((nu - vorig) / Math.abs(vorig)) * 100;
      const goed = (d >= 0) === !!stijgingIsGoed;
      return `<span class="kpi-delta ${goed ? "pos" : "neg"}">${d >= 0 ? "+" : ""}${d.toFixed(0)}%</span> vs the previous ${periode.label.toLowerCase()}`;
    };

    // Oude grafieken opruimen voordat we opnieuw tekenen.
    (this._insightCharts || []).forEach((c) => { try { c.destroy(); } catch (e) {} });
    this._insightCharts = [];

    if (!tx.length) {
      page.innerHTML = `<div class="page-subheader page-subheader-row">
          <p>No transactions in this period.</p>
        </div>`;
      return;
    }

    const periodeKnoppen = PERIODES.map((p) =>
      `<button class="btn btn-sm ${p.id === periode.id ? "btn-primary" : "btn-outline"}" onclick="Pages._tekenInsights('${p.id}')">${p.label}</button>`
    ).join("");

    const catKleuren = { food: "#ff6b6b", transport: "#5b9aff", shopping: "#6c5ce7", housing: "#ff9f43", entertainment: "#ff7675", health: "#74b9ff", transfer: "#ffa726", income: "#00d68f", other: "#8888a0", dining: "#e17055", subscriptions: "#a29bfe" };
    const palet = ["#ff6b6b", "#5b9aff", "#6c5ce7", "#ff9f43", "#ff7675", "#74b9ff", "#ffa726", "#00d68f", "#a29bfe", "#e17055", "#26c6da", "#d4a5ff", "#f6c85f", "#9ccc65"];
    const kleur = (c, i) => catKleuren[c] || palet[i % palet.length];

    const maxUit = catRijen.length ? catRijen[0].uit : 1;
    const catTabel = catRijen.map((c, i) => `
      <tr>
        <td><span class="category-badge ${escapeHtml(c.cat)}">${escapeHtml(c.cat)}</span></td>
        <td class="num">${euro(c.uit)}</td>
        <td class="num">${pct((c.uit / (uitNu || 1)) * 100)}</td>
        <td class="num">${c.aantal}</td>
        <td class="num">${euro(c.uit / c.aantal)}</td>
      </tr>`).join("");

    const maxHandelaar = topHandelaren.length ? topHandelaren[0].uit : 1;
    const handelaarLijst = topHandelaren.map((h) => `
      <div class="bar-row">
        <div class="bar-name" title="${escapeHtml(h.naam)}">${escapeHtml(h.naam)}</div>
        <div class="bar-val">${euro(h.uit)} <span class="bar-count">${h.aantal}×</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${((h.uit / maxHandelaar) * 100).toFixed(1)}%"></div></div>
      </div>`).join("");

    const grootsteLijst = grootste.map((t) => `
      <tr class="tx-click-row" onclick="openTxDetail('${escapeHtml(String(t.id))}')" title="Click for everything about this transaction">
        <td>${escapeHtml(dag(t))}</td>
        <td class="bar-name">${escapeHtml(naam(t))}</td>
        <td class="num ${bedrag(t) > 0 ? "amount-in" : "amount-out"}">${bedrag(t) > 0 ? "+" : "-"}${euro(bedrag(t))}</td>
      </tr>`).join("");

    const terugkerendLijst = terugkerend.length
      ? terugkerend.map((h) => `
        <tr>
          <td class="bar-name">${escapeHtml(h.naam)}</td>
          <td class="num">${euro(h.gem)}</td>
          <td class="num">${h.maanden}/${maanden.length} mo</td>
          <td class="num">${h.aantal}×</td>
        </tr>`).join("")
      : `<tr><td colspan="4" style="color:var(--text-muted);">Nothing that repeats with a steady amount in this period.</td></tr>`;

    page.innerHTML = `
      <div class="page-subheader page-subheader-row">
        <p>${tx.length} transactions in this period · the newest booking in the data is ${laatste}${periode.dagen ? ` · ${isoLokaal(begin)} → ${laatste}` : ""}</p>
        <div class="period-switch">${periodeKnoppen}</div>
      </div>

      <div class="kpi-grid">
        <div class="balance-card">
          <div class="balance-label">Money in</div>
          <div class="balance-amount balance-positive">${euro(inNu)}</div>
          <div class="balance-sub">${delta(inNu, inVorig, true)}</div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Money out</div>
          <div class="balance-amount balance-negative">${euro(uitNu)}</div>
          <div class="balance-sub">${delta(uitNu, uitVorig, false)}</div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Net</div>
          <div class="balance-amount ${netNu >= 0 ? "balance-positive" : "balance-negative"}">${netNu >= 0 ? "+" : "-"}${euro(netNu)}</div>
          <div class="balance-sub">${delta(netNu, netVorig, true)}</div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Average per month</div>
          <div class="balance-amount">${euro(gemPerMaand)}</div>
          <div class="balance-sub">out, over ${perMaand.length} month${perMaand.length === 1 ? "" : "s"}</div>
        </div>
        <div class="balance-card">
          <div class="balance-label">Transactions</div>
          <div class="balance-amount">${tx.length}</div>
          <div class="balance-sub">${tx.filter((t) => bedrag(t) > 0).length} in · ${tx.filter((t) => bedrag(t) < 0).length} out</div>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-card full">
          <div class="card-header">
            <span class="card-title">Per month</span>
            <span class="card-note">bars in / out · line = net</span>
          </div>
          <canvas id="insightMonthly"></canvas>
        </div>
      </div>

      <div class="insights-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Where the money goes</span>
            <span class="card-note">${catRijen.length} categories · ${euro(uitNu)} out</span>
          </div>
          <canvas id="insightCats" style="max-height:230px;"></canvas>
          <table class="mini-table">
            <thead><tr><th>Category</th><th class="num">Out</th><th class="num">Share</th><th class="num">#</th><th class="num">Avg</th></tr></thead>
            <tbody>${catTabel}</tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">Top merchants</span>
            <span class="card-note">where it went, most expensive first</span>
          </div>
          <div class="bar-list">${handelaarLijst || '<div class="empty-state"><p>No outgoing payments in this period.</p></div>'}</div>
        </div>
      </div>

      <div class="insights-grid">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Largest transactions</span>
            <span class="card-note">click one for the full detail</span>
          </div>
          <table class="mini-table">
            <thead><tr><th>Date</th><th>Counterparty</th><th class="num">Amount</th></tr></thead>
            <tbody>${grootsteLijst}</tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">Likely recurring</span>
            <span class="card-note">${euro(vastPerMaand)}/month across ${terugkerend.length}</span>
          </div>
          <table class="mini-table">
            <thead><tr><th>Counterparty</th><th class="num">Per month</th><th class="num">Months</th><th class="num">Times</th></tr></thead>
            <tbody>${terugkerendLijst}</tbody>
          </table>
          <div class="card-foot">Same counterparty, in at least ${minMaanden} of the ${maanden.length} months, with amounts within 25% of each other.</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-title">Notable</span></div>
        <div class="fact-grid">
          ${feiten.map((f) => `
            <div class="fact">
              <div class="fact-label">${escapeHtml(f.label)}</div>
              <div class="fact-value">${escapeHtml(f.waarde)}</div>
              <div class="fact-sub">${escapeHtml(f.sub)}</div>
            </div>`).join("")}
        </div>
      </div>`;

    // Klikken op een grote boeking opent hetzelfde detailpaneel als op Transactions.
    window.__txDetail = {
      rows: Object.fromEntries(tx.map((t) => [String(t.id), t])),
      links: staat.links || {},
      account: null,
      accountsById: Object.fromEntries((staat.accounts || []).flatMap((r) => [[String(r.key), r], [String(r.id || ""), r]])),
    };

    const chartOpts = {
      responsive: true,
      plugins: {
        legend: { labels: { color: "#8888a0", font: { size: 12 } } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${euro(c.parsed.y !== undefined ? c.parsed.y : c.parsed)}` } },
      },
      scales: {
        x: { grid: { color: "rgba(42,42,58,0.5)" }, ticks: { color: "#8888a0" } },
        y: { grid: { color: "rgba(42,42,58,0.5)" }, ticks: { color: "#8888a0", callback: (v) => kort(v) } },
      },
    };

    const elMaand = document.getElementById("insightMonthly");
    if (elMaand) {
      this._insightCharts.push(new Chart(elMaand, {
        type: "bar",
        data: {
          labels: perMaand.map((m) => maandLabel(m.maand)),
          datasets: [
            { label: "In", data: perMaand.map((m) => m.in), backgroundColor: "rgba(0,214,143,0.35)", borderColor: "#00d68f", borderWidth: 1, borderRadius: 4 },
            { label: "Out", data: perMaand.map((m) => m.uit), backgroundColor: "rgba(255,107,107,0.35)", borderColor: "#ff6b6b", borderWidth: 1, borderRadius: 4 },
            { label: "Net", type: "line", data: perMaand.map((m) => m.net), borderColor: "#6c5ce7", backgroundColor: "#6c5ce7", borderWidth: 2, tension: 0.3, pointRadius: 3 },
          ],
        },
        options: chartOpts,
      }));
    }

    const elCat = document.getElementById("insightCats");
    if (elCat) {
      this._insightCharts.push(new Chart(elCat, {
        type: "doughnut",
        data: {
          labels: catRijen.map((c) => c.cat),
          datasets: [{ data: catRijen.map((c) => c.uit), backgroundColor: catRijen.map((c, i) => kleur(c.cat, i)), borderWidth: 0 }],
        },
        options: {
          responsive: true,
          cutout: "58%",
          plugins: {
            legend: { position: "right", labels: { color: "#8888a0", font: { size: 12 }, boxWidth: 12 } },
            tooltip: { callbacks: { label: (c) => ` ${c.label}: ${euro(c.parsed)} (${pct((c.parsed / (uitNu || 1)) * 100)})` } },
          },
        },
      }));
    }
  },

  async accounts() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading accounts...</p></div>`;

    try {
      const data = await API.get("/api/accounts/overview");
      const accounts = data.accounts || [];

      if (!accounts.length) {
        page.innerHTML = `<div class="empty-state"><p>No accounts yet.</p>
          <p style="font-size:13px;">Connect a bank via <a href="#connect" style="color:var(--accent);">Connect bank</a>.</p></div>`;
        return;
      }

      const euro = (b) =>
        new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(b || 0);

      const card = (r) => {
        const kindLabel = r.kind === "savings" ? "Savings account" : r.kind === "broker" ? "Brokerage account" : "Current account";
        const subtitle = r.predicted
          ? `baseline ${r.baseline_date} · ${r.tx_count} transfer${r.tx_count === 1 ? "" : "s"}`
          : `${r.tx_count} transactions${r.first_tx ? " · from " + r.first_tx : ""}`;
        return `
          <div class="account-card" onclick="location.hash='#transactions?acc=${encodeURIComponent(r.key)}'">
            <div class="account-head">
              <span class="account-name">${escapeHtml(r.name || "Account")}</span>
              <span class="account-label ${r.predicted ? "predicted" : ""}">${r.predicted ? "predicted" : "bank"}</span>
            </div>
            <div class="account-kind">${kindLabel}</div>
            <div class="account-number">${escapeHtml(r.display_number || "")}</div>
            <div class="account-balance">${euro(r.balance)}</div>
            <div class="account-sub">${escapeHtml(subtitle)}</div>
          </div>`;
      };

      page.innerHTML = `
        <div class="account-total"><span>Total</span><strong>${euro(data.total)}</strong></div>
        <p class="hint">Click an account for its transactions. Accounts marked "predicted" have no statement of their own: they are derived from the transfers on your current account.</p>
        <div class="account-grid">${accounts.map(card).join("")}</div>`;
    } catch (e) {
      page.innerHTML = `<div class="error-banner">Could not load accounts: ${escapeHtml(e.message)}</div>`;
    }
  },

  async transactions() {
    const page = document.getElementById("page-content");
    const acc = paginaParams().acc || "";
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading transactions...</p></div>`;

    try {
      const vraag = acc
        ? API.get(`/api/transactions?limit=50000&account_key=${encodeURIComponent(acc)}`)
        : API.get("/api/transactions?limit=50000");

      const [overzicht, data] = await Promise.all([API.get("/api/accounts/overview"), vraag]);
      const accounts = overzicht.accounts || [];
      const active = accounts.find((r) => String(r.key) === String(acc));
      const tx = data.transactions || [];
      const links = data.links || {};

      // Doorklikken: een overboeking naar de spaar of IBKR brengt je naar die
      // account, en andersom weer terug naar de boeking op je betaalrekening.
      const doorlink = (t) => {
        const naar = links[String(t.id)];
        if (naar) return { url: `#transactions?acc=${encodeURIComponent(naar.key)}`, text: `→ ${naar.name}` };
        if (t.predicted && t.source_tx_id)
          return { url: `#transactions?acc=${t.source_account_id}&tx=${encodeURIComponent(t.source_tx_id)}`, text: "→ your current account" };
        return null;
      };

      // Alles van deze rij bewaren, zodat er op een boeking geklikt kan worden.
      window.__txDetail = {
        rows: Object.fromEntries(tx.map((t) => [String(t.id), t])),
        links,
        account: active || null,
        // Zodat een rij ook de rekeningnaam kan tonen als je "All" bekijkt.
        accountsById: Object.fromEntries(
          accounts.flatMap((r) => [[String(r.key), r], [String(r.id || ""), r]])
        ),
      };

      const euro = (b) =>
        new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Math.abs(b || 0));

      const chips = [`<a class="chip ${!acc ? "active" : ""}" href="#transactions">All</a>`]
        .concat(
          accounts.map(
            (r) => `<a class="chip ${String(r.key) === String(acc) ? "active" : ""}" href="#transactions?acc=${encodeURIComponent(r.key)}">${escapeHtml(r.name)}</a>`
          )
        )
        .join("");

      const bereik = tx.length
        ? `${data.count ?? tx.length} transactions · ${String(tx[tx.length - 1].booking_date).slice(0, 10)} → ${String(tx[0].booking_date).slice(0, 10)}`
        : "0 transactions";

      const kop = active
        ? `<div class="account-header">
             <div>
               <div class="account-name">${escapeHtml(active.name)}</div>
               <div class="account-number">${escapeHtml(active.display_number || "")}</div>
             </div>
             <div class="account-balance">${euro(active.balance)}</div>
           </div>
           <div class="account-meta">
             <span>${bereik}</span>
             <span class="amount-in">+${euro(data.total_in)}</span>
             <span class="amount-out">-${euro(data.total_out)}</span>
             ${active.predicted ? '<span class="account-label predicted">predicted from transfers</span>' : ""}
             ${(active.recurring || []).map((r) => `<span class="account-label">recurring ${r.amount >= 0 ? "+" : ""}${euro(r.amount)} every ~${r.every_days} days · next expected ${r.next_expected}</span>`).join("")}
             ${active.projection_12m != null ? `<span class="account-label">at this rate in 12 months: ${euro(active.projection_12m)}</span>` : ""}
           </div>`
        : `<div class="account-meta"><span>${bereik}</span></div>`;

      page.innerHTML = `
        <div class="chip-row">${chips}</div>
        ${kop}
        <div class="tx-tools">
          <input type="text" id="txSearch" placeholder="Search...">
          <select id="txCategory">
            <option value="">All categories</option>
            ${[...new Set(tx.map((t) => t.category || "overig"))]
              .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
              .join("")}
          </select>
          <select id="txSoort">
            <option value="">All</option>
            <option value="in">In only</option>
            <option value="uit">Out only</option>
          </select>
        </div>
        <div id="txLijst"></div>`;

      const teken = (rijen) => {
        if (!rijen.length) return '<div class="empty-state"><p>No transactions.</p></div>';
        const perMonth = {};
        rijen.forEach((t) => {
          const month = (t.booking_date || "").slice(0, 7) || "unknown";
          (perMonth[month] = perMonth[month] || []).push(t);
        });
        return Object.keys(perMonth)
          .sort()
          .reverse()
          .map((month) => {
            const rows = perMonth[month];
            const bin = rows.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
            const bout = rows.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
            const naam = month === "unknown"
              ? "Unknown"
              : new Date(month + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
            return `
              <div class="month-block">
                <div class="month-head">
                  <span>${naam}</span>
                  <span class="month-sums"><span class="amount-in">+${euro(bin)}</span><span class="amount-out">-${euro(bout)}</span></span>
                </div>
                ${rows
                  .map(
                    (t) => `
                <div class="tx-row" data-tx-id="${escapeHtml(String(t.id))}">
                  <div class="tx-date">${(t.booking_date || "").slice(8, 10)}-${(t.booking_date || "").slice(5, 7)}</div>
                  <div class="tx-text">
                    <span class="tx-name">${escapeHtml(t.description || t.merchant_name || "Unknown")}</span>
                    <span class="tx-sub">${escapeHtml(t.merchant_name || "")}${t.predicted ? ' <span class="tx-predicted">predicted</span>' : ""}${t.voor_ijkpunt ? ' <span class="tx-old">before baseline</span>' : ""}</span>
                    ${doorlink(t) ? `<a class="tx-link" href="${doorlink(t).url}">${escapeHtml(doorlink(t).text)}</a>` : ""}
                  </div>
                  <div class="tx-amount ${t.amount > 0 ? "balance-positive" : "balance-negative"}">${t.amount > 0 ? "+" : "-"}${euro(t.amount)}</div>
                </div>`
                  )
                  .join("")}
              </div>`;
          })
          .join("");
      };

      let zichtbaar = tx;
      const filter = () => {
        const q = document.getElementById("txSearch").value.toLowerCase();
        const cat = document.getElementById("txCategory").value;
        const kindLabel = document.getElementById("txSoort").value;
        zichtbaar = tx.filter(
          (t) =>
            // Vrije tekst van de bank, IBAN en referentie doen mee in de zoekbalk.
            [t.description, t.merchant_name, t.remittance, t.counterparty_iban,
             t.reference_number, t.type_description]
              .join(" ")
              .toLowerCase()
              .includes(q) &&
            (!cat || (t.category || "overig") === cat) &&
            (!kindLabel || (kindLabel === "in" ? t.amount > 0 : t.amount < 0))
        );
        document.getElementById("txLijst").innerHTML = teken(zichtbaar);
      };
      document.getElementById("txSearch").addEventListener("input", filter);
      document.getElementById("txCategory").addEventListener("change", filter);
      document.getElementById("txSoort").addEventListener("change", filter);
      document.getElementById("txLijst").innerHTML = teken(zichtbaar);

      // Klikken op een boeking: alles wat het dashboard van die boeking heeft.
      document.getElementById("txLijst").addEventListener("click", (e) => {
        if (e.target.closest(".tx-link")) return;
        const rij = e.target.closest(".tx-row");
        if (rij) openTxDetail(rij.dataset.txId);
      });

      // Aankomen met ?tx=... : de boeking waar je vandaan kwam oplichten.
      const gezocht = paginaParams().tx;
      if (gezocht) {
        const rij = document.querySelector(`[data-tx-id="${CSS.escape(gezocht)}"]`);
        if (rij) {
          rij.classList.add("selected");
          rij.scrollIntoView({ block: "center" });
        }
      }
    } catch (e) {
      page.innerHTML = `<div class="error-banner">Could not load transactions: ${escapeHtml(e.message)}</div>`;
    }
  },

  async connect() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading...</p></div>`;

    try {
      const data = await API.get("/api/auth/banks");
      const banks = data.banks || [];

      const banksHtml = banks.map((b) => {
        const id = b.bic || b.name;
        const name = b.name || b.bank_name || b.bic || "Unknown";
        const country = b.country || "";
        return `<div class="bank-item" onclick="connectBank('${id}', '${name}', '${country}')">
          <span class="bank-name">${name}</span>
          <span class="bank-country">${country}</span>
        </div>`;
      }).join("");

      page.innerHTML = `
        <div class="connect-container">
          <h2>Connect a bank</h2>
          <p>Select your bank to connect via Open Banking (PSD2).<br>Already connected? Go to <a href="#banks" style="color:var(--accent);">Banks</a> to manage them.</p>
          <input type="text" id="bankSearch" placeholder="Search banks..." class="search-input"
            oninput="filterBanks()">
          <div id="bankList" class="bank-list">
            ${banks.length === 0 ? '<p class="empty-state">No banks available. Check Enable Banking config.</p>' : banksHtml}
          </div>
        </div>`;
    } catch (e) {
      page.innerHTML = `
        <div class="error-banner">Could not load: ${e.message}</div>
        <div class="connect-container">
          <h2>Connect your bank</h2>
          <p>Enable Banking is not configured or unreachable. Check your .env and private key.</p>
        </div>`;
    }
  },

  async banks() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading banks...</p></div>`;

    const euro = (v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(v || 0);
    const datum = (s) => (s ? new Date(String(s).replace(" ", "T")).toLocaleDateString("en-GB") : "--");

    try {
      const [data, ext] = await Promise.all([
        API.get("/api/accounts/banks"),
        API.get("/api/external/accounts"),
      ]);
      const banks = data.banks || [];
      const external = ext.accounts || [];
      const candidates = ext.candidates || [];

      if (banks.length === 0) {
        page.innerHTML = `
          <div class="page-subheader page-subheader-row">
            <p>Manage your connected bank accounts and the accounts the dashboard derives itself.</p>
            ${CONNECT_BANK_BTN}
          </div>
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            <p>No bank connected yet.</p>
            <p style="font-size:13px;margin-top:4px;"><a href="#connect" style="color:var(--accent);">Connect a bank</a> to get started.</p>
          </div>`;
        return;
      }

      let attentie = "";
      banks.filter((b) => b.state && b.state !== "ok").forEach((b) => {
        const isExpired = b.state === "verlopen";
        const isDisconnected = b.state === "losgekoppeld";
        const kop = isDisconnected
          ? `Disconnected${b.removed_at ? " on " + datum(b.removed_at) : ""}`
          : isExpired
            ? `Session expired${b.last_checked ? " (last seen " + datum(b.last_checked) + ")" : ""}`
            : `Session expires soon: ${b.days_left} days left`;
        const uitleg = isDisconnected
          ? "The history is still here; you just won't get new transactions. Reconnect to keep syncing."
          : isExpired
            ? "The bank no longer returns new transactions. Everything below is the last retrieved state."
            : "After that syncing stops silently. Reconnect now to prevent that.";
        attentie += `
          <div class="alert ${isExpired ? "alert-red" : "alert-orange"}">
            <div class="alert-body">
              <div class="alert-title">${kop} · ${b.bank_name}</div>
              <div class="alert-text">${uitleg}${b.last_error ? `<br><span class="alert-mono">${b.last_error}</span>` : ""}</div>
            </div>
            <button class="btn btn-primary btn-sm" onclick="reconnectBank(${b.id}, '${b.bank_name}', '${b.bank_country || ""}')">Reconnect</button>
          </div>`;
      });

      const bankColors = ["#6c5ce7", "#00d68f", "#5b9aff", "#ff6b6b", "#ff9f43", "#ff7675", "#74b9ff", "#a29bfe"];
      const statusWord = { AUTHORIZED: "Valid", EXPIRED: "Expired", REVOKED: "Revoked", PENDING: "Pending", SUSPENDED: "Suspended", REMOVED: "Disconnected" };

      let html = "";
      for (let i = 0; i < banks.length; i++) {
        const bank = banks[i];
        const color = bankColors[i % bankColors.length];
        const total = euro(bank.total_balance);
        const created = datum(bank.created_at);
        const initial = (bank.bank_name || "?").charAt(0).toUpperCase();

        const badge = bank.state === "ok" ? "badge-ok" : bank.state === "verlopen" ? "badge-bad" : "badge-warn";
        const woord = statusWord[bank.status] || bank.status || "Unknown";
        const daysText = bank.days_left === null || bank.days_left === undefined
          ? ""
          : bank.days_left >= 0
            ? ` · ${bank.days_left} day${bank.days_left === 1 ? "" : "s"} left`
            : ` · ${Math.abs(bank.days_left)} daysText te laat`;
        const validText = bank.valid_until ? `until ${datum(bank.valid_until)}` : "no end date from the bank";

        let accountsHtml = "";
        for (const acc of bank.accounts || []) {
          const signClass = (acc.balance || 0) >= 0 ? "balance-positive" : "balance-negative";
          accountsHtml += `
            <div class="bank-account-row">
              <div class="bank-account-info">
                <div class="bank-account-name">${acc.name}</div>
                <div class="bank-account-iban">${acc.iban ? acc.iban.slice(0, 22) + "..." : acc.account_type || ""}</div>
              </div>
              <div class="bank-account-detail">
                <span class="bank-account-sync">${acc.last_synced ? "synced " + datum(acc.last_synced) : ""}</span>
                <span class="bank-account-balance ${signClass}">${euro(acc.balance)}</span>
              </div>
            </div>`;
        }

        html += `
          <div class="bank-card">
            <div class="bank-card-header" style="--bank-color: ${color};">
              <div class="bank-card-brand">
                <div class="bank-card-icon">${initial}</div>
                <div class="bank-card-info">
                  <div class="bank-card-name">${bank.bank_name}</div>
                  <div class="bank-card-sub">${bank.accounts.length} account${bank.accounts.length !== 1 ? "s" : ""} · connected ${created}</div>
                </div>
              </div>
              <div class="bank-card-actions">
                <div class="bank-card-total">${total}</div>
                <button class="btn btn-outline btn-sm" onclick="reconnectBank(${bank.id}, '${bank.bank_name}', '${bank.bank_country || ""}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>
                  Reconnect
                </button>
                <button class="btn btn-danger btn-sm" onclick="showDisconnectModal(${bank.id}, '${bank.bank_name}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Disconnect
                </button>
              </div>
            </div>
            <div class="bank-card-body">
              <div class="bank-card-meta session-line">
                <span class="badge ${badge}">${woord}</span>
                <span>Session ${validText}${daysText}</span>
                <span>checked ${datum(bank.last_checked)}</span>
              </div>
              ${bank.last_error ? `<div class="alert alert-red alert-klein"><div class="alert-body"><div class="alert-text"><span class="alert-mono">${bank.last_error}</span></div></div></div>` : ""}
              <div class="bank-accounts-list">
                <div class="bank-accounts-header">
                  <span>Accounts</span>
                  <span>Balance</span>
                </div>
                ${accountsHtml}
              </div>
            </div>
          </div>`;
      }

      const externHtml = external.map((a) => {
        const bewegingen = (a.moves || []).slice().reverse().slice(0, 6);
        const moves = bewegingen.length
          ? bewegingen.map((m) => `
              <div class="ext-move">
                <span class="ext-move-date">${m.date}</span>
                <span class="ext-move-text">${m.description}</span>
                <span class="ext-move-amount ${m.amount >= 0 ? "balance-positive" : "balance-negative"}">${m.amount >= 0 ? "+" : ""}${euro(m.amount)}</span>
              </div>`).join("")
          : `<div class="ext-move ext-move-empty"><span>No transfers since the baseline</span></div>`;
        const vast = (a.recurring || []).map((r) => `
              <div class="ext-move">
                <span class="ext-move-date">${r.next_expected}</span>
                <span class="ext-move-text">${r.description}</span>
                <span class="ext-move-amount ${r.amount >= 0 ? "balance-positive" : "balance-negative"}">expected ${r.amount >= 0 ? "+" : ""}${euro(r.amount)}</span>
              </div>`).join("");
        return `
          <div class="bank-card">
            <div class="bank-card-header" style="--bank-color: #5b9aff;">
              <div class="bank-card-brand">
                <div class="bank-card-icon">${(a.name || "?").charAt(0).toUpperCase()}</div>
                <div class="bank-card-info">
                  <div class="bank-card-name">${a.name} <span class="badge badge-warn">predicted</span></div>
                  <div class="bank-card-sub">${a.iban || a.account_number || "no IBAN"} · baseline ${euro(a.baseline)} on ${a.baseline_date || "--"}</div>
                </div>
              </div>
              <div class="bank-card-actions">
                <div class="bank-card-total">${euro(a.balance)}</div>
              </div>
            </div>
            <div class="bank-card-body">
              <div class="bank-card-meta">
                <span>${a.delta === 0 ? "No transfers since the baseline" : `${a.delta >= 0 ? "+" : ""}${euro(a.delta)} in transfers`}</span>
                <span>${a.statement_rows ? `${a.statement_rows} statement entries since ${a.first_statement_date}` : `${a.source === "firefly" ? "baseline from Firefly" : a.source}`} · updated ${datum(a.updated_at)}</span>
              </div>
              ${vast ? `<div class="ext-moves">${vast}</div><div class="ext-move ext-move-empty"><span>Recurring, from ${(a.recurring[0].count)} statement entries (${a.recurring[0].first} – ${a.recurring[0].last})</span></div>` : ""}
              <div class="ext-moves">${moves}</div>
            </div>
          </div>`;
      }).join("");

      const kandidaten = candidates.length
        ? `
        <div class="card" style="margin-top:20px;">
          <div class="card-header"><span class="card-title">Transfers not linked to an account (${candidates.length})</span></div>
          <p class="hint">These look like transfers to a savings or brokerage account, but no account is linked to them. Link the account or add a keyword in the bridge config to count them.</p>
          <div class="ext-moves">
            ${candidates.map((c) => `
              <div class="ext-move">
                <span class="ext-move-date">${c.date}</span>
                <span class="ext-move-text">${c.description}</span>
                <span class="ext-move-amount ${c.amount >= 0 ? "balance-positive" : "balance-negative"}">${c.amount >= 0 ? "+" : ""}${euro(c.amount)}</span>
              </div>`).join("")}
          </div>
        </div>`
        : "";

      page.innerHTML = `
        <div class="page-subheader page-subheader-row">
          <p>Manage your connected bank accounts and the accounts the dashboard derives itself.</p>
          ${CONNECT_BANK_BTN}
        </div>
        ${attentie}
        <input type="text" id="banksSearch" placeholder="Search by bank name..." class="search-input" oninput="filterBanksList()" style="margin-bottom:16px;">
        <div class="banks-grid">${html}</div>
        ${external.length ? `
          <h3 class="section-head">Outside the bank <span class="badge badge-warn">predicted</span></h3>
          <p class="hint">These accounts are not in Rabobank's PSD2 consent. The balance is the baseline from Firefly plus every transfer to or from your current account since then. If the baseline is off, adjust the balance in Firefly; the next run recalculates.</p>
          <div class="banks-grid">${externHtml}</div>` : `
          <div class="empty-state">
            <p>No accounts outside the bank yet.</p>
            <p style="font-size:13px;margin-top:4px;">Run the Firefly bridge to see your savings accounts and IBKR here.</p>
          </div>`}
        ${kandidaten}
        <div id="disconnectOverlay" class="modal-overlay" style="display:none;" onclick="closeDisconnectModal(event)">
          <div class="modal-box" onclick="event.stopPropagation()">
            <div class="modal-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h3 id="disconnectBankName">Disconnect bank?</h3>
            <p>No new transactions will come in. The history that is already there is kept, because the bank only goes back a limited time. You can undo disconnecting later by reconnecting.</p>
            <div class="modal-actions">
              <button class="btn btn-outline" onclick="closeDisconnectModal()">Cancel</button>
              <button class="btn btn-danger" id="confirmDisconnectBtn" onclick="confirmDisconnect()">
                Yes, disconnect
              </button>
            </div>
          </div>
        </div>`;
    } catch (e) {
      page.innerHTML = `<div class="error-banner">Could not load banks: ${e.message}</div>`;
    }
  },

  // ── AI Page ─────────────────────────────────────────────────────────
  async ai() {
    const page = document.getElementById("page-content");

    if (!aiSettings) await loadAiSettings();

    const configured = aiSettings.endpoint && aiSettings.api_key;
    const selectedModel = aiSettings.model || "";

    page.innerHTML = `
      <div class="page-subheader page-subheader-row">
        <p>Let AI suggest categories for your transactions and ask questions about your money. You always review before anything is applied.</p>
        ${AI_SETTINGS_BTN}
      </div>
      <div class="ai-page">
        <!-- Categorize Section -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <span class="card-title">Auto-Categorize Transactions</span>
            <div style="display:flex;gap:8px;align-items:center;">
              <select id="ai-cat-model" class="bankbot-model-select" style="max-width:200px;">
                <option value="">${selectedModel || "Loading models..."}</option>
              </select>
              <button class="btn btn-primary btn-sm" id="btn-categorize" onclick="runCategorize()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v1a2 2 0 0 1-2 2h-1l1 5H7l1-5H7a2 2 0 0 1-2-2v-1a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z"/></svg>
                Categorize with AI
              </button>
            </div>
          </div>
          ${!configured ? '<p style="color:var(--orange);font-size:13px;">⚠ AI not configured yet. <a href="#ai-settings" style="color:var(--accent);">Set up AI Settings</a> first.</p>' : '<p style="color:var(--text-muted);font-size:13px;">Uses your configured AI model to suggest categories. You review before applying.</p>'}
          <div id="categorize-results"></div>
        </div>

        <!-- Chat Section -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">BankBot Chat</span>
            <select id="ai-chat-model" class="bankbot-model-select" style="max-width:200px;">
              <option value="">${selectedModel || "Loading models..."}</option>
            </select>
          </div>
          <div id="ai-chat-messages" class="ai-chat-messages">
            <div class="bankbot-msg bankbot-bot">
              <div class="bankbot-bubble">Hi! I'm BankBot. Ask me anything about your finances.</div>
            </div>
          </div>
          <div class="bankbot-input-area">
            <input type="text" id="ai-chat-input" placeholder="Ask about your money..." />
            <button id="ai-chat-send" class="btn btn-primary btn-sm" onclick="sendAiChat()">Send</button>
          </div>
        </div>
      </div>
    `;

    // Load models into both dropdowns
    loadAiModels();

    // Chat enter key
    document.getElementById("ai-chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendAiChat();
    });
  },

  // ── AI Settings Page ────────────────────────────────────────────────
  async "ai-settings"() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading settings...</p></div>`;

    if (!aiSettings) await loadAiSettings();

    page.innerHTML = `
      <div class="ai-settings-page">
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <span class="card-title">AI Configuration</span>
          </div>

          <div class="settings-group">
            <label class="settings-label">AI Location</label>
            <p class="settings-hint">Where the AI chat appears</p>
            <select id="setting-location" class="settings-select">
              <option value="sidebar" ${aiSettings.location === "sidebar" ? "selected" : ""}>Sidebar (AI tab)</option>
              <option value="bubble" ${aiSettings.location === "bubble" ? "selected" : ""}>Chat Bubble</option>
              <option value="both" ${aiSettings.location === "both" ? "selected" : ""}>Both</option>
            </select>
          </div>

          <div class="settings-group">
            <label class="settings-label">API Endpoint</label>
            <p class="settings-hint">OpenAI-compatible base URL (e.g. https://api.openai.com/v1 or https://openrouter.ai/api/v1)</p>
            <input type="text" id="setting-endpoint" class="settings-input" placeholder="https://api.openai.com/v1" value="${escapeHtml(aiSettings.endpoint || "")}">
          </div>

          <div class="settings-group">
            <label class="settings-label">API Key</label>
            <p class="settings-hint">Your API key for the endpoint above</p>
            <input type="password" id="setting-api-key" class="settings-input" placeholder="sk-..." value="${escapeHtml(aiSettings.api_key || "")}">
          </div>

          <div class="settings-group">
            <label class="settings-label">Default Model</label>
            <p class="settings-hint">Model to use for categorization and chat</p>
            <div style="display:flex;gap:8px;align-items:center;">
              <select id="setting-model" class="settings-select" style="flex:1;">
                <option value="">Select a model...</option>
              </select>
              <button class="btn btn-outline btn-sm" onclick="refreshModelsDropdown()">Refresh</button>
            </div>
          </div>

          <div style="margin-top:24px;display:flex;gap:12px;">
            <button class="btn btn-primary" onclick="saveAiSettings()">Save Settings</button>
            <span id="settings-status" style="color:var(--green);font-size:13px;align-self:center;"></span>
          </div>
        </div>
      </div>
    `;

    // Load models
    refreshModelsDropdown();
  },
};

// ── AI Helpers ────────────────────────────────────────────────────────

async function loadAiModels() {
  try {
    const data = await API.get("/api/ai/models");
    const models = data.models || [];
    const opts = models.length
      ? models.map((m) => `<option value="${m}">${m}</option>`).join("")
      : '<option value="">No models found</option>';

    // Update all model dropdowns on the page
    ["ai-cat-model", "ai-chat-model"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = opts;
        // Pre-select saved model
        if (aiSettings?.model) {
          el.value = aiSettings.model;
        }
      }
    });
  } catch {
    ["ai-cat-model", "ai-chat-model"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<option value="">Models unavailable</option>';
    });
  }
}

async function refreshModelsDropdown() {
  const el = document.getElementById("setting-model");
  if (!el) return;
  el.innerHTML = '<option value="">Loading...</option>';

  // Temporarily save endpoint/key so the models endpoint can use them
  const epEl = document.getElementById("setting-endpoint");
  const keyEl = document.getElementById("setting-api-key");
  if (epEl && keyEl) {
    try {
      await API.put("/api/ai/settings", {
        endpoint: epEl.value,
        api_key: keyEl.value,
      });
    } catch {}
  }

  try {
    const data = await API.get("/api/ai/models");
    const models = data.models || [];
    if (models.length) {
      el.innerHTML = '<option value="">Select a model...</option>' +
        models.map((m) => `<option value="${m}" ${m === aiSettings?.model ? "selected" : ""}>${m}</option>`).join("");
    } else {
      el.innerHTML = '<option value="">No models found — check endpoint & key</option>';
    }
  } catch {
    el.innerHTML = '<option value="">Failed to fetch models</option>';
  }
}

async function saveAiSettings() {
  const status = document.getElementById("settings-status");
  try {
    const updates = {
      location: document.getElementById("setting-location").value,
      endpoint: document.getElementById("setting-endpoint").value,
      api_key: document.getElementById("setting-api-key").value,
      model: document.getElementById("setting-model").value,
    };
    await API.put("/api/ai/settings", updates);
    aiSettings = { ...aiSettings, ...updates };
    status.textContent = "✓ Saved!";
    status.style.color = "var(--green)";
    setTimeout(() => { if (status) status.textContent = ""; }, 3000);
  } catch (e) {
    status.textContent = "✗ Failed: " + e.message;
    status.style.color = "var(--red)";
  }
}

// ── Categorize Logic ──────────────────────────────────────────────────

async function runCategorize() {
  const btn = document.getElementById("btn-categorize");
  const results = document.getElementById("categorize-results");
  const modelEl = document.getElementById("ai-cat-model");
  const model = modelEl ? modelEl.value : "";

  btn.disabled = true;
  btn.textContent = "Categorizing...";
  results.innerHTML = '<div class="loading" style="padding:20px;"><div class="spinner" style="width:24px;height:24px;"></div><p style="margin-top:8px;font-size:13px;">AI is analyzing your transactions...</p></div>';

  try {
    const data = await API.post("/api/ai/categorize", { model });

    if (!data.suggestions?.length) {
      results.innerHTML = '<p style="color:var(--text-muted);padding:16px;text-align:center;">No suggestions returned.</p>';
      return;
    }

    const allCats = data.all_categories || data.existing_categories || [];
    const catOptions = allCats.map((c) => `<option value="${c}">${c}</option>`).join("");

    let html = `
      <div style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="font-size:13px;color:var(--text-secondary);">${data.suggestions.length} transactions analyzed</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-outline btn-sm" onclick="resetCatSuggestions()">Reset</button>
            <button class="btn btn-primary btn-sm" onclick="applyCatSuggestions()">Apply Selected</button>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width:40px;"><input type="checkbox" id="cat-select-all" checked onchange="toggleAllCats(this)"></th>
                <th>Date</th>
                <th>Description</th>
                <th>Current</th>
                <th>Suggested</th>
              </tr>
            </thead>
            <tbody id="cat-suggestions-body">
    `;

    data.suggestions.forEach((s, i) => {
      const isNew = s.is_new_category;
      html += `
        <tr data-idx="${i}" data-id="${s.id}">
          <td><input type="checkbox" class="cat-check" checked></td>
          <td style="white-space:nowrap;color:var(--text-secondary);">${s.booking_date}</td>
          <td>${escapeHtml(s.description)}</td>
          <td><span class="category-badge ${s.current_category}">${s.current_category}</span></td>
          <td>
            <select class="cat-select settings-select" style="padding:4px 8px;font-size:12px;min-width:120px;">
              ${allCats.map((c) => `<option value="${c}" ${c === s.suggested_category ? "selected" : ""}>${c}${c === s.suggested_category && isNew ? " (new)" : ""}</option>`).join("")}
            </select>
          </td>
        </tr>`;
    });

    html += `</tbody></table></div></div>`;
    results.innerHTML = html;

    // Store data for apply
    window._catSuggestions = data.suggestions;

  } catch (e) {
    results.innerHTML = `<div class="error-banner" style="margin-top:12px;">${e.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v1a2 2 0 0 1-2 2h-1l1 5H7l1-5H7a2 2 0 0 1-2-2v-1a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z"/></svg> Categorize with AI`;
  }
}

function toggleAllCats(master) {
  document.querySelectorAll(".cat-check").forEach((cb) => { cb.checked = master.checked; });
}

function resetCatSuggestions() {
  document.getElementById("categorize-results").innerHTML = "";
  window._catSuggestions = null;
}

async function applyCatSuggestions() {
  const rows = document.querySelectorAll("#cat-suggestions-body tr");
  const updates = [];
  rows.forEach((row) => {
    const cb = row.querySelector(".cat-check");
    if (!cb || !cb.checked) return;
    const id = row.dataset.id;
    const cat = row.querySelector(".cat-select").value;
    if (id && cat) updates.push({ id, category: cat });
  });

  if (!updates.length) return;

  try {
    const result = await API.post("/api/ai/apply-categories", { updates });
    document.getElementById("categorize-results").innerHTML = `
      <div style="padding:16px;text-align:center;">
        <p style="color:var(--green);font-weight:600;">✓ ${result.updated} transactions updated!</p>
        <button class="btn btn-outline btn-sm" style="margin-top:8px;" onclick="document.getElementById('categorize-results').innerHTML=''">Dismiss</button>
      </div>`;
  } catch (e) {
    document.getElementById("categorize-results").innerHTML = `
      <div class="error-banner" style="margin-top:12px;">Failed to apply: ${e.message}</div>`;
  }
}

// ── Chat Logic (used in AI page) ─────────────────────────────────────

async function sendAiChat() {
  const input = document.getElementById("ai-chat-input");
  const messages = document.getElementById("ai-chat-messages");
  const modelEl = document.getElementById("ai-chat-model");
  if (!input || !messages) return;

  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";

  // Add user message
  const userDiv = document.createElement("div");
  userDiv.className = "bankbot-msg bankbot-user";
  userDiv.innerHTML = `<div class="bankbot-bubble">${escapeHtml(msg)}</div>`;
  messages.appendChild(userDiv);
  messages.scrollTop = messages.scrollHeight;

  // Loading
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "bankbot-msg bankbot-bot bankbot-loading";
  loadingDiv.innerHTML = '<div class="bankbot-bubble">Thinking</div>';
  messages.appendChild(loadingDiv);
  messages.scrollTop = messages.scrollHeight;

  const model = modelEl ? modelEl.value : "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, model }),
    });
    loadingDiv.remove();
    if (!res.ok) {
      const err = await res.text();
      addAiChatMsg("Error: " + err, false);
      return;
    }
    const data = await res.json();
    addAiChatMsg(data.reply || "(no response)", false);
  } catch (e) {
    loadingDiv.remove();
    addAiChatMsg("Error: " + e.message, false);
  }
}

function addAiChatMsg(text, isUser) {
  const messages = document.getElementById("ai-chat-messages");
  if (!messages) return;
  const div = document.createElement("div");
  div.className = "bankbot-msg " + (isUser ? "bankbot-user" : "bankbot-bot");
  div.innerHTML = `<div class="bankbot-bubble">${isUser ? escapeHtml(text) : renderMarkdown(text)}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// Connect-knop: stond als los nav-item in de zijbalk, hoort nu rechtsboven op de Banks-pagina.
const CONNECT_BANK_BTN = `<button class="btn btn-primary btn-sm" onclick="location.hash = '#connect'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Connect bank
          </button>`;

// AI-instellingen: stond als los nav-item in de zijbalk, hoort nu rechtsboven op de AI-pagina.
const AI_SETTINGS_BTN = `<button class="btn btn-outline btn-sm" onclick="location.hash = '#ai-settings'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            AI settings
          </button>`;

// ── Boekingsdetail: klik op een rij voor alles wat er van die boeking bekend is ──

function txEuro(v) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Math.abs(v || 0));
}

function txRij(label, waarde) {
  const leeg = waarde === null || waarde === undefined || waarde === "" || waarde === "null";
  return `<div class="tx-detail-row"><span class="tx-detail-label">${escapeHtml(label)}</span>
    <span class="tx-detail-value${leeg ? " leeg" : ""}">${leeg ? "not provided" : escapeHtml(String(waarde))}</span></div>`;
}

// Zelfde rij, maar met regeleindes erin (de vrije betaaltekst van de bank).
function txRijLang(label, waarde) {
  const leeg = waarde === null || waarde === undefined || waarde === "";
  return `<div class="tx-detail-row"><span class="tx-detail-label">${escapeHtml(label)}</span>
    <span class="tx-detail-value${leeg ? " leeg" : ""}" style="white-space:pre-wrap">${leeg ? "not provided" : escapeHtml(String(waarde))}</span></div>`;
}

function txLijst(...waarden) {
  return waarden.filter((w) => w !== null && w !== undefined && w !== "").join(" · ");
}

// De bank-respons zit als tekst in raw_json; in de dump laten we hem uitgeklapt zien.
function txRuw(t) {
  if (!t || !t.raw_json) return t;
  try {
    return Object.assign({}, t, { raw_json: JSON.parse(t.raw_json) });
  } catch (e) {
    return t;
  }
}

function openTxDetail(id) {
  closeTxDetail();
  const staat = window.__txDetail || {};
  const t = (staat.rows || {})[String(id)];
  if (!t) return;

  // Rekening van deze boeking: de gekozen rekening, anders opzoeken op id/key.
  const rek = (staat.accountsById || {})[String(t.account_key || t.account_id)] || staat.account;
  const link = (staat.links || {})[String(t.id)];
  const teken = t.amount > 0 ? "+" : "-";
  const bron = String(t.id).startsWith("pdf-")
    ? "pdf-import (2018 statement)"
    : "bank (PSD2 / Enable Banking)";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "txDetailOverlay";
  overlay.style.display = "flex";
  overlay.onclick = (e) => { if (e.target === overlay) closeTxDetail(); };
  overlay.innerHTML = `
    <div class="modal-box tx-detail-box" onclick="event.stopPropagation()">
      <div class="tx-detail-head">
        <div>
          <div class="tx-detail-title">${escapeHtml(t.description || t.merchant_name || "Unknown")}</div>
          <div class="tx-detail-date">${escapeHtml(String(t.booking_date || ""))}${rek ? " · " + escapeHtml(rek.name) : ""}</div>
        </div>
        <div class="tx-detail-amount ${t.amount > 0 ? "amount-in" : "amount-out"}">${teken}${txEuro(t.amount)}</div>
      </div>
      ${txRij("Date", t.booking_date)}
      ${txRij("Value date", t.value_date)}
      ${txRij("Amount", teken + txEuro(t.amount) + " " + (t.currency || "EUR"))}
      ${txRij("Direction", t.amount > 0 ? "in" : "out")}
      ${txRij("Status", t.status)}
      ${txRij("Type", txLijst(t.type_code, t.type_sub_code, t.type_description))}
      ${txRij("Category", t.category)}
      ${txRij("Description", t.description)}
      ${txRij("Merchant", t.merchant_name)}
      ${txRij("Counterparty IBAN", t.counterparty_iban)}
      ${txRij("Reference", txLijst(t.reference_number_schema, t.reference_number))}
      ${txRijLang("Remittance", t.remittance)}
      ${txRij("Running balance", t.running_balance)}
      ${txRij("Account", rek ? rek.name + " · " + (rek.display_number || rek.iban || "") : (t.account_key || t.account_id))}
      ${txRij("Account key", t.account_key || t.account_id)}
      ${txRij("Bank reference", t.id)}
      ${txRij("Source", bron)}
      ${txRij("First seen by dashboard", t.inserted_at)}
      ${t.predicted ? txRij("Predicted", "yes — no statement of its own, derived from the transfers on your current account") : ""}
      ${t.voor_ijkpunt ? txRij("Baseline", "before the Firefly baseline — not counted in the balance") : ""}
      ${t.source_tx_id ? txRij("Comes from transaction", t.source_tx_id + (t.source_account_id ? " on " + t.source_account_id : "")) : ""}
      ${link ? `<div class="tx-detail-link">Transfers to <a href="#transactions?acc=${encodeURIComponent(link.key)}">${escapeHtml(link.name)}</a></div>` : ""}
      <details class="tx-detail-raw">
        <summary>Everything the dashboard has for this transaction</summary>
        <pre>${escapeHtml(JSON.stringify(txRuw(t), null, 2))}</pre>
      </details>
      <div class="modal-actions"><button class="btn btn-outline" onclick="closeTxDetail()">Close</button></div>
    </div>`;
  document.body.appendChild(overlay);
}

function closeTxDetail() {
  const el = document.getElementById("txDetailOverlay");
  if (el) el.remove();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTxDetail();
});

// ── Shared Helpers ────────────────────────────────────────────────────

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function renderMarkdown(text) {
  const d = document.createElement("div");
  d.textContent = text;
  let html = d.innerHTML;

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:var(--bg-secondary);padding:12px 16px;border-radius:8px;font-size:12px;overflow-x:auto;margin:8px 0;border:1px solid var(--border);"><code>$2</code></pre>');
  html = html.replace(/^(&gt;|>) (.+)$/gm, '<blockquote style="border-left:3px solid var(--accent);padding:4px 12px;margin:8px 0;color:var(--text-secondary);">$2</blockquote>');
  html = html.replace(/^### (.+)$/gm, "<h4 style='margin:12px 0 4px;font-size:14px;font-weight:600;'>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3 style='margin:14px 0 4px;font-size:16px;font-weight:700;'>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2 style='margin:16px 0 6px;font-size:18px;font-weight:700;'>$1</h2>");
  html = html.replace(/^[-*_]{3,}$/gm, '<hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">');
  html = html.replace(/^[\s]*[-*][\s]+\[ \]\s+(.+)$/gm, '<label style="display:block;padding:2px 0;"><input type="checkbox" disabled> $1</label>');
  html = html.replace(/^[\s]*[-*][\s]+\[[xX]\]\s+(.+)$/gm, '<label style="display:block;padding:2px 0;color:var(--text-muted);"><input type="checkbox" disabled checked> $1</label>');
  html = html.replace(/^[\s]*[-*][\s]+(.+)$/gm, '• $1');
  if (html.includes("|") && html.includes("\n")) {
    html = html.replace(/\n?\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, function(match, header, body) {
      const headers = header.split("|").map(h => h.trim());
      const rows = body.trim().split("\n").map(row => {
        const cells = row.split("|").slice(1, -1).map(c => c.trim());
        return "<tr>" + cells.map(c => "<td style='padding:4px 10px;border:1px solid var(--border);'>" + c + "</td>").join("") + "</tr>";
      }).join("");
      return "<table style='border-collapse:collapse;margin:8px 0;font-size:12px;width:100%;'>" +
        "<thead><tr>" + headers.map(h => "<th style='padding:4px 10px;border:1px solid var(--border);text-align:left;'>" + h + "</th>").join("") + "</tr></thead>" +
        "<tbody>" + rows + "</tbody></table>";
    });
  }
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/~~(.+?)~~/g, '<del style="color:var(--text-muted);">$1</del>');
  html = html.replace(/`(.+?)`/g, '<code style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;font-size:12px;">$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">$1</a>');
  html = html.replace(/\$\$(.+?)\$\$/g, '<span style="font-family:serif;font-style:italic;padding:0 4px;">[$1]</span>');
  html = html.replace(/\$(.+?)\$/g, '<span style="font-family:serif;font-style:italic;padding:0 2px;">$1</span>');
  html = html.replace(/\[\^(\w+)\]:\s(.+)/g, '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0;"><small style="color:var(--text-muted);">[$1]: $2</small>');
  html = html.replace(/\[\^(\w+)\]/g, '<sup style="color:var(--accent);font-size:10px;">[$1]</sup>');
  html = html.replace(/\n\n/g, "</p><p style='margin:8px 0;'>");
  html = "<p style='margin:0;'>" + html + "</p>";
  html = html.replace(/\n/g, "<br>");

  return html;
}

// ── Disconnect Modal ──────────────────────────────────────────────────

let _disconnectId = null;

function showDisconnectModal(id, bankName) {
  _disconnectId = id;
  document.getElementById("disconnectBankName").textContent = `${bankName} disconnect?`;
  document.getElementById("disconnectOverlay").style.display = "flex";
}

function closeDisconnectModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("disconnectOverlay").style.display = "none";
  _disconnectId = null;
}

async function confirmDisconnect() {
  if (!_disconnectId) return;
  const btn = document.getElementById("confirmDisconnectBtn");
  btn.disabled = true;
  btn.textContent = "Working...";
  try {
    const res = await fetch(`/api/auth/connections/${_disconnectId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to disconnect");
    closeDisconnectModal();
    Pages.banks();
  } catch (e) {
    console.error("Disconnect error:", e);
    btn.disabled = false;
    btn.textContent = "Yes, disconnect";
  }
}

// Navigation
// Hash kan een account meedragen: #transactions?acc=firefly:3
function paginaParams() {
  const [naam, query] = window.location.hash.replace("#", "").split("?");
  const params = {};
  new URLSearchParams(query || "").forEach((v, k) => { params[k] = v; });
  params.page = naam || "home";
  return params;
}

function navigate(page) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");

  const titles = {
    home: "Dashboard", insights: "Insights", accounts: "Accounts", transactions: "Transactions",
    connect: "Connect bank", banks: "Banks", ai: "AI", "ai-settings": "AI settings",
  };
  document.getElementById("page-title").textContent = titles[page] || "Dashboard";

  if (Pages[page]) Pages[page]();
}

// Bank connect
async function connectBank(bankId, bankName, bankCountry) {
  window.location.href = `/api/auth/connect/${encodeURIComponent(bankId)}?name=${encodeURIComponent(bankName)}&country=${encodeURIComponent(bankCountry)}`;
}

// Bank search filter
function filterBanks() {
  const q = document.getElementById("bankSearch").value.toLowerCase();
  const items = document.querySelectorAll(".bank-item");
  items.forEach((el) => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? "flex" : "none";
  });
}

// Banks page search filter
function filterBanksList() {
  const q = document.getElementById("banksSearch").value.toLowerCase();
  const cards = document.querySelectorAll(".bank-card");
  cards.forEach((el) => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// Sync
// Reconnect: dezelfde bank, een verse sessie, dezelfde rekeningrijen.
function reconnectBank(id, name, country) {
  const params = new URLSearchParams({ name: name || "", country: country || "" });
  window.location.href = `/api/auth/reconnect/${id}?${params.toString()}`;
}

async function syncAll() {
  const btn = document.querySelector(".header-actions .btn-primary");
  const original = btn.textContent;
  btn.textContent = "Syncing...";
  btn.disabled = true;
  try {
    await API.get("/api/sync");
    document.querySelector(".last-sync").textContent =
      "Last sync: " + new Date().toLocaleString();
  } catch (e) {
    console.error("Sync error:", e);
  }
  btn.textContent = original;
  btn.disabled = false;
}

// Router
window.addEventListener("hashchange", () => navigate(paginaParams().page));

// Init
document.addEventListener("DOMContentLoaded", async () => {
  await loadAiSettings();
  navigate(paginaParams().page);
});

// Check for connection success
if (new URLSearchParams(window.location.search).get("connected") === "true") {
  window.history.replaceState({}, "", window.location.pathname);
  setTimeout(() => navigate("home"), 500);
}
