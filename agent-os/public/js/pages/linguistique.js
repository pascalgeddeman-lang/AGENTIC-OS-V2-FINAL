/**
 * MACHINE LINGUISTIQUE — onglet dédié (clone du wizard Time Travel, adapté à la niche langue).
 * Sous-onglets : Générer / Personnages / Runs / Stock / Paramètres.
 * Wizard : Dialogues → Images → Voix → Vidéos → Montage → Fini (packaging).
 * Un run = présentateur + 2 protagonistes ; segments = intro, N dialogues, outro.
 */
AgentOS.register("linguistique", {
  title: "Linguistique",
  async render(el) {
    const { api, esc, fmt, ago } = AgentOS;
    let cfg = await api("/api/machines/linguistique");
    let runs = [];
    const TABS = ["gen", "chars", "runs", "stock", "settings"];
    let tab = TABS.includes(localStorage.getItem("ling-tab")) ? localStorage.getItem("ling-tab") : "gen";
    let wizTimer = null;
    const regenning = new Map();
    const stepStarts = new Map();
    this.onLeave = () => clearTimeout(wizTimer);

    const LANGS = ["English", "Français", "Español", "Deutsch", "Italiano", "Português", "日本語", "한국어", "العربية", "हिन्दी", "Русский", "中文"];
    const LEVELS = ["A1", "A2", "A1/A2", "B1", "B2", "C1"];
    const MODEL_NAMES = { gpt: "gpt-image-2-image-to-image", nano: "nano-banana-2-lite", grok: "grok-imagine-image", seedream: "seedream/5-lite" };
    // Pool de voix capturé UNE fois (le GET initial le renvoie) : reste stable même si `cfg` est
    // ensuite remplacé par une réponse PATCH (config sans le champ voices) → la liste ne se vide plus.
    const VOICE_POOL = cfg.voices && cfg.voices.F ? cfg.voices : {
      F: ["Aria", "Sarah", "Laura", "Charlotte", "Alice", "Matilda", "Jessica", "Lily"],
      M: ["Roger", "Charlie", "George", "Callum", "River", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel", "Bill"],
    };
    const voicesFor = (sex) => VOICE_POOL[sex] || [];
    // Couleur stable par voix (hash → teinte) : ré-utilisée sur les cartes perso, les dropdowns et les dialogues.
    const voiceColor = (v) => `hsl(${[...String(v || "?")].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360} 72% 62%)`;
    const voiceChip = (v) => `<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:9px;height:9px;border-radius:50%;background:${voiceColor(v)};border:1px solid rgba(255,255,255,.5);flex:none"></span>🎙 ${esc(v || "?")}</span>`;
    // Couleurs de base des sous-titres (bulles) — le contour des bulles rend les couleurs claires visibles.
    const SUB_COLORS = ["#FFFFFF", "#FFE93B", "#FF9F1C", "#FF4B4B", "#FF6BD6", "#B266FF", "#4B9FFF", "#3BE8FF", "#4ADE80", "#111111"];

    function shell() {
      el.innerHTML = `
        <div class="card">
          <h2><a href="#/machines" class="back-btn" style="margin-right:10px" title="Retour aux Machines">←</a>🗣 Linguistique
            <span class="h-actions">
              <span class="mini-seg" id="ling-tabs">
                <button data-t="gen" class="${tab === "gen" ? "active" : ""}">⚙ Générer</button>
                <button data-t="chars" class="${tab === "chars" ? "active" : ""}">👤 Personnages</button>
                <button data-t="runs" class="${tab === "runs" ? "active" : ""}">🎞 Runs</button>
                <button data-t="stock" class="${tab === "stock" ? "active" : ""}">📦 Stock</button>
                <button data-t="settings" class="${tab === "settings" ? "active" : ""}">🛠 Paramètres</button>
              </span>
            </span>
          </h2>
          <div id="ling-body"></div>
        </div>`;
      el.querySelectorAll("#ling-tabs button").forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.t;
          try { localStorage.setItem("ling-tab", tab); } catch {}
          shell();
        })
      );
      ({ gen: renderGen, chars: renderChars, runs: renderRuns, stock: renderStock, settings: renderSettings })[tab]();
    }

    // ═══════════ Onglet Générer ═══════════
    let mode = "semi";
    function renderGen() {
      const body = el.querySelector("#ling-body");
      const ch = cfg.characters;
      // Prénom du personnage + 🎙 + nom de la voix ElevenLabs (demande utilisateur)
      const opt = (sel) => ch.map((c) => `<option value="${c.id}" ${sel === c.id ? "selected" : ""}>${esc(c.name)} · 🎙 ${esc(c.voice || "?")}</option>`).join("");
      const noChars = ch.length < 3;
      body.innerHTML = `
        <div class="grid grid-3 mb">
          <label class="field"><span>🎤 Présentateur (intro & outro)</span>
            <select id="g-pres">${ch.length ? `<option value="">—</option>` + opt() : `<option value="">— crée 3 personnages (👤) —</option>`}</select></label>
          <label class="field"><span>🧑 Protagoniste A</span>
            <select id="g-pa">${ch.length ? `<option value="">—</option>` + opt() : `<option value="">—</option>`}</select></label>
          <label class="field"><span>🧑 Protagoniste B</span>
            <select id="g-pb">${ch.length ? `<option value="">—</option>` + opt() : `<option value="">—</option>`}</select></label>
        </div>
        <label class="field"><span>Thème de la vidéo <span class="muted">(vide = l'IA choisit)</span></span>
          <div class="row" style="gap:8px">
            <input type="text" id="g-theme" placeholder="ex : À l'aéroport — enregistrement et embarquement" style="flex:1">
            <button class="btn btn-sm btn-accent" id="g-idea">💡 Idée</button>
          </div></label>
        <div class="grid grid-2 mb">
          <label class="field"><span>Langue de la vidéo <span class="muted">(dialogues, sous-titres, CTA)</span></span>
            <select id="g-lang">${LANGS.map((l) => `<option ${l === "English" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Langue de la chaîne <span class="muted">(titre, description, tags — le public visé)</span></span>
            <select id="g-chainlang">${LANGS.map((l) => `<option ${l === "English" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Niveau</span>
            <select id="g-level">${LEVELS.map((l) => `<option ${l === "A1/A2" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Scènes de dialogue : <b id="g-nlbl">6</b></span>
            <input type="range" id="g-n" min="1" max="100" value="6" style="width:100%"></label>
        </div>
        <div class="fbar mb" style="padding:10px 12px;flex-wrap:wrap;gap:12px">
          <span class="fbar-item"><span>Lipsync présentateur</span>
            <span class="mini-seg" id="g-lip"><button data-v="0" class="active">Non</button><button data-v="1">Oui</button></span></span>
          <span class="fbar-item"><span>Sous-titres</span>
            <span class="mini-seg" id="g-sub"><button data-v="0">Non</button><button data-v="1" class="active">Oui</button></span></span>
          <span class="fbar-item"><span>Mode</span>
            <span class="mini-seg" id="g-mode"><button class="active" data-v="semi">Semi-manuel</button><button data-v="auto">100 % auto</button></span></span>
        </div>
        <div class="fbar mb" id="g-substyle" style="padding:10px 12px;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <span class="small muted">Sous-titres (bas-centre) :</span>
          <label class="field" style="margin:0"><span class="small">Police</span>
            <select id="g-sfont"><option>Arial</option><option>Verdana</option><option>Tahoma</option><option>Georgia</option><option>Impact</option><option>Comic Sans MS</option><option>Trebuchet MS</option></select></label>
          <label class="field" style="margin:0"><span class="small">Taille</span><input type="number" id="g-ssize" value="24" min="10" max="72" style="width:70px"></label>
          <label class="field" style="margin:0"><span class="small">Contour</span><input type="number" id="g-sout" value="2" min="0" max="6" style="width:70px"></label>
          <span class="field" style="margin:0"><span class="small">Couleur</span>
            <span class="row" id="g-scolors" style="gap:6px;padding:6px 0">
              ${SUB_COLORS.map((c, i) => `<button type="button" data-c="${c}" title="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};border:2px solid ${i === 0 ? "var(--accent)" : "rgba(255,255,255,.35)"};cursor:pointer;padding:0;flex:none;${i === 0 ? "outline:2px solid var(--accent);outline-offset:2px" : ""}"></button>`).join("")}
            </span></span>
          <span class="field" style="margin:0"><span class="small">Couleur du contour</span>
            <span class="row" id="g-socolors" style="gap:6px;padding:6px 0">
              ${["#000000", "#FFFFFF", "#1E293B", "#7F1D1D", "#14532D", "#4B2E83"].map((c, i) => `<button type="button" data-c="${c}" title="${c}" style="width:20px;height:20px;border-radius:50%;background:${c};border:2px solid ${i === 0 ? "var(--accent)" : "rgba(255,255,255,.35)"};cursor:pointer;padding:0;flex:none;${i === 0 ? "outline:2px solid var(--accent);outline-offset:2px" : ""}"></button>`).join("")}
            </span></span>
          <button type="button" class="btn btn-sm btn-accent" id="g-spreview-btn" style="align-self:flex-end" title="Prévisualisation réelle : position, taille, couleurs des sous-titres sur un écran 16:9">👁 Aperçu 16:9</button>
        </div>
        <div class="fbar mb" style="padding:10px 12px">
          <span class="fbar-item"><span>Publication auto</span>
            <span class="mini-seg" id="g-pub"><button class="${cfg.autoPublish ? "" : "active"}" data-v="0">Non</button><button class="${cfg.autoPublish ? "active" : ""}" data-v="1">Oui</button></span></span>
          <span class="fbar-item" id="g-pubchan-wrap" style="${cfg.autoPublish ? "" : "display:none"}"><span>Chaîne</span>
            <select id="g-pubchan" style="min-width:170px"><option value="">— choisis la chaîne —</option></select> <select id="g-pubpriv" style="width:150px" title="Mode de publication automatique"><option value="private" selected>🔒 Privée</option><option value="unlisted">🔗 Non répertoriée</option><option value="public">🌍 Publique</option></select></span>
          <span id="g-cost" style="margin-left:auto;font-weight:800;font-size:17px;color:#4ade80;background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.35);border-radius:10px;padding:9px 16px;white-space:nowrap"></span>
          <button class="btn btn-accent" id="g-go" style="font-size:14px;padding:10px 22px" ${noChars ? "disabled title='Crée d’abord 3 personnages'" : ""}>⚙ Générer</button>
        </div>
        <div class="small muted" style="text-align:right">Dialogues → Images → Voix → Clips → Montage → Packaging</div>`;

      const nSlider = body.querySelector("#g-n");
      const activeVal = (id) => body.querySelector(`#${id} button.active`).dataset.v;
      // Estimation fourchette : une scène dure entre 20 s (basse) et 40 s (haute) selon les dialogues.
      const fmtMin = (s) => (s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}min${String(Math.round(s % 60)).padStart(2, "0")}`);
      const costLine = () => {
        const n = Number(nSlider.value) || 6;
        body.querySelector("#g-nlbl").textContent = n;
        const seg = n + 2;
        const durLo = seg * 20, durHi = seg * 40;
        const lipOn = activeVal("g-lip") === "1", subOn = activeVal("g-sub") === "1";
        // Juste le prix, gros — fourchette et durée dans l'infobulle
        const est = (dur, chars) => seg * 0.03 + (seg * chars / 1000) * 0.1 + (subOn ? dur * 0.0008 : 0) + (lipOn ? (2 * (dur / seg) / 60) * 0.4 : 0) + 0.03;
        const lo = est(durLo, 300), hi = est(durHi, 600);
        const el2 = body.querySelector("#g-cost");
        el2.textContent = `≈ ${((lo + hi) / 2).toFixed(2)} $`;
        el2.title = `${seg} segments · durée ${fmtMin(durLo)}–${fmtMin(durHi)} · fourchette ${lo.toFixed(2)}$–${hi.toFixed(2)}$ (images + voix 0,10$/1000 car.${subOn ? " + Whisper" : ""}${lipOn ? " + lipsync 0,40$/min" : ""} + miniature)`;
      };
      nSlider.addEventListener("input", costLine);
      const seg = (id, cb) => body.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener("click", () => { body.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("active", x === b)); cb && cb(b.dataset.v); }));
      seg("g-mode", (v) => (mode = v));
      seg("g-lip", costLine);
      seg("g-sub", (v) => { body.querySelector("#g-substyle").style.display = v === "1" ? "" : "none"; costLine(); });
      costLine();

      // Couleurs des sous-titres (texte + contour) et APERÇU 16:9 réel (mêmes maths que le montage :
      // FontSize et MarginV sont en pixels de 720p → on scale par hauteurAperçu/720).
      let subColor = SUB_COLORS[0];
      let subOutColor = "#000000";
      const wireBubbles = (id, set) =>
        body.querySelectorAll(`#${id} button`).forEach((b) =>
          b.addEventListener("click", () => {
            set(b.dataset.c);
            body.querySelectorAll(`#${id} button`).forEach((x) => {
              const on = x === b;
              x.style.borderColor = on ? "var(--accent)" : "rgba(255,255,255,.35)";
              x.style.outline = on ? "2px solid var(--accent)" : "none";
              x.style.outlineOffset = on ? "2px" : "0";
            });
          })
        );
      wireBubbles("g-scolors", (c) => (subColor = c));
      wireBubbles("g-socolors", (c) => (subOutColor = c));
      body.querySelector("#g-spreview-btn").addEventListener("click", () => {
        const size = Number(body.querySelector("#g-ssize").value) || 24;
        const outline = Number(body.querySelector("#g-sout").value) || 0;
        const font = body.querySelector("#g-sfont").value;
        const overlay = document.createElement("div");
        overlay.className = "picker-overlay";
        overlay.innerHTML = `<div style="width:min(960px,94vw)">
          <div class="row between mb"><h2 style="margin:0;font-size:15px;color:#fff">👁 Aperçu sous-titres — taille et position réelles (16:9)</h2>
            <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
          <div id="sp-screen" style="position:relative;width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:
            radial-gradient(ellipse at 30% 35%, #3b4a6b 0%, transparent 55%),
            radial-gradient(ellipse at 75% 60%, #5b3a58 0%, transparent 50%),
            linear-gradient(160deg,#232c44,#10131f);border:1px solid var(--border-soft)">
            <div style="position:absolute;top:12px;left:14px;font-size:11px;color:rgba(255,255,255,.35)">scène (exemple)</div>
            <span id="sp-text" style="position:absolute;left:50%;transform:translateX(-50%);text-align:center;font-weight:700;white-space:nowrap"></span>
          </div>
          <div class="small muted" style="margin-top:6px;color:rgba(255,255,255,.6)">Police ${esc(font)} · taille ${size} · contour ${outline} — exactement ce que gravera le montage.</div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
        const screen = overlay.querySelector("#sp-screen");
        const t = overlay.querySelector("#sp-text");
        const scale = screen.getBoundingClientRect().height / 720; // PlayResY du montage = 720
        t.textContent = "Bonjour, bienvenue dans cette leçon !";
        t.style.fontFamily = font;
        t.style.fontSize = `${size * 1.35 * scale}px`; // 1.35 ≈ rapport libass FontSize→pixels réels
        t.style.color = subColor;
        t.style.bottom = `${22 * scale}px`; // MarginV=22
        t.style.webkitTextStroke = `${Math.max(0, outline) * scale * 1.2}px ${subOutColor}`;
        t.style.paintOrder = "stroke fill";
      });

      const pubChan = body.querySelector("#g-pubchan");
      const goBtn = body.querySelector("#g-go");
      const pubOn = () => activeVal("g-pub") === "1";
      const gateGo = () => {
        const blocked = noChars || (pubOn() && !pubChan.value);
        goBtn.disabled = blocked;
      };
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
          cfg = await api("/api/machines/linguistique", { method: "PATCH", body: { autoPublish: b.dataset.v === "1" } });
        })
      );
      gateGo();

      body.querySelector("#g-idea").addEventListener("click", async () => {
        const input = body.querySelector("#g-theme");
        const btn = body.querySelector("#g-idea");
        input.classList.add("ai-thinking"); input.disabled = true; input.value = ""; input.placeholder = "💡 Je fouille la niche…";
        btn.disabled = true; btn.textContent = "⏳";
        try {
          const idea = await api("/api/machines/linguistique/idea", { method: "POST", body: { sceneCount: Number(nSlider.value) || 6 } });
          input.value = idea.text || idea.theme || "";
          if (idea.pitch) AgentOS.toast("💡 " + idea.pitch, "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
        input.classList.remove("ai-thinking"); input.disabled = false;
        input.placeholder = "ex : À l'aéroport — enregistrement et embarquement";
        btn.disabled = false; btn.textContent = "💡 Idée";
      });

      body.querySelector("#g-go").addEventListener("click", async () => {
        const text = body.querySelector("#g-theme").value.trim();
        try {
          const run = await api("/api/machines/linguistique/runs", {
            method: "POST",
            body: {
              presenterId: body.querySelector("#g-pres").value,
              protagonistIds: [body.querySelector("#g-pa").value, body.querySelector("#g-pb").value],
              theme: text ? { text } : null,
              language: body.querySelector("#g-lang").value,
              chainLanguage: body.querySelector("#g-chainlang").value,
              level: body.querySelector("#g-level").value,
              sceneCount: Number(nSlider.value) || 6,
              lipsync: activeVal("g-lip") === "1",
              subtitles: activeVal("g-sub") === "1",
              subStyle: { font: body.querySelector("#g-sfont").value, size: Number(body.querySelector("#g-ssize").value) || 24, outline: Number(body.querySelector("#g-sout").value), color: subColor, outlineColor: subOutColor, position: "bottom-center" },
              mode,
              publishChannelId: pubOn() ? pubChan.value : null,
              publishPrivacy: (body.querySelector("#g-pubpriv") || {}).value || "private",
            },
          });
          openWizard(run.id);
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
    }

    // ═══════════ WIZARD ═══════════
    const STEPS = [
      { key: "prompts", icon: "💬", label: "Dialogues" },
      { key: "images", icon: "🖼", label: "Images" },
      { key: "voices", icon: "🔊", label: "Voix" },
      { key: "videos", icon: "🎬", label: "Vidéos" },
      { key: "montage", icon: "🎞", label: "Montage" },
    ];
    // Une étape est « faite » quand elle a VRAIMENT produit ses artefacts — pas quand le run
    // est passé au-delà. Avant, le ✓ vert ne lisait que le statut : le run rms69ual7 affichait
    // Vidéos ✓ et Montage ✓ avec 0 clip sur 27. Un ⚠ signale désormais l'étape franchie à trou.
    function stepDone(run, i) {
      const sc = run.scenes || [];
      if (!sc.length) return false;
      if (i === 0) return sc.every((s) => (s.role === "dialogue" ? s.turns && s.turns.length : s.narration) && s.image_prompt);
      if (i === 1) return sc.every((s) => s.image);
      if (i === 2) return sc.every((s) => s.audio);
      if (i === 3) return sc.every((s) => s.video);
      return !!run.finalRel;
    }
    function stepIndex(status) {
      if (status.startsWith("prompts")) return 0;
      if (status.startsWith("images")) return 1;
      if (status.startsWith("voices")) return 2;
      if (status.startsWith("videos")) return 3;
      if (status.startsWith("montage")) return 4;
      return 5; // packaging_running, done
    }
    function openWizard(runId) {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal lg" id="wiz"><span class="spin"></span></div>`;
      document.body.appendChild(overlay);
      const tick = async () => {
        let run;
        try {
          run = await api("/api/machines/linguistique/runs/" + runId);
        } catch (e) {
          overlay.querySelector("#wiz").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
          return;
        }
        const box = overlay.querySelector("#wiz");
        // Les compteurs d'artefacts entrent dans la clé : le rail (✓ / ⚠) doit suivre ce qui est
        // RÉELLEMENT produit, pas seulement les changements de statut.
        const sc = run.scenes || [];
        const nb = (f) => sc.filter((s) => s[f]).length;
        const shellKey = `${run.status}|${box.dataset.view || ""}|${sc.length}|${run.error ? 1 : 0}|${nb("image")}|${nb("audio")}|${nb("video")}|${run.finalRel ? 1 : 0}`;
        if (box.dataset.shellKey !== shellKey || !box.querySelector(".wiz-scroll")) {
          box.dataset.shellKey = shellKey;
          renderWizard(box, run, overlay);
        } else {
          patchWizard(box, run, overlay);
        }
        if (!["done", "failed"].includes(run.status) && document.body.contains(overlay)) {
          clearTimeout(wizTimer);
          wizTimer = setTimeout(tick, 4000);
        }
      };
      tick();
    }
    function globalPct(run) {
      const n = run.scenes?.length || 1;
      const img = run.scenes ? run.scenes.filter((s) => s.image).length : 0;
      const aud = run.scenes ? run.scenes.filter((s) => s.audio).length : 0;
      const vid = run.scenes ? run.scenes.filter((s) => s.video).length : 0;
      switch (run.status) {
        case "prompts_running": return 8;
        case "prompts_ready": return 14;
        case "images_running": return 14 + Math.round((22 * img) / n);
        case "images_ready": return 38;
        case "voices_running": return 38 + Math.round((20 * aud) / n);
        case "voices_ready": return 58;
        case "videos_running": return 58 + Math.round((20 * vid) / n);
        case "videos_ready": return 80;
        case "montage_running": return 86;
        case "packaging_running": return 93;
        case "done": return 100;
        case "failed": return img || aud || vid ? 40 : 8;
        default: return 5;
      }
    }
    function updateBars(box) {
      box.querySelectorAll("[data-prog]").forEach((w) => {
        const t0 = stepStarts.get(w.dataset.prog);
        if (!t0) return;
        const pct = Math.min(95, Math.round((Date.now() - t0) / 10 / Number(w.dataset.expect)));
        const bar = w.querySelector(".progress > div");
        if (bar) bar.style.width = pct + "%";
        const lb = w.querySelector(".prog-pct");
        if (lb) lb.textContent = pct + "%";
      });
    }
    function countHTML(run) {
      const n = run.scenes ? run.scenes.length : 0;
      if (!n) return "";
      const live = run.scenes.filter((s) => s.rendering).length;
      const c = (field, icon, word) => {
        const done = run.scenes.filter((s) => s[field]).length;
        const fail = run.scenes.filter((s) => !s[field] && s.error).length;
        return `${icon} ${done}/${n} ${word}${live ? ` · ${live} en cours` : ""}${fail ? ` · <span style="color:var(--err)">${fail} échec</span>` : ""}`;
      };
      if (run.status.startsWith("images")) return c("image", "🖼", "images");
      if (run.status.startsWith("voices")) return c("audio", "🔊", "voix");
      if (run.status.startsWith("videos")) return c("video", "🎬", "clips");
      if (run.status.startsWith("prompts")) return `💬 ${n} segment(s)`;
      return "";
    }
    function progHTML(key, expectSec, label) {
      if (!stepStarts.has(key)) stepStarts.set(key, Date.now());
      const pct = Math.min(95, Math.round((Date.now() - stepStarts.get(key)) / 10 / expectSec));
      return `<div data-prog="${key}" data-expect="${expectSec}" style="width:100%;padding:12px 2px"><div class="small muted mb">${label}</div>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="small muted prog-pct" style="text-align:right;margin-top:3px">${pct}%</div></div>`;
    }
    function canRegenView(run, viewIdx) {
      return (
        (viewIdx === 0 && run.status === "prompts_ready") ||
        (viewIdx === 1 && run.status === "images_ready") ||
        (viewIdx === 2 && run.status === "voices_ready") ||
        (viewIdx === 3 && run.status === "videos_ready")
      );
    }
    function sceneSig(run, s, viewIdx) {
      const media =
        viewIdx === 1 ? ((s.image && s.image.rel) || "") + ":" + ((s.image && s.image.ts) || "")
        : viewIdx === 2 ? ((s.audio && s.audio.rel) || "") + ":" + ((s.audio && s.audio.ts) || "")
        : viewIdx === 3 ? ((s.video && s.video.rel) || "") + ":" + ((s.video && s.video.ts) || "")
        : "";
      const txt = viewIdx === 0 ? `${(s.narration || "").length}:${(s.turns ? s.turns.length : 0)}:${(s.image_prompt || "").length}` : "";
      return [viewIdx, run.status, s.role || "", media, txt, s.rendering ? 1 : 0, s.pending ? 1 : 0, s.error ? 1 : 0, regenning.has(run.id + ":" + s.i) ? 1 : 0].join("~");
    }
    const roleChip = (s) =>
      s.role === "dialogue"
        ? `<span class="badge accent" style="font-size:9px">💬 ${esc(s.scene_title || "dialogue")}</span>`
        : `<span class="badge" style="font-size:9px;background:var(--accent);color:#111">🎤 ${s.role === "intro" ? "Intro" : "Outro"} · présentateur</span>`;

    function dialogueHTML(run, s) {
      const { P, A, B } = { P: run.params.presenterId, A: (run.params.protagonistIds || [])[0], B: (run.params.protagonistIds || [])[1] };
      const nameOf = (id) => (cfg.characters.find((c) => c.id === id) || {}).name || "?";
      const voiceOf = (id) => (cfg.characters.find((c) => c.id === id) || {}).voice || "";
      if (s.role !== "dialogue") return `<div class="small" style="margin:5px 0"><b style="color:${voiceColor(voiceOf(P))}">🎙 ${esc(nameOf(P))}</b> : ${esc(s.narration || "")}</div>`;
      return `<div class="small" style="margin:5px 0;line-height:1.5">${(s.turns || []).map((t) => { const id = t.speaker === "B" ? B : A; return `<div><b style="color:${voiceColor(voiceOf(id))}">🎙 ${esc(nameOf(id))}</b> : ${esc(t.text)}</div>`; }).join("")}</div>`;
    }

    function sceneCard(run, s, viewIdx, box) {
      const regKey = run.id + ":" + s.i;
      const isReg = regenning.has(regKey) || !!s.pending;
      const canRegen = canRegenView(run, viewIdx);
      const openAccs = new Set([...box.querySelectorAll("details[data-acc][open]")].map((d) => d.dataset.acc));
      const val = (box.querySelector(`[data-instr="${s.i}"]`) || {}).value || "";
      const errBox = `<div class="empty small" style="color:var(--err)"><b>⚠ Échec</b>${esc(s.error || "")}<br><span class="muted">Régénère la scène (↻ ci-dessous).</span></div>`;
      const imgCell = isReg && viewIdx === 1
        ? progHTML("rg-img:" + regKey, 150, "🖼 Régénération de l'image…")
        : s.image ? `<img src="/media/${encodeURIComponent(s.image.rel)}${s.image.ts ? "?v=" + s.image.ts : ""}" style="width:100%;border-radius:8px;margin:6px 0">`
        : s.rendering ? progHTML("img:" + regKey, 150, "🖼 Génération en cours…")
        : s.error ? errBox
        : run.status === "images_running" ? `<div class="empty small" style="opacity:.7">⏳ En file d'attente…</div>`
        : `<div class="empty small">Pas encore générée</div>`;
      const audCell = isReg && viewIdx === 2
        ? progHTML("rg-aud:" + regKey, 90, "🔊 Régénération de la voix…")
        : s.audio ? `<audio src="/media/${encodeURIComponent(s.audio.rel)}${s.audio.ts ? "?v=" + s.audio.ts : ""}" controls style="width:100%;margin:6px 0"></audio>${s.audio.duration ? `<div class="small muted">⏱ ${Math.round(s.audio.duration)}s</div>` : ""}`
        : s.rendering ? progHTML("aud:" + regKey, 90, "🔊 ElevenLabs génère la voix…")
        : s.error ? errBox
        : run.status === "voices_running" ? `<div class="empty small" style="opacity:.7">⏳ En file d'attente…</div>`
        : `<div class="empty small">Pas encore générée</div>`;
      const vidCell = isReg && viewIdx === 3
        ? progHTML("rg-vid:" + regKey, 200, "🎬 Régénération du clip…")
        : s.video ? `<video src="/media/${encodeURIComponent(s.video.rel)}${s.video.ts ? "?v=" + s.video.ts : ""}" controls style="width:100%;border-radius:8px;margin:6px 0"></video>`
        : s.rendering ? progHTML("vid:" + regKey, 200, "🎬 Assemblage du clip…")
        : s.error ? errBox
        : run.status === "videos_running" ? `<div class="empty small" style="opacity:.7">⏳ En file d'attente…</div>`
        : `<div class="empty small">Pas encore assemblé</div>`;
      const regenRow = canRegen
        ? `<div class="row" style="gap:5px;margin-top:6px"><input type="text" data-instr="${s.i}" value="${esc(val)}" placeholder="Instructions de modif…" style="flex:1;font-size:11px"><button class="mini-btn" data-regen="${s.i}" title="Régénérer (noyau dur conservé)">↻</button></div>`
        : "";
      const body =
        (viewIdx === 0
          ? isReg
            ? progHTML("rg-pr:" + regKey, 90, "💬 Claude réécrit la scène…")
            : `${dialogueHTML(run, s)}
               <details class="small muted" data-acc="ip-${s.i}" ${openAccs.has("ip-" + s.i) ? "open" : ""}><summary>🖼 prompt image</summary><div class="wiz-prompt">${esc(s.image_prompt)}</div></details>`
          : "") +
        (viewIdx === 1 ? imgCell : "") +
        (viewIdx === 2 ? audCell : "") +
        (viewIdx === 3 ? vidCell : "");
      const done = (viewIdx === 1 && s.image) || (viewIdx === 2 && s.audio) || (viewIdx === 3 && s.video);
      const failed = s.error && ((viewIdx === 1 && !s.image) || (viewIdx === 2 && !s.audio) || (viewIdx === 3 && !s.video));
      const tag = isReg ? `<span class="badge warn">⏳</span>` : done ? `<span class="badge ok">✓</span>` : failed ? `<span class="badge err">✗</span>` : "";
      return `<div class="card ${isReg ? "ai-thinking" : ""}" data-cell="${s.i}" data-sig="${esc(sceneSig(run, s, viewIdx))}" style="padding:10px"><div class="row between"><b class="small">Scène ${s.i} ${tag}</b>${roleChip(s)}</div>${body}${regenRow}</div>`;
    }
    function wireRegen(scope, run, overlay, box) {
      scope.querySelectorAll("[data-regen]").forEach((b) =>
        b.addEventListener("click", async () => {
          const i = b.dataset.regen;
          const instructions = box.querySelector(`[data-instr="${i}"]`).value.trim();
          const step = run.status.startsWith("videos") ? "videos" : run.status.startsWith("voices") ? "voices" : run.status.startsWith("images") ? "images" : "prompts";
          b.disabled = true;
          const key = run.id + ":" + i;
          ["rg-pr:", "rg-img:", "rg-aud:", "rg-vid:"].forEach((p) => stepStarts.delete(p + key));
          regenning.set(key, Date.now());
          renderWizard(box, run, overlay);
          try {
            await api(`/api/machines/linguistique/runs/${run.id}/regen`, { method: "POST", body: { scene: Number(i), step, instructions } });
            AgentOS.toast(`Scène ${i} régénérée`, "ok");
          } catch (e) { AgentOS.toast(e.message, "err"); }
          regenning.delete(key);
        })
      );
    }
    function missField(status) {
      return status === "images_ready" ? "image" : status === "voices_ready" ? "audio" : status === "videos_ready" ? "video" : null;
    }
    function patchWizard(box, run, overlay) {
      const viewIdx = box.dataset.view !== undefined && box.dataset.view !== "" ? Number(box.dataset.view) : Math.min(stepIndex(run.status), 5);
      const gb = box.querySelector(".wiz-gbar > div");
      if (gb) gb.style.width = globalPct(run) + "%";
      const gc = box.querySelector("#wiz-count");
      if (gc) gc.innerHTML = countHTML(run);
      (run.scenes || []).forEach((s) => {
        const cell = box.querySelector(`[data-cell="${s.i}"]`);
        if (!cell) return;
        if (cell.dataset.sig !== sceneSig(run, s, viewIdx)) {
          const tmp = document.createElement("div");
          tmp.innerHTML = sceneCard(run, s, viewIdx, box);
          const nw = tmp.firstElementChild;
          cell.replaceWith(nw);
          wireRegen(nw, run, overlay, box);
        }
      });
      const vbtn = box.querySelector("[data-validate]");
      if (vbtn) {
        const mf = missField(run.status);
        const pend = mf ? run.scenes.filter((s) => !s[mf]) : [];
        const busy = (run.scenes || []).filter((s) => s.pending || s.rendering || regenning.has(run.id + ":" + s.i));
        vbtn.disabled = !!(pend.length || busy.length);
        const msg = box.querySelector(".wiz-foot > span");
        if (msg) {
          if (pend.length) msg.outerHTML = `<span class="small" style="color:var(--err)">⚠ ${pend.length} manquant(s) (scène ${pend.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.</span>`;
          else if (busy.length) msg.outerHTML = `<span class="small" style="color:var(--accent)">⏳ Régénération en cours (scène ${busy.map((s) => s.i).join(", ")}) — patiente avant de valider.</span>`;
          else msg.outerHTML = `<span class="small muted">Inspecte, corrige scène par scène, puis valide pour avancer.</span>`;
        }
      }
      updateBars(box);
    }
    function renderWizard(box, run, overlay) {
      const idx = stepIndex(run.status);
      const running = run.status.endsWith("_running");
      const viewIdx = box.dataset.view !== undefined && box.dataset.view !== "" ? Number(box.dataset.view) : Math.min(idx, 5);
      const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.instr : null;
      const prevScroll = box.querySelector(".wiz-scroll")?.scrollTop || 0;
      const validateLabel = {
        prompts_ready: "✓ Valider les dialogues → Images",
        images_ready: "✓ Valider les images → Voix",
        voices_ready: "✓ Valider les voix → Vidéos",
        videos_ready: "✓ Valider les clips → Montage",
      }[run.status];
      const mf = missField(run.status);
      const pending = mf ? run.scenes.filter((s) => !s[mf]) : [];
      const regenBusy = (run.scenes || []).filter((s) => s.pending || s.rendering || regenning.has(run.id + ":" + s.i));
      const gpct = globalPct(run);
      box.classList.add("wiz-modal");
      const runMsg = {
        prompts_running: "Claude écrit les dialogues…",
        images_running: "Génération des images (8 en parallèle)…",
        voices_running: "ElevenLabs génère les voix (4 en parallèle)…",
        videos_running: "FFmpeg assemble les clips…",
        montage_running: "Montage final (concat + sous-titres + CTA)…",
        packaging_running: "Claude prépare titre, description, tags et miniature…",
      }[run.status] || "";
      box.innerHTML = `
        <div class="wiz-head">
          <div class="wiz-gbar" title="Progression : ${gpct}%"><div style="width:${gpct}%"></div></div>
          <div class="row between" style="margin:10px 0 4px">
            <h2 style="margin:0;font-size:15px">🗣 ${esc(run.theme?.title || (run.theme?.text) || "Le thème arrive…")}
              <span class="small muted mono" style="margin-left:8px">${run.id} · ${run.mode} · ${esc(run.params.language || "")} ${esc(run.params.level || "")} · ${gpct}%</span></h2>
            <span class="row" style="gap:6px">
              ${run.status !== "done" ? `<button class="btn btn-sm" data-zap-run title="⚡ Décharge : relance le run là où il s'est arrêté (refusé s'il tourne déjà)">⚡</button>` : ""}
              ${!["done", "failed"].includes(run.status) ? `<button class="btn btn-sm" data-cancel-run title="Annuler ce run">🛑 Annuler</button>` : ""}
              <button class="btn btn-sm btn-ghost" data-close>✕</button>
            </span>
          </div>
          <div class="wiz-rail">
            ${STEPS.map((s, i) => `
              <div class="wiz-step ${stepDone(run, i) ? "done" : i === idx ? "active" : ""}" data-view="${i}" style="cursor:pointer" title="${stepDone(run, i) ? "Voir" : i < idx ? "⚠ Étape incomplète — voir" : "Voir"} ${s.label.toLowerCase()}">
                <div class="wiz-dot" ${i === viewIdx ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}${!stepDone(run, i) && i < idx ? ' data-gap="1"' : ""}>${stepDone(run, i) ? "✓" : i < idx ? "⚠" : s.icon}</div><span>${s.label}</span>
              </div>
              ${i < STEPS.length - 1 ? `<div class="wiz-link ${stepDone(run, i) ? "done" : i === idx && running ? "active" : ""}"></div>` : ""}`).join("")}
            <div class="wiz-link ${run.status === "done" ? "done" : run.status === "packaging_running" ? "active" : ""}"></div>
            <div class="wiz-step ${run.status === "done" ? "done" : ""}" data-view="5" style="cursor:pointer" title="Titre, description, tags, miniature, publication">
              <div class="wiz-dot" ${viewIdx === 5 ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>🏁</div><span>Fini</span>
            </div>
          </div>
          ${run.error ? `<div class="empty small" style="color:var(--err);margin:0"><b>Échec</b>${esc(run.error)} <button class="btn btn-sm" data-retry>↻ Reprendre où on s'est arrêté</button></div>` : ""}
          ${running ? `<div class="small muted"><span class="spin" style="width:12px;height:12px"></span> ${runMsg}</div>` : ""}
          <div id="wiz-count" class="small" style="font-weight:600;color:var(--accent)">${countHTML(run)}</div>
        </div>
        <div class="wiz-scroll">
        ${(() => {
          if (viewIdx === 4) {
            return run.finalRel
              ? `<video src="/media/${encodeURIComponent(run.finalRel)}" controls style="width:100%;max-height:430px;border-radius:12px;background:#000"></video>
                <div class="row between mt"><span class="small muted">Coût : ${(run.cost.images + run.cost.voices + run.cost.videos).toFixed(2)}$ · ${run.scenes.length} segments</span>
                  <a class="btn btn-sm btn-accent" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger</a></div>`
              : run.status === "montage_running"
              ? `<div class="empty small"><span class="spin"></span> Montage en cours (concat + sous-titres + CTA)…</div>`
              : `<div class="empty small">Le montage n'est pas encore rendu.</div>`;
          }
          if (viewIdx === 5) {
            if (!run.pack) {
              if (run.status === "packaging_running") return `<div class="empty small"><span class="spin"></span> Claude prépare titre, description, tags et miniature…</div>`;
              if (run.finalRel) return `<div class="empty small">Packaging pas encore généré.<br><button class="btn btn-sm btn-accent mt" data-packaging>⚙ Générer titre + description + tags + miniature</button></div>`;
              return `<div class="empty small">La vidéo n'est pas encore montée.</div>`;
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
                  <div class="small muted" style="text-align:center;margin-top:4px">Miniature</div>
                  <div class="row" style="gap:5px;margin-top:6px">
                    <input type="text" id="pk-thumb-instr" placeholder="Observation (optionnel)…" style="flex:1;font-size:11px">
                    <button class="mini-btn" id="pk-thumb-regen" title="Régénérer la miniature">🎨 Régénérer</button>
                  </div>
                  ${run.finalRel ? `<a class="btn btn-sm btn-ghost" style="width:100%;margin-top:8px;text-align:center" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger la vidéo</a>` : ""}
                </div>
                <div class="grow" style="min-width:0">
                  <input type="text" id="pk-text-instr" placeholder="Observation pour régénérer un texte (optionnel)…" style="width:100%;font-size:11px;margin-bottom:8px">
                  <label class="field"><span class="row between">Titre <span class="row" style="gap:5px"><span class="small muted mono">${(pk.title || "").length}/100</span><button class="mini-btn" data-copy="pk-title">📋</button><button class="mini-btn" data-regen-text="title">↻💡</button></span></span><input type="text" id="pk-title" value="${esc(pk.title || "")}"></label>
                  <label class="field"><span class="row between">Description <span class="row" style="gap:5px"><button class="mini-btn" data-copy="pk-desc">📋</button><button class="mini-btn" data-regen-text="description">↻💡</button></span></span><textarea id="pk-desc" rows="5">${esc(pk.description || "")}</textarea></label>
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
                  <div class="small muted" style="margin-top:6px">📦 Sans publication, la vidéo reste dans le <b>Stock</b>. Par défaut elle part en <b>privé</b> — passe-la en publique quand tu l'as décidé.</div>
                </div>
              </div>`;
          }
          if (!run.scenes.length) return `<div class="empty small">Les dialogues arrivent…</div>`;
          return `<div class="grid grid-3 mt" id="wiz-cells">${run.scenes.map((s) => sceneCard(run, s, viewIdx, box)).join("")}</div>`;
        })()}
        </div>
        ${validateLabel ? `<div class="wiz-foot">
          ${pending.length
            ? `<span class="small" style="color:var(--err)">⚠ ${pending.length} manquant(s) (scène ${pending.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.</span>`
            : regenBusy.length
            ? `<span class="small" style="color:var(--accent)">⏳ Régénération en cours (scène ${regenBusy.map((s) => s.i).join(", ")}) — patiente avant de valider.</span>`
            : `<span class="small muted">Inspecte, corrige scène par scène, puis valide pour avancer.</span>`}
          <button class="btn btn-accent" data-validate ${pending.length || regenBusy.length ? "disabled" : ""} style="margin-left:auto;font-size:13.5px;padding:10px 20px">${validateLabel}</button>
        </div>` : ""}`;
      const scroller = box.querySelector(".wiz-scroll");
      if (scroller) scroller.scrollTop = prevScroll;
      box.querySelector("[data-close]").addEventListener("click", () => { clearTimeout(wizTimer); overlay.remove(); if (tab === "runs") shell(); });
      const reopen = () => { clearTimeout(wizTimer); overlay.remove(); openWizard(run.id); };
      const cx = box.querySelector("[data-cancel-run]");
      if (cx) cx.addEventListener("click", async () => {
        cx.disabled = true;
        try { await api(`/api/machines/linguistique/runs/${run.id}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); reopen(); }
        catch (err) { AgentOS.toast(err.message, "err"); cx.disabled = false; }
      });
      const zp = box.querySelector("[data-zap-run]");
      if (zp) zp.addEventListener("click", async () => {
        zp.disabled = true; zp.textContent = "⏳";
        try { await api(`/api/machines/linguistique/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok"); reopen(); }
        catch (err) { AgentOS.toast(err.message, "err"); zp.disabled = false; zp.textContent = "⚡"; }
      });
      box.querySelectorAll(".wiz-step[data-view]").forEach((s) => s.addEventListener("click", () => { box.dataset.view = s.dataset.view; renderWizard(box, run, overlay); }));
      const rt = box.querySelector("[data-retry]");
      if (rt) rt.addEventListener("click", async () => {
        rt.disabled = true;
        try { const r = await api(`/api/machines/linguistique/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("Reprise ↻", "ok"); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); rt.disabled = false; }
      });
      const pkg = box.querySelector("[data-packaging]");
      if (pkg) pkg.addEventListener("click", async () => {
        pkg.disabled = true;
        await api(`/api/machines/linguistique/runs/${run.id}/resume`, { method: "POST", body: { status: "packaging_running" } });
        AgentOS.toast("Packaging lancé ⚙", "ok");
        delete box.dataset.shellKey; clearTimeout(wizTimer); wizTimer = setTimeout(() => openWizard(run.id), 1500); overlay.remove();
      });
      const pubBtn = box.querySelector("[data-publish]");
      if (pubBtn) {
        const sel = box.querySelector("#pk-chan");
        api("/api/channels").then((chs) => { sel.innerHTML = `<option value="">— chaîne YouTube —</option>` + chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join(""); }).catch(() => {});
        sel.addEventListener("change", () => (pubBtn.disabled = !sel.value));
        pubBtn.addEventListener("click", async () => {
          pubBtn.disabled = true; pubBtn.textContent = "⏳ Upload…";
          try {
            const r = await api(`/api/machines/linguistique/runs/${run.id}/publish`, { method: "POST", body: { channelId: sel.value, privacyStatus: (box.querySelector("#pk-priv") || {}).value || "private", title: box.querySelector("#pk-title").value.trim(), description: box.querySelector("#pk-desc").value, tags: box.querySelector("#pk-tags").value.split(",").map((t) => t.trim()).filter(Boolean) } });
            AgentOS.toast("📤 Publiée : " + r.url, "ok");
          } catch (e) { AgentOS.toast(e.message, "err"); }
          pubBtn.textContent = "📤 Publier"; pubBtn.disabled = false;
        });
      }
      const v = box.querySelector("[data-validate]");
      if (v) v.addEventListener("click", async () => {
        v.disabled = true;
        try { await api(`/api/machines/linguistique/runs/${run.id}/validate`, { method: "POST" }); AgentOS.toast("Étape validée ⚙", "ok"); }
        catch (e) { AgentOS.toast(e.message, "err"); v.disabled = false; }
      });
      box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
        const field = box.querySelector("#" + b.dataset.copy);
        if (!field) return;
        try { await navigator.clipboard.writeText(field.value); } catch { field.select(); document.execCommand("copy"); }
        const old = b.textContent; b.textContent = "✓"; setTimeout(() => (b.textContent = old), 1200);
      }));
      box.querySelectorAll("[data-regen-text]").forEach((b) => b.addEventListener("click", async () => {
        const field = b.dataset.regenText;
        const instructions = (box.querySelector("#pk-text-instr") || {}).value || "";
        const old = b.textContent; b.disabled = true; b.textContent = "⏳";
        try { const r = await api(`/api/machines/linguistique/runs/${run.id}/texts`, { method: "POST", body: { instructions, field } }); AgentOS.toast("Régénéré 🔄", "ok"); box.dataset.view = "5"; renderWizard(box, r, overlay); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = old; }
      }));
      const thumbBtn = box.querySelector("#pk-thumb-regen");
      if (thumbBtn) thumbBtn.addEventListener("click", async () => {
        const instructions = (box.querySelector("#pk-thumb-instr") || {}).value || "";
        thumbBtn.disabled = true; thumbBtn.textContent = "⏳…";
        const preview = box.querySelector("#pk-thumb");
        if (preview) preview.innerHTML = `<div class="char-ph ai-thinking" style="width:290px;height:163px"><span class="spin"></span></div>`;
        try { const r = await api(`/api/machines/linguistique/runs/${run.id}/thumbnail`, { method: "POST", body: { instructions } }); AgentOS.toast("Miniature régénérée 🎨", "ok"); box.dataset.view = "5"; renderWizard(box, r, overlay); }
        catch (e) { AgentOS.toast(e.message, "err"); thumbBtn.disabled = false; thumbBtn.textContent = "🎨 Régénérer"; }
      });
      wireRegen(box, run, overlay, box);
      if (focus) box.querySelector(`[data-instr="${focus}"]`)?.focus();
    }

    // ═══════════ Onglet Personnages ═══════════
    function renderChars() {
      const body = el.querySelector("#ling-body");
      body.innerHTML = `
        <div class="small muted mb">Un run utilise 3 personnages : 1 présentateur + 2 protagonistes. Chacun a une image de référence, un sexe et une voix ElevenLabs.</div>
        <div class="grid grid-2">
          ${cfg.characters.map((c) => `
            <div class="char-card">
              ${c.referenceRel ? `<img src="/media/${encodeURIComponent(c.referenceRel)}">` : `<span class="char-ph">👤</span>`}
              <div class="grow" style="min-width:0">
                <div class="row between"><b>${esc(c.name)}</b>
                  <span class="row" style="gap:5px"><button class="mini-btn" data-regenref="${c.id}" title="Régénérer l'image de référence en 16:9 (cadrage selon le rôle)">🔄 16:9</button><button class="mini-btn" data-edit="${c.id}">✎</button><button class="icon-btn" data-del="${c.id}">✕</button></span></div>
                <span class="badge accent" style="margin:4px 0">${c.presenter ? "🎤 " + (c.sex === "F" ? "Présentatrice" : "Présentateur") : c.sex === "F" ? "♀ Femme" : "♂ Homme"} · ${voiceChip(c.voice)}</span>
                <div class="small muted" style="margin-top:4px">${esc((c.appearance || "").slice(0, 110))}</div>
              </div>
            </div>`).join("")}
          <button class="bank-folder" id="btn-newchar" style="display:flex;align-items:center;justify-content:center;min-height:110px;font-size:14px;font-weight:700;color:var(--accent)">＋ Nouveau personnage</button>
        </div>`;
      body.querySelector("#btn-newchar").addEventListener("click", () => charDialog(null));
      body.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => charDialog(cfg.characters.find((c) => c.id === b.dataset.edit))));
      body.querySelectorAll("[data-regenref]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          const old = b.textContent;
          b.textContent = "⏳";
          try {
            await api(`/api/machines/linguistique/characters/${b.dataset.regenref}/regen-ref`, { method: "POST" });
            cfg = await api("/api/machines/linguistique");
            AgentOS.toast("Image régénérée en 16:9 🔄", "ok");
            renderChars();
          } catch (e) {
            AgentOS.toast(e.message, "err");
            b.disabled = false;
            b.textContent = old;
          }
        })
      );
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
        await api("/api/machines/linguistique/characters/" + b.dataset.del, { method: "DELETE" });
        cfg = await api("/api/machines/linguistique"); renderChars();
      }));
    }
    function charDialog(existing) {
      const c = existing || { name: "", appearance: "", sex: "F", presenter: false, voice: "", referenceRel: "" };
      // Un seul menu « Sexe / rôle » encode le sexe (F/M, pour filtrer les voix) + le flag présentateur.
      const R2SP = { F: { sex: "F", presenter: false }, M: { sex: "M", presenter: false }, presenterF: { sex: "F", presenter: true }, presenterM: { sex: "M", presenter: true } };
      const sexOf = (v) => (R2SP[v] || R2SP.F).sex;
      const roleVal = c.presenter ? (c.sex === "M" ? "presenterM" : "presenterF") : c.sex === "M" ? "M" : "F";
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      const voiceOpts = (sex, sel) => voicesFor(sex).map((v) => `<option ${sel === v ? "selected" : ""}>${v}</option>`).join("");
      overlay.innerHTML = `<div class="scrap-modal" style="width:min(760px,94vw);max-height:88vh;overflow-y:auto">
        <div class="row between mb"><h2 style="margin:0;font-size:15px">${existing ? "✎ Modifier" : "＋ Créer"} un personnage</h2>
          <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
        <div class="row mb" style="gap:14px;align-items:flex-start">
          <div style="flex:none;text-align:center">
            <div id="cd-preview">${c.referenceRel ? `<img src="/media/${encodeURIComponent(c.referenceRel)}" style="width:110px;height:110px;border-radius:14px;object-fit:cover;border:2px solid var(--accent)">` : `<span class="char-ph" style="width:110px;height:110px">👤</span>`}</div>
            <div class="small muted" style="margin-top:5px">Image de référence</div>
            <div class="row" style="gap:5px;margin-top:6px;justify-content:center">
              <label class="mini-btn" style="cursor:pointer">📁 Choisir<input type="file" id="cd-file" accept="image/*" style="display:none"></label>
              <button class="mini-btn" id="cd-gen">🎨 IA</button>
            </div>
            <button class="mini-btn" id="cd-ai-all" style="margin-top:6px;width:100%" title="L'IA enrichit l'apparence">💡 Compléter l'apparence</button>
          </div>
          <div class="grow">
            <label class="field"><span>Nom</span><input type="text" id="cd-name" value="${esc(c.name)}"></label>
            <div class="grid grid-2">
              <label class="field"><span>Sexe / rôle</span>
                <select id="cd-role">
                  <option value="F" ${roleVal === "F" ? "selected" : ""}>♀ Femme (actrice)</option>
                  <option value="M" ${roleVal === "M" ? "selected" : ""}>♂ Homme (acteur)</option>
                  <option value="presenterF" ${roleVal === "presenterF" ? "selected" : ""}>🎤 Présentatrice (féminin)</option>
                  <option value="presenterM" ${roleVal === "presenterM" ? "selected" : ""}>🎤 Présentateur (masculin)</option>
                </select></label>
              <label class="field"><span>Voix (ElevenLabs v3)</span>
                <select id="cd-voice">${voiceOpts(sexOf(roleVal), c.voice)}</select></label>
            </div>
            <div class="small muted" style="margin:-4px 0 8px">🎤 « Présentateur/trice » = image en plan rapproché (tête/buste) pour un bon lip-sync ; les autres = plan moyen.</div>
            <label class="field"><span>Apparence (base de l'image — anglais)</span>
              <textarea id="cd-app" rows="4" placeholder="ex : friendly woman, 30s — le 💡 enrichira">${esc(c.appearance)}</textarea></label>
          </div>
        </div>
        <button class="btn btn-accent" id="cd-save" style="width:100%">${existing ? "Enregistrer" : "Créer le personnage"}</button>
      </div>`;
      document.body.appendChild(overlay);
      let referenceRel = c.referenceRel || "";
      const setPreview = () => {
        overlay.querySelector("#cd-preview").innerHTML = referenceRel
          ? `<img src="/media/${encodeURIComponent(referenceRel)}" style="width:110px;height:110px;border-radius:14px;object-fit:cover;border:2px solid var(--accent)">`
          : `<span class="char-ph" style="width:110px;height:110px">👤</span>`;
      };
      overlay.querySelector("[data-close]").addEventListener("click", () => overlay.remove());
      overlay.querySelector("#cd-role").addEventListener("change", (e) => {
        overlay.querySelector("#cd-voice").innerHTML = voiceOpts(sexOf(e.target.value), "");
      });
      overlay.querySelector("#cd-file").addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = async () => {
          try { const r = await api("/api/machines/linguistique/upload-ref", { method: "POST", body: { name: overlay.querySelector("#cd-name").value || "perso", dataUrl: rd.result } }); referenceRel = r.rel; setPreview(); AgentOS.toast("Image importée 📁", "ok"); }
          catch (err) { AgentOS.toast(err.message, "err"); }
        };
        rd.readAsDataURL(f);
      });
      const complete = async () => {
        const btn = overlay.querySelector("#cd-ai-all");
        btn.disabled = true; btn.textContent = "⏳…";
        overlay.querySelector("#cd-app").classList.add("ai-thinking");
        try {
          const r = await api("/api/machines/linguistique/complete-character", { method: "POST", body: { name: overlay.querySelector("#cd-name").value.trim(), appearance: overlay.querySelector("#cd-app").value.trim(), sex: sexOf(overlay.querySelector("#cd-role").value) } });
          if (r.appearance) overlay.querySelector("#cd-app").value = r.appearance;
          if (!overlay.querySelector("#cd-name").value.trim() && r.name) overlay.querySelector("#cd-name").value = r.name;
          AgentOS.toast("Apparence complétée 💡", "ok");
        } catch (err) { AgentOS.toast(err.message, "err"); }
        overlay.querySelector("#cd-app").classList.remove("ai-thinking");
        btn.disabled = false; btn.textContent = "💡 Compléter l'apparence";
      };
      overlay.querySelector("#cd-ai-all").addEventListener("click", complete);
      overlay.querySelector("#cd-gen").addEventListener("click", async (e) => {
        let app = overlay.querySelector("#cd-app").value.trim();
        if (app.length < 40) { await complete(); app = overlay.querySelector("#cd-app").value.trim(); }
        if (!app) return AgentOS.toast("Décris (ou 💡 complète) d'abord l'apparence", "err");
        e.target.disabled = true;
        overlay.querySelector("#cd-preview").innerHTML = `<div class="char-ph ai-thinking" style="width:110px;height:110px"><span class="spin"></span></div>`;
        try { const r = await api("/api/machines/linguistique/generate-ref", { method: "POST", body: { name: overlay.querySelector("#cd-name").value || "perso", appearance: app, presenter: (R2SP[overlay.querySelector("#cd-role").value] || {}).presenter } }); referenceRel = r.rel; AgentOS.toast("Portrait généré 🎨", "ok"); }
        catch (err) { AgentOS.toast(err.message, "err"); }
        setPreview(); e.target.disabled = false;
      });
      overlay.querySelector("#cd-save").addEventListener("click", async () => {
        const name = overlay.querySelector("#cd-name").value.trim();
        if (!name) return AgentOS.toast("Donne un nom", "err");
        const rsp = R2SP[overlay.querySelector("#cd-role").value] || R2SP.F;
        await api("/api/machines/linguistique/characters", { method: "POST", body: { id: existing ? existing.id : undefined, name, appearance: overlay.querySelector("#cd-app").value.trim(), sex: rsp.sex, presenter: rsp.presenter, voice: overlay.querySelector("#cd-voice").value, referenceRel } });
        overlay.remove(); cfg = await api("/api/machines/linguistique");
        AgentOS.toast(existing ? "Personnage mis à jour ✎" : "Personnage créé 👤", "ok"); renderChars();
      });
    }

    // ═══════════ Onglet Runs ═══════════
    async function renderRuns() {
      const body = el.querySelector("#ling-body");
      runs = await api("/api/machines/linguistique/runs");
      const BADGE = { done: ["✓ terminé", "ok"], failed: ["✗ échec", "err"] };
      body.innerHTML = runs.length
        ? runs.map((r) => {
            const [lb, bd] = BADGE[r.status] || ["⏳ en cours", "warn"];
            return `<div class="scrap-row ${r.status === "done" ? "done" : r.status === "failed" ? "failed" : ""}" style="cursor:pointer" data-run="${r.id}">
              <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.theme?.title || r.theme?.text || "Thème auto")}</b>
              <span class="small muted">${r.params?.sceneCount || "?"} dial. · ${esc(r.params?.language || "")} · ${r.mode}</span>
              <span class="small mono row-stat">${r.cost ? (r.cost.images + r.cost.voices + r.cost.videos).toFixed(2) + "$" : ""}</span>
              <span class="small muted">${ago(r.createdAt)}</span>
              <span class="badge ${bd}">${lb}</span>
              ${r.status !== "done" ? `<button class="icon-btn" data-zap="${r.id}" title="⚡ Décharge : relance le run là où il s'est arrêté">⚡</button>` : ""}
              ${!["done", "failed"].includes(r.status) ? `<button class="icon-btn" data-cancel="${r.id}" title="Annuler">🛑</button>` : ""}
            </div>`;
          }).join("")
        : `<div class="empty">Aucun run — lance ta première vidéo dans ⚙ Générer.</div>`;
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
      body.querySelectorAll("[data-zap]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation(); b.disabled = true; b.textContent = "⏳";
        try {
          await api(`/api/machines/linguistique/runs/${b.dataset.zap}/resume`, { method: "POST", body: {} });
          AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok");
          openWizard(b.dataset.zap);
        } catch (err) { AgentOS.toast(err.message, "err"); }
        renderRuns();
      }));
      body.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation(); b.disabled = true;
        try { await api(`/api/machines/linguistique/runs/${b.dataset.cancel}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); } catch (err) { AgentOS.toast(err.message, "err"); }
        renderRuns();
      }));
    }

    // ═══════════ Onglet Stock (📦 stock / 📤 postées / 🗃 archives) ═══════════
    async function renderStock() {
      const body = el.querySelector("#ling-body");
      let stock = [], chans = [];
      try { [stock, chans] = await Promise.all([api("/api/machines/linguistique/stock"), api("/api/channels")]); } catch {}
      const chanName = (id) => (chans.find((c) => c.channelId === id) || {}).title || id || "";
      const archived = stock.filter((v) => v.archived);
      const unposted = stock.filter((v) => !v.posted && !v.archived), posted = stock.filter((v) => v.posted && !v.archived);
      const row = (v) => `
        <div class="scrap-row ${v.posted ? "done" : ""}" style="cursor:pointer;${v.archived ? "opacity:.55" : ""};border-left:3px solid ${v.archived ? "var(--border-soft)" : v.posted ? "var(--ok, #4ade80)" : "var(--accent)"}" data-run="${esc(v.runId)}">
          ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:74px;height:42px;object-fit:cover;border-radius:6px;flex:none">` : `<span style="width:74px;text-align:center">🎞</span>`}
          <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</b>
          <span class="small muted">${esc(v.language)}</span>
          <span class="small muted">${AgentOS.dateFr(v.createdAt)}</span>
          ${v.posted
            ? `<span class="badge ok" title="${esc(chanName(v.channelId))}">📤 postée</span>${v.videoId ? `<a class="mini-btn" href="https://youtube.com/watch?v=${esc(v.videoId)}" target="_blank" onclick="event.stopPropagation()">▶</a>` : ""}
               <button class="mini-btn" data-unpost="${esc(v.id)}" title="Remettre en stock (annuler le marquage publiée)">↩</button>`
            : `<span class="badge accent">📦 en stock</span>
               <button class="mini-btn" data-post="${esc(v.id)}" title="Marquer comme publiée (postée hors Agentic Os)">✓ publiée</button>`}
          <button class="mini-btn" data-arch="${esc(v.id)}" data-to="${v.archived ? 0 : 1}" title="${v.archived ? "Désarchiver" : "Archiver (rangée dans 🗃 Archives)"}">${v.archived ? "📤 sortir" : "🗃"}</button>
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
        try { await api(`/api/machines/linguistique/stock/${id}`, { method: "PATCH", body: patchBody }); AgentOS.toast(msg, "ok"); } catch (e) { AgentOS.toast(e.message, "err"); }
        renderStock();
      };
      body.querySelectorAll("[data-arch]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.arch, { archived: b.dataset.to === "1" }, b.dataset.to === "1" ? "Archivée 🗃" : "Désarchivée 📤"); }));
      body.querySelectorAll("[data-post]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.post, { posted: true }, "Marquée publiée ✓"); }));
      body.querySelectorAll("[data-unpost]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.unpost, { posted: false }, "Remise en stock ↩"); }));
    }

    // ═══════════ Onglet Paramètres ═══════════
    async function renderSettings() {
      const body = el.querySelector("#ling-body");
      const s = cfg.settings;
      let chans = [], niches = [];
      try { [chans, niches] = await Promise.all([api("/api/channels"), api("/api/bank/niches")]); } catch {}
      body.innerHTML = `
        <div class="grid grid-2">
          <label class="field"><span>Chaîne YouTube reliée (publication)</span>
            <select id="s-chan"><option value="">— aucune —</option>${chans.map((c) => `<option value="${esc(c.channelId)}" ${cfg.linkedChannelId === c.channelId ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select></label>
          <label class="field"><span>Niche d'inspiration</span>
            <select id="s-niche"><option value="">— aucune —</option>${niches.map((n) => `<option value="${esc(n.id)}" ${cfg.nicheId === n.id ? "selected" : ""}>🏦 ${esc(n.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Modèle d'image</span>
            <select id="s-img">
              <option value="gpt" ${s.imageModel === "gpt" ? "selected" : ""}>gpt-image-2-image-to-image (0,03$)</option>
              <option value="nano" ${s.imageModel === "nano" ? "selected" : ""}>nano-banana-2-lite (0,02$)</option>
              <option value="grok" ${s.imageModel === "grok" ? "selected" : ""}>grok-imagine-image (0,02$)</option>
              <option value="seedream" ${s.imageModel === "seedream" ? "selected" : ""}>seedream/5-lite (0,0275$)</option>
            </select></label>
          <label class="field"><span>Modèle de voix</span><input type="text" value="fal-ai/elevenlabs/text-to-dialogue/eleven-v3" disabled></label>
          <label class="field"><span>Modèle de lipsync</span>
            <select id="s-lip">
              <option value="veed/lipsync" ${s.lipsyncModel === "veed/lipsync" ? "selected" : ""}>veed/lipsync (défaut)</option>
              <option value="fal-ai/sync-lipsync" ${s.lipsyncModel === "fal-ai/sync-lipsync" ? "selected" : ""}>fal-ai/sync-lipsync</option>
              <option value="fal-ai/latentsync" ${s.lipsyncModel === "fal-ai/latentsync" ? "selected" : ""}>fal-ai/latentsync</option>
            </select></label>
          <label class="field"><span>Sous-titres</span><input type="text" value="fal-ai/whisper → SRT → FFmpeg" disabled></label>
          <label class="field"><span>Modèle d'écriture (dialogues, packaging)</span>
            <select id="s-pmodel"><option value="" ${s.promptModel !== "opus" ? "selected" : ""}>Fable 5 (défaut)</option><option value="opus" ${s.promptModel === "opus" ? "selected" : ""}>Opus 4.8</option></select></label>
          <label class="field"><span>CTA visuel (haut-droite) toutes les (minutes)</span><input type="number" id="s-cta" value="${s.ctaEveryMin}" min="1"></label>
        </div>
        <button class="btn btn-accent mt" id="s-save">Enregistrer</button>`;
      body.querySelector("#s-save").addEventListener("click", async () => {
        cfg = await api("/api/machines/linguistique", { method: "PATCH", body: {
          linkedChannelId: body.querySelector("#s-chan").value || null,
          nicheId: body.querySelector("#s-niche").value || null,
          settings: { imageModel: body.querySelector("#s-img").value, promptModel: body.querySelector("#s-pmodel").value, lipsyncModel: body.querySelector("#s-lip").value, ctaEveryMin: Number(body.querySelector("#s-cta").value) || 2 },
        } });
        AgentOS.toast("Paramètres enregistrés 🛠", "ok");
      });
    }

    shell();
    // Ouverture directe d'un run (clic sur une tâche dans la page Tâches)
    try {
      const or = sessionStorage.getItem("linguistique-open-run");
      if (or) { sessionStorage.removeItem("linguistique-open-run"); openWizard(or); }
    } catch {}
  },
});
