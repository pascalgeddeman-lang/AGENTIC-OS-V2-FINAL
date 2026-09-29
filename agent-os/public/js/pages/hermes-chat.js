/**
 * Chat Hermes Agent : même interface que Chat Claude, avec sessions Hermes
 * persistantes et exécution dans le projet Agentic Os.
 */
AgentOS.register("hermes", {
  title: "Chat Hermès",
  noPad: true,
  async render(el) {
    const { api } = AgentOS;
    el.innerHTML = `
      <div class="frame-wrap">
        <div class="frame-bar">
          <span id="hermes-badge" class="badge mut">vérification…</span>
          <span class="small muted grow" id="hermes-info"></span>
          <button class="btn btn-sm btn-ghost" id="btn-hermes-reco">⟳ Reconnecter</button>
        </div>
        <div style="flex:1;min-height:0;padding:16px">
          <div class="chat-layout" style="height:100%">
            <div class="chat-list"></div>
            <div class="chat-panel card" style="padding:14px">
              <div class="chat-msgs"></div>
              <div class="chat-input">
                <textarea class="grow"></textarea>
                <button class="btn btn-accent btn-send">Envoyer</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    async function status(recheck) {
      const badge = el.querySelector("#hermes-badge");
      const info = el.querySelector("#hermes-info");
      try {
        const current = recheck
          ? await api("/api/hermes/reconnect", { method: "POST" })
          : await api("/api/hermes/status");
        badge.className = "badge " + (current.connected ? "ok" : "err");
        badge.textContent = current.connected ? "● Hermes connecté" : "● Hermes déconnecté";
        info.textContent = current.connected
          ? `${current.version || ""} — agent principal : machines, second cerveau, analytics, niches, scrap et fichiers`
          : current.lastError || "";
        AgentOS.refreshLeds();
      } catch (error) {
        badge.className = "badge err";
        badge.textContent = "● Erreur";
        info.textContent = error.message;
      }
    }

    el.querySelector("#btn-hermes-reco").addEventListener("click", () => status(true));
    status(false);

    const widget = AgentOS.chatWidget(el, {
      kind: "hermes",
      apiBase: "/api/hermes/chats",
      agentName: "Hermes",
      emptyText: "Hermes travaille directement dans Agentic Os et peut utiliser ses outils, ses fichiers et ses APIs locales.",
      placeholder: "Donne une instruction à Hermes… Entrée pour envoyer",
    });
    widget.openLast();
  },
});
