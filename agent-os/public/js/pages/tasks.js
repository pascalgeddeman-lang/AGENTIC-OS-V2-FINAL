/** Tâches (en cours / file / planifiées) + Cron Jobs (interrupteurs) + journal d'événements. */
AgentOS.register("tasks", {
  title: "Tâches & Cron",
  async render(el) {
    const { api, esc, ago } = AgentOS;

    el.innerHTML = `
      <div class="grid">
        <div class="grid grid-3">
          <div class="card"><h2>En cours</h2><div id="t-running"></div></div>
          <div class="card"><h2>File d'attente</h2><div id="t-queued"></div></div>
          <div class="card"><h2>Planifiées</h2><div id="t-scheduled"></div></div>
        </div>
        <div class="grid tasks-ops-grid">
          <div class="card tasks-ops-card">
            <h2>Cron Jobs
              <span class="h-actions"><button class="btn btn-sm btn-ghost" id="btn-tg-test" title="Tester Telegram">✈</button></span>
            </h2>
            <div id="crons"></div>
          </div>
          <div class="card tasks-ops-card">
            <h2>Cron Hermes</h2>
            <p class="tasks-verbal-note">Création verbale : Chat Hermès, ici ou Telegram.</p>
            <div id="hermes-crons"></div>
          </div>
          <div class="card tasks-ops-card">
            <h2>Journal des événements
              <span class="h-actions"><button class="btn btn-sm btn-ghost" id="btn-new-task" title="Ajouter une tâche manuelle">+</button></span>
            </h2>
            <div id="events"></div>
          </div>
        </div>
      </div>`;

    // Une tâche liée à un run est CLIQUABLE : elle ouvre le run dans sa machine.
    // Repli pour les tâches créées avant les champs machineId/runId : nom de machine mappé + runId lu dans le titre.
    const MACHINE_IDS = { "Time Travel": "timetravel", Linguistique: "linguistique", Musique: "musique" };
    const runRef = (t) => {
      const machineId = t.machineId || MACHINE_IDS[t.machine] || null;
      const runId = t.runId || ((/\brun (r[a-z0-9]+)/i.exec(t.title || "") || [])[1] || null);
      return machineId && runId ? `${machineId}:${runId}` : null;
    };
    const taskCard = (t, extra) => `
      <div class="stat mb ${runRef(t) ? "task-link" : ""}" style="padding:12px${runRef(t) ? ";cursor:pointer" : ""}" ${runRef(t) ? `data-open-run="${esc(runRef(t))}" title="Ouvrir le run"` : ""}>
        <div class="row between">
          <b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.title)}</b>
          <button class="btn btn-sm btn-ghost" data-del-task="${t.id}" title="Supprimer">✕</button>
        </div>
        <div class="small muted">${esc(t.desc || "")}</div>
        <div class="row wrap small" style="margin:6px 0">
          <span class="badge mut">${esc(t.machine || "sans machine")}</span>
          ${t.channel ? `<span class="badge accent">${esc(t.channel)}</span>` : ""}
          ${extra || ""}
        </div>
        ${t.status === "running"
          ? `<div class="small muted" style="margin-bottom:4px">${esc(t.step || "…")} — <span class="mono">${t.progress}%</span></div>
             <div class="progress"><div style="width:${t.progress}%"></div></div>`
          : ""}
      </div>`;

    // La carte « Planifiées » fusionne les tâches au statut scheduled ET les occurrences
    // du Calendrier (schedule.json) d'aujourd'hui et de demain — sans ça elle restait vide
    // alors que des publications étaient bien planifiées côté #/calendar.
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    async function loadPlanned() {
      try {
        const [sched, channels, machines] = await Promise.all([
          api("/api/schedule"), api("/api/channels"), api("/api/machines"),
        ]);
        const today = dayKey(new Date());
        const tomorrow = dayKey(new Date(Date.now() + 86400e3));
        return (sched.events || [])
          .filter((e) => e.status === "planned" && (e.date === today || e.date === tomorrow))
          .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
          .map((e) => ({
            when: `${e.date === today ? "Aujourd'hui" : "Demain"} ${e.time}`,
            machineName: (machines.find((m) => m.id === e.machineId) || {}).name || e.machineId,
            channelTitle: ((channels || []).find((c) => c.channelId === e.channelId) || {}).title || "",
            destination: e.destination,
          }));
      } catch {
        return [];
      }
    }
    const calCard = (e) => `
      <div class="stat mb task-link" style="padding:12px;cursor:pointer" data-open-calendar title="Ouvrir le calendrier">
        <div class="row between">
          <b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.machineName)}</b>
          <span class="badge warn">${esc(e.when)}</span>
        </div>
        <div class="row wrap small" style="margin-top:6px">
          ${e.channelTitle ? `<span class="badge accent">${esc(e.channelTitle)}</span>` : ""}
          <span class="badge mut">${e.destination === "stock" ? "→ stock" : "→ publication"}</span>
        </div>
      </div>`;

    let liveTimer = null;
    async function load() {
      if (!el.querySelector("#t-running")) return clearTimeout(liveTimer);
      const [t, planned] = await Promise.all([api("/api/tasks"), loadPlanned()]);
      // Avancement en temps réel tant qu'une tâche tourne (état local, pas d'API externe)
      clearTimeout(liveTimer);
      if (t.running.length) {
        liveTimer = setTimeout(() => {
          load();
          loadEvents();
        }, 3000);
      }
      // Pagination locale (5 par page) pour garder la page compacte
      const put = (sel, list, mapper, emptyMsg) => {
        const box = el.querySelector(sel);
        if (!list.length) return (box.innerHTML = `<div class="empty small">${emptyMsg}</div>`);
        const PP = 5;
        const pages = Math.ceil(list.length / PP);
        const page = Math.min(Number(box.dataset.page) || 0, pages - 1);
        box.dataset.page = page;
        box.innerHTML =
          list.slice(page * PP, page * PP + PP).map(mapper).join("") +
          (pages > 1
            ? `<div class="row" style="justify-content:center;gap:8px;margin-top:6px">
                <button class="mini-btn" data-pg="-1" ${page === 0 ? "disabled" : ""}>‹</button>
                <span class="small muted mono">${page + 1}/${pages}</span>
                <button class="mini-btn" data-pg="1" ${page >= pages - 1 ? "disabled" : ""}>›</button></div>`
            : "");
        box.querySelectorAll("[data-pg]").forEach((b) =>
          b.addEventListener("click", () => {
            box.dataset.page = page + Number(b.dataset.pg);
            load();
          })
        );
      };
      put("#t-running", t.running, (x) => taskCard(x), "Aucune tâche en cours");
      put("#t-queued", t.queued, (x) => taskCard(x), "File d'attente vide");
      const schedItems = [
        ...t.scheduled.map((x) =>
          taskCard(x, `<span class="badge warn">${x.scheduledAt ? new Date(x.scheduledAt).toLocaleString("fr-FR") : "—"}</span>`)),
        ...planned.map(calCard),
      ];
      put("#t-scheduled", schedItems, (html) => html, "Rien de planifié aujourd'hui ni demain");
      el.querySelectorAll("[data-open-calendar]").forEach((c) =>
        c.addEventListener("click", () => (location.hash = "#/calendar"))
      );
      el.querySelectorAll("[data-del-task]").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.stopPropagation();
          await api("/api/tasks/" + b.dataset.delTask, { method: "DELETE" });
          load();
        })
      );
      // Clic sur une tâche liée à un run → la machine s'ouvre et lance le wizard de ce run
      el.querySelectorAll("[data-open-run]").forEach((c) =>
        c.addEventListener("click", () => {
          const [machineId, runId] = c.dataset.openRun.split(":");
          try { sessionStorage.setItem(machineId + "-open-run", runId); } catch {}
          location.hash = "#/" + machineId;
        })
      );
    }

    async function loadCrons() {
      const crons = await api("/api/crons");
      el.querySelector("#crons").innerHTML = crons
        .map(
          (c) => `
        <div class="compact-list-item compact-hover" tabindex="0">
          <b class="cron-compact-title">${esc(c.label)}</b>
          <label class="switch" title="Activer ou désactiver"><input type="checkbox" data-cron="${c.id}" ${c.enabled ? "checked" : ""}><span class="track"></span></label>
          <div class="compact-tooltip" role="tooltip">${esc(c.desc || "Aucune description")}</div>
        </div>`
        )
        .join("");
      el.querySelectorAll("[data-cron]").forEach((sw) =>
        sw.addEventListener("change", async () => {
          await api("/api/crons/" + sw.dataset.cron + "/toggle", { method: "POST", body: { enabled: sw.checked } });
          AgentOS.toast(`Cron ${sw.checked ? "activé" : "désactivé"}`, "ok");
        })
      );
    }

    async function loadHermesCrons() {
      const box = el.querySelector("#hermes-crons");
      try {
        const jobs = await api("/api/hermes/crons");
        if (!jobs.length) {
          box.innerHTML = `<div class="empty small">Aucun cron Hermes. Demande sa création dans Chat Hermès, ici ou sur Telegram.</div>`;
          return;
        }
        box.innerHTML = jobs.map((job) => {
          const active = job.enabled !== false && job.state !== "paused" && job.state !== "completed";
          const deliver = Array.isArray(job.deliver) ? job.deliver.join(", ") : (job.deliver || "local");
          const nextRun = job.next_run_at ? new Date(job.next_run_at).toLocaleString("fr-FR") : "—";
          return `<div class="compact-list-item compact-hover" tabindex="0">
            <b class="cron-compact-title">${esc(job.name || "Cron Hermes")}</b>
            <label class="switch" title="Activer ou mettre en pause"><input type="checkbox" data-hcron-toggle="${esc(job.id)}" ${active ? "checked" : ""}><span class="track"></span></label>
            <button class="compact-delete" data-hcron-del="${esc(job.id)}" title="Supprimer" aria-label="Supprimer">🗑</button>
            <div class="compact-tooltip" role="tooltip">
              <b>${active ? "Actif" : esc(job.state || "En pause")}</b>
              <span>Horaire : ${esc(job.schedule_display || "—")}</span>
              <span>Prochaine exécution : ${esc(nextRun)}</span>
              <span>Destination : ${esc(deliver)}</span>
              <span>${esc(job.prompt || "Aucune instruction disponible")}</span>
            </div>
          </div>`;
        }).join("");
        box.querySelectorAll("[data-hcron-toggle]").forEach((sw) => sw.addEventListener("change", async () => {
          await api(`/api/hermes/crons/${sw.dataset.hcronToggle}/toggle`, { method: "POST", body: { enabled: sw.checked } });
          AgentOS.toast(`Cron Hermes ${sw.checked ? "activé" : "mis en pause"}`, "ok");
          loadHermesCrons();
        }));

        box.querySelectorAll("[data-hcron-del]").forEach((btn) => btn.addEventListener("click", async () => {
          if (!confirm("Supprimer définitivement ce cron Hermes ?")) return;
          await api(`/api/hermes/crons/${btn.dataset.hcronDel}`, { method: "DELETE" });
          AgentOS.toast("Cron Hermes supprimé", "ok");
          loadHermesCrons();
        }));
      } catch (error) {
        box.innerHTML = `<div class="empty small" style="color:var(--err)">${esc(error.message)}</div>`;
      }
    }

    let evtPage = 0;
    async function loadEvents() {
      const evts = await api("/api/events");
      const box = el.querySelector("#events");
      if (!evts.length) {
        box.innerHTML = `<div class="empty small">Aucun événement. Les machines émettront ici : vidéo terminée, publiée, rendu échoué.</div>`;
        return;
      }
      const PP = 6;
      const pages = Math.ceil(evts.length / PP);
      evtPage = Math.min(evtPage, pages - 1);
      // Un événement lié à un run est CLIQUABLE (mêmes replis que les tâches : nom machine + runId du titre)
      const evtRef = (p) => {
        if (!p) return null;
        const machineId = p.machineId || MACHINE_IDS[p.machine] || null;
        const runId = p.runId || ((/\brun (r[a-z0-9]+)/i.exec(p.title || "") || [])[1] || null);
        return machineId && runId ? `${machineId}:${runId}` : null;
      };
      box.innerHTML =
        evts
          .slice(evtPage * PP, evtPage * PP + PP)
          .map((e) => {
            const ref = evtRef(e.payload);
            const url = !ref && /^https?:\/\//.test(e.payload?.detail || "") ? e.payload.detail : null;
            const title = e.payload?.title || e.payload?.machine || e.event;
            return `<div class="compact-list-item compact-hover compact-event" tabindex="0" ${ref ? `data-open-run="${esc(ref)}"` : url ? `data-open-url="${esc(url)}"` : ""}>
              <span class="compact-event-meta">${ago(e.ts)}</span>
              <span class="badge ${/failed/.test(e.event) ? "err" : "ok"}">${esc(e.event)}</span>
              <b class="compact-event-title">${esc(title)}</b>
              ${ref ? '<span class="muted">↗</span>' : url ? '<span class="muted">▶</span>' : ""}
              <div class="compact-tooltip" role="tooltip">
                <b>${esc(e.event)}</b>
                <span>${esc(e.payload?.title || "Sans titre")}</span>
                ${e.payload?.machine ? `<span>Machine : ${esc(e.payload.machine)}</span>` : ""}
                ${e.payload?.detail ? `<span>${esc(e.payload.detail)}</span>` : ""}
              </div>
            </div>`;
          })
          .join("") +
        (pages > 1
          ? `<div class="row" style="justify-content:center;gap:8px;margin-top:6px">
              <button class="mini-btn" id="ev-prev" ${evtPage === 0 ? "disabled" : ""}>‹</button>
              <span class="small muted mono">${evtPage + 1}/${pages}</span>
              <button class="mini-btn" id="ev-next" ${evtPage >= pages - 1 ? "disabled" : ""}>›</button></div>`
          : "");
      box.querySelector("#ev-prev")?.addEventListener("click", () => { evtPage--; loadEvents(); });
      box.querySelector("#ev-next")?.addEventListener("click", () => { evtPage++; loadEvents(); });
      box.querySelectorAll("[data-open-run]").forEach((r) =>
        r.addEventListener("click", () => {
          const [machineId, runId] = r.dataset.openRun.split(":");
          try { sessionStorage.setItem(machineId + "-open-run", runId); } catch {}
          location.hash = "#/" + machineId;
        })
      );
      box.querySelectorAll("[data-open-url]").forEach((r) => r.addEventListener("click", () => window.open(r.dataset.openUrl, "_blank")));
    }

    el.querySelector("#btn-tg-test").addEventListener("click", async () => {
      const r = await api("/api/test/telegram", { method: "POST" });
      AgentOS.toast(r.ok ? "Message Telegram envoyé ✓" : "Échec : " + (r.error || "?"), r.ok ? "ok" : "err");
    });

    // Création manuelle (utile pour tester le pipeline tâches -> cron -> Telegram)
    el.querySelector("#btn-new-task").addEventListener("click", async () => {
      const title = prompt("Titre de la tâche ?");
      if (!title) return;
      await api("/api/tasks", {
        method: "POST",
        body: { title, status: "running", step: "Étape de test", progress: 25, machine: "Test manuel" },
      });
      load();
    });


    this.onLeave = () => clearTimeout(liveTimer);
    load();
    loadCrons();
    loadHermesCrons();
    loadEvents();
  },
});
