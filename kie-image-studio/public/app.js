/* ═══ Kie Image Studio — logique ═══ */

// ---- Config des outils (docs Kie.ai) ----
const TOOLS = [
  {
    id: "seedream",
    name: "Seedream 5 Lite",
    sub: "ByteDance",
    t2i: { model: "seedream/5-lite-text-to-image", promptMax: 3000 },
    i2i: { model: "seedream/5-lite-image-to-image", promptMax: 3000, imgField: "image_urls", maxImages: 14 },
  },
  {
    id: "nano",
    name: "Nano Banana 2 Lite",
    sub: "Google",
    t2i: { model: "nano-banana-2-lite", promptMax: 20000 },
    i2i: { model: "nano-banana-2-lite", promptMax: 20000, imgField: "image_urls", maxImages: 10 },
  },
  {
    id: "gpt",
    name: "GPT Image 2",
    sub: "OpenAI",
    t2i: { model: "gpt-image-2-text-to-image", promptMax: 20000 },
    i2i: { model: "gpt-image-2-image-to-image", promptMax: 20000, imgField: "input_urls", maxImages: 16 },
  },
  {
    id: "grok",
    name: "Grok Imagine",
    sub: "xAI",
    t2i: { model: "grok-imagine/text-to-image", promptMax: 5000 },
    i2i: { model: "grok-imagine/image-to-image", promptMax: 5000, imgField: "image_urls", maxImages: 1, promptOptional: true, noRatio: true },
  },
];

const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 15000;
const POLL_MS = 5000;
const EXPECTED_S = 110;

// ---- État ----
let mode = "t2i";
let format = "16:9";
let total = 4;
const alloc = { seedream: 0, nano: 0, gpt: 0, grok: 0 };
let files = [];
let jobs = [];
let jobSeq = 0;

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ═══════════ LOGIN ═══════════
async function checkAuth() {
  const r = await fetch("/api/me");
  if (r.ok) {
    $("#login-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await fetchDriveStatus();
    refreshGalleryCount();
  } else {
    $("#login-screen").classList.remove("hidden");
    $("#app").classList.add("hidden");
  }
}

// ═══════════ GOOGLE DRIVE ═══════════
const drive = { connected: false, clientUpload: false, configured: true };

async function fetchDriveStatus() {
  try {
    const j = await (await fetch("/api/drive-status")).json();
    drive.connected = !!j.connected;
    drive.clientUpload = !!j.client_upload;
    drive.configured = j.configured !== false;
  } catch {
    drive.connected = false;
  }
  const banner = $("#drive-banner");
  banner.classList.toggle("hidden", drive.connected);
  if (!drive.configured) {
    banner.querySelector("p").innerHTML =
      "<strong>Configuration incomplète.</strong> Ajoute GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans les variables d'environnement Vercel.";
  }
  refreshUI();
}

$("#drive-connect-btn").onclick = () => {
  location.href = "/api/drive-connect";
};

// Upload direct navigateur → Drive (Vercel limite le corps des fonctions à ~4,5 Mo)
async function uploadBrowserDirect(f, tok, folderId) {
  const blob = await (await fetch(f.dataUrl)).blob();
  let fileId = null;

  const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": blob.type || "image/png",
    },
    body: JSON.stringify({ name: f.name, parents: [folderId] }),
  });
  const loc = init.headers.get("Location") || init.headers.get("location");
  if (loc) {
    const up = await fetch(loc, { method: "PUT", headers: { "Content-Type": blob.type }, body: blob });
    fileId = (await up.json()).id;
  } else {
    // Repli multipart (fichiers < 5 Mo)
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ name: f.name, parents: [folderId] })], { type: "application/json" }));
    form.append("file", blob);
    const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
      body: form,
    });
    fileId = (await up.json()).id;
  }
  if (!fileId) throw new Error("Upload Drive échoué pour " + f.name);
  return "https://drive.google.com/uc?export=download&id=" + fileId;
}

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: $("#login-user").value.trim(), pass: $("#login-pass").value }),
  });
  if (r.ok) {
    $("#login-error").hidden = true;
    checkAuth();
  } else {
    $("#login-error").hidden = false;
  }
};

$("#logout-btn").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  location.reload();
};

// ═══════════ ALLOCATION ═══════════
function allocated() {
  return Object.values(alloc).reduce((a, b) => a + b, 0);
}

