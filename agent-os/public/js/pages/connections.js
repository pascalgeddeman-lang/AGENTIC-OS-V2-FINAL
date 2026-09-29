/** Connexions : cartes Claude CLI + Hermès Agent (état, icône, reconnexion), puis vue synthétique des autres liens. */
AgentOS.register("connections", {
  title: "Connexions",
  async render(el) {
    const { api, esc, ago } = AgentOS;

    el.innerHTML = `
      <div class="grid grid-2">
        <div class="grid" style="align-content:start">
          <div class="card">
            <h2>Claude CLI</h2>
            <div id="claude-box"></div>
          </div>
          <div class="card">
            <h2>Hermès Agent</h2>
            <div id="hermes-box"></div>
          </div>
        </div>
        <div class="card">
          <h2>Autres connexions</h2>
          <div id="others"></div>
        </div>
      </div>`;

    // Les deux agents partagent la même carte : icône, état, reconnexion, chat.
    const AGENTS = [
      {
        box: "#claude-box", name: "Claude", icon: "img/claude.svg", chat: "#/chat",
        status: "/api/claude/status", reconnect: "/api/claude/reconnect",
        note: `Claude est lancé automatiquement au démarrage du serveur. En cas d'échec,
          vérifie que la commande <span class="mono">claude</span> fonctionne dans un terminal, puis reconnecte.`,
      },
      {
        box: "#hermes-box", name: "Hermès", icon: "img/hermes.svg", chat: "#/hermes",
        status: "/api/hermes/status", reconnect: "/api/hermes/reconnect",
        note: `La reconnexion relance la vérification du binaire <span class="mono">hermes</span>,
          sans toucher au gateway Telegram ni aux tâches en cours.`,
      },
    ];

    async function renderAgent(a, recheck) {
      const box = el.querySelector(a.box);
      box.innerHTML = `<span class="spin"></span>`;
      let s;
      try {
        s = recheck ? await api(a.reconnect, { method: "POST" }) : await api(a.status);
      } catch (e) {
        s = { connected: false, lastError: e.message };
      }
      box.innerHTML = `
        <div class="row" style="gap:14px;margin-bottom:14px">
          <img src="${a.icon}" alt="${a.name}" style="width:54px;height:54px;border-radius:14px;flex:none;
            border:2px solid ${s.connected ? "var(--ok)" : "var(--err)"}" />
          <div>
            <div style="font-size:16px;font-weight:700">${a.name} ${s.connected ? "est connecté" : "est déconnecté"}</div>
            <div class="small muted mono">${esc(s.version || s.lastError || "")}</div>
            <div class="small muted">Dernière vérification : ${ago(s.lastCheck)}${s.busy ? ` · ${s.busy} requête(s) en cours` : ""}</div>
          </div>
        </div>
        <div class="row">
          <button class="btn btn-accent" data-reconnect>⟳ Reconnecter ${a.name}</button>
          <a class="btn btn-ghost" href="${a.chat}">Ouvrir le chat</a>
        </div>
        <div class="small muted mt">${a.note}</div>`;
      box.querySelector("[data-reconnect]").addEventListener("click", () => renderAgent(a, true));
      AgentOS.refreshLeds();
    }

    async function renderOthers() {
      const box = el.querySelector("#others");
      try {
        const h = await api("/api/health");
        const row = (label, ok, detail, href) => `
          <div class="row between" style="padding:9px 0;border-bottom:1px solid var(--border-soft)">
            <div><b>${label}</b><div class="small muted">${esc(detail || "")}</div></div>
            <div class="row">
              <span class="badge ${ok ? "ok" : "err"}">${ok ? "connecté" : "déconnecté"}</span>
              ${href ? `<a class="btn btn-sm btn-ghost" href="${href}">Gérer</a>` : ""}
            </div>
          </div>`;
        box.innerHTML =
          row("Kie.ai (Miniature Creator)", h.kie.configured, h.kie.configured ? "Clé prête (coffre ou .env)" : "Clé manquante", "#/miniature") +
          row("Telegram", h.telegram.configured, h.telegram.configured ? "Bot + chat id prêts" : "Token ou chat id manquant dans le coffre", "#/settings") +
          row("Google Drive", h.drive.connected, h.drive.account || "Connexion OAuth requise", "#/settings") +
          row("Chaînes YouTube", h.channels > 0, `${h.channels} chaîne(s) connectée(s)`, "#/settings") +
          row("Quota YouTube", h.quota.limit > 0, `${h.quota.used}/${h.quota.limit} unités utilisées aujourd'hui`, "#/niche");
      } catch (e) {
        box.innerHTML = `<div class="empty small">${esc(e.message)}</div>`;
      }
    }

    AGENTS.forEach((a) => renderAgent(a, false));
    renderOthers();
  },
});
