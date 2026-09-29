/**
 * Mes fichiers : dossier de résultats agent-os/output + galerie studio + vidéos + Drive.
 * - Miniatures Drive proxifiées par le serveur (fini les 403).
 * - Clic = aperçu (lightbox / onglet de visualisation), jamais de téléchargement automatique.
 */
AgentOS.register("files", {
  title: "Mes fichiers",
  async render(el) {
    const { api, esc, fmt, dateFr } = AgentOS;
    const ui = { source: "local", type: "", folder: "", q: "", scrap: false };

    el.innerHTML = `
      <div class="fbar mb">
        <span class="fbar-item"><span>Source</span>
          <span class="mini-seg" id="seg-src">
            <button class="active" data-v="local">Local</button>
            <button data-v="drive">Google Drive</button>
          </span></span>
        <span class="fbar-item"><span>Type</span>
          <span class="mini-seg" id="seg-type">
            <button class="active" data-v="">Tout</button>
            <button data-v="image">Images</button>
            <button data-v="video">Vidéos</button>
          </span></span>
        <span class="fbar-item" id="folder-wrap" style="display:none"><span>Dossier</span>
          <span class="mini-seg" id="seg-folder"></span></span>
        <span class="fbar-item" id="scrap-wrap"><span>Scraping</span>
          <span class="mini-seg" id="seg-scrap">
            <button class="active" data-sv="0">Masqué</button>
            <button data-sv="1">Affiché</button>
          </span></span>
        <input type="text" id="file-search" placeholder="🔎 Rechercher un fichier…" style="width:220px;margin-left:auto">
        <span class="small muted" id="files-count"></span>
      </div>
      <div id="files-grid"></div>`;

    function lightbox(src, isVideo) {
      const lb = document.createElement("div");
      lb.className = "lightbox";
      lb.innerHTML = isVideo ? `<video src="${esc(src)}" controls autoplay style="max-width:92vw;max-height:92vh"></video>` : `<img src="${esc(src)}">`;
      lb.addEventListener("click", (e) => { if (e.target === lb) lb.remove(); });
      document.body.appendChild(lb);
    }

    async function load() {
      const grid = el.querySelector("#files-grid");
      grid.innerHTML = `<div class="empty" style="border:none"><span class="spin"></span></div>`;
      try {
        const q = new URLSearchParams({ source: ui.source });
        if (ui.type) q.set("type", ui.type);
        let files = await api("/api/files?" + q);

        // Les miniatures de scraping polluent la grille : masquées par défaut
        if (ui.source === "local" && !ui.scrap) files = files.filter((f) => f.folder !== "Scraping");

        // Filtre par dossier (local uniquement) — « Scraping » n'y figure jamais,
        // son affichage passe par le toggle dédié
        const folders = [...new Set(files.map((f) => f.folder).filter(Boolean))].filter((f) => f !== "Scraping");
        const wrap = el.querySelector("#folder-wrap");
        if (ui.source === "local" && folders.length > 1) {
          wrap.style.display = "";
          el.querySelector("#seg-folder").innerHTML =
            `<button class="${!ui.folder ? "active" : ""}" data-fv="">Tous</button>` +
            folders.map((f) => `<button class="${ui.folder === f ? "active" : ""}" data-fv="${esc(f)}">${esc(f)}</button>`).join("");
          el.querySelectorAll("[data-fv]").forEach((b) =>
            b.addEventListener("click", () => { ui.folder = b.dataset.fv; load(); })
          );
        } else {
          wrap.style.display = "none";
        }
        if (ui.folder) files = files.filter((f) => f.folder === ui.folder);
        // Recherche par nom
        if (ui.q) files = files.filter((f) => f.name.toLowerCase().includes(ui.q));

        el.querySelector("#files-count").textContent = `${files.length} fichier(s)`;
        if (!files.length) {
          grid.innerHTML = `<div class="empty"><b>Aucun fichier</b>${
            ui.source === "drive"
              ? "Aucun média sur le Drive connecté (connecte Google Drive dans Paramètres)."
              : "Les résultats (miniatures générées…) apparaîtront dans agent-os/output/."
          }</div>`;
          return;
        }
        grid.innerHTML =
          `<div class="file-grid">` +
          files
            .map((f, i) => {
              const prev =
                f.source === "drive"
                  ? f.type === "image"
                    ? `<img src="/api/drive/thumb?id=${esc(f.id)}" loading="lazy">`
                    : `<img src="/api/drive/thumb?id=${esc(f.id)}" loading="lazy" onerror="this.outerHTML='<span>▶</span>'">`
                  : f.type === "image"
                  ? `<img src="/media/${encodeURIComponent(f.rel)}" loading="lazy">`
                  : `<video src="/media/${encodeURIComponent(f.rel)}" preload="metadata" muted></video>`;
              return `<div class="file-card">
                <div class="prev" data-open="${i}" style="cursor:zoom-in">${prev}</div>
                <div class="info">
                  <div class="row between" style="gap:8px">
                    <div class="name grow" title="${esc(f.name)}">${esc(f.name)}</div>
                    <span class="badge ${f.type === "image" ? "accent" : "ok"}" style="font-size:9px;flex:none">${f.type}</span>
                  </div>
                  ${f.source === "drive" ? `<button class="btn btn-sm btn-ghost" style="width:100%;margin-top:7px" data-copy="${esc(f.directUrl)}">Copier l'URL directe</button>` : ""}
                </div>
              </div>`;
            })
            .join("") +
          `</div>`;
        grid.querySelectorAll("[data-copy]").forEach((b) =>
          b.addEventListener("click", () => {
            navigator.clipboard.writeText(b.dataset.copy);
            AgentOS.toast("URL directe copiée (uc?export=download)", "ok");
          })
        );
        grid.querySelectorAll("[data-open]").forEach((p) =>
          p.addEventListener("click", () => {
            const f = files[Number(p.dataset.open)];
            if (f.source === "drive") window.open(f.view, "_blank"); // aperçu Drive, pas de téléchargement
            else lightbox("/media/" + encodeURIComponent(f.rel), f.type === "video");
          })
        );
      } catch (e) {
        grid.innerHTML = `<div class="empty"><b>Erreur</b>${esc(e.message)}</div>`;
      }
    }

    el.querySelectorAll("#seg-src button").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#seg-src button").forEach((x) => x.classList.toggle("active", x === b));
        ui.source = b.dataset.v;
        ui.folder = "";
        load();
      })
    );
    el.querySelectorAll("#seg-type button").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#seg-type button").forEach((x) => x.classList.toggle("active", x === b));
        ui.type = b.dataset.v;
        load();
      })
    );
    el.querySelectorAll("#seg-scrap button").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#seg-scrap button").forEach((x) => x.classList.toggle("active", x === b));
        ui.scrap = b.dataset.sv === "1";
        if (!ui.scrap && ui.folder === "Scraping") ui.folder = "";
        load();
      })
    );
    let searchTimer;
    el.querySelector("#file-search").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { ui.q = e.target.value.trim().toLowerCase(); load(); }, 250);
    });
    load();
  },
});
