/**
 * BANQUE DE MUSIQUES — MP3 déposés par l'utilisateur, réutilisés par les machines.
 * Rien n'est généré : une piste versée ici sert autant de fois qu'on veut, à coût nul.
 */
AgentOS.register("musics", {
  title: "Musiques",
  async render(el) {
    const { api, esc } = AgentOS;
    const LABEL = { intro: "Intro", fond: "Fond", tension: "Tension", emotion: "Émotion", generique: "Générique" };
    let playing = null;

    async function draw() {
      const d = await api("/api/music");
      const byUsage = {};
      for (const t of d.tracks) (byUsage[t.usage] = byUsage[t.usage] || []).push(t);

      el.innerHTML = `
      <div class="card">
        <h2>🎵 Banque de musiques</h2>
        <div class="small muted mb">Dépose tes propres MP3. Ils sont réutilisés d'une vidéo à l'autre —
          <b>aucune génération, donc aucun coût par vidéo</b>. La machine Drama tire sa musique d'intro d'ici.</div>
        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Nom</span><input id="m-name" placeholder="Ex. Tension dramatique 1"></label>
          <label class="field" style="margin:0"><span>Usage</span>
            <select id="m-usage">${d.usages.map((u)=>`<option value="${u}">${esc(LABEL[u]||u)}</option>`).join("")}</select></label>
          <label class="field" style="margin:0"><span>Fichier MP3</span><input id="m-file" type="file" accept="audio/mpeg,.mp3"></label>
          <button class="btn btn-accent" id="m-add">＋ Ajouter</button>
        </div>
        <span id="m-msg" class="small muted"></span>
      </div>

      ${Object.keys(byUsage).length ? Object.entries(byUsage).map(([u,ts])=>`
        <div class="card"><h3>${esc(LABEL[u]||u)} <span class="small muted">— ${ts.length} piste(s)</span></h3>
          <table class="tbl" style="width:100%">
            <thead><tr><th style="width:40px"></th><th>Nom</th><th>Durée</th><th>Poids</th><th style="width:90px"></th></tr></thead>
            <tbody>${ts.map((t)=>`<tr>
              <td><button class="mini-btn play" data-id="${t.id}">▶</button></td>
              <td><b contenteditable="true" class="edit-name" data-id="${t.id}">${esc(t.name)}</b></td>
              <td class="small">${Math.floor(t.seconds/60)}:${String(Math.round(t.seconds%60)).padStart(2,"0")}</td>
              <td class="small muted">${t.sizeKo} Ko</td>
              <td style="text-align:right">
                <select class="mv-usage mini-btn" data-id="${t.id}" style="width:auto">
                  ${d.usages.map((x)=>`<option value="${x}"${x===t.usage?" selected":""}>${esc(LABEL[x]||x)}</option>`).join("")}
                </select>
                <button class="mini-btn del" data-id="${t.id}">✕</button></td></tr>`).join("")}</tbody>
          </table></div>`).join("") : `<div class="card"><div class="muted">Aucune musique. Ajoute des MP3 ci-dessus.</div></div>`}`;

      el.querySelectorAll(".play").forEach((b)=>b.addEventListener("click",()=>{
        if(playing){playing.pause();playing=null;}
        el.querySelectorAll(".play").forEach((x)=>(x.textContent="▶"));
        const a = new Audio(`/api/music/${b.dataset.id}/file`);
        b.textContent="⏸"; playing=a;
        a.addEventListener("ended",()=>{b.textContent="▶";playing=null;});
        a.play().catch(()=>(b.textContent="▶"));
      }));
      el.querySelectorAll(".edit-name").forEach((n)=>n.addEventListener("blur",()=>
        api(`/api/music/${n.dataset.id}`,{method:"PATCH",body:{name:n.textContent.trim()}})));
      el.querySelectorAll(".mv-usage").forEach((s)=>s.addEventListener("change",()=>
        api(`/api/music/${s.dataset.id}`,{method:"PATCH",body:{usage:s.value}}).then(draw)));
      el.querySelectorAll(".del").forEach((b)=>b.addEventListener("click", async ()=>{
        if(!confirm("Supprimer cette musique ?"))return;
        await api(`/api/music/${b.dataset.id}`,{method:"DELETE"}); draw();
      }));

      el.querySelector("#m-add").addEventListener("click", async ()=>{
        const f = el.querySelector("#m-file").files[0];
        const msg = el.querySelector("#m-msg");
        if(!f) return (msg.textContent="Choisis un fichier MP3.");
        const name = el.querySelector("#m-name").value.trim() || f.name.replace(/\.mp3$/i,"");
        msg.textContent = "Lecture du fichier…";
        const dataUrl = await new Promise((res)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(f); });
        msg.textContent = "Ajout…";
        try { await api("/api/music",{method:"POST",body:{name,usage:el.querySelector("#m-usage").value,dataUrl}});
              msg.textContent=""; draw(); }
        catch(e){ msg.textContent = "❌ "+e.message; }
      });
    }
    await draw();
  },
});