function renderAlloc() {
  const wrap = $("#alloc-list");
  wrap.innerHTML = "";
  TOOLS.forEach((t) => {
    const row = el("div", "alloc-row" + (alloc[t.id] > 0 ? " on" : ""));
    const conf = t[mode];
    const sub = mode === "i2i" ? `${t.sub} · ${conf.maxImages} img source max` : t.sub;
    row.appendChild(el("div", "a-name", `${t.name}<span class="a-sub">${sub}</span>`));
    const stepper = el("div", "stepper");
    const minus = el("button", "", "−");
    const num = el("span", "a-count", alloc[t.id]);
    const plus = el("button", "", "+");
    minus.onclick = () => { alloc[t.id] = Math.max(0, alloc[t.id] - 1); renderAlloc(); refreshUI(); };
    plus.onclick = () => {
      if (allocated() < total) { alloc[t.id]++; renderAlloc(); refreshUI(); }
    };
    stepper.append(minus, num, plus);
    row.appendChild(stepper);
    wrap.appendChild(row);
  });

  const remaining = total - allocated();
  const badge = $("#alloc-remaining");
  badge.textContent = remaining === 0 ? "✓ tout est réparti" : `${remaining} à répartir`;
  badge.classList.toggle("done", remaining === 0);
}

$("#total-minus").onclick = () => {
  total = Math.max(1, total - 1);
  $("#total-num").textContent = total;
  while (allocated() > total) {
    const id = TOOLS.map((t) => t.id).reverse().find((id) => alloc[id] > 0);
    if (!id) break;
    alloc[id]--;
  }
  renderAlloc();
  refreshUI();
};
$("#total-plus").onclick = () => {
  total = Math.min(40, total + 1);
  $("#total-num").textContent = total;
  renderAlloc();
  refreshUI();
};
$("#alloc-even").onclick = () => {
  const ids = TOOLS.map((t) => t.id);
  ids.forEach((id) => (alloc[id] = Math.floor(total / ids.length)));
  for (let i = 0; i < total % ids.length; i++) alloc[ids[i]]++;
  renderAlloc();
  refreshUI();
};

// ═══════════ MODE / FORMAT ═══════════
document.querySelectorAll("#mode-seg .seg").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#mode-seg .seg").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    mode = b.dataset.mode;
    renderAlloc();
    refreshUI();
  };
});
document.querySelectorAll("#format-seg .seg").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#format-seg .seg").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    format = b.dataset.format;
  };
});

// ═══════════ UPLOAD ═══════════
function renderThumbs() {
  const wrap = $("#thumbs");
  wrap.innerHTML = "";
  files.forEach((f, i) => {
    const t = el("div", "thumb");
    t.innerHTML = `<img src="${f.dataUrl}" alt="">${f.url ? '<span class="ok-badge">✓</span>' : ""}`;
    const rm = el("button", "rm", "✕");
    rm.onclick = () => { files.splice(i, 1); renderThumbs(); refreshUI(); };
    t.appendChild(rm);
    wrap.appendChild(t);
  });
}

function addFiles(fileList) {
  [...fileList].forEach((file) => {
    if (!/image\/(png|jpeg|webp)/.test(file.type)) return alert(`${file.name} : format non supporté (JPEG/PNG/WebP)`);
    if (file.size > 10 * 1024 * 1024) return alert(`${file.name} : dépasse 10 Mo`);
    const reader = new FileReader();
    reader.onload = () => {
      files.push({ name: file.name, dataUrl: reader.result, url: null });
      renderThumbs();
      refreshUI();
    };
    reader.readAsDataURL(file);
  });
}

async function uploadPending(onProgress) {
  const pending = files.filter((f) => !f.url);
  if (!pending.length) return;

  if (drive.clientUpload) {
    // Version web : upload direct navigateur → Drive
    onProgress?.("Connexion à Drive…");
    const tk = await (await fetch("/api/drive-token")).json();
    if (!tk.access_token) throw new Error(tk.msg || "Google Drive non connecté");
    let done = 0;
    for (const f of pending) {
      onProgress?.(`Upload Drive ${++done}/${pending.length}…`);
      f.url = await uploadBrowserDirect(f, tk.access_token, tk.sourcesFolderId);
      renderThumbs();
    }
    return;
  }

  // Version locale : le serveur uploade via Python/OAuth local
  let done = 0;
  for (const f of pending) {
    onProgress?.(`Upload Drive ${++done}/${pending.length}…`);
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Data: f.dataUrl, fileName: f.name }),
    });
    const j = await r.json().catch(() => ({}));
    const url = j?.data?.downloadUrl;
    if (!url) throw new Error(`Upload de « ${f.name} » échoué : ${j.msg || "réponse " + r.status}`);
    f.url = url;
    renderThumbs();
  }
}

