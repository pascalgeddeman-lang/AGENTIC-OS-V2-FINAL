/** Paramètres : coffre-fort de credentials, clés YouTube, OAuth Drive & chaînes. */
AgentOS.register("settings", {
  title: "Paramètres",
  async render(el, params) {
    const { api, esc, ago } = AgentOS;

    // Retour d'OAuth (redirection serveur)
    if (params) {
      if (params.get("oauth") === "ok") AgentOS.toast("Compte Google connecté ✓", "ok");
      if (params.get("oauth") === "error") AgentOS.toast("OAuth : " + (params.get("msg") || "erreur"), "err");
    }

    el.innerHTML = `
      <div class="grid grid-2">
        <div class="card">
          <h2>Coffre-fort de credentials</h2>
          <div class="small muted mb">Chiffrées sur disque (AES-256-GCM). Jamais renvoyées en clair : seul un aperçu masqué s'affiche.</div>
          <div id="vault-fields"></div>
        </div>
        <div class="grid">
          <div class="card">
            <h2>Clés API YouTube <span class="h-actions small muted mono">+10 000 unités/jour par clé</span></h2>
            <div id="yt-keys"></div>
            <div class="row mt">
              <input type="text" id="ytk-label" placeholder="Libellé (ex : Compte 1)" style="max-width:160px">
              <input type="password" id="ytk-key" placeholder="AIza…" class="grow">
              <button class="btn btn-accent btn-sm" id="ytk-add">Ajouter</button>
            </div>
          </div>
          <div class="card">
            <h2>Clés Apify supplémentaires <span class="h-actions small muted mono">5 $/mois par clé · rotation auto</span></h2>
            <div class="small muted mb">La clé « Apify » du coffre est la clé principale. Ajoute ici d'autres comptes : le Scrap-o-matic bascule automatiquement quand une clé approche de son budget mensuel.</div>
            <div id="apify-keys"></div>
            <div class="row mt">
              <input type="text" id="apk-label" placeholder="Libellé (ex : Compte 2)" style="max-width:160px">
              <input type="password" id="apk-key" placeholder="apify_api_…" class="grow">
              <button class="btn btn-accent btn-sm" id="apk-add">Ajouter</button>
            </div>
          </div>
          <div class="card">
            <h2>Google Drive</h2>
            <div id="drive-box"></div>
          </div>
          <div class="card">
            <h2>Chaînes YouTube (OAuth)</h2>
            <div id="oauth-channels"></div>
            <button class="btn btn-accent mt" id="btn-connect-channel">+ Connecter une chaîne YouTube</button>
            <div class="small muted mt">Nécessite le Client ID / Secret Google du coffre, avec
            <span class="mono">http://localhost:4100/api/google/callback</span> en URI de redirection autorisée.</div>
          </div>
        </div>
      </div>`;

    // ----- Coffre -----
    async function loadVault() {
      const v = await api("/api/vault");
      el.querySelector("#vault-fields").innerHTML = v.fields
        .map(
          (f) => `
        <div class="row" style="margin-bottom:9px">
          <div style="width:180px;flex:none">
            <b class="small">${esc(f.label)}</b><br>
            <span class="small mono ${f.set ? "up" : "muted"}">${f.set ? esc(f.preview) : "non défini"}</span>
          </div>
          <input type="password" data-vault="${f.key}" placeholder="${f.set ? "Remplacer…" : "Coller la valeur…"}" class="grow">
          <button class="btn btn-sm" data-save="${f.key}">✓</button>
        </div>`
        )
        .join("");
      el.querySelectorAll("[data-save]").forEach((b) =>
        b.addEventListener("click", async () => {
          const input = el.querySelector(`[data-vault="${b.dataset.save}"]`);
          await api("/api/vault", { method: "POST", body: { key: b.dataset.save, value: input.value.trim() } });
          AgentOS.toast("Credential enregistrée dans le coffre", "ok");
          loadVault();
        })
      );

      const keysBox = el.querySelector("#yt-keys");
      keysBox.innerHTML = v.youtubeKeys.length
        ? v.youtubeKeys
            .map(
              (k) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border-soft)">
              <span><b class="small">${esc(k.label)}</b> <span class="mono small muted">${esc(k.preview || "")}</span></span>
              <button class="btn btn-sm btn-danger" data-delkey="${k.index}">✕</button></div>`
            )
            .join("")
        : `<div class="empty small">Aucune clé — le Niche Finder et les stats publiques en ont besoin.</div>`;
      el.querySelectorAll("[data-delkey]").forEach((b) =>
        b.addEventListener("click", async () => {
          await api("/api/vault/youtube-keys/" + b.dataset.delkey, { method: "DELETE" });
          loadVault();
        })
      );
    }

    // ----- Clés Apify supplémentaires -----
    async function loadApifyKeys() {
      const keys = await api("/api/vault/apify-keys");
      el.querySelector("#apify-keys").innerHTML = keys.length
        ? keys
            .map(
              (k) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--border-soft)">
              <span><b class="small">${esc(k.label)}</b> <span class="mono small muted">${esc(k.preview || "")}</span></span>
              <button class="btn btn-sm btn-danger" data-delapk="${k.index}">✕</button></div>`
            )
            .join("")
        : `<div class="empty small">Aucune clé supplémentaire.</div>`;
      el.querySelectorAll("[data-delapk]").forEach((b) =>
        b.addEventListener("click", async () => {
          await api("/api/vault/apify-keys/" + b.dataset.delapk, { method: "DELETE" });
          loadApifyKeys();
        })
      );
    }
    el.querySelector("#apk-add").addEventListener("click", async () => {
      const key = el.querySelector("#apk-key").value.trim();
      if (!key) return AgentOS.toast("Colle une clé Apify", "err");
      await api("/api/vault/apify-keys", {
        method: "POST",
        body: { label: el.querySelector("#apk-label").value.trim(), key },
      });
      el.querySelector("#apk-key").value = "";
      el.querySelector("#apk-label").value = "";
      AgentOS.toast("Clé Apify ajoutée (+5 $/mois de budget)", "ok");
      loadApifyKeys();
    });
    loadApifyKeys();

    el.querySelector("#ytk-add").addEventListener("click", async () => {
      const key = el.querySelector("#ytk-key").value.trim();
      if (!key) return AgentOS.toast("Colle une clé API", "err");
      await api("/api/vault/youtube-keys", {
        method: "POST",
        body: { label: el.querySelector("#ytk-label").value.trim(), key },
      });
      el.querySelector("#ytk-key").value = "";
      el.querySelector("#ytk-label").value = "";
      AgentOS.toast("Clé YouTube ajoutée (+10 000 unités/jour)", "ok");
      loadVault();
    });

    // ----- Drive -----
    async function loadDrive() {
      const box = el.querySelector("#drive-box");
      const h = await api("/api/health");
      const d = h.drive;
      box.innerHTML = d.connected
        ? `<div class="row between">
            <div><span class="badge ok">connecté</span> <b>${esc(d.account || "")}</b>
              <div class="small muted">Stockage + URLs directes <span class="mono">uc?export=download&id=…</span></div></div>
            <button class="btn btn-sm btn-danger" id="drive-off">Déconnecter</button>
          </div>`
        : `<div class="row between">
            <div><span class="badge err">non connecté</span>
              <div class="small muted">Connecte un compte pour stocker les fichiers et générer des liens directs.</div></div>
            <button class="btn btn-accent btn-sm" id="drive-on">Connecter Google Drive</button>
          </div>`;
      const on = el.querySelector("#drive-on");
      if (on)
        on.addEventListener("click", async () => {
          try {
            const r = await api("/api/google/auth?service=drive");
            location.href = r.url;
          } catch (e) {
            AgentOS.toast(e.message, "err");
          }
        });
      const off = el.querySelector("#drive-off");
      if (off)
        off.addEventListener("click", async () => {
          await api("/api/google/drive/disconnect", { method: "POST" });
          loadDrive();
        });
    }

    // ----- Chaînes OAuth -----
    async function loadChannels() {
      const chans = await api("/api/channels");
      el.querySelector("#oauth-channels").innerHTML = chans.length
        ? chans
            .map(
              (c) => `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--border-soft)">
            <span class="row">${AgentOS.channelAvatar(c, "width:26px;height:26px;border-radius:50%")}
              <b class="small">${esc(c.title)}</b></span>
            <span class="row">
              <span class="badge ${c.tokenOk ? "ok" : "err"}">${c.tokenOk ? "autorisée" : "token expiré"}</span>
              <button class="btn btn-sm btn-ghost" data-reco="${c.channelId}">Reconnecter</button>
            </span>
          </div>`
            )
            .join("")
        : `<div class="empty small">Aucune chaîne connectée.</div>`;
      el.querySelectorAll("[data-reco]").forEach((b) =>
        b.addEventListener("click", connectChannel)
      );
    }

    async function connectChannel() {
      try {
        const r = await api("/api/google/auth?service=youtube");
        location.href = r.url;
      } catch (e) {
        AgentOS.toast(e.message, "err");
      }
    }
    el.querySelector("#btn-connect-channel").addEventListener("click", connectChannel);

    loadVault();
    loadDrive();
    loadChannels();
  },
});
