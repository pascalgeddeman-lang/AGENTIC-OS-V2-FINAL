/**
 * Noyau SPA : routeur hash, appels API, politique de rafraîchissement,
 * puce de fraîcheur, LEDs système, toasts, helpers.
 *
 * Politique de cache (exigence produit) :
 * - jamais d'actualisation automatique en tâche de fond ;
 * - refresh=1 uniquement au rechargement réel de la page ou via « Actualiser ».
 */
const AgentOS = (() => {
  const pages = {}; // name -> {title, render(el), onLeave?}
  const state = {
    page: null,
    // Rechargement navigateur => la 1re salve d'appels force le refresh
    reloadRefresh: true,
    manualRefresh: false,
    lastFetchedAt: null,
  };

  // ---------- Helpers ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + " M";
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + " k";
    return String(Math.round(n * 100) / 100);
  };
  const ago = (iso) => {
    if (!iso) return "—";
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return `il y a ${Math.floor(s / 86400)} j`;
  };
  const dateFr = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  function toast(msg, kind) {
    const el = document.createElement("div");
    el.className = "toast " + (kind || "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  /** true si cet appel doit forcer un refetch côté serveur. */
  function shouldRefresh() {
    return state.reloadRefresh || state.manualRefresh;
  }

  async function api(path, opts = {}) {
    const url = new URL(path, location.origin);
    if (opts.cacheable && shouldRefresh()) url.searchParams.set("refresh", "1");
    const resp = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Erreur ${resp.status}`);
    if (data && data.fetchedAt) noteFreshness(data.fetchedAt);
    return data;
  }

  function noteFreshness(iso) {
    if (!state.lastFetchedAt || new Date(iso) > new Date(state.lastFetchedAt)) {
      state.lastFetchedAt = iso;
    }
    renderFreshness();
  }

  function renderFreshness() {
    const chipTxt = $("#fresh-text");
    const chip = $("#fresh-chip");
    if (!chipTxt) return;
    if (!state.lastFetchedAt) {
      chipTxt.textContent = "cache —";
      return;
    }
    const mins = (Date.now() - new Date(state.lastFetchedAt)) / 60000;
    chipTxt.textContent = "données " + ago(state.lastFetchedAt);
    chip.classList.toggle("stale", mins > 60);
  }
  setInterval(renderFreshness, 30000);

  // ---------- LEDs système ----------
  async function refreshLeds() {
    try {
      const h = await api("/api/health");
      setLed("led-claude", h.claude.connected);
      // Le bandeau suit le MÊME rafraîchissement que les LEDs : sans cela, un clic sur
      // « Reconnecter » corrigeait l'état et la pastille, mais le grand bandeau rouge restait
      // jusqu'à une minute — on croyait que le bouton ne servait à rien.
      if (typeof window.__majBandeauClaude === "function") window.__majBandeauClaude(h.claude);
      setLed("led-hermes", h.hermes && h.hermes.connected);
      setLed("led-kie", h.kie && h.kie.configured);
      setLed("led-drive", h.drive.connected);
      return h;
    } catch {
      setLed("led-claude", false);
      setLed("led-hermes", false);
      setLed("led-kie", false);
      setLed("led-drive", false);
    }
  }
  function setLed(id, on) {
    const led = $("#" + id + " .led");
    if (led) led.className = "led " + (on ? "on" : "off");
  }

  // ---------- Routeur ----------
  function register(name, def) {
    pages[name] = def;
  }

  async function navigate() {
    const hash = location.hash.replace(/^#\//, "") || "dashboard";
    const [name, qs] = hash.split("?");
    const def = pages[name] || pages.dashboard;
    if (state.page && pages[state.page] && pages[state.page].onLeave) {
      try { pages[state.page].onLeave(); } catch {}
    }
    state.page = name;
    // La Banque a son entrée dans Intelligence ; les wizards des machines restent sous Machines
    const navName = ["timetravel", "linguistique", "musique", "stickman", "bouddhisme", "drama", "crime"].includes(name) ? "machines" : name;
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === navName));
    $("#page-title").textContent = def.title;
    const view = $("#view");
    view.className = "view" + (def.noPad ? " no-pad" : "");
    view.innerHTML = `<div class="empty" style="border:none"><span class="spin"></span></div>`;
    try {
      await def.render(view, new URLSearchParams(qs || ""));
    } catch (e) {
      view.innerHTML = `<div class="empty"><b>Erreur de chargement</b>${esc(e.message)}</div>`;
    }
    // Après la première page rendue, la salve « rechargement » est consommée
    state.reloadRefresh = false;
    state.manualRefresh = false;
  }

  async function manualRefreshNow() {
    const btn = $("#btn-refresh");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span> Actualisation…`;
    state.manualRefresh = true;
    try {
      await navigate();
      toast("Données actualisées depuis les APIs", "ok");
    } finally {
      btn.disabled = false;
      btn.innerHTML = "⟳ Actualiser";
      refreshLeds();
    }
  }

  // ---------- Thème clair / sombre ----------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("agentos-theme", t);
    const btn = $("#btn-theme");
    if (btn) btn.textContent = t === "light" ? "☀" : "☾";
  }

  function boot() {
    window.addEventListener("hashchange", navigate);
    $("#btn-refresh").addEventListener("click", manualRefreshNow);
    applyTheme(localStorage.getItem("agentos-theme") || "dark");
    $("#btn-theme").addEventListener("click", () =>
      applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light")
    );
    refreshLeds();
    navigate();
  }

  return { register, boot, api, toast, refreshLeds, noteFreshness, $, $$, esc, fmt, ago, dateFr, state };
})();

