// Roan's Banking Dashboard - App Logic

const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
};

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

      // Fetch additional data for charts
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

      // Monthly bar chart
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

      // Spending category donut
      if (spending.insights?.length && document.getElementById("categoryChart")) {
        const colors = {
          food: "#ff6b6b",
          transport: "#5b9aff",
          shopping: "#6c5ce7",
          housing: "#ff9f43",
          entertainment: "#ff7675",
          health: "#74b9ff",
          transfer: "#ffa726",
          income: "#00d68f",
          other: "#8888a0",
        };
        new Chart(document.getElementById("categoryChart"), {
          type: "doughnut",
          data: {
            labels: spending.insights.map((s) => s.category.charAt(0).toUpperCase() + s.category.slice(1)),
            datasets: [
              {
                data: spending.insights.map((s) => s.total),
                backgroundColor: spending.insights.map((s) => colors[s.category] || "#8888a0"),
                borderWidth: 0,
              },
            ],
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

      // Update monthly stats
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
        .map(
          (m) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
          <span>${m.merchant}</span>
          <span style="font-weight:600;color:var(--red);">-€${m.total.toLocaleString()}</span>
        </div>`
        )
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

      // Category donut
      if (spending.insights?.length) {
        const colors = {
          food: "#ff6b6b", transport: "#5b9aff", shopping: "#6c5ce7",
          housing: "#ff9f43", entertainment: "#ff7675", health: "#74b9ff",
          transfer: "#ffa726", income: "#00d68f", other: "#8888a0",
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

      // Monthly bar chart
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

      // Category table
      const tbody = document.getElementById("categoryTableBody");
      if (spending.insights?.length && tbody) {
        const totalSpend = spending.insights.reduce((s, c) => s + c.total, 0);
        tbody.innerHTML = spending.insights
          .map(
            (s) => `
          <tr>
            <td><span class="category-badge ${s.category}">${s.category}</span></td>
            <td style="font-weight:600;">€${s.total.toLocaleString()}</td>
            <td>${s.count} transactions</td>
            <td>€${(s.total / s.count).toFixed(2)}</td>
          </tr>`
          )
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

      // Search + filter
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
};

// Disconnect modal state
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

  const titles = { home: "Dashboard", insights: "Insights", transactions: "Transactions", connect: "Connect Bank", banks: "Banks" };
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
  const btn = document.querySelector(".btn-primary");
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

// --- BankBot ---

function initBankBot() {
  const toggle = document.getElementById("bankbot-toggle");
  const chat = document.getElementById("bankbot-chat");
  const close = document.getElementById("bankbot-close");
  const input = document.getElementById("bankbot-input");
  const send = document.getElementById("bankbot-send");
  const messages = document.getElementById("bankbot-messages");
  const modelSelect = document.getElementById("bankbot-model");

  // Load models
  API.get("/api/chat/models").then((data) => {
    if (data.models?.length) {
      modelSelect.innerHTML = data.models
        .map((m) => `<option value="${m}">${m}</option>`)
        .join("");
    } else {
      modelSelect.innerHTML = '<option value="">No models</option>';
    }
  });

  toggle.onclick = () => {
    chat.classList.toggle("bankbot-hidden");
    if (!chat.classList.contains("bankbot-hidden")) input.focus();
  };
  close.onclick = () => chat.classList.add("bankbot-hidden");

  function addMessage(text, isUser) {
    const div = document.createElement("div");
    div.className = "bankbot-msg " + (isUser ? "bankbot-user" : "bankbot-bot");
    div.innerHTML = `<div class="bankbot-bubble">${text}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    addMessage(escapeHtml(msg), true);

    // Loading indicator
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "bankbot-msg bankbot-bot bankbot-loading";
    loadingDiv.innerHTML = '<div class="bankbot-bubble">Thinking</div>';
    messages.appendChild(loadingDiv);
    messages.scrollTop = messages.scrollHeight;

    const model = modelSelect.value || "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, model }),
      });
      loadingDiv.remove();
      if (!res.ok) {
        const err = await res.text();
        addMessage("Error: " + escapeHtml(err), false);
        return;
      }
      const data = await res.json();
      addMessage(escapeHtml(data.reply || "(no response)"), false);
    } catch (e) {
      loadingDiv.remove();
      addMessage("Error: " + escapeHtml(e.message), false);
    }
  }

  send.onclick = sendMessage;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// Init
document.addEventListener("DOMContentLoaded", () => {
  const page = window.location.hash.replace("#", "") || "home";
  navigate(page);
  initBankBot();
});

// Check for connection success
if (new URLSearchParams(window.location.search).get("connected") === "true") {
  window.history.replaceState({}, "", window.location.pathname);
  setTimeout(() => navigate("home"), 500);
}
