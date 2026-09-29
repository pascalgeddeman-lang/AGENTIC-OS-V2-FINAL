/** Dashboard : stats YouTube (période + chaîne), dépenses API, tâches en cours. */
AgentOS.register("dashboard", {
  title: "Dashboard",
  async render(el) {
    const { api, esc, fmt, ago } = AgentOS;
    // Périodes façon YouTube Studio. Source hybride : historique Analytics + jours récents
    // alimentés par les snapshots des compteurs publics (à jour, sans le retard de 48 h).
    const PERIODS = [
      ["7d", "7 jours"],
      ["28d", "28 jours"],
      ["90d", "90 jours"],
      ["all", "All time"],
    ];
    const ui = { period: "7d", channel: "all", spendBy: "api" };

    el.innerHTML = `
      <div class="grid">
        <div class="card">
          <h2>Statistiques YouTube
            <span class="h-actions mini-seg" id="period-chips"></span>
          </h2>
          <div class="chips mb" id="channel-chips"></div>
          <div class="stat-row mb" id="stat-cards"></div>
          <div class="grid grid-2">
            <div><div class="small muted mb">Vues</div><div id="chart-views"></div></div>
            <div><div class="small muted mb">Abonnés (net)</div><div id="chart-subs"></div></div>
          </div>
          <div id="channel-detail" class="mt"></div>
        </div>
        <div class="grid grid-2">
          <div class="card">
            <h2>Dépenses API
              <span class="h-actions mini-seg">
                <button class="active" data-by="api">Par API</button>
                <button data-by="machine">Par machine</button>
              </span>
            </h2>
            <div id="spend-donut"></div>
          </div>
          <div class="card">
            <h2>Tâches en cours</h2>
            <div id="running-tasks"></div>
          </div>
        </div>
      </div>`;

    // ----- Chaînes connectées -----
    let channels = [];
    try { channels = await api("/api/channels"); } catch {}

    function renderChips() {
      const pc = el.querySelector("#period-chips");
      pc.innerHTML = PERIODS.map(
        ([k, l]) => `<button class="${ui.period === k ? "active" : ""}" data-p="${k}">${l}</button>`
      ).join("");
      pc.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => { ui.period = b.dataset.p; renderChips(); loadStats(); })
      );
      const cc = el.querySelector("#channel-chips");
      cc.innerHTML =
        `<button class="chip ${ui.channel === "all" ? "active" : ""}" data-c="all">Toutes les chaînes</button>` +
        channels
          .map(
            (c) => `<button class="chip ${ui.channel === c.channelId ? "active" : ""}" data-c="${c.channelId}">
              ${AgentOS.channelAvatar(c)}${esc(c.title)}</button>`
          )
          .join("");
      cc.querySelectorAll(".chip").forEach((b) =>
        b.addEventListener("click", () => {
          // 2e clic sur une chaîne déjà sélectionnée -> vue détaillée
          if (ui.channel === b.dataset.c && b.dataset.c !== "all") {
            location.hash = "#/channels?open=" + b.dataset.c;
            return;
          }
          ui.channel = b.dataset.c;
          renderChips();
          loadStats();
        })
      );
    }

    async function loadStats() {
      const views = el.querySelector("#chart-views");
      const subs = el.querySelector("#chart-subs");
      const cards = el.querySelector("#stat-cards");
      const detail = el.querySelector("#channel-detail");
      if (!channels.length) {
        cards.innerHTML = "";
        views.innerHTML = subs.innerHTML = "";
        detail.innerHTML = `<div class="empty"><b>Aucune chaîne connectée</b>
          Connecte une chaîne YouTube depuis la page <a href="#/settings">Paramètres</a> pour voir ses statistiques ici.</div>`;
        return;
      }
      detail.innerHTML = "";
      views.innerHTML = subs.innerHTML = `<span class="spin"></span>`;
      try {
        // refresh=1 systématique : chaque affichage prend un snapshot des compteurs publics
        // et recalcule la série → les stats sont à jour à la minute (exigence produit).
        const data = await api(`/api/stats/series?channel=${ui.channel}&period=${ui.period}&refresh=1`);
        const rows = (data.value || data).rows || [];
        const totalViews = rows.reduce((s, r) => s + r.views, 0);
        const totalSubs = rows.reduce((s, r) => s + r.subs, 0);
        cards.innerHTML = `
          <div class="stat"><div class="k">Vues · période</div><div class="v">${fmt(totalViews)}</div></div>
          <div class="stat"><div class="k">Abonnés · net</div>
            <div class="v ${totalSubs >= 0 ? "up" : "down"}">${totalSubs >= 0 ? "+" : ""}${fmt(totalSubs)}</div></div>
          <div class="stat"><div class="k">Chaîne</div><div class="v" style="font-size:15px">${
            ui.channel === "all" ? "Toutes" : esc((channels.find((c) => c.channelId === ui.channel) || {}).title || "")
          }</div></div>`;
        Charts.lineChart(views, rows, { key: "views", label: "vues" });
        Charts.lineChart(subs, rows, { key: "subs", label: "abonnés", color: "oklch(0.72 0.14 155)" });
        if (data.fetchedAt) AgentOS.noteFreshness(data.fetchedAt);
      } catch (e) {
        views.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
        subs.innerHTML = "";
        cards.innerHTML = "";
      }
    }

    // ----- Dépenses -----
    async function loadSpend() {
      const target = el.querySelector("#spend-donut");
      try {
        // real=1 : uniquement les APIs à coût réel (pas de Claude CLI ni de quota YouTube gratuit)
        const s = await api("/api/spend?real=1");
        const groups = ui.spendBy === "api" ? s.byApi : s.byMachine;
        const items = groups.map((g) => ({
          label: g.key,
          value: g.usd > 0 ? g.usd : g.units / 1000, // unités ramenées en "milliers" pour la répartition
          raw: g,
        }));
        Charts.donut(target, items);
        // Légende détaillée sous le donut
        target.insertAdjacentHTML(
          "beforeend",
          `<table class="tbl mt"><thead><tr><th>${ui.spendBy === "api" ? "API" : "Machine"}</th><th>USD (estimé)</th><th>Utilisations</th></tr></thead>
          <tbody>${groups
            .map(
              (g) => `<tr><td>${esc(g.key)}</td><td class="num">${g.usd ? "$" + g.usd.toFixed(3) : "—"}</td>
              <td class="num">${g.count}</td></tr>`
            )
            .join("") || `<tr><td colspan="3" class="muted">Aucune dépense sur 30 jours</td></tr>`}</tbody></table>`
        );
      } catch (e) {
        target.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
      }
    }
    el.querySelectorAll("[data-by]").forEach((b) =>
      b.addEventListener("click", () => {
        ui.spendBy = b.dataset.by;
        el.querySelectorAll("[data-by]").forEach((x) => x.classList.toggle("active", x === b));
        loadSpend();
      })
    );

    // ----- Tâches en cours (avancement en temps réel : état local, pas d'API externe) -----
    let taskTimer = null;
    let lastTasksHtml = null;
    async function loadTasks() {
      const target = el.querySelector("#running-tasks");
      if (!target) return clearTimeout(taskTimer);
      try {
        const t = await api("/api/tasks");
        clearTimeout(taskTimer);
        if (t.running.length) taskTimer = setTimeout(loadTasks, 3000);
        const html = !t.running.length
          ? `<div class="empty"><b>Aucune tâche en cours</b>
            Les machines publieront ici leur avancement (machine, chaîne, étape, %).</div>`
          : t.running
              .map(
                (task) => `
          <div class="mb">
            <div class="row between">
              <div><b>${esc(task.title)}</b>
                <span class="badge mut">${esc(task.machine || "—")}</span>
                <span class="badge accent">${esc(task.channel || "—")}</span></div>
              <span class="mono small">${task.progress}%</span>
            </div>
            <div class="small muted mb" style="margin-bottom:5px">${esc(task.step || "…")}</div>
            <div class="progress"><div style="width:${task.progress}%"></div></div>
          </div>`
              )
              .join("");
        // Ne réécrit le DOM que si le contenu a changé : le polling 3 s ne clignote plus
        if (html !== lastTasksHtml) {
          target.innerHTML = html;
          lastTasksHtml = html;
        }
      } catch (e) {
        target.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
        lastTasksHtml = null;
      }
    }

    this.onLeave = () => clearTimeout(taskTimer);
    renderChips();
    loadStats();
    loadSpend();
    loadTasks();
  },
});
