/** MACHINES — hub : chaque machine a sa carte. La Banque de Niches vit dans le menu Intelligence. */
AgentOS.register("machines", {
  title: "Machines",
  async render(el) {
    const { api, esc } = AgentOS;
    let ttCfg = null, ttRuns = [], ttStock = [];
    let lgCfg = null, lgRuns = [], lgStock = [];
    let muCfg = null, muRuns = [], muStock = [];
    let skCfg = null, skRuns = [], skStock = [];
    let bdCfg = null, bdRuns = [], bdStock = [];
    let drCfg = null, drRuns = [], drStock = [];
    let crCfg = null, crRuns = [], crStock = [];
    // ⚠ allSettled, PAS all : une route en échec ne doit jamais vider les badges des AUTRES
    // machines. C'est ce qui s'est produit le 01/09 — une seule forme inattendue a effacé
    // toute la page.
    {
      const noms = ["timetravel", "linguistique", "musique", "stickman", "bouddhisme", "drama", "crime"];
      const rs = await Promise.allSettled(
        noms.flatMap((n) => [api(`/api/machines/${n}`), api(`/api/machines/${n}/runs`), api(`/api/machines/${n}/stock`)])
      );
      const val = (k, def) => (rs[k] && rs[k].status === "fulfilled" ? rs[k].value : def);
      [ttCfg, ttRuns, ttStock, lgCfg, lgRuns, lgStock, muCfg, muRuns, muStock, skCfg, skRuns, skStock, bdCfg, bdRuns, bdStock, drCfg, drRuns, drStock, crCfg, crRuns, crStock] =
        noms.flatMap((n, k) => [val(k * 3, null), val(k * 3 + 1, []), val(k * 3 + 2, [])]);
      rs.forEach((r, k) => { if (r.status === "rejected") console.warn("Machine", noms[Math.floor(k / 3)], "indisponible :", r.reason?.message || r.reason); });
    }
    // La « troupe » n'a pas la même forme d'une machine à l'autre : tableau (Drama), objet à clé
    // `characters` (Stickman), `styles` (Musique)… Une seule forme inattendue faisait planter le
    // rendu ENTIER de la page — donc plus aucune machine à l'écran. Comptage défensif.
    const countOf = (cfg) => {
      const src = cfg.cast ?? cfg.musicLib ?? cfg.characters ?? cfg.styles ?? [];
      if (Array.isArray(src)) return src.length;
      if (src && typeof src === "object") {
        const inner = src.characters ?? src.entries ?? src.list ?? [];
        return Array.isArray(inner) ? inner.length : 0;
      }
      return 0;
    };
    const badges = (cfg, runs, stock, unit) => {
      // ⚠ « en cours » ne doit désigner QUE ce qui travaille vraiment (`*_running`).
      //   L'ancien calcul comptait tout ce qui n'était ni `done` ni `failed` : un run laissé
      //   en semi-manuel (`*_ready`, il attend une validation) ou annulé s'affichait comme
      //   « en cours de production ». Signalé par l'utilisateur, qui n'avait rien lancé.
      const st = (r) => String(r.status || "");
      const running = (runs || []).filter((r) => /_running$/.test(st(r))).length;
      const waiting = (runs || []).filter((r) => /_ready$/.test(st(r))).length;
      const enStock = (stock || []).filter((v) => !v.posted).length;
      const posted = (stock || []).length - enStock;
      return `<div class="row" style="gap:6px;margin-top:8px">
        ${cfg ? `<span class="badge accent">${countOf(cfg)} ${unit}</span>` : ""}
        <span class="badge ok">📦 ${enStock} en stock</span>
        ${posted ? `<span class="badge mut">📤 ${posted} postée(s)</span>` : ""}
        ${running ? `<span class="badge warn" title="Génération réellement en cours">⏳ ${running} en cours</span>` : ""}
        ${waiting ? `<span class="badge mut" title="Run en semi-manuel : il attend ta validation pour continuer">⏸ ${waiting} en attente</span>` : ""}
      </div>`;
    };
    el.innerHTML = `
      <div class="grid grid-3">
        <a class="bank-folder" href="#/timetravel" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🕰</div>
          <b>Time Travel</b>
          <div class="small muted" style="margin-top:4px">Vlogs de voyage dans le temps — Claude → GPT Image 2 → Grok 1.5 → Remotion</div>
          ${badges(ttCfg, ttRuns, ttStock, "personnage(s)")}
        </a>
        <a class="bank-folder" href="#/linguistique" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🗣</div>
          <b>Linguistique</b>
          <div class="small muted" style="margin-top:4px">Apprentissage de langue par l'écoute — Claude → images → ElevenLabs v3 → FFmpeg (lipsync · sous-titres Whisper)</div>
          ${badges(lgCfg, lgRuns, lgStock, "personnage(s)")}
        </a>
        <a class="bank-folder" href="#/musique" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🎵</div>
          <b>Musique</b>
          <div class="small muted" style="margin-top:4px">Vidéos musicales longues — Claude → visuel → Suno V5_5 (2 titres/req.) → FFmpeg (waveform · effets · CTA)</div>
          ${badges(muCfg, muRuns, muStock, "style(s)")}
        </a>
        <a class="bank-folder" href="#/stickman" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🧍</div>
          <b>Stickman</b>
          <div class="small muted" style="margin-top:4px">Documentaires anthropologiques en stickman — Claude → Inworld TTS + Whisper → casting → Nano Banana → FFmpeg (sous-titres · CTA)</div>
          ${badges(skCfg, skRuns, skStock, "personnage(s)")}
        </a>
        <a class="bank-folder" href="#/bouddhisme" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🪷</div>
          <b>Bouddhisme</b>
          <div class="small muted" style="margin-top:4px">Sagesse &amp; méditation — Claude → Inworld TTS + Whisper → Nano Banana → Suno → FFmpeg (Ken Burns · sous-titres · CTA)</div>
          ${badges(bdCfg, bdRuns, bdStock, "piste(s)")}
        </a>
        <a class="bank-folder" href="#/drama" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🎭</div>
          <b>Drama</b>
          <div class="small muted" style="margin-top:4px">Mélodrame de revanche africain — Claude → gpt-image-2 (i2i troupe) → Grok i2v → ElevenLabs + veed/lipsync → FFmpeg (musique de banque · CTA logo · sous-titres)</div>
          ${badges(drCfg, drRuns, drStock, "personnage(s)")}
        </a>
        <a class="bank-folder" href="#/crime" style="text-decoration:none;color:inherit">
          <div style="font-size:34px">🔎</div>
          <b>Crime</b>
          <div class="small muted" style="margin-top:4px">True crime francophone — Claude → ElevenLabs (voix unique) → HeyGen (intro avatar 60 s) → gpt-image-2 (illustrations sans visage) → FFmpeg (Ken Burns · sous-titres)</div>
          ${badges(crCfg, crRuns, crStock, "voix")}
        </a>
        <div class="bank-folder" style="opacity:.55;cursor:default">
          <div style="font-size:34px">＋</div>
          <b>Prochaine machine</b>
          <div class="small muted" style="margin-top:4px">Se construit avec Claude Code (skill machine-factory) : on lui donne vie, une interface et des paramètres.</div>
        </div>
      </div>`;
    // Depuis le hub, entrer dans une machine atterrit TOUJOURS sur l'onglet ⚙ Générer
    const TAB_KEYS = { "#/timetravel": "tt-tab", "#/linguistique": "ling-tab", "#/musique": "mus-tab", "#/stickman": "stk-tab", "#/bouddhisme": "boud-tab", "#/drama": "drama-tab", "#/crime": "crime-tab" };
    el.querySelectorAll("a.bank-folder").forEach((a) =>
      a.addEventListener("click", () => {
        const k = TAB_KEYS[a.getAttribute("href")];
        if (k) try { localStorage.setItem(k, "gen"); } catch {}
      })
    );
  },
});
