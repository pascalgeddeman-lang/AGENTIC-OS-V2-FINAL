/**
 * MACHINE MUSIQUE — onglets : Générer / Style musical / Runs / Stock / Paramètres.
 * Wizard : Visuel → Musiques → Montage → Fini (les prompts Claude ne sont pas affichés).
 * Une requête Suno = 2 musiques (réglette 2 par 2) ; montage FFmpeg image + waveform + effets.
 */
AgentOS.register("musique", {
  title: "Musique",
  async render(el) {
    const { api, esc, fmt, ago } = AgentOS;
    let cfg = await api("/api/machines/musique");
    const TABS = ["gen", "style", "runs", "stock", "settings"];
    let tab = TABS.includes(localStorage.getItem("mus-tab")) ? localStorage.getItem("mus-tab") : "gen";
    let wizTimer = null;
    this.onLeave = () => clearTimeout(wizTimer);

    const LANGS = ["English", "Français", "Español", "Deutsch", "Italiano", "Português", "日本語", "한국어", "العربية", "हिन्दी", "Русский", "中文"];
    const WAVE_COLORS = ["#4B9FFF", "#3BE8FF", "#B266FF", "#FF6BD6", "#FF4B4B", "#FF9F1C", "#FFE93B", "#4ADE80", "#FFFFFF", "#111111"];

    function shell() {
      el.innerHTML = `
        <div class="card">
          <h2><a href="#/machines" class="back-btn" style="margin-right:10px" title="Retour aux Machines">←</a>🎵 Musique
            <span class="h-actions">
              <span class="mini-seg" id="mus-tabs">
                <button data-t="gen" class="${tab === "gen" ? "active" : ""}">⚙ Générer</button>
                <button data-t="style" class="${tab === "style" ? "active" : ""}">🎸 Style musical</button>
                <button data-t="runs" class="${tab === "runs" ? "active" : ""}">🎞 Runs</button>
                <button data-t="stock" class="${tab === "stock" ? "active" : ""}">📦 Stock</button>
                <button data-t="settings" class="${tab === "settings" ? "active" : ""}">🛠 Paramètres</button>
              </span>
            </span>
          </h2>
          <div id="mus-body"></div>
        </div>`;
      el.querySelectorAll("#mus-tabs button").forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.t;
          try { localStorage.setItem("mus-tab", tab); } catch {}
          shell();
        })
      );
      ({ gen: renderGen, style: renderStyle, runs: renderRuns, stock: renderStock, settings: renderSettings })[tab]();
    }

    // ═══════════ Onglet Générer ═══════════
    let mode = "semi";
    function renderGen() {
      const body = el.querySelector("#mus-body");
      const styles = cfg.styles || [];
      if (!styles.length) {
        body.innerHTML = `<div class="empty"><b>Aucun style musical défini</b>
          Va dans l'onglet <b>🎸 Style musical</b> : relie une banque de niches et dérive ton premier style (mots-clés, style Suno, visuels).</div>`;
        return;
      }
      body.innerHTML = `
        <div class="grid grid-2 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>🎸 Style musical <span class="muted">(le thème du mix en découle)</span></span>
            <select id="g-style">${styles.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Nombre de musiques : <b id="g-nlbl">4</b> <span class="muted">(2 par 2)</span></span>
            <input type="range" id="g-n" min="2" max="30" step="2" value="4" style="width:100%;height:34px"></label>
        </div>
        <div class="small muted mb" id="g-styledesc" style="padding:10px 12px;border:1px solid var(--border-soft);border-radius:10px;background:var(--bg-deep)"></div>
        <div class="fbar mb" style="padding:10px 12px;flex-wrap:wrap;gap:12px;align-items:flex-end">
          <span class="fbar-item"><span>Instrumental</span>
            <span class="mini-seg" id="g-inst"><button data-v="0">Non</button><button data-v="1" class="active">Oui</button></span></span>
          <span class="fbar-item"><span>Waveform</span>
            <span class="mini-seg" id="g-wave"><button data-v="0">Non</button><button data-v="1" class="active">Oui</button></span></span>
          <span class="field" style="margin:0" id="g-wavecolor-wrap"><span class="small">Couleur</span>
            <span class="row" id="g-wcolors" style="gap:6px;padding:6px 0">
              <button type="button" data-c="gradient" title="Dégradé teal→bleu→violet→rose (référence cyberpunk)" style="width:20px;height:20px;border-radius:50%;background:linear-gradient(90deg,#2AF08D,#2AACF0,#8A48F5,#F02A9E);border:2px solid var(--accent);outline:2px solid var(--accent);outline-offset:2px;cursor:pointer;padding:0;flex:none"></button>
              ${WAVE_COLORS.map((c) => `<button type="button" data-c="${c}" title="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,.35);cursor:pointer;padding:0;flex:none"></button>`).join("")}
            </span></span>
        </div>
        <div class="fbar mb" style="padding:10px 12px;gap:10px;align-items:flex-start">
          <span style="font-weight:600;font-size:12.5px;padding-top:5px;flex:none">Effets visuels</span>
          <span class="row grow" id="g-fx" style="gap:6px;flex-wrap:wrap;align-items:center;min-height:30px"></span>
        </div>
        <div class="fbar mb" style="padding:10px 12px;flex-wrap:wrap;gap:12px">
          <span class="fbar-item"><span>CTA abonnement</span>
            <span class="mini-seg" id="g-cta"><button data-v="0">Non</button><button data-v="1" class="active">Oui</button></span></span>
          <span class="fbar-item" id="g-ctalang-wrap"><span>Langue du CTA</span>
            <select id="g-ctalang">${LANGS.map((l) => `<option ${l === "English" ? "selected" : ""}>${l}</option>`).join("")}</select></span>
          <span class="fbar-item"><span>Mode</span>
            <span class="mini-seg" id="g-mode"><button class="active" data-v="semi">Semi-manuel</button><button data-v="auto">100 % auto</button></span></span>
        </div>
        <div class="fbar mb" style="padding:10px 12px">
          <span class="fbar-item"><span>Publication auto</span>
            <span class="mini-seg" id="g-pub"><button class="${cfg.autoPublish ? "" : "active"}" data-v="0">Non</button><button class="${cfg.autoPublish ? "active" : ""}" data-v="1">Oui</button></span></span>
          <span class="fbar-item" id="g-pubchan-wrap" style="${cfg.autoPublish ? "" : "display:none"}"><span>Chaîne</span>
            <select id="g-pubchan" style="min-width:170px"><option value="">— choisis la chaîne —</option></select> <select id="g-pubpriv" style="width:150px" title="Mode de publication automatique"><option value="private" selected>🔒 Privée</option><option value="unlisted">🔗 Non répertoriée</option><option value="public">🌍 Publique</option></select></span>
          <span id="g-cost" style="margin-left:auto;font-weight:800;font-size:17px;color:#4ade80;background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.35);border-radius:10px;padding:9px 16px;white-space:nowrap"></span>
          <button class="btn btn-accent" id="g-go" style="font-size:14px;padding:10px 22px">⚙ Générer</button>
        </div>
        <div class="small muted" style="text-align:right">Prompts → Visuel → Musiques → Montage → Packaging</div>`;

      const styleSel = body.querySelector("#g-style");
      const showDesc = () => {
        const st = styles.find((s) => s.id === styleSel.value) || styles[0];
        body.querySelector("#g-styledesc").innerHTML = st ? `<b>🎸 ${esc(st.name)}</b> — ${esc(st.desc || "pas de description")}` : "";
      };
      styleSel.addEventListener("change", showDesc);
      showDesc();

      const nSlider = body.querySelector("#g-n");
      const costLine = () => {
        const n = Number(nSlider.value) || 4;
        body.querySelector("#g-nlbl").textContent = n;
        // Juste le prix, gros — le détail vit dans l'infobulle
        const cost = (n / 2) * 0.06 + 0.06;
        const el2 = body.querySelector("#g-cost");
        el2.textContent = `≈ ${cost.toFixed(2)} $`;
        el2.title = `${n} musiques · durée estimée ${n * 3}–${n * 5} min (Suno 0,06$/requête de 2 titres + visuel + miniature)`;
      };
      nSlider.addEventListener("input", costLine);
      costLine();

      const seg = (id, cb) => body.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener("click", () => { body.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("active", x === b)); cb && cb(b.dataset.v); }));
      const activeVal = (id) => body.querySelector(`#${id} button.active`).dataset.v;
      seg("g-mode", (v) => (mode = v));
      seg("g-inst");
      seg("g-wave");
      seg("g-cta", (v) => (body.querySelector("#g-ctalang-wrap").style.display = v === "1" ? "" : "none"));

      // Effets à la carte — liste COURTE et propre (waveform et CTA ont leurs propres réglages,
      // rendus façon leçon SynthwaveMix : barres dégradées + boîte néon Remotion)
      const EFFECTS = [
        { id: "glitch", label: "⚡ Glitch régulier (effet bug cyberpunk)" },
        { id: "kenburns", label: "🔍 Zoom lent (Ken Burns)" },
      ];
      let fxSel = [];
      const renderFx = () => {
        const box = body.querySelector("#g-fx");
        const lbl = (id) => (EFFECTS.find((e) => e.id === id) || {}).label || id;
        box.innerHTML =
          fxSel.map((id) => `<span class="badge accent" style="display:inline-flex;align-items:center;gap:5px;padding:5px 8px">${lbl(id)}<button data-fxdel="${id}" style="background:none;border:none;color:inherit;cursor:pointer;padding:0;font-size:11px" title="Retirer">✕</button></span>`).join("") +
          (fxSel.length < EFFECTS.length
            ? `<select id="g-fx-add" style="font-size:12px;padding:5px 8px;max-width:210px"><option value="">＋ Ajouter un effet…</option>${EFFECTS.filter((e) => !fxSel.includes(e.id)).map((e) => `<option value="${e.id}">${e.label}</option>`).join("")}</select>`
            : "");
        box.querySelectorAll("[data-fxdel]").forEach((b) => b.addEventListener("click", () => { fxSel = fxSel.filter((x) => x !== b.dataset.fxdel); renderFx(); }));
        const add = box.querySelector("#g-fx-add");
        if (add) add.addEventListener("change", () => { if (add.value) { fxSel.push(add.value); renderFx(); } });
      };
      renderFx();

      // Couleur de la waveform : « Dégradé » (référence cyberpunk) ou une couleur unie
      let waveColor = "gradient";
      body.querySelectorAll("#g-wcolors button").forEach((b) =>
        b.addEventListener("click", () => {
          waveColor = b.dataset.c;
          body.querySelectorAll("#g-wcolors button").forEach((x) => {
            const on = x === b;
            x.style.borderColor = on ? "var(--accent)" : "rgba(255,255,255,.35)";
            x.style.outline = on ? "2px solid var(--accent)" : "none";
            x.style.outlineOffset = on ? "2px" : "0";
          });
        })
      );

      const pubChan = body.querySelector("#g-pubchan");
      const goBtn = body.querySelector("#g-go");
      const pubOn = () => activeVal("g-pub") === "1";
      const gateGo = () => (goBtn.disabled = pubOn() && !pubChan.value);
      api("/api/channels").then((chs) => {
        pubChan.innerHTML = `<option value="">— choisis la chaîne —</option>` + chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("");
        gateGo();
      }).catch(() => {});
      pubChan.addEventListener("change", gateGo);
      body.querySelectorAll("#g-pub button").forEach((b) =>
        b.addEventListener("click", async () => {
          body.querySelectorAll("#g-pub button").forEach((x) => x.classList.toggle("active", x === b));
          body.querySelector("#g-pubchan-wrap").style.display = b.dataset.v === "1" ? "" : "none";
          gateGo();
          cfg = await api("/api/machines/musique", { method: "PATCH", body: { autoPublish: b.dataset.v === "1" } });
        })
      );
      gateGo();

      body.querySelector("#g-go").addEventListener("click", async () => {
        try {
          const run = await api("/api/machines/musique/runs", {
            method: "POST",
            body: {
              styleId: styleSel.value,
              musicCount: Number(nSlider.value) || 4,
              instrumental: activeVal("g-inst") === "1",
              waveform: activeVal("g-wave") === "1",
              waveColor,
              effects: fxSel,
              cta: activeVal("g-cta") === "1",
              ctaLanguage: body.querySelector("#g-ctalang").value,
              mode,
              publishChannelId: pubOn() ? pubChan.value : null,
              publishPrivacy: (body.querySelector("#g-pubpriv") || {}).value || "private",
            },
          });
          openWizard(run.id);
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    // ═══════════ Onglet Style musical ═══════════
    async function renderStyle() {
      const body = el.querySelector("#mus-body");
      let niches = [];
      try { niches = await api("/api/bank/niches"); } catch {}
      const nicheName = (id) => (niches.find((n) => n.id === id) || {}).name || "";
      body.innerHTML = `
        <div class="small muted mb">Un style = le profil d'une chaîne musicale (genre, style Suno, visuel), construit par l'IA à partir d'une <b>banque de niches</b> : titres concurrents, tags dominants et codes visuels des miniatures scrapés servent tous à la création.</div>
        <div class="grid grid-2" id="st-list">
          ${(cfg.styles || []).map((s) => `
            <div class="char-card" style="align-items:flex-start">
              <div style="font-size:30px;flex:none">🎸</div>
              <div class="grow" style="min-width:0">
                <div class="row between"><b>${esc(s.name)}</b>
                  <button class="icon-btn" data-del="${s.id}">✕</button></div>
                ${s.nicheId ? `<span class="badge accent" style="margin:3px 0">🏦 ${esc(nicheName(s.nicheId) || "niche")}</span>` : ""}
                <div class="small" style="margin-top:4px">${esc(s.desc || "")}</div>
                <details class="small muted" style="margin-top:4px"><summary>Style Suno + visuel</summary>
                  <div class="wiz-prompt">${esc(s.sunoStyle || "")}</div>
                  <div class="wiz-prompt" style="margin-top:4px">${esc((s.visualPrompt || "").slice(0, 300))}…</div></details>
              </div>
            </div>`).join("")}
          <button class="bank-folder" id="st-add" style="display:flex;align-items:center;justify-content:center;min-height:110px;font-size:14px;font-weight:700;color:var(--accent)">＋ Ajouter un style</button>
        </div>`;
      body.querySelector("#st-add").addEventListener("click", () => {
        const overlay = document.createElement("div");
        overlay.className = "picker-overlay";
        overlay.innerHTML = `<div class="scrap-modal" style="width:min(560px,94vw)">
          <div class="row between mb"><h2 style="margin:0;font-size:15px">＋ Ajouter un style musical</h2>
            <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
          <label class="field"><span>Titre du style</span><input type="text" id="ns-name" placeholder="ex : Cyberpunk Synthwave"></label>
          <label class="field"><span>Banque de niches <span class="muted">(l'IA s'appuie sur ses titres, tags et visuels)</span></span>
            <select id="ns-niche"><option value="">— aucune —</option>${niches.map((n) => `<option value="${esc(n.id)}">🏦 ${esc(n.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Indice (optionnel)</span><input type="text" id="ns-hint" placeholder="ex : comme nos vidéos cyberpunk, tempo lent"></label>
          <button class="btn btn-accent" id="ns-create" style="width:100%">🎸 Créer le style</button>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
        overlay.querySelector("#ns-create").addEventListener("click", async () => {
          const btn = overlay.querySelector("#ns-create");
          btn.disabled = true; btn.textContent = "🧠 L'IA construit le style (titres, tags, visuels de la niche)…";
          try {
            await api("/api/machines/musique/styles/derive", { method: "POST", body: {
              name: overlay.querySelector("#ns-name").value.trim(),
              nicheId: overlay.querySelector("#ns-niche").value || null,
              hint: overlay.querySelector("#ns-hint").value.trim(),
            } });
            cfg = await api("/api/machines/musique");
            overlay.remove();
            AgentOS.toast("Style créé 🎸", "ok");
            renderStyle();
          } catch (e) {
            AgentOS.toast(e.message, "err");
            btn.disabled = false; btn.textContent = "🎸 Créer le style";
          }
        });
      });
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
        await api("/api/machines/musique/styles/" + b.dataset.del, { method: "DELETE" });
        cfg = await api("/api/machines/musique");
        renderStyle();
      }));
    }

    // ═══════════ WIZARD ═══════════
    const STEPS = [
      { key: "visual", icon: "🖼", label: "Visuel" },
      { key: "music", icon: "🎵", label: "Musiques" },
      { key: "montage", icon: "🎞", label: "Montage" },
    ];
    function stepIndex(status) {
      if (status.startsWith("prompts") || status.startsWith("visual")) return 0;
      if (status.startsWith("music")) return 1;
      if (status.startsWith("montage")) return 2;
      return 3;
    }
    function globalPct(run) {
      const n = run.pairs?.length || 1;
      const done = run.pairs ? run.pairs.filter((p) => p.audios).length : 0;
      switch (run.status) {
        case "prompts_running": return 6;
        case "visual_running": return 16;
        case "visual_ready": return 26;
        case "music_running": return 28 + Math.round((44 * done) / n);
        case "music_ready": return 74;
        case "montage_running": return 82;
        case "packaging_running": return 93;
        case "done": return 100;
        default: return 8;
      }
    }
    function openWizard(runId) {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal lg" id="wiz"><span class="spin"></span></div>`;
      document.body.appendChild(overlay);
      const tick = async () => {
        let run;
        try { run = await api("/api/machines/musique/runs/" + runId); }
        catch (e) { overlay.querySelector("#wiz").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
        const box = overlay.querySelector("#wiz");
        const sig = `${run.status}|${box.dataset.view || ""}|${run.visual ? run.visual.ts : 0}|${(run.pairs || []).map((p) => `${p.i}:${p.audios ? p.audios.map((a) => a.ts).join(".") : 0}:${p.rendering ? 1 : 0}:${p.error ? 1 : 0}`).join("|")}|${run.error ? 1 : 0}|${run.pack ? run.pack.thumbTs || 1 : 0}`;
        if (box.dataset.sig !== sig) {
          box.dataset.sig = sig;
          renderWizard(box, run, overlay);
        }
        if (!["done", "failed"].includes(run.status) && document.body.contains(overlay)) {
          clearTimeout(wizTimer);
          wizTimer = setTimeout(tick, 4000);
        }
      };
      tick();
    }
    function renderWizard(box, run, overlay) {
      const idx = stepIndex(run.status);
      const running = run.status.endsWith("_running");
      const viewIdx = box.dataset.view !== undefined && box.dataset.view !== "" ? Number(box.dataset.view) : Math.min(idx, 3);
      const gpct = globalPct(run);
      const canRegen = ["visual_ready", "music_ready", "done", "failed"].includes(run.status);
      const validateLabel = { visual_ready: "✓ Valider le visuel → Musiques", music_ready: "✓ Valider les musiques → Montage" }[run.status];
      const runMsg = {
        prompts_running: "Claude écrit les prompts (titres, styles, visuel)…",
        visual_running: "Génération du visuel…",
        music_running: "Suno compose (2 titres par requête, 3 requêtes en parallèle)…",
        montage_running: "Montage FFmpeg (concat + waveform + effets)…",
        packaging_running: "Claude prépare titre, description, tags et miniature…",
      }[run.status] || "";
      box.classList.add("wiz-modal");
      const prevScroll = box.querySelector(".wiz-scroll")?.scrollTop || 0;
      box.innerHTML = `
        <div class="wiz-head">
          <div class="wiz-gbar"><div style="width:${gpct}%"></div></div>
          <div class="row between" style="margin:10px 0 4px">
            <h2 style="margin:0;font-size:15px">🎵 ${esc(run.theme?.title || run.theme?.text || "Le thème arrive…")}
              <span class="small muted mono" style="margin-left:8px">${run.id} · ${run.mode} · ${(run.pairs || []).length * 2} musiques · ${gpct}%</span></h2>
            <span class="row" style="gap:6px">
              ${run.status !== "done" ? `<button class="btn btn-sm" data-zap-run title="⚡ Décharge : relance le run là où il s'est arrêté">⚡</button>` : ""}
              ${!["done", "failed"].includes(run.status) ? `<button class="btn btn-sm" data-cancel-run>🛑 Annuler</button>` : ""}
              <button class="btn btn-sm btn-ghost" data-close>✕</button>
            </span>
          </div>
          <div class="wiz-rail">
            ${STEPS.map((s, i) => `
              <div class="wiz-step ${i < idx ? "done" : i === idx ? "active" : ""}" data-view="${i}" style="cursor:pointer">
                <div class="wiz-dot" ${i === viewIdx ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>${i < idx ? "✓" : s.icon}</div><span>${s.label}</span>
              </div>
              ${i < STEPS.length - 1 ? `<div class="wiz-link ${i < idx ? "done" : i === idx && running ? "active" : ""}"></div>` : ""}`).join("")}
            <div class="wiz-link ${run.status === "done" ? "done" : run.status === "packaging_running" ? "active" : ""}"></div>
            <div class="wiz-step ${run.status === "done" ? "done" : ""}" data-view="3" style="cursor:pointer">
              <div class="wiz-dot" ${viewIdx === 3 ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>🏁</div><span>Fini</span>
            </div>
          </div>
          ${run.error ? `<div class="empty small" style="color:var(--err);margin:0"><b>Échec</b>${esc(run.error)} <button class="btn btn-sm" data-retry>↻ Reprendre</button></div>` : ""}
          ${running ? `<div class="small muted"><span class="spin" style="width:12px;height:12px"></span> ${runMsg}</div>` : ""}
        </div>
        <div class="wiz-scroll">
        ${(() => {
          if (viewIdx === 0) {
            const img = run.visual
              ? `<img src="/media/${encodeURIComponent(run.visual.rel)}?v=${run.visual.ts}" style="width:100%;max-width:760px;border-radius:12px;display:block;margin:0 auto">`
              : run.visualRendering || run.status === "visual_running" || run.status === "prompts_running"
              ? `<div class="empty"><span class="spin"></span> ${run.status === "prompts_running" ? "Les prompts arrivent…" : "Génération du visuel…"}</div>`
              : `<div class="empty small">Pas encore généré.</div>`;
            const regen = canRegen && run.visual
              ? `<div class="row mt" style="gap:6px;max-width:760px;margin-left:auto;margin-right:auto"><input type="text" id="wv-instr" placeholder="Observation (optionnel)…" style="flex:1;font-size:12px"><button class="btn btn-sm btn-accent" id="wv-regen">🎨 Régénérer le visuel</button></div>`
              : "";
            return img + regen;
          }
          if (viewIdx === 1) {
            if (!run.pairs || !run.pairs.length) return `<div class="empty small">Les musiques arrivent après le visuel.</div>`;
            return `<div class="grid grid-2 mt">${run.pairs.map((p) => `
              <div class="card ${p.rendering ? "ai-thinking" : ""}" style="padding:10px">
                <div class="row between"><b class="small">Paire ${p.i} ${p.audios ? '<span class="badge ok">✓</span>' : p.rendering ? '<span class="badge warn">⏳</span>' : p.error ? '<span class="badge err">✗</span>' : ""}</b>
                  <span class="small muted">${esc(p.title1)} · ${esc(p.title2)}</span></div>
                ${p.audios
                  ? p.audios.map((a) => `<div class="small" style="margin-top:5px"><b>${esc(a.title)}</b> <span class="muted">(${Math.floor(a.duration / 60)}min${String(Math.round(a.duration % 60)).padStart(2, "0")})</span>
                      <audio src="/media/${encodeURIComponent(a.rel)}?v=${a.ts}" controls style="width:100%"></audio></div>`).join("")
                  : p.rendering ? `<div class="empty small"><span class="spin"></span> Suno compose…</div>`
                  : p.error ? `<div class="empty small" style="color:var(--err)">${esc(p.error)}</div>`
                  : `<div class="empty small">En attente…</div>`}
                ${canRegen ? `<div class="row" style="gap:5px;margin-top:6px"><input type="text" data-pinstr="${p.i}" placeholder="Instructions (optionnel)…" style="flex:1;font-size:11px"><button class="mini-btn" data-pregen="${p.i}" title="Régénérer cette paire (0,06$)">↻</button></div>` : ""}
              </div>`).join("")}</div>`;
          }
          if (viewIdx === 2) {
            return run.finalRel
              ? `<video src="/media/${encodeURIComponent(run.finalRel)}" controls style="width:100%;max-height:430px;border-radius:12px;background:#000"></video>
                <div class="row between mt"><span class="small muted">Coût : ${(run.cost.images + run.cost.music).toFixed(2)}$ · ${(run.pairs || []).length * 2} pistes</span>
                  <a class="btn btn-sm btn-accent" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger</a></div>`
              : run.status === "montage_running"
              ? `<div class="empty small"><span class="spin"></span> Montage en cours…</div>`
              : `<div class="empty small">Le montage n'est pas encore rendu.</div>`;
          }
          // Fini
          if (!run.pack) {
            if (run.status === "packaging_running") return `<div class="empty small"><span class="spin"></span> Packaging en cours…</div>`;
            return `<div class="empty small">Packaging pas encore généré.</div>`;
          }
          const pk = run.pack;
          return `${(() => {
              if (!run.params.publishChannelId) return `<div class="small muted" style="margin-bottom:8px">📦 Pas de publication automatique : la vidéo attend dans le <b>Stock</b> (publie-la ci-dessous quand tu veux).</div>`;
              if (run.published && run.published.url) return `<div class="empty small" style="margin:0 0 10px;color:#4ade80;border-color:rgba(74,222,128,.4)"><b>📤 Publication automatique : ✅ PUBLIÉE (${run.published.privacy === "public" ? "🌍 publique" : run.published.privacy === "unlisted" ? "🔗 non répertoriée" : "🔒 privée"})</b><a href="${esc(run.published.url)}" target="_blank">▶ Voir sur YouTube</a></div>`;
              if (run.published && run.published.error) return `<div class="empty small" style="margin:0 0 10px;color:var(--err)"><b>📤 Publication automatique : ❌ ÉCHOUÉE</b>${esc(run.published.error)} — la vidéo est restée dans le Stock, publie-la ci-dessous.</div>`;
              return `<div class="empty small" style="margin:0 0 10px;color:var(--accent)"><b>📤 Publication automatique : ⏳ EN COURS…</b>La vidéo est en train d'être envoyée sur la chaîne — ce panneau se mettra à jour.</div>`;
            })()}
            <div class="row mt" style="gap:16px;align-items:flex-start">
              <div style="flex:none;width:290px">
                <div id="pk-thumb">${pk.thumbRel ? `<img src="/media/${encodeURIComponent(pk.thumbRel)}${pk.thumbTs ? `?t=${pk.thumbTs}` : ""}" style="width:290px;border-radius:10px;border:1px solid var(--border-soft)">` : `<div class="empty small">Pas de miniature</div>`}</div>
                <div class="row" style="gap:5px;margin-top:6px">
                  <input type="text" id="pk-thumb-instr" placeholder="Observation…" style="flex:1;font-size:11px">
                  <button class="mini-btn" id="pk-thumb-regen">🎨 Régénérer</button>
                </div>
                ${run.finalRel ? `<a class="btn btn-sm btn-ghost" style="width:100%;margin-top:8px;text-align:center" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger la vidéo</a>` : ""}
              </div>
              <div class="grow" style="min-width:0">
                <input type="text" id="pk-text-instr" placeholder="Observation pour régénérer un texte…" style="width:100%;font-size:11px;margin-bottom:8px">
                <label class="field"><span class="row between">Titre <span class="row" style="gap:5px"><span class="small muted mono">${(pk.title || "").length}/100</span><button class="mini-btn" data-copy="pk-title">📋</button><button class="mini-btn" data-regen-text="title">↻💡</button></span></span><input type="text" id="pk-title" value="${esc(pk.title || "")}"></label>
                <label class="field"><span class="row between">Description (tracklist) <span class="row" style="gap:5px"><button class="mini-btn" data-copy="pk-desc">📋</button><button class="mini-btn" data-regen-text="description">↻💡</button></span></span><textarea id="pk-desc" rows="6">${esc(pk.description || "")}</textarea></label>
                <label class="field"><span class="row between">Tags <span class="row" style="gap:5px"><span class="small muted mono">${(pk.tags || []).join(", ").length}/500</span><button class="mini-btn" data-copy="pk-tags">📋</button><button class="mini-btn" data-regen-text="tags">↻💡</button></span></span><textarea id="pk-tags" rows="2">${esc((pk.tags || []).join(", "))}</textarea></label>
                <div class="row" style="gap:8px">
                  <select id="pk-chan" style="flex:1"><option value="">— chaîne YouTube —</option></select>
                  <select id="pk-priv" style="width:170px" title="Mode de publication">
                    <option value="private" selected>🔒 Privée</option>
                    <option value="unlisted">🔗 Non répertoriée</option>
                    <option value="public">🌍 Publique</option>
                  </select>
                  <button class="btn btn-accent" data-publish disabled>📤 Publier</button>
                </div>
                <div class="small muted" style="margin-top:6px">📦 Sans publication, la vidéo reste dans le <b>Stock</b>. Par défaut elle part en <b>privé</b>.</div>
              </div>
            </div>`;
        })()}
        </div>
        ${validateLabel ? `<div class="wiz-foot">
          <span class="small muted">Inspecte, régénère si besoin, puis valide pour avancer.</span>
          <button class="btn btn-accent" data-validate style="margin-left:auto;font-size:13.5px;padding:10px 20px">${validateLabel}</button>
        </div>` : ""}`;
      const scroller = box.querySelector(".wiz-scroll");
      if (scroller) scroller.scrollTop = prevScroll;
      box.querySelector("[data-close]").addEventListener("click", () => { clearTimeout(wizTimer); overlay.remove(); if (tab === "runs") shell(); });
      const reopen = () => { clearTimeout(wizTimer); overlay.remove(); openWizard(run.id); };
      box.querySelectorAll(".wiz-step[data-view]").forEach((s) => s.addEventListener("click", () => { box.dataset.view = s.dataset.view; delete box.dataset.sig; renderWizard(box, run, overlay); }));
      const cx = box.querySelector("[data-cancel-run]");
      if (cx) cx.addEventListener("click", async () => {
        cx.disabled = true;
        try { await api(`/api/machines/musique/runs/${run.id}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); reopen(); }
        catch (err) { AgentOS.toast(err.message, "err"); cx.disabled = false; }
      });
      const rt = box.querySelector("[data-retry]");
      if (rt) rt.addEventListener("click", async () => {
        rt.disabled = true;
        try { await api(`/api/machines/musique/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("Reprise ↻", "ok"); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); rt.disabled = false; }
      });
      const zp = box.querySelector("[data-zap-run]");
      if (zp) zp.addEventListener("click", async () => {
        zp.disabled = true; zp.textContent = "⏳";
        try { await api(`/api/machines/musique/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok"); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); zp.disabled = false; zp.textContent = "⚡"; }
      });
      const v = box.querySelector("[data-validate]");
      if (v) v.addEventListener("click", async () => {
        v.disabled = true;
        try { await api(`/api/machines/musique/runs/${run.id}/validate`, { method: "POST" }); AgentOS.toast("Étape validée ⚙", "ok"); }
        catch (e) { AgentOS.toast(e.message, "err"); v.disabled = false; }
      });
      const wvBtn = box.querySelector("#wv-regen");
      if (wvBtn) wvBtn.addEventListener("click", async () => {
        wvBtn.disabled = true; wvBtn.textContent = "⏳…";
        try { await api(`/api/machines/musique/runs/${run.id}/regen-visual`, { method: "POST", body: { instructions: (box.querySelector("#wv-instr") || {}).value || "" } }); AgentOS.toast("Visuel régénéré 🎨", "ok"); }
        catch (e) { AgentOS.toast(e.message, "err"); }
        delete box.dataset.sig;
      });
      box.querySelectorAll("[data-pregen]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/musique/runs/${run.id}/regen-pair`, { method: "POST", body: { pair: Number(b.dataset.pregen), instructions: (box.querySelector(`[data-pinstr="${b.dataset.pregen}"]`) || {}).value || "" } }); AgentOS.toast(`Paire ${b.dataset.pregen} régénérée ↻`, "ok"); }
        catch (e) { AgentOS.toast(e.message, "err"); }
        delete box.dataset.sig;
      }));
      box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
        const field = box.querySelector("#" + b.dataset.copy);
        if (!field) return;
        try { await navigator.clipboard.writeText(field.value); } catch { field.select(); document.execCommand("copy"); }
        const old = b.textContent; b.textContent = "✓"; setTimeout(() => (b.textContent = old), 1200);
      }));
      box.querySelectorAll("[data-regen-text]").forEach((b) => b.addEventListener("click", async () => {
        const old = b.textContent; b.disabled = true; b.textContent = "⏳";
        try { const r = await api(`/api/machines/musique/runs/${run.id}/texts`, { method: "POST", body: { instructions: (box.querySelector("#pk-text-instr") || {}).value || "", field: b.dataset.regenText } }); AgentOS.toast("Régénéré 🔄", "ok"); box.dataset.view = "3"; delete box.dataset.sig; renderWizard(box, r, overlay); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = old; }
      }));
      const thumbBtn = box.querySelector("#pk-thumb-regen");
      if (thumbBtn) thumbBtn.addEventListener("click", async () => {
        thumbBtn.disabled = true; thumbBtn.textContent = "⏳…";
        try { const r = await api(`/api/machines/musique/runs/${run.id}/thumbnail`, { method: "POST", body: { instructions: (box.querySelector("#pk-thumb-instr") || {}).value || "" } }); AgentOS.toast("Miniature régénérée 🎨", "ok"); box.dataset.view = "3"; delete box.dataset.sig; renderWizard(box, r, overlay); }
        catch (e) { AgentOS.toast(e.message, "err"); thumbBtn.disabled = false; thumbBtn.textContent = "🎨 Régénérer"; }
      });
      const pubBtn = box.querySelector("[data-publish]");
      if (pubBtn) {
        const sel = box.querySelector("#pk-chan");
        api("/api/channels").then((chs) => { sel.innerHTML = `<option value="">— chaîne YouTube —</option>` + chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join(""); }).catch(() => {});
        sel.addEventListener("change", () => (pubBtn.disabled = !sel.value));
        pubBtn.addEventListener("click", async () => {
          pubBtn.disabled = true; pubBtn.textContent = "⏳ Upload…";
          try {
            const r = await api(`/api/machines/musique/runs/${run.id}/publish`, { method: "POST", body: { channelId: sel.value, privacyStatus: (box.querySelector("#pk-priv") || {}).value || "private", title: box.querySelector("#pk-title").value.trim(), description: box.querySelector("#pk-desc").value, tags: box.querySelector("#pk-tags").value.split(",").map((t) => t.trim()).filter(Boolean) } });
            AgentOS.toast("📤 Publiée : " + r.url, "ok");
          } catch (e) { AgentOS.toast(e.message, "err"); }
          pubBtn.textContent = "📤 Publier"; pubBtn.disabled = false;
        });
      }
    }

    // ═══════════ Onglet Runs ═══════════
    async function renderRuns() {
      const body = el.querySelector("#mus-body");
      const runs = await api("/api/machines/musique/runs");
      const BADGE = { done: ["✓ terminé", "ok"], failed: ["✗ échec", "err"] };
      body.innerHTML = runs.length
        ? runs.map((r) => {
            const [lb, bd] = BADGE[r.status] || ["⏳ en cours", "warn"];
            return `<div class="scrap-row ${r.status === "done" ? "done" : r.status === "failed" ? "failed" : ""}" style="cursor:pointer" data-run="${r.id}">
              <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.theme?.title || r.theme?.text || "Thème auto")}</b>
              <span class="small muted">${(r.pairCount || 0) * 2} musiques · ${r.mode}</span>
              <span class="small mono row-stat">${r.cost ? (r.cost.images + (r.cost.music || 0)).toFixed(2) + "$" : ""}</span>
              <span class="small muted">${ago(r.createdAt)}</span>
              <span class="badge ${bd}">${lb}</span>
              ${r.status !== "done" ? `<button class="icon-btn" data-zap="${r.id}" title="⚡ Décharge : relance le run">⚡</button>` : ""}
              ${!["done", "failed"].includes(r.status) ? `<button class="icon-btn" data-cancel="${r.id}" title="Annuler">🛑</button>` : ""}
            </div>`;
          }).join("")
        : `<div class="empty">Aucun run — lance ta première vidéo musicale dans ⚙ Générer.</div>`;
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
      body.querySelectorAll("[data-zap]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation(); b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/musique/runs/${b.dataset.zap}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok"); openWizard(b.dataset.zap); }
        catch (err) { AgentOS.toast(err.message, "err"); }
        renderRuns();
      }));
      body.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation(); b.disabled = true;
        try { await api(`/api/machines/musique/runs/${b.dataset.cancel}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); } catch (err) { AgentOS.toast(err.message, "err"); }
        renderRuns();
      }));
    }

    // ═══════════ Onglet Stock ═══════════
    async function renderStock() {
      const body = el.querySelector("#mus-body");
      let stock = [], chans = [];
      try { [stock, chans] = await Promise.all([api("/api/machines/musique/stock"), api("/api/channels")]); } catch {}
      const chanName = (id) => (chans.find((c) => c.channelId === id) || {}).title || id || "";
      const archived = stock.filter((v) => v.archived);
      const unposted = stock.filter((v) => !v.posted && !v.archived), posted = stock.filter((v) => v.posted && !v.archived);
      const row = (v) => `
        <div class="scrap-row ${v.posted ? "done" : ""}" style="cursor:pointer;${v.archived ? "opacity:.55" : ""};border-left:3px solid ${v.archived ? "var(--border-soft)" : v.posted ? "var(--ok, #4ade80)" : "var(--accent)"}" data-run="${esc(v.runId)}">
          ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:74px;height:42px;object-fit:cover;border-radius:6px;flex:none">` : `<span style="width:74px;text-align:center">🎵</span>`}
          <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</b>
          <span class="small muted">${AgentOS.dateFr(v.createdAt)}</span>
          ${v.posted
            ? `<span class="badge ok" title="${esc(chanName(v.channelId))}">📤 postée</span>${v.videoId ? `<a class="mini-btn" href="https://youtube.com/watch?v=${esc(v.videoId)}" target="_blank" onclick="event.stopPropagation()">▶</a>` : ""}
               <button class="mini-btn" data-unpost="${esc(v.id)}" title="Remettre en stock">↩</button>`
            : `<span class="badge accent">📦 en stock</span>
               <button class="mini-btn" data-post="${esc(v.id)}" title="Marquer comme publiée">✓ publiée</button>`}
          <button class="mini-btn" data-arch="${esc(v.id)}" data-to="${v.archived ? 0 : 1}">${v.archived ? "📤 sortir" : "🗃"}</button>
        </div>`;
      // Tuiles GÉANTES cliquables = filtres (2e clic → tout afficher). Les archives ne comptent jamais dans le stock.
      const F = (renderStock._f = renderStock._f || { v: "all" });
      const show = (k) => F.v === "all" || F.v === k;
      const tile = (k, label, count, color) =>
        `<span class="stat stock-tile ${F.v === k ? "active" : ""}" data-sf="${k}" style="--tile-c:${color}"><span class="k">${label}</span><span class="v">${count}</span></span>`;
      body.innerHTML = `
        <div class="row mb" style="gap:14px;flex-wrap:wrap">
          ${tile("stock", "📦 En stock", unposted.length, "var(--accent)")}
          ${tile("posted", "📤 Postées", posted.length, "var(--ok, #4ade80)")}
          ${tile("arch", "🗃 Archives", archived.length, "var(--muted)")}
        </div>
        ${stock.length
          ? `${show("stock") && unposted.length ? `<div class="small" style="font-weight:700;color:var(--accent);margin-bottom:4px">📦 EN STOCK</div>${unposted.map(row).join("")}` : ""}
             ${show("posted") && posted.length ? `<div class="small" style="font-weight:700;color:var(--ok, #4ade80);margin:12px 0 4px">📤 POSTÉES</div>${posted.map(row).join("")}` : ""}
             ${show("arch") && archived.length ? (F.v === "arch" ? `<div class="small" style="font-weight:700;color:var(--ink-2);margin:12px 0 4px">🗃 ARCHIVES (${archived.length})</div>${archived.map(row).join("")}` : `<details style="margin-top:14px"><summary class="small" style="font-weight:700;color:var(--ink-2);cursor:pointer">🗃 ARCHIVES (${archived.length})</summary>${archived.map(row).join("")}</details>`) : ""}`
          : `<div class="empty">Aucune vidéo en stock.</div>`}`;
      body.querySelectorAll("[data-sf]").forEach((tl) => tl.addEventListener("click", () => { F.v = F.v === tl.dataset.sf ? "all" : tl.dataset.sf; renderStock(); }));
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
      const patch = async (id, patchBody, msg) => {
        try { await api(`/api/machines/musique/stock/${id}`, { method: "PATCH", body: patchBody }); AgentOS.toast(msg, "ok"); } catch (e) { AgentOS.toast(e.message, "err"); }
        renderStock();
      };
      body.querySelectorAll("[data-arch]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.arch, { archived: b.dataset.to === "1" }, b.dataset.to === "1" ? "Archivée 🗃" : "Désarchivée 📤"); }));
      body.querySelectorAll("[data-post]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.post, { posted: true }, "Marquée publiée ✓"); }));
      body.querySelectorAll("[data-unpost]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.unpost, { posted: false }, "Remise en stock ↩"); }));
    }

    // ═══════════ Onglet Paramètres ═══════════
    async function renderSettings() {
      const body = el.querySelector("#mus-body");
      const s = cfg.settings;
      let chans = [], niches = [];
      try { [chans, niches] = await Promise.all([api("/api/channels"), api("/api/bank/niches")]); } catch {}
      body.innerHTML = `
        <div class="grid grid-2">
          <label class="field"><span>Chaîne YouTube reliée (publication)</span>
            <select id="s-chan"><option value="">— aucune —</option>${chans.map((c) => `<option value="${esc(c.channelId)}" ${cfg.linkedChannelId === c.channelId ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select></label>
          <label class="field"><span>Modèle d'image (visuel + miniature)</span>
            <select id="s-img">
              <option value="gpt" ${s.imageModel === "gpt" ? "selected" : ""}>gpt-image-2-text-to-image (0,03$)</option>
              <option value="nano" ${s.imageModel === "nano" ? "selected" : ""}>nano-banana-2-lite (0,02$)</option>
            </select></label>
          <label class="field"><span>Modèle musique</span><input type="text" value="Suno V5_5 via Kie (0,06$ / 2 titres)" disabled></label>
          <label class="field"><span>Modèle d'écriture (prompts, packaging)</span>
            <select id="s-pmodel"><option value="" ${s.promptModel !== "opus" ? "selected" : ""}>Fable 5 (défaut)</option><option value="opus" ${s.promptModel === "opus" ? "selected" : ""}>Opus 4.8</option></select></label>
          <label class="field"><span>CTA visuel toutes les (minutes)</span><input type="number" id="s-cta" value="${s.ctaEveryMin}" min="1"></label>
        </div>
        <button class="btn btn-accent mt" id="s-save">Enregistrer</button>`;
      body.querySelector("#s-save").addEventListener("click", async () => {
        cfg = await api("/api/machines/musique", { method: "PATCH", body: {
          linkedChannelId: body.querySelector("#s-chan").value || null,
          settings: { imageModel: body.querySelector("#s-img").value, promptModel: body.querySelector("#s-pmodel").value, ctaEveryMin: Number(body.querySelector("#s-cta").value) || 5 },
        } });
        AgentOS.toast("Paramètres enregistrés 🛠", "ok");
      });
    }

    shell();
    try {
      const or = sessionStorage.getItem("musique-open-run");
      if (or) { sessionStorage.removeItem("musique-open-run"); openWizard(or); }
    } catch {}
  },
});
