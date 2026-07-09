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
      const [summary, accounts] = await Promise.all([
        API.get("/api/accounts/summary"),
        API.get("/api/accounts"),
      ]);

      const total = summary.total_balance || 0;
      const count = summary.account_count || 0;
      const formattedTotal = new Intl.NumberFormat("en-EU", {
        style: "currency",
        currency: "EUR",
      }).format(total);

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

      if (!accountsHtml) {
        accountsHtml = `
          <div class="balance-card" style="grid-column:1/-1;text-align:center;padding:40px;">
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 9v4M10 13h4"/></svg>
              <p>No accounts connected yet.</p>
              <p style="margin-top:4px;font-size:13px;">Go to Connect Bank to get started.</p>
            </div>
          </div>`;
      }

      page.innerHTML = `
        <div class="balance-grid">
          <div class="balance-card">
            <div class="balance-label">Net Worth</div>
            <div class="balance-amount">${formattedTotal}</div>
            <div class="balance-sub">${count} account${count !== 1 ? "s" : ""}</div>
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
          dining: "#e17055", subscriptions: "#a29bfe",
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

  async insights() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading insights...</p></div>`;

    try {
      const [spending, monthly] = await Promise.all([
        API.get("/api/insights/spending?days=90"),
        API.get("/api/insights/monthly"),
      ]);

      page.innerHTML = `
        <div class="charts-grid">
          <div class="chart-card">
            <div class="card-header">
              <span class="card-title">Spending Breakdown (90 days)</span>
            </div>
            <canvas id="insightCategoryChart"></canvas>
          </div>
          <div class="chart-card">
            <div class="card-header">
              <span class="card-title">Monthly Income vs Spending</span>
            </div>
            <canvas id="insightMonthlyChart"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">All Categories</span>
          </div>
          <div class="table-container" style="border:none;">
            <table>
              <thead><tr><th>Category</th><th>Total</th><th>Transactions</th><th>Avg per transaction</th></tr></thead>
              <tbody id="categoryTableBody"></tbody>
            </table>
          </div>
        </div>
      `;

      if (spending.insights?.length) {
        const colors = {
          food: "#ff6b6b", transport: "#5b9aff", shopping: "#6c5ce7",
          housing: "#ff9f43", entertainment: "#ff7675", health: "#74b9ff",
          transfer: "#ffa726", income: "#00d68f", other: "#8888a0",
          dining: "#e17055", subscriptions: "#a29bfe",
        };
        new Chart(document.getElementById("insightCategoryChart"), {
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
            plugins: {
              legend: { position: "right", labels: { color: "#8888a0", font: { size: 12 } } },
            },
            cutout: "60%",
          },
        });
      }

      const months = (monthly.months || []).reverse();
      if (months.length) {
        new Chart(document.getElementById("insightMonthlyChart"), {
          type: "bar",
          data: {
            labels: months.map((m) => {
              const [y, mo] = m.month.split("-");
              return new Date(y, mo - 1).toLocaleString("default", { month: "short" });
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
            plugins: {
              legend: { labels: { color: "#8888a0", font: { size: 12 } } },
            },
            scales: {
              x: { grid: { color: "rgba(42,42,58,0.5)" }, ticks: { color: "#8888a0" } },
              y: { grid: { color: "rgba(42,42,58,0.5)" }, ticks: { color: "#8888a0" } },
            },
          },
        });
      }

      const tbody = document.getElementById("categoryTableBody");
      if (spending.insights?.length && tbody) {
        tbody.innerHTML = spending.insights
          .map((s) => `
          <tr>
            <td><span class="category-badge ${s.category}">${s.category}</span></td>
            <td style="font-weight:600;">€${s.total.toLocaleString()}</td>
            <td>${s.count} transactions</td>
            <td>€${(s.total / s.count).toFixed(2)}</td>
          </tr>`)
          .join("");
      }
    } catch (e) {
      page.innerHTML = `<div class="error-banner">Could not load insights: ${e.message}</div>`;
    }
  },

  async transactions() {
    const page = document.getElementById("page-content");
    page.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading transactions...</p></div>`;

    try {
      const data = await API.get("/api/transactions?limit=100&days=90");

      if (!data.transactions?.length) {
        page.innerHTML = `
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p>No transactions found.</p>
            <p style="font-size:13px;">Connect a bank account and sync to see your transactions here.</p>
          </div>`;
        return;
      }

      page.innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
          <input type="text" id="txSearch" placeholder="Search transactions..." style="flex:1;min-width:200px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:inherit;font-size:14px;">
          <select id="txCategory" style="padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-family:inherit;font-size:14px;">
            <option value="">All categories</option>
            ${[...new Set(data.transactions.map((t) => t.category || "other"))]
              .map((c) => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody id="txBody"></tbody>
          </table>
        </div>
        <p style="text-align:center;color:var(--text-muted);margin-top:12px;font-size:13px;">Showing ${data.transactions.length} transactions (last 90 days)</p>
      `;

      const tbody = document.getElementById("txBody");
      const renderTx = (tx) => {
        const isIncome = tx.amount > 0;
        const formatted = new Intl.NumberFormat("en-EU", {
          style: "currency",
          currency: tx.currency || "EUR",
        }).format(Math.abs(tx.amount));

        return `
          <tr>
            <td style="white-space:nowrap;color:var(--text-secondary);">${tx.booking_date || "--"}</td>
            <td>${tx.description || tx.merchant_name || "Unknown"}</td>
            <td><span class="category-badge ${tx.category || "other"}">${tx.category || "other"}</span></td>
            <td class="amount-cell ${isIncome ? "balance-positive" : "balance-negative"}">${isIncome ? "+" : "-"}${formatted}</td>
          </tr>`;
      };

      let allTx = data.transactions;
      tbody.innerHTML = allTx.map(renderTx).join("");

      document.getElementById("txSearch").addEventListener("input", filterTx);
      document.getElementById("txCategory").addEventListener("change", filterTx);

      function filterTx() {
        const q = document.getElementById("txSearch").value.toLowerCase();
        const cat = document.getElementById("txCategory").value;
        const filtered = allTx.filter(
          (t) =>
            (t.description || "").toLowerCase().includes(q) &&
            (!cat || t.category === cat)
        );
        tbody.innerHTML = filtered.length
          ? filtered.map(renderTx).join("")
          : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">No matching transactions</td></tr>';
      }
    } catch (e) {
      page.innerHTML = `<div class="error-banner">Could not load transactions: ${e.message}</div>`;
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

    try {
      const data = await API.get("/api/accounts/banks");
      const banks = data.banks || [];

      if (banks.length === 0) {
        page.innerHTML = `
          <div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
            <p>No banks connected yet.</p>
            <p style="font-size:13px;margin-top:4px;"><a href="#connect" style="color:var(--accent);">Connect a bank</a> to get started.</p>
          </div>`;
        return;
      }

      const bankColors = ["#6c5ce7", "#00d68f", "#5b9aff", "#ff6b6b", "#ff9f43", "#ff7675", "#74b9ff", "#a29bfe"];

      let html = "";
      for (let i = 0; i < banks.length; i++) {
        const bank = banks[i];
        const color = bankColors[i % bankColors.length];
        const total = new Intl.NumberFormat("en-EU", {
          style: "currency",
          currency: "EUR",
        }).format(bank.total_balance || 0);

        const created = new Date(bank.created_at + "Z").toLocaleDateString("nl-NL");
        const expires = bank.expires_at ? new Date(bank.expires_at + "Z").toLocaleDateString("nl-NL") : "--";
        const initial = bank.bank_name.charAt(0).toUpperCase();

        let accountsHtml = "";
        for (const acc of bank.accounts || []) {
          const bal = new Intl.NumberFormat("en-EU", {
            style: "currency",
            currency: acc.currency || "EUR",
          }).format(acc.balance || 0);

          const signClass = (acc.balance || 0) >= 0 ? "balance-positive" : "balance-negative";
          const syncDate = acc.last_synced ? new Date(acc.last_synced + "Z").toLocaleDateString("nl-NL") : "--";
          accountsHtml += `
            <div class="bank-account-row">
              <div class="bank-account-info">
                <div class="bank-account-name">${acc.name}</div>
                <div class="bank-account-iban">${acc.iban ? acc.iban.slice(0, 22) + "..." : acc.account_type || ""}</div>
              </div>
              <div class="bank-account-detail">
                <span class="bank-account-sync">${syncDate}</span>
                <span class="bank-account-balance ${signClass}">${bal}</span>
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
                  <div class="bank-card-sub">${bank.accounts.length} account${bank.accounts.length !== 1 ? "en" : ""} · Sinds ${created}</div>
                </div>
              </div>
              <div class="bank-card-actions">
                <div class="bank-card-total">${total}</div>
                <button class="btn btn-danger btn-sm" onclick="showDisconnectModal(${bank.id}, '${bank.bank_name}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  Ontkoppelen
                </button>
              </div>
            </div>
            <div class="bank-card-body">
              <div class="bank-card-meta">
                <span>Verbinding verloopt: ${expires}</span>
              </div>
              <div class="bank-accounts-list">
                <div class="bank-accounts-header">
                  <span>Rekeningen</span>
                  <span>Saldo</span>
                </div>
                ${accountsHtml}
              </div>
            </div>
          </div>`;
      }

      page.innerHTML = `
        <div class="page-subheader">
          <p>Beheer je aangesloten bankrekeningen.</p>
        </div>
        <input type="text" id="banksSearch" placeholder="Zoek op banknaam..." class="search-input" oninput="filterBanksList()" style="margin-bottom:16px;">
        <div class="banks-grid">${html}</div>
        <div id="disconnectOverlay" class="modal-overlay" style="display:none;" onclick="closeDisconnectModal(event)">
          <div class="modal-box" onclick="event.stopPropagation()">
            <div class="modal-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h3 id="disconnectBankName">Bank ontkoppelen?</h3>
            <p>Alle rekeninggegevens en transacties van deze bank worden verwijderd. Dit kan niet ongedaan worden gemaakt.</p>
            <div class="modal-actions">
              <button class="btn btn-outline" onclick="closeDisconnectModal()">Annuleren</button>
              <button class="btn btn-danger" id="confirmDisconnectBtn" onclick="confirmDisconnect()">
                Ja, ontkoppelen
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
  async aiSettings() {
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
  document.getElementById("disconnectBankName").textContent = `${bankName} ontkoppelen?`;
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
  btn.textContent = "Bezig...";
  try {
    const res = await fetch(`/api/auth/connections/${_disconnectId}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to disconnect");
    closeDisconnectModal();
    Pages.banks();
  } catch (e) {
    console.error("Disconnect error:", e);
    btn.disabled = false;
    btn.textContent = "Ja, ontkoppelen";
  }
}

// Navigation
function navigate(page) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");

  const titles = {
    home: "Dashboard", insights: "Insights", transactions: "Transactions",
    connect: "Connect Bank", banks: "Banks", ai: "AI", "ai-settings": "AI Settings",
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
window.addEventListener("hashchange", () => {
  const page = window.location.hash.replace("#", "") || "home";
  navigate(page);
});

// Init
document.addEventListener("DOMContentLoaded", async () => {
  await loadAiSettings();
  const page = window.location.hash.replace("#", "") || "home";
  navigate(page);
});

// Check for connection success
if (new URLSearchParams(window.location.search).get("connected") === "true") {
  window.history.replaceState({}, "", window.location.pathname);
  setTimeout(() => navigate("home"), 500);
}
