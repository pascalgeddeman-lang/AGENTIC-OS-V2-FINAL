/**
 * Mini-bibliothèque de graphiques SVG (aucune dépendance).
 * lineChart(el, rows, {key, color, label}) — courbe lissée avec aire, axes, tooltip.
 * donut(el, items) — répartition (dépenses).
 */
const Charts = (() => {
  const ACCENT = "oklch(0.72 0.185 40)";
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const JOURS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];

  /** "2026-07-26" → "Dim. 26 juil. 2026" (full) ou "26 juil." ; "2026-07" → "juil. 2026". */
  function frDate(s, full) {
    s = String(s);
    if (s.length === 7) {
      const [y, m] = s.split("-").map(Number);
      return MOIS[m - 1] ? `${MOIS[m - 1]} ${y}` : s;
    }
    if (s.length === 10) {
      const d = new Date(s + "T12:00:00"); // midi local : évite le décalage de jour lié au fuseau
      if (!isNaN(d))
        return full
          ? `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`
          : `${d.getDate()} ${MOIS[d.getMonth()]}`;
    }
    return s;
  }

  /** Pas « propre » (1/2/5 × 10^k) pour des graduations Y lisibles. */
  function niceStep(x) {
    if (!(x > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  /**
   * Courbe interactive façon YouTube Studio : survol n'importe où sur le graphe →
   * ligne de repère verticale + point sur la courbe + carte « Dim. 26 juil. 2026 / 6 ».
   * Une seule surface de capture (pas de zones mortes → aucun clignotement).
   */
  function lineChart(el, rows, opts = {}) {
    const key = opts.key || "views";
    const color = opts.color || ACCENT;
    const W = 720, H = 230, PAD = { l: 46, r: 14, t: 16, b: 30 };
    if (!rows || !rows.length) {
      el.innerHTML = `<div class="empty small" style="border:none">Aucune donnée sur cette période</div>`;
      return;
    }
    const n = rows.length;
    const vals = rows.map((r) => Number(r[key]) || 0);
    // Bornes Y « propres » (multiples d'un pas 1/2/5) — comme les axes de Studio
    const rawMax = Math.max(...vals, 1);
    const rawMin = Math.min(...vals, 0);
    const step = niceStep((rawMax - rawMin) / 3);
    const lo = Math.floor(rawMin / step) * step;
    const hi = Math.ceil(rawMax / step) * step;
    const span = hi - lo || 1;
    const plotW = W - PAD.l - PAD.r;
    const x = (i) => PAD.l + (i / Math.max(n - 1, 1)) * plotW;
    const y = (v) => H - PAD.b - ((v - lo) / span) * (H - PAD.t - PAD.b);

    let d = "";
    vals.forEach((v, i) => {
      const px = x(i), py = y(v);
      if (i === 0) d = `M${px},${py}`;
      else {
        const px0 = x(i - 1), py0 = y(vals[i - 1]);
        const cx = (px0 + px) / 2;
        d += ` C${cx},${py0} ${cx},${py} ${px},${py}`;
      }
    });
    const area = d + ` L${x(n - 1)},${H - PAD.b} L${x(0)},${H - PAD.b} Z`;

    let yTicks = "";
    for (let v = lo; v <= hi + step / 1e6; v += step) {
      yTicks += `<text x="${PAD.l - 8}" y="${y(v) + 3}" text-anchor="end" class="c-tick">${AgentOS.fmt(v)}</text>
                 <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" class="c-grid"/>`;
    }
    const stepX = Math.ceil(n / 6);
    const xTicks = rows
      .map((r, i) => {
        if (i % stepX && i !== n - 1) return "";
        // Le dernier label peut chevaucher l'avant-dernier : on saute celui d'avant si trop proche
        if (i !== n - 1 && n - 1 - i < stepX / 2) return "";
        return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="c-tick">${frDate(r.date)}</text>`;
      })
      .join("");

    const gid = "g" + Math.random().toString(36).slice(2, 8);
    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="c-svg" style="width:100%;height:auto">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <style>
          .c-tick{fill:oklch(0.6 0.01 255);font-size:9.5px;font-family:monospace}
          .c-grid{stroke:oklch(0.24 0.01 255);stroke-width:1}
          .c-catch{cursor:crosshair}
        </style>
        ${yTicks}${xTicks}
        <path d="${area}" fill="url(#${gid})"/>
        <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
        <g class="c-focus" style="display:none;pointer-events:none">
          <line class="c-guide" y1="${PAD.t}" y2="${H - PAD.b}" stroke="oklch(0.5 0.01 255)" stroke-width="1" stroke-dasharray="3 3"/>
          <circle class="c-dot" r="4.5" fill="${color}" stroke="oklch(0.15 0.01 255)" stroke-width="2.5"/>
          <g class="c-tip">
            <rect rx="8" fill="oklch(0.23 0.012 255)" stroke="oklch(0.34 0.012 255)"/>
            <text class="c-tip-d" fill="oklch(0.68 0.01 255)" font-size="10" font-family="monospace"></text>
            <text class="c-tip-v" fill="${color}" font-size="15" font-weight="700" font-family="monospace"></text>
          </g>
        </g>
        <rect class="c-catch" x="${PAD.l}" y="0" width="${plotW}" height="${H}" fill="transparent"/>
      </svg>`;

    const svg = el.querySelector("svg");
    const focus = svg.querySelector(".c-focus");
    const guide = svg.querySelector(".c-guide");
    const dot = svg.querySelector(".c-dot");
    const tipRect = svg.querySelector(".c-tip rect");
    const tipD = svg.querySelector(".c-tip-d");
    const tipV = svg.querySelector(".c-tip-v");
    const catcher = svg.querySelector(".c-catch");
    let cur = -1;

    function show(i) {
      if (i === cur) return;
      cur = i;
      const px = x(i), py = y(vals[i]);
      guide.setAttribute("x1", px);
      guide.setAttribute("x2", px);
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      const dTxt = frDate(rows[i].date, true);
      const vTxt = `${AgentOS.fmt(vals[i])}${opts.label ? " " + opts.label : ""}`;
      tipD.textContent = dTxt;
      tipV.textContent = vTxt;
      const tw = Math.max(dTxt.length * 6, vTxt.length * 8.8) + 22;
      const th = 44;
      let tx = px + 12;
      if (tx + tw > W - 4) tx = px - 12 - tw;
      tipRect.setAttribute("x", tx); tipRect.setAttribute("y", 6);
      tipRect.setAttribute("width", tw); tipRect.setAttribute("height", th);
      tipD.setAttribute("x", tx + 11); tipD.setAttribute("y", 23);
      tipV.setAttribute("x", tx + 11); tipV.setAttribute("y", 42);
      focus.style.display = "";
    }

    catcher.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const vx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.round(((vx - PAD.l) / plotW) * (n - 1));
      show(Math.max(0, Math.min(n - 1, i)));
    });
    catcher.addEventListener("pointerleave", () => {
      focus.style.display = "none";
      cur = -1;
    });
  }

  const PALETTE = [
    "oklch(0.72 0.185 40)", "oklch(0.72 0.14 155)", "oklch(0.78 0.14 85)",
    "oklch(0.68 0.14 250)", "oklch(0.68 0.16 320)", "oklch(0.6 0.02 255)",
  ];

  function donut(el, items, unitFmt) {
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total) {
      el.innerHTML = `<div class="empty small" style="border:none">Aucune dépense enregistrée</div>`;
      return;
    }
    const R = 54, C = 2 * Math.PI * R;
    let off = 0;
    const segs = items
      .map((it, i) => {
        const frac = it.value / total;
        const seg = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${PALETTE[i % PALETTE.length]}"
          stroke-width="18" stroke-dasharray="${frac * C} ${C}" stroke-dashoffset="${-off * C}"
          transform="rotate(-90 70 70)"/>`;
        off += frac;
        return seg;
      })
      .join("");
    const legend = items
      .map(
        (it, i) => `<div class="row small" style="gap:8px">
          <span style="width:10px;height:10px;border-radius:3px;background:${PALETTE[i % PALETTE.length]};flex:none"></span>
          <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${AgentOS.esc(it.label)}</span>
          <span class="mono muted">${unitFmt ? unitFmt(it.value) : AgentOS.fmt(it.value)}</span>
        </div>`
      )
      .join("");
    el.innerHTML = `
      <div class="row" style="gap:20px;align-items:center">
        <svg width="140" height="140" viewBox="0 0 140 140" style="flex:none">${segs}</svg>
        <div class="grow" style="display:grid;gap:6px">${legend}</div>
      </div>`;
  }

  return { lineChart, donut, PALETTE };
})();