// Bandeau « serveur périmé » : le code sur disque est plus récent que celui qui tourne.
// Sans lui, une route ajoutée renvoie 404 alors que l'interface l'affiche déjà.
(async function checkStale() {
  const show = () => {
    if (document.getElementById("serveur-perime")) return;
    const b = document.createElement("div");
    b.id = "serveur-perime";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#7c2d12;color:#fed7aa;" +
      "padding:9px 16px;font:600 13px/1.4 system-ui;text-align:center;border-bottom:1px solid #ea580c";
    b.innerHTML = "⚠ <b>Serveur périmé</b> — le code a changé depuis son démarrage. " +
      "Les nouvelles fonctions renverront 404. Redémarre&nbsp;: <code>cd agent-os &amp;&amp; npm start</code>" +
      "<span style='margin-left:14px;cursor:pointer;opacity:.8' onclick='this.parentNode.remove()'>✕</span>";
    document.body.appendChild(b);
  };
  // Bandeau « session Claude expirée ». Une LED rouge dans un coin ne se remarque pas : quand
  // Claude ne répond plus, AUCUNE machine ne peut générer, il faut le dire en toutes lettres.
  // La plateforme ne peut pas se reconnecter à la place de l'utilisateur (le jeton vit dans le
  // coffre du CLI) : le bandeau donne donc la commande exacte.
  const showAuth = (msg) => {
    const old = document.getElementById("claude-deconnecte");
    if (old) return;
    const b = document.createElement("div");
    b.id = "claude-deconnecte";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9998;background:#7f1d1d;color:#fecaca;" +
      "padding:9px 16px;font:600 13px/1.4 system-ui;text-align:center;border-bottom:1px solid #dc2626";
    b.innerHTML = "⛔ <b>Claude déconnecté</b> — aucune machine ne peut générer. " +
      (msg ? String(msg).replace(/[<>]/g, "") : "Ouvre un terminal, tape <code>claude</code> et reconnecte-toi.") +
      "<span style='margin-left:14px;cursor:pointer;opacity:.8' onclick='this.parentNode.remove()'>✕</span>";
    document.body.appendChild(b);
  };
  const hideAuth = () => { const b = document.getElementById("claude-deconnecte"); if (b) b.remove(); };

  // ⚠ On n'alarme QUE si le serveur a VRAIMENT constaté la panne (`checked`). Pendant les ~3 s
  //   du premier contrôle au démarrage, l'état est « inconnu » — un bandeau rouge à ce moment-là
  //   effrayait pour rien. Exposé globalement pour que « Reconnecter » l'efface IMMÉDIATEMENT.
  window.__majBandeauClaude = (c) => (c && c.checked && !c.connected ? showAuth(c.lastError) : hideAuth());

  // ⚠ AUTO-GUÉRISON. Un échec passager laissait l'état faux jusqu'au contrôle suivant, soit
  //   45 min : l'utilisateur voyait « déconnecté » alors que Claude répondait parfaitement.
  //   Quand le bandeau est affiché, on redemande un VRAI contrôle, au plus toutes les 5 min.
  let dernierEssai = 0;
  const tick = async () => {
    try {
      const h = await fetch("/api/health").then((r) => r.json());
      if (h && h.stale) show();
      if (!h || !h.claude) return;
      window.__majBandeauClaude(h.claude);
      if (h.claude.checked && !h.claude.connected && Date.now() - dernierEssai > 5 * 60 * 1000) {
        dernierEssai = Date.now();
        const s2 = await fetch("/api/claude/reconnect", { method: "POST" }).then((r) => r.json()).catch(() => null);
        if (s2) window.__majBandeauClaude(s2);
      }
    } catch {}
  };
  tick();
  setInterval(tick, 60000);
})();

/**
 * Avatar d'une chaîne YouTube — helper PARTAGÉ (channels, settings, dashboard).
 * Deux problèmes réels qu'il règle :
 *  - le navigateur met en cache l'ÉCHEC de chargement ; après une reconnexion l'icône restait
 *    cassée alors que l'URL répondait. Le cache-buster est la date de connexion : il ne change
 *    QUE si la chaîne a été reconnectée.
 *  - une image en échec affichait l'icône cassée du navigateur, ce qui ressemble à un bug.
 *    On retombe sur une pastille neutre.
 * ⚠ Trois pages en avaient besoin : le dupliquer aurait garanti trois divergences.
 */
AgentOS.channelAvatar = function (ch, opt) {
  const esc = AgentOS.esc;
  const o = typeof opt === "string" ? { style: opt } : (opt || {});
  const cls = o.cls || "";
  const style = o.style || "";
  const ph = `<span class="avatar ph ${cls}"${style ? ` style="${style}"` : ""}>▶</span>`;
  if (!ch || !ch.thumbnail) return ph;
  const v = encodeURIComponent(String(ch.connectedAt || "").slice(0, 19));
  const sep = ch.thumbnail.includes("?") ? "&" : "?";
  return `<img${cls ? ` class="${cls}"` : ""} src="${esc(ch.thumbnail)}${sep}v=${v}"` +
    ` referrerpolicy="no-referrer" loading="lazy"${style ? ` style="${style}"` : ""}` +
    ` onerror="this.outerHTML='${ph.replace(/"/g, "&quot;").replace(/'/g, "&#39;")}'">`;
};