const dz = $("#dropzone");
dz.onclick = () => $("#file-input").click();
$("#file-input").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("dragover"); };
dz.ondragleave = () => dz.classList.remove("dragover");
dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove("dragover"); addFiles(e.dataTransfer.files); };

// ═══════════ PAYLOADS ═══════════
function buildPayload(tool, jobMode, promptText, imageUrls) {
  const conf = tool[jobMode];
  const input = {};
  if (promptText) input.prompt = promptText.slice(0, conf.promptMax);
  if (!conf.noRatio) input.aspect_ratio = format;
  if (tool.id === "seedream") input.quality = "basic";
  if (jobMode === "i2i") input[conf.imgField] = imageUrls.slice(0, conf.maxImages);
  return { model: conf.model, input };
}

// ═══════════ CARTES ═══════════
function createJobCard(job) {
  $("#empty-create").classList.add("hidden");
  const card = el("div", "job-card");
  card.id = "job-" + job.id;
  card.innerHTML = `
    <div class="job-media">
      <div class="job-progress">
        <div class="bar"><div class="fill"></div></div>
        <div class="st">En attente…</div>
      </div>
    </div>
    <div class="job-foot">
      <div class="job-meta">
        <span class="tool-tag">${job.toolName}${job.isEdit ? " · retouche" : ""}</span>
        <span class="timer">0:00</span>
      </div>
      <div class="job-actions"></div>
      <div class="regen-box">
        <textarea placeholder="Ce que tu veux changer sur CETTE image…"></textarea>
        <span class="regen-note"></span>
        <button class="send">Lancer la retouche</button>
      </div>
    </div>`;
  $("#results").prepend(card);
  return card;
}

function setJobStatus(job, text) {
  const st = $(`#job-${job.id} .st`);
  if (st) st.textContent = text;
}

function startTimer(job) {
  job.t0 = Date.now();
  job.timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - job.t0) / 1000);
    const timer = $(`#job-${job.id} .timer`);
    if (timer) timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const fill = $(`#job-${job.id} .fill`);
    if (fill) fill.style.width = Math.min(93, 100 * (1 - Math.exp(-s / (EXPECTED_S / 2.3)))) + "%";
  }, 1000);
}

function stopTimers(job) {
  clearInterval(job.timerInt);
  clearInterval(job.pollInt);
}

// ═══════════ FIN DE JOB ═══════════
function jobDone(job, imageUrls) {
  stopTimers(job);
  job.resultUrl = imageUrls[0];
  const media = $(`#job-${job.id} .job-media`);
  media.innerHTML = `<img src="${job.resultUrl}" alt="Résultat" />`;
  media.querySelector("img").onclick = () => openLightbox(job.resultUrl);

  const actions = $(`#job-${job.id} .job-actions`);
  actions.innerHTML = "";
  const dl = el("a", "", "⬇");
  dl.title = "Télécharger";
  dl.href = "/api/download?url=" + encodeURIComponent(job.resultUrl);
  const regen = el("button", "", "↻ Relancer");
  regen.title = "Regénérer avec la même requête";
  regen.onclick = () => relaunchSame(job);
  const edit = el("button", "", "✏️ Modifier");
  edit.title = "Retoucher CETTE image (image → image)";
  edit.onclick = () => {
    const box = $(`#job-${job.id} .regen-box`);
    box.querySelector(".regen-note").textContent =
      "→ requête image → image sur l'image générée, avec " + job.toolName;
    box.classList.toggle("open");
    if (box.classList.contains("open")) box.querySelector("textarea").focus();
  };
  actions.append(dl, regen, edit);

  const box = $(`#job-${job.id} .regen-box`);
  box.querySelector(".send").onclick = () => {
    const instr = box.querySelector("textarea").value.trim();
    if (!instr) return;
    launchEdit(job, instr);
    box.classList.remove("open");
  };

  // Archive automatique dans la galerie
  fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskId: job.taskId,
      url: job.resultUrl,
      tool: job.toolName,
      mode: job.isEdit ? "retouche" : job.jobMode,
      prompt: job.payload.input.prompt || "",
      format: job.payload.input.aspect_ratio || "",
    }),
  }).then(refreshGalleryCount).catch(() => {});
}

