/**
 * Calendrier v2 (Pilotage) : grille mensuelle + colonne « Plannings récurrents » accolée.
 * Un événement = l'AVATAR de la chaîne avec un anneau d'état (⏳ prévu, ⚙ en cours, ✓ fait,
 * ⚠ manqué/échec) — pas de code couleur arbitraire, le logo EST l'identité.
 * Filtres = dock d'avatars : cliquer un logo l'allume/l'éteint (grisé = masqué) ; idem machines.
 * Les popups ne se ferment que par ✕ / Annuler.
 */
AgentOS.register("calendar", {
  title: "Calendrier",
  async render(el) {
    const { api, esc } = AgentOS;
    const ui = (this._ui = this._ui || { month: null, off: new Set(), offMac: new Set() });
    if (!ui.month) { const n = new Date(); ui.month = new Date(n.getFullYear(), n.getMonth(), 1); }

    const DAY_NAMES = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
    const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    const PRIVACIES = [["private", "🔒 Privée"], ["unlisted", "🔗 Non répertoriée"], ["public", "🌍 Publique"]];
    const privLabel = (v) => (PRIVACIES.find((p) => p[0] === v) || [v, v])[1];
    const MACHINE_ICONS = { timetravel: "🕰", linguistique: "🗣", musique: "🎵" };
    const STATUS = {
      planned: ["⏳ prévue", "mut", ""], running: ["⚙ en cours", "accent", "⚙"], done: ["✓ publiée", "ok", "✓"],
      failed: ["✕ échec", "err", "✕"], missed: ["⚠ manquée", "err", "!"], skipped: ["— ignorée", "mut", ""],
    };
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    function popup(html, wide) {
      const ov = document.createElement("div");
      ov.className = "pop-overlay";
      ov.innerHTML = `<div class="pop ${wide ? "wide" : ""}">${html}</div>`;
      document.body.appendChild(ov);
      const x = ov.querySelector(".x");
      if (x) x.addEventListener("click", () => ov.remove());
      return ov;
    }

    let channels = [], machines = [], data = { plans: [], events: [] };
    try { channels = await api("/api/channels"); } catch {}
    try { machines = await api("/api/machines"); } catch {}
    const chanOf = (id) => channels.find((c) => c.channelId === id);
    const chanTitle = (id) => (chanOf(id) || {}).title || "chaîne ?";
    const chanThumb = (id) => (chanOf(id) || {}).thumbnail || "";
    const machineName = (id) => (machines.find((m) => m.id === id) || {}).name || id;
    const avatar = (id, cls, extra) => {
      const th = chanThumb(id);
      return th
        ? `<img src="${esc(th)}" referrerpolicy="no-referrer" class="${cls || ""}" ${extra || ""} title="${esc(chanTitle(id))}">`
        : `<span class="${cls || ""}" ${extra || ""} style="display:inline-grid;place-items:center;background:var(--surface);border-radius:50%">${esc(chanTitle(id).slice(0, 1))}</span>`;
    };

    el.innerHTML = `
      <div class="card">
        <div class="cal-head">
          <span class="mini-seg">
            <button id="cal-prev">‹</button>
            <button id="cal-today">Aujourd'hui</button>
            <button id="cal-next">›</button>
          </span>
          <div class="cal-title" id="cal-title"></div>
          <div class="filter-dock grow" id="cal-dock"></div>
          <button class="btn btn-lg" id="cal-addonce">➕ Publication</button>
          <button class="btn btn-lg btn-ghost" id="cal-addplan">📅 Planification</button>
        </div>
      </div>
      <div class="cal-layout">
        <div class="card">
          <div class="cal-grid" id="cal-dows"></div>
          <div class="cal-grid" id="cal-grid" style="margin-top:6px"></div>
        </div>
        <div class="card cal-plans-col">
          <h2 style="margin-bottom:4px">Plannings récurrents</h2>
          <div id="cal-plans" style="display:flex;flex-direction:column;gap:8px;flex:1;overflow:auto"></div>
          <button class="btn" id="cal-addplan2" style="width:100%">📅 Nouvelle planification</button>
        </div>
      </div>`;

    async function reload() {
      try { data = await api("/api/schedule"); } catch { data = { plans: [], events: [] }; }
      renderAll();
    }
    function renderAll() { renderDock(); renderGrid(); renderPlans(); }

    // Dock de filtres : les avatars et icônes machine s'allument/s'éteignent au clic
    function renderDock() {
      el.querySelector("#cal-dock").innerHTML =
        channels.map((c) => avatar(c.channelId, `f-av ${ui.off.has(c.channelId) ? "off" : ""}`, `data-fc="${c.channelId}"`)).join("") +
        `<span class="sep"></span>` +
        machines.map((m) => `<span class="f-mac ${ui.offMac.has(m.id) ? "off" : ""}" data-fm="${esc(m.id)}" title="${esc(m.name)}">${MACHINE_ICONS[m.id] || "⚙"}</span>`).join("");
      el.querySelectorAll("[data-fc]").forEach((a) =>
        a.addEventListener("click", () => {
          ui.off.has(a.dataset.fc) ? ui.off.delete(a.dataset.fc) : ui.off.add(a.dataset.fc);
          renderAll();
        })
      );
      el.querySelectorAll("[data-fm]").forEach((a) =>
        a.addEventListener("click", () => {
          ui.offMac.has(a.dataset.fm) ? ui.offMac.delete(a.dataset.fm) : ui.offMac.add(a.dataset.fm);
          renderAll();
        })
      );
    }

    const visible = (x) => !ui.off.has(x.channelId) && !ui.offMac.has(x.machineId);

    function renderGrid() {
      const y = ui.month.getFullYear(), mo = ui.month.getMonth();
      el.querySelector("#cal-title").textContent = `${MONTHS[mo]} ${y}`;
      el.querySelector("#cal-dows").innerHTML = DAY_ORDER.map((d) => `<div class="cal-dow">${DAY_NAMES[d]}</div>`).join("");
      const first = new Date(y, mo, 1);
      const start = new Date(first);
      start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      const todayK = dayKey(new Date());
      const byDate = {};
      for (const e of data.events.filter(visible)) (byDate[e.date] = byDate[e.date] || []).push(e);

      let html = "";
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        if (i === 35 && d.getMonth() !== mo) break;
        const k = dayKey(d);
        const evs = (byDate[k] || []).sort((a, b) => a.time.localeCompare(b.time));
        const shown = evs.slice(0, 8);
        html += `
          <div class="cal-cell ${d.getMonth() !== mo ? "out" : ""} ${k === todayK ? "today" : ""}" data-day="${k}">
            <div class="cal-num"><span>${d.getDate()}</span></div>
            <div class="cal-avs">
              ${shown.map((e) => {
                const glyph = (STATUS[e.status] || ["", "", ""])[2];
                // Pas de title natif : l'infobulle custom (cal-tip) fait le survol — le title
                // de l'avatar interne écrasait celui du span et cassait l'affichage au hover.
                return `<span class="cal-av ${e.status}" data-ev="${esc(e.id)}">
                  ${avatar(e.channelId).replace(/ title="[^"]*"/, "")}
                  ${glyph ? `<span class="st">${glyph}</span>` : ""}
                </span>`;
              }).join("")}
              ${evs.length > 8 ? `<span class="cal-more">+${evs.length - 8}</span>` : ""}
            </div>
          </div>`;
      }
      const grid = el.querySelector("#cal-grid");
      grid.innerHTML = html;
      grid.querySelectorAll(".cal-cell").forEach((c) =>
        c.addEventListener("click", (ev) => {
          if (ev.target.closest(".cal-av")) return;
          oncePopup(c.dataset.day);
        })
      );
      grid.querySelectorAll(".cal-av").forEach((p) =>
        p.addEventListener("click", () => { hideTip(); eventPopup(p.dataset.ev); })
      );
      // Infobulle de survol des publications : rendue dans <body> (les cellules sont en
      // overflow:hidden, une infobulle interne serait rognée), position fixe au-dessus du logo.
      const PRIVACY = { private: "privée", unlisted: "non répertoriée", public: "publique" };
      grid.querySelectorAll(".cal-av").forEach((p) => {
        p.addEventListener("mouseenter", () => {
          const ev = data.events.find((x) => x.id === p.dataset.ev);
          if (!ev) return;
          const tip = calTip();
          tip.innerHTML = `<b>${esc(chanTitle(ev.channelId))}</b>
            <span>${esc(ev.time)} · ${(STATUS[ev.status] || [ev.status])[0]}</span>
            <span>${esc(machineName(ev.machineId))} · ${ev.destination === "stock" ? "→ stock" : "→ publication"} · ${PRIVACY[ev.privacy] || esc(ev.privacy || "")}</span>`;
          const r = p.getBoundingClientRect();
          tip.style.left = Math.min(Math.max(130, r.left + r.width / 2), window.innerWidth - 130) + "px";
          tip.style.top = r.top - 8 + "px";
          tip.classList.add("on");
        });
        p.addEventListener("mouseleave", hideTip);
      });
    }
    // Singleton dans body (survit aux re-render de la grille sans s'empiler)
    function calTip() {
      let tip = document.getElementById("cal-hover-tip");
      if (!tip) {
        tip = document.createElement("div");
        tip.id = "cal-hover-tip";
        tip.className = "cal-tip";
        document.body.appendChild(tip);
      }
      return tip;
    }
    function hideTip() { document.getElementById("cal-hover-tip")?.classList.remove("on"); }

    function renderPlans() {
      const plans = data.plans.filter(visible);
      el.querySelector("#cal-plans").innerHTML = plans
        .map(
          (p) => `
          <div class="plan-mini">
            ${avatar(p.channelId)}
            <div class="grow" style="min-width:0">
              <b>${DAY_ORDER.filter((d) => p.days.includes(d)).map((d) => DAY_NAMES[d]).join("·")}</b>
              <span class="mono" style="margin-left:6px">${esc(p.time)}</span>
              <div class="small muted">${MACHINE_ICONS[p.machineId] || "⚙"} ${esc(machineName(p.machineId))} · ${privLabel(p.privacy)}</div>
            </div>
            <label class="switch"><input type="checkbox" data-tgl="${esc(p.id)}" ${p.enabled ? "checked" : ""}><span class="track"></span></label>
            <button class="btn btn-sm btn-ghost" data-del="${esc(p.id)}">🗑</button>
          </div>`
        )
        .join("") || `<div class="empty small">Aucun planning récurrent.<br>Crée-en un : la machine créera et publiera automatiquement aux jours/heures choisis.</div>`;
      el.querySelectorAll("[data-tgl]").forEach((c) =>
        c.addEventListener("change", async () => {
          await api(`/api/schedule/plans/${c.dataset.tgl}`, { method: "PATCH", body: { enabled: c.checked } });
          reload();
        })
      );
      el.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (!confirm("Supprimer ce planning (et ses occurrences à venir) ?")) return;
          await api(`/api/schedule/plans/${b.dataset.del}`, { method: "DELETE" });
          reload();
        })
      );
    }

    // ---- Popups ----
    function channelSelect(id) {
      const usable = channels.filter((c) => c.machine);
      return `<label class="field"><span>Chaîne (machine associée requise)</span>
        <select id="${id}">${usable.map((c) => `<option value="${c.channelId}">${esc(c.title)} — ${esc(machineName(c.machine))}</option>`).join("")}</select></label>
        ${usable.length ? "" : `<p class="small muted">⚠ Aucune chaîne n'a de machine associée — va sur <a href="#/channels">Chaînes</a> d'abord.</p>`}`;
    }

    function oncePopup(date) {
      const ov = popup(`
        <h3>➕ Publication ponctuelle <span class="x">✕</span></h3>
        ${channelSelect("oc-chan")}
        <div class="row wrap">
          <label class="field grow"><span>Date</span><input id="oc-date" type="date" value="${esc(date || new Date().toISOString().slice(0, 10))}"></label>
          <label class="field grow"><span>Heure</span><input id="oc-time" type="time" value="15:00"></label>
        </div>
        <div class="row wrap">
          <label class="field grow"><span>Destination</span>
            <select id="oc-dest"><option value="publish">📤 Publier sur la chaîne</option><option value="stock">📦 Stock machine</option></select></label>
          <label class="field grow" id="oc-priv-row"><span>Confidentialité</span>
            <select id="oc-priv">${PRIVACIES.map(([k, l]) => `<option value="${k}" ${k === "private" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <p class="small muted">Réglages détaillés (dialogues, personnages…) : passe par l'onglet de la chaîne — ici la machine reprend ceux du dernier run.</p>
        <div class="pop-foot">
          <button class="btn btn-ghost" data-x>Annuler</button>
          <button class="btn btn-lg" id="oc-save">✓ Programmer</button>
        </div>`);
      ov.querySelector("#oc-dest").addEventListener("change", (e) => {
        ov.querySelector("#oc-priv-row").style.display = e.target.value === "publish" ? "" : "none";
      });
      ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
      ov.querySelector("#oc-save").addEventListener("click", async () => {
        const chId = (ov.querySelector("#oc-chan") || {}).value;
        const ch = chanOf(chId);
        if (!ch) return AgentOS.toast("Choisis une chaîne avec machine associée", "err");
        try {
          await api("/api/schedule/events", {
            method: "POST",
            body: {
              channelId: chId, machineId: ch.machine,
              date: ov.querySelector("#oc-date").value, time: ov.querySelector("#oc-time").value,
              privacy: ov.querySelector("#oc-priv").value, destination: ov.querySelector("#oc-dest").value,
            },
          });
          AgentOS.toast("Publication programmée", "ok");
          ov.remove();
          reload();
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    function planPopup() {
      const ov = popup(`
        <h3>📅 Nouvelle planification <span class="x">✕</span></h3>
        ${channelSelect("np-chan")}
        <div class="field"><span>Jours de publication</span>
          <div class="day-chips">${DAY_ORDER.map((d) => `<div class="day-chip" data-d="${d}">${DAY_NAMES[d]}</div>`).join("")}</div></div>
        <div class="row wrap">
          <label class="field grow"><span>Heure</span><input id="np-time" type="time" value="15:00"></label>
          <label class="field grow"><span>Confidentialité</span>
            <select id="np-priv">${PRIVACIES.map(([k, l]) => `<option value="${k}" ${k === "private" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <p class="small muted">Réglages détaillés (dialogues, personnages…) : passe par l'onglet de la chaîne — ici la machine reprend ceux du dernier run.</p>
        <div class="pop-foot">
          <button class="btn btn-ghost" data-x>Annuler</button>
          <button class="btn btn-lg" id="np-save">✓ Créer</button>
        </div>`);
      ov.querySelectorAll(".day-chip").forEach((d) => d.addEventListener("click", () => d.classList.toggle("on")));
      ov.querySelector("[data-x]").addEventListener("click", () => ov.remove());
      ov.querySelector("#np-save").addEventListener("click", async () => {
        const chId = (ov.querySelector("#np-chan") || {}).value;
        const ch = chanOf(chId);
        if (!ch) return AgentOS.toast("Choisis une chaîne avec machine associée", "err");
        try {
          await api("/api/schedule/plans", {
            method: "POST",
            body: {
              channelId: chId, machineId: ch.machine,
              days: [...ov.querySelectorAll(".day-chip.on")].map((d) => Number(d.dataset.d)),
              time: ov.querySelector("#np-time").value, privacy: ov.querySelector("#np-priv").value,
              destination: "publish",
            },
          });
          AgentOS.toast("Planification créée", "ok");
          ov.remove();
          reload();
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    function eventPopup(id) {
      const ev = data.events.find((e) => e.id === id);
      if (!ev) return;
      const [lbl, cls] = STATUS[ev.status] || [ev.status, "mut"];
      const machinePage = ev.machineId;
      const ov = popup(`
        <h3>${avatar(ev.channelId, "", 'style="width:26px;height:26px;border-radius:50%;vertical-align:-6px;margin-right:8px"')}
          ${esc(chanTitle(ev.channelId))} <span class="x">✕</span></h3>
        <div class="kv mb" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="stat"><div class="k">Date</div><div class="v" style="font-size:15px">${esc(ev.date)} · ${esc(ev.time)}</div></div>
          <div class="stat"><div class="k">État</div><div class="v" style="font-size:15px"><span class="badge ${cls}">${lbl}</span></div></div>
          <div class="stat"><div class="k">Machine</div><div class="v" style="font-size:15px">${MACHINE_ICONS[ev.machineId] || "⚙"} ${esc(machineName(ev.machineId))}</div></div>
          <div class="stat"><div class="k">Destination</div><div class="v" style="font-size:15px">${ev.destination === "publish" ? privLabel(ev.privacy) : "📦 stock machine"}</div></div>
        </div>
        ${ev.error ? `<p class="small" style="color:var(--err)">${esc(ev.error)}</p>` : ""}
        ${ev.planId ? `<p class="small muted">Occurrence d'un planning récurrent.</p>` : ""}
        <div class="pop-foot">
          ${ev.runId ? `<button class="btn btn-ghost" id="ev-run">⚙ Ouvrir le run</button>` : ""}
          ${["missed", "failed"].includes(ev.status) ? `<button class="btn btn-lg" id="ev-catch">⚡ Rattraper maintenant</button>` : ""}
          ${ev.status === "planned" ? `<button class="btn btn-ghost" id="ev-skip">Ignorer ce créneau</button>` : ""}
          <button class="btn btn-ghost" id="ev-del" style="color:var(--err)">🗑 Supprimer</button>
        </div>`);
      const on = (sel, fn) => { const b = ov.querySelector(sel); if (b) b.addEventListener("click", fn); };
      on("#ev-run", () => {
        sessionStorage.setItem(`${machinePage}-open-run`, ev.runId);
        location.hash = "#/" + machinePage;
        ov.remove();
      });
      on("#ev-catch", async () => {
        try {
          await api(`/api/schedule/events/${ev.id}`, { method: "PATCH", body: { action: "run" } });
          AgentOS.toast("⚡ Création lancée — suivi dans Tâches & Cron", "ok");
          ov.remove();
          setTimeout(reload, 800);
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
      on("#ev-skip", async () => {
        await api(`/api/schedule/events/${ev.id}`, { method: "PATCH", body: { status: "skipped" } });
        ov.remove();
        reload();
      });
      on("#ev-del", async () => {
        await api(`/api/schedule/events/${ev.id}`, { method: "DELETE" });
        ov.remove();
        reload();
      });
    }

    el.querySelector("#cal-prev").addEventListener("click", () => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() - 1, 1); renderGrid(); });
    el.querySelector("#cal-next").addEventListener("click", () => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + 1, 1); renderGrid(); });
    el.querySelector("#cal-today").addEventListener("click", () => { const n = new Date(); ui.month = new Date(n.getFullYear(), n.getMonth(), 1); renderGrid(); });
    el.querySelector("#cal-addplan").addEventListener("click", planPopup);
    el.querySelector("#cal-addplan2").addEventListener("click", planPopup);
    el.querySelector("#cal-addonce").addEventListener("click", () => oncePopup());

    reload();
  },
});
