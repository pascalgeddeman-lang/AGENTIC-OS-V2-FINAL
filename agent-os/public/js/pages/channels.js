/**
 * Chaînes v2 : un onglet par chaîne, puis DEUX COLONNES — plus de sous-onglets.
 *  Colonne principale : héro (chiffres géants) → Analytics → Stock (tuiles-filtres géantes).
 *  Rail de pilotage (droite) : machine associée + GROS boutons d'action (Restock,
 *  Publication ponctuelle, Planification), dernière vidéo, plannings de la chaîne.
 * Les popups ne se ferment QUE par ✕ / Annuler (jamais au clic extérieur).
 */
AgentOS.register("channels", {
  title: "Chaînes",
  async render(el, params) {
    const { api, esc, fmt, ago } = AgentOS;
    const ui = (this._ui = this._ui || { chan: null, period: "28d", stockFilter: "stock" });

    // Avatar de chaîne : helper PARTAGÉ dans core.js (cache-buster + repli).
    const avatarImg = (ch, cls = "") => AgentOS.channelAvatar(ch, { cls });

    const PRIVACIES = [
      ["private", "🔒 Privée"],
      ["unlisted", "🔗 Non répertoriée"],
      ["public", "🌍 Publique"],
    ];
    const privLabel = (v) => (PRIVACIES.find((p) => p[0] === v) || [v, v])[1];
    const privSelect = (id, cur) =>
      `<select id="${id}">${PRIVACIES.map(([k, l]) => `<option value="${k}" ${k === (cur || "private") ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const DAY_NAMES = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
    const dtFr = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
    // Couleurs : chaque chaîne a sa teinte (hash → hue), chaque machine sa couleur fixe — fini le tout-orange
    const hueOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
    const chanColor = (id) => `oklch(0.72 0.14 ${hueOf(id)})`;
    const MACHINE_COLORS = { timetravel: "#c084fc", linguistique: "#4da3ff", musique: "#ff5d7d" };
    const machineBadge = (id) =>
      id
        ? `<span class="badge" style="background:color-mix(in oklab, ${MACHINE_COLORS[id] || "#999"} 16%, var(--surface));color:${MACHINE_COLORS[id] || "var(--ink-2)"}">⚙ ${esc(machineName(id))}</span>`
        : `<span class="badge mut">sans machine</span>`;

    function popup(html, wide) {
      const ov = document.createElement("div");
      ov.className = "pop-overlay";
      ov.innerHTML = `<div class="pop ${wide ? "wide" : ""}">${html}</div>`;
      document.body.appendChild(ov);
      // Fermeture UNIQUEMENT par ✕ ou Annuler — jamais au clic extérieur (perte de saisie)
      const x = ov.querySelector(".x");
      if (x) x.addEventListener("click", () => ov.remove());
      return ov;
    }

    el.innerHTML = `
      <div class="chan-tabs" id="ctabs"></div>
      <div id="chan-body"><div class="empty" style="border:none"><span class="spin"></span></div></div>`;

    let machines = [];
    try { machines = await api("/api/machines"); } catch {}
    const machineName = (id) => (machines.find((m) => m.id === id) || {}).name || id || "—";

    let channels = [];
    try { channels = await api("/api/channels"); } catch {}
    if (!channels.length) {
      el.innerHTML = `<div class="empty"><b>Aucune chaîne connectée</b>
        Connecte une chaîne YouTube (OAuth) depuis la page <a href="#/settings">Paramètres</a>.</div>`;
      return;
    }
    const openParam = params && params.get("open");
    if (openParam) ui.chan = openParam;
    if (!channels.find((c) => c.channelId === ui.chan)) ui.chan = channels[0].channelId;
    const current = () => channels.find((c) => c.channelId === ui.chan);

    function renderTabs() {
      el.querySelector("#ctabs").innerHTML = channels
        .map(
          (c) => `<div class="chan-tab ${c.channelId === ui.chan ? "active" : ""}" data-c="${c.channelId}" style="--ev-c:${chanColor(c.channelId)}">
            ${avatarImg(c)}
            ${esc(c.title)}
            ${machineBadge(c.machine)}
          </div>`
        )
        .join("");
      el.querySelectorAll(".chan-tab").forEach((t) =>
        t.addEventListener("click", () => { ui.chan = t.dataset.c; renderTabs(); renderChannel(); })
      );
    }

    // ---------- Mini-wizard : champs de paramètres par machine ----------
    async function orderInfo(machineId) {
      return api(`/api/machines/${machineId}/order-info`);
    }
    function paramFields(info) {
      const p = info.params || {};
      const sel = (id, list, cur) =>
        `<select id="${id}">${list.map((c) => `<option value="${c.id}" ${c.id === cur ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
      if (info.machineId === "linguistique") {
        const pres = info.characters.filter((c) => c.presenter);
        const actors = info.characters.filter((c) => !c.presenter);
        return {
          html: `
            <div class="row wrap">
              <label class="field grow"><span>Nombre de dialogues</span><input id="qp-scenes" type="number" min="1" max="100" value="${p.sceneCount || 6}"></label>
              <label class="field grow"><span>Présentateur·rice</span>${sel("qp-pres", pres.length ? pres : info.characters, p.presenterId)}</label>
            </div>
            <div class="row wrap">
              <label class="field grow"><span>Protagoniste A</span>${sel("qp-a", actors.length ? actors : info.characters, (p.protagonistIds || [])[0])}</label>
              <label class="field grow"><span>Protagoniste B</span>${sel("qp-b", actors.length ? actors : info.characters, (p.protagonistIds || [])[1])}</label>
            </div>`,
          collect: (ov) => ({
            sceneCount: Number(ov.querySelector("#qp-scenes").value) || 6,
            presenterId: ov.querySelector("#qp-pres").value,
            protagonistIds: [ov.querySelector("#qp-a").value, ov.querySelector("#qp-b").value],
          }),
        };
      }
      if (info.machineId === "timetravel") {
        const clip = Number(info.settings.clipSeconds) || 10;
        const scenes = p.durationSec ? Math.max(1, Math.round(p.durationSec / clip)) : 6;
        return {
          html: `
            <div class="row wrap">
              <label class="field grow"><span>Personnage</span>${sel("qp-char", info.characters, p.characterId)}</label>
              <label class="field grow"><span>Nombre de scènes (${clip}s/scène)</span><input id="qp-scenes" type="number" min="1" max="120" value="${scenes}"></label>
            </div>`,
          collect: (ov) => ({
            characterId: ov.querySelector("#qp-char").value,
            durationSec: (Number(ov.querySelector("#qp-scenes").value) || 6) * clip,
          }),
        };
      }
      return {
        html: `
          <div class="row wrap">
            <label class="field grow"><span>Style musical</span>${sel("qp-style", info.styles, p.styleId)}</label>
            <label class="field grow"><span>Nombre de musiques</span>
              <select id="qp-count">${[2, 4, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === (p.musicCount || 2) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div>`,
        collect: (ov) => ({
          styleId: ov.querySelector("#qp-style").value,
          musicCount: Number(ov.querySelector("#qp-count").value) || 2,
        }),
      };
    }
    function themeBlock(count) {
      return count <= 1
        ? `<label class="field"><span>Thème (vide = idée automatique)</span>
            <div class="row" style="gap:8px"><input id="qt-one" class="grow" placeholder="ex. Une journée au zoo">
            <button class="btn btn-sm" id="qt-idea" title="Trouver une idée (≈ 2-4 min)">💡</button></div></label>`
        : `<label class="field"><span>Thèmes — un par ligne (ligne vide = idée automatique)</span>
            <textarea id="qt-multi" rows="${Math.min(count, 6)}" placeholder="un thème par vidéo…"></textarea></label>
            <button class="btn btn-sm" id="qt-idea">💡 Trouver ${count} idées très différentes (≈ 2-4 min)</button>`;
    }
    function wireIdeas(ov, machineId, countGetter, extraGetter) {
      const btn = ov.querySelector("#qt-idea");
      if (!btn) return;
      btn.addEventListener("click", async () => {
        const n = countGetter();
        btn.disabled = true;
        const old = btn.innerHTML;
        btn.innerHTML = `<span class="spin"></span> Claude cherche ${n > 1 ? n + " idées" : "une idée"}…`;
        try {
          const r = await api(`/api/machines/${machineId}/ideas`, { method: "POST", body: { count: n, ...(extraGetter ? extraGetter() : {}) } });
          const texts = (r.ideas || []).map((i) => i.text || i.theme || "");
          const one = ov.querySelector("#qt-one");
          const multi = ov.querySelector("#qt-multi");
          if (one) one.value = texts[0] || "";
          if (multi) multi.value = texts.join("\n");
        } catch (e) { AgentOS.toast(e.message, "err"); }
        btn.disabled = false;
        btn.innerHTML = old;
      });
    }
    function collectThemes(ov, count) {
      const one = ov.querySelector("#qt-one");
      if (one) return [one.value.trim()];
      const lines = (ov.querySelector("#qt-multi").value || "").split("\n").map((s) => s.trim());
      return Array.from({ length: count }, (_, i) => lines[i] || "");
    }

    // ---------- Fiche chaîne (2 colonnes) ----------
    async function renderChannel() {
      const body = el.querySelector("#chan-body");
      const ch = current();
      body.innerHTML = `<div class="empty" style="border:none"><span class="spin"></span></div>`;
      let ov = null, sched = { plans: [], events: [] };
      try {
        const all = await api("/api/channels/overview", { cacheable: true });
        ov = (Array.isArray(all) ? all : []).find((o) => o.channelId === ch.channelId) || null;
      } catch {}
      try { sched = await api("/api/schedule"); } catch {}
      if (ov && ov.error) {
        body.innerHTML = `<div class="card"><div class="chan-hero">
          ${avatarImg(ch, "avatar")}
          <div class="grow"><b>${esc(ch.title)}</b><div class="small muted">${esc(ov.error)}</div></div>
          <a href="#/settings" class="btn">Reconnecter</a></div></div>`;
        return;
      }
      const lv = ov && ov.lastVideo;
      const plans = sched.plans.filter((p) => p.channelId === ch.channelId);
      // « À venir » = STRICTEMENT le futur (planifiées pas encore échues) + ce qui demande
      // l'attention (en cours, manquées à rattraper). Jamais les publications passées.
      const now = new Date();
      const upcoming = sched.events
        .filter((e) => {
          if (e.channelId !== ch.channelId) return false;
          if (["running", "missed"].includes(e.status)) return true;
          return e.status === "planned" && new Date(`${e.date}T${e.time}:00`) >= now;
        })
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
        .slice(0, 1); // seulement la PROCHAINE échéance (le détail complet vit sur le Calendrier)
      const STATUS = { planned: ["⏳", "mut"], running: ["⚙", "accent"], done: ["✓", "ok"], failed: ["✕", "err"], missed: ["⚠", "err"], skipped: ["—", "mut"] };

      body.innerHTML = `
        <div class="chan-layout v3">
          <div class="chan-main">
            <div class="card">
              <div class="chan-hero mb">
                ${avatarImg(ch, "avatar")}
                <div class="grow"><b style="font-size:20px">${esc(ch.title)}</b>
                  <div class="small muted">${ov ? `chaîne créée le ${new Date(ov.publishedAt).toLocaleDateString("fr-FR")}` : ""}</div></div>
              </div>
              ${ov ? `
              <div class="hero-stats">
                <div class="stat"><div class="k">Abonnés</div><div class="v">${fmt(ov.subscribers)}</div></div>
                <div class="stat"><div class="k">Vues totales</div><div class="v">${fmt(ov.views)}</div></div>
              </div>` : `<div class="empty small">Stats indisponibles — clique « Actualiser ».</div>`}
            </div>
            <div class="card">
              <h2>📈 Analytics
                <span class="h-actions" style="display:flex;gap:10px;align-items:center">
                  <span class="mini-seg" id="an-metric">
                    <button data-m="views" class="${ui.metric !== "subs" ? "active" : ""}">👁 Vues</button>
                    <button data-m="subs" class="${ui.metric === "subs" ? "active" : ""}">👥 Abonnés</button>
                  </span>
                  <span class="mini-seg" id="an-seg">
                    ${[["7d", "7 j"], ["28d", "28 j"], ["90d", "90 j"], ["all", "Tout"]].map(([k, l]) => `<button data-p="${k}" class="${ui.period === k ? "active" : ""}">${l}</button>`).join("")}
                  </span>
                </span>
              </h2>
              <div class="stat-row mb hero-stats" id="an-cards"></div>
              <div id="an-chart"><span class="spin"></span></div>
            </div>
          </div>
          <div class="chan-col2">
            ${lv ? `
            <div class="card">
              <h2>🎬 Dernière vidéo <span class="h-actions small muted">${ago(lv.publishedAt)}</span></h2>
              <div class="stock-row2" style="border:none;padding:0;background:transparent">
                ${lv.thumbnail ? `<img src="${esc(lv.thumbnail)}" referrerpolicy="no-referrer">` : ""}
                <div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:5px">
                  <div class="ttl" title="${esc(lv.title)}">${esc(lv.title)}</div>
                  <div class="small muted" style="font-size:10.5px">🕐 ${dtFr(lv.publishedAt)}</div>
                  <div class="row" style="gap:5px;flex-wrap:wrap">
                    <span class="badge ${lv.privacy === "public" ? "ok" : "mut"}">${privLabel(lv.privacy)}</span>
                    <span class="badge mut">👁 ${fmt(lv.views)}</span>
                    <span class="badge mut">👍 ${fmt(lv.likes)}</span>
                    <span class="badge mut">💬 ${fmt(lv.comments)}</span>
                  </div>
                  <div style="margin-top:auto"><a class="btn btn-sm btn-yt" href="${esc(lv.url)}" target="_blank">▶ Regarder</a></div>
                </div>
              </div>
            </div>` : ""}
            <div class="card">
              <h2>⚙ Pilotage</h2>
              <label class="field"><span>Machine associée</span>
                <select id="mac-sel">
                  <option value="">Aucune machine</option>
                  ${machines.map((m) => `<option value="${esc(m.id)}" ${ch.machine === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
                </select></label>
              <div class="side-actions mt">
                <button class="btn btn-lg" id="act-restock" style="background:var(--accent);border-color:transparent;color:var(--accent-ink)">🛒 Restock</button>
                <button class="btn btn-ghost" id="act-once" style="border-color:#4da3ff;color:#4da3ff">➕ Publication ponctuelle</button>
                <button class="btn btn-ghost" id="act-plan" style="border-color:#3ecf8e;color:#3ecf8e">📅 Nouvelle planification</button>
              </div>
            </div>
            <div class="card">
              <button class="btn btn-ghost btn-danger" style="width:100%" id="chan-del">Déconnecter la chaîne</button>
            </div>
          </div>
          <aside class="chan-side">
            <div class="card">
              <h2>📅 Plannings <a class="h-actions small" href="#/calendar">calendrier global →</a></h2>
              <div class="grid" style="gap:7px" id="side-plans">
                ${plans.map((p) => `
                  <div class="plan-card" style="padding:8px 11px;--ev-c:${chanColor(ch.channelId)}">
                    <b>${DAY_ORDER.filter((d) => p.days.includes(d)).map((d) => DAY_NAMES[d]).join("·")}</b>
                    <span class="mono">${esc(p.time)}</span>
                    <span class="badge mut">${privLabel(p.privacy)}</span>
                    <div class="grow"></div>
                    <label class="switch"><input type="checkbox" data-tgl="${esc(p.id)}" ${p.enabled ? "checked" : ""}><span class="track"></span></label>
                    <button class="btn btn-sm btn-ghost" data-delplan="${esc(p.id)}">🗑</button>
                  </div>`).join("") || `<div class="small muted">Aucune planification.</div>`}
              </div>
              ${upcoming.length ? `
              <div class="small muted mt mb" style="font-weight:700;text-transform:uppercase;letter-spacing:.06em">À venir</div>
              ${upcoming.map((e) => {
                const [g, cls] = STATUS[e.status] || ["·", "mut"];
                return `<div class="row small" style="gap:8px;padding:3px 0">
                  <span class="badge ${cls}" style="width:26px;text-align:center">${g}</span>
                  <span class="mono">${esc(e.date.slice(5))} ${esc(e.time)}</span>
                  <span class="muted">${e.destination === "publish" ? privLabel(e.privacy) : "📦 stock"}</span>
                </div>`;
              }).join("")}` : ""}
            </div>
            <div class="card stock-compact" id="stock-card">
              <h2>📦 Stock <span class="h-actions">${ch.machine ? machineBadge(ch.machine) : ""}</span></h2>
              <div id="stock-body"></div>
            </div>
          </aside>
        </div>`;

      // Interactions héro / rail
      body.querySelector("#mac-sel").addEventListener("change", async (e) => {
        await api(`/api/channels/${ch.channelId}/machine`, { method: "POST", body: { machine: e.target.value || null } });
        ch.machine = e.target.value || null;
        AgentOS.toast("Machine associée enregistrée", "ok");
        renderTabs();
        renderChannel();
      });
      body.querySelector("#chan-del").addEventListener("click", async () => {
        if (!confirm(`Déconnecter « ${ch.title} » de la plateforme ?`)) return;
        await api("/api/channels/" + ch.channelId, { method: "DELETE" });
        channels = channels.filter((c) => c.channelId !== ch.channelId);
        ui.chan = channels[0] && channels[0].channelId;
        renderTabs();
        if (ui.chan) renderChannel();
        else el.innerHTML = `<div class="empty"><b>Aucune chaîne connectée</b></div>`;
      });
      body.querySelector("#act-restock").addEventListener("click", () => restockPopup(ch));
      body.querySelector("#act-once").addEventListener("click", () => oncePopup(ch));
      body.querySelector("#act-plan").addEventListener("click", () => planPopup(ch));
      body.querySelectorAll("#an-seg button").forEach((b) =>
        b.addEventListener("click", () => {
          ui.period = b.dataset.p;
          body.querySelectorAll("#an-seg button").forEach((x) => x.classList.toggle("active", x === b));
          loadAnalytics();
        })
      );
      body.querySelectorAll("#an-metric button").forEach((b) =>
        b.addEventListener("click", () => {
          ui.metric = b.dataset.m;
          body.querySelectorAll("#an-metric button").forEach((x) => x.classList.toggle("active", x === b));
          loadAnalytics();
        })
      );
      body.querySelectorAll("[data-tgl]").forEach((c) =>
        c.addEventListener("change", async () => {
          await api(`/api/schedule/plans/${c.dataset.tgl}`, { method: "PATCH", body: { enabled: c.checked } });
          AgentOS.toast(c.checked ? "Planification activée" : "Planification désactivée", "ok");
        })
      );
      body.querySelectorAll("[data-delplan]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!confirm("Supprimer cette planification ?")) return;
          await api(`/api/schedule/plans/${b.dataset.delplan}`, { method: "DELETE" });
          renderChannel();
        })
      );
      loadAnalytics();
      loadStock();
    }

    // --- Analytics : UNE courbe pleine largeur, métrique commutable (Vues / Abonnés) ---
    async function loadAnalytics() {
      const ch = current();
      const chart = el.querySelector("#an-chart");
      const cards = el.querySelector("#an-cards");
      if (!chart) return;
      chart.innerHTML = `<span class="spin"></span>`;
      try {
        const data = await api(`/api/stats/series?channel=${ch.channelId}&period=${ui.period}&refresh=1`);
        const rows = (data.value || data).rows || [];
        const dv = rows.reduce((s, r) => s + r.views, 0);
        const ds = rows.reduce((s, r) => s + r.subs, 0);
        cards.innerHTML = `
          <div class="stat"><div class="k">Vues sur la période</div><div class="v up">+${fmt(dv)}</div></div>
          <div class="stat"><div class="k">Abonnés sur la période</div>
            <div class="v ${ds >= 0 ? "up" : "down"}">${ds >= 0 ? "+" : ""}${fmt(ds)}</div></div>`;
        Charts.lineChart(
          chart,
          rows,
          ui.metric === "subs"
            ? { key: "subs", label: "abonnés", color: "oklch(0.72 0.14 155)" }
            : { key: "views", label: "vues", color: "oklch(0.68 0.14 250)" }
        );
      } catch (e) {
        chart.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
      }
    }

    // --- Stock (tuiles géantes = filtres) ---
    async function loadStock() {
      const ch = current();
      const t = el.querySelector("#stock-body");
      if (!t) return;
      if (!ch.machine) {
        t.innerHTML = `<div class="empty"><b>Aucune machine associée</b>
          Choisis une machine dans le rail « Pilotage » pour voir son stock et commander des vidéos.</div>`;
        return;
      }
      t.innerHTML = `<div class="empty" style="border:none"><span class="spin"></span></div>`;
      let stock = [];
      try { stock = await api(`/api/machines/${ch.machine}/stock`); } catch (e) {
        t.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
        return;
      }
      const unposted = stock.filter((v) => !v.posted && !v.archived);
      const posted = stock.filter((v) => v.posted && !v.archived);
      const archived = stock.filter((v) => v.archived);
      const list = ui.stockFilter === "stock" ? unposted : ui.stockFilter === "posted" ? posted : ui.stockFilter === "arch" ? archived : [...unposted, ...posted];
      const tile = (k, label, count, color) =>
        `<span class="stat stock-tile ${ui.stockFilter === k ? "active" : ""}" data-sf="${k}" style="--tile-c:${color}"><span class="k">${label}</span><span class="v">${count}</span></span>`;
      // Pagination : 2 vidéos affichées, flèches en bas — le stock ne mange plus la page
      const PAGE = 2;
      const items = list.slice().reverse();
      const pages = Math.max(1, Math.ceil(items.length / PAGE));
      ui.stockPage = Math.min(ui.stockPage || 0, pages - 1);
      const pageItems = items.slice(ui.stockPage * PAGE, ui.stockPage * PAGE + PAGE);
      t.innerHTML = `
        <div class="row mb wrap" style="gap:14px">
          ${tile("stock", "📦 En stock", unposted.length, "var(--accent)")}
          ${tile("posted", "📤 Postées", posted.length, "var(--ok, #4ade80)")}
          ${tile("arch", "🗃 Archives", archived.length, "var(--muted)")}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${pageItems.map((v) => `
            <div class="stock-row2">
              ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" loading="lazy">` : `<span class="noth">🎞</span>`}
              <div class="grow" style="min-width:0;display:flex;flex-direction:column;gap:5px">
                <div class="ttl" title="${esc(v.title)}">${esc(v.title)}</div>
                <div class="small muted" style="font-size:10.5px">créée ${ago(v.createdAt)}${v.posted ? ` · <b>publiée ${ago(v.postedAt)}</b>` : ""}</div>
                <div class="row" style="gap:6px;margin-top:auto">
                  ${v.posted
                    ? `${v.videoId ? `<a class="btn btn-sm btn-yt" target="_blank" href="https://youtube.com/watch?v=${esc(v.videoId)}">▶</a>` : `<span class="badge ok">publiée</span>`}`
                    : `<button class="btn btn-sm" data-pub="${esc(v.id)}">📤 Publier ici</button>`}
                </div>
              </div>
            </div>`).join("") || `<div class="empty small">Rien dans cette vue — commande des vidéos avec « 🛒 Restock ».</div>`}
        </div>
        ${pages > 1 ? `
        <div class="row mt" style="justify-content:center;gap:12px;align-items:center">
          <button class="btn btn-sm btn-ghost" id="st-prev" ${ui.stockPage === 0 ? "disabled" : ""}>‹</button>
          <span class="small mono muted">${ui.stockPage + 1} / ${pages}</span>
          <button class="btn btn-sm btn-ghost" id="st-next" ${ui.stockPage >= pages - 1 ? "disabled" : ""}>›</button>
        </div>` : ""}`;
      const pv = t.querySelector("#st-prev"), nx = t.querySelector("#st-next");
      if (pv) pv.addEventListener("click", () => { ui.stockPage--; loadStock(); });
      if (nx) nx.addEventListener("click", () => { ui.stockPage++; loadStock(); });
      t.querySelectorAll("[data-sf]").forEach((b) =>
        b.addEventListener("click", () => { ui.stockFilter = ui.stockFilter === b.dataset.sf ? "all" : b.dataset.sf; ui.stockPage = 0; loadStock(); })
      );
      t.querySelectorAll("[data-pub]").forEach((b) =>
        b.addEventListener("click", () => publishPopup(ch, stock.find((x) => x.id === b.dataset.pub)))
      );
    }

    // ---------- Popups ----------
    function publishPopup(ch, v) {
      const ov = popup(`
        <h3>📤 Publier sur ${esc(ch.title)} <span class="x">✕</span></h3>
        ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:100%;aspect-ratio:16/9;object-fit:contain;background:#000;border-radius:10px" class="mb">` : ""}
        <label class="field"><span>Titre</span><input id="pp-title" value="${esc(v.title)}" maxlength="100"></label>
        <label class="field"><span>Description</span><textarea id="pp-desc" rows="5">${esc(v.description || "")}</textarea></label>
        <label class="field"><span>Tags (séparés par des virgules)</span><textarea id="pp-tags" rows="2">${esc((v.tags || []).join(", "))}</textarea></label>
        <label class="field"><span>Confidentialité</span>${privSelect("pp-priv", "private")}</label>
        <div class="pop-foot">
          <button class="btn btn-ghost" id="pp-cancel">Annuler</button>
          <button class="btn btn-lg" id="pp-go">📤 Publier maintenant</button>
        </div>`, true);
      ov.querySelector("#pp-cancel").addEventListener("click", () => ov.remove());
      ov.querySelector("#pp-go").addEventListener("click", async () => {
        const btn = ov.querySelector("#pp-go");
        btn.disabled = true;
        btn.innerHTML = `<span class="spin"></span> Upload en cours…`;
        try {
          const r = await api(`/api/machines/${ch.machine}/stock/${v.id}/publish`, {
            method: "POST",
            body: {
              channelId: ch.channelId,
              title: ov.querySelector("#pp-title").value.trim(),
              description: ov.querySelector("#pp-desc").value,
              tags: ov.querySelector("#pp-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
              privacyStatus: ov.querySelector("#pp-priv").value,
            },
          });
          AgentOS.toast("Vidéo publiée : " + r.url, "ok");
          ov.remove();
          loadStock();
        } catch (e) {
          AgentOS.toast(e.message, "err");
          btn.disabled = false;
          btn.textContent = "📤 Publier maintenant";
        }
      });
    }

    async function restockPopup(ch) {
      if (!ch.machine) return AgentOS.toast("Associe d'abord une machine à la chaîne", "err");
      const info = await orderInfo(ch.machine).catch(() => null);
      if (!info) return AgentOS.toast("Impossible de charger la machine", "err");
      if (!info.params)
        return AgentOS.toast("Lance d'abord un run manuel sur la machine (il sert de modèle de réglages)", "err");
      const pf = paramFields(info);
      const ov = popup(`
        <h3>🛒 Restock — <span style="color:var(--accent-hi)">${esc(info.name)}</span> <span class="x">✕</span></h3>
        <p class="small muted">Création en <b>mode auto</b>. Ajuste les paramètres, choisis ou génère les thèmes (💡), c'est parti.</p>
        <div class="row wrap">
          <label class="field grow"><span>Nombre de vidéos</span>
            <select id="rs-count">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join("")}</select></label>
          <label class="field grow"><span>Destination</span>
            <select id="rs-dest">
              <option value="stock">📦 Stock de la machine</option>
              <option value="publish">📤 Publier sur ${esc(ch.title)} dès que prêt</option>
            </select></label>
          <label class="field grow" id="rs-priv-row" style="display:none"><span>Confidentialité</span>${privSelect("rs-priv", "private")}</label>
        </div>
        ${pf.html}
        <div id="rs-themes">${themeBlock(1)}</div>
        <div class="pop-foot">
          <button class="btn btn-ghost" id="rs-cancel">Annuler</button>
          <button class="btn btn-lg" id="rs-go">🛒 Commander</button>
        </div>`, true);
      const countSel = ov.querySelector("#rs-count");
      const destSel = ov.querySelector("#rs-dest");
      const extraGetter = () =>
        info.machineId === "linguistique"
          ? { sceneCount: Number(ov.querySelector("#qp-scenes").value) || 6 }
          : info.machineId === "musique"
            ? { styleId: ov.querySelector("#qp-style").value }
            : {};
      const rewire = () => wireIdeas(ov, ch.machine, () => Number(countSel.value), extraGetter);
      countSel.addEventListener("change", () => {
        ov.querySelector("#rs-themes").innerHTML = themeBlock(Number(countSel.value));
        rewire();
      });
      destSel.addEventListener("change", () => {
        ov.querySelector("#rs-priv-row").style.display = destSel.value === "publish" ? "" : "none";
      });
      rewire();
      ov.querySelector("#rs-cancel").addEventListener("click", () => ov.remove());
      ov.querySelector("#rs-go").addEventListener("click", async () => {
        try {
          const count = Number(countSel.value);
          const r = await api(`/api/channels/${ch.channelId}/restock`, {
            method: "POST",
            body: {
              count,
              destination: destSel.value,
              privacy: ov.querySelector("#rs-priv").value,
              overrides: pf.collect(ov),
              themes: collectThemes(ov, count),
            },
          });
          AgentOS.toast(`${r.ordered} vidéo(s) commandée(s) — suivi dans Tâches & Cron et sur la page machine`, "ok");
          ov.remove();
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    async function planPopup(ch) {
      if (!ch.machine) return AgentOS.toast("Associe d'abord une machine à la chaîne", "err");
      const info = await orderInfo(ch.machine).catch(() => null);
      if (!info || !info.params) return AgentOS.toast("Lance d'abord un run manuel sur la machine (modèle de réglages)", "err");
      const pf = paramFields(info);
      const ov = popup(`
        <h3>📅 Planification — <span style="color:var(--accent-hi)">${esc(info.name)}</span> → ${esc(ch.title)} <span class="x">✕</span></h3>
        <p class="small muted">Aux jours/heure choisis, la machine crée une vidéo (mode auto, thème neuf à chaque fois) et la poste sur la chaîne.</p>
        <div class="field"><span>Jours de publication</span>
          <div class="day-chips">${DAY_ORDER.map((d) => `<div class="day-chip" data-d="${d}">${DAY_NAMES[d]}</div>`).join("")}</div></div>
        <div class="row wrap">
          <label class="field grow"><span>Heure</span><input id="pl-time" type="time" value="15:00"></label>
          <label class="field grow"><span>Confidentialité</span>${privSelect("pl-priv", "private")}</label>
        </div>
        ${pf.html}
        <div class="pop-foot">
          <button class="btn btn-ghost" id="pl-cancel">Annuler</button>
          <button class="btn btn-lg" id="pl-save">✓ Créer la planification</button>
        </div>`, true);
      ov.querySelectorAll(".day-chip").forEach((d) => d.addEventListener("click", () => d.classList.toggle("on")));
      ov.querySelector("#pl-cancel").addEventListener("click", () => ov.remove());
      ov.querySelector("#pl-save").addEventListener("click", async () => {
        try {
          await api("/api/schedule/plans", {
            method: "POST",
            body: {
              channelId: ch.channelId,
              machineId: ch.machine,
              days: [...ov.querySelectorAll(".day-chip.on")].map((d) => Number(d.dataset.d)),
              time: ov.querySelector("#pl-time").value,
              privacy: ov.querySelector("#pl-priv").value,
              destination: "publish",
              params: pf.collect(ov),
            },
          });
          AgentOS.toast("Planification créée", "ok");
          ov.remove();
          renderChannel();
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    async function oncePopup(ch) {
      if (!ch.machine) return AgentOS.toast("Associe d'abord une machine à la chaîne", "err");
      const info = await orderInfo(ch.machine).catch(() => null);
      if (!info || !info.params) return AgentOS.toast("Lance d'abord un run manuel sur la machine (modèle de réglages)", "err");
      const pf = paramFields(info);
      const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
      const ov = popup(`
        <h3>➕ Publication ponctuelle — <span style="color:var(--accent-hi)">${esc(info.name)}</span> → ${esc(ch.title)} <span class="x">✕</span></h3>
        <div class="row wrap">
          <label class="field grow"><span>Date</span><input id="on-date" type="date" value="${tomorrow}"></label>
          <label class="field grow"><span>Heure</span><input id="on-time" type="time" value="15:00"></label>
        </div>
        <div class="row wrap">
          <label class="field grow"><span>Destination</span>
            <select id="on-dest">
              <option value="publish">📤 Publier sur la chaîne</option>
              <option value="stock">📦 Garder dans le stock</option>
            </select></label>
          <label class="field grow" id="on-priv-row"><span>Confidentialité</span>${privSelect("on-priv", "private")}</label>
        </div>
        ${pf.html}
        <div class="pop-foot">
          <button class="btn btn-ghost" id="on-cancel">Annuler</button>
          <button class="btn btn-lg" id="on-save">✓ Programmer</button>
        </div>`, true);
      ov.querySelector("#on-dest").addEventListener("change", (e) => {
        ov.querySelector("#on-priv-row").style.display = e.target.value === "publish" ? "" : "none";
      });
      ov.querySelector("#on-cancel").addEventListener("click", () => ov.remove());
      ov.querySelector("#on-save").addEventListener("click", async () => {
        try {
          await api("/api/schedule/events", {
            method: "POST",
            body: {
              channelId: ch.channelId,
              machineId: ch.machine,
              date: ov.querySelector("#on-date").value,
              time: ov.querySelector("#on-time").value,
              privacy: ov.querySelector("#on-priv").value,
              destination: ov.querySelector("#on-dest").value,
              params: pf.collect(ov),
            },
          });
          AgentOS.toast("Publication programmée", "ok");
          ov.remove();
          renderChannel();
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    renderTabs();
    renderChannel();
  },
});