function jobFailed(job, msg) {
  stopTimers(job);
  $(`#job-${job.id} .job-media`).innerHTML =
    `<div class="job-error"><strong>⚠ Échec</strong>${escapeHtml(msg || "Erreur inconnue")}</div>`;
  const actions = $(`#job-${job.id} .job-actions`);
  actions.innerHTML = "";
  const retry = el("button", "", "↻ Réessayer");
  retry.onclick = () => relaunchSame(job);
  actions.append(retry);
}

// ═══════════ ENVOI + POLLING ═══════════
async function submitJob(job) {
  setJobStatus(job, "Envoi de la requête…");
  try {
    const r = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job.payload),
    });
    const j = await r.json();
    if (j?.data?.taskId) {
      job.taskId = j.data.taskId;
      setJobStatus(job, "Génération en cours…");
      job.pollInt = setInterval(() => pollJob(job), POLL_MS);
    } else {
      jobFailed(job, j.msg || `Erreur HTTP ${r.status}`);
    }
  } catch (e) {
    jobFailed(job, e.message);
  }
}

async function pollJob(job) {
  try {
    const r = await fetch("/api/status?taskId=" + encodeURIComponent(job.taskId));
    const j = await r.json();
    const d = j?.data || {};
    const state = (d.state || "").toLowerCase();
    if (state === "success") {
      let urls = [];
      try { urls = JSON.parse(d.resultJson || "{}").resultUrls || []; } catch {}
      if (urls.length) jobDone(job, urls);
      else jobFailed(job, "Tâche terminée mais aucune image retournée.");
    } else if (state === "fail" || state === "failed") {
      jobFailed(job, d.failMsg || d.failCode || "Génération échouée.");
    } else if (state) {
      setJobStatus(job, state === "waiting" || state === "queuing" ? "Dans la file Kie…" : "Génération en cours…");
    }
  } catch { /* retentera au prochain poll */ }
}

function launchJob({ toolId, toolName, payload, jobMode, isEdit = false, batchIdx = 0 }) {
  const job = { id: ++jobSeq, toolId, toolName, payload, jobMode, isEdit };
  jobs.push(job);
  createJobCard(job);
  startTimer(job);
  if (batchIdx === 0) {
    submitJob(job);
  } else {
    setJobStatus(job, `Lot ${batchIdx + 1} — départ dans ~${batchIdx * 15}s…`);
    setTimeout(() => submitJob(job), batchIdx * BATCH_INTERVAL_MS);
  }
  return job;
}

// ↻ même requête, à l'identique
function relaunchSame(job) {
  launchJob({ toolId: job.toolId, toolName: job.toolName, payload: job.payload, jobMode: job.jobMode, isEdit: job.isEdit });
}

// ✏️ retouche : IMAGE → IMAGE sur l'image qui vient d'être générée
function launchEdit(job, instructions) {
  const tool = TOOLS.find((t) => t.id === job.toolId);
  const payload = buildPayload(tool, "i2i", instructions, [job.resultUrl]);
  // On garde le format de l'image d'origine si l'outil le gère
  if (!tool.i2i.noRatio && job.payload.input.aspect_ratio) {
    payload.input.aspect_ratio = job.payload.input.aspect_ratio;
  }
  launchJob({ toolId: job.toolId, toolName: job.toolName, payload, jobMode: "i2i", isEdit: true });
}

// ═══════════ GÉNÉRER ═══════════
async function generate() {
  const btn = $("#generate-btn");
  const prompt = $("#prompt").value.trim();
  const chosen = TOOLS.filter((t) => alloc[t.id] > 0);

  if (mode === "i2i" && files.length === 0) return alert("Ajoute au moins une image source.");
  if (mode === "i2i" && drive.clientUpload && !drive.connected)
    return alert("Connecte d'abord Google Drive (bouton en haut à gauche) pour l'image → image.");
  const promptRequired = mode === "t2i" || chosen.some((t) => !t[mode].promptOptional);
  if (promptRequired && prompt.length < 3) return alert("Écris un prompt (3 caractères minimum).");

  btn.disabled = true;
  const label = btn.textContent;
  try {
    if (mode === "i2i") await uploadPending((msg) => (btn.textContent = msg));
    btn.textContent = "Lancement…";

    const urls = files.map((f) => f.url);
    const list = [];
    chosen.forEach((t) => {
      for (let i = 0; i < alloc[t.id]; i++) {
        list.push({ toolId: t.id, toolName: t.name, payload: buildPayload(t, mode, prompt, urls), jobMode: mode });
      }
    });
    list.forEach((item, i) => launchJob({ ...item, batchIdx: Math.floor(i / BATCH_SIZE) }));
    switchView("create");
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    refreshUI();
  }
}
$("#generate-btn").onclick = generate;

