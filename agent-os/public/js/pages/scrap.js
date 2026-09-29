/**
 * SCRAP-O-MATIC — liste unique chaînes + vidéos.
 * - Filtres Type / Statut, panneau « En cours » (temps réel), boutons évidents
 * - Lignes scrappées nettement démarquées (bordure verte) des non scrappées
 * - Clic sur un nom -> FENÊTRE modale : stats en grand, mots-clés, accordéons
 *   (transcript / vision / titres & descriptions / toutes les vidéos / miniatures)
 */
AgentOS.register("scrap", {
  title: "Scrap-o-matic",
  async render(el) {
    const { api, esc, fmt, ago, dateFr } = AgentOS;
    let data = { channels: [], videos: [], budget: { keys: [] } };
    const view = { type: "", status: "" };
    let pollTimer = null;

    el.innerHTML = `
      <div class="grid" style="grid-template-columns: 1fr 280px; align-items:start">
        <div class="card">
          <h2>Scrap-o-matic
            <span class="h-actions scrap-budget" id="scrap-budget"></span>
          </h2>
          <div class="fbar mb">
            <span class="fbar-item"><span>Type</span>
              <span class="mini-seg" id="seg-type">
                <button class="active" data-v="">Tout</button>
                <button data-v="channel">Chaînes</button>
                <button data-v="video">Vidéos</button>
              </span></span>
            <span class="fbar-item"><span>Statut</span>
              <span class="mini-seg" id="seg-status">
                <button class="active" data-v="">Tous</button>
                <button data-v="done">Scrappés</button>
                <button data-v="new">Non scrappés</button>
              </span></span>
            <span style="margin-left:auto" class="row">
              <button class="btn btn-sm btn-accent" id="scrap-add-ch" title="Chercher une chaîne par nom / URL / @handle / ID et l'ajouter à la liste">＋ Ajouter une chaîne</button>
              <button class="btn btn-sm btn-accent" id="scrap-add-vid" title="Coller l'URL d'une vidéo YouTube précise pour l'ajouter à la liste (1 unité)">＋ Ajouter une vidéo</button>
              <a class="btn btn-sm btn-ghost" href="/api/scrap/export?table=channel-videos">⬇ CSV chaînes</a>
              <a class="btn btn-sm btn-ghost" href="/api/scrap/export?table=video-results">⬇ CSV vidéos</a>
            </span>
          </div>
          <div id="scrap-list"></div>
        </div>
        <div class="card" style="position:sticky;top:0">
          <h2>En cours</h2>
          <div id="scrap-running"></div>
        </div>
      </div>`;

    function renderBudget() {
      const b = data.budget;
      if (!b || !b.keys.length) {
        el.querySelector("#scrap-budget").innerHTML =
          `<span class="badge err">Aucune clé Apify</span> <a class="btn btn-sm btn-ghost" href="#/settings">Paramètres</a>`;
        return;
      }
      const pct = b.limit ? Math.min((b.used / b.limit) * 100, 100) : 0;
      el.querySelector("#scrap-budget").innerHTML =
        `Apify ${b.used.toFixed(2)}$/${b.limit}$ <div class="progress" style="width:110px"><div style="width:${pct}%"></div></div>
         <span class="muted">0,005 $/vidéo</span>`;
    }

    async function renderRunning() {
      let t = { running: [] };
      try { t = await api("/api/tasks"); } catch {}
      const mine = t.running.filter((x) => x.machine === "Scrap-o-matic");
      el.querySelector("#scrap-running").innerHTML = mine.length
        ? mine
            .map(
              (x) => `<div class="mb">
              <b class="small">${esc(x.title)}</b>
              <div class="small muted" style="margin:3px 0">${esc(x.step)} — <span class="mono">${x.progress}%</span></div>
              <div class="progress"><div style="width:${x.progress}%"></div></div></div>`
            )
            .join("")
        : `<div class="empty small">Aucun scraping en cours.</div>`;
      return mine.length;
    }

    async function load(silent) {
      try {
        data = await api("/api/scrap/list");
        renderBudget();
        renderList();
        const busy = await renderRunning();
        clearTimeout(pollTimer);
        if (busy || [...data.channels, ...data.videos].some((x) => x.status === "scraping")) {
          pollTimer = setTimeout(() => load(true), 3000);
        }
      } catch (e) {
        if (!silent) el.querySelector("#scrap-list").innerHTML = `<div class="empty"><b>Erreur</b>${esc(e.message)}</div>`;
      }
    }

    const STATUS = {
      new: `<span class="badge mut">non scrappé</span>`,
      scraping: `<span class="badge warn">⏳ en cours</span>`,
      done: `<span class="badge ok">✓ SCRAPPÉ</span>`,
      failed: `<span class="badge err">échec</span>`,
    };

    function rows() {
      const chans = data.channels.map((c) => ({ kind: "channel", id: c.channelId, item: c }));
      const vids = data.videos.map((v) => ({ kind: "video", id: v.videoId, item: v }));
      let all = [...chans, ...vids].sort((a, b) => new Date(b.item.addedAt) - new Date(a.item.addedAt));
      if (view.type) all = all.filter((r) => r.kind === view.type);
      if (view.status === "done") all = all.filter((r) => r.item.status === "done");
      if (view.status === "new") all = all.filter((r) => r.item.status !== "done");
      return all;
    }

    function renderList() {
      const list = rows();
      const box = el.querySelector("#scrap-list");
      if (!list.length) {
        box.innerHTML = `<div class="empty"><b>Rien ici</b>Ajoute des chaînes ou vidéos depuis le
          <a href="#/niche">Niche Finder</a> (bouton ＋ sur les miniatures)${view.type || view.status ? " — ou élargis les filtres." : "."}</div>`;
        return;
      }
      box.innerHTML = list
        .map(({ kind, id, item }) => {
          const key = kind + ":" + id;
          const isCh = kind === "channel";
          const stat = isCh
            ? `<b class="row-stat">${fmt(item.subscribers)}</b> abonnés${item.longVideos != null ? ` · <b class="row-stat">${fmt(item.longVideos)}</b> vidéos longues` : item.totalVideos != null ? ` · <b class="row-stat">${fmt(item.totalVideos)}</b> vidéos` : ""}${item.videoCount != null ? ` · ${item.videoCount} scrappées` : ""}`
            : `<b class="row-stat">${fmt(item.views)}</b> vues · <b class="row-stat">${fmt(item.subscribers)}</b> ab.${item.outlierScore ? ` · <b class="row-stat">⚡${item.outlierScore}×</b>` : ""}`;
          const action =
            item.status === "scraping"
              ? `<button class="btn btn-sm" disabled>⏳ En cours…</button>`
              : item.status === "done"
              ? ""
              : `<button class="btn btn-accent btn-sm" data-go="${key}">${isCh ? "🔍 Scraper" : "👁 Analyser"}</button>`;
          const visual = isCh
            ? `<img class="scrap-avatar" src="/api/scrap/channel/${esc(id)}/avatar" loading="lazy"
                onerror="this.outerHTML='<span class=&quot;scrap-avatar ph&quot;>▶</span>'">`
            : `<img class="scrap-thumb" src="${esc(item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`)}" loading="lazy">`;
          return `
          <div class="scrap-row ${item.status}" >
            <span class="badge ${isCh ? "accent" : "ok"}" style="flex:none">${isCh ? "▶ Chaîne" : "🎬 Vidéo"}</span>
            ${visual}
            <div class="grow" style="min-width:0;cursor:pointer" data-openm="${key}" title="Ouvrir les résultats">
              <b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.title)}</b>
              <span class="small muted">${stat}</span>
            </div>
            ${item.fromSearch ? `<span class="badge accent niche-tag" title="Recherche Niche Finder d'origine">◎ ${esc(item.fromSearch)}</span>` : ""}
            ${STATUS[item.status] || ""}
            ${item.status === "done" ? `<button class="btn btn-sm" data-openm="${key}">📂 Résultats</button>` : ""}
            ${action}
            <button class="icon-btn" data-del="${key}" title="Retirer de la liste">✕</button>
          </div>`;
        })
        .join("");

      box.querySelectorAll("[data-openm]").forEach((h) =>
        h.addEventListener("click", () => {
          const [kind, id] = h.dataset.openm.split(":");
          openModal(kind, id);
        })
      );
      box.querySelectorAll("[data-go]").forEach((b) =>
        b.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const [kind, id] = b.dataset.go.split(":");
          if (kind === "channel") return scrapeDialog(id);
          b.disabled = true;
          b.textContent = "⏳ Lancement…";
          await api(`/api/scrap/video/${id}/scrape`, { method: "POST" });
          AgentOS.toast("Analyse de la vidéo lancée 👁", "ok");
          load(true);
        })
      );
      box.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const [kind, id] = b.dataset.del.split(":");
          await api(`/api/scrap/${kind}/${id}`, { method: "DELETE" });
          load(true);
        })
      );
    }

    // ---------- Dialogue de scraping : choix du nombre de vidéos ----------
    async function scrapeDialog(channelId) {
      const c = data.channels.find((x) => x.channelId === channelId);
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal" style="width:min(460px,92vw)">
        <div class="row between mb"><h2 style="margin:0;font-size:15px">🔍 Scraper « ${esc(c.title)} »</h2>
          <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
        <div class="stat mb" style="text-align:center;padding:12px" id="sd-total-box">
          <div class="k">Vidéos longues sur la chaîne</div>
          <div class="v" id="sd-total" style="font-size:30px"><span class="spin"></span></div>
          <div class="small muted" id="sd-total-sub">les Shorts ne sont jamais scrapés</div>
        </div>
        <label class="field"><span>Nombre de vidéos à scraper</span>
          <input type="number" id="sd-count" value="10" min="1" max="1000"></label>
        <div class="chips mb" id="sd-presets">
          ${[10, 25, 50, 100].map((n) => `<button class="chip" data-n="${n}">${n}</button>`).join("")}
          <button class="chip" data-n="all">Tout</button>
        </div>
        <div class="small mb" id="sd-cost"></div>
        <button class="btn btn-accent" id="sd-go" style="width:100%">🔍 Lancer le scraping</button>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());

      let total = c.longVideos != null ? c.longVideos : c.totalVideos || null;
      const countInput = overlay.querySelector("#sd-count");
      const costLine = () => {
        const n = Math.min(Math.max(Number(countInput.value) || 1, 1), 1000);
        overlay.querySelector("#sd-cost").innerHTML =
          `Coût estimé : <b class="mono">${(n * 0.005).toFixed(3)} $</b> <span class="muted">(0,005 $ × ${n} vidéos)</span>`;
      };
      countInput.addEventListener("input", costLine);
      costLine();

      // Nb de vidéos longues (2 unités YouTube, mis en cache)
      api(`/api/scrap/channel/${channelId}/info`)
        .then((info) => {
          total = info.longVideos != null ? info.longVideos : info.totalVideos;
          overlay.querySelector("#sd-total").textContent = fmt(total);
          if (info.longVideos != null && info.totalVideos != null) {
            overlay.querySelector("#sd-total-sub").textContent =
              `sur ${fmt(info.totalVideos)} vidéos au total — les Shorts ne sont jamais scrapés`;
          }
        })
        .catch(() => (overlay.querySelector("#sd-total").textContent = "?"));

      overlay.querySelectorAll("#sd-presets .chip").forEach((b) =>
        b.addEventListener("click", () => {
          countInput.value = b.dataset.n === "all" ? Math.min(total || 1000, 1000) : b.dataset.n;
          costLine();
        })
      );
      overlay.querySelector("#sd-go").addEventListener("click", async () => {
        const n = Math.min(Math.max(Number(countInput.value) || 10, 1), 1000);
        overlay.remove();
        await api(`/api/scrap/channel/${channelId}/scrape`, {
          method: "POST",
          body: { maxResults: n },
        });
        AgentOS.toast(`Scraping lancé : ${n} vidéos longues (≈ ${(n * 0.005).toFixed(3)} $)`, "ok");
        load(true);
      });
    }

    // ---------- Ajouter une chaîne à la main (recherche / URL / @handle / ID) ----------
    async function addChannelDialog() {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal" style="width:min(540px,94vw)">
        <div class="row between mb"><h2 style="margin:0;font-size:15px">＋ Ajouter une chaîne</h2>
          <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
        <div class="small muted mb">Colle une <b>URL</b>, un <b>@handle</b> ou un <b>ID</b> de chaîne (résolution directe), ou tape un <b>nom</b> pour rechercher.</div>
        <div class="row" style="gap:8px">
          <input type="text" id="ac-q" placeholder="Nom, URL, @handle ou ID…" style="flex:1">
          <button class="btn btn-accent" id="ac-search" style="flex:none">🔍 Rechercher</button>
        </div>
        <div class="small muted" style="margin-top:6px">Par nom : ≈ 100 unités de quota YouTube. Par URL / @handle / ID : 1 unité.</div>
        <div id="ac-results" style="margin-top:12px"></div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
      const input = overlay.querySelector("#ac-q");
      const box = overlay.querySelector("#ac-results");
      const btn = overlay.querySelector("#ac-search");

      async function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        btn.disabled = true;
        btn.innerHTML = `<span class="spin"></span>`;
        box.innerHTML = `<div class="empty small"><span class="spin"></span> Recherche…</div>`;
        try {
          const list = await api("/api/scrap/search-channels?q=" + encodeURIComponent(q));
          if (!list.length) {
            box.innerHTML = `<div class="empty small">Aucune chaîne trouvée pour « ${esc(q)} ».</div>`;
            return;
          }
          box.innerHTML = list
            .map(
              (c, i) => `
              <div class="scrap-row" style="align-items:center">
                <img class="scrap-avatar" src="${esc(c.avatar)}" loading="lazy"
                  onerror="this.outerHTML='<span class=&quot;scrap-avatar ph&quot;>▶</span>'">
                <div class="grow" style="min-width:0">
                  <b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</b>
                  <span class="small muted">${fmt(c.subscribers)} abonnés${c.totalVideos ? ` · ${fmt(c.totalVideos)} vidéos` : ""}</span>
                </div>
                ${
                  c.inList
                    ? `<span class="badge ok" style="flex:none">déjà dans la liste</span>`
                    : `<button class="btn btn-accent btn-sm" data-add="${i}" style="flex:none">＋ Ajouter</button>`
                }
              </div>`
            )
            .join("");
          box.querySelectorAll("[data-add]").forEach((b) =>
            b.addEventListener("click", async () => {
              const c = list[Number(b.dataset.add)];
              b.disabled = true;
              b.textContent = "…";
              try {
                const r = await api("/api/scrap/add", {
                  method: "POST",
                  body: {
                    type: "channel",
                    item: {
                      channelId: c.channelId,
                      channelTitle: c.title,
                      subscribers: c.subscribers,
                      totalVideos: c.totalVideos,
                      avatar: c.avatar,
                    },
                  },
                });
                b.outerHTML = `<span class="badge ok" style="flex:none">✓ Ajoutée</span>`;
                AgentOS.toast(r.dup ? "Chaîne déjà dans la liste" : `« ${c.title} » ajoutée à la liste`, "ok");
                load(true);
              } catch (e) {
                b.disabled = false;
                b.textContent = "＋ Ajouter";
                AgentOS.toast(e.message, "err");
              }
            })
          );
        } catch (e) {
          box.innerHTML = `<div class="empty small"><b>Erreur</b>${esc(e.message)}</div>`;
        } finally {
          btn.disabled = false;
          btn.innerHTML = "🔍 Rechercher";
        }
      }
      btn.addEventListener("click", doSearch);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
      setTimeout(() => input.focus(), 50);
    }

    // ---------- ＋ Ajouter une vidéo ciblée (URL ou id) ----------
    function addVideoDialog() {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal" style="width:min(560px,94vw)">
        <div class="row between mb"><h2 style="margin:0;font-size:15px">＋ Ajouter une vidéo</h2>
          <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
        <div class="small muted mb">Colle l'URL d'une vidéo YouTube (watch?v=…, youtu.be/…, shorts/…) ou son id à 11 caractères. Titre, durée et chaîne sont récupérés automatiquement (1 unité).</div>
        <div class="row" style="gap:8px">
          <input type="text" id="av-url" placeholder="https://www.youtube.com/watch?v=…" style="flex:1">
          <button class="btn btn-sm btn-accent" id="av-add">＋ Ajouter</button>
        </div>
        <div class="small muted" id="av-msg" style="margin-top:8px"></div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
      const input = overlay.querySelector("#av-url");
      const btn = overlay.querySelector("#av-add");
      const doAdd = async () => {
        const u = input.value.trim();
        if (!u) return;
        btn.disabled = true; btn.textContent = "⏳";
        try {
          const r = await api("/api/scrap/add-video", { method: "POST", body: { url: u } });
          AgentOS.toast(r.dup ? "Déjà dans la liste" : `Vidéo ajoutée : ${r.title || r.videoId} 🎞`, "ok");
          overlay.remove();
          load(true);
        } catch (e) {
          overlay.querySelector("#av-msg").innerHTML = `<span style="color:var(--err)">${AgentOS.esc(e.message)}</span>`;
          btn.disabled = false; btn.textContent = "＋ Ajouter";
        }
      };
      btn.addEventListener("click", doAdd);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
      setTimeout(() => input.focus(), 50);
    }

    // ---------- Fenêtre de résultats ----------
    const accItem = (title, inner, open) => `
      <details ${open ? "open" : ""} class="scrap-acc">
        <summary>${title}</summary>
        <div class="scrap-acc-body">${inner}</div>
      </details>`;
    const tile = (k, val) => `<div class="stat big-tile"><div class="k">${k}</div><div class="v">${val}</div></div>`;
    const chips = (tags) =>
      tags && tags.length
        ? `<div class="chips mb">${tags.map((t) => `<span class="chip" style="cursor:default">${esc(t)}</span>`).join("")}</div>`
        : "";

    function openModal(kind, id) {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal lg"><button class="mini-btn scrap-modal-x" data-close title="Fermer">✕</button><div id="modal-body"><span class="spin"></span></div></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
      const body = overlay.querySelector("#modal-body");
      (kind === "video" ? videoModal(id, body) : channelModal(id, body)).catch(
        (e) => (body.innerHTML = `<div class="empty small">${esc(e.message)}</div>`)
      );
      return overlay;
    }

    async function videoModal(id, body) {
      const v = data.videos.find((x) => x.videoId === id);
      let s = null, r = null;
      try { s = await api(`/api/scrap/video/${id}/details`); } catch {}
      if (v.status === "done") {
        try { r = await api(`/api/scrap/video/${id}`); } catch {}
      }
      body.innerHTML = `
        <div class="row between mb" style="align-items:flex-start">
          <div class="row" style="gap:12px;align-items:flex-start;min-width:0">
            <img src="${esc(v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`)}"
              style="width:112px;height:63px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex:none">
            <div style="min-width:0">
              <h2 style="margin:0;font-size:16px">${esc(v.title)}</h2>
              <div class="small muted" style="margin-top:4px">
                <a href="${esc(v.url)}" target="_blank">▶ Voir la vidéo</a>
                ${v.channelId ? ` · <a href="https://youtube.com/channel/${esc(v.channelId)}" target="_blank">📺 Voir la chaîne ${esc(v.channelTitle || "")}</a>` : ""}
              </div>
              ${v.fromSearch ? `<span class="badge accent niche-tag" style="margin-top:6px;display:inline-block">◎ Niche : ${esc(v.fromSearch)}</span>` : ""}
            </div>
          </div>
          <div class="row" style="gap:6px;flex:none">
            <button class="btn btn-sm" data-bankvid title="Ajouter cette SEULE vidéo à une Banque de Niches (inspiration des Machines)">🏦 Banque</button>
            ${v.channelId ? `<button class="btn btn-sm btn-accent" data-scrapech>🔍 Scraper la chaîne</button>` : ""}
            <button class="btn btn-sm btn-ghost" data-close>Fermer ✕</button>
          </div>
        </div>
        <div class="kv mb" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
          ${tile("Vues", fmt(s ? s.views : v.views))}
          ${tile("Likes", s ? fmt(s.likes) : "—")}
          ${tile("Commentaires", s ? fmt(s.comments) : "—")}
          ${tile("Publiée le", dateFr(s ? s.publishedAt : v.publishedAt))}
          ${tile("Durée", Math.floor(v.duration / 60) + " min")}
          ${v.outlierScore ? tile("Outlier", "⚡ " + v.outlierScore + "×") : ""}
        </div>
        ${s && s.tags && s.tags.length ? `<div class="row" style="gap:10px;margin-bottom:5px"><span class="small" style="font-weight:700;color:var(--ink-2)">🏷 MOTS-CLÉS DE LA VIDÉO</span><button class="mini-btn" data-copytags="${esc(s.tags.join(", "))}">📋 Copier</button></div>${chips(s.tags)}` : ""}
        ${r && r.transcript ? accItem("📝 Transcript" + (r.transcriptLang ? ` (${esc(r.transcriptLang)})` : ""), `<div class="transcript-box" style="max-height:380px">${esc(r.transcript)}</div>`) : ""}
        ${r && r.vision ? accItem("👁 Description (vision Gemini)", `<div class="transcript-box" style="max-height:380px">${esc(r.vision)}</div>`) : ""}
        ${v.status !== "done" ? `<div class="empty small">Pas encore analysée — lance 👁 Analyser depuis la liste pour obtenir transcript + vision.</div>` : ""}`;
      body.querySelector("[data-close]").addEventListener("click", () => body.closest(".picker-overlay").remove());
      body.querySelector("[data-bankvid]").addEventListener("click", () => bankDialog(id, "video"));
      const sc = body.querySelector("[data-scrapech]");
      if (sc)
        sc.addEventListener("click", async () => {
          // Ajoute la chaîne à la liste si besoin, puis ouvre le dialogue de scraping
          await api("/api/scrap/add", {
            method: "POST",
            body: {
              type: "channel",
              item: {
                channelId: v.channelId,
                channelTitle: v.channelTitle,
                subscribers: v.subscribers,
                videoId: v.videoId,
                query: v.fromSearch,
              },
            },
          });
          data = await api("/api/scrap/list");
          renderList();
          body.closest(".picker-overlay").remove();
          scrapeDialog(v.channelId);
        });
      wireCopyTags(body);
    }

    function wireCopyTags(body) {
      body.querySelectorAll("[data-copytags]").forEach((b) =>
        b.addEventListener("click", () => {
          navigator.clipboard.writeText(b.dataset.copytags);
          AgentOS.toast("Mots-clés copiés 📋", "ok");
        })
      );
    }

    async function channelModal(id, body) {
      const c = data.channels.find((x) => x.channelId === id);
      let r = null, thumbs = [];
      if (c.status === "done") {
        try { r = await api(`/api/scrap/channel/${id}`); } catch {}
        try { thumbs = await api(`/api/scrap/channel/${id}/thumbs`); } catch {}
      }
      const meta = r && r.videos[0] ? r.videos[0] : {};
      const videos = (r ? r.videos : []).map((x) => ({
        id: x.videoId || x.id,
        title: x.title,
        views: Number(x.viewCount ?? x.views ?? 0),
        likes: x.likes,
        date: String(x.date || x.publishedAt || "").slice(0, 10),
        dur: x.duration || "",
        thumb: x.thumbnailUrl,
        description: x.description || "",
      }));
      const top5 = [...videos].sort((a, b) => b.views - a.views).slice(0, 5);
      // Mots-clés agrégés des vidéos de la chaîne (tags + hashtags les plus fréquents)
      const tagCount = {};
      for (const x of r ? r.videos : []) {
        for (const t of [...(x.tags || []), ...(x.hashtags || [])]) {
          tagCount[t] = (tagCount[t] || 0) + 1;
        }
      }
      // TOUS les mots-clés de la chaîne, du plus fréquent au plus rare
      const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).map(([t]) => t);

      body.innerHTML = `
        <div class="row between mb" style="align-items:flex-start">
          <div class="row" style="gap:12px;align-items:flex-start;min-width:0">
            <img src="/api/scrap/channel/${esc(id)}/avatar" style="width:58px;height:58px;border-radius:50%;border:2px solid var(--border);flex:none;object-fit:cover"
              onerror="this.outerHTML='<span class=&quot;scrap-avatar ph&quot; style=&quot;width:58px;height:58px;font-size:22px&quot;>▶</span>'">
            <div style="min-width:0">
              <h2 style="margin:0;font-size:16px">${esc(c.title)}</h2>
              <div class="small muted" style="margin-top:4px">
                <a href="${esc(c.url)}" target="_blank">📺 Ouvrir la chaîne</a>
                ${c.lastScrapedAt ? ` · scrappée ${ago(c.lastScrapedAt)}` : ""}
              </div>
              ${c.fromSearch ? `<span class="badge accent niche-tag" style="margin-top:6px;display:inline-block">◎ Niche : ${esc(c.fromSearch)}</span>` : ""}
            </div>
          </div>
          <div class="row" style="gap:6px;flex:none">
            <button class="btn btn-sm" data-bank title="Ajouter cette chaîne à une Banque de Niches (inspiration des Machines)">🏦 Banque</button>
            ${c.status === "done" ? `<button class="btn btn-sm" data-analyzeall title="Transcript + vision Gemini de toutes les vidéos scrappées">👁 Analyser tout</button>` : ""}
            <button class="btn btn-sm btn-accent" data-rescrape title="Scraper davantage de vidéos ou actualiser les données">🔍 Scraper à nouveau</button>
            <button class="btn btn-sm btn-ghost" data-close>Fermer ✕</button>
          </div>
        </div>
        <div class="kv mb" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          ${tile("Abonnés", fmt(meta.numberOfSubscribers ?? c.subscribers))}
          ${tile("Vues totales", meta.channelTotalViews ? fmt(meta.channelTotalViews) : "—")}
          ${tile("Vidéos longues", c.longVideos != null ? fmt(c.longVideos) : "—")}
          ${tile("Vidéos au total", meta.channelTotalVideos ? fmt(meta.channelTotalVideos) : c.totalVideos != null ? fmt(c.totalVideos) : "—")}
          ${tile("Créée", meta.channelJoinedDate ? esc(String(meta.channelJoinedDate).slice(0, 10)) : "—")}
          ${tile("Vidéos scrappées", videos.length || "—")}
        </div>
        ${topTags.length ? `<div class="row" style="gap:10px;margin-bottom:5px"><span class="small" style="font-weight:700;color:var(--ink-2)">🏷 MOTS-CLÉS RÉCURRENTS DE LA CHAÎNE</span><button class="mini-btn" data-copytags="${esc(topTags.join(", "))}">📋 Copier</button></div>${chips(topTags)}` : ""}
        ${
          videos.length
            ? `<div class="small" style="font-weight:700;color:var(--ink-2);margin:10px 0 6px">🔥 TOP ${top5.length} VIDÉOS</div>
              <div class="niche-grid mb" style="grid-template-columns:repeat(5,1fr);gap:10px">
                ${top5
                  .map(
                    (t) => `<a class="niche-card" style="text-decoration:none" href="https://youtube.com/watch?v=${esc(t.id)}" target="_blank">
                    <span class="nc-thumb">${t.thumb ? `<img src="${esc(t.thumb)}" loading="lazy">` : ""}
                      <span class="tb tb-l">${fmt(t.views)} vues</span></span>
                    <span class="nc-body" style="padding:7px 9px"><span class="nc-title" style="font-size:11px">${esc(t.title)}</span></span>
                  </a>`
                  )
                  .join("")}
              </div>
              ${accItem(
                `📃 Titres (${videos.length})`,
                videos
                  .map(
                    (t) => `<div style="padding:7px 0;border-bottom:1px solid var(--border-soft)">
                    <a href="https://youtube.com/watch?v=${esc(t.id)}" target="_blank" style="text-decoration:none"><b class="small">${esc(t.title)}</b></a>
                    <span class="small muted mono"> · ${fmt(t.views)} vues · ${dateFr(t.date)}</span>
                  </div>`
                  )
                  .join("")
              )}
              ${accItem(
                `📄 Descriptions (${videos.filter((t) => t.description).length})`,
                videos
                  .map(
                    (t) => `<div style="padding:9px 0;border-bottom:1px solid var(--border-soft)">
                    <a href="https://youtube.com/watch?v=${esc(t.id)}" target="_blank" style="text-decoration:none"><b class="small">${esc(t.title)}</b></a>
                    ${t.description ? `<div class="small muted" style="margin-top:4px;white-space:pre-wrap">${esc(t.description)}</div>` : `<div class="small muted">(pas de description)</div>`}
                  </div>`
                  )
                  .join("")
              )}
              ${accItem(
                `📋 Toutes les vidéos scrappées (${videos.length})`,
                `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Vidéo</th><th>Vues</th><th>Likes</th><th>Durée</th><th>Date</th></tr></thead>
                <tbody>${videos
                  .map(
                    (t) => `<tr><td style="max-width:340px"><a href="https://youtube.com/watch?v=${esc(t.id)}" target="_blank" style="text-decoration:none"><b class="small">${esc(t.title)}</b></a></td>
                    <td class="num">${fmt(t.views)}</td><td class="num">${t.likes != null ? fmt(t.likes) : "—"}</td>
                    <td class="small mono muted">${esc(String(t.dur))}</td><td class="small muted">${dateFr(t.date)}</td></tr>`
                  )
                  .join("")}</tbody></table></div>`
              )}
              ${accItem(
                `🖼 Miniatures (${thumbs.length})`,
                `<div class="file-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
                  ${thumbs.map((t) => `<div class="file-card"><div class="prev"><img src="/media/${encodeURIComponent(t)}" loading="lazy"></div></div>`).join("")}
                </div>`
              )}`
            : `<div class="empty small">Pas encore scrappée — lance 🔍 Scraper depuis la liste pour récupérer vidéos, stats, descriptions et miniatures.</div>`
        }`;
      body.querySelector("[data-close]").addEventListener("click", () => body.closest(".picker-overlay").remove());
      body.querySelector("[data-rescrape]").addEventListener("click", () => {
        body.closest(".picker-overlay").remove();
        scrapeDialog(id);
      });
      body.querySelector("[data-bank]").addEventListener("click", () => bankDialog(id, "channel"));
      const an = body.querySelector("[data-analyzeall]");
      if (an)
        an.addEventListener("click", async () => {
          an.disabled = true;
          await api(`/api/scrap/channel/${id}/analyze-all`, { method: "POST" });
          AgentOS.toast("Analyse complète lancée (transcript + vision) — suivi dans « En cours » 👁", "ok");
          body.closest(".picker-overlay").remove();
          load(true);
        });
      wireCopyTags(body);
    }

    // ---------- Ajout à la Banque de Niches ----------
    /** Ajout à une niche. kind = "channel" | "video". */
    async function bankDialog(id, kind = "channel") {
      const niches = await api("/api/bank/niches");
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal" style="width:min(420px,92vw)">
        <div class="row between mb"><h2 style="margin:0;font-size:15px">🏦 Ajouter ${kind === "video" ? "cette vidéo" : "cette chaîne"} à une Banque de Niches</h2>
          <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
        ${niches.length ? `<div class="small muted mb">Niches existantes :</div>` : ""}
        ${niches.map((n) => `<button class="btn btn-sm" style="width:100%;margin-bottom:6px;justify-content:space-between;display:flex" data-pick="${n.id}"><span>🏦 ${AgentOS.esc(n.name)}</span><span class="badge accent">${n.channels.length} chaîne(s)${(n.videos || []).length ? ` · ${n.videos.length} vidéo(s)` : ""}</span></button>`).join("")}
        <div class="row" style="gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-soft)">
          <button class="icon-btn" id="bk-create" title="Créer la niche" style="flex:none;color:var(--accent);font-weight:900">＋</button>
          <input type="text" id="bk-name" placeholder="Nouvelle niche… (ex : Time Travel)" style="flex:1">
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
      const addTo = async (nicheId) => {
        if (kind === "video") {
          await api(`/api/bank/niches/${nicheId}/videos`, { method: "POST", body: { videoId: id } });
          overlay.remove();
          AgentOS.toast("Vidéo ajoutée à la banque 🏦 (visible dans Machines)", "ok");
        } else {
          await api(`/api/bank/niches/${nicheId}/channels`, { method: "POST", body: { channelId: id } });
          overlay.remove();
          AgentOS.toast("Chaîne ajoutée à la banque 🏦 (visible dans Machines)", "ok");
        }
      };
      overlay.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => addTo(b.dataset.pick)));
      overlay.querySelector("#bk-create").addEventListener("click", async () => {
        const name = overlay.querySelector("#bk-name").value.trim();
        if (!name) return;
        const n = await api("/api/bank/niches", { method: "POST", body: { name } });
        addTo(n.id);
      });
    }

    // ---------- Filtres ----------
    for (const [segId, prop] of [["seg-type", "type"], ["seg-status", "status"]]) {
      el.querySelectorAll(`#${segId} button`).forEach((b) =>
        b.addEventListener("click", () => {
          el.querySelectorAll(`#${segId} button`).forEach((x) => x.classList.toggle("active", x === b));
          view[prop] = b.dataset.v;
          renderList();
        })
      );
    }

    el.querySelector("#scrap-add-ch").addEventListener("click", addChannelDialog);
    el.querySelector("#scrap-add-vid").addEventListener("click", addVideoDialog);

    this.onLeave = () => clearTimeout(pollTimer);
    load();
  },
});
