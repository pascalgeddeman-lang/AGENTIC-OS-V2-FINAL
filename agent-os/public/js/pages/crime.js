/**
 * MACHINE CRIME — true crime francophone. Onglets : Générer / Runs / Stock / Paramètres.
 * L'intro avatar est plafonnée par le plan HeyGen (3 vidéos/mois, 60 s) : le quota est affiché
 * en permanence, et la machine bascule seule sur une intro illustrée quand il est épuisé.
 */
AgentOS.register("crime", {
  title: "Crime",
  async render(el) {
    const { api, esc } = AgentOS;
    let cfg, quota = null, avatars = [], tab = "gen", timer = null;

    const STEPS = [["script","✍","Script"],["voice","🎙","Voix"],["intro","🎬","Intro"],
                   ["shots","🗂","Plans"],["images","🖼","Images"],["montage","🎚","Montage"],["packaging","📦","Packaging"]];
    const idx = (st) => Math.max(0, STEPS.findIndex(([k]) => String(st).startsWith(k)));
    const pct = (st) => (st === "done" ? 100 : Math.round((idx(st) / STEPS.length) * 100));

    async function load() {
      cfg = await api("/api/machines/crime");
      quota = await api("/api/heygen/quota").catch(() => null);
      if (!avatars.length) avatars = await api("/api/heygen/avatars").catch(() => []);
    }

    function viewGen() {
      const s = cfg.settings;
      const looks = avatars.flatMap((g) => (g.looks || []).map((l) => ({ ...l, groupe: g.name })));
      const q = quota;
      return `<div class="card">
        <h2>🔎 Nouveau documentaire</h2>
        <label class="field mb"><span>Affaire <span class="muted">(vide + 💡 : la machine propose d'après la banque)</span></span>
          <div class="row" style="gap:8px">
            <input id="g-subject" placeholder="Ex. la disparition de Sarah Everard à Londres" style="flex:1">
            <button class="btn btn-sm" id="g-idea">💡</button>
          </div></label>

        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Durée</span>
            <select id="g-dur">${[12,15,18,20,25,30].map((d)=>`<option value="${d}"${d===18?" selected":""}>${d} minutes</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Voix <span class="muted">— unique</span></span>
            <select id="g-voice">${(cfg.voices||[]).map((v)=>`<option value="${v.id}"${v.id===s.voiceId?" selected":""}>${esc(v.name)} — ${v.wpm} mpm</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Intro avatar</span>
            <select id="g-intro">
              <option value="auto"${s.intro==="auto"?" selected":""}>Auto — bascule si quota épuisé</option>
              <option value="toujours"${s.intro==="toujours"?" selected":""}>Toujours</option>
              <option value="jamais"${s.intro==="jamais"?" selected":""}>Jamais</option>
            </select></label>
          <label class="field" style="margin:0"><span>Look de l'avatar</span>
            <select id="g-look"><option value="">— aucun —</option>
              ${looks.map((l)=>`<option value="${esc(l.id)}"${l.id===s.avatarLookId?" selected":""}>${esc(l.name||l.id.slice(0,8))}</option>`).join("")}</select></label>
        </div>

        <div class="row mb" style="gap:14px;align-items:center;flex-wrap:wrap">
          <span class="badge ${q&&q.remaining>0?"ok":"err"}" title="Plan HeyGen : ${q?q.perMonth:3} vidéos/mois, ${q?q.maxSeconds:60} s max">
            🎬 Intros avatar restantes ce mois : ${q?q.remaining:"?"} / ${q?q.perMonth:3}</span>
          <label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="g-inter" checked>
            <span class="small">Privilégier une affaire <b>internationale</b></span></label>
          <label class="field" style="margin:0"><span>Sous-titres</span>
            <select id="g-subs">
              <option value="srt"${s.subtitles!=="burn"&&s.subtitles!=="none"?" selected":""}>Fichier .srt — envoyé à YouTube (recommandé)</option>
              <option value="burn"${s.subtitles==="burn"?" selected":""}>Gravés dans l'image</option>
              <option value="none"${s.subtitles==="none"?" selected":""}>Aucun</option>
            </select></label>
          <label class="field" style="margin:0"><span>Mouvement des images</span>
            <select id="g-ken">
              <option value="centre"${s.kenStyle!=="gauche"?" selected":""}>Zoom avant / arrière — centré</option>
              <option value="gauche"${s.kenStyle==="gauche"?" selected":""}>Zoom avant / arrière — dérive vers la gauche</option>
            </select></label>
          <label class="field" style="margin:0"><span>Mode</span>
            <select id="g-mode"><option value="semi" selected>Semi-manuel</option><option value="auto">Automatique</option></select></label>
        </div>

        <div class="row between" style="align-items:center">
          <div class="small muted" id="g-detail"></div>
          <div class="row" style="gap:12px;align-items:center">
            <div id="g-cost" style="border:2px solid #4ade80;border-radius:10px;padding:8px 16px;font-size:20px;font-weight:800;color:#4ade80"></div>
            <button class="btn btn-accent" id="g-go">Générer</button>
          </div>
        </div>
        <div class="small muted" style="text-align:right;margin-top:6px">Script → Voix → Intro → Plans → Images → Montage → Packaging</div>
      </div>

      <div class="card">
        <div class="small muted">
          <b>Ce que la machine applique, mesuré sur la niche :</b><br>
          • le titre est une <b>amorce</b>, jamais le nom de l'affaire — c'est le facteur le plus discriminant ;<br>
          • <b>aucun visage réel</b> n'est généré : lieux, objets, silhouettes, documents ;<br>
          • la miniature est un <b>portrait illustré anonyme</b> + médaillon cerclé de rouge ;<br>
          • une <b>seule voix</b> du début à la fin, l'avatar ne fait que mimer les 60 premières secondes.
        </div>
      </div>`;
    }

    async function viewRuns() {
      const runs = await api("/api/machines/crime/runs");
      const c = (r) => Object.values(r.cost || {}).reduce((a, b) => a + b, 0);
      return `<div class="card"><h2>🎬 Runs</h2>
        ${runs.length ? `<div class="list">${runs.map((r)=>`
          <div class="list-row" data-open="${esc(r.id)}" style="cursor:pointer">
            <span class="badge ${r.status==="done"?"ok":/failed/.test(r.status)?"err":"warn"}" style="flex:none">
              ${esc(String(r.status).replace("_running"," …").replace("_ready"," ✓"))}</span>
            <span class="grow" style="min-width:0">
              <b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</b>
              <div class="small muted">${r.params?.durationMin} min · ${r.shots||0} plans · intro ${esc(r.introMode||r.params?.intro||"?")} · ${c(r).toFixed(2)} $ · ${esc(r.mode||"")}</div>
              <div style="height:4px;background:#222;border-radius:3px;margin-top:5px">
                <div style="height:100%;width:${pct(r.status)}%;background:#4ade80;border-radius:3px"></div></div>
            </span>
            ${r.published?`<span class="badge ok" style="flex:none">📤 publiée</span>`:""}
            ${/_ready$/.test(r.status)?`<button class="btn btn-sm btn-accent" data-adv="${esc(r.id)}" style="flex:none">▶</button>`:""}
            ${!["done"].includes(r.status)?`<button class="btn btn-sm" data-resume="${esc(r.id)}" title="⚡ Décharge : relance le run" style="flex:none">⚡</button>`:""}
          </div>`).join("")}</div>` : `<div class="empty">Aucun run. Lance ta première vidéo dans ✨ Générer.</div>`}</div>`;
    }

    async function viewStock() {
      const [st, chans] = await Promise.all([api("/api/machines/crime/stock"), api("/api/channels").catch(()=>[])]);
      const act = st.filter((v)=>!v.archived);
      return `<div class="card"><h2>📦 Stock</h2>
        ${act.length ? `<div class="grid grid-3">${act.map((v)=>`<div class="bank-folder">
          ${v.thumbRel?`<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px">`:""}
          <b class="small" style="display:block;margin-top:6px">${esc(v.title)}</b>
          <div class="small muted">${Math.round((v.durationSec||0)/60)} min · ${esc(v.affaire||"")}${v.posted?" · ✅ publiée":""}</div>
          <div class="row" style="gap:6px;margin-top:6px">
            ${v.videoRel?`<a class="mini-btn" href="/media/${encodeURIComponent(v.videoRel)}" target="_blank" title="Lire la vidéo dans un nouvel onglet">▶</a>`:""}
            <select class="s-chan mini-btn" data-id="${v.id}" style="flex:1" title="Chaîne YouTube de destination"><option value="">Chaîne…</option>
              ${chans.map((c)=>`<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("")}</select>
            <button class="mini-btn s-pub" data-id="${v.id}" data-run="${v.runId}" title="Publier sur la chaîne sélectionnée — en PRIVÉ">📤</button>
            <button class="mini-btn s-arch" data-id="${v.id}" title="Archiver : retire la fiche du stock actif (les fichiers sont conservés)">🗄</button>
          </div></div>`).join("")}</div>` : `<div class="empty">Stock vide.</div>`}</div>`;
    }

    async function draw() {
      const tabs = [["gen","✨ Générer"],["runs","🎬 Runs"],["stock","📦 Stock"]];
      const body = tab === "gen" ? viewGen() : await (tab === "runs" ? viewRuns() : viewStock());
      el.innerHTML = `<div class="row mb" style="gap:8px">
        <a href="#/machines" class="back-btn" title="Retour aux Machines">←</a>
        ${tabs.map(([k,l])=>`<button class="btn btn-sm ${k===tab?"btn-accent":""}" data-tab="${k}">${l}</button>`).join("")}</div>${body}`;
      el.querySelectorAll("[data-tab]").forEach((b)=>b.addEventListener("click",()=>{tab=b.dataset.tab;draw();}));
      if (tab === "gen") wireGen(); else if (tab === "runs") wireRuns(); else wireStock();
    }

    function params() {
      const $ = (s)=>el.querySelector(s);
      return { subject:$("#g-subject").value.trim(), durationMin:Number($("#g-dur").value),
        voiceId:$("#g-voice").value||null, intro:$("#g-intro").value, avatarLookId:$("#g-look").value||null,
        international:$("#g-inter").checked, subtitles:$("#g-subs").value, mode:$("#g-mode").value,
        kenStyle:$("#g-ken").value,
        nicheId:cfg.nicheId };
    }
    function wireGen() {
      const $ = (s)=>el.querySelector(s);
      const refresh = async () => {
        try {
          const e = await api("/api/machines/crime/estimate",{method:"POST",body:params()});
          $("#g-cost").textContent = `≈ ${e.total.toFixed(2)} $`;
          $("#g-detail").textContent = `~${e.mots} mots · ~${e.shots} illustrations · images ${e.images.toFixed(2)}$ · voix ${e.voice.toFixed(2)}$`;
        } catch {}
      };
      ["#g-dur","#g-intro","#g-subs","#g-voice"].forEach((s)=>$(s).addEventListener("change",refresh));
      refresh();
      // Le choix de voix / look / intro est un réglage de CHAÎNE : on le mémorise explicitement.
      const save = async (patch, msg) => {
        try { await api("/api/machines/crime",{method:"PATCH",body:{settings:patch}});
              Object.assign(cfg.settings,patch); AgentOS.toast(msg,"ok"); } catch(e){ AgentOS.toast(e.message,"err"); }
      };
      $("#g-voice").addEventListener("change",()=>save({voiceId:$("#g-voice").value},"Voix mémorisée"));
      $("#g-look").addEventListener("change",()=>save({avatarLookId:$("#g-look").value||null},"Avatar mémorisé"));
      $("#g-intro").addEventListener("change",()=>save({intro:$("#g-intro").value},"Mode d'intro mémorisé"));
      $("#g-subs").addEventListener("change",()=>save({subtitles:$("#g-subs").value},"Mode de sous-titres mémorisé"));
      $("#g-ken").addEventListener("change",()=>save({kenStyle:$("#g-ken").value},"Mouvement des images mémorisé"));
      $("#g-idea").addEventListener("click", async ()=>{
        $("#g-idea").textContent="…";
        try { const i=await api("/api/machines/crime/idea",{method:"POST",body:{nicheId:cfg.nicheId}}); $("#g-subject").value=i.subject||""; }
        catch(e){ AgentOS.toast(e.message,"err"); }
        $("#g-idea").textContent="💡";
      });
      $("#g-go").addEventListener("click", async ()=>{
        if(!$("#g-voice").value) return AgentOS.toast("Choisis une voix","err");
        $("#g-go").disabled=true;
        try { await api("/api/machines/crime/runs",{method:"POST",body:params()}); tab="runs"; draw(); AgentOS.toast("Run lancé 🔎","ok"); }
        catch(e){ AgentOS.toast(e.message,"err"); $("#g-go").disabled=false; }
      });
    }
    function wireRuns() {
      el.querySelectorAll("[data-resume]").forEach((b)=>b.addEventListener("click",(e)=>{
        e.stopPropagation();
        api(`/api/machines/crime/runs/${b.dataset.resume}/resume`,{method:"POST"})
          .then(()=>{AgentOS.toast("⚡ Décharge envoyée","ok");draw();}).catch((x)=>AgentOS.toast(x.message,"err"));
      }));
      el.querySelectorAll("[data-adv]").forEach((b)=>b.addEventListener("click",(e)=>{
        e.stopPropagation();
        api(`/api/machines/crime/runs/${b.dataset.adv}/advance`,{method:"POST"}).then(draw).catch((x)=>AgentOS.toast(x.message,"err"));
      }));
      el.querySelectorAll("[data-open]").forEach((row)=>row.addEventListener("click",(e)=>{
        if (!e.target.closest("[data-adv],[data-resume]")) openRun(row.dataset.open);
      }));
      clearInterval(timer); timer=setInterval(()=>{ if(tab==="runs") draw(); },8000);
    }
    function wireStock() {
      el.querySelectorAll(".s-arch").forEach((b)=>b.addEventListener("click",()=>
        api(`/api/machines/crime/stock/${b.dataset.id}`,{method:"PATCH",body:{archived:true}}).then(draw)));
      el.querySelectorAll(".s-pub").forEach((b)=>b.addEventListener("click", async ()=>{
        const sel=el.querySelector(`.s-chan[data-id="${b.dataset.id}"]`);
        if(!sel.value) return AgentOS.toast("Choisis une chaîne","err");
        b.textContent="…";
        try{ const r=await api(`/api/machines/crime/runs/${b.dataset.run}/publish`,{method:"POST",body:{channelId:sel.value,privacy:"private"}});
             AgentOS.toast("Publiée (privée) — "+r.url,"ok"); draw(); }
        catch(e){ AgentOS.toast(e.message,"err"); b.textContent="📤"; }
      }));
    }

    /**
     * FENÊTRE DE RUN — un rail d'étapes cliquable ; chaque étape montre SON visuel
     * (le script, la voix jouable, l'intro avatar, la planche des plans, la vidéo, le
     * packaging). Se rafraîchit toute seule tant que le run travaille, et s'arrête dès
     * qu'il est fini : aucun appel inutile.
     * ⚠ On ne re-crée le panneau que si sa signature change — sinon une vidéo ou un audio
     *   en cours de lecture serait relancé à chaque rafraîchissement.
     */
    async function openRun(id) {
      const o = document.createElement("div"); o.className = "picker-overlay";
      let view = null, poll = null, chans = null;
      document.body.appendChild(o);
      const stop = () => { clearInterval(poll); poll = null; };
      o.addEventListener("click", (e) => { if (e.target === o) { stop(); o.remove(); } });

      const media = (rel, ts) => `/media/${encodeURIComponent(rel)}${ts ? `?v=${ts}` : ""}`;
      const dur = (sec) => !sec ? "—" : sec < 90 ? `${sec.toFixed(1)} s` : `${(sec / 60).toFixed(1)} min`;

      function panel(r, k) {
        const shots = r.shots || [];
        const done = shots.filter((x) => x.image).length;
        const todo = shots.filter((x) => !x.covered).length;
        if (k === "script") {
          if (!r.script) return `<div class="empty">Le script n'est pas encore écrit.</div>`;
          const paras = r.script.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
          return `<div class="small muted mb">${esc(r.affaire || "")}${r.pays ? " · " + esc(r.pays) : ""} · ${r.words || 0} mots · ${paras.length} paragraphes</div>
            <div class="transcript-box" style="max-height:52vh">${paras.map((t, i) =>
              `<p style="margin:0 0 10px"><b class="small muted">${i === 0 ? "INTRO (dite par l'avatar)" : i === paras.length - 1 ? "OUTRO" : "§" + i}</b><br>${esc(t)}</p>`).join("")}</div>`;
        }
        if (k === "voice") {
          if (!r.voice) return `<div class="empty">La voix n'est pas encore générée.</div>`;
          return `<div class="small muted mb">Voix <b>${esc(r.voiceName || "?")}</b> · ${dur(r.voice.seconds)} · ${(r.voiceSegs || []).length} paragraphes</div>
            <audio src="${media(r.voice.rel)}" controls style="width:100%"></audio>`;
        }
        if (k === "intro") {
          if (r.introMode === "aucune") return `<div class="empty">Intro désactivée pour ce run.</div>`;
          if (r.introMode === "illustrée") return `<div class="empty">Intro illustrée (quota HeyGen épuisé) — pas de plan avatar.</div>`;
          if (!r.intro) return `<div class="empty">L'intro n'est pas encore générée.</div>`;
          return `<div class="small muted mb">Avatar HeyGen · ${dur(r.intro.seconds)} · couvre les ${shots.filter((x) => x.covered).length} premiers plans</div>
            <video src="${media(r.intro.rel)}" controls style="width:100%;max-height:52vh;border-radius:8px" preload="metadata"></video>`;
        }
        if (k === "shots" || k === "images") {
          if (!shots.length) return `<div class="empty">Le découpage n'est pas encore fait.</div>`;
          return `<div class="small muted mb">${shots.length} plans · ${todo} à illustrer · <b>${done}</b> image(s) prête(s)</div>
            <div class="grid grid-3" style="max-height:52vh;overflow:auto;gap:8px">${shots.map((sh) => `
              <div class="bank-folder" style="padding:6px">
                ${sh.image ? `<img src="${media(sh.image.rel, sh.image.ts)}" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:5px">`
                  : sh.covered ? `<div class="empty" style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;font-size:11px">couvert par l'intro</div>`
                  : `<div class="empty" style="aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;font-size:11px">⏳ en attente</div>`}
                <div class="small muted" style="margin-top:4px">#${sh.i + 1} · ${dur(sh.seconds)}</div>
                <div class="small" style="max-height:44px;overflow:hidden">${esc((sh.texte || "").slice(0, 90))}</div>
              </div>`).join("")}</div>`;
        }
        if (k === "montage") {
          if (!r.video) return `<div class="empty">Le montage n'est pas terminé.</div>`;
          return `<div class="small muted mb">${dur(r.video.seconds)} · ${todo} segments · sous-titres ${r.srt ? `<b>.srt (${r.srt.segments} segments)</b>` : "aucun"}${
            (r.music || []).length ? ` · musique <b>${esc(r.music.map((m) => m.name).join(" + "))}</b>` : " · sans musique"}</div>
            <video src="${media(r.video.rel, r.video.ts)}" controls style="width:100%;max-height:52vh;border-radius:8px" preload="metadata"></video>`;
        }
        // packaging
        if (!r.pack) return `<div class="empty">Le packaging n'est pas encore généré.</div>`;
        return `<div class="grid grid-2" style="gap:12px">
            <div>${r.thumb ? `<img src="${media(r.thumb.rel, r.thumbTs)}" style="width:100%;border-radius:8px">` : `<div class="empty">miniature en cours…</div>`}</div>
            <div><label class="field"><span>Titre (${(r.pack.title || "").length}/100)</span><input value="${esc(r.pack.title || "")}" readonly></label>
              <label class="field"><span>Tags</span><textarea rows="3" readonly>${esc((r.pack.tags || []).join(", "))}</textarea></label></div></div>
          <label class="field"><span>Description</span><textarea rows="6" readonly>${esc(r.pack.description || "")}</textarea></label>
          ${r.video ? (r.published
            ? `<div class="card" style="padding:10px"><div class="row" style="gap:10px;align-items:center">
                 <span class="badge ok">📤 publiée</span>
                 <a href="${esc(r.published.url)}" target="_blank" rel="noopener">${esc(r.published.url)}</a>
                 <span class="small muted">sous-titres : ${esc(r.published.captions || "non envoyés")}</span></div></div>`
            : `<div class="card" style="padding:10px">
                 <div class="row" style="gap:8px;align-items:end;flex-wrap:wrap">
                   <label class="field" style="margin:0;flex:1;min-width:180px"><span>Chaîne YouTube</span>
                     <select id="pub-chan"><option value="">— choisir —</option></select></label>
                   <label class="field" style="margin:0"><span>Confidentialité</span>
                     <select id="pub-priv"><option value="private" selected>Privée</option>
                       <option value="unlisted">Non répertoriée</option><option value="public">Publique</option></select></label>
                   <button class="btn btn-accent" id="pub-go">📤 Publier</button>
                   <a class="btn btn-sm" href="${media(r.video.rel)}" download>⬇ Télécharger</a></div>
                 <div class="small muted" style="margin-top:6px">Par défaut <b>privée</b>.${r.srt ? " Le fichier .srt sera envoyé automatiquement." : ""}</div>
               </div>`) : ""}`;
      }

      function wirePublish(r) {
        const sel = o.querySelector("#pub-chan"); if (!sel) return;
        const fill = (cs) => { sel.innerHTML = `<option value="">— choisir —</option>` +
          cs.map((c) => `<option value="${esc(c.channelId)}"${c.channelId === r.params?.publishChannelId ? " selected" : ""}>${esc(c.title)}</option>`).join(""); };
        if (chans) fill(chans); else api("/api/channels").then((cs) => { chans = cs; fill(cs); }).catch(() => {});
        o.querySelector("#pub-go").addEventListener("click", async (ev) => {
          if (!sel.value) return AgentOS.toast("Choisis une chaîne", "err");
          const b = ev.currentTarget; b.disabled = true; b.textContent = "Envoi…";
          try {
            const pub = await api(`/api/machines/crime/runs/${id}/publish`,
              { method: "POST", body: { channelId: sel.value, privacy: o.querySelector("#pub-priv").value } });
            AgentOS.toast("Publiée — " + pub.url, "ok"); await refresh(true);
          } catch (e) { AgentOS.toast(e.message, "err"); b.disabled = false; b.textContent = "📤 Publier"; }
        });
      }

      async function refresh(force) {
        if (!document.body.contains(o)) return stop();   // fenêtre fermée : on ne sonde plus
        let r; try { r = await api(`/api/machines/crime/runs/${id}`); } catch { return; }
        const running = /_running$/.test(String(r.status));
        if (view === null) view = STEPS[idx(r.status)][0];        // on ouvre sur l'étape en cours
        const cost = Object.values(r.cost || {}).reduce((a, b) => a + b, 0);
        const cur = idx(r.status);
        const shots = r.shots || [];
        // signature : tout ce qui change l'affichage. Sinon on ne retouche rien.
        const sig = [r.status, view, shots.length, shots.filter((x) => x.image).length,
                     r.video?.ts || 0, r.thumbTs || 0, r.published ? 1 : 0, cost.toFixed(2)].join("|");
        if (!force && o.dataset.sig === sig) return;
        o.dataset.sig = sig;

        o.innerHTML = `<div class="scrap-modal" style="width:min(1040px,95vw);max-height:90vh;display:flex;flex-direction:column">
          <div class="row between mb" style="align-items:flex-start">
            <div><h2 style="margin:0;font-size:16px">${esc(r.title || "Sans titre")}</h2>
              <div class="small muted">${esc(r.affaire || "")}${r.pays ? " · " + esc(r.pays) : ""} · ${shots.length} plans · ${cost.toFixed(2)} $ · voix ${esc(r.voiceName || "?")}</div></div>
            <button class="btn btn-sm btn-ghost" data-close>✕</button></div>

          <div class="row mb" style="gap:6px;flex-wrap:wrap">
            ${STEPS.map(([k, ic, lb], n) => {
              const st = r.status === "done" || n < cur ? "ok" : n === cur ? (running ? "accent" : "") : "";
              const act = view === k ? "border:2px solid var(--accent,#4ade80)" : "";
              return `<button class="badge ${st}" data-step="${k}" style="cursor:pointer;${act}">${ic} ${lb}${
                r.status === "done" || n < cur ? " ✓" : n === cur && running ? " …" : ""}</button>`;
            }).join("")}
          </div>

          ${running ? `<div class="small muted mb">⏳ ${esc((r.logs || []).slice(-1)[0]?.msg || "en cours…")}</div>` : ""}
          ${r.error ? `<div class="badge err mb">${esc(r.error)}</div>` : ""}

          <div style="flex:1;overflow:auto;min-height:0">${panel(r, view)}</div>

          <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Journal (${(r.logs || []).length})</summary>
            <div class="transcript-box" style="max-height:180px">${(r.logs || []).slice(-60).map((l) => esc(l.msg)).join("<br>")}</div></details>
        </div>`;

        o.querySelector("[data-close]").addEventListener("click", () => { stop(); o.remove(); });
        o.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { view = b.dataset.step; refresh(true); }));
        wirePublish(r);
        if (!running && poll) stop();                              // fini : plus aucun appel
      }

      await refresh(true);
      poll = setInterval(() => refresh(false), 5000);
    }

    await load(); await draw();
  },
});
