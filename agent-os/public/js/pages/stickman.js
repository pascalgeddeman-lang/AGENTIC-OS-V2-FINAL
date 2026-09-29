/**
 * MACHINE STICKMAN — onglets : Générer / Personnages / Runs / Stock / Paramètres.
 * Wizard identique aux autres machines (rail wiz-head / wiz-rail / wiz-scroll).
 *
 * Particularité : les personnages ne sont PAS un input. Ils vivent dans une bibliothèque
 * partagée (onglet Personnages) où la machine pioche seule, et qu'elle complète quand le thème
 * du jour demande une époque ou un métier absent de la troupe.
 */
AgentOS.register("stickman", {
  title: "Stickman",
  async render(el) {
    const { api, esc, ago } = AgentOS;
    let cfg = await api("/api/machines/stickman");
    const TABS = ["gen", "cast", "runs", "stock", "settings"];
    let tab = TABS.includes(localStorage.getItem("stk-tab")) ? localStorage.getItem("stk-tab") : "gen";
    let wizTimer = null;
    this.onLeave = () => clearTimeout(wizTimer);

    const LANGS = Object.keys(cfg.voices || { English: [] });
    const ERA_LABEL = { prehistoire: "Préhistoire", antiquite: "Antiquité", "moyen-age": "Moyen Âge", moderne: "Moderne", contemporain: "Contemporain", intemporel: "Intemporel" };
    const ERA_ORDER = ["prehistoire", "antiquite", "moyen-age", "moderne", "contemporain", "intemporel"];
    const sheetSrc = (id, ts) => `/api/machines/stickman/cast/${encodeURIComponent(id)}/sheet?v=${ts || 0}`;

    function shell() {
      el.innerHTML = `
        <div class="card">
          <h2><a href="#/machines" class="back-btn" style="margin-right:10px" title="Retour aux Machines">←</a>🧍 Stickman
            <span class="h-actions">
              <span class="mini-seg" id="stk-tabs">
                <button data-t="gen" class="${tab === "gen" ? "active" : ""}">⚙ Générer</button>
                <button data-t="cast" class="${tab === "cast" ? "active" : ""}">🎭 Personnages</button>
                <button data-t="runs" class="${tab === "runs" ? "active" : ""}">🎞 Runs</button>
                <button data-t="stock" class="${tab === "stock" ? "active" : ""}">📦 Stock</button>
                <button data-t="settings" class="${tab === "settings" ? "active" : ""}">🛠 Paramètres</button>
              </span>
            </span>
          </h2>
          <div id="stk-body"></div>
        </div>`;
      el.querySelectorAll("#stk-tabs button").forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.t;
          try { localStorage.setItem("stk-tab", tab); } catch {}
          shell();
        })
      );
      ({ gen: renderGen, cast: renderCast, runs: renderRuns, stock: renderStock, settings: renderSettings })[tab]();
    }

    // ═══════════════════════════ Onglet Générer ═══════════════════════════
    // Une ligne = un groupe de champs de même nature ; `align-items:end` sur chaque grille,
    // libellés sur UNE ligne : c'est ce qui garde les champs alignés entre eux.
    let mode = "semi";
    async function renderGen() {
      const body = el.querySelector("#stk-body");
      let chans = [];
      try { chans = await api("/api/channels"); } catch {}
      const lang = cfg.voices[cfg.settings.chainLanguage] ? cfg.settings.chainLanguage : "English";

      body.innerHTML = `
        <label class="field"><span>Sujet de la vidéo <span class="muted">(la machine choisit seule les personnages dans la troupe)</span></span>
          <span class="row" style="gap:6px">
            <input id="g-subject" class="grow" placeholder="ex : le sommeil avant les lits, les murs et l'électricité">
            <button class="btn btn-sm" id="g-idea" title="Proposer un sujet d'après la banque de niche">💡</button>
          </span></label>
        <div class="grid grid-3 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Langue de la voix</span>
            <select id="g-lang">${LANGS.map((l) => `<option${l === lang ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Voix Inworld</span>
            <select id="g-voice"></select></label>
          <label class="field" style="margin:0"><span>Durée : <b id="g-dlbl">5</b> min <span class="muted">(~<b id="g-wlbl">825</b> mots)</span></span>
            <input type="range" id="g-dur" min="2" max="25" value="5" style="width:100%"></label>
        </div>
        <div class="fbar mb" style="padding:10px 12px;flex-wrap:wrap;gap:12px">
          <span class="fbar-item"><span>Sous-titres</span>
            <span class="mini-seg" id="g-sub"><button data-v="0">Non</button><button data-v="1" class="active">Oui</button></span></span>
          <span class="fbar-item"><span>Mode</span>
            <span class="mini-seg" id="g-mode"><button class="active" data-v="semi">Semi-manuel</button><button data-v="auto">100 % auto</button></span></span>
        </div>
        <div class="fbar mb" style="padding:10px 12px">
          <span class="fbar-item"><span>Publication auto</span>
            <span class="mini-seg" id="g-pub"><button class="active" data-v="0">Non</button><button data-v="1">Oui</button></span></span>
          <span class="fbar-item" id="g-pubchan-wrap" style="display:none"><span>Chaîne</span>
            <select id="g-pubchan" style="min-width:170px"><option value="">— choisis la chaîne —</option></select> <select id="g-pubpriv" style="width:150px" title="Mode de publication automatique"><option value="private" selected>🔒 Privée</option><option value="unlisted">🔗 Non répertoriée</option><option value="public">🌍 Publique</option></select></span>
          <span id="g-cost" style="margin-left:auto;font-weight:800;font-size:17px;color:#4ade80;background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.35);border-radius:10px;padding:9px 16px;white-space:nowrap"></span>
          <button class="btn btn-accent" id="g-go" style="font-size:14px;padding:10px 22px">⚙ Générer</button>
        </div>
        <div class="small muted" style="text-align:right">Script → Voix → Casting → Prompts → Images → Montage → Packaging</div>`;

      const $ = (s) => body.querySelector(s);
      const seg = (id, cb) => body.querySelectorAll(`#${id} button`).forEach((b) =>
        b.addEventListener("click", () => { body.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("active", x === b)); cb && cb(b.dataset.v); }));
      const activeVal = (id) => body.querySelector(`#${id} button.active`).dataset.v;

      const fillVoices = () => {
        const vs = cfg.voices[$("#g-lang").value] || cfg.voices.English;
        $("#g-voice").innerHTML = vs.map((v) => `<option>${esc(v)}</option>`).join("");
      };
      fillVoices();
      $("#g-lang").addEventListener("change", fillVoices);
      seg("g-sub");
      seg("g-mode", (v) => (mode = v));

      // Juste le prix, gros — le détail vit dans l'infobulle
      const costLine = async () => {
        const d = Number($("#g-dur").value) || 5;
        $("#g-dlbl").textContent = d;
        $("#g-wlbl").textContent = Math.round(d * 165);
        try {
          const e = await api("/api/machines/stickman/estimate", { method: "POST", body: { durationMin: d } });
          const c = $("#g-cost");
          c.textContent = `≈ ${e.total.toFixed(2)} $`;
          c.title = `~${e.shots} visuels (${e.images.toFixed(2)}$) · voix off + Whisper ${e.voice.toFixed(2)}$ · nouvelles fiches personnage ~${e.sheets.toFixed(2)}$ · miniature incluse`;
        } catch {}
      };
      $("#g-dur").addEventListener("input", costLine);
      costLine();

      // Publication auto : chaîne OBLIGATOIRE (pas de défaut) — Générer grisé tant qu'elle n'est pas choisie
      const pubChan = $("#g-pubchan");
      const goBtn = $("#g-go");
      const pubOn = () => activeVal("g-pub") === "1";
      const gateGo = () => (goBtn.disabled = pubOn() && !pubChan.value);
      pubChan.innerHTML = `<option value="">— choisis la chaîne —</option>` + chans.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("");
      pubChan.addEventListener("change", gateGo);
      body.querySelectorAll("#g-pub button").forEach((b) =>
        b.addEventListener("click", () => {
          body.querySelectorAll("#g-pub button").forEach((x) => x.classList.toggle("active", x === b));
          $("#g-pubchan-wrap").style.display = b.dataset.v === "1" ? "" : "none";
          gateGo();
        })
      );
      gateGo();

      $("#g-idea").addEventListener("click", async () => {
        const input = $("#g-subject"), btn = $("#g-idea");
        input.classList.add("ai-thinking"); input.disabled = true; input.value = ""; input.placeholder = "💡 Je fouille la niche…";
        btn.disabled = true; btn.textContent = "⏳";
        try {
          const j = await api("/api/machines/stickman/idea", { method: "POST" });
          input.value = j.subject || j.title || "";
          if (j.myth) AgentOS.toast("💡 " + j.myth, "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
        input.classList.remove("ai-thinking"); input.disabled = false;
        input.placeholder = "ex : le sommeil avant les lits, les murs et l'électricité";
        btn.disabled = false; btn.textContent = "💡";
      });

      goBtn.addEventListener("click", async () => {
        const subject = $("#g-subject").value.trim();
        if (!subject) return AgentOS.toast("Donne un sujet, ou clique 💡", "err");
        goBtn.disabled = true; goBtn.textContent = "⏳ Lancement…";
        try {
          const run = await api("/api/machines/stickman/runs", { method: "POST", body: {
            subject,
            durationMin: Number($("#g-dur").value),
            language: $("#g-lang").value,
            voice: $("#g-voice").value,
            subtitles: activeVal("g-sub") === "1",
            mode: activeVal("g-mode"),
            publishChannelId: pubOn() ? pubChan.value : null,
            publishPrivacy: $("#g-pubpriv").value,
          }});
          AgentOS.toast("🚀 Run lancé", "ok");
          openWizard(run.id);
        } catch (e) { AgentOS.toast(e.message, "err"); }
        goBtn.disabled = false; goBtn.textContent = "⚙ Générer";
        gateGo();
      });
    }

    // ═══════════════════════════ Onglet Personnages ═══════════════════════════
    // Liste en lignes (pas en colonnes) : la troupe grandit à chaque vidéo, il faut que 30
    // personnages tiennent à l'écran sans scroller pendant dix minutes.
    async function renderCast() {
      const body = el.querySelector("#stk-body");
      const lib = await api("/api/machines/stickman/cast");
      const groups = {};
      for (const c of lib.characters) (groups[c.era || "intemporel"] = groups[c.era || "intemporel"] || []).push(c);
      const eras = ERA_ORDER.filter((e) => groups[e]).concat(Object.keys(groups).filter((e) => !ERA_ORDER.includes(e)));

      const row = (c) => `
        <div class="scrap-row" style="gap:10px">
          <img src="${sheetSrc(c.id, c.ts)}" style="width:34px;height:44px;object-fit:contain;background:#EDE7DA;border-radius:5px;flex:none">
          <b class="small" style="flex:none;width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</b>
          <span class="small muted" style="flex:none;width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.role || "—")}</span>
          <span class="small muted grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.look)}</span>
          <span class="small mono row-stat" style="flex:none">${c.uses || 0} vidéo(s)</span>
          <button class="mini-btn" data-regen="${c.id}" title="Redessiner la fiche (0,02 $)">↻</button>
          <button class="mini-btn" data-del="${c.id}" title="Supprimer de la troupe">🗑</button>
        </div>`;

      body.innerHTML = `
        <div class="empty small" style="text-align:left;margin:0 0 12px">
          <b>La machine se sert seule dans cette troupe</b>
          Elle réutilise en priorité ce qui existe et n'ajoute que ce que le thème du jour exige.
          Tous les personnages sont habillés depuis la même base neutre : c'est ce qui garantit un trait identique
          d'un personnage à l'autre et d'une vidéo à l'autre.
        </div>
        <div class="row between mb" style="align-items:center;gap:12px">
          <span class="row" style="gap:10px;align-items:center">
            ${lib.neutral ? `<img src="${sheetSrc("neutral", lib.neutral.ts)}" style="width:34px;height:44px;object-fit:contain;background:#EDE7DA;border-radius:5px">` : ""}
            <span class="small"><b>Base neutre</b><br><span class="muted">Le gabarit de toute la troupe</span></span>
            <button class="mini-btn" id="c-upneutral">📤 Remplacer</button>
            <button class="mini-btn" id="c-regenneutral" title="Régénérer la base (0,02 $)">↻</button>
            <input type="file" id="c-neutralfile" accept="image/*" style="display:none">
          </span>
          <span class="row" style="gap:10px;align-items:center">
            <span class="small muted">${lib.characters.length} personnage(s)</span>
            <button class="btn btn-sm btn-accent" id="c-add">+ Personnage</button>
          </span>
        </div>
        ${eras.length
          ? eras.map((era) => `
              <div class="small muted" style="margin:14px 0 6px;font-weight:600">${esc(ERA_LABEL[era] || era)} <span class="mono">(${groups[era].length})</span></div>
              ${groups[era].map(row).join("")}`).join("")
          : `<div class="empty">Troupe vide — ajoute un personnage, ou lance une vidéo : la machine créera ce dont elle a besoin.</div>`}`;

      body.querySelector("#c-add").addEventListener("click", addCharacter);
      body.querySelector("#c-upneutral").addEventListener("click", () => body.querySelector("#c-neutralfile").click());
      body.querySelector("#c-neutralfile").addEventListener("change", (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            await api("/api/machines/stickman/cast/neutral", { method: "POST", body: { dataUrl: rd.result } });
            AgentOS.toast("Base neutre remplacée — les prochaines fiches en dériveront", "ok");
            renderCast();
          } catch (err) { AgentOS.toast(err.message, "err"); }
        };
        rd.readAsDataURL(f);
      });
      body.querySelector("#c-regenneutral").addEventListener("click", async (e) => {
        e.target.disabled = true;
        try { await api("/api/machines/stickman/cast/neutral", { method: "POST", body: { force: true } }); renderCast(); }
        catch (err) { AgentOS.toast(err.message, "err"); e.target.disabled = false; }
      });
      body.querySelectorAll("[data-regen]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/stickman/cast/${b.dataset.regen}/regen`, { method: "POST", body: {} }); renderCast(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = "↻"; }
      }));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
        const c = lib.characters.find((x) => x.id === b.dataset.del);
        if (!confirm(`Supprimer « ${c.name} » de la troupe ?`)) return;
        try { await api(`/api/machines/stickman/cast/${b.dataset.del}`, { method: "DELETE" }); renderCast(); }
        catch (e) { AgentOS.toast(e.message, "err"); }
      }));
    }

    /** Création manuelle : on décrit en français, la machine rédige la fiche puis l'habille. */
    function addCharacter() {
      const ov = document.createElement("div");
      ov.className = "picker-overlay";
      ov.innerHTML = `
        <div class="scrap-modal">
          <div class="row between" style="margin-bottom:8px"><h2 style="margin:0;font-size:15px">🎭 Nouveau personnage</h2>
            <button class="btn btn-sm btn-ghost" id="nc-cancel">✕</button></div>
          <label class="field"><span>Décris-le en français</span>
            <textarea id="nc-desc" rows="3" placeholder="ex. femme viking, longue natte blonde, cape de laine grise, broches ovales en bronze"></textarea></label>
          <div id="nc-preview" class="small muted" style="margin-bottom:10px"></div>
          <div class="row" style="gap:8px;justify-content:flex-end">
            <button class="btn btn-sm" id="nc-draft">✍ Rédiger la fiche</button>
            <button class="btn btn-sm btn-accent" id="nc-go" disabled>Créer (0,02 $)</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      let draft = null;
      const q = (s) => ov.querySelector(s);
      q("#nc-cancel").addEventListener("click", () => ov.remove());
      q("#nc-draft").addEventListener("click", async () => {
        const d = q("#nc-desc").value.trim();
        if (!d) return;
        q("#nc-draft").disabled = true; q("#nc-draft").textContent = "⏳";
        try {
          draft = await api("/api/machines/stickman/cast/draft", { method: "POST", body: { description: d } });
          q("#nc-preview").innerHTML = `<b>${esc(draft.name)}</b> — ${esc(ERA_LABEL[draft.era] || draft.era)} · ${esc(draft.role)}<br>${esc(draft.look)}`;
          q("#nc-go").disabled = false;
        } catch (e) { AgentOS.toast(e.message, "err"); }
        q("#nc-draft").disabled = false; q("#nc-draft").textContent = "✍ Rédiger la fiche";
      });
      q("#nc-go").addEventListener("click", async () => {
        q("#nc-go").disabled = true; q("#nc-go").textContent = "⏳ Dessin…";
        try { await api("/api/machines/stickman/cast", { method: "POST", body: draft }); ov.remove(); renderCast(); AgentOS.toast("Personnage ajouté à la troupe", "ok"); }
        catch (e) { AgentOS.toast(e.message, "err"); q("#nc-go").disabled = false; q("#nc-go").textContent = "Créer (0,02 $)"; }
      });
    }

    // ═══════════════════════════ Wizard (rail identique aux autres machines) ═══════════════════════════
    const STEPS = [
      { key: "script", icon: "📝", label: "Script" },
      { key: "voice", icon: "🎙", label: "Voix" },
      { key: "casting", icon: "🎭", label: "Casting" },
      { key: "prompts", icon: "✍", label: "Prompts" },
      { key: "images", icon: "🖼", label: "Images" },
      { key: "montage", icon: "🎬", label: "Montage" },
    ];
    const FINI = STEPS.length; // index de l'étape « Fini »

    function stepIndex(status) {
      const i = STEPS.findIndex((s) => status.startsWith(s.key));
      return i < 0 ? FINI : i;
    }
    function stepDone(run, i) {
      const sc = run.scenes || [];
      if (i === 0) return !!run.script;
      if (i === 1) return !!(sc.length && run.words?.length);
      if (i === 2) return !!(run.cast || []).length;
      if (i === 3) return !!(sc.length && sc.every((s) => s.scene));
      if (i === 4) return !!(sc.length && sc.every((s) => s.image));
      return !!run.finalRel;
    }
    function globalPct(run) {
      const n = run.scenes?.length || 1;
      const done = (run.scenes || []).filter((s) => s.image).length;
      const map = { script_running: 6, script_ready: 14, voice_running: 18, voice_ready: 30, casting_running: 32, casting_ready: 36, prompts_running: 38, prompts_ready: 45, images_ready: 78, montage_running: 84, packaging_running: 94, done: 100 };
      if (run.status === "images_running") return 46 + Math.round((32 * done) / n);
      return map[run.status] ?? 8;
    }
    function countHTML(run) {
      const n = (run.scenes || []).length;
      if (!n) return "";
      const live = run.scenes.filter((s) => s.pending || s.rendering).length;
      if (run.status.startsWith("images")) {
        const done = run.scenes.filter((s) => s.image).length;
        const fail = run.scenes.filter((s) => !s.image && s.error).length;
        return `🖼 ${done}/${n} images${live ? ` · ${live} en cours` : ""}${fail ? ` · <span style="color:var(--err)">${fail} échec</span>` : ""}`;
      }
      if (run.status.startsWith("prompts")) return `✍ ${run.scenes.filter((s) => s.scene).length}/${n} prompts`;
      if (run.status.startsWith("casting")) return `🎭 ${(run.cast || []).length} personnage(s)`;
      if (run.status.startsWith("voice") || run.status.startsWith("montage")) return `🎞 ${n} visuel(s)`;
      return "";
    }

    function openWizard(runId) {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal lg" id="wiz"><span class="spin"></span></div>`;
      document.body.appendChild(overlay);
      const tick = async () => {
        let run;
        try { run = await api("/api/machines/stickman/runs/" + runId); }
        catch (e) { overlay.querySelector("#wiz").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
        const box = overlay.querySelector("#wiz");
        const sc = run.scenes || [];
        const nb = (f) => sc.filter((s) => s[f]).length;
        const shellKey = [run.status, box.dataset.view || "", sc.length, run.error ? 1 : 0, nb("scene"), nb("image"),
          sc.filter((s) => s.pending || s.rendering).length, (run.cast || []).length, run.finalRel ? 1 : 0, run.pack ? run.pack.thumbTs || 1 : 0].join("|");
        if (box.dataset.shellKey !== shellKey || !box.querySelector(".wiz-scroll")) {
          box.dataset.shellKey = shellKey;
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
      const viewIdx = box.dataset.view !== undefined && box.dataset.view !== "" ? Number(box.dataset.view) : Math.min(idx, FINI);
      const prevScroll = box.querySelector(".wiz-scroll")?.scrollTop || 0;
      const gpct = globalPct(run);
      const validateLabel = {
        script_ready: "✓ Valider le script → Voix",
        voice_ready: "✓ Valider le découpage → Casting",
        casting_ready: "✓ Valider le casting → Prompts",
        prompts_ready: "✓ Valider les prompts → Images",
        images_ready: "✓ Valider les images → Montage",
      }[run.status];
      const runMsg = {
        script_running: "Claude écrit le script et la voix off…",
        voice_running: "Inworld synthétise, Whisper transcrit, la machine découpe les visuels…",
        casting_running: "Distribution : réutilisation de la troupe et création des manquants…",
        prompts_running: "Écriture des descriptions d'images…",
        images_running: "Génération des images (5 en parallèle)…",
        montage_running: "Montage final (clips + sous-titres + bouton d'abonnement)…",
        packaging_running: "Claude prépare titre, description, tags et miniature…",
      }[run.status] || "";
      const cost = run.cost ? (run.cost.images + run.cost.voice + (run.cost.sheets || 0)) : 0;

      box.classList.add("wiz-modal");
      box.innerHTML = `
        <div class="wiz-head">
          <div class="wiz-gbar" title="Progression : ${gpct}%"><div style="width:${gpct}%"></div></div>
          <div class="row between" style="margin:10px 0 4px">
            <h2 style="margin:0;font-size:15px">🧍 ${esc(run.pack?.title || run.title)}
              <span class="small muted mono" style="margin-left:8px">${run.id} · ${run.mode} · ${esc(run.params.language)} · ${cost.toFixed(2)}$ · ${gpct}%</span></h2>
            <span class="row" style="gap:6px">
              ${run.status !== "done" ? `<button class="btn btn-sm" data-zap-run title="⚡ Décharge : relance le run là où il s'est arrêté">⚡</button>` : ""}
              ${!["done", "failed"].includes(run.status) ? `<button class="btn btn-sm" data-cancel-run title="Annuler ce run">🛑 Annuler</button>` : ""}
              <button class="btn btn-sm btn-ghost" data-close>✕</button>
            </span>
          </div>
          <div class="wiz-rail">
            ${STEPS.map((s, i) => `
              <div class="wiz-step ${stepDone(run, i) ? "done" : i === idx ? "active" : ""}" data-view="${i}" style="cursor:pointer" title="${s.label}">
                <div class="wiz-dot" ${i === viewIdx ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}${!stepDone(run, i) && i < idx ? ' data-gap="1"' : ""}>${stepDone(run, i) ? "✓" : i < idx ? "⚠" : s.icon}</div><span>${s.label}</span>
              </div>
              ${i < STEPS.length - 1 ? `<div class="wiz-link ${stepDone(run, i) ? "done" : i === idx && running ? "active" : ""}"></div>` : ""}`).join("")}
            <div class="wiz-link ${run.status === "done" ? "done" : run.status === "packaging_running" ? "active" : ""}"></div>
            <div class="wiz-step ${run.status === "done" ? "done" : ""}" data-view="${FINI}" style="cursor:pointer" title="Titre, description, tags, miniature, publication">
              <div class="wiz-dot" ${viewIdx === FINI ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>🏁</div><span>Fini</span>
            </div>
          </div>
          ${run.error ? `<div class="empty small" style="color:var(--err);margin:0"><b>Échec</b>${esc(run.error)} <button class="btn btn-sm" data-retry>↻ Reprendre où on s'est arrêté</button></div>` : ""}
          ${running ? `<div class="small muted"><span class="spin" style="width:12px;height:12px"></span> ${esc(runMsg)}</div>` : ""}
          <div class="small" style="font-weight:600;color:var(--accent)">${countHTML(run)}</div>
        </div>
        <div class="wiz-scroll">${viewHTML(run, viewIdx)}</div>
        ${validateLabel ? `<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn btn-accent" data-validate>${validateLabel}</button></div>` : ""}`;

      box.querySelector("[data-close]").addEventListener("click", () => { clearTimeout(wizTimer); overlay.remove(); });
      box.querySelectorAll(".wiz-step[data-view]").forEach((s) => s.addEventListener("click", () => {
        box.dataset.view = s.dataset.view;
        renderWizard(box, run, overlay);
      }));
      const on = (sel, fn) => { const b = box.querySelector(sel); if (b) b.addEventListener("click", () => fn(b)); };
      const reopen = () => { clearTimeout(wizTimer); overlay.remove(); openWizard(run.id); };
      on("[data-validate]", async (b) => {
        b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/stickman/runs/${run.id}/validate`, { method: "POST" }); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
      });
      on("[data-cancel-run]", async (b) => {
        b.disabled = true;
        try { await api(`/api/machines/stickman/runs/${run.id}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
      });
      const zap = async (b) => {
        b.disabled = true;
        try { await api(`/api/machines/stickman/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok"); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
      };
      on("[data-zap-run]", zap);
      on("[data-retry]", zap);

      wireView(box, run, viewIdx, reopen);
      const sc = box.querySelector(".wiz-scroll");
      if (sc) sc.scrollTop = prevScroll;
    }

    // ── Contenu d'une étape ──
    function viewHTML(run, viewIdx) {
      const key = STEPS[viewIdx]?.key || "fini";

      if (key === "script") {
        if (!run.script) return `<div class="empty small"><span class="spin"></span> Claude écrit le script…</div>`;
        const n = run.script.split(/\s+/).length;
        return `<div class="small muted mb">${n} mots · ~${(n / 165).toFixed(1)} min estimées${run.angle ? ` · mythe démonté : <b>${esc(run.angle)}</b>` : ""}</div>
          <div class="empty small" style="text-align:left;white-space:pre-wrap;line-height:1.65">${esc(run.script)}</div>`;
      }

      if (key === "voice") {
        if (!run.voRel) return `<div class="empty small"><span class="spin"></span> Synthèse de la voix off…</div>`;
        const st = run.shotStats;
        return `<audio controls src="/media/${encodeURIComponent(run.voRel)}" style="width:100%;margin-bottom:10px"></audio>
          ${st ? `<div class="row mb" style="gap:18px;flex-wrap:wrap">
            <span class="small"><b>${st.count}</b> visuels</span>
            <span class="small">médiane <b>${st.median} s</b> <span class="muted">(niche : 3,4 s)</span></span>
            <span class="small"><b>${st.perMin}</b> plans/min <span class="muted">(niche : 17)</span></span>
            <span class="small">de <b>${st.min} s</b> à <b>${st.max} s</b></span>
          </div>` : ""}
          <div class="small muted mb">Chaque visuel est calé sur une frontière de sens, jamais sur l'horloge.</div>
          ${(run.scenes || []).map((s) => `<div class="scrap-row" style="gap:10px"><span class="small mono" style="flex:none;width:82px">${s.start}s +${s.dur}s</span><span class="small grow" style="min-width:0">${esc(s.say)}</span></div>`).join("")}`;
      }

      if (key === "casting") {
        if (!(run.cast || []).length) return `<div class="empty small"><span class="spin"></span> Distribution en cours…</div>`;
        return `<div class="small muted mb">Distribution de cette vidéo — la machine a pioché dans la troupe et complété ce qui manquait.</div>
          ${run.cast.map((c) => `<div class="scrap-row" style="gap:10px">
            <img src="${sheetSrc(c.id)}" style="width:34px;height:44px;object-fit:contain;background:#EDE7DA;border-radius:5px;flex:none">
            <b class="small" style="flex:none;width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</b>
            <span class="small muted" style="flex:none;width:120px">${esc(ERA_LABEL[c.era] || c.era || "")}</span>
            <span class="small muted grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.look)}</span>
          </div>`).join("")}`;
      }

      if (key === "prompts") {
        if (!(run.scenes || []).some((s) => s.scene)) return `<div class="empty small"><span class="spin"></span> Écriture des descriptions d'images…</div>`;
        return (run.scenes || []).map((s) => `
          <div class="scrap-row" style="gap:10px;align-items:flex-start">
            <span class="small mono" style="flex:none;width:30px">${s.i}</span>
            <span class="badge" style="flex:none;width:74px;text-align:center">${esc(s.type || "scene")}</span>
            <span class="small grow" style="min-width:0">${esc(s.scene || "…")}</span>
            <span class="small muted mono" style="flex:none;width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(s.castIds || []).join(", ") || "—"}</span>
          </div>`).join("");
      }

      if (key === "images") {
        return `<div class="row" style="gap:8px;flex-wrap:wrap">${(run.scenes || []).map((s) => `
          <div class="scrap-row" style="flex-direction:column;align-items:stretch;gap:4px;padding:6px;width:200px;${s.error && !s.image ? "border-color:var(--err)" : ""}">
            ${s.image
              ? `<img src="/media/${encodeURIComponent(s.image.rel)}?v=${s.image.ts}" style="width:100%;height:106px;object-fit:cover;border-radius:6px">`
              : `<div class="empty small" style="height:106px;margin:0;display:flex;align-items:center;justify-content:center">${s.pending || s.rendering ? '<span class="spin"></span>' : s.error ? "❌" : "⏳"}</div>`}
            <span class="row between" style="align-items:center">
              <span class="small mono">${s.i} · ${s.dur}s</span>
              <button class="mini-btn" data-regen-shot="${s.i}" title="Régénérer ce plan" ${s.pending ? "disabled" : ""}>↻</button>
            </span>
          </div>`).join("")}</div>`;
      }

      if (key === "montage") {
        if (!run.finalRel) return run.status === "montage_running"
          ? `<div class="empty small"><span class="spin"></span> Montage en cours (clips + sous-titres + CTA)…</div>`
          : `<div class="empty small">Le montage n'est pas encore rendu.</div>`;
        return `<video src="/media/${encodeURIComponent(run.finalRel)}" controls style="width:100%;max-height:430px;border-radius:12px;background:#000"></video>
          <div class="row between mt"><span class="small muted">${(run.scenes || []).length} visuels · ${(run.voDuration / 60).toFixed(1)} min</span>
            <a class="btn btn-sm btn-accent" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger</a></div>`;
      }

      // ── Fini ──
      const pk = run.pack;
      if (!pk) return run.status === "packaging_running"
        ? `<div class="empty small"><span class="spin"></span> Claude prépare titre, description, tags et miniature…</div>`
        : `<div class="empty small">La vidéo n'est pas encore montée.</div>`;
      return `
        ${run.published?.url
          ? `<div class="empty small" style="margin:0 0 10px;color:#4ade80;border-color:rgba(74,222,128,.4)"><b>📤 Publiée (${esc(run.published.privacyStatus)})</b><a href="${esc(run.published.url)}" target="_blank">▶ Voir sur YouTube</a></div>`
          : `<div class="small muted" style="margin-bottom:8px">📦 La vidéo attend dans le <b>Stock</b> — publie-la ci-dessous quand tu veux.</div>`}
        <div class="row" style="gap:16px;align-items:flex-start">
          <div style="flex:none;width:290px">
            ${pk.thumbRel ? `<img src="/media/${encodeURIComponent(pk.thumbRel)}?t=${pk.thumbTs || 0}" style="width:290px;border-radius:10px;border:1px solid var(--border-soft)">` : `<div class="empty small">Pas de miniature</div>`}
            <div class="small muted" style="text-align:center;margin-top:4px">Miniature</div>
            <div class="row" style="gap:5px;margin-top:6px">
              <input type="text" id="pk-thumb-instr" placeholder="Observation (optionnel)…" style="flex:1;font-size:11px">
              <button class="mini-btn" data-regen-thumb title="Régénérer la miniature">🎨</button>
            </div>
            ${run.finalRel ? `<a class="btn btn-sm btn-ghost" style="width:100%;margin-top:8px;text-align:center" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger la vidéo</a>` : ""}
          </div>
          <div class="grow" style="min-width:0">
            <input type="text" id="pk-text-instr" placeholder="Observation pour régénérer un texte (optionnel)…" style="width:100%;font-size:11px;margin-bottom:8px">
            <label class="field"><span class="row between">Titre <span class="row" style="gap:5px"><span class="small muted mono">${(pk.title || "").length}/100</span><button class="mini-btn" data-copy="pk-title">📋</button><button class="mini-btn" data-regen-text="title">↻💡</button></span></span><input type="text" id="pk-title" value="${esc(pk.title || "")}"></label>
            <label class="field"><span class="row between">Description <span class="row" style="gap:5px"><button class="mini-btn" data-copy="pk-desc">📋</button><button class="mini-btn" data-regen-text="description">↻💡</button></span></span><textarea id="pk-desc" rows="6">${esc(pk.description || "")}</textarea></label>
            <label class="field"><span class="row between">Tags <span class="row" style="gap:5px"><span class="small muted mono">${(pk.tags || []).join(", ").length}/500</span><button class="mini-btn" data-copy="pk-tags">📋</button><button class="mini-btn" data-regen-text="tags">↻💡</button></span></span><textarea id="pk-tags" rows="2">${esc((pk.tags || []).join(", "))}</textarea></label>
            <div class="row" style="gap:8px">
              <select id="pk-chan" style="flex:1"><option value="">— chaîne YouTube —</option></select>
              <select id="pk-priv" style="width:170px" title="Mode de publication">
                <option value="private" selected>🔒 Privée</option>
                <option value="unlisted">🔗 Non répertoriée</option>
                <option value="public">🌍 Publique</option>
              </select>
              <button class="btn btn-sm btn-accent" data-publish disabled>📤 Publier</button>
            </div>
          </div>
        </div>`;
    }

    // ── Interactions d'une étape ──
    function wireView(box, run, viewIdx, reopen) {
      box.querySelectorAll("[data-regen-shot]").forEach((b) => b.addEventListener("click", async () => {
        const ins = prompt("Consigne pour ce plan (laisse vide pour le redessiner à l'identique) :", "");
        if (ins === null) return;
        b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/stickman/runs/${run.id}/regen`, { method: "POST", body: { scene: b.dataset.regenShot, instructions: ins } }); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = "↻"; }
      }));

      box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", (e) => {
        e.preventDefault();
        const src = box.querySelector("#" + b.dataset.copy);
        if (src) { navigator.clipboard.writeText(src.value); AgentOS.toast("Copié 📋", "ok"); }
      }));

      box.querySelectorAll("[data-regen-text]").forEach((b) => b.addEventListener("click", async () => {
        const instructions = box.querySelector("#pk-text-instr")?.value || "";
        b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/stickman/runs/${run.id}/texts`, { method: "POST", body: { instructions, field: b.dataset.regenText } }); AgentOS.toast("Régénéré 🔄", "ok"); box.dataset.view = String(FINI); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = "↻💡"; }
      }));

      const rt = box.querySelector("[data-regen-thumb]");
      if (rt) rt.addEventListener("click", async () => {
        const instructions = box.querySelector("#pk-thumb-instr")?.value || "";
        rt.disabled = true; rt.textContent = "⏳";
        try { await api(`/api/machines/stickman/runs/${run.id}/thumbnail`, { method: "POST", body: { instructions } }); AgentOS.toast("Miniature régénérée 🎨", "ok"); box.dataset.view = String(FINI); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); rt.disabled = false; rt.textContent = "🎨"; }
      });

      const pub = box.querySelector("[data-publish]");
      if (pub) {
        const sel = box.querySelector("#pk-chan");
        api("/api/channels").then((chs) => {
          sel.innerHTML = `<option value="">— chaîne YouTube —</option>` + chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("");
        }).catch(() => {});
        sel.addEventListener("change", () => (pub.disabled = !sel.value));
        pub.addEventListener("click", async () => {
          pub.disabled = true; pub.textContent = "⏳ Envoi…";
          try {
            const r = await api(`/api/machines/stickman/runs/${run.id}/publish`, { method: "POST", body: {
              channelId: sel.value,
              privacyStatus: box.querySelector("#pk-priv").value,
              title: box.querySelector("#pk-title").value,
              description: box.querySelector("#pk-desc").value,
              tags: box.querySelector("#pk-tags").value.split(",").map((x) => x.trim()).filter(Boolean),
            }});
            AgentOS.toast("📤 Publiée : " + r.url, "ok");
            reopen();
          } catch (e) { AgentOS.toast(e.message, "err"); pub.disabled = false; pub.textContent = "📤 Publier"; }
        });
      }
    }

    // ═══════════════════════════ Onglet Runs ═══════════════════════════
    async function renderRuns() {
      const body = el.querySelector("#stk-body");
      const runs = await api("/api/machines/stickman/runs");
      const BADGE = { done: ["✓ terminé", "ok"], failed: ["✗ échec", "err"] };
      body.innerHTML = runs.length
        ? runs.map((r) => {
            const [lb, bd] = BADGE[r.status] || ["⏳ en cours", "warn"];
            return `<div class="scrap-row ${r.status === "done" ? "done" : r.status === "failed" ? "failed" : ""}" style="cursor:pointer" data-run="${r.id}">
              <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</b>
              <span class="small muted">${r.shots || 0} visuels${r.durationSec ? " · " + (r.durationSec / 60).toFixed(1) + " min" : ""} · ${r.mode}</span>
              <span class="small mono row-stat">${r.cost ? (r.cost.images + r.cost.voice + (r.cost.sheets || 0)).toFixed(2) + "$" : ""}</span>
              <span class="small muted">${ago(r.createdAt)}</span>
              <span class="badge ${bd}">${lb}</span>
              ${r.status !== "done" ? `<button class="mini-btn" data-zap="${r.id}" title="⚡ Décharge : relance le run">⚡</button>` : ""}
              ${!["done", "failed"].includes(r.status) ? `<button class="mini-btn" data-cancel="${r.id}" title="Annuler">🛑</button>` : ""}
            </div>`;
          }).join("")
        : `<div class="empty">Aucun run — lance ta première vidéo dans ⚙ Générer.</div>`;
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
      body.querySelectorAll("[data-zap]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation(); b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/stickman/runs/${b.dataset.zap}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée", "ok"); openWizard(b.dataset.zap); }
        catch (err) { AgentOS.toast(err.message, "err"); }
        renderRuns();
      }));
      body.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation(); b.disabled = true;
        try { await api(`/api/machines/stickman/runs/${b.dataset.cancel}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); } catch (err) { AgentOS.toast(err.message, "err"); }
        renderRuns();
      }));
    }

    // ═══════════════════════════ Onglet Stock ═══════════════════════════
    async function renderStock() {
      const body = el.querySelector("#stk-body");
      let stock = [];
      try { stock = await api("/api/machines/stickman/stock"); } catch {}
      const live = stock.filter((v) => !v.archived);
      body.innerHTML = live.length
        ? live.map((v) => `
            <div class="scrap-row ${v.posted ? "done" : ""}" style="cursor:pointer;border-left:3px solid ${v.posted ? "var(--ok,#4ade80)" : "var(--accent)"}" data-run="${esc(v.id)}">
              ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:74px;height:42px;object-fit:cover;border-radius:6px;flex:none">` : `<span style="width:74px;text-align:center">🧍</span>`}
              <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</b>
              <span class="small muted">${v.shots} visuels · ${(v.durationSec / 60).toFixed(1)} min</span>
              <span class="small muted">${AgentOS.dateFr(v.createdAt)}</span>
              <span class="badge ${v.posted ? "ok" : "warn"}">${v.posted ? "📤 postée" : "en stock"}</span>
            </div>`).join("")
        : `<div class="empty">Stock vide.</div>`;
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
    }

    // ═══════════════════════════ Onglet Paramètres ═══════════════════════════
    async function renderSettings() {
      const body = el.querySelector("#stk-body");
      let niches = [];
      try { niches = await api("/api/bank/niches"); } catch {}
      const s = cfg.settings;
      const MODELS = { nano: "Nano Banana 2 Lite — 0,02 $", seedream: "Seedream 5 Lite — 0,014 $", gpt: "GPT Image 2 — 0,06 $" };
      body.innerHTML = `
        <div class="grid grid-3" style="align-items:end">
          <label class="field"><span>🖼 Modèle d'images</span>
            <select id="s-model">${Object.entries(MODELS).map(([k, l]) => `<option value="${k}"${s.imageModel === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field"><span>📣 CTA toutes les <b id="s-ctalbl">${s.ctaEveryMin}</b> min</span>
            <input type="range" id="s-cta" min="1" max="8" step="1" value="${s.ctaEveryMin}"></label>
          <label class="field"><span>📊 Schémas : <b id="s-diaglbl">${s.diagramShare ?? 20}</b> % <span class="muted">(niche : 20-26 %)</span></span>
            <input type="range" id="s-diag" min="5" max="45" step="1" value="${s.diagramShare ?? 20}"></label>
        </div>
        <div class="grid grid-3" style="align-items:end">
          <label class="field"><span>🌍 Langue de la chaîne <span class="muted">(titre, description, tags)</span></span>
            <select id="s-chain">${LANGS.map((l) => `<option${s.chainLanguage === l ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field"><span>🔒 Confidentialité à la publication</span>
            <select id="s-priv">${[["private", "🔒 Privée"], ["unlisted", "🔗 Non répertoriée"], ["public", "🌍 Publique"]].map(([v, l]) => `<option value="${v}"${s.publishPrivacy === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>🏦 Banque de niche liée</span>
            <select id="s-niche"><option value="">— aucune —</option>${niches.map((n) => `<option value="${n.id}"${cfg.nicheId === n.id ? " selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>
        </div>
        <div class="small muted mb">Pas de durée de clip dans cette machine : la durée de chaque visuel est déduite du sens de la voix off.</div>
        <button class="btn btn-accent" id="s-save">Enregistrer</button>`;
      const $ = (x) => body.querySelector(x);
      $("#s-cta").addEventListener("input", (e) => ($("#s-ctalbl").textContent = e.target.value));
      $("#s-diag").addEventListener("input", (e) => ($("#s-diaglbl").textContent = e.target.value));
      $("#s-save").addEventListener("click", async () => {
        try {
          cfg = await api("/api/machines/stickman", { method: "PATCH", body: {
            nicheId: $("#s-niche").value || null,
            settings: {
              imageModel: $("#s-model").value,
              ctaEveryMin: Number($("#s-cta").value),
              diagramShare: Number($("#s-diag").value),
              chainLanguage: $("#s-chain").value,
              publishPrivacy: $("#s-priv").value,
            },
          }});
          AgentOS.toast("Paramètres enregistrés", "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    shell();
  },
});
