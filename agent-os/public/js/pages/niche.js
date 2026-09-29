/** Niche Finder : vidéos qui surperforment leur chaîne — cartes avec Vues/Abonnés/Outlier en avant. */
AgentOS.register("niche", {
  title: "Niche Finder",
  async render(el) {
    const { api, esc, fmt, ago, dateFr } = AgentOS;
    let lastEntry = null;
    const view = { sort: "outlier", dir: "desc", small: false, recent: false };

    el.innerHTML = `
      <div class="grid">
        <div class="grid grid-2">
          <div class="card">
            <h2>Niche Finder</h2>
            <div class="grid grid-2">
              <label class="field"><span>Mots-clés (cumulables, virgules)</span>
                <input type="text" id="f-keywords" placeholder="ex : histoire enfant, chat animé"></label>
              <label class="field"><span>Publié après</span><input type="date" id="f-after" class="date-cal"></label>
              <label class="field"><span>Vues minimum</span><input type="number" id="f-minviews" placeholder="ex : 10 000"></label>
              <label class="field"><span>Abonnés maximum</span><input type="number" id="f-maxsubs" placeholder="ex : 50 000"></label>
              <label class="field"><span>Durée minimum (minutes)</span><input type="number" id="f-mindur" placeholder="ex : 3"></label>
              <label class="field"><span>Shorts</span><span class="small muted" style="padding:8px 0">Toujours exclus — vidéos longues uniquement</span></label>
            </div>
            <div class="row">
              <button class="btn btn-accent" id="btn-search">◎ Rechercher</button>
              <button class="btn btn-ghost" id="btn-reset">Réinitialiser</button>
              <span class="small muted" id="search-status"></span>
            </div>
          </div>
          <div class="grid">
            <div class="card">
              <h2>Quota du jour <span class="h-actions"><a href="#/settings" class="btn btn-sm btn-ghost">Clés API</a></span></h2>
              <div id="quota"></div>
            </div>
            <div class="card">
              <h2>Historique <span class="h-actions" id="hist-pager"></span></h2>
              <div id="history"></div>
            </div>
          </div>
        </div>
        <div class="card" id="results-card" style="display:none">
          <h2>Résultats <span class="h-actions small muted mono" id="results-meta"></span></h2>
          <div class="fbar mb">
            <span class="fbar-item"><span>Trier</span>
              <span class="mini-seg" id="seg-sort">
                <button class="active" data-v="outlier">Outlier</button>
                <button data-v="views">Vues</button>
                <button data-v="subs">Abonnés</button>
                <button data-v="date">Date</button>
              </span></span>
            <button class="mini-btn" id="btn-dir" title="Inverser l'ordre">↓</button>
            <label class="fbar-check"><input type="checkbox" id="chk-small"> Chaînes &lt; 10 k abonnés</label>
            <label class="fbar-check"><input type="checkbox" id="chk-recent"> Publiées &lt; 30 jours</label>
          </div>
          <div class="niche-grid" id="results"></div>
        </div>
      </div>`;

    // Mini-calendrier natif : ouvre le picker au clic n'importe où dans le champ
    const dateInput = el.querySelector("#f-after");
    dateInput.addEventListener("click", () => { try { dateInput.showPicker(); } catch {} });

    async function loadQuota() {
      const q = await api("/api/niche/quota");
      const box = el.querySelector("#quota");
      if (!q.keys.length) {
        box.innerHTML = `<div class="empty small">Aucune clé API YouTube — ajoute-les dans <a href="#/settings">Paramètres</a> (+10 000 unités/jour par clé).</div>`;
        return;
      }
      box.innerHTML =
        `<div class="quota-bar mb"><b class="mono">${fmt(q.used)}</b>/${fmt(q.limit)}
          <div class="progress"><div style="width:${Math.min((q.used / q.limit) * 100, 100)}%"></div></div>
          <b class="mono ${q.remaining < 1000 ? "down" : "up"}">${fmt(q.remaining)} rest.</b></div>` +
        q.keys
          .map(
            (k) => `<div class="quota-bar small muted">${esc(k.label)}
              <div class="progress"><div style="width:${(k.used / k.limit) * 100}%"></div></div>
              <span class="mono">${fmt(k.used)}/10k</span></div>`
          )
          .join("");
    }

    function scoreClass(s) {
      return s >= 10 ? "score-hi" : s >= 3 ? "score-mid" : "score-low";
    }

    function fmtDur(sec) {
      const m = Math.floor(sec / 60), s = sec % 60;
      return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    }

    function renderResults() {
      if (!lastEntry) return;
      let list = [...lastEntry.results];
      if (view.small) list = list.filter((r) => r.subscribers < 10000);
      if (view.recent) list = list.filter((r) => Date.now() - new Date(r.publishedAt) < 30 * 86400e3);
      const keyFn = {
        outlier: (r) => r.outlierScore,
        views: (r) => r.views,
        subs: (r) => r.subscribers,
        date: (r) => new Date(r.publishedAt).getTime(),
      }[view.sort];
      list.sort((a, b) => (view.dir === "desc" ? keyFn(b) - keyFn(a) : keyFn(a) - keyFn(b)));

      el.querySelector("#results-card").style.display = "";
      const st = lastEntry.stages;
      let meta =
        `${list.length} vidéos · ${dateFr(lastEntry.ts)}` +
        (st
          ? ` — pipeline : ${st.sampled} échantillonnées → ${st.afterMinViews} vues min → ${st.afterDuration} durée/shorts → ${st.afterMaxSubs} abonnés max`
          : "");
      if (st && st.afterDuration > 20 && st.afterMaxSubs < st.afterDuration * 0.1) {
        meta += " ⚠ le filtre « Abonnés max » élimine presque tout : augmente-le pour plus de résultats";
      }
      el.querySelector("#results-meta").textContent = meta;
      el.querySelector("#results").innerHTML = list.length
        ? list
            .map(
              (r, idx) => `<div class="niche-card">
          <a class="nc-thumb" href="https://youtube.com/watch?v=${r.videoId}" target="_blank">
            <img src="${esc(r.thumbnail)}" loading="lazy">
            <span class="tb tb-l">${fmtDur(r.duration)}</span>
            <span class="tb tb-r">${dateFr(r.publishedAt)}</span>
            <span class="add-menu" data-add="${idx}">
              <button class="add-btn" title="Ajouter au Scrap-o-matic">＋</button>
              <span class="add-drop">
                <button data-addtype="channel">▶ Chaîne</button>
                <button data-addtype="video">🎬 Vidéo</button>
              </span>
            </span>
          </a>
          <div class="nc-body">
            <div class="nc-big">
              <div class="big views"><div class="bk">Vues</div><div class="bv">${fmt(r.views)}</div></div>
              <div class="big subs"><div class="bk">Abonnés</div><div class="bv">${fmt(r.subscribers)}</div></div>
              <div class="big outlier ${scoreClass(r.outlierScore)}"><div class="bk">Outlier</div><div class="bv">${r.outlierScore >= 999 ? "999" : r.outlierScore}×</div></div>
            </div>
            <div class="nc-title"><a href="https://youtube.com/watch?v=${r.videoId}" target="_blank">${esc(r.title)}</a></div>
            <a class="small muted" href="https://youtube.com/channel/${esc(r.channelId)}" target="_blank"
              style="text-decoration:none">▶ ${esc(r.channelTitle)}</a>
          </div>
        </div>`
            )
            .join("")
        : `<div class="empty small" style="grid-column:1/-1">Aucun résultat avec ces filtres.</div>`;

      // Bouton + : ajoute la chaîne ou la vidéo au Scrap-o-matic
      el.querySelectorAll(".add-menu").forEach((menu) => {
        const r = list[Number(menu.dataset.add)];
        menu.querySelector(".add-btn").addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          el.querySelectorAll(".add-menu.open").forEach((m) => m !== menu && m.classList.remove("open"));
          menu.classList.toggle("open");
        });
        menu.querySelectorAll("[data-addtype]").forEach((b) =>
          b.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            menu.classList.remove("open");
            const resp = await api("/api/scrap/add", {
              method: "POST",
              body: { type: b.dataset.addtype, item: { ...r, query: lastEntry.query } },
            });
            AgentOS.toast(
              resp.dup
                ? "Déjà dans le Scrap-o-matic"
                : (b.dataset.addtype === "channel" ? "Chaîne ajoutée" : "Vidéo ajoutée") + " au Scrap-o-matic ✓",
              "ok"
            );
          })
        );
      });
    }

    el.querySelectorAll("#seg-sort button").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#seg-sort button").forEach((x) => x.classList.toggle("active", x === b));
        view.sort = b.dataset.v;
        renderResults();
      })
    );
    el.querySelector("#btn-dir").addEventListener("click", (e) => {
      view.dir = view.dir === "desc" ? "asc" : "desc";
      e.target.textContent = view.dir === "desc" ? "↓" : "↑";
      renderResults();
    });
    el.querySelector("#chk-small").addEventListener("change", (e) => { view.small = e.target.checked; renderResults(); });
    el.querySelector("#chk-recent").addEventListener("change", (e) => { view.recent = e.target.checked; renderResults(); });

    // Remet les filtres d'une recherche dans le formulaire
    function restoreForm(f) {
      if (!f) return;
      el.querySelector("#f-keywords").value = (f.keywords || []).join(", ");
      el.querySelector("#f-after").value = f.publishedAfter ? String(f.publishedAfter).slice(0, 10) : "";
      el.querySelector("#f-minviews").value = f.minViews || "";
      el.querySelector("#f-maxsubs").value = f.maxSubs || "";
      el.querySelector("#f-mindur").value = f.minDurationMin || "";
    }

    el.querySelector("#btn-reset").addEventListener("click", () => {
      restoreForm({ keywords: [] });
      el.querySelector("#results-card").style.display = "none";
      lastEntry = null;
    });

    let histPage = 0;
    async function loadHistory() {
      const h = await api("/api/niche/history");
      const PER = 5;
      const pages = Math.max(1, Math.ceil(h.length / PER));
      if (histPage >= pages) histPage = pages - 1;
      const slice = h.slice(histPage * PER, histPage * PER + PER);
      // Pagination compacte dans l'en-tête de la carte (aucune hauteur ajoutée)
      el.querySelector("#hist-pager").innerHTML =
        pages > 1
          ? `<button class="mini-btn" id="hist-prev" ${histPage === 0 ? "disabled" : ""}>‹</button>
             <span class="small mono muted">${histPage + 1}/${pages}</span>
             <button class="mini-btn" id="hist-next" ${histPage >= pages - 1 ? "disabled" : ""}>›</button>`
          : "";
      el.querySelector("#history").innerHTML = h.length
        ? slice
            .map(
              (x) => `<div class="row" style="padding:3px 0;gap:8px">
              <b class="small grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.query)}</b>
              <span class="small muted mono" style="flex:none">${dateFr(x.ts)}</span>
              <button class="mini-btn" data-hist="${x.id}">Revoir</button>
              <button class="mini-btn" data-histdel="${x.id}" title="Supprimer">✕</button></div>`
            )
            .join("")
        : `<div class="empty small">Aucune recherche pour l'instant.</div>`;
      el.querySelectorAll("[data-hist]").forEach((b) =>
        b.addEventListener("click", async () => {
          lastEntry = await api("/api/niche/history/" + b.dataset.hist);
          restoreForm(lastEntry.filters);
          renderResults();
          el.querySelector("#results-card").scrollIntoView({ behavior: "smooth" });
        })
      );
      el.querySelectorAll("[data-histdel]").forEach((b) =>
        b.addEventListener("click", async () => {
          await api("/api/niche/history/" + b.dataset.histdel, { method: "DELETE" });
          loadHistory();
        })
      );
      const prev = el.querySelector("#hist-prev");
      const next = el.querySelector("#hist-next");
      if (prev) prev.addEventListener("click", () => { histPage--; loadHistory(); });
      if (next) next.addEventListener("click", () => { histPage++; loadHistory(); });
    }

    let polling = null;
    el.querySelector("#btn-search").addEventListener("click", async () => {
      const keywords = el.querySelector("#f-keywords").value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!keywords.length) return AgentOS.toast("Ajoute au moins un mot-clé", "err");
      const filters = {
        keywords,
        publishedAfter: el.querySelector("#f-after").value || null,
        minViews: el.querySelector("#f-minviews").value || null,
        maxSubs: el.querySelector("#f-maxsubs").value || null,
        minDurationMin: el.querySelector("#f-mindur").value || null,
        sampleSize: 500,
      };
      const btn = el.querySelector("#btn-search");
      const st = el.querySelector("#search-status");
      btn.disabled = true;
      st.innerHTML = `<span class="spin"></span> Lancement…`;
      try {
        const job = await api("/api/niche/search", { method: "POST", body: filters });
        polling = setInterval(async () => {
          const j = await api("/api/niche/job/" + job.id);
          if (j.status === "running") {
            st.innerHTML = `<span class="spin"></span> ${esc(j.progress || "…")}`;
          } else {
            clearInterval(polling);
            btn.disabled = false;
            st.textContent = "";
            if (j.status === "done") {
              lastEntry = j.result;
              renderResults();
              el.querySelector("#results-card").scrollIntoView({ behavior: "smooth" });
              loadHistory();
            } else {
              AgentOS.toast(j.error || "Recherche échouée", "err");
            }
            loadQuota();
          }
        }, 1500);
      } catch (e) {
        btn.disabled = false;
        st.textContent = "";
        AgentOS.toast(e.message, "err");
      }
    });

    this.onLeave = () => polling && clearInterval(polling);
    loadQuota();
    loadHistory();
  },
});
