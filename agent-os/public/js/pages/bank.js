/**
 * BANQUE DE NICHES — explorateur de données façon dossiers.
 * Niveau 1 : niches (dossiers empilés de miniatures) → Niveau 2 : chaînes de la niche
 * → Niveau 3 : vidéos (miniatures) → Détail : titre, description, tags, transcript, vision.
 */
AgentOS.register("bank", {
  title: "Banque de Niches",
  async render(el) {
    const { api, esc, fmt, dateFr } = AgentOS;
    const nav = { niche: null, channel: null };
    // Touches de couleur SOBRES : teinte stable par texte (hash → hue), fonds très transparents.
    const hueOf = (s) => [...String(s || "")].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
    const tintChip = (t) => {
      const h = hueOf(t);
      return `background:hsla(${h},70%,60%,.14);border:1px solid hsla(${h},70%,62%,.45);color:hsl(${h},75%,74%)`;
    };
    const nicheAccent = (name) => `hsl(${hueOf(name)},70%,58%)`;

    // Navigation par flèche retour (pas de fil d'Ariane)
    const crumb = (s) => `
      <div class="bank-crumb">
        <button class="back-btn" data-nav="${s.channel ? "niche" : "root"}" title="Retour">←</button>
        <b>${esc(s.channel ? s.channel.title : s.niche ? s.niche.name : "")}</b>
      </div>`;

    async function renderRoot() {
      const niches = await api("/api/bank/niches");
      el.innerHTML = `<div class="card"><h2><a href="#/machines" class="back-btn" style="margin-right:10px" title="Retour aux Machines">←</a>🏦 Banque de Niches</h2>
        ${niches.length ? `<div class="grid grid-3" id="bk">${await Promise.all(
          niches.map(async (n) => {
            const s = await api("/api/bank/niches/" + n.id).catch(() => null);
            const thumbs = s ? s.topVideos.slice(0, 3).map((v) => v.thumbnail).filter(Boolean) : [];
            const ac = nicheAccent(n.name);
            return `<div class="bank-folder" data-open="${n.id}" style="border-left:3px solid ${ac}">
              <div class="bank-stack">${thumbs.map((t) => `<img src="${esc(t)}" loading="lazy">`).join("") || `<span class="ph"></span>`}</div>
              <b style="color:${ac}">${esc(n.name)}</b>
              <div class="small muted" style="margin-top:3px">${n.channels.length} chaîne(s)${(n.videos || []).length ? ` · ${n.videos.length} vidéo(s) isolée(s)` : ""}${s ? ` · <span style="color:var(--accent)">${s.videoTotal} vidéos</span> · <span style="color:#4B9FFF">${s.transcripts} transcripts</span> · <span style="color:#B266FF">${s.visions} visions</span>` : ""}</div>
            </div>`;
          })
        ).then((cards) => cards.join(""))}</div>`
        : `<div class="empty"><b>Aucune niche</b>Ajoute des chaînes depuis le <a href="#/scrap">Scrap-o-matic</a> (bouton 🏦 dans la fenêtre d'une chaîne).</div>`}
      </div>`;
      el.querySelectorAll("[data-open]").forEach((b) =>
        b.addEventListener("click", async () => {
          nav.niche = await api("/api/bank/niches/" + b.dataset.open);
          renderNiche();
        })
      );
    }

    function wireCrumb() {
      el.querySelectorAll("[data-nav]").forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          if (a.dataset.nav === "root") { nav.niche = null; nav.channel = null; renderRoot(); }
          else { nav.channel = null; renderNiche(); }
        })
      );
    }

    function renderNiche() {
      const s = nav.niche;
      el.innerHTML = `<div class="card">${crumb({ niche: s })}
        <div class="row mb" style="gap:14px;flex-wrap:wrap">
          <span class="stat" style="padding:8px 16px;border-left:3px solid var(--accent)"><span class="k">Vidéos</span><span class="v" style="font-size:18px;color:var(--accent)">${s.videoTotal}</span></span>
          <span class="stat" style="padding:8px 16px;border-left:3px solid #4B9FFF"><span class="k">Transcripts</span><span class="v" style="font-size:18px;color:#4B9FFF">${s.transcripts}</span></span>
          <span class="stat" style="padding:8px 16px;border-left:3px solid #B266FF"><span class="k">Visions</span><span class="v" style="font-size:18px;color:#B266FF">${s.visions}</span></span>
        </div>
        ${s.topTags.length ? `<div class="small" style="font-weight:700;color:var(--ink-2);margin-bottom:4px">🏷 TAGS DOMINANTS DE LA NICHE</div><div class="chips mb">${s.topTags.slice(0, 25).map((t) => `<span class="chip" style="padding:3px 9px;font-size:10px;border-radius:99px;${tintChip(t)}">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="grid grid-3">
          ${s.channels.map((c) => `<div class="bank-folder" data-chan="${c.channelId}" style="border-left:3px solid ${c.scraped ? "#4ade80" : "var(--err, #f87171)"}">
            <div class="row" style="gap:10px">
              <img class="scrap-avatar" src="/api/scrap/channel/${esc(c.channelId)}/avatar" onerror="this.outerHTML='<span class=&quot;scrap-avatar ph&quot;>▶</span>'">
              <div><b class="small">${esc(c.title)}</b>
                <div class="small muted">${fmt(c.subscribers)} abonnés · ${c.videoCount} vidéos ${c.scraped ? `<span style="color:#4ade80">🟢 scrappée</span>` : `<span style="color:var(--err)">🔴 non scrappée</span>`}</div></div>
            </div>
          </div>`).join("")}
        </div>
        ${(() => {
          const iso = s.topVideos.filter((v) => v.standalone);
          if (!iso.length) return "";
          return `<div class="small" style="font-weight:700;color:var(--ink-2);margin:16px 0 6px">🎬 VIDÉOS AJOUTÉES À L'UNITÉ (${iso.length})
            <span class="muted" style="font-weight:400">— sans que leur chaîne soit dans la niche</span></div>
          <div class="grid grid-3">
            ${iso.map((v) => `<div class="bank-folder" style="border-left:3px solid #B266FF">
              <div class="row" style="gap:10px;align-items:flex-start">
                <img src="${esc(v.thumbnail)}" style="width:84px;height:47px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex:none">
                <div style="min-width:0;flex:1">
                  <b class="small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</b>
                  <div class="small muted">${fmt(v.views)} vues${v.channelTitle ? " · " + esc(v.channelTitle) : ""}
                    ${v.hasTranscript ? ` <span style="color:#4B9FFF">📝</span>` : ""}${v.hasVision ? ` <span style="color:#B266FF">👁</span>` : ""}</div>
                  <div class="row" style="gap:6px;margin-top:5px">
                    <a class="mini-btn" href="https://youtu.be/${esc(v.videoId)}" target="_blank" rel="noopener">▶ Voir</a>
                    <button class="mini-btn" data-rmvid="${esc(v.videoId)}" title="Retirer de la niche">✕</button>
                  </div>
                </div>
              </div>
            </div>`).join("")}
          </div>`;
        })()}
        </div>`;
      wireCrumb();
      el.querySelectorAll("[data-rmvid]").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.stopPropagation();
          await api(`/api/bank/niches/${nav.niche.id}/videos/${b.dataset.rmvid}`, { method: "DELETE" });
          nav.niche = await api("/api/bank/niches/" + nav.niche.id);
          renderNiche();
        })
      );
      el.querySelectorAll("[data-chan]").forEach((b) =>
        b.addEventListener("click", async () => {
          nav.channel = { channelId: b.dataset.chan, title: nav.niche.channels.find((c) => c.channelId === b.dataset.chan).title };
          renderChannel();
        })
      );
    }

    async function renderChannel() {
      const ch = nav.channel;
      el.innerHTML = `<div class="card">${crumb({ niche: nav.niche, channel: ch })}<span class="spin"></span></div>`;
      const r = await api("/api/scrap/channel/" + ch.channelId).catch(() => null);
      const vids = (r ? r.videos : []).map((v) => ({
        id: v.videoId || v.id,
        title: v.title,
        views: Number(v.viewCount ?? v.views ?? 0),
        thumb: v.thumbnailUrl || "",
        date: v.date || "",
        description: v.description || "",
        tags: [...(v.tags || []), ...(v.hashtags || [])],
      })).sort((a, b) => b.views - a.views);
      el.innerHTML = `<div class="card">${crumb({ niche: nav.niche, channel: ch })}
        ${vids.length ? `<div class="niche-grid" style="grid-template-columns:repeat(5,1fr);gap:10px">
          ${vids.map((v, i) => `<a class="niche-card" href="#" data-vid="${i}">
            <span class="nc-thumb">${v.thumb ? `<img src="${esc(v.thumb)}" loading="lazy">` : ""}<span class="tb tb-l" style="font-size:9px">${fmt(v.views)}</span><span class="tb tb-r" style="font-size:9px">${dateFr(v.date)}</span></span>
            <span class="nc-body" style="padding:6px 8px"><span class="nc-title" style="font-size:10.5px">${esc(v.title)}</span></span>
          </a>`).join("")}
        </div>` : `<div class="empty">Chaîne pas encore scrappée — passe par le <a href="#/scrap">Scrap-o-matic</a>.</div>`}
      </div>`;
      wireCrumb();
      el.querySelectorAll("[data-vid]").forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          videoDetail(vids[Number(a.dataset.vid)]);
        })
      );
    }

    async function videoDetail(v) {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal lg"><div id="bkv"><span class="spin"></span></div></div>`;
      document.body.appendChild(overlay);
      const a = await api("/api/scrap/video/" + v.id).catch(() => null);
      overlay.querySelector("#bkv").innerHTML = `
        <div class="row between mb" style="align-items:flex-start">
          <div class="row" style="gap:12px;min-width:0">
            ${v.thumb ? `<img src="${esc(v.thumb)}" style="width:150px;border-radius:10px;flex:none">` : ""}
            <div style="min-width:0"><h2 style="margin:0;font-size:16px">${esc(v.title)}</h2>
              <div class="small muted" style="margin-top:4px">${AgentOS.fmt(v.views)} vues · ${AgentOS.dateFr(v.date)} · <a href="https://youtube.com/watch?v=${esc(v.id)}" target="_blank">▶ YouTube</a></div></div>
          </div>
          <button class="btn btn-sm btn-ghost" data-close>Fermer ✕</button>
        </div>
        ${v.tags.length ? `<div class="chips mb">${v.tags.map((t) => `<span class="chip" style="padding:3px 9px;font-size:10px;border-radius:99px;${tintChip(t)}">${esc(t)}</span>`).join("")}</div>` : ""}
        ${v.description ? `<details class="scrap-acc"><summary>📄 Description</summary><div class="scrap-acc-body small" style="white-space:pre-wrap">${esc(v.description)}</div></details>` : ""}
        ${a?.transcript ? `<details class="scrap-acc"><summary>📝 Transcript</summary><div class="scrap-acc-body"><div class="transcript-box" style="max-height:340px">${esc(a.transcript)}</div></div></details>` : ""}
        ${a?.vision ? `<details class="scrap-acc"><summary>👁 Vision Gemini</summary><div class="scrap-acc-body"><div class="transcript-box" style="max-height:340px">${esc(a.vision)}</div></div></details>` : ""}
        ${!a ? `<div class="empty small">Pas encore analysée (transcript + vision) — bouton « 👁 Analyser tout » dans le Scrap-o-matic.</div>` : ""}`;
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
    }

    renderRoot();
  },
});
