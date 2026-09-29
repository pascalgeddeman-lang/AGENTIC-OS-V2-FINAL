/**
 * Architecture : organigramme HORIZONTAL compact, rangé en colonnes
 * (Serveur → Pages → Services → Machines → APIs externes).
 * Clic sur une case = ses connexions s'illuminent.
 */
AgentOS.register("architecture", {
  title: "Architecture",
  async render(el) {
    const NW = 178, NH = 38, GAP = 46; // taille de case + pas vertical
    const COLS = [60, 300, 540, 760, 1000]; // x de chaque colonne

    function col(c, items) {
      const totalH = items.length * GAP;
      return items.map((n, i) => ({ ...n, x: COLS[c], y: 210 - totalH / 2 + i * GAP }));
    }

    const nodes = [
      ...col(0, [
        { id: "server", t: "Serveur Agentic Os", s: "node · port 4100", hot: true },
        { id: "hermes", t: "Agent Hermès", s: "/api/agent/manifest", dashed: true, ext: true },
      ]),
      ...col(1, [
        { id: "dash", t: "Dashboard", s: "stats · dépenses" },
        { id: "tasks", t: "Tâches & Cron", s: "file · sauvetage" },
        { id: "chat", t: "Chat Claude", s: "CLI · mémoire" },
        { id: "brain", t: "Second Cerveau", s: "rings · curateur" },
        { id: "niche", t: "Niche Finder", s: "outliers ×999" },
        { id: "scrap", t: "Scrap-o-matic", s: "apify · vision" },
        { id: "mini", t: "Miniature Creator", s: "kie · output/" },
        { id: "filesvc", t: "Mes fichiers", s: "output/ + drive" },
      ]),
      ...col(2, [
        { id: "cache", t: "Cache disque", s: "refresh manuel" },
        { id: "vault", t: "Coffre-fort", s: "AES-256-GCM" },
        { id: "claude", t: "Claude CLI", s: "sessions --resume", hot: true },
        { id: "bank", t: "Banque de niches", s: "titres · tags · visions" },
        { id: "cron", t: "Moteur cron", s: "événements · sauvetage" },
        { id: "ffmpeg", t: "FFmpeg + Remotion", s: "clips · montage · CTA" },
      ]),
      ...col(3, [
        { id: "tt", t: "Time Travel", s: "vlog historique", hot: true },
        { id: "ling", t: "Linguistique", s: "listening · dialogues", hot: true },
        { id: "musique", t: "Musique (à venir)", s: "suno · waveform", dashed: true },
      ]),
      ...col(4, [
        { id: "yt", t: "YouTube API", s: "data v3 + analytics", ext: true },
        { id: "drive", t: "Google Drive", s: "oauth · uc?export", ext: true },
        { id: "kie", t: "Kie.ai", s: "images · suno", ext: true },
        { id: "fal", t: "FAL.ai", s: "elevenlabs · whisper · lipsync", ext: true },
        { id: "tg", t: "Telegram", s: "notifications", ext: true },
        { id: "chans", t: "Chaînes YouTube", s: "publication (upload)", ext: true },
      ]),
    ];
    const edges = [
      ["server", "dash"], ["server", "tasks"], ["server", "chat"], ["server", "brain"], ["server", "niche"], ["server", "scrap"], ["server", "mini"], ["server", "filesvc"],
      ["dash", "cache"], ["niche", "cache"], ["tasks", "cron"], ["chat", "claude"], ["brain", "claude"],
      ["mini", "vault"], ["niche", "vault"], ["dash", "vault"], ["scrap", "bank"],
      ["cache", "yt", true], ["vault", "kie"], ["vault", "fal"], ["cron", "tg", true],
      ["filesvc", "drive"], ["mini", "kie"], ["mini", "tg"], ["claude", "tg"],
      ["cron", "tt"], ["cron", "ling"], ["claude", "tt"], ["claude", "ling"], ["claude", "musique"],
      ["bank", "tt"], ["bank", "ling"], ["bank", "musique"], ["ffmpeg", "tt"], ["ffmpeg", "ling"], ["ffmpeg", "musique"],
      ["tt", "chans", true], ["ling", "chans", true], ["tt", "kie"], ["ling", "kie"], ["ling", "fal"], ["musique", "kie"],
      ["hermes", "server", true],
    ];
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const W = 1200, H = 430;

    // Liens horizontaux (sortie à droite -> entrée à gauche, ou saut de colonnes)
    const edgeSvg = edges
      .map(([a, b, hot]) => {
        let na = byId[a], nb = byId[b];
        if (na.x > nb.x) [na, nb] = [nb, na];
        const x1 = na.x + NW, y1 = na.y + NH / 2;
        const x2 = nb.x, y2 = nb.y + NH / 2;
        const mx = (x1 + x2) / 2;
        return `<path class="arch-edge ${hot ? "hot" : ""}" data-a="${a}" data-b="${b}"
          d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
      })
      .join("");
    const nodeSvg = nodes
      .map(
        (n) => `
        <g class="arch-n" data-id="${n.id}">
          <rect x="${n.x}" y="${n.y}" width="${NW}" height="${NH}" rx="9"
            class="arch-node" style="fill:${n.ext ? "var(--bg-deep)" : "var(--panel)"};
            stroke:${n.hot ? "var(--accent)" : "var(--border)"}"
            ${n.dashed ? 'stroke-dasharray="6 5"' : ""} stroke-width="${n.hot ? 1.6 : 1.2}"/>
          <text x="${n.x + 12}" y="${n.y + 16}" class="arch-label" style="font-size:11.5px"
            ${n.hot ? 'fill="oklch(0.74 0.185 42)"' : ""}>${n.t}</text>
          <text x="${n.x + 12}" y="${n.y + 29}" class="arch-sub">${n.s}</text>
        </g>`
      )
      .join("");
    const colLabels = ["SERVEUR", "PAGES", "SERVICES", "MACHINES", "APIS EXTERNES"]
      .map((l, i) => `<text x="${COLS[i] + NW / 2}" y="16" text-anchor="middle" class="arch-sub" style="letter-spacing:2px">${l}</text>`)
      .join("");

    el.innerHTML = `
      <div class="card">
        <h2>Organigramme du système <span class="h-actions small muted" id="arch-hint">Clique sur une case pour illuminer ses connexions</span></h2>
        <svg viewBox="0 0 ${W} ${H}" class="arch-svg" id="arch">${colLabels}${edgeSvg}${nodeSvg}</svg>
      </div>`;

    const svg = el.querySelector("#arch");
    let sel = null;
    function apply() {
      const neigh = new Set();
      if (sel) {
        neigh.add(sel);
        svg.querySelectorAll(".arch-edge").forEach((e) => {
          const lit = e.dataset.a === sel || e.dataset.b === sel;
          e.classList.toggle("lit", lit);
          e.classList.toggle("dim2", !lit);
          if (lit) { neigh.add(e.dataset.a); neigh.add(e.dataset.b); }
        });
      } else {
        svg.querySelectorAll(".arch-edge").forEach((e) => e.classList.remove("lit", "dim2"));
      }
      svg.querySelectorAll(".arch-n").forEach((g) => {
        g.classList.toggle("sel", sel === g.dataset.id);
        g.classList.toggle("dim2", !!sel && !neigh.has(g.dataset.id));
      });
      el.querySelector("#arch-hint").textContent = sel
        ? `${byId[sel].t} — ${[...neigh].length - 1} connexion(s). Clique ailleurs pour réinitialiser.`
        : "Clique sur une case pour illuminer ses connexions";
    }
    svg.querySelectorAll(".arch-n").forEach((g) =>
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        sel = sel === g.dataset.id ? null : g.dataset.id;
        apply();
      })
    );
    svg.addEventListener("click", () => { sel = null; apply(); });
  },
});
