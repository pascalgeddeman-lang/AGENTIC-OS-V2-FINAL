/**
 * Second Cerveau : le viewer Graphify Rings (graphify-out/rings.html) en plein cadre,
 * exactement tel qu'il est généré par build_rings.py, + Agent Curateur (Claude CLI).
 */
AgentOS.register("brain", {
  title: "Second Cerveau",
  noPad: true,
  async render(el) {
    const chatOpen = localStorage.getItem("brain-chat-open") === "1";
    el.innerHTML = `
      <div class="brain-split ${chatOpen ? "" : "chat-closed"}" id="brain-split">
        <div class="frame-col">
          <div class="frame-bar">
            <span class="badge accent" id="brain-vault">Graphify Rings</span>
            <span class="muted" id="brain-stat" style="font-size:11px"></span>
            <span class="grow"></span>
            <button class="btn btn-sm btn-ghost" id="btn-graph-index" title="Relit le coffre et régénère le graphe">⟳ Réindexer</button>
            <button class="btn btn-sm btn-ghost" id="btn-graph-reload" title="Recharge rings.html (après une réindexation)">⟳ Recharger</button>
            <button class="btn btn-sm btn-ghost" id="btn-graph-full">⛶ Plein écran</button>
            <a class="btn btn-sm btn-ghost" href="/brain/graph/rings.html" target="_blank">Ouvrir ⧉</a>
            <button class="chat-toggle" id="btn-chat-toggle" title="Ouvrir / fermer l'Agent Curateur"></button>
          </div>
          <div class="rings-holder">
            <iframe id="brain-frame" src="/brain/graph/rings.html" allowfullscreen></iframe>
          </div>
        </div>
        <div class="brain-chat">
          <div class="brain-chat-head">
            <div class="row between">
              <span><b>Agent Curateur</b> <span class="badge mut">Claude CLI</span></span>
              <button class="chat-toggle" id="btn-chat-close" title="Fermer">❯</button>
            </div>
            <div class="muted" style="margin-top:3px">Cherche dans le coffre, répond, ajoute des notes.</div>
          </div>
          <div class="chat-msgs"></div>
          <div class="chat-input">
            <textarea class="grow"></textarea>
            <button class="btn btn-accent btn-send">➤</button>
          </div>
        </div>
      </div>`;

    // Chat repliable (fermé par défaut, état mémorisé)
    const split = el.querySelector("#brain-split");
    const toggleBtn = el.querySelector("#btn-chat-toggle");
    function syncChat() {
      const open = !split.classList.contains("chat-closed");
      toggleBtn.innerHTML = open ? "❯" : "❮ Curateur";
      localStorage.setItem("brain-chat-open", open ? "1" : "0");
    }
    function toggleChat() {
      split.classList.toggle("chat-closed");
      syncChat();
    }
    toggleBtn.addEventListener("click", toggleChat);
    el.querySelector("#btn-chat-close").addEventListener("click", toggleChat);
    syncChat();

    const frame = el.querySelector("#brain-frame");
    // Micro-correctif d'affichage injecté dans le viewer (même origine), sans toucher
    // au fichier généré : valeur compacte, libellés sur une ligne, slider rétrécissable.
    frame.addEventListener("load", () => {
      try {
        const doc = frame.contentDocument;
        const style = doc.createElement("style");
        style.textContent = [
          ".sliderRow{white-space:nowrap}",
          ".sliderRow .val{width:34px;flex:none;font-size:10px}",
          ".sliderRow input[type=range]{min-width:40px}",
        ].join("");
        doc.head.appendChild(style);
      } catch {}
    });
    el.querySelector("#btn-graph-reload").addEventListener("click", () => {
      frame.src = "/brain/graph/rings.html?ts=" + Date.now();
    });

    // Nom du coffre + volumétrie du graphe, lus du serveur (jamais codés en dur).
    async function syncInfo() {
      try {
        const i = await AgentOS.api("/api/brain/info");
        el.querySelector("#brain-vault").textContent = i.configured
          ? `Graphify Rings · coffre « ${i.vault} »`
          : "Graphify Rings · aucun coffre configuré";
        el.querySelector("#brain-stat").textContent = i.indexed
          ? `${i.notes} notes · ${i.links} liens · indexé ${AgentOS.ago(i.generatedAt)}`
          : "";
      } catch {}
    }
    syncInfo();

    el.querySelector("#btn-graph-index").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Indexation…";
      try {
        await AgentOS.api("/api/brain/reindex", { method: "POST" });
        frame.src = "/brain/graph/rings.html?ts=" + Date.now();
        await syncInfo();
        AgentOS.toast("Graphe réindexé depuis le coffre", "ok");
      } catch (err) {
        AgentOS.toast(err.message, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = "⟳ Réindexer";
      }
    });
    el.querySelector("#btn-graph-full").addEventListener("click", () => {
      (frame.requestFullscreen || frame.webkitRequestFullscreen || (() => {})).call(frame);
    });

    const widget = AgentOS.chatWidget(el.querySelector(".brain-chat"), {
      kind: "curator",
      placeholder: "Question au curateur… (Entrée pour envoyer)",
    });
    widget.openLast();
  },
});
