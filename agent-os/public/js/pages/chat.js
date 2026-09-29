/**
 * Chat Claude CLI : conversations persistantes (mémoire --resume),
 * état de connexion + reconnexion. Widget réutilisé par le Second Cerveau.
 */
AgentOS.chatWidget = function (container, { kind, placeholder, apiBase = "/api/chats", agentName = "Claude", emptyText }) {
  const { api, esc, ago } = AgentOS;
  let current = null;
  let sending = false;

  const msgsEl = container.querySelector(".chat-msgs");
  const inputEl = container.querySelector("textarea");
  const sendBtn = container.querySelector(".btn-send");
  const listEl = container.querySelector(".chat-list"); // optionnel (le cerveau n'en a pas)

  function renderMsgs(chat) {
    if (!chat || !chat.messages.length) {
      const hint = emptyText || (kind === "curator"
        ? "Pose une question au curateur : il cherche dans le coffre et peut créer des notes."
        : `${agentName} a accès au projet : machines, APIs, fichiers. Demande-lui d'agir.`);
      msgsEl.innerHTML = `<div class="empty" style="border:none"><b>Nouvelle conversation</b>${hint}</div>`;
      return;
    }
    msgsEl.innerHTML = chat.messages
      .map((m) => {
        const cls = m.role === "user" ? "user" : m.role === "error" ? "error" : "assistant";
        const meta = m.role === "assistant" ? `<div class="meta">${ago(m.ts)}</div>` : "";
        return `<div class="msg ${cls}">${esc(m.text)}${meta}</div>`;
      })
      .join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  async function refreshList() {
    if (!listEl) return;
    const chats = await api(apiBase + "?kind=" + kind);
    // Plus récentes en premier
    chats.sort((a, b) => new Date(b.last || b.createdAt) - new Date(a.last || a.createdAt));
    listEl.innerHTML =
      `<button class="btn btn-ghost btn-sm" id="new-chat" style="margin-bottom:6px">+ Nouvelle conversation</button>` +
      chats
        .map(
          (c) => `<div class="chat-item ${current && current.id === c.id ? "active" : ""}" data-id="${c.id}">
            <div class="row between"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
            <button class="btn-del" data-del="${c.id}" title="Supprimer" style="background:none;border:none;color:var(--muted)">✕</button></div>
            <div class="small muted">${c.count} msg · ${ago(c.last || c.createdAt)}</div>
          </div>`
        )
        .join("");
    listEl.querySelector("#new-chat").addEventListener("click", async () => {
      current = await api(apiBase, { method: "POST", body: { kind } });
      renderMsgs(current);
      refreshList();
    });
    listEl.querySelectorAll(".chat-item").forEach((it) =>
      it.addEventListener("click", async (ev) => {
        if (ev.target.dataset.del) {
          await api(apiBase + "/" + ev.target.dataset.del, { method: "DELETE" });
          if (current && current.id === ev.target.dataset.del) { current = null; renderMsgs(null); }
          refreshList();
          return;
        }
        current = await api(apiBase + "/" + it.dataset.id);
        renderMsgs(current);
        refreshList();
      })
    );
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    if (!current) current = await api(apiBase, { method: "POST", body: { kind } });
    sending = true;
    inputEl.value = "";
    sendBtn.disabled = true;
    current.messages.push({ role: "user", text, ts: new Date().toISOString() });
    renderMsgs(current);
    msgsEl.insertAdjacentHTML("beforeend", `<div class="typing">${esc(agentName.toLowerCase())} réfléchit…</div>`);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    try {
      await api(apiBase + "/" + current.id + "/send", { method: "POST", body: { text } });
    } catch (e) {
      AgentOS.toast(e.message, "err");
    }
    current = await api(apiBase + "/" + current.id);
    renderMsgs(current);
    refreshList();
    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.placeholder = placeholder || "Message… (Entrée pour envoyer)";
  renderMsgs(null);
  refreshList();
  return {
    openLast: async () => {
      const chats = await api(apiBase + "?kind=" + kind);
      if (chats.length) {
        chats.sort((a, b) => new Date(b.last || b.createdAt) - new Date(a.last || a.createdAt));
        current = await api(apiBase + "/" + chats[0].id);
        renderMsgs(current);
        refreshList();
      }
    },
  };
};

AgentOS.register("chat", {
  title: "Chat Claude",
  noPad: true,
  async render(el) {
    const { api, esc } = AgentOS;
    el.innerHTML = `
      <div class="frame-wrap">
        <div class="frame-bar">
          <span id="claude-badge" class="badge mut">vérification…</span>
          <span class="small muted grow" id="claude-info"></span>
          <button class="btn btn-sm btn-ghost" id="btn-reco">⟳ Reconnecter</button>
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
      const badge = el.querySelector("#claude-badge");
      const info = el.querySelector("#claude-info");
      try {
        const s = recheck
          ? await api("/api/claude/reconnect", { method: "POST" })
          : await api("/api/claude/status");
        badge.className = "badge " + (s.connected ? "ok" : "err");
        badge.textContent = s.connected ? "● Claude connecté" : "● Claude déconnecté";
        info.textContent = s.connected
          ? `${s.version || ""} — référent plateforme : génération d'images, niche finder, Telegram, fichiers, tâches`
          : s.lastError || "";
        AgentOS.refreshLeds();
      } catch (e) {
        badge.className = "badge err";
        badge.textContent = "● Erreur";
        info.textContent = e.message;
      }
    }
    el.querySelector("#btn-reco").addEventListener("click", () => status(true));
    status(false);

    const widget = AgentOS.chatWidget(el, {
      kind: "chat",
      placeholder: "Demande une action (machines, APIs, fichiers)… Entrée pour envoyer",
    });
    widget.openLast();
  },
});
