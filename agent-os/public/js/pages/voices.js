/**
 * BIBLIOTHÈQUE DE VOIX — écouter, comparer, enregistrer les voix des personnages.
 * Alimente le sélecteur de voix de toutes les machines (GET /api/voices).
 * Le DÉBIT est mesuré à l'enregistrement : c'est lui qui donne l'atempo d'une fiche personnage.
 */
AgentOS.register("voices", {
  title: "Voix",
  async render(el) {
    const { api, esc } = AgentOS;
    const ENGINE_LABEL = { inworld: "Inworld", elevenlabs: "ElevenLabs v3" };
    const ENGINE_PRICE = { inworld: "0,015 $/1000 car.", elevenlabs: "0,10 $/1000 car." };
    let playing = null;

    // Cible de débit par usage — sert à afficher l'atempo qu'il faudra appliquer.
    const CIBLES = [
      { key: "drama", label: "Drama / récit (158 mots/min)", wpm: 158 },
      { key: "boud", label: "Contemplatif (127 mots/min)", wpm: 127 },
    ];
    let cible = CIBLES[0];

    const badge = (v) => {
      const t = v.wpm ? cible.wpm / v.wpm : 1;
      const ok = Math.abs(1 - t) < 0.05;
      const col = ok ? "#4ade80" : t < 0.85 ? "#fbbf24" : "#94a3b8";
      return `<span style="color:${col}">${v.wpm || "?"} mots/min · atempo ${t.toFixed(2)}${ok ? " ✅" : ""}</span>`;
    };

    async function draw() {
      const list = await api("/api/voices");
      const byEngine = {};
      for (const v of list) (byEngine[v.engine] = byEngine[v.engine] || []).push(v);

      el.innerHTML = `
      <div class="card">
        <h2>🎙 Bibliothèque de voix</h2>
        <div class="small muted mb">Chaque voix est écoutable et porte son <b>débit mesuré</b>. L'atempo affiché est
          celui à appliquer pour atteindre la cible choisie — c'est une propriété de la voix, pas de la machine.</div>
        <label class="field" style="max-width:320px"><span>Cible de débit</span>
          <select id="v-cible">${CIBLES.map((c) => `<option value="${c.key}"${c.key === cible.key ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
      </div>

      ${Object.keys(byEngine).length ? Object.entries(byEngine).map(([eng, vs]) => `
        <div class="card">
          <h3>${esc(ENGINE_LABEL[eng] || eng)} <span class="small muted">— ${esc(ENGINE_PRICE[eng] || "")}</span></h3>
          <table class="tbl" style="width:100%">
            <thead><tr><th style="width:40px"></th><th>Nom</th><th>Genre</th><th>Débit</th><th>Référence</th><th style="width:120px"></th></tr></thead>
            <tbody>${vs.map((v) => `
              <tr data-id="${v.id}">
                <td><button class="mini-btn play" data-id="${v.id}" title="Écouter">▶</button></td>
                <td><b contenteditable="true" class="edit-name" data-id="${v.id}">${esc(v.name)}</b></td>
                <td><select class="edit-gender" data-id="${v.id}" style="width:90px">
                    <option value=""${!v.gender ? " selected" : ""}>—</option>
                    <option value="H"${v.gender === "H" ? " selected" : ""}>Homme</option>
                    <option value="F"${v.gender === "F" ? " selected" : ""}>Femme</option></select></td>
                <td class="small">${badge(v)}</td>
                <td class="small muted" style="font-family:monospace">${esc(v.ref)}</td>
                <td style="text-align:right">
                  <button class="mini-btn refresh" data-id="${v.id}" title="Regénérer l'échantillon et re-mesurer">↻</button>
                  <button class="mini-btn del" data-id="${v.id}" title="Supprimer">✕</button></td>
              </tr>`).join("")}</tbody>
          </table>
        </div>`).join("") : `<div class="card"><div class="muted">Aucune voix enregistrée.</div></div>`}

      <div class="card">
        <h3>Ajouter une voix</h3>
        <div class="small muted mb">ElevenLabs : colle l'<b>ID</b> depuis
          <a href="https://elevenlabs.io/app/voice-library" target="_blank" rel="noopener">la bibliothèque</a>.
          Inworld : le <b>nom</b> seul (Alain, Hélène, Mathieu, Étienne) — le suffixe de langue est ajouté automatiquement.</div>
        <div class="grid grid-4 mb" style="align-items:end">
          <label class="field" style="margin:0"><span>Nom affiché</span><input id="a-name" placeholder="Ex. Aminata"></label>
          <label class="field" style="margin:0"><span>Genre</span>
            <select id="a-gender"><option value="">—</option><option value="F">Femme</option><option value="H">Homme</option></select></label>
          <label class="field" style="margin:0"><span>Moteur</span>
            <select id="a-engine"><option value="elevenlabs">ElevenLabs v3</option><option value="inworld">Inworld</option></select></label>
          <label class="field" style="margin:0"><span>ID ou nom</span><input id="a-ref" placeholder="obmcfXCePmPgsNsLIWIj"></label>
        </div>
        <button class="btn" id="a-go">Ajouter et écouter</button>
        <span id="a-msg" class="small muted" style="margin-left:10px"></span>
      </div>`;

      el.querySelector("#v-cible").addEventListener("change", (e) => {
        cible = CIBLES.find((c) => c.key === e.target.value) || CIBLES[0]; draw();
      });

      el.querySelectorAll(".play").forEach((b) => b.addEventListener("click", () => {
        if (playing) { playing.pause(); playing = null; }
        el.querySelectorAll(".play").forEach((x) => (x.textContent = "▶"));
        const a = new Audio(`/api/voices/${b.dataset.id}/sample?t=${Date.now()}`);
        b.textContent = "⏸"; playing = a;
        a.addEventListener("ended", () => { b.textContent = "▶"; playing = null; });
        a.play().catch(() => { b.textContent = "▶"; });
      }));

      el.querySelectorAll(".edit-name").forEach((n) => n.addEventListener("blur", () =>
        api(`/api/voices/${n.dataset.id}`, { method: "PATCH", body: { name: n.textContent.trim() } })));
      el.querySelectorAll(".edit-gender").forEach((g) => g.addEventListener("change", () =>
        api(`/api/voices/${g.dataset.id}`, { method: "PATCH", body: { gender: g.value } }).then(draw)));
      el.querySelectorAll(".del").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Supprimer cette voix ?")) return;
        await api(`/api/voices/${b.dataset.id}`, { method: "DELETE" }); draw();
      }));
      el.querySelectorAll(".refresh").forEach((b) => b.addEventListener("click", async () => {
        b.textContent = "…"; try { await api(`/api/voices/${b.dataset.id}/refresh`, { method: "POST" }); } catch {} draw();
      }));

      el.querySelector("#a-go").addEventListener("click", async () => {
        const msg = el.querySelector("#a-msg");
        const body = {
          name: el.querySelector("#a-name").value.trim(),
          gender: el.querySelector("#a-gender").value,
          engine: el.querySelector("#a-engine").value,
          ref: el.querySelector("#a-ref").value.trim(),
        };
        msg.textContent = "Synthèse de l'échantillon…";
        try { await api("/api/voices", { method: "POST", body }); msg.textContent = ""; draw(); }
        catch (e) { msg.textContent = "❌ " + (e.message || e); }
      });
    }

    await draw();
  },
});