// ═══════════ GALERIE ═══════════
async function refreshGalleryCount() {
  try {
    const j = await (await fetch("/api/gallery")).json();
    $("#gallery-count").textContent = j.items?.length ? `(${j.items.length})` : "";
  } catch {}
}

async function renderGallery() {
  const j = await (await fetch("/api/gallery")).json();
  const items = j.items || [];
  $("#empty-gallery").classList.toggle("hidden", items.length > 0);
  const wrap = $("#gallery");
  wrap.innerHTML = "";
  items.forEach((it) => {
    const src = it.src;
    const d = new Date(it.date);
    const dateStr = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) +
      " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const card = el("div", "job-card");
    card.innerHTML = `
      <div class="job-media"><img src="${src}" loading="lazy" alt=""></div>
      <div class="job-foot">
        <div class="job-meta">
          <span class="tool-tag">${escapeHtml(it.tool)}${it.mode === "retouche" ? " · retouche" : ""}</span>
          <span class="date-tag">${dateStr}</span>
        </div>
        ${it.prompt ? `<div class="g-prompt" title="${escapeHtml(it.prompt)}">${escapeHtml(it.prompt)}</div>` : ""}
        <div class="job-actions">
          <a href="${it.dl}" download title="Télécharger">⬇ Télécharger</a>
        </div>
      </div>`;
    card.querySelector("img").onclick = () => openLightbox(src);
    wrap.appendChild(card);
  });
}

// ═══════════ VUES ═══════════
function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $("#view-create").classList.toggle("hidden", view !== "create");
  $("#view-gallery").classList.toggle("hidden", view !== "gallery");
  $("#clear-btn").classList.toggle("hidden", view !== "create" || jobs.length === 0);
  if (view === "gallery") renderGallery();
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => switchView(t.dataset.view)));

$("#clear-btn").onclick = () => {
  jobs.forEach(stopTimers);
  jobs = [];
  $("#results").innerHTML = "";
  $("#empty-create").classList.remove("hidden");
  $("#clear-btn").classList.add("hidden");
};

// ═══════════ UI ═══════════
function refreshUI() {
  const isI2I = mode === "i2i";
  $("#upload-group").classList.toggle("hidden", !isI2I);

  const chosen = TOOLS.filter((t) => alloc[t.id] > 0);
  const remaining = total - allocated();
  const btn = $("#generate-btn");
  btn.textContent = total > 1 ? `Générer ${total} images` : "Générer";
  btn.disabled = remaining !== 0 || chosen.length === 0;

  $("#batch-note").textContent =
    total > BATCH_SIZE ? `${total} images : lots de ${BATCH_SIZE} espacés de 15 s (anti rate-limit).` : "";

  if (isI2I) {
    $("#upload-limits").textContent = chosen.length
      ? chosen.map((t) => `${t.name} : ${t.i2i.maxImages} img`).join(" · ")
      : "";
  }

  const maxes = chosen.map((t) => t[mode].promptMax);
  $("#prompt-hint").textContent = chosen.length
    ? `Limite la plus stricte : ${Math.min(...maxes)} caractères.` +
      (isI2I && alloc.grok > 0 ? " Grok i2i : prompt optionnel (« @image1 »)." : "")
    : "Répartis d'abord tes images sur les outils.";

  $("#clear-btn").classList.toggle("hidden", jobs.length === 0 || !$("#view-create") || $("#view-create").classList.contains("hidden"));
}

// ═══════════ LIGHTBOX ═══════════
function openLightbox(url) {
  const lb = el("div", "lightbox");
  lb.innerHTML = `<img src="${url}">`;
  lb.onclick = () => lb.remove();
  document.body.appendChild(lb);
}

// ═══════════ INIT ═══════════
renderAlloc();
refreshUI();
checkAuth();
