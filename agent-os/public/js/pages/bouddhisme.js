/**
 * MACHINE BOUDDHISME — onglets : Générer / Musique / Runs / Stock / Paramètres.
 * Wizard identique aux autres machines (rail wiz-head / wiz-rail / wiz-scroll).
 *
 * Particularités de l'input :
 *  - la voix se choisit en DEUX temps : langue, puis genre (homme / femme / toutes), puis
 *    la liste des voix se recharge — le genre n'est pas exposé par l'API Inworld, il est
 *    déduit du prénom côté serveur ;
 *  - la musique peut être GÉNÉRÉE (Suno, 2 variantes) ou REPRISE du stock de pistes.
 */
AgentOS.register("bouddhisme", {
  title: "Bouddhisme",
  async render(el) {
    const { api, esc, ago } = AgentOS;
    let cfg = await api("/api/machines/bouddhisme");
    const TABS = ["gen", "library", "music", "runs", "stock", "settings"];
    let tab = TABS.includes(localStorage.getItem("boud-tab")) ? localStorage.getItem("boud-tab") : "gen";
    let wizTimer = null;
    this.onLeave = () => clearTimeout(wizTimer);

    const LANGS = Object.keys(cfg.voices || { "Français": [] });
    const STEPS = [
      { key: "script", icon: "📝", label: "Script" },
      { key: "voice", icon: "🎙", label: "Voix" },
      { key: "library", icon: "🖼", label: "Références" },
      { key: "prompts", icon: "✍", label: "Prompts" },
      { key: "images", icon: "🖼", label: "Images" },
      { key: "music", icon: "🎵", label: "Musique" },
      { key: "montage", icon: "🎬", label: "Montage" },
    ];
    const FINI = STEPS.length;

    function shell() {
      el.innerHTML = `
        <div class="card">
          <h2><a href="#/machines" class="back-btn" style="margin-right:10px" title="Retour aux Machines">←</a>🪷 Bouddhisme
            <span class="h-actions">
              <span class="mini-seg" id="boud-tabs">
                <button data-t="gen" class="${tab === "gen" ? "active" : ""}">⚙ Générer</button>
                <button data-t="library" class="${tab === "library" ? "active" : ""}">🖼 Bibliothèque</button>
                <button data-t="music" class="${tab === "music" ? "active" : ""}">🎵 Musique</button>
                <button data-t="runs" class="${tab === "runs" ? "active" : ""}">🎞 Runs</button>
                <button data-t="stock" class="${tab === "stock" ? "active" : ""}">📦 Stock</button>
                <button data-t="settings" class="${tab === "settings" ? "active" : ""}">🛠 Paramètres</button>
              </span>
            </span>
          </h2>
          <div id="boud-body"></div>
        </div>`;
      el.querySelectorAll("#boud-tabs button").forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.t;
          try { localStorage.setItem("boud-tab", tab); } catch {}
          shell();
        })
      );
      ({ gen: renderGen, library: renderLibrary, music: renderMusic, runs: renderRuns, stock: renderStock, settings: renderSettings })[tab]();
    }

    // ═══════════════════════════ Onglet Générer ═══════════════════════════
    let mode = "semi";
    async function renderGen() {
      const body = el.querySelector("#boud-body");
      let chans = [];
      try { chans = await api("/api/channels"); } catch {}
      const lang = cfg.voices[cfg.settings.chainLanguage] ? cfg.settings.chainLanguage : "Français";
      const lib = cfg.musicLib || [];
      const styles = (cfg.musicStyles || []).concat(["Aucune"]);

      body.innerHTML = `
        <label class="field"><span>Sujet de la vidéo <span class="muted">(laisse vide et clique 💡 : la machine choisit d'après la banque de niche)</span></span>
          <span class="row" style="gap:6px">
            <input id="g-subject" class="grow" placeholder="ex : ce que tu portes encore sans le savoir">
            <button class="btn btn-sm" id="g-idea" title="Proposer un sujet d'après la banque de niche">💡</button>
          </span></label>

        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Langue de la vidéo</span>
            <select id="g-lang">${LANGS.map((l) => `<option${l === lang ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Voix</span>
            <select id="g-gender"><option value="">Homme et femme</option><option value="H">Homme</option><option value="F">Femme</option></select></label>
          <label class="field" style="margin:0"><span>Moteur de voix</span>
            <select id="g-engine">
              <option value="inworld"${cfg.settings.ttsEngine !== "elevenlabs" ? " selected" : ""}>Inworld — 0,015 $/1000 car.</option>
              <option value="elevenlabs"${cfg.settings.ttsEngine === "elevenlabs" ? " selected" : ""}>ElevenLabs v3 — 0,10 $/1000 car.</option>
            </select></label>
          <label class="field" style="margin:0"><span id="g-voice-label">Voix Inworld</span>
            <div class="row" style="gap:6px">
              <select id="g-voice" style="flex:1"></select>
              <button class="btn btn-sm" id="g-setdef" style="flex:none"
                title="Mémoriser ce moteur + cette voix comme défaut de la machine (c'est ce que prendra un lancement automatique)">★</button>
            </div></label>
          <label class="field" style="margin:0"><span>Narration</span>
            <select id="g-speed"><option value="lente" selected>Lente</option><option value="très lente">Très lente</option></select></label>
        </div>

        <div class="grid grid-3 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Durée</span>
            <select id="g-dur">${[8, 10, 12, 15, 18, 20].map((d) => `<option value="${d}"${d === 10 ? " selected" : ""}>${d} minutes</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Musique de fond</span>
            <select id="g-music">
              ${styles.map((s) => `<option value="${esc(s)}"${s === cfg.settings.musicStyle ? " selected" : ""}>${esc(s)}</option>`).join("")}
              ${lib.length ? `<optgroup label="Reprendre une piste du stock">${lib.map((t) => `<option value="lib:${esc(t.id)}">♻ ${esc(t.title)} — ${esc(t.style || "")}</option>`).join("")}</optgroup>` : ""}
            </select></label>
          <label class="field" style="margin:0"><span>Fréquence du CTA</span>
            <select id="g-cta">${[0, 1, 1.5, 2, 2.5, 3, 4, 5].map((v) => `<option value="${v}"${v === (cfg.settings.ctaEveryMin || 2) ? " selected" : ""}>${v === 0 ? "Aucun CTA" : "toutes les " + v + " min"}</option>`).join("")}</select></label>
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
            <select id="g-pubchan" style="min-width:170px"></select>
            <select id="g-pubpriv" style="width:150px" title="Mode de publication automatique"><option value="private" selected>🔒 Privée</option><option value="unlisted">🔗 Non répertoriée</option><option value="public">🌍 Publique</option></select></span>
          <span id="g-cost" style="margin-left:auto;font-weight:800;font-size:17px;color:#4ade80;background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.35);border-radius:10px;padding:9px 16px;white-space:nowrap"></span>
          <button class="btn btn-accent" id="g-go" style="font-size:14px;padding:10px 22px">⚙ Générer</button>
        </div>
        <div class="small muted" style="text-align:right">Script → Voix → Prompts → Images → Musique → Montage → Packaging</div>`;

      const $ = (s) => body.querySelector(s);
      const seg = (id, cb) => body.querySelectorAll(`#${id} button`).forEach((b) =>
        b.addEventListener("click", () => { body.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle("active", x === b)); cb && cb(b.dataset.v); }));
      const activeVal = (id) => body.querySelector(`#${id} button.active`).dataset.v;

      // Voix : langue + genre -> liste rechargée côté serveur
      const fillVoices = async () => {
        const sel = $("#g-voice");
        sel.innerHTML = `<option>…</option>`;
        try {
          const eng = $("#g-engine").value;
          const vs = await api(`/api/machines/bouddhisme/voices?language=${encodeURIComponent($("#g-lang").value)}&gender=${$("#g-gender").value}&engine=${eng}`);
          sel.innerHTML = vs.length
            ? vs.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} — ${v.gender === "F" ? "femme" : "homme"}</option>`).join("")
            : `<option value="">aucune voix pour cette langue</option>`;
          $("#g-voice-label").textContent = eng === "elevenlabs" ? "Voix ElevenLabs" : "Voix Inworld";
          // Voix mémorisée = celle qui doit être là à l'arrivée sur la machine.
          if (cfg.settings.voice && [...sel.options].some((o) => o.value === cfg.settings.voice)) sel.value = cfg.settings.voice;
        } catch { sel.innerHTML = `<option>—</option>`; }
      };
      await fillVoices();
      $("#g-lang").addEventListener("change", async () => { await fillVoices(); markDefault(); });
      $("#g-gender").addEventListener("change", async () => { await fillVoices(); markDefault(); });
      // Choisir ≠ mémoriser. Le menu ne sert QUE la vidéo en cours ; le défaut de la machine
      // se pose explicitement avec ★. Sinon un simple clic exploratoire devient le défaut —
      // constaté : la voix mémorisée avait été écrasée en parcourant la liste.
      const isDefault = () =>
        $("#g-engine").value === cfg.settings.ttsEngine && $("#g-voice").value === cfg.settings.voice;
      const markDefault = () => {
        const b = $("#g-setdef");
        const on = isDefault();
        b.textContent = on ? "★" : "☆";
        b.style.color = on ? "#4ade80" : "";
        b.title = on
          ? `Défaut actuel de la machine : ${cfg.settings.voice} (${cfg.settings.ttsEngine}) — c'est ce que prendra un lancement automatique`
          : "Définir ce moteur + cette voix comme défaut de la machine (utilisé par les lancements automatiques)";
      };
      $("#g-engine").addEventListener("change", async () => {
        await fillVoices();
        costLine();      // le moteur change le prix d'un facteur 6,7 : recalcul immédiat
        markDefault();
      });
      $("#g-voice").addEventListener("change", markDefault);
      $("#g-setdef").addEventListener("click", async () => {
        const patch = { ttsEngine: $("#g-engine").value, voice: $("#g-voice").value };
        if (!patch.voice) return AgentOS.toast("Choisis d'abord une voix", "err");
        try {
          await api("/api/machines/bouddhisme", { method: "PATCH", body: { settings: patch } });
          Object.assign(cfg.settings, patch);
          markDefault();
          AgentOS.toast(`Défaut : ${patch.voice} (${patch.ttsEngine === "elevenlabs" ? "ElevenLabs" : "Inworld"})`, "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
      seg("g-sub");
      seg("g-mode", (v) => (mode = v));

      const costLine = async () => {
        const d = Number($("#g-dur").value) || 10;
        const mv = $("#g-music").value;
        try {
          const e = await api("/api/machines/bouddhisme/estimate", { method: "POST", body: {
            durationMin: d,
            ttsEngine: $("#g-engine").value,
            musicStyle: mv.startsWith("lib:") ? "lib" : mv,
            musicReuseId: mv.startsWith("lib:") ? mv.slice(4) : null,
          }});
          const c = $("#g-cost");
          c.textContent = `≈ ${e.total.toFixed(2)} $`;
          const moteur = e.engine === "elevenlabs" ? "ElevenLabs" : "Inworld";
          c.title = `~${e.words} mots (${e.chars} car.) · ~${e.shots} visuels ${e.images.toFixed(2)}$`
            + ` · voix ${moteur} ${e.tts.toFixed(2)}$ (${e.per1k}$/1000 car.)`
            + ` · Whisper ${e.whisper.toFixed(2)}$ · musique ${e.music.toFixed(2)}$ · références ${e.refs.toFixed(2)}$`;
        } catch {}
      };
      $("#g-dur").addEventListener("change", costLine);
      $("#g-music").addEventListener("change", costLine);
      costLine();
      markDefault();

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
        }));
      gateGo();

      $("#g-idea").addEventListener("click", async () => {
        const input = $("#g-subject"), btn = $("#g-idea");
        input.classList.add("ai-thinking"); input.disabled = true; input.value = ""; input.placeholder = "💡 Je fouille la niche…";
        btn.disabled = true; btn.textContent = "⏳";
        try {
          const j = await api("/api/machines/bouddhisme/idea", { method: "POST" });
          input.value = j.subject || "";
          if (j.pitch) AgentOS.toast("💡 " + j.pitch, "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
        input.classList.remove("ai-thinking"); input.disabled = false;
        input.placeholder = "ex : ce que tu portes encore sans le savoir";
        btn.disabled = false; btn.textContent = "💡";
      });

      goBtn.addEventListener("click", async () => {
        goBtn.disabled = true; goBtn.textContent = "⏳ Lancement…";
        const mv = $("#g-music").value;
        try {
          const run = await api("/api/machines/bouddhisme/runs", { method: "POST", body: {
            subject: $("#g-subject").value.trim(),
            durationMin: Number($("#g-dur").value),
            language: $("#g-lang").value,
            voiceGender: $("#g-gender").value,
            ttsEngine: $("#g-engine").value,
            voice: $("#g-voice").value,
            narrationSpeed: $("#g-speed").value,
            musicStyle: mv.startsWith("lib:") ? "lib" : mv,
            musicReuseId: mv.startsWith("lib:") ? mv.slice(4) : null,
            cta: Number($("#g-cta").value) > 0,
            subtitles: activeVal("g-sub") === "1",
            mode: activeVal("g-mode"),
            publishChannelId: pubOn() ? pubChan.value : null,
            publishPrivacy: $("#g-pubpriv").value,
          }});
          if (Number($("#g-cta").value) > 0) await api("/api/machines/bouddhisme", { method: "PATCH", body: { settings: { ctaEveryMin: Number($("#g-cta").value) } } });
          AgentOS.toast("🚀 Run lancé", "ok");
          openWizard(run.id);
        } catch (e) { AgentOS.toast(e.message, "err"); }
        goBtn.disabled = false; goBtn.textContent = "⚙ Générer";
        gateGo();
      });
    }

    // ═══════════════════════════ Onglet Bibliothèque ═══════════════════════════
    // Les identités récurrentes de la chaîne. La machine y pioche seule et ne crée que ce
    // qui manque : c'est ce qui garde le même moine d'un plan à l'autre ET d'une vidéo à l'autre.
    async function renderLibrary() {
      const body = el.querySelector("#boud-body");
      const { entries } = await api("/api/machines/bouddhisme/library");
      const groups = { personnage: entries.filter((e) => e.kind !== "lieu"), lieu: entries.filter((e) => e.kind === "lieu") };
      body.innerHTML = `
        <div class="empty small" style="text-align:left;margin-bottom:12px">
          <b>La machine se sert seule dans cette bibliothèque.</b> Elle réutilise en priorité ce qui
          existe et n'ajoute que ce que le récit du jour exige (3 créations maximum par vidéo).
          Chaque entrée est réinjectée en image-to-image : c'est ce qui garde le même moine et le
          même monastère d'un plan à l'autre.
        </div>
        <div class="row between mb">
          <span class="small muted">${entries.length} entrée(s) · ${groups.personnage.length} personnage(s) · ${groups.lieu.length} lieu(x)</span>
          <span class="row" style="gap:6px">
            <input id="lib-desc" class="grow" placeholder="Décris en français ce que tu veux ajouter…" style="min-width:340px">
            <button class="btn btn-sm btn-accent" id="lib-add">+ Ajouter</button>
          </span>
        </div>
        ${!entries.length ? `<div class="empty">Bibliothèque vide — elle se remplira toute seule au premier run.</div>` : `
        ${["personnage", "lieu"].map((k) => !groups[k].length ? "" : `
          <div class="small muted mt" style="font-weight:700">${k === "lieu" ? "🏛 Lieux" : "🧘 Personnages"} (${groups[k].length})</div>
          <div class="grid grid-4" style="gap:8px;margin-top:6px">${groups[k].map((e) => `
            <div class="thumb-card">
              <img src="/api/machines/bouddhisme/library/${encodeURIComponent(e.id)}/sheet?v=${e.ts || 0}" style="width:100%;height:150px;object-fit:contain;background:var(--bg-deep);border-radius:6px">
              <b class="small" style="display:block;margin-top:5px">${esc(e.name)}</b>
              <div class="small muted" style="line-height:1.35;max-height:32px;overflow:hidden">${esc((e.tags || []).join(" · "))}</div>
              <div class="small muted mono">${e.uses || 0} vidéo(s)</div>
              <div class="row" style="gap:4px;margin-top:5px">
                <button class="btn btn-sm btn-ghost" data-regen="${esc(e.id)}" title="Redessiner (même identité)">↻</button>
                <button class="btn btn-sm btn-ghost" data-del="${esc(e.id)}" title="Supprimer">🗑</button>
              </div>
            </div>`).join("")}</div>`).join("")}`}`;

      const add = body.querySelector("#lib-add");
      add.addEventListener("click", async () => {
        const d = body.querySelector("#lib-desc").value.trim();
        if (!d) return AgentOS.toast("Décris ce que tu veux ajouter", "err");
        add.disabled = true; add.textContent = "⏳ Rédaction…";
        try {
          const spec = await api("/api/machines/bouddhisme/library/draft", { method: "POST", body: { description: d } });
          add.textContent = "⏳ Dessin…";
          await api("/api/machines/bouddhisme/library", { method: "POST", body: spec });
          AgentOS.toast("Référence ajoutée", "ok");
          renderLibrary();
        } catch (e) { AgentOS.toast(e.message, "err"); add.disabled = false; add.textContent = "+ Ajouter"; }
      });
      body.querySelectorAll("[data-regen]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "⏳";
        try { await api(`/api/machines/bouddhisme/library/${encodeURIComponent(b.dataset.regen)}/regen`, { method: "POST", body: {} }); renderLibrary(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = "↻"; }
      }));
      body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try { await api(`/api/machines/bouddhisme/library/${encodeURIComponent(b.dataset.del)}`, { method: "DELETE" }); renderLibrary(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
      }));
    }

    // ═══════════════════════════ Onglet Musique ═══════════════════════════
    // Chaque piste retenue dans un run atterrit ici : la réutiliser sur une prochaine vidéo
    // économise 0,06 $ et 5 minutes d'attente Suno.
    async function renderMusic() {
      const body = el.querySelector("#boud-body");
      const lib = await api("/api/machines/bouddhisme/music");
      body.innerHTML = `
        <div class="empty small" style="text-align:left;margin-bottom:12px">
          <b>Stock de pistes</b> — chaque musique validée dans un run est conservée ici.
          Elle reste réutilisable dans l'onglet ⚙ Générer, sans repasser par Suno.
        </div>
        ${!lib.length ? `<div class="empty">Aucune piste pour l'instant. Lance un run : la variante que tu retiens sera stockée ici.</div>` : `
        <div class="list">${lib.map((t) => `
          <div class="list-row">
            <div class="grow">
              <b>${esc(t.title || "Sans titre")}</b>
              <div class="small muted">${esc(t.style || "—")} · ${t.duration ? Math.round(t.duration) + " s" : "?"} · ${ago(t.createdAt)}</div>
            </div>
            <audio controls preload="none" src="/media/${encodeURIComponent(t.rel)}" style="height:32px"></audio>
            <button class="btn btn-sm btn-ghost" data-del="${esc(t.id)}" title="Retirer du stock">🗑</button>
          </div>`).join("")}</div>`}`;
      body.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          try { await api("/api/machines/bouddhisme/music/" + encodeURIComponent(b.dataset.del), { method: "DELETE" }); renderMusic(); }
          catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
        }));
    }

    // ═══════════════════════════ Wizard ═══════════════════════════
    function stepIndex(status) {
      const i = STEPS.findIndex((s) => status.startsWith(s.key));
      return i < 0 ? FINI : i;
    }
    function stepDone(run, i) {
      const sc = run.scenes || [];
      if (i === 0) return !!run.script;
      if (i === 1) return !!(sc.length && run.words?.length);
      if (i === 2) return !!run.library;
      if (i === 3) return !!(sc.length && sc.every((s) => s.prompt));
      if (i === 4) return !!(sc.length && sc.every((s) => s.image));
      if (i === 5) return !!(run.music && (run.music.none || run.music.file));
      return !!run.finalRel;
    }
    function globalPct(run) {
      const n = run.scenes?.length || 1;
      const done = (run.scenes || []).filter((s) => s.image).length;
      const map = { script_running: 6, script_ready: 14, voice_running: 18, voice_ready: 30, library_running: 32, library_ready: 35, prompts_running: 38,
                    prompts_ready: 45, images_ready: 70, music_running: 72, music_ready: 78,
                    montage_running: 84, packaging_running: 94, done: 100 };
      if (run.status === "images_running") return 46 + Math.round((24 * done) / n);
      return map[run.status] ?? 8;
    }
    function countHTML(run) {
      const n = (run.scenes || []).length;
      if (!n) return "";
      const live = run.scenes.filter((s) => s.pending).length;
      if (run.status.startsWith("images")) {
        const done = run.scenes.filter((s) => s.image).length;
        const fail = run.scenes.filter((s) => !s.image && s.error).length;
        return `🖼 ${done}/${n} images${live ? ` · ${live} en cours` : ""}${fail ? ` · <span style="color:var(--err)">${fail} échec</span>` : ""}`;
      }
      if (run.status.startsWith("prompts")) return `✍ ${run.scenes.filter((s) => s.prompt).length}/${n} prompts`;
      if (run.status.startsWith("library")) return `🖼 ${(run.library || []).length} référence(s)`;
      if (run.status.startsWith("music")) return `🎵 ${(run.music?.variants || []).length} variante(s)`;
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
        try { run = await api("/api/machines/bouddhisme/runs/" + runId); }
        catch (e) { overlay.querySelector("#wiz").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
        const box = overlay.querySelector("#wiz");
        const sc = run.scenes || [];
        const nb = (f) => sc.filter((s) => s[f]).length;
        const shellKey = [run.status, box.dataset.view || "", sc.length, run.error ? 1 : 0, nb("prompt"), nb("image"),
          sc.filter((s) => s.pending).length, run.music?.chosen || "", (run.music?.variants || []).length,
          run.finalRel ? 1 : 0, run.pack ? 1 : 0, run.thumbTs || 0].join("|");
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
        voice_ready: "✓ Valider le découpage → Références",
        library_ready: "✓ Valider les références → Prompts",
        prompts_ready: "✓ Valider les prompts → Images",
        images_ready: "✓ Valider les images → Musique",
        music_ready: "✓ Valider la musique → Montage",
      }[run.status];
      const runMsg = {
        script_running: "Claude écrit le texte de la voix off…",
        voice_running: "Inworld synthétise, Whisper transcrit, la machine découpe les visuels sur le sens…",
        library_running: "Bibliothèque : choix des références récurrentes…",
        prompts_running: "Écriture des descriptions d'images…",
        images_running: "Génération des images (5 en parallèle)…",
        music_running: "Suno compose le lit musical (2 variantes, ~5 min)…",
        montage_running: "Montage final (Ken Burns, fondus, musique, sous-titres, CTA)…",
        packaging_running: "Claude prépare titre, description, tags et miniature…",
      }[run.status] || "";
      const cost = run.cost ? (run.cost.images + run.cost.voice + (run.cost.music || 0)) : 0;

      box.classList.add("wiz-modal");
      box.innerHTML = `
        <div class="wiz-head">
          <div class="wiz-gbar" title="Progression : ${gpct}%"><div style="width:${gpct}%"></div></div>
          <div class="row between" style="margin:10px 0 4px">
            <h2 style="margin:0;font-size:15px">🪷 ${esc(run.pack?.title || run.title)}
              <span class="small muted mono" style="margin-left:8px">${run.id} · ${run.mode} · ${esc(run.params.language)} · ${esc(run.params.voice)} · ${cost.toFixed(2)}$ · ${gpct}%</span></h2>
            <span class="row" style="gap:6px">
              ${run.status !== "done" ? `<button class="btn btn-sm" data-zap-run title="⚡ Décharge : relance le run là où il s'est arrêté">⚡</button>` : ""}
              ${!["done", "failed"].includes(run.status) ? `<button class="btn btn-sm" data-cancel-run title="Annuler ce run">🛑 Annuler</button>` : ""}
              <button class="btn btn-sm btn-ghost" data-close>✕</button>
            </span>
          </div>
          <div class="wiz-rail">
            ${STEPS.map((s, i) => `
              <div class="wiz-step ${stepDone(run, i) ? "done" : i === idx ? "active" : ""}" data-view="${i}" style="cursor:pointer" title="${s.label}">
                <div class="wiz-dot" ${i === viewIdx ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>${stepDone(run, i) ? "✓" : i < idx ? "⚠" : s.icon}</div><span>${s.label}</span>
              </div>
              ${i < STEPS.length - 1 ? `<div class="wiz-link ${stepDone(run, i) ? "done" : i === idx && running ? "active" : ""}"></div>` : ""}`).join("")}
            <div class="wiz-link ${run.status === "done" ? "done" : run.status === "packaging_running" ? "active" : ""}"></div>
            <div class="wiz-step ${run.status === "done" ? "done" : ""}" data-view="${FINI}" style="cursor:pointer" title="Titre, description, tags, miniature, publication">
              <div class="wiz-dot" ${viewIdx === FINI ? 'style="outline:2px solid var(--accent);outline-offset:3px"' : ""}>🏁</div><span>Fini</span>
            </div>
          </div>
          ${run.error ? `<div class="empty small" style="color:var(--err);margin:0"><b>Échec</b> ${esc(run.error)} <button class="btn btn-sm" data-retry>↻ Reprendre où on s'est arrêté</button></div>` : ""}
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
        try { await api(`/api/machines/bouddhisme/runs/${run.id}/validate`, { method: "POST" }); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
      });
      on("[data-cancel-run]", async (b) => {
        b.disabled = true;
        try { await api(`/api/machines/bouddhisme/runs/${run.id}/cancel`, { method: "POST" }); AgentOS.toast("Run annulé 🛑", "ok"); reopen(); }
        catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
      });
      const zap = async (b) => {
        b.disabled = true;
        try { await api(`/api/machines/bouddhisme/runs/${run.id}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée", "ok"); reopen(); }
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
        return `<div class="small muted mb">${n} mots · ~${(n / 122).toFixed(1)} min estimées${run.theme ? ` · thème : <b>${esc(run.theme)}</b>` : ""}</div>
          <div class="empty small" style="text-align:left;white-space:pre-wrap;line-height:1.75">${esc(run.script)}</div>`;
      }

      if (key === "voice") {
        if (!run.voRel) return `<div class="empty small"><span class="spin"></span> Synthèse de la voix off…</div>`;
        const st = run.shotStats || {};
        return `<div class="row mb" style="gap:10px;align-items:center;flex-wrap:wrap">
            <audio controls src="/media/${encodeURIComponent(run.voRel)}" style="height:34px"></audio>
            <span class="badge accent">${(run.voDuration / 60).toFixed(2)} min</span>
            <span class="badge mut">${st.count || 0} visuels · médiane ${st.median || "?"} s · ${st.perMin || "?"}/min</span>
            <span class="small muted">référence niche : 2,9 à 5,1 visuels/min</span>
          </div>
          <div class="list">${(run.scenes || []).map((s) => `
            <div class="list-row"><span class="mono small" style="width:44px;flex:none">#${s.i}</span>
              <span class="mono small muted" style="width:110px;flex:none">${s.start.toFixed(1)}→${s.end.toFixed(1)}s</span>
              <span class="badge mut" style="flex:none">${s.dur.toFixed(1)}s</span>
              <span class="grow small">${esc(String(s.say).slice(0, 150))}</span></div>`).join("")}</div>`;
      }

      if (key === "library") {
        const lib = run.library || [];
        if (!lib.length) return `<div class="empty small">${run.status.startsWith("library") ? '<span class="spin"></span> Choix des références…' : "Aucune référence pour cette vidéo — les prompts suffisent."}</div>`;
        const withRefs = (run.scenes || []).filter((s) => (s.refs || []).length).length;
        return `<div class="small muted mb">${lib.length} référence(s) ancrée(s) · attribuées à ${withRefs}/${(run.scenes || []).length} plans — ces identités resteront les mêmes d'un plan à l'autre.</div>
          <div class="grid grid-4" style="gap:8px">${lib.map((e) => `
            <div class="thumb-card">
              <img src="/api/machines/bouddhisme/library/${encodeURIComponent(e.id)}/sheet" style="width:100%;height:140px;object-fit:contain;background:var(--bg-deep);border-radius:6px">
              <b class="small" style="display:block;margin-top:5px">${esc(e.name)}</b>
              <div class="small muted">${e.kind === "lieu" ? "🏛 lieu" : "🧘 personnage"} · ${(run.scenes || []).filter((s) => (s.refs || []).includes(e.id)).length} plan(s)</div>
            </div>`).join("")}</div>`;
      }

      if (key === "prompts") {
        const done = (run.scenes || []).filter((s) => s.prompt).length;
        if (!done) return `<div class="empty small"><span class="spin"></span> Écriture des prompts…</div>`;
        return `<div class="small muted mb">${done}/${(run.scenes || []).length} prompts · direction artistique verrouillée sur la niche mesurée</div>
          <div class="list">${(run.scenes || []).map((s) => `
            <div class="list-row"><span class="mono small" style="width:44px;flex:none">#${s.i}</span>
              <span class="grow small" style="line-height:1.5">${s.prompt ? esc(s.prompt.slice(0, 260)) : '<span class="muted">…</span>'}</span></div>`).join("")}</div>`;
      }

      if (key === "images") {
        const sc = run.scenes || [];
        if (!sc.length) return `<div class="empty small">Pas encore de visuels.</div>`;
        return `<div class="grid grid-4" style="gap:8px">${sc.map((s) => `
          <div class="thumb-card${s.pending ? " is-pending" : ""}" data-scene="${s.i}">
            ${s.image
              ? `<img src="/media/${encodeURIComponent(s.image.rel)}?v=${s.image.ts}" style="width:100%;height:106px;object-fit:cover;border-radius:6px">`
              : `<div class="empty small" style="height:106px;display:flex;align-items:center;justify-content:center;margin:0">${s.pending ? '<span class="spin"></span>' : s.error ? '<span style="color:var(--err)">échec</span>' : "…"}</div>`}
            <div class="row between" style="margin-top:4px">
              <span class="mono small muted">#${s.i} · ${s.dur.toFixed(1)}s</span>
              <button class="btn btn-sm btn-ghost" data-regen="${s.i}" ${s.pending ? "disabled" : ""} title="Régénérer ce visuel">↻</button>
            </div>
            <div class="small muted" style="line-height:1.35;max-height:34px;overflow:hidden">${esc(String(s.say).slice(0, 80))}</div>
          </div>`).join("")}</div>`;
      }

      if (key === "music") {
        const m = run.music;
        if (!m) return `<div class="empty small"><span class="spin"></span> Suno compose (2 variantes, ~5 min)…</div>`;
        if (m.none) return `<div class="empty small">Cette vidéo est montée <b>sans musique de fond</b>.</div>`;
        if (m.fromLib) return `<div class="empty small" style="text-align:left">Piste reprise du stock.<br>
          <audio controls src="/media/${encodeURIComponent(m.rel)}" style="height:34px;margin-top:8px"></audio></div>`;
        if (!m.variants?.length) return `<div class="empty small"><span class="spin"></span> Suno compose…</div>`;
        return `<div class="small muted mb">Deux variantes instrumentales — écoute et retiens celle qui te va. Elle sera ajoutée au stock de pistes.</div>
          <div class="list">${m.variants.map((v) => `
            <div class="list-row ${m.chosen === v.k ? "is-active" : ""}">
              <span class="badge ${m.chosen === v.k ? "accent" : "mut"}" style="flex:none">${v.k.toUpperCase()}</span>
              <span class="grow"><b>${esc(v.title || "Variante " + v.k.toUpperCase())}</b>
                <div class="small muted">${v.duration ? v.duration + " s" : ""} · ${esc(m.style || "")}</div></span>
              <audio controls preload="none" src="/media/${encodeURIComponent(v.rel)}" style="height:32px"></audio>
              <button class="btn btn-sm ${m.chosen === v.k ? "btn-accent" : ""}" data-music="${v.k}">${m.chosen === v.k ? "✓ retenue" : "Retenir"}</button>
            </div>`).join("")}</div>`;
      }

      if (key === "montage") {
        if (!run.finalRel) return `<div class="empty small"><span class="spin"></span> Montage en cours…</div>`;
        return `<video controls src="/media/${encodeURIComponent(run.finalRel)}" style="width:100%;border-radius:10px"></video>`;
      }

      // ── Fini ── (même disposition que la machine Linguistique, pour rester cohérent)
      const pk = run.pack;
      if (!pk) return `<div class="empty small"><span class="spin"></span> Préparation du packaging…</div>`;
      const pub = run.published;
      const tagStr = (pk.tags || []).join(", ");
      return `${pub && pub.url
          ? `<div class="empty small" style="margin:0 0 10px;color:#4ade80;border-color:rgba(74,222,128,.4)"><b>📤 ✅ PUBLIÉE (${pub.privacyStatus === "public" ? "🌍 publique" : pub.privacyStatus === "unlisted" ? "🔗 non répertoriée" : "🔒 privée"})</b> <a href="${esc(pub.url)}" target="_blank">▶ Voir sur YouTube</a></div>`
          : `<div class="small muted" style="margin-bottom:8px">📦 Pas de publication automatique : la vidéo attend dans le <b>Stock</b> (publie-la ci-dessous quand tu veux).</div>`}
        <div class="row mt" style="gap:16px;align-items:flex-start">
          <div style="flex:none;width:290px">
            <div id="pk-thumb">${run.thumbRel
              ? `<img src="/media/${encodeURIComponent(run.thumbRel)}?t=${run.thumbTs || 0}" style="width:290px;border-radius:10px;border:1px solid var(--border-soft)">`
              : `<div class="empty small">Pas de miniature</div>`}</div>
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
            <label class="field"><span class="row between">Description <span class="row" style="gap:5px"><span class="small muted mono">${(pk.description || "").split(/\s+/).filter(Boolean).length} mots</span><button class="mini-btn" data-copy="pk-desc">📋</button><button class="mini-btn" data-regen-text="description">↻💡</button></span></span><textarea id="pk-desc" rows="8">${esc(pk.description || "")}</textarea></label>
            <label class="field"><span class="row between">Tags <span class="row" style="gap:5px"><span class="small muted mono">${tagStr.length}/500</span><button class="mini-btn" data-copy="pk-tags">📋</button><button class="mini-btn" data-regen-text="tags">↻💡</button></span></span><textarea id="pk-tags" rows="2">${esc(tagStr)}</textarea></label>
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

    function wireView(box, run, viewIdx, reopen) {
      const key = STEPS[viewIdx]?.key || "fini";

      if (key === "images") {
        box.querySelectorAll("[data-regen]").forEach((b) =>
          b.addEventListener("click", async () => {
            const i = b.dataset.regen;
            const note = prompt(`Visuel #${i} — que faut-il changer ? (vide = simple relance)`) ?? null;
            if (note === null) return;
            b.disabled = true;
            try {
              await api(`/api/machines/bouddhisme/runs/${run.id}/regen`, { method: "POST", body: { scene: i, instructions: note } });
              AgentOS.toast("Visuel régénéré", "ok");
              reopen();
            } catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
          }));
      }

      if (key === "music") {
        box.querySelectorAll("[data-music]").forEach((b) =>
          b.addEventListener("click", async () => {
            b.disabled = true;
            try { await api(`/api/machines/bouddhisme/runs/${run.id}/music`, { method: "POST", body: { variant: b.dataset.music } }); reopen(); }
            catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; }
          }));
      }

      if (key === "fini") {
        const pubBtn = box.querySelector("[data-publish]");
        if (pubBtn) {
          const sel = box.querySelector("#pk-chan");
          api("/api/channels").then((chs) => {
            sel.innerHTML = `<option value="">— chaîne YouTube —</option>` +
              chs.filter((c) => !c.error).map((c) => `<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("");
          }).catch(() => {});
          sel.addEventListener("change", () => (pubBtn.disabled = !sel.value));
          pubBtn.addEventListener("click", async () => {
            pubBtn.disabled = true; pubBtn.textContent = "⏳ Upload…";
            try {
              const r = await api(`/api/machines/bouddhisme/runs/${run.id}/publish`, { method: "POST", body: {
                channelId: sel.value,
                privacyStatus: (box.querySelector("#pk-priv") || {}).value || "private",
                title: box.querySelector("#pk-title").value.trim(),
                description: box.querySelector("#pk-desc").value,
                tags: box.querySelector("#pk-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
              }});
              AgentOS.toast("📤 Publiée : " + r.url, "ok");
              reopen();
            } catch (e) { AgentOS.toast(e.message, "err"); pubBtn.disabled = false; }
            pubBtn.textContent = "📤 Publier";
          });
        }

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
          try {
            await api(`/api/machines/bouddhisme/runs/${run.id}/texts`, { method: "POST", body: { instructions, field } });
            AgentOS.toast("Régénéré 🔄", "ok");
            reopen();
          } catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = old; }
        }));

        const thumbBtn = box.querySelector("#pk-thumb-regen");
        if (thumbBtn) thumbBtn.addEventListener("click", async () => {
          const instructions = (box.querySelector("#pk-thumb-instr") || {}).value || "";
          thumbBtn.disabled = true; thumbBtn.textContent = "⏳…";
          const preview = box.querySelector("#pk-thumb");
          if (preview) preview.innerHTML = `<div class="char-ph ai-thinking" style="width:290px;height:163px"><span class="spin"></span></div>`;
          try {
            await api(`/api/machines/bouddhisme/runs/${run.id}/thumbnail`, { method: "POST", body: { instructions } });
            AgentOS.toast("Miniature régénérée 🎨", "ok");
            reopen();
          } catch (e) { AgentOS.toast(e.message, "err"); thumbBtn.disabled = false; thumbBtn.textContent = "🎨 Régénérer"; }
        });
      }
    }

    // ═══════════════════════════ Runs / Stock / Paramètres ═══════════════════════════
    async function renderRuns() {
      const body = el.querySelector("#boud-body");
      const runs = await api("/api/machines/bouddhisme/runs");
      body.innerHTML = !runs.length
        ? `<div class="empty">Aucun run. Lance ta première vidéo dans ⚙ Générer.</div>`
        : `<div class="list">${runs.map((r) => {
            const c = r.cost ? (r.cost.images + r.cost.voice + (r.cost.music || 0)) : 0;
            const cls = r.status === "done" ? "ok" : r.status === "failed" ? "err" : "warn";
            // ⚠ `_ready` s'affichait « script ✓ » — cela ressemble à une réussite, alors que le
            //   run est ARRÊTÉ et attend une validation. L'utilisateur ne le retrouvait pas.
            const label = /_ready$/.test(r.status)
              ? `⏸ ${r.status.replace(/_ready$/, "")} — à valider`
              : r.status.replace("_running", " …");
            return `<div class="list-row" data-run="${esc(r.id)}" style="cursor:pointer">
              <span class="badge ${cls}" style="flex:none">${esc(label)}</span>
              <span class="grow"><b>${esc(r.title)}</b>
                <div class="small muted">${ago(r.createdAt)} · ${r.shots || 0} visuels${r.durationSec ? " · " + (r.durationSec / 60).toFixed(1) + " min" : ""} · ${c.toFixed(2)} $ · ${esc(r.mode)}</div></span>
              ${r.published ? `<span class="badge ok" style="flex:none">📤 publiée</span>` : ""}
              ${!["done", "failed"].includes(r.status) ? `<button class="btn btn-sm" data-zap="${esc(r.id)}" title="⚡ Décharge : relance le run">⚡</button>` : ""}
            </div>`;
          }).join("")}</div>`;
      body.querySelectorAll("[data-run]").forEach((row) =>
        row.addEventListener("click", (e) => { if (!e.target.closest("[data-zap]")) openWizard(row.dataset.run); }));
      body.querySelectorAll("[data-zap]").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.stopPropagation(); b.disabled = true;
          try { await api(`/api/machines/bouddhisme/runs/${b.dataset.zap}/resume`, { method: "POST", body: {} }); AgentOS.toast("⚡ Décharge envoyée", "ok"); renderRuns(); }
          catch (err) { AgentOS.toast(err.message, "err"); b.disabled = false; }
        }));
    }

    async function renderStock() {
      const body = el.querySelector("#boud-body");
      const all = await api("/api/machines/bouddhisme/stock");
      let arch = false;
      const draw = () => {
        const list = all.filter((v) => !!v.archived === arch);
        body.innerHTML = `
          <div class="row mb" style="gap:8px">
            <span class="mini-seg" id="st-seg">
              <button data-v="0" class="${arch ? "" : "active"}">📦 En stock (${all.filter((v) => !v.archived).length})</button>
              <button data-v="1" class="${arch ? "active" : ""}">🗄 Archives (${all.filter((v) => v.archived).length})</button>
            </span>
          </div>
          ${!list.length ? `<div class="empty">Rien ici.</div>` : `<div class="grid grid-3" style="gap:10px">${list.map((v) => `
            <div class="thumb-card">
              ${v.thumbRel ? `<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:100%;height:112px;object-fit:cover;border-radius:6px">` : ""}
              <b class="small" style="display:block;margin-top:5px;line-height:1.35">${esc(v.title)}</b>
              <div class="small muted">${ago(v.createdAt)} · ${v.shots} visuels${v.durationSec ? " · " + (v.durationSec / 60).toFixed(1) + " min" : ""}</div>
              <div class="row" style="gap:5px;margin-top:6px">
                <button class="btn btn-sm" data-open="${esc(v.id)}">Ouvrir</button>
                <button class="btn btn-sm btn-ghost" data-posted="${esc(v.id)}" title="Marquer comme publiée">${v.posted ? "✓ publiée" : "Marquer publiée"}</button>
                <button class="btn btn-sm btn-ghost" data-arch="${esc(v.id)}">${v.archived ? "↩" : "🗄"}</button>
              </div>
            </div>`).join("")}</div>`}`;
        body.querySelectorAll("#st-seg button").forEach((b) => b.addEventListener("click", () => { arch = b.dataset.v === "1"; draw(); }));
        body.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openWizard(b.dataset.open)));
        const patch = async (id, patchObj) => {
          try {
            const e = await api(`/api/machines/bouddhisme/stock/${id}`, { method: "PATCH", body: patchObj });
            Object.assign(all.find((x) => x.id === id), e);
            draw();
          } catch (err) { AgentOS.toast(err.message, "err"); }
        };
        body.querySelectorAll("[data-arch]").forEach((b) => b.addEventListener("click", () =>
          patch(b.dataset.arch, { archived: !all.find((x) => x.id === b.dataset.arch).archived })));
        body.querySelectorAll("[data-posted]").forEach((b) => b.addEventListener("click", () =>
          patch(b.dataset.posted, { posted: !all.find((x) => x.id === b.dataset.posted).posted })));
      };
      draw();
    }

    async function renderSettings() {
      const body = el.querySelector("#boud-body");
      const s = cfg.settings;
      let niches = [];
      try { niches = await api("/api/bank/niches"); } catch {}
      body.innerHTML = `
        <div class="grid grid-3 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Modèle d'images</span>
            <select id="s-img">
              <option value="nano"${s.imageModel === "nano" ? " selected" : ""}>Nano Banana 2 Lite — 0,02 $</option>
              <option value="seedream"${s.imageModel === "seedream" ? " selected" : ""}>Seedream 5 Lite — 0,014 $</option>
              <option value="gpt"${s.imageModel === "gpt" ? " selected" : ""}>GPT Image 2 — 0,06 $ (plus défini)</option>
            </select></label>
          <label class="field" style="margin:0"><span>Mots par image <span class="muted">(niche : 29 à 44)</span></span>
            <input type="number" id="s-wpi" min="12" max="60" value="${s.wordsPerImage}"></label>
          <label class="field" style="margin:0"><span>Fondu enchaîné (s)</span>
            <input type="number" id="s-xf" min="0.3" max="2.5" step="0.1" value="${s.xfade}"></label>
        </div>
        <div class="grid grid-3 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Taille des sous-titres <span class="muted">(46 car./ligne max)</span></span>
            <input type="number" id="s-subsize" min="12" max="40" value="${s.subtitleSize}"></label>
          <label class="field" style="margin:0"><span>Niveau musique (LUFS) <span class="muted">(-34 ≈ 19 dB sous la voix · plus haut = plus fort)</span></span>
            <input type="number" id="s-mlufs" min="-45" max="-18" step="1" value="${s.musicLufs}"></label>
          <label class="field" style="margin:0"><span>Style musical par défaut</span>
            <select id="s-mstyle">${(cfg.musicStyles || []).map((x) => `<option${x === s.musicStyle ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
        </div>
        <div class="grid grid-3 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Premier CTA (s)</span>
            <input type="number" id="s-ctafirst" min="5" max="120" value="${s.ctaFirstSec}"></label>
          <label class="field" style="margin:0"><span>CTA toutes les (min)</span>
            <input type="number" id="s-ctaevery" min="1" max="10" step="0.5" value="${s.ctaEveryMin}"></label>
          <label class="field" style="margin:0"><span>Nom de chaîne (CTA)</span>
            <input id="s-chan" value="${esc(s.channelName)}"></label>
        </div>
        <div class="grid grid-3 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Langue du packaging</span>
            <select id="s-clang">${LANGS.map((l) => `<option${l === s.chainLanguage ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Confidentialité à la publication</span>
            <select id="s-priv">
              <option value="private"${s.publishPrivacy === "private" ? " selected" : ""}>🔒 Privée</option>
              <option value="unlisted"${s.publishPrivacy === "unlisted" ? " selected" : ""}>🔗 Non répertoriée</option>
              <option value="public"${s.publishPrivacy === "public" ? " selected" : ""}>🌍 Publique</option>
            </select></label>
          <label class="field" style="margin:0"><span>Banque de niche liée</span>
            <select id="s-niche"><option value="">— aucune —</option>${niches.map((n) => `<option value="${esc(n.id)}"${n.id === cfg.nicheId ? " selected" : ""}>${esc(n.name)}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>Direction artistique <span class="muted">(rappelée dans CHAQUE prompt d'image — mesurée sur les 5 concurrents)</span></span>
          <textarea id="s-da" rows="4">${esc(s.artDirection)}</textarea></label>
        <label class="field"><span>Texte de fin <span class="muted">(dit par la même voix, sous-titré, à la fin de CHAQUE vidéo — une ligne vide entre les paragraphes)</span></span>
          <textarea id="s-outro" rows="9">${esc(s.outro || "")}</textarea></label>
        <div class="fbar mb" style="padding:10px 12px">
          <span class="fbar-item"><span>Reformuler l'outro à chaque vidéo</span>
            <span class="mini-seg" id="s-ovary">
              <button data-v="0" class="${s.outroVary ? "" : "active"}">Non — texte identique</button>
              <button data-v="1" class="${s.outroVary ? "active" : ""}">Oui — variantes</button>
            </span></span>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-accent" id="s-save">Enregistrer</button></div>`;

      body.querySelectorAll("#s-ovary button").forEach((b) =>
        b.addEventListener("click", () => body.querySelectorAll("#s-ovary button").forEach((x) => x.classList.toggle("active", x === b))));

      body.querySelector("#s-save").addEventListener("click", async () => {
        const b = body.querySelector("#s-save");
        b.disabled = true; b.textContent = "⏳";
        try {
          cfg = await api("/api/machines/bouddhisme", { method: "PATCH", body: {
            nicheId: body.querySelector("#s-niche").value || null,
            settings: {
              imageModel: body.querySelector("#s-img").value,
              wordsPerImage: Number(body.querySelector("#s-wpi").value),
              xfade: Number(body.querySelector("#s-xf").value),
              subtitleSize: Number(body.querySelector("#s-subsize").value),
              musicLufs: Number(body.querySelector("#s-mlufs").value),
              musicStyle: body.querySelector("#s-mstyle").value,
              ctaFirstSec: Number(body.querySelector("#s-ctafirst").value),
              ctaEveryMin: Number(body.querySelector("#s-ctaevery").value),
              channelName: body.querySelector("#s-chan").value,
              chainLanguage: body.querySelector("#s-clang").value,
              publishPrivacy: body.querySelector("#s-priv").value,
              artDirection: body.querySelector("#s-da").value,
              outro: body.querySelector("#s-outro").value,
              outroVary: body.querySelector("#s-ovary button.active").dataset.v === "1",
            },
          }});
          AgentOS.toast("Réglages enregistrés", "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
        b.disabled = false; b.textContent = "Enregistrer";
      });
    }

    shell();
  },
});
