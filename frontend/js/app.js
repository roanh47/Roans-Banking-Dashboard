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
      const [banksData, connsData] = await Promise.all([
        API.get("/api/auth/banks"),
        API.get("/api/auth/connections"),
      ]);
      const banks = banksData.banks || [];
      const connections = connsData.connections || [];

      const banksHtml = banks.map((b) => {
        const id = b.bic || b.name;
        const name = b.name || b.bank_name || b.bic || "Unknown";
        const country = b.country || "";
        return `<div class="bank-item" onclick="connectBank('${id}', '${name}', '${country}')">
          <span class="bank-name">${name}</span>
          <span class="bank-country">${country}</span>
        </div>`;
      }).join("");

      const connHtml = connections.map((c) => {
        const created = new Date(c.created_at + "Z").toLocaleDateString();
        return `<div class="connection-item">
          <div class="connection-info">
            <span class="connection-name">${c.bank_name}</span>
            <span class="connection-meta">${c.account_count} account${c.account_count !== 1 ? "s" : ""} · connected ${created}</span>
          </div>
          <button class="btn btn-danger btn-sm" onclick="deleteConnection(${c.id})">Disconnect</button>
        </div>`;
      }).join("");

      page.innerHTML = `
        <div class="connect-layout">
          <div class="connect-section">
            <h2>Connect a bank</h2>
            <p>Select your bank to connect via Open Banking (PSD2).</p>
            <input type="text" id="bankSearch" placeholder="Search banks..." class="search-input"
              oninput="filterBanks()">
            <div id="bankList" class="bank-list">
              ${banks.length === 0 ? '<p class="empty-state">No banks available. Check Enable Banking config.</p>' : banksHtml}
            </div>
          </div>
          <div class="connect-section">
            <h2>Connected banks</h2>
            <div id="connectionsList" class="connections-list">
              ${connections.length === 0 ? '<p class="empty-state">No banks connected yet.</p>' : connHtml}
            </div>
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
};

// Navigation
function navigate(page) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");

  const titles = { home: "Dashboard", insights: "Insights", transactions: "Transactions", connect: "Connect Bank" };
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

// Delete connection
async function deleteConnection(id) {
  if (!confirm("Disconnect this bank and remove its data?")) return;
  try {
    await fetch(`/api/auth/connections/${id}`, { method: "DELETE" });
    // Refresh the page
    const page = window.location.hash.replace("#", "") || "home";
    navigate(page);
  } catch (e) {
    console.error("Delete error:", e);
  }
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

// Init
document.addEventListener("DOMContentLoaded", () => {
  const page = window.location.hash.replace("#", "") || "home";
  navigate(page);
});

// Check for connection success
if (new URLSearchParams(window.location.search).get("connected") === "true") {
  window.history.replaceState({}, "", window.location.pathname);
  setTimeout(() => navigate("home"), 500);
}
