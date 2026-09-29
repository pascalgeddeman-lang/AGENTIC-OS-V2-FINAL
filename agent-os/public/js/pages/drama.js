/**
 * MACHINE DRAMA — mélodrame de revanche africain.
 * Onglets : Nouvelle vidéo · Troupe · Runs · Stock.
 * Le rail d'étapes et le suivi suivent le modèle des autres machines.
 */
AgentOS.register("drama", {
  title: "Drama",
  async render(el) {
    const { api, esc, fmt } = AgentOS;
    let cfg, tab = "new", timer = null, castMode = "gen";

    const STEPS = [
      { k: "script", i: "✍", l: "Script" }, { k: "cast", i: "🎭", l: "Casting" },
      { k: "prompts", i: "🎬", l: "Prompts" }, { k: "images", i: "🖼", l: "Images" },
      { k: "voices", i: "🎙", l: "Voix" }, { k: "clips", i: "🎞", l: "Clips" },
      { k: "montage", i: "🎚", l: "Montage" }, { k: "packaging", i: "📦", l: "Packaging" },
    ];
    const stepIdx = (st) => Math.max(0, STEPS.findIndex((s) => String(st).startsWith(s.k)));
    const pct = (st) => (st === "done" ? 100 : Math.round((stepIdx(st) / STEPS.length) * 100));

    const load = async () => { cfg = await api("/api/machines/drama"); };

    // ---------------- estimation de coût (le chiffre qui décide) ----------------
    function estimate(p) {
      const shots = Math.round((p.durationMin * 60) / 6.2);
      const anim = Math.round(shots * (cfg.rythmes[p.rythme]?.ratio ?? 0.35));
      const img = shots * 0.03;
      const vid = anim * 6 * 0.015;
      const lip = p.lipsync ? (anim * 0.45) * 6 / 60 * 0.4 : 0;
      const voix = (shots * 70 / 1000) * 0.10;
      return { shots, anim, total: img + vid + lip + voix + 0.03 };
    }

    // ---------------- onglet : nouvelle vidéo ----------------
    function viewNew() {
      const s = cfg.settings;
      const persos = (cfg.cast || []).filter((c) => c.kind === "personnage");
      const opt = (o, v) => o.map((x) => `<option value="${esc(x.v)}"${x.v === v ? " selected" : ""}>${esc(x.l)}</option>`).join("");
      return `<div class="card">
        <h2>🎭 Nouvelle histoire</h2>

        <label class="field mb"><span>Sujet <span class="muted">(vide + 💡 : la machine choisit d'après la banque)</span></span>
          <div class="row" style="gap:8px">
            <input id="g-subject" placeholder="Ex. Sa belle-mère l'a chassée… dix ans plus tard elle revient" style="flex:1">
            <button class="btn btn-sm" id="g-idea" title="Proposer un sujet">💡</button>
          </div></label>

        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Durée</span>
            <select id="g-dur">${[8,10,12,15,18,20].map((d)=>`<option value="${d}"${d===12?" selected":""}>${d} minutes</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Langue</span>
            <select id="g-lang">${cfg.langs.map((l)=>`<option${l==="Français"?" selected":""}>${esc(l)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Style visuel</span>
            <select id="g-style">${Object.entries(cfg.styles).map(([k,v])=>`<option value="${k}"${k===s.style?" selected":""}>${esc(v.label)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Rythme visuel</span>
            <select id="g-rythme">${Object.entries(cfg.rythmes).map(([k,v])=>`<option value="${k}"${k===s.rythme?" selected":""}>${esc(v.label)}</option>`).join("")}</select></label>
        </div>
        <div class="small muted mb" id="g-rythme-desc"></div>

        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Voix du conteur <span class="muted" id="g-nar-state"></span></span>
            <div class="row" style="gap:6px">
              <select id="g-narrator" style="flex:1">
                <option value="">— à choisir —</option>
                ${opt((cfg.voices||[]).map((v)=>({v:v.id,l:`${v.name} — ${v.wpm} mpm`})), s.narratorVoiceId)}
              </select>
              <button class="btn btn-sm" id="g-nar-def" style="flex:none"
                title="Mémoriser cette voix comme défaut de la machine">★</button>
            </div></label>
          <label class="field" style="margin:0"><span>Musique d'intro</span>
            <select id="g-music">
              <option value="">🎲 Au hasard (usage « intro »)</option>
              ${(cfg.music||[]).filter((m)=>m.usage==="intro").map((m)=>`<option value="${m.id}">${esc(m.name)}</option>`).join("")}
              <option value="none">Aucune</option>
            </select></label>
          <label class="field" style="margin:0"><span>Sous-titres</span>
            <select id="g-subs"><option value="0">Non</option><option value="1">Oui (gravés)</option></select></label>
          <label class="field" style="margin:0"><span>Synchronisation labiale</span>
            <select id="g-lip"><option value="1"${s.lipsync!==false?" selected":""}>Oui</option><option value="0">Non</option></select></label>
        </div>

        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Appel à l'action</span>
            <select id="g-cta"><option value="1" selected>Oui — like + abonnement</option><option value="0">Non</option></select></label>
          <label class="field" style="margin:0"><span>Premier CTA</span>
            <input id="g-cta1" type="number" value="${s.ctaFirst}" min="5" max="120"> </label>
          <label class="field" style="margin:0"><span>Puis toutes les</span>
            <input id="g-ctaN" type="number" value="${s.ctaEvery}" min="30" max="600"></label>
          <label class="field" style="margin:0"><span>Mode</span>
            <select id="g-mode"><option value="semi" selected>Semi-manuel (validation à chaque étape)</option><option value="auto">Automatique</option></select></label>
        </div>

        <div class="row between" style="align-items:center;margin-top:6px">
          <div class="small muted">Troupe : <b>${persos.length}</b> personnage(s) · Voix : <b>${(cfg.voices||[]).length}</b> · Musiques intro : <b>${(cfg.music||[]).filter((m)=>m.usage==="intro").length}</b>
            ${persos.length===0?`<span class="badge err" style="margin-left:8px">Ajoute au moins un personnage (onglet Troupe)</span>`:""}
            ${(cfg.voices||[]).length===0?`<span class="badge err" style="margin-left:8px">Aucune voix — page 🎙 Voix</span>`:""}</div>
          <div class="row" style="gap:12px;align-items:center">
            <div id="g-cost" style="border:2px solid #4ade80;border-radius:10px;padding:8px 16px;font-size:20px;font-weight:800;color:#4ade80"></div>
            <button class="btn btn-accent" id="g-go">Générer</button>
          </div>
        </div>
        <div class="small muted" style="text-align:right;margin-top:6px">Script → Casting → Prompts → Images → Voix → Clips → Montage → Packaging</div>
      </div>`;
    }

    // ---------------- onglet : troupe ----------------
    function viewCast() {
      const e = cfg.cast || [];
      return `<div class="card">
        <h2>🎭 Troupe <span class="small muted">— personnages, lieux et véhicules récurrents</span></h2>
        <div class="small muted mb">Chaque personnage porte <b>une voix</b> : la même d'un épisode à l'autre, c'est ce qui fait revenir un spectateur.<br>
          <b>📌 épinglé</b> = personnage <b>fixe de la chaîne</b> : l'histoire est écrite autour de lui dans <i>toutes</i> les vidéos, il n'est jamais réinventé.</div>
        <div class="row mb" style="gap:8px">
          <button class="btn btn-sm ${castMode==="gen"?"btn-accent":""}" data-cmode="gen">✨ Générer une fiche</button>
          <button class="btn btn-sm ${castMode==="imp"?"btn-accent":""}" data-cmode="imp">⬆ Importer une image</button>
        </div>

        ${castMode==="gen" ? `
        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0;grid-column:span 2"><span>Décris une nouvelle entrée en français</span>
            <input id="c-desc" placeholder="Ex. une belle-mère élégante et méprisante, la cinquantaine"></label>
          <label class="field" style="margin:0"><span>Style</span>
            <select id="c-style">${Object.entries(cfg.styles).map(([k,v])=>`<option value="${k}"${k===cfg.settings.style?" selected":""}>${esc(v.label)}</option>`).join("")}</select></label>
          <button class="btn btn-accent" id="c-add">✨ Créer la fiche</button>
        </div>` : `
        <div class="small muted mb">Réutilise une image déjà faite — elle est déjà payée et déjà validée à l'œil.
          <b>Elle sera ramenée en 16:9</b> si besoin (le modèle vidéo reproduit le format de sa référence).</div>
        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Nom</span><input id="i-name" placeholder="Ex. Aminata"></label>
          <label class="field" style="margin:0"><span>Nature</span>
            <select id="i-kind"><option value="personnage">Personnage</option><option value="lieu">Lieu</option><option value="vehicule">Véhicule</option></select></label>
          <label class="field" style="margin:0"><span>Rôle dans l'histoire</span>
            <input id="i-role" placeholder="Ex. protagoniste, l'humiliée"></label>
          <label class="field" style="margin:0"><span>Image</span><input id="i-file" type="file" accept="image/png,image/jpeg"></label>
        </div>
        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Caractère <span class="muted">(sert au casting auto)</span></span>
            <input id="i-traits" placeholder="Ex. digne, silencieuse, tenace"></label>
          <label class="field" style="margin:0"><span>Description physique <span class="muted">(EN, facultatif)</span></span>
            <input id="i-desc" placeholder="Young West African woman, short afro, red headband"></label>
          <label class="field" style="margin:0"><span>Voix</span>
            <select id="i-voice"><option value="">—</option>${(cfg.voices||[]).map((v)=>`<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select></label>
          <button class="btn btn-accent" id="i-add">⬆ Importer</button>
        </div>`}
        <span id="c-msg" class="small muted"></span>
        <div class="grid grid-4" style="margin-top:12px">
          ${e.length ? e.map((x)=>`<div class="bank-folder" style="border-left:3px solid ${x.pinned?"#4ade80":x.kind==="personnage"?"#2f6f45":x.kind==="lieu"?"#4B9FFF":"#B266FF"};${x.pinned?"box-shadow:inset 0 0 0 1px rgba(74,222,128,.35)":""}">
            <img src="/api/machines/drama/cast/${x.id}/sheet?v=${x.uses||0}" style="width:100%;aspect-ratio:16/9;object-fit:contain;background:#111;border-radius:6px">
            <div style="margin-top:6px"><b class="small">${x.pinned?"📌 ":""}${esc(x.name)}</b> <span class="badge">${esc(x.kind)}</span>
              ${x.pinned?`<span class="badge ok" title="Présent dans TOUTES les vidéos">fixe</span>`:""}
              ${x.imported?`<span class="badge accent" title="Image importée${x.padded?" et ramenée en 16:9":""}">⬆ importée</span>`:""}</div>
            <label class="field" style="margin:6px 0 0"><span class="small">Rôle dans l'histoire</span>
              <input class="c-role" data-id="${x.id}" value="${esc(x.role||"")}" placeholder="ex. antagoniste"></label>
            <label class="field" style="margin:4px 0 0"><span class="small">Caractère</span>
              <input class="c-traits" data-id="${x.id}" value="${esc(x.traits||"")}" placeholder="ex. dure, calculatrice"></label>
            ${x.kind==="personnage"?`<label class="field" style="margin:6px 0 0"><span class="small">Voix</span>
              <select class="c-voice" data-id="${x.id}">
                <option value="">—</option>
                ${(cfg.voices||[]).map((v)=>`<option value="${v.id}"${x.voiceId===v.id?" selected":""}>${esc(v.name)}</option>`).join("")}
              </select></label>`:""}
              <div class="row" style="gap:6px;margin-top:6px">
              <button class="mini-btn c-pin" data-id="${x.id}" data-on="${x.pinned?1:0}"
                title="${x.pinned?"Retirer des personnages fixes":"Rendre ce personnage FIXE : présent dans toutes les vidéos"}"
                style="${x.pinned?"color:#4ade80":""}">📌</button>
              <button class="mini-btn c-regen" data-id="${x.id}" title="Redessiner sans changer l'identité">↻</button>
              <button class="mini-btn c-del" data-id="${x.id}">✕</button>
              <span class="small muted" style="margin-left:auto">${x.uses||0}×</span>
            </div>
          </div>`).join("") : `<div class="muted">Troupe vide.</div>`}
        </div>
      </div>`;
    }

    // ---------------- onglets runs / stock ----------------
    async function viewRuns() {
      const runs = await api("/api/machines/drama/runs");
      return `<div class="card"><h2>🎬 Runs</h2>
        ${runs.length ? runs.map((r)=>`<div class="scrap-row">
          <span class="badge ${r.status==="done"?"ok":/failed/.test(r.status)?"err":"accent"}">${esc(r.status)}</span>
          <div class="grow" style="min-width:0"><b class="small">${esc(r.title)}</b>
            <div class="small muted">${r.params?.durationMin} min · ${esc(cfg.rythmes[r.params?.rythme]?.label||"")} · ${esc(r.params?.language||"")} · ${r.sceneCount} plans
              · ${(Object.values(r.cost||{}).reduce((a,b)=>a+b,0)).toFixed(2)} $</div>
            <div style="height:5px;background:#222;border-radius:3px;margin-top:5px"><div style="height:100%;width:${pct(r.status)}%;background:#4ade80;border-radius:3px"></div></div></div>
          ${/failed|cancelled/.test(r.status)?`<button class="btn btn-sm" data-resume="${r.id}">⚡ Reprendre</button>`:""}
          ${/_ready$/.test(r.status)?`<button class="btn btn-sm btn-accent" data-adv="${r.id}">▶ Continuer</button>`:""}
          <button class="btn btn-sm" data-open="${r.id}">📂</button>
        </div>`).join("") : `<div class="muted">Aucun run.</div>`}
      </div>`;
    }
    async function viewStock() {
      const st = await api("/api/machines/drama/stock");
      const chans = await api("/api/channels").catch(()=>[]);
      return `<div class="card"><h2>📦 Stock</h2>
        ${st.length ? `<div class="grid grid-3">${st.filter((v)=>!v.archived).map((v)=>`<div class="bank-folder">
          ${v.thumbRel?`<img src="/media/${encodeURIComponent(v.thumbRel)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px">`:""}
          <b class="small" style="display:block;margin-top:6px">${esc(v.title)}</b>
          <div class="small muted">${Math.round((v.seconds||0)/60)} min ${v.posted?"· ✅ publiée":""}</div>
          <div class="row" style="gap:6px;margin-top:6px">
            ${v.videoRel?`<a class="mini-btn" href="/media/${encodeURIComponent(v.videoRel)}" target="_blank">▶</a>`:""}
            <select class="s-chan mini-btn" data-id="${v.id}" style="flex:1">
              <option value="">Chaîne…</option>
              ${chans.map((c)=>`<option value="${esc(c.channelId)}">${esc(c.title)}</option>`).join("")}
            </select>
            <button class="mini-btn s-pub" data-id="${v.id}" data-run="${v.runId}">📤</button>
            <button class="mini-btn s-arch" data-id="${v.id}">🗄</button>
          </div></div>`).join("")}</div>` : `<div class="muted">Stock vide.</div>`}
      </div>`;
    }

    // ---------------- rendu ----------------
    async function draw() {
      const tabs = [["new","✨ Nouvelle vidéo"],["cast","🎭 Troupe"],["runs","🎬 Runs"],["stock","📦 Stock"]];
      const body = tab === "new" ? viewNew() : tab === "cast" ? viewCast() : await (tab === "runs" ? viewRuns() : viewStock());
      el.innerHTML = `<div class="row mb" style="gap:8px">
        <a href="#/machines" class="back-btn" title="Retour aux Machines">←</a>
        ${tabs.map(([k,l])=>`<button class="btn btn-sm ${k===tab?"btn-accent":""}" data-tab="${k}">${l}</button>`).join("")}
      </div>${body}`;
      el.querySelectorAll("[data-tab]").forEach((b)=>b.addEventListener("click",()=>{tab=b.dataset.tab;draw();}));
      if (tab === "new") wireNew();
      if (tab === "cast") wireCast();
      if (tab === "runs") wireRuns();
      if (tab === "stock") wireStock();
    }

    function params() {
      const $ = (s)=>el.querySelector(s);
      const mus = $("#g-music").value;
      return {
        subject: $("#g-subject").value.trim(),
        durationMin: Number($("#g-dur").value),
        language: $("#g-lang").value,
        style: $("#g-style").value,
        rythme: $("#g-rythme").value,
        narratorVoiceId: $("#g-narrator").value || null,
        musicId: mus && mus !== "none" ? mus : null,
        musicAuto: mus !== "none",
        subtitles: $("#g-subs").value === "1",
        lipsync: $("#g-lip").value === "1",
        cta: $("#g-cta").value === "1",
        ctaFirst: Number($("#g-cta1").value),
        ctaEvery: Number($("#g-ctaN").value),
        mode: $("#g-mode").value,
        nicheId: cfg.nicheId,
      };
    }
    function wireNew() {
      const $ = (s)=>el.querySelector(s);
      const refresh = () => {
        const p = params();
        const e = estimate(p);
        $("#g-cost").textContent = `${e.total.toFixed(2)} $`;
        $("#g-cost").title = `${e.shots} plans dont ${e.anim} animés`;
        $("#g-rythme-desc").textContent = cfg.rythmes[p.rythme]?.desc || "";
      };
      ["#g-dur","#g-rythme","#g-lip","#g-style","#g-lang","#g-subs","#g-cta"].forEach((s)=>$(s).addEventListener("change",refresh));
      refresh();

      // Choisir ≠ mémoriser (aligné sur Bouddhisme). Le menu ne sert QUE la vidéo en cours ;
      // le défaut de la machine se pose avec ★ — c'est lui que prendra un lancement automatique.
      const narState = () => {
        const sel = $("#g-narrator");
        const def = cfg.settings.narratorVoiceId;
        const isDef = sel.value && sel.value === def;
        const b = $("#g-nar-def");
        b.textContent = isDef ? "★" : "☆";
        b.style.color = isDef ? "#4ade80" : "";
        const nom = (id) => (cfg.voices || []).find((v) => v.id === id)?.name || "aucune";
        b.title = isDef
          ? `Défaut de la machine : ${nom(def)} — utilisé par les lancements automatiques`
          : "Définir cette voix comme défaut de la machine";
        const st = $("#g-nar-state");
        st.textContent = def ? `— défaut : ${nom(def)}` : "— aucun défaut défini";
        st.style.color = def ? "#4ade80" : "var(--err, #f87171)";
      };
      narState();
      $("#g-narrator").addEventListener("change", narState);
      $("#g-nar-def").addEventListener("click", async () => {
        const v = $("#g-narrator").value || null;
        if (!v) return AgentOS.toast("Choisis d'abord une voix", "err");
        try {
          await api("/api/machines/drama", { method: "PATCH", body: { settings: { narratorVoiceId: v } } });
          cfg.settings.narratorVoiceId = v;
          narState();
          AgentOS.toast(`Défaut : ${(cfg.voices || []).find((x) => x.id === v)?.name || v}`, "ok");
        } catch (e) { AgentOS.toast(e.message, "err"); }
      });
      $("#g-idea").addEventListener("click", async ()=>{
        $("#g-idea").textContent="…";
        try { const i = await api("/api/machines/drama/idea",{method:"POST",body:{nicheId:cfg.nicheId}}); $("#g-subject").value = i.subject || ""; }
        catch(e){ AgentOS.toast(e.message,"err"); }
        $("#g-idea").textContent="💡";
      });
      $("#g-go").addEventListener("click", async ()=>{
        if (!$("#g-narrator").value && !cfg.settings.narratorVoiceId)
          return AgentOS.toast("Choisis une voix de conteur, puis ★ pour la mémoriser", "err");
        $("#g-go").disabled = true;
        try { await api("/api/machines/drama/runs",{method:"POST",body:params()}); tab="runs"; draw(); AgentOS.toast("Run lancé 🎬","ok"); }
        catch(e){ AgentOS.toast(e.message,"err"); $("#g-go").disabled=false; }
      });
    }
    function wireCast() {
      const $ = (s)=>el.querySelector(s);
      el.querySelectorAll("[data-cmode]").forEach((b)=>b.addEventListener("click",()=>{castMode=b.dataset.cmode;draw();}));
      el.querySelectorAll(".c-pin").forEach((b)=>b.addEventListener("click", async ()=>{
        const on = b.dataset.on === "1";
        await api(`/api/machines/drama/cast/${b.dataset.id}`,{method:"PATCH",body:{pinned:!on}});
        AgentOS.toast(!on?"Personnage fixe : il sera dans toutes les vidéos":"Personnage libéré","ok");
        await load(); draw();
      }));
      el.querySelectorAll(".c-role").forEach((r)=>r.addEventListener("blur",()=>
        api(`/api/machines/drama/cast/${r.dataset.id}`,{method:"PATCH",body:{role:r.value.trim()}}).then(load)));
      el.querySelectorAll(".c-traits").forEach((r)=>r.addEventListener("blur",()=>
        api(`/api/machines/drama/cast/${r.dataset.id}`,{method:"PATCH",body:{traits:r.value.trim()}}).then(load)));

      const imp = $("#i-add");
      if (imp) imp.addEventListener("click", async ()=>{
        const f = $("#i-file").files[0];
        if(!f) return ($("#c-msg").textContent = "Choisis une image.");
        const name = $("#i-name").value.trim();
        if(!name) return ($("#c-msg").textContent = "Donne un nom.");
        $("#c-msg").textContent = "Lecture de l'image…";
        const dataUrl = await new Promise((res)=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(f);});
        $("#c-msg").textContent = "Import…";
        try {
          const e = await api("/api/machines/drama/cast/import",{method:"POST",body:{
            name, kind:$("#i-kind").value, role:$("#i-role").value.trim(),
            traits:$("#i-traits").value.trim(),
            desc:$("#i-desc").value.trim(), voiceId:$("#i-voice").value||null, dataUrl }});
          $("#c-msg").textContent = e.padded ? `Importée et ramenée en 16:9 (source ${e.srcRatio})` : "Importée.";
          await load(); draw();
        } catch(e){ $("#c-msg").textContent = "❌ "+e.message; }
      });

      const add = $("#c-add");
      if (add) add.addEventListener("click", async ()=>{
        const d = $("#c-desc").value.trim(); if(!d) return;
        $("#c-msg").textContent = "Rédaction de la fiche…";
        try {
          const draft = await api("/api/machines/drama/cast/draft",{method:"POST",body:{description:d,style:$("#c-style").value}});
          $("#c-msg").textContent = `Génération de « ${draft.name} »…`;
          await api("/api/machines/drama/cast",{method:"POST",body:draft});
          $("#c-desc").value=""; $("#c-msg").textContent="";
          await load(); draw();
        } catch(e){ $("#c-msg").textContent = "❌ "+e.message; }
      });
      el.querySelectorAll(".c-voice").forEach((s)=>s.addEventListener("change",()=>
        api(`/api/machines/drama/cast/${s.dataset.id}`,{method:"PATCH",body:{voiceId:s.value||null}}).then(load)));
      el.querySelectorAll(".c-del").forEach((b)=>b.addEventListener("click", async ()=>{
        if(!confirm("Supprimer cette entrée ?"))return;
        await api(`/api/machines/drama/cast/${b.dataset.id}`,{method:"DELETE"}); await load(); draw();
      }));
      el.querySelectorAll(".c-regen").forEach((b)=>b.addEventListener("click", async ()=>{
        b.textContent="…";
        try{ await api(`/api/machines/drama/cast/${b.dataset.id}/regen`,{method:"POST",body:{}}); await load(); draw(); }
        catch(e){ AgentOS.toast(e.message,"err"); b.textContent="↻"; }
      }));
    }
    function wireRuns() {
      el.querySelectorAll("[data-resume]").forEach((b)=>b.addEventListener("click",()=>
        api(`/api/machines/drama/runs/${b.dataset.resume}/resume`,{method:"POST"}).then(draw)));
      el.querySelectorAll("[data-adv]").forEach((b)=>b.addEventListener("click",()=>
        api(`/api/machines/drama/runs/${b.dataset.adv}/advance`,{method:"POST"})
          .then(draw).catch((e)=>AgentOS.toast(e.message,"err"))));
      el.querySelectorAll("[data-open]").forEach((b)=>b.addEventListener("click",()=>openRun(b.dataset.open)));
      clearInterval(timer); timer = setInterval(()=>{ if(tab==="runs") draw(); }, 8000);
    }
    function wireStock() {
      el.querySelectorAll(".s-arch").forEach((b)=>b.addEventListener("click",()=>
        api(`/api/machines/drama/stock/${b.dataset.id}`,{method:"PATCH",body:{archived:true}}).then(draw)));
      el.querySelectorAll(".s-pub").forEach((b)=>b.addEventListener("click", async ()=>{
        const sel = el.querySelector(`.s-chan[data-id="${b.dataset.id}"]`);
        if(!sel.value) return AgentOS.toast("Choisis une chaîne","err");
        b.textContent="…";
        try{
          const r = await api(`/api/machines/drama/runs/${b.dataset.run}/publish`,
            {method:"POST",body:{channelId:sel.value,privacy:"private"}});
          await api(`/api/machines/drama/stock/${b.dataset.id}`,{method:"PATCH",body:{posted:true}});
          AgentOS.toast("Publiée (privée) — "+r.url,"ok"); draw();
        }catch(e){ AgentOS.toast(e.message,"err"); b.textContent="📤"; }
      }));
    }

    async function openRun(id) {
      const r = await api(`/api/machines/drama/runs/${id}`);
      const o = document.createElement("div"); o.className="picker-overlay";
      const cost = Object.values(r.cost||{}).reduce((a,b)=>a+b,0);
      o.innerHTML = `<div class="scrap-modal" style="width:min(920px,94vw);max-height:88vh;overflow:auto">
        <div class="row between mb"><h2 style="margin:0;font-size:16px">${esc(r.title)}</h2>
          <button class="btn btn-sm btn-ghost" data-close>✕</button></div>
        <div class="row mb" style="gap:6px;flex-wrap:wrap">
          ${STEPS.map((s,k)=>`<span class="badge ${k<stepIdx(r.status)?"ok":k===stepIdx(r.status)?"accent":""}">${s.i} ${s.l}</span>`).join("")}
        </div>
        <div class="small muted mb">${r.sceneCount} plans · ${cost.toFixed(2)} $ · ${esc(r.status)}
          ${r.musicUsed?` · 🎵 ${esc(r.musicUsed.name)}`:""}</div>
        ${r.casting && r.casting.length ? `
        <div class="card" style="padding:12px;margin-bottom:10px">
          <div class="row between" style="align-items:center;margin-bottom:6px">
            <b class="small">🎭 Distribution</b>
            ${/^cast_ready$/.test(r.status)?`<button class="btn btn-sm btn-accent" id="cast-save">Enregistrer la distribution</button>`:`<span class="small muted">verrouillée (étape passée)</span>`}
          </div>
          <div class="small muted mb">Le casting automatique choisit d'abord sur le <b>caractère</b>, puis sur le rôle habituel.
            Tant que l'étape n'est pas validée, tu peux réattribuer chaque rôle.</div>
          <table class="tbl" style="width:100%">
            <thead><tr><th>Personnage du script</th><th>Rôle</th><th>Fiche attribuée</th><th>Pourquoi</th></tr></thead>
            <tbody>${r.casting.map((c)=>`<tr>
              <td><b class="small">${esc(c.story)}</b></td>
              <td class="small muted">${esc(c.storyRole||"")}</td>
              <td><select class="cast-pick" data-story="${esc(c.story)}" ${/^cast_ready$/.test(r.status)?"":"disabled"}>
                <option value="">— aucune (sera créée) —</option>
                ${(cfg.cast||[]).filter((e)=>e.kind==="personnage").map((e)=>
                  `<option value="${e.id}"${c.entryId===e.id?" selected":""}>${e.pinned?"📌 ":""}${esc(e.name)}${e.traits?` — ${esc(e.traits)}`:""}</option>`).join("")}
              </select></td>
              <td class="small muted">${esc(c.why||"")}</td></tr>`).join("")}</tbody>
          </table>
        </div>` : ""}
        ${r.video?`<video src="/media/${encodeURIComponent(r.video.rel)}?v=${r.video.ts}" controls style="width:100%;border-radius:8px" preload="metadata"></video>`:""}
        ${r.pack?`<div class="grid grid-2" style="margin-top:12px">
          <div>${r.thumb?`<img src="/media/${encodeURIComponent(r.thumb.rel)}?v=${r.thumbTs||0}" style="width:100%;border-radius:8px">`:""}</div>
          <div><label class="field"><span>Titre (${(r.pack.title||"").length}/100)</span><input value="${esc(r.pack.title||"")}" readonly></label>
            <label class="field"><span>Tags</span><textarea rows="3" readonly>${esc((r.pack.tags||[]).join(", "))}</textarea></label></div>
        </div>
        <label class="field"><span>Description (${String(r.pack.description||"").split(/\s+/).length} mots)</span>
          <textarea rows="7" readonly>${esc(r.pack.description||"")}</textarea></label>`:""}
        <div class="transcript-box" style="max-height:200px;margin-top:10px">${(r.logs||[]).slice(-40).map((l)=>esc(l.msg)).join("<br>")}</div>
      </div>`;
      document.body.appendChild(o);
      o.querySelector("[data-close]").addEventListener("click",()=>o.remove());
      const cs = o.querySelector("#cast-save");
      if (cs) cs.addEventListener("click", async ()=>{
        const mapping = [...o.querySelectorAll(".cast-pick")].map((s)=>({story:s.dataset.story, entryId:s.value||null}));
        cs.disabled = true; cs.textContent = "…";
        try { await api(`/api/machines/drama/runs/${id}/casting`,{method:"POST",body:{mapping}});
              AgentOS.toast("Distribution enregistrée","ok"); o.remove(); openRun(id); }
        catch(e){ AgentOS.toast(e.message,"err"); cs.disabled=false; cs.textContent="Enregistrer la distribution"; }
      });
    }

    await load();
    await draw();
  },
});
