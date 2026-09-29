/**
 * Miniature Creator natif — même ergonomie que le Kie Image Studio d'origine :
 * on choisit d'abord le NOMBRE TOTAL d'images, puis on RÉPARTIT ces images
 * entre les 4 modèles (steppers). Sources i2i depuis « Mes fichiers » ou le disque.
 * Chaque job = tâche suivie + alerte Telegram à la fin, résultat dans agent-os/output/miniatures.
 */
AgentOS.register("miniature", {
  title: "Miniature Creator",
  async render(el) {
    const { api, esc, ago } = AgentOS;
    const state = { mode: "t2i", aspect: "16:9", total: 4, alloc: {}, sources: [] };
    let tools = {};
    let pollTimer = null;

    el.innerHTML = `
      <div class="creator-layout">
        <div class="card">
          <h2>Nouvelle génération</h2>
          <div class="small muted mb" id="kie-state"></div>

          <div class="fbar" style="padding:8px 12px;margin-bottom:10px;gap:14px">
            <span class="fbar-item"><span>Mode</span>
              <span class="mini-seg" id="mode-seg">
                <button class="active" data-v="t2i">Text</button>
                <button data-v="i2i">Image</button>
              </span></span>
            <span class="fbar-item"><span>Format</span>
              <span class="mini-seg" id="fmt-seg">
                ${["16:9", "9:16", "1:1", "4:3"].map((f, i) => `<button class="${i === 0 ? "active" : ""}" data-v="${f}">${f}</button>`).join("")}
              </span></span>
          </div>

          <label class="field"><span>Nombre total d'images</span>
            <div class="total-stepper">
              <button id="total-minus">−</button>
              <span class="tn" id="total-num">4</span>
              <button id="total-plus">+</button>
              <span class="alloc-remaining" id="alloc-remaining"></span>
            </div></label>

          <div class="field">
            <div class="row between" style="margin-bottom:6px">
              <span style="font-weight:600;font-size:12px;color:var(--ink-2)">Répartition par modèle</span>
              <button class="btn btn-sm btn-ghost" id="alloc-even">Répartir équitablement</button>
            </div>
            <div id="alloc-list"></div>
          </div>

          <div class="field" id="src-block" style="display:none">
            <span style="display:block;font-weight:600;font-size:12px;color:var(--ink-2);margin-bottom:6px">Images sources</span>
            <div class="src-zone">
              <div class="src-thumbs" id="src-thumbs"></div>
              <div class="row" style="margin-top:8px">
                <button class="btn btn-sm grow" id="btn-pick-files">◫ Depuis Mes fichiers</button>
                <button class="btn btn-sm btn-ghost grow" id="btn-pick-disk">Depuis le disque…</button>
                <input type="file" id="disk-input" accept="image/png,image/jpeg,image/webp" multiple style="display:none">
              </div>
            </div>
          </div>

          <label class="field"><span>Prompt</span>
            <textarea id="gen-prompt" rows="3" placeholder="Décris la miniature (style, texte, émotion, composition)…"></textarea>
            <div class="small muted" id="prompt-hint"></div></label>

          <button class="btn btn-accent" id="btn-generate" style="width:100%">✦ Générer</button>
          <div class="small muted mt">Suivi dans <a href="#/tasks">Tâches &amp; Cron</a> · résultats dans
          <span class="mono">agent-os/output/miniatures</span> · alerte Telegram à la fin.</div>
        </div>
        <div class="grid">
          <div class="card">
            <h2>Générations en cours</h2>
            <div class="gen-grid" id="jobs"></div>
          </div>
          <div class="card">
            <h2>Galerie <span class="h-actions"><a class="btn btn-sm btn-ghost" href="#/files">Ouvrir Mes fichiers</a></span></h2>
            <div class="gen-grid" id="gallery"></div>
          </div>
        </div>
      </div>`;

    // ----- Config outils -----
    try {
      const st = await api("/api/studio/status");
      tools = st.tools;
      for (const id of Object.keys(tools)) state.alloc[id] = 0;
      state.alloc.nano = state.total; // défaut : tout sur Nano Banana
      el.querySelector("#kie-state").innerHTML = st.configured
        ? `<span class="badge ok">Kie.ai prêt</span>`
        : `<span class="badge err">Clé Kie manquante</span> — ajoute-la dans <a href="#/settings">Paramètres</a>.`;
    } catch (e) {
      el.querySelector("#kie-state").innerHTML = `<span class="badge err">${esc(e.message)}</span>`;
    }

    const allocated = () => Object.values(state.alloc).reduce((a, b) => a + b, 0);

    function renderAlloc() {
      el.querySelector("#alloc-list").innerHTML = Object.entries(tools)
        .map(([id, t]) => {
          const conf = t[state.mode];
          const sub = state.mode === "i2i" ? `${t.sub} · ${t.i2i.maxImages} img source max` : t.sub;
          return `<div class="alloc-row ${state.alloc[id] > 0 ? "on" : ""}">
            <div class="a-name">${esc(t.name)}<span class="a-sub">${esc(sub)}</span></div>
            <div class="stepper">
              <button data-am="${id}">−</button>
              <span class="a-count">${state.alloc[id]}</span>
              <button data-ap="${id}">+</button>
            </div>
          </div>`;
        })
        .join("");
      el.querySelectorAll("[data-am]").forEach((b) =>
        b.addEventListener("click", () => {
          state.alloc[b.dataset.am] = Math.max(0, state.alloc[b.dataset.am] - 1);
          renderAlloc();
        })
      );
      el.querySelectorAll("[data-ap]").forEach((b) =>
        b.addEventListener("click", () => {
          if (allocated() < state.total) state.alloc[b.dataset.ap]++;
          renderAlloc();
        })
      );
      const remaining = state.total - allocated();
      const badge = el.querySelector("#alloc-remaining");
      badge.textContent = remaining === 0 ? "✓ tout est réparti" : `${remaining} à répartir`;
      badge.classList.toggle("done", remaining === 0);
      el.querySelector("#total-num").textContent = state.total;

      const chosen = Object.entries(tools).filter(([id]) => state.alloc[id] > 0);
      const btn = el.querySelector("#btn-generate");
      btn.textContent = state.total > 1 ? `✦ Générer ${state.total} images` : "✦ Générer";
      btn.disabled = remaining !== 0 || !chosen.length;
      const maxes = chosen.map(([, t]) => t[state.mode].promptMax);
      el.querySelector("#prompt-hint").textContent = chosen.length
        ? `Limite la plus stricte : ${Math.min(...maxes)} caractères.` +
          (state.mode === "i2i" && state.alloc.grok > 0 ? " Grok i2i : prompt optionnel." : "")
        : "Répartis d'abord tes images sur les modèles.";
    }

    el.querySelector("#total-minus").addEventListener("click", () => {
      state.total = Math.max(1, state.total - 1);
      while (allocated() > state.total) {
        const id = Object.keys(tools).reverse().find((k) => state.alloc[k] > 0);
        if (!id) break;
        state.alloc[id]--;
      }
      renderAlloc();
    });
    el.querySelector("#total-plus").addEventListener("click", () => {
      state.total = Math.min(20, state.total + 1);
      renderAlloc();
    });
    el.querySelector("#alloc-even").addEventListener("click", () => {
      const ids = Object.keys(tools);
      ids.forEach((id) => (state.alloc[id] = Math.floor(state.total / ids.length)));
      for (let i = 0; i < state.total % ids.length; i++) state.alloc[ids[i]]++;
      renderAlloc();
    });

    // ----- Mode / format (mini-boutons sur une ligne) -----
    el.querySelectorAll("#mode-seg button").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#mode-seg button").forEach((x) => x.classList.toggle("active", x === b));
        state.mode = b.dataset.v;
        el.querySelector("#src-block").style.display = state.mode === "i2i" ? "" : "none";
        renderAlloc();
      })
    );
    el.querySelectorAll("#fmt-seg button").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#fmt-seg button").forEach((x) => x.classList.toggle("active", x === b));
        state.aspect = b.dataset.v;
      })
    );

    // ----- Sources i2i -----
    function renderSources() {
      el.querySelector("#src-thumbs").innerHTML = state.sources
        .map((s, i) => `<div class="st"><img src="${esc(s.preview)}"><button data-rm="${i}">✕</button></div>`)
        .join("");
      el.querySelectorAll("[data-rm]").forEach((b) =>
        b.addEventListener("click", () => { state.sources.splice(Number(b.dataset.rm), 1); renderSources(); })
      );
    }

    el.querySelector("#btn-pick-files").addEventListener("click", async () => {
      const overlay = document.createElement("div");
      overlay.className = "picker-overlay";
      overlay.innerHTML = `<div class="picker">
        <div class="row between mb"><h2 style="margin:0;font-size:14px">Choisir des images</h2>
          <div class="chips">
            <button class="chip active" data-ps="local">Local</button>
            <button class="chip" data-ps="drive">Drive</button>
            <button class="btn btn-sm btn-ghost" id="pk-close">Fermer</button>
          </div></div>
        <div class="file-grid" id="pk-grid"><span class="spin"></span></div></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector("#pk-close").addEventListener("click", () => overlay.remove());

      async function loadPick(src) {
        const grid = overlay.querySelector("#pk-grid");
        grid.innerHTML = `<span class="spin"></span>`;
        try {
          const files = await api(`/api/files?source=${src}&type=image`);
          grid.innerHTML = files.length
            ? files
                .map((f, i) => {
                  const prev = f.source === "drive" ? `/api/drive/thumb?id=${f.id}` : "/media/" + encodeURIComponent(f.rel);
                  return `<div class="file-card" data-pick="${i}">
                    <div class="prev"><img src="${esc(prev)}" loading="lazy"></div>
                    <div class="info"><div class="name">${esc(f.name)}</div></div></div>`;
                })
                .join("")
            : `<div class="empty small">Aucune image</div>`;
          grid.querySelectorAll("[data-pick]").forEach((c) =>
            c.addEventListener("click", () => {
              const f = files[Number(c.dataset.pick)];
              // driveId : le serveur rend le fichier public avant de le donner à Kie
              state.sources.push(
                f.source === "drive"
                  ? { driveId: f.id, preview: `/api/drive/thumb?id=${f.id}` }
                  : { rel: f.rel, preview: "/media/" + encodeURIComponent(f.rel) }
              );
              renderSources();
              overlay.remove();
            })
          );
        } catch (e) {
          grid.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
        }
      }
      overlay.querySelectorAll("[data-ps]").forEach((b) =>
        b.addEventListener("click", () => {
          overlay.querySelectorAll("[data-ps]").forEach((x) => x.classList.toggle("active", x === b));
          loadPick(b.dataset.ps);
        })
      );
      loadPick("local");
    });

    el.querySelector("#btn-pick-disk").addEventListener("click", () => el.querySelector("#disk-input").click());
    el.querySelector("#disk-input").addEventListener("change", (e) => {
      [...e.target.files].forEach((file) => {
        if (file.size > 10 * 1024 * 1024) return AgentOS.toast(file.name + " dépasse 10 Mo", "err");
        const r = new FileReader();
        r.onload = () => {
          state.sources.push({ dataUrl: r.result, name: file.name, preview: r.result });
          renderSources();
        };
        r.readAsDataURL(file);
      });
      e.target.value = "";
    });

    // ----- Génération -----
    el.querySelector("#btn-generate").addEventListener("click", async () => {
      const btn = el.querySelector("#btn-generate");
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "Lancement…";
      try {
        await api("/api/studio/generate", {
          method: "POST",
          body: {
            allocations: state.alloc,
            mode: state.mode,
            prompt: el.querySelector("#gen-prompt").value.trim(),
            aspect: state.aspect,
            sources: state.sources.map(({ preview, ...s }) => s),
          },
        });
        AgentOS.toast("Génération lancée — suivi dans Tâches & Cron", "ok");
        loadJobs();
      } catch (e) {
        AgentOS.toast(e.message, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = label;
        renderAlloc();
      }
    });

    // ----- Jobs + galerie -----
    function lightbox(src) {
      const lb = document.createElement("div");
      lb.className = "lightbox";
      lb.innerHTML = `<img src="${esc(src)}">`;
      lb.addEventListener("click", () => lb.remove());
      document.body.appendChild(lb);
    }

    async function loadJobs() {
      let jobs = [];
      try { jobs = await api("/api/studio/jobs"); } catch {}
      const active = jobs.filter((j) => j.status === "running");
      const box = el.querySelector("#jobs");
      box.innerHTML = jobs.length
        ? jobs
            .slice(0, 12)
            .map((j) => {
              const media =
                j.status === "done" && j.resultRel
                  ? `<img src="/media/${encodeURIComponent(j.resultRel)}" data-lb="/media/${encodeURIComponent(j.resultRel)}">`
                  : j.status === "failed"
                  ? `<div class="small" style="color:var(--err)">⚠ ${esc(j.error || "Échec")}</div>`
                  : `<div style="width:100%"><div class="small muted mb">${esc(j.step)}</div>
                     <div class="progress"><div style="width:${j.progress}%"></div></div></div>`;
              return `<div class="gen-card"><div class="gm">${media}</div>
                <div class="gf"><span class="badge mut">${esc(j.toolName)}${j.mode === "i2i" ? " · i2i" : ""}</span>
                <span class="badge ${j.status === "done" ? "ok" : j.status === "failed" ? "err" : "accent"}">${j.status === "running" ? j.progress + "%" : j.status}</span></div></div>`;
            })
            .join("")
        : `<div class="empty small" style="grid-column:1/-1">Aucune génération pour l'instant.</div>`;
      box.querySelectorAll("[data-lb]").forEach((img) => img.addEventListener("click", () => lightbox(img.dataset.lb)));
      clearTimeout(pollTimer);
      if (active.length) pollTimer = setTimeout(loadJobs, 2500);
      else loadGallery();
    }

    async function loadGallery() {
      let items = [];
      try { items = await api("/api/studio/gallery"); } catch {}
      el.querySelector("#gallery").innerHTML = items.length
        ? items
            .slice(0, 12)
            .map(
              (it) => `<div class="gen-card">
              <div class="gm"><img src="/media/${encodeURIComponent(it.rel)}" loading="lazy" data-lb="/media/${encodeURIComponent(it.rel)}"></div>
              <div class="gf"><div class="row between"><span class="badge mut">${esc(it.tool)}${it.mode === "i2i" ? " · i2i" : ""}</span>
                <span class="muted mono">${ago(it.date)}</span></div>
                ${it.prompt ? `<div class="muted" style="margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(it.prompt)}</div>` : ""}</div></div>`
            )
            .join("")
        : `<div class="empty small" style="grid-column:1/-1">La galerie se remplira ici (aussi visible dans Mes fichiers).</div>`;
      el.querySelectorAll("#gallery [data-lb]").forEach((img) => img.addEventListener("click", () => lightbox(img.dataset.lb)));
    }

    this.onLeave = () => clearTimeout(pollTimer);
    renderAlloc();
    loadJobs();
    loadGallery();
  },
});
