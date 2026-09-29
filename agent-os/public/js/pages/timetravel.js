/**
 * MACHINE TIME TRAVEL — onglet dédié.
 * Sous-onglets : Générer / Personnages / Runs / Paramètres.
 * « Générer » ouvre le WIZARD : rail de production (Prompts → Images → Vidéos → Montage)
 * avec validation d'étape et régénération par scène (le noyau dur survit).
 */
AgentOS.register("timetravel", {
  title: "Time Travel",
  async render(el) {
    const { api, esc, fmt, ago } = AgentOS;
    let cfg = await api("/api/machines/timetravel");
    let runs = [];
    // Onglet mémorisé (survit à un rechargement de page F5)
    const TABS = ["gen", "chars", "runs", "stock", "settings"];
    let tab = TABS.includes(localStorage.getItem("tt-tab")) ? localStorage.getItem("tt-tab") : "gen";
    let wizTimer = null;
    const regenning = new Map(); // scènes en régénération : clé run.id:scène → timestamp de départ
    const stepStarts = new Map(); // départ observé des générations (barres de progression estimées)
    this.onLeave = () => clearTimeout(wizTimer);

    const LANGS = ["English", "Français", "Español", "Deutsch", "Italiano", "Português", "日本語", "한국어", "العربية", "हिन्दी", "Русский", "中文"];
    const MODEL_NAMES = { gpt: "gpt-image-2-image-to-image", nano: "nano-banana-2-lite", grok: "grok-imagine-image", seedream: "seedream/5-lite" };

    function shell() {
      el.innerHTML = `
        <div class="card">
          <h2><a href="#/machines" class="back-btn" style="margin-right:10px" title="Retour aux Machines">←</a>🕰 Time Travel
            <span class="h-actions">
              <span class="mini-seg" id="tt-tabs">
                <button data-t="gen" class="${tab === "gen" ? "active" : ""}">⚙ Générer</button>
                <button data-t="chars" class="${tab === "chars" ? "active" : ""}">👤 Personnages</button>
                <button data-t="runs" class="${tab === "runs" ? "active" : ""}">🎞 Runs</button>
                <button data-t="stock" class="${tab === "stock" ? "active" : ""}">📦 Stock</button>
                <button data-t="settings" class="${tab === "settings" ? "active" : ""}">🛠 Paramètres</button>
              </span>
            </span>
          </h2>
          <div id="tt-body"></div>
        </div>`;
      el.querySelectorAll("#tt-tabs button").forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.t;
          try { localStorage.setItem("tt-tab", tab); } catch {}
          shell();
        })
      );
      ({ gen: renderGen, chars: renderChars, runs: renderRuns, stock: renderStock, settings: renderSettings })[tab]();
    }

    // ═══════════ Onglet Générer ═══════════
    let mode = "semi";
    function renderGen() {
      const body = el.querySelector("#tt-body");
      const ch = cfg.characters;
      body.innerHTML = `
        <div class="grid grid-2 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Personnage</span>
            <select id="g-char">${ch.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.language)}</option>`).join("") || `<option value="">— crée un personnage (onglet 👤) —</option>`}</select></label>
          <label class="field" style="margin:0"><span>Nombre de scènes <span class="muted">(1 scène = ${cfg.settings.clipSeconds || 10} s)</span></span>
            <input type="number" id="g-scenes" value="6" min="1" max="120" step="1"></label>
        </div>
        <label class="field"><span>Époque &amp; événement <span class="muted">(vide = l'IA choisit au lancement)</span></span>
          <div class="row" style="gap:8px">
            <input type="text" id="g-theme" placeholder="ex : Rome antique, 79 ap. J.-C. — l'éruption du Vésuve à Pompéi" style="flex:1">
            <button class="btn btn-sm btn-accent" id="g-idea">💡 Idée</button>
          </div></label>
        <div class="fbar mb" style="padding:10px 12px;margin-top:10px">
          <span class="fbar-item"><span>Mode</span>
            <span class="mini-seg" id="g-mode">
              <button class="${mode === "semi" ? "active" : ""}" data-v="semi">Semi-manuel</button>
              <button class="${mode === "auto" ? "active" : ""}" data-v="auto">100 % auto</button>
            </span></span>
          <span class="fbar-item"><span>Publication auto</span>
            <span class="mini-seg" id="g-pub">
              <button class="${cfg.autoPublish ? "" : "active"}" data-v="0">Non</button>
              <button class="${cfg.autoPublish ? "active" : ""}" data-v="1">Oui</button>
            </span></span>
          <span class="fbar-item" id="g-pubchan-wrap" style="${cfg.autoPublish ? "" : "display:none"}"><span>Chaîne</span>
            <select id="g-pubchan" style="min-width:170px"><option value="">— choisis la chaîne —</option></select> <select id="g-pubpriv" style="width:150px" title="Mode de publication automatique"><option value="private" selected>🔒 Privée</option><option value="unlisted">🔗 Non répertoriée</option><option value="public">🌍 Publique</option></select></span>
          <span id="g-cost" style="margin-left:auto;font-weight:800;font-size:17px;color:#4ade80;background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.35);border-radius:10px;padding:9px 16px;white-space:nowrap"></span>
          <button class="btn btn-accent" id="g-go" style="font-size:14px;padding:10px 22px">⚙ Générer</button>
        </div>
        <div class="small muted" style="text-align:right">Prompts → Images → Vidéos → Montage → Packaging</div>`;

      const scenesInput = body.querySelector("#g-scenes");
      const IMG_PRICE = { gpt: 0.03, nano: 0.02, grok: 0.02, seedream: 0.0275 };
      const costLine = () => {
        const scenes = Math.max(1, Number(scenesInput.value) || 6);
        const clip = cfg.settings.clipSeconds || 10;
        const d = scenes * clip;
        const mins = d >= 60 ? `${Math.floor(d / 60)}min${String(d % 60).padStart(2, "0")}` : `${d}s`;
        const imgP = IMG_PRICE[cfg.settings.imageModel] || 0.03;
        // Juste le prix, gros — le détail vit dans l'infobulle (images + vidéo 0,015$/s + miniature)
        const el2 = body.querySelector("#g-cost");
        el2.textContent = `≈ ${(scenes * imgP + d * 0.015 + 0.03).toFixed(2)} $`;
        el2.title = `${scenes} scènes · durée ${mins} (images ${imgP}$/scène + vidéo 0,015$/s + miniature 0,03$)`;
      };
      scenesInput.addEventListener("input", costLine);
      costLine();
      body.querySelectorAll("#g-mode button").forEach((b) =>
        b.addEventListener("click", () => {
          body.querySelectorAll("#g-mode button").forEach((x) => x.classList.toggle("active", x === b));
          mode = b.dataset.v;
        })
      );
      // Publication auto : chaîne OBLIGATOIRE (pas de défaut) — Générer grisé tant qu'elle n'est pas choisie
      const pubChan = body.querySelector("#g-pubchan");
      const goBtn = body.querySelector("#g-go");
      const pubOn = () => body.querySelector('#g-pub button[data-v="1"]').classList.contains("active");
      const gateGo = () => {
        const blocked = pubOn() && !pubChan.value;
        goBtn.disabled = blocked;
        goBtn.title = blocked ? "Choisis d'abord la chaîne de publication" : "";
      };
      api("/api/channels").then((chs) => {
        pubChan.innerHTML = `<option value="">— choisis la chaîne —</option>` + chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("");
        gateGo();
      }).catch(() => {});
      pubChan.addEventListener("change", gateGo);
      // Toggle sans re-render : ne JAMAIS effacer ce qui est saisi (époque/événement…)
      body.querySelectorAll("#g-pub button").forEach((b) =>
        b.addEventListener("click", async () => {
          body.querySelectorAll("#g-pub button").forEach((x) => x.classList.toggle("active", x === b));
          body.querySelector("#g-pubchan-wrap").style.display = b.dataset.v === "1" ? "" : "none";
          gateGo();
          cfg = await api("/api/machines/timetravel", { method: "PATCH", body: { autoPublish: b.dataset.v === "1" } });
        })
      );
      gateGo();
      // 💡 Idée : champ en mode « réflexion » avec messages qui défilent
      body.querySelector("#g-idea").addEventListener("click", async () => {
        const input = body.querySelector("#g-theme");
        const btn = body.querySelector("#g-idea");
        const msgs = ["💡 Je fouille la niche…", "📚 Je compare aux titres concurrents…", "🕰 Je choisis une époque…", "⚡ Je cherche un événement spectaculaire…"];
        let mi = 0;
        input.classList.add("ai-thinking");
        input.disabled = true;
        input.value = "";
        input.placeholder = msgs[0];
        btn.disabled = true;
        btn.textContent = "⏳";
        const cycle = setInterval(() => (input.placeholder = msgs[++mi % msgs.length]), 1800);
        try {
          const idea = await api("/api/machines/timetravel/idea", { method: "POST" });
          input.value = idea.text || "";
          if (idea.pitch) AgentOS.toast("💡 " + idea.pitch, "ok");
        } catch (e) {
          AgentOS.toast(e.message, "err");
        }
        clearInterval(cycle);
        input.classList.remove("ai-thinking");
        input.disabled = false;
        input.placeholder = "ex : Rome antique, 79 ap. J.-C. — l'éruption du Vésuve à Pompéi";
        btn.disabled = false;
        btn.textContent = "💡 Idée";
      });
      body.querySelector("#g-go").addEventListener("click", async () => {
        const text = body.querySelector("#g-theme").value.trim();
        try {
          const run = await api("/api/machines/timetravel/runs", {
            method: "POST",
            body: {
              characterId: body.querySelector("#g-char").value,
              durationSec: Math.max(1, Number(scenesInput.value) || 6) * (cfg.settings.clipSeconds || 10),
              theme: text ? { text } : null,
              mode,
              publishChannelId: pubOn() ? pubChan.value : null,
              publishPrivacy: (body.querySelector("#g-pubpriv") || {}).value || "private",
            },
          });
          openWizard(run.id);
        } catch (e) {
          AgentOS.toast(e.message, "err");
        }
      });
    }

    // ═══════════ WIZARD (fenêtre pas-à-pas) ═══════════
    const STEPS = [
      { key: "prompts", icon: "📝", label: "Prompts" },
      { key: "images", icon: "🖼", label: "Images" },
      { key: "videos", icon: "🎬", label: "Vidéos" },
      { key: "montage", icon: "🎞", label: "Montage" },
    ];
    // Une étape est « faite » quand elle a VRAIMENT produit ses artefacts — pas quand le run est
    // passé au-delà (le ✓ ne lisait que le statut : une étape franchie à trou paraissait réussie).
    function stepDone(run, i) {
      const sc = run.scenes || [];
      if (!sc.length) return false;
      if (i === 0) return sc.every((s) => s.image_prompt);
      if (i === 1) return sc.every((s) => s.image);
      if (i === 2) return sc.every((s) => s.video);
      return !!run.finalRel;
    }
    function stepIndex(status) {
      if (status.startsWith("prompts")) return 0;
      if (status.startsWith("images")) return 1;
      if (status.startsWith("video")) return 2; // videos_* ET videoprompts_ready (relecture)
      if (status.startsWith("montage")) return 3;
      return 4; // done
    }
    function openWizard(runId) {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal lg" id="wiz"><span class="spin"></span></div>`;
      document.body.appendChild(overlay);
      // Volontairement PAS de fermeture au clic extérieur : seule la croix ferme
      // (le run continue de toute façon côté serveur, récupérable dans Runs)
      const tick = async () => {
        let run;
        try {
          run = await api("/api/machines/timetravel/runs/" + runId);
        } catch (e) {
          overlay.querySelector("#wiz").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
          return;
        }
        const box = overlay.querySelector("#wiz");
        // Reconstruction COMPLÈTE seulement si la structure change (étape, vue, nb de scènes,
        // erreur). Sinon patch incrémental : seules les cellules changées sont redessinées —
        // une vidéo déjà générée que tu regardes n'est JAMAIS recréée/relancée.
        // Compteurs d'artefacts dans la clé : le rail (✓ / ⚠) suit ce qui est réellement produit.
        const sc = run.scenes || [];
        const nb = (f) => sc.filter((s) => s[f]).length;
        const shellKey = `${run.status}|${box.dataset.view || ""}|${sc.length}|${run.error ? 1 : 0}|${nb("image")}|${nb("video")}|${run.finalRel ? 1 : 0}`;
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
    // Progression globale du run (barre en haut de la fenêtre)
    function globalPct(run) {
      const n = run.scenes?.length || 1;
      const img = run.scenes ? run.scenes.filter((s) => s.image).length : 0;
      const vid = run.scenes ? run.scenes.filter((s) => s.video).length : 0;
      switch (run.status) {
        case "prompts_running": return Math.max(6, Math.round((12 * n) / Math.max(n, run.params?.durationSec / 10 || n)));
        case "prompts_ready": return 15;
        case "images_running": return 15 + Math.round((30 * img) / n);
        case "images_ready": return 45;
        case "videoprompts_ready": return 48;
        case "videos_running": return 48 + Math.round((32 * vid) / n);
        case "videos_ready": return 80;
        case "montage_running": return 85;
        case "packaging_running": return 92;
        case "done": return 100;
        case "failed": return img || vid ? 40 : 8;
        default: return 5;
      }
    }
    // Mise à jour des barres de progression SANS reconstruire le DOM (les vidéos continuent de jouer)
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
    // Compteur « terminées / total · en cours » affiché dans l'en-tête
    function countHTML(run) {
      const n = run.scenes ? run.scenes.length : 0;
      if (!n) return "";
      const live = run.scenes.filter((s) => s.rendering).length;
      if (run.status.startsWith("images")) {
        const done = run.scenes.filter((s) => s.image).length;
        const fail = run.scenes.filter((s) => !s.image && s.error).length;
        return `🖼 ${done}/${n} images${live ? ` · ${live} en cours` : ""}${fail ? ` · <span style="color:var(--err)">${fail} échec</span>` : ""}`;
      }
      if (run.status.startsWith("video")) {
        const done = run.scenes.filter((s) => s.video).length;
        const fail = run.scenes.filter((s) => !s.video && s.error).length;
        return `🎬 ${done}/${n} vidéos${live ? ` · ${live} en cours` : ""}${fail ? ` · <span style="color:var(--err)">${fail} échec</span>` : ""}`;
      }
      if (run.status.startsWith("prompts")) return `📝 ${n} scène(s)`;
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
        (viewIdx === 2 && ["videoprompts_ready", "videos_ready"].includes(run.status))
      );
    }
    // Signature d'une cellule : uniquement ce qui change SON rendu dans la vue courante.
    // (une cellule vidéo déjà affichée garde une signature stable → jamais recréée → lecture continue)
    function sceneSig(run, s, viewIdx) {
      // Inclure le ts de l'image : régénérée, le chemin ne change pas mais le ts oui → re-render + rechargement
      const media = viewIdx === 1 ? ((s.image && s.image.rel) || "") + ":" + ((s.image && s.image.ts) || "") : viewIdx === 2 ? ((s.video && s.video.rel) || "") + ":" + ((s.video && s.video.ts) || "") : "";
      const txt = viewIdx === 0 ? `${(s.voiceover || "").length}:${(s.image_prompt || "").length}:${(s.video_prompt || "").length}` : "";
      return [viewIdx, run.status, s.action || "", media, txt, s.rendering ? 1 : 0, s.pending ? 1 : 0, s.error ? 1 : 0, regenning.has(run.id + ":" + s.i) ? 1 : 0].join("~");
    }
    // Vlog-only : on n'affiche plus de badge de mode, mais l'ACTION de la scène (plus utile).
    const actionChip = (s) => (s.action ? `<span class="badge accent" style="font-size:9px" title="Action de la scène (selfie vlog)">🤳 ${esc(s.action)}</span>` : "");
    // Carte d'une scène (partagée entre rendu complet et patch incrémental)
    function sceneCard(run, s, viewIdx, box) {
      const regKey = run.id + ":" + s.i;
      // « en régénération » = optimiste côté client (regenning) OU flag serveur persistant
      // (pending) → le chargement survit à un rafraîchissement de page.
      const isReg = regenning.has(regKey) || !!s.pending;
      const canRegen = canRegenView(run, viewIdx);
      const accInit = box.dataset.accInit === run.status;
      const openAccs = new Set([...box.querySelectorAll("details[data-acc][open]")].map((d) => d.dataset.acc));
      const val = (box.querySelector(`[data-instr="${s.i}"]`) || {}).value || "";
      const errBox = `<div class="empty small" style="color:var(--err)"><b>⚠ Échec</b>${esc(s.error || "")}<br><span class="muted">Régénère la scène (↻ ci-dessous).</span></div>`;
      const imgCell = isReg
        ? progHTML("rg-img:" + regKey, 150, "🖼 Régénération de l'image…")
        : s.image
        ? `<img src="/media/${encodeURIComponent(s.image.rel)}${s.image.ts ? "?v=" + s.image.ts : ""}" style="width:100%;border-radius:8px;margin:6px 0">`
        : s.rendering
        ? progHTML("img:" + regKey, 150, "🖼 Génération en cours…")
        : s.error
        ? errBox
        : run.status === "images_running"
        ? `<div class="empty small" style="opacity:.7">⏳ En file d'attente…</div>`
        : `<div class="empty small">Pas encore générée</div>`;
      const vidCell = isReg
        ? progHTML("rg-vid:" + regKey, 600, "🎬 Régénération de la vidéo…")
        : s.video
        ? `<video src="/media/${encodeURIComponent(s.video.rel)}${s.video.ts ? "?v=" + s.video.ts : ""}" controls style="width:100%;border-radius:8px;margin:6px 0"></video>`
        : s.rendering
        ? progHTML("vid:" + regKey, 600, "🎬 Grok tourne la scène…")
        : s.error
        ? errBox
        : run.status === "videos_running"
        ? `<div class="empty small" style="opacity:.7">⏳ En file d'attente…</div>`
        : `<div class="empty small">Pas encore tournée</div>`;
      const regenRow = canRegen
        ? `<div class="row" style="gap:5px;margin-top:6px"><input type="text" data-instr="${s.i}" value="${esc(val)}" placeholder="Instructions de modif…" style="flex:1;font-size:11px"><button class="mini-btn" data-regen="${s.i}" title="Régénérer (noyau dur conservé)">↻</button></div>`
        : "";
      const body =
        (viewIdx === 0
          ? isReg
            ? progHTML("rg-pr:" + regKey, 90, "📝 Claude réécrit la scène…")
            : `<div class="small" style="margin:5px 0">🗣 ${esc(s.voiceover)}</div>
               <details class="small muted" data-acc="ip-${s.i}" ${openAccs.has("ip-" + s.i) ? "open" : ""}><summary>🖼 prompt image</summary><div class="wiz-prompt">${esc(s.image_prompt)}</div></details>
               <details class="small muted" data-acc="vp0-${s.i}" ${openAccs.has("vp0-" + s.i) ? "open" : ""}><summary>🎬 prompt vidéo (plan continu)</summary><div class="wiz-prompt">${esc(s.video_prompt)}</div></details>`
          : "") +
        (viewIdx === 1 ? imgCell : "") +
        (viewIdx === 2 ? vidCell + `<div class="small muted">🗣 ${esc(s.voiceover)}</div><details class="small muted" data-acc="vp-${s.i}" ${openAccs.has("vp-" + s.i) || (run.status === "videoprompts_ready" && !accInit) ? "open" : ""}><summary>🎬 prompt vidéo (plan continu)</summary><div class="wiz-prompt">${esc(s.video_prompt)}</div></details>` : "");
      const tag = isReg
        ? `<span class="badge warn">⏳</span>`
        : (viewIdx === 1 && s.image) || (viewIdx === 2 && s.video)
        ? `<span class="badge ok">✓</span>`
        : s.error && ((viewIdx === 1 && !s.image) || (viewIdx === 2 && !s.video))
        ? `<span class="badge err">✗</span>`
        : "";
      return `<div class="card ${isReg ? "ai-thinking" : ""}" data-cell="${s.i}" data-sig="${esc(sceneSig(run, s, viewIdx))}" style="padding:10px"><div class="row between"><b class="small">Scène ${s.i} ${tag}</b>${actionChip(s)}</div>${body}${regenRow}</div>`;
    }
    // Rattache le bouton ↻ d'un périmètre (toute la fenêtre, ou une seule cellule patchée)
    function wireRegen(scope, run, overlay, box) {
      scope.querySelectorAll("[data-regen]").forEach((b) =>
        b.addEventListener("click", async () => {
          const i = b.dataset.regen;
          const instructions = box.querySelector(`[data-instr="${i}"]`).value.trim();
          const step = run.status.startsWith("videos") ? "videos" : run.status.startsWith("images") ? "images" : "prompts";
          b.disabled = true;
          const key = run.id + ":" + i;
          ["rg-pr:", "rg-img:", "rg-vid:"].forEach((p) => stepStarts.delete(p + key));
          regenning.set(key, Date.now());
          renderWizard(box, run, overlay);
          try {
            await api(`/api/machines/timetravel/runs/${run.id}/regen`, { method: "POST", body: { scene: Number(i), step, instructions } });
            AgentOS.toast(`Scène ${i} régénérée`, "ok");
          } catch (e) {
            AgentOS.toast(e.message, "err");
          }
          regenning.delete(key);
        })
      );
    }
    // Patch incrémental : met à jour barre globale + compteur + SEULES les cellules changées
    // (une vidéo en cours de lecture dans une cellule inchangée n'est jamais recréée)
    function patchWizard(box, run, overlay) {
      const viewIdx = box.dataset.view !== undefined && box.dataset.view !== "" ? Number(box.dataset.view) : Math.min(stepIndex(run.status), 4);
      const gb = box.querySelector(".wiz-gbar > div");
      if (gb) gb.style.width = globalPct(run) + "%";
      const gc = box.querySelector("#wiz-count");
      if (gc) gc.innerHTML = countHTML(run);
      (run.scenes || []).forEach((s) => {
        const el = box.querySelector(`[data-cell="${s.i}"]`);
        if (!el) return;
        if (el.dataset.sig !== sceneSig(run, s, viewIdx)) {
          const tmp = document.createElement("div");
          tmp.innerHTML = sceneCard(run, s, viewIdx, box);
          const nw = tmp.firstElementChild;
          el.replaceWith(nw);
          wireRegen(nw, run, overlay, box);
        }
      });
      // Le bouton Valider et son message vivent dans le pied (hors cellules) : on met à jour
      // leur état ici aussi, sinon le bouton resterait grisé après la FIN d'une régé.
      const vbtn = box.querySelector("[data-validate]");
      if (vbtn) {
        const pend = run.status === "images_ready" ? run.scenes.filter((s) => !s.image) : run.status === "videos_ready" ? run.scenes.filter((s) => !s.video) : [];
        const busy = (run.scenes || []).filter((s) => s.pending || s.rendering || regenning.has(run.id + ":" + s.i));
        vbtn.disabled = !!(pend.length || busy.length);
        const msg = box.querySelector(".wiz-foot > span");
        if (msg) {
          if (pend.length) msg.outerHTML = `<span class="small" style="color:var(--err)">⚠ ${pend.length} ${run.status === "images_ready" ? "image(s)" : "vidéo(s)"} manquante(s) (scène ${pend.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.</span>`;
          else if (busy.length) msg.outerHTML = `<span class="small" style="color:var(--accent)">⏳ Régénération en cours (scène ${busy.map((s) => s.i).join(", ")}) — patiente avant de valider.</span>`;
          else msg.outerHTML = `<span class="small muted">Inspecte, corrige scène par scène, puis valide pour avancer.</span>`;
        }
      }
      updateBars(box);
    }
    function renderWizard(box, run, overlay) {
      const idx = stepIndex(run.status);
      const running = run.status.endsWith("_running");
      // Étape AFFICHÉE : cliquable sur le rail, indépendante de l'étape en cours
      const viewIdx = box.dataset.view !== undefined && box.dataset.view !== "" ? Number(box.dataset.view) : Math.min(idx, 4);
      const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.instr : null;
      const vals = {};
      box.querySelectorAll("[data-instr]").forEach((i) => (vals[i.dataset.instr] = i.value));
      // Les accordéons ouverts survivent au re-render du poll (sinon ils se referment tout seuls)
      const accInit = box.dataset.accInit === run.status;
      const openAccs = new Set([...box.querySelectorAll("details[data-acc][open]")].map((d) => d.dataset.acc));
      // La position de scroll survit au re-render (ne pas remonter en haut à chaque poll)
      const prevScroll = box.querySelector(".wiz-scroll")?.scrollTop || 0;
      const validateLabel = {
        prompts_ready: "✓ Valider les prompts → Images",
        images_ready: "✓ Valider les images → Relire les prompts vidéo",
        videoprompts_ready: "🎬 Lancer le tournage des vidéos",
        videos_ready: "✓ Valider les vidéos → Montage",
      }[run.status];
      // Scènes encore manquantes : bloquent le passage à l'étape suivante
      const pending = run.status === "images_ready" ? run.scenes.filter((s) => !s.image) : run.status === "videos_ready" ? run.scenes.filter((s) => !s.video) : [];
      // Régé en cours (flag serveur pending/rendering OU optimiste client) : bloque aussi la validation
      const regenBusy = (run.scenes || []).filter((s) => s.pending || s.rendering || regenning.has(run.id + ":" + s.i));
      const gpct = globalPct(run);
      box.classList.add("wiz-modal");
      box.innerHTML = `
        <div class="wiz-head">
          <div class="wiz-gbar" title="Progression globale : ${gpct}%"><div style="width:${gpct}%"></div></div>
          <div class="row between" style="margin:10px 0 4px">
            <h2 style="margin:0;font-size:15px">🕰 ${esc(run.theme?.title || run.theme?.text || "Le thème arrive…")}
              <span class="small muted mono" style="margin-left:8px">${run.id} · ${run.mode} · ${gpct}%</span></h2>
            <span class="row" style="gap:6px">
              ${run.status !== "done" ? `<button class="btn btn-sm" data-zap-run title="⚡ Décharge : relance le run là où il s'est arrêté (refusé s'il tourne déjà)">⚡</button>` : ""}
              ${!["done", "failed"].includes(run.status) ? `<button class="btn btn-sm" data-cancel-run title="Annuler ce run (stoppe les requêtes en cours)">🛑 Annuler</button>` : ""}
              <button class="btn btn-sm btn-ghost" data-close>✕</button>
            </span>
          </div>
          <div class="wiz-rail">
            ${STEPS.map((s, i) => `
              <div class="wiz-step ${stepDone(run, i) ? "done" : i === idx ? "active" : ""}" data-view="${i}" style="cursor:pointer" title="${!stepDone(run, i) && i < idx ? "⚠ Étape incomplète — voir les" : "Voir les"} ${s.label.toLowerCase()}">
                <div class="wiz-dot" ${i === viewIdx ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>${stepDone(run, i) ? "✓" : i < idx ? "⚠" : s.icon}</div><span>${s.label}</span>
              </div>
              ${i < STEPS.length - 1 ? `<div class="wiz-link ${stepDone(run, i) ? "done" : i === idx && running ? "active" : ""}"></div>` : ""}`).join("")}
            <div class="wiz-link ${run.status === "done" ? "done" : run.status === "packaging_running" ? "active" : ""}"></div>
            <div class="wiz-step ${run.status === "done" ? "done" : ""}" data-view="4" style="cursor:pointer" title="Titre, description, tags, miniature, publication">
              <div class="wiz-dot" ${viewIdx === 4 ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>🏁</div><span>Fini</span>
            </div>
          </div>
          ${run.error ? `<div class="empty small" style="color:var(--err);margin:0"><b>Échec</b>${esc(run.error)} <button class="btn btn-sm" data-retry>↻ Reprendre où on s'est arrêté</button></div>` : ""}
          ${running ? `<div class="small muted"><span class="spin" style="width:12px;height:12px"></span> ${
            { prompts_running: "Claude écrit le plan de tournage…", images_running: "GPT Image 2 génère les images (10 en parallèle en continu)…", videos_running: "Grok 1.5 tourne les scènes (10 en parallèle en continu)…", montage_running: "Remotion assemble le montage + CTA visuels…", packaging_running: "Claude prépare titre, description, tags et miniature…" }[run.status] || ""
          }</div>` : ""}
          <div id="wiz-count" class="small" style="font-weight:600;color:var(--accent)">${countHTML(run)}</div>
        </div>
        <div class="wiz-scroll">
        ${(() => {
          if (viewIdx === 3) {
            return run.finalRel
              ? `<video src="/media/${encodeURIComponent(run.finalRel)}" controls style="width:100%;max-height:430px;border-radius:12px;background:#000"></video>
                <div class="row between mt"><span class="small muted">Coût : ${(run.cost.images + run.cost.videos).toFixed(2)}$ · ${run.scenes.length} scène(s) · CTA visuels inclus</span>
                  <a class="btn btn-sm btn-accent" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger</a></div>`
              : run.status === "montage_running"
              ? `<div class="empty small"><span class="spin"></span> Remotion assemble le montage (${run.scenes.filter((s) => s.video).length} scènes)… ça peut prendre plusieurs minutes.</div>`
              : `<div class="empty small">Le montage n'est pas encore rendu.</div>`;
          }
          if (viewIdx === 4) {
            if (!run.pack) {
              if (run.status === "packaging_running") return `<div class="empty small"><span class="spin"></span> Claude prépare titre, description, tags et miniature…</div>`;
              if (run.finalRel) return `<div class="empty small">Packaging pas encore généré pour ce run.<br><button class="btn btn-sm btn-accent mt" data-packaging>⚙ Générer titre + description + tags + miniature</button></div>`;
              return `<div class="empty small">La vidéo n'est pas encore montée — le packaging arrive après le montage.</div>`;
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
                    <button class="mini-btn" id="pk-thumb-regen" title="Régénérer la miniature (même personnage · 0,03$)">🎨 Régénérer</button>
                  </div>
                  ${run.finalRel ? `<a class="btn btn-sm btn-ghost" style="width:100%;margin-top:8px;text-align:center" href="/media/${encodeURIComponent(run.finalRel)}" download>⬇ Télécharger la vidéo</a>` : ""}
                </div>
                <div class="grow" style="min-width:0">
                  <input type="text" id="pk-text-instr" placeholder="Observation pour régénérer un texte (optionnel)…" style="width:100%;font-size:11px;margin-bottom:8px">
                  <label class="field"><span class="row between">Titre <span class="row" style="gap:5px"><span class="small muted mono">${(pk.title || "").length}/100</span><button class="mini-btn" data-copy="pk-title" title="Copier le titre">📋</button><button class="mini-btn" data-regen-text="title" title="Régénérer le titre">↻💡</button></span></span><input type="text" id="pk-title" value="${esc(pk.title || "")}"></label>
                  <label class="field"><span class="row between">Description <span class="row" style="gap:5px"><button class="mini-btn" data-copy="pk-desc" title="Copier la description">📋</button><button class="mini-btn" data-regen-text="description" title="Régénérer la description">↻💡</button></span></span><textarea id="pk-desc" rows="5">${esc(pk.description || "")}</textarea></label>
                  <label class="field"><span class="row between">Tags (séparés par des virgules) <span class="row" style="gap:5px"><span class="small muted mono">${(pk.tags || []).join(", ").length}/500</span><button class="mini-btn" data-copy="pk-tags" title="Copier les tags">📋</button><button class="mini-btn" data-regen-text="tags" title="Régénérer les tags">↻💡</button></span></span><textarea id="pk-tags" rows="2">${esc((pk.tags || []).join(", "))}</textarea></label>
                  <div class="row" style="gap:8px">
                    <select id="pk-chan" style="flex:1"><option value="">— chaîne YouTube —</option></select>
                    <select id="pk-priv" style="width:170px" title="Mode de publication">
                      <option value="private" selected>🔒 Privée</option>
                      <option value="unlisted">🔗 Non répertoriée</option>
                      <option value="public">🌍 Publique</option>
                    </select>
                    <button class="btn btn-accent" data-publish disabled>📤 Publier</button>
                  </div>
                  <div class="small muted" style="margin-top:6px">📦 Sans publication, la vidéo reste automatiquement dans le <b>Stock</b> de la machine. Par défaut elle part en <b>privé</b>.</div>
                </div>
              </div>`;
          }
          if (!run.scenes.length) return `<div class="empty small">Les prompts arrivent…</div>`;
          return `<div class="grid grid-3 mt" id="wiz-cells">${run.scenes.map((s) => sceneCard(run, s, viewIdx, box)).join("")}</div>`;
        })()}
        </div>
        ${validateLabel ? `<div class="wiz-foot">
          ${pending.length
            ? `<span class="small" style="color:var(--err)">⚠ ${pending.length} ${run.status === "images_ready" ? "image(s)" : "vidéo(s)"} manquante(s) (scène ${pending.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.</span>`
            : regenBusy.length
            ? `<span class="small" style="color:var(--accent)">⏳ Régénération en cours (scène ${regenBusy.map((s) => s.i).join(", ")}) — patiente avant de valider.</span>`
            : `<span class="small muted">Inspecte, corrige scène par scène, puis valide pour avancer.</span>`}
          <button class="btn btn-accent" data-validate ${pending.length || regenBusy.length ? "disabled" : ""} style="margin-left:auto;font-size:13.5px;padding:10px 20px">${validateLabel}</button>
        </div>` : ""}`;
      box.dataset.accInit = run.status;
      const scroller = box.querySelector(".wiz-scroll");
      if (scroller) scroller.scrollTop = prevScroll;
      box.querySelector("[data-close]").addEventListener("click", () => {
        clearTimeout(wizTimer);
        overlay.remove();
        if (tab === "runs") shell();
      });
      // Rouvre la fenêtre avec une boucle de polling fraîche (après annulation/reprise,
      // le poll s'était arrêté sur l'état « failed »)
      const reopen = () => { clearTimeout(wizTimer); overlay.remove(); openWizard(run.id); };
      const cx = box.querySelector("[data-cancel-run]");
      if (cx)
        cx.addEventListener("click", async () => {
          cx.disabled = true;
          try {
            await api(`/api/machines/timetravel/runs/${run.id}/cancel`, { method: "POST" });
            AgentOS.toast("Run annulé 🛑 — reprise possible avec ↻", "ok");
            reopen();
          } catch (err) {
            AgentOS.toast(err.message, "err");
            cx.disabled = false;
          }
        });
      const zp = box.querySelector("[data-zap-run]");
      if (zp) zp.addEventListener("click", async () => {
        zp.disabled = true; zp.textContent = "⏳";
        try { await api(`/api/machines/timetravel/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok"); reopen(); }
        catch (err) { AgentOS.toast(err.message, "err"); zp.disabled = false; zp.textContent = "⚡"; }
      });
      box.querySelectorAll(".wiz-step[data-view]").forEach((s) =>
        s.addEventListener("click", () => {
          box.dataset.view = s.dataset.view;
          renderWizard(box, run, overlay);
        })
      );
      const rt = box.querySelector("[data-retry]");
      if (rt) rt.addEventListener("click", async () => {
        rt.disabled = true;
        try {
          const r = await api(`/api/machines/timetravel/runs/${run.id}/resume`, { method: "POST", body: {} });
          AgentOS.toast("Reprise à l'étape « " + (r.status || "").replace("_running", "").replace("_ready", "") + " » ↻", "ok");
          reopen();
        } catch (e) {
          AgentOS.toast(e.message, "err");
          rt.disabled = false;
        }
      });
      const pkg = box.querySelector("[data-packaging]");
      if (pkg)
        pkg.addEventListener("click", async () => {
          pkg.disabled = true;
          await api(`/api/machines/timetravel/runs/${run.id}/resume`, { method: "POST", body: { status: "packaging_running" } });
          AgentOS.toast("Packaging lancé ⚙", "ok");
          delete box.dataset.shellKey; // force le prochain poll à re-rendre
          clearTimeout(wizTimer);
          wizTimer = setTimeout(() => openWizard(run.id), 1500);
          overlay.remove();
        });
      const pubBtn = box.querySelector("[data-publish]");
      if (pubBtn) {
        const sel = box.querySelector("#pk-chan");
        api("/api/channels").then((chs) => {
          sel.innerHTML = `<option value="">— chaîne YouTube —</option>` + chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("");
        }).catch(() => {});
        sel.addEventListener("change", () => (pubBtn.disabled = !sel.value));
        pubBtn.addEventListener("click", async () => {
          pubBtn.disabled = true;
          pubBtn.textContent = "⏳ Upload YouTube en cours…";
          try {
            const r = await api(`/api/machines/timetravel/runs/${run.id}/publish`, {
              method: "POST",
              body: {
                channelId: sel.value,
                privacyStatus: (box.querySelector("#pk-priv") || {}).value || "private",
                title: box.querySelector("#pk-title").value.trim(),
                description: box.querySelector("#pk-desc").value,
                tags: box.querySelector("#pk-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
              },
            });
            AgentOS.toast("📤 Publiée : " + r.url, "ok");
          } catch (e) {
            AgentOS.toast(e.message, "err");
          }
          pubBtn.textContent = "📤 Publier";
          pubBtn.disabled = false;
        });
      }
      const v = box.querySelector("[data-validate]");
      if (v)
        v.addEventListener("click", async () => {
          v.disabled = true;
          try {
            await api(`/api/machines/timetravel/runs/${run.id}/validate`, { method: "POST" });
            AgentOS.toast("Étape validée ⚙", "ok");
          } catch (e) {
            AgentOS.toast(e.message, "err");
            v.disabled = false;
          }
        });
      box.querySelectorAll("[data-copy]").forEach((b) =>
        b.addEventListener("click", async () => {
          const field = box.querySelector("#" + b.dataset.copy);
          if (!field) return;
          try {
            await navigator.clipboard.writeText(field.value);
          } catch {
            field.select();
            document.execCommand("copy");
          }
          const old = b.textContent;
          b.textContent = "✓ Copié";
          setTimeout(() => (b.textContent = old), 1200);
        })
      );
      box.querySelectorAll("[data-regen-text]").forEach((b) =>
        b.addEventListener("click", async () => {
          const field = b.dataset.regenText;
          const instructions = (box.querySelector("#pk-text-instr") || {}).value || "";
          const old = b.textContent;
          b.disabled = true;
          b.textContent = "⏳";
          try {
            const r = await api(`/api/machines/timetravel/runs/${run.id}/texts`, { method: "POST", body: { instructions, field } });
            AgentOS.toast({ title: "Titre régénéré", description: "Description régénérée", tags: "Tags régénérés" }[field] + " 🔄", "ok");
            box.dataset.view = "4";
            renderWizard(box, r, overlay);
          } catch (e) {
            AgentOS.toast(e.message, "err");
            b.disabled = false;
            b.textContent = old;
          }
        })
      );
      const thumbBtn = box.querySelector("#pk-thumb-regen");
      if (thumbBtn)
        thumbBtn.addEventListener("click", async () => {
          const instructions = (box.querySelector("#pk-thumb-instr") || {}).value || "";
          thumbBtn.disabled = true;
          thumbBtn.textContent = "⏳ Génération…";
          const preview = box.querySelector("#pk-thumb");
          if (preview) preview.innerHTML = `<div class="char-ph ai-thinking" style="width:290px;height:163px"><span class="spin"></span></div>`;
          try {
            const r = await api(`/api/machines/timetravel/runs/${run.id}/thumbnail`, { method: "POST", body: { instructions } });
            AgentOS.toast("Miniature régénérée 🎨 (0,03$)", "ok");
            box.dataset.view = "4";
            renderWizard(box, r, overlay);
          } catch (e) {
            AgentOS.toast(e.message, "err");
            thumbBtn.disabled = false;
            thumbBtn.textContent = "🎨 Régénérer";
          }
        });
      wireRegen(box, run, overlay, box);
      if (focus) box.querySelector(`[data-instr="${focus}"]`)?.focus();
    }

    // ═══════════ Onglet Personnages ═══════════
    function renderChars() {
      const body = el.querySelector("#tt-body");
      body.innerHTML = `
        <div class="grid grid-2">
          ${cfg.characters.map((c) => `
            <div class="char-card">
              ${c.referenceRel ? `<img src="/media/${encodeURIComponent(c.referenceRel)}">` : `<span class="char-ph">👤</span>`}
              <div class="grow" style="min-width:0">
                <div class="row between"><b>${esc(c.name)}</b>
                  <span class="row" style="gap:5px">
                    <button class="mini-btn" data-edit="${c.id}">✎ Modifier</button>
                    <button class="icon-btn" data-del="${c.id}">✕</button>
                  </span></div>
                <span class="badge accent" style="margin:4px 0">${esc(c.language)}</span>
                <div class="small muted" style="margin-top:4px">${esc((c.persona || "").slice(0, 120))}</div>
              </div>
            </div>`).join("")}
          <button class="bank-folder" id="btn-newchar" style="display:flex;align-items:center;justify-content:center;min-height:110px;font-size:14px;font-weight:700;color:var(--accent)">＋ Nouveau personnage</button>
        </div>`;
      body.querySelector("#btn-newchar").addEventListener("click", () => charDialog(null));
      body.querySelectorAll("[data-edit]").forEach((b) =>
        b.addEventListener("click", () => charDialog(cfg.characters.find((c) => c.id === b.dataset.edit)))
      );
      body.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          await api("/api/machines/timetravel/characters/" + b.dataset.del, { method: "DELETE" });
          cfg = await api("/api/machines/timetravel");
          renderChars();
        })
      );
    }
    function charDialog(existing) {
      const c = existing || { name: "", appearance: "", persona: "", language: "English", referenceRel: "" };
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="scrap-modal" style="width:min(780px,94vw);height:min(660px,88vh);overflow-y:auto">
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
            <button class="mini-btn" id="cd-ai-all" style="margin-top:6px;width:100%" title="L'IA remplit apparence + personnalité (à partir de rien ou de ce que tu as mis), selon la langue choisie">💡 Compléter</button>
          </div>
          <div class="grow">
            <label class="field"><span>Nom</span><input type="text" id="cd-name" value="${esc(c.name)}"></label>
            <label class="field"><span>Apparence (base de l'image de référence)</span>
              <textarea id="cd-app" rows="3" placeholder="ex : femme rousse — le 💡 enrichira">${esc(c.appearance)}</textarea></label>
            <label class="field"><span>Personnalité / ton</span>
              <textarea id="cd-persona" rows="2">${esc(c.persona)}</textarea></label>
            <label class="field"><span>Langue de la voix</span>
              <select id="cd-lang">${LANGS.map((l) => `<option ${c.language === l ? "selected" : ""}>${l}</option>`).join("")}</select></label>
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
      overlay.querySelector("#cd-file").addEventListener("change", (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = async () => {
          try {
            const r = await api("/api/machines/timetravel/upload-ref", {
              method: "POST",
              body: { name: overlay.querySelector("#cd-name").value || "perso", dataUrl: rd.result },
            });
            referenceRel = r.rel;
            setPreview();
            AgentOS.toast("Image de référence importée 📁", "ok");
          } catch (err) {
            AgentOS.toast(err.message, "err");
          }
        };
        rd.readAsDataURL(f);
      });
      // 💡 Compléter : UN bouton — l'IA remplit apparence + personnalité (+ nom si vide),
      // en tenant compte de la LANGUE sélectionnée (audience, style, nom crédible)
      const complete = async () => {
        const btn = overlay.querySelector("#cd-ai-all");
        btn.disabled = true;
        btn.textContent = "⏳ L'IA réfléchit…";
        overlay.querySelector("#cd-app").classList.add("ai-thinking");
        overlay.querySelector("#cd-persona").classList.add("ai-thinking");
        try {
          const r = await api("/api/machines/timetravel/complete-character", {
            method: "POST",
            body: {
              name: overlay.querySelector("#cd-name").value.trim(),
              appearance: overlay.querySelector("#cd-app").value.trim(),
              persona: overlay.querySelector("#cd-persona").value.trim(),
              language: overlay.querySelector("#cd-lang").value,
            },
          });
          if (r.appearance) overlay.querySelector("#cd-app").value = r.appearance;
          if (r.persona) overlay.querySelector("#cd-persona").value = r.persona;
          if (!overlay.querySelector("#cd-name").value.trim() && r.name) overlay.querySelector("#cd-name").value = r.name;
          AgentOS.toast("Fiche complétée par l'IA 💡", "ok");
        } catch (err) {
          AgentOS.toast(err.message, "err");
        }
        overlay.querySelector("#cd-app").classList.remove("ai-thinking");
        overlay.querySelector("#cd-persona").classList.remove("ai-thinking");
        btn.disabled = false;
        btn.textContent = "💡 Compléter";
      };
      overlay.querySelector("#cd-ai-all").addEventListener("click", complete);
      overlay.querySelector("#cd-gen").addEventListener("click", async (e) => {
        let app = overlay.querySelector("#cd-app").value.trim();
        // Apparence vide ou minimale -> l'IA complète d'abord, puis génère le portrait
        if (app.length < 60) {
          await complete();
          app = overlay.querySelector("#cd-app").value.trim();
        }
        if (!app) return AgentOS.toast("Décris (ou 💡 complète) d'abord l'apparence", "err");
        e.target.disabled = true;
        overlay.querySelector("#cd-preview").innerHTML = `<div class="char-ph ai-thinking" style="width:110px;height:110px"><span class="spin"></span></div>`;
        try {
          const r = await api("/api/machines/timetravel/generate-ref", {
            method: "POST",
            body: { name: overlay.querySelector("#cd-name").value || "perso", appearance: app },
          });
          referenceRel = r.rel;
          AgentOS.toast("Portrait généré 🎨 (0,03$)", "ok");
        } catch (err) {
          AgentOS.toast(err.message, "err");
        }
        setPreview();
        e.target.disabled = false;
      });
      overlay.querySelector("#cd-save").addEventListener("click", async () => {
        await api("/api/machines/timetravel/characters", {
          method: "POST",
          body: {
            id: existing ? existing.id : undefined,
            name: overlay.querySelector("#cd-name").value.trim(),
            appearance: overlay.querySelector("#cd-app").value.trim(),
            persona: overlay.querySelector("#cd-persona").value.trim(),
            language: overlay.querySelector("#cd-lang").value,
            referenceRel,
          },
        });
        overlay.remove();
        cfg = await api("/api/machines/timetravel");
        AgentOS.toast(existing ? "Personnage mis à jour ✎" : "Personnage créé 👤", "ok");
        renderChars();
      });
    }

    // ═══════════ Onglet Runs (historique interactif) ═══════════
    async function renderRuns() {
      const body = el.querySelector("#tt-body");
      runs = await api("/api/machines/timetravel/runs");
      const BADGE = { done: ["✓ terminé", "ok"], failed: ["✗ échec", "err"] };
      body.innerHTML = runs.length
        ? runs.map((r) => {
            const [lb, bd] = BADGE[r.status] || ["⏳ en cours", "warn"];
            return `<div class="scrap-row ${r.status === "done" ? "done" : r.status === "failed" ? "failed" : ""}" style="cursor:pointer" data-run="${r.id}">
              <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.theme?.title || r.theme?.text || "Thème auto")}</b>
              <span class="small muted">${r.sceneCount} scène(s) · ${r.mode}</span>
              <span class="small mono row-stat">${r.cost ? (r.cost.images + r.cost.videos).toFixed(2) + "$" : ""}</span>
              <span class="small muted">${ago(r.createdAt)}</span>
              <span class="badge ${bd}">${lb}</span>
              ${r.status !== "done" ? `<button class="icon-btn" data-zap="${r.id}" title="⚡ Décharge : relance le run là où il s'est arrêté">⚡</button>` : ""}
              ${!["done", "failed"].includes(r.status) ? `<button class="icon-btn" data-cancel="${r.id}" title="Annuler ce run (stoppe les requêtes en cours)">🛑</button>` : ""}
            </div>`;
          }).join("")
        : `<div class="empty">Aucun run — lance ta première vidéo dans ⚙ Générer.</div>`;
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
      body.querySelectorAll("[data-zap]").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.stopPropagation(); b.disabled = true; b.textContent = "⏳";
          try {
            await api(`/api/machines/timetravel/runs/${b.dataset.zap}/resume`, { method: "POST", body: {} });
            AgentOS.toast("⚡ Décharge envoyée — le run repart", "ok");
            openWizard(b.dataset.zap);
          } catch (err) { AgentOS.toast(err.message, "err"); }
          renderRuns();
        })
      );
      body.querySelectorAll("[data-cancel]").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.stopPropagation();
          b.disabled = true;
          try {
            await api(`/api/machines/timetravel/runs/${b.dataset.cancel}/cancel`, { method: "POST" });
            AgentOS.toast("Run annulé 🛑", "ok");
          } catch (err) {
            AgentOS.toast(err.message, "err");
          }
          renderRuns();
        })
      );
    }

    // ═══════════ Onglet Stock (vidéos terminées, postées ou non) ═══════════
    async function renderStock() {
      const body = el.querySelector("#tt-body");
      let stock = [];
      let chans = [];
      try { [stock, chans] = await Promise.all([api("/api/machines/timetravel/stock"), api("/api/channels")]); } catch {}
      const chanName = (id) => (chans.find((c) => c.channelId === id) || {}).title || id || "";
      const archived = stock.filter((v) => v.archived);
      const unposted = stock.filter((v) => !v.posted && !v.archived);
      const posted = stock.filter((v) => v.posted && !v.archived);
      const row = (v) => `
        <div class="scrap-row ${v.posted ? "done" : ""}" style="cursor:pointer;${v.archived ? "opacity:.55" : ""};border-left:3px solid ${v.archived ? "var(--border-soft)" : v.posted ? "var(--ok, #4ade80)" : "var(--accent)"}" data-run="${esc(v.runId)}">
          ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:74px;height:42px;object-fit:cover;border-radius:6px;flex:none">` : `<span style="width:74px;text-align:center">🎞</span>`}
          <b class="small grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.title)}</b>
          <span class="small muted">${Math.round((v.durationSec || 0) / 60) || "<1"} min · ${esc(v.language)}</span>
          <span class="small muted">${AgentOS.dateFr(v.createdAt)}</span>
          ${v.posted
            ? `<span class="badge ok" title="${esc(chanName(v.channelId))}">📤 postée</span>${v.videoId ? `<a class="mini-btn" href="https://youtube.com/watch?v=${esc(v.videoId)}" target="_blank" onclick="event.stopPropagation()">▶ YouTube</a>` : ""}
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
          ? `${show("stock") && unposted.length ? `<div class="small" style="font-weight:700;color:var(--accent);margin-bottom:4px">📦 EN STOCK (pas encore postées)</div>${unposted.map(row).join("")}` : ""}
             ${show("posted") && posted.length ? `<div class="small" style="font-weight:700;color:var(--ok, #4ade80);margin:12px 0 4px">📤 POSTÉES</div>${posted.map(row).join("")}` : ""}
             ${show("arch") && archived.length ? (F.v === "arch" ? `<div class="small" style="font-weight:700;color:var(--ink-2);margin:12px 0 4px">🗃 ARCHIVES (${archived.length})</div>${archived.map(row).join("")}` : `<details style="margin-top:14px"><summary class="small" style="font-weight:700;color:var(--ink-2);cursor:pointer">🗃 ARCHIVES (${archived.length})</summary>${archived.map(row).join("")}</details>`) : ""}`
          : `<div class="empty">Aucune vidéo en stock — chaque run terminé arrive automatiquement ici.</div>`}`;
      body.querySelectorAll("[data-sf]").forEach((tl) => tl.addEventListener("click", () => { F.v = F.v === tl.dataset.sf ? "all" : tl.dataset.sf; renderStock(); }));
      body.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.run)));
      const patch = async (id, patchBody, msg) => {
        try { await api(`/api/machines/timetravel/stock/${id}`, { method: "PATCH", body: patchBody }); AgentOS.toast(msg, "ok"); } catch (e) { AgentOS.toast(e.message, "err"); }
        renderStock();
      };
      body.querySelectorAll("[data-arch]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.arch, { archived: b.dataset.to === "1" }, b.dataset.to === "1" ? "Archivée 🗃" : "Désarchivée 📤"); }));
      body.querySelectorAll("[data-post]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.post, { posted: true }, "Marquée publiée ✓"); }));
      body.querySelectorAll("[data-unpost]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); patch(b.dataset.unpost, { posted: false }, "Remise en stock ↩"); }));
    }

    // ═══════════ Onglet Paramètres ═══════════
    async function renderSettings() {
      const body = el.querySelector("#tt-body");
      const s = cfg.settings;
      let chans = [];
      let niches = [];
      try { [chans, niches] = await Promise.all([api("/api/channels"), api("/api/bank/niches")]); } catch {}
      body.innerHTML = `
        <div class="grid grid-2">
          <label class="field"><span>Chaîne YouTube reliée (publication)</span>
            <select id="s-chan">
              <option value="">— aucune —</option>
              ${chans.map((c) => `<option value="${esc(c.channelId)}" ${cfg.linkedChannelId === c.channelId ? "selected" : ""}>${esc(c.title)}</option>`).join("")}
            </select></label>
          <label class="field"><span>Niche d'inspiration (Banque de Niches)</span>
            <select id="s-niche">
              <option value="">— aucune —</option>
              ${niches.map((n) => `<option value="${esc(n.id)}" ${cfg.nicheId === n.id ? "selected" : ""}>🏦 ${esc(n.name)}</option>`).join("")}
            </select></label>
          <label class="field"><span>Modèle d'image</span>
            <select id="s-img">
              <option value="gpt" ${s.imageModel === "gpt" ? "selected" : ""}>gpt-image-2-image-to-image (0,03$)</option>
              <option value="nano" ${s.imageModel === "nano" ? "selected" : ""}>nano-banana-2-lite (0,02$)</option>
              <option value="grok" ${s.imageModel === "grok" ? "selected" : ""}>grok-imagine-image (0,02$)</option>
              <option value="seedream" ${s.imageModel === "seedream" ? "selected" : ""}>seedream/5-lite (0,0275$)</option>
            </select></label>
          <label class="field"><span>Modèle vidéo</span>
            <input type="text" value="grok-imagine-video-1-5-preview (0,015$/s)" disabled></label>
          <label class="field"><span>Modèle d'écriture (prompts, scénario, packaging)</span>
            <select id="s-pmodel">
              <option value="" ${s.promptModel !== "opus" ? "selected" : ""}>Fable 5 (défaut, le plus capable)</option>
              <option value="opus" ${s.promptModel === "opus" ? "selected" : ""}>Opus 4.8</option>
            </select></label>
          <label class="field"><span>Durée des clips (secondes)</span>
            <input type="number" id="s-clip" value="${s.clipSeconds}" min="6" max="10"></label>
          <label class="field"><span>CTA visuel toutes les (minutes)</span>
            <input type="number" id="s-cta" value="${s.ctaEveryMin}" min="1"></label>
          <label class="field"><span>Montage</span>
            <input type="text" value="Remotion local (TimeTravelMontage)" disabled></label>
        </div>
        <button class="btn btn-accent mt" id="s-save">Enregistrer</button>`;
      body.querySelector("#s-save").addEventListener("click", async () => {
        cfg = await api("/api/machines/timetravel", {
          method: "PATCH",
          body: {
            linkedChannelId: body.querySelector("#s-chan").value || null,
            nicheId: body.querySelector("#s-niche").value || null,
            settings: {
              imageModel: body.querySelector("#s-img").value,
              promptModel: body.querySelector("#s-pmodel").value,
              clipSeconds: Number(body.querySelector("#s-clip").value) || 10,
              ctaEveryMin: Number(body.querySelector("#s-cta").value) || 2,
            },
          },
        });
        AgentOS.toast("Paramètres enregistrés 🛠", "ok");
      });
    }

    shell();
    // Ouverture directe d'un run (clic sur une tâche dans la page Tâches)
    try {
      const or = sessionStorage.getItem("timetravel-open-run");
      if (or) { sessionStorage.removeItem("timetravel-open-run"); openWizard(or); }
    } catch {}
  },
});
