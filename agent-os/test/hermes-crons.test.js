const test = require("node:test");
const assert = require("node:assert/strict");

const { createHermesCronManager, runHermesCronAction } = require("../lib/hermes-crons");

test("list renvoie les jobs du planificateur Hermes", async () => {
  const calls = [];
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async (payload) => {
      calls.push(payload);
      return { success: true, jobs: [{ id: "job-1", name: "Rapport" }] };
    },
  });

  const jobs = await manager.list();

  assert.deepEqual(jobs, [{ id: "job-1", name: "Rapport" }]);
  assert.deepEqual(calls, [{ action: "list", include_disabled: true }]);
});

test("list normalise job_id et les aperçus du vrai planificateur", async () => {
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async () => ({
      success: true,
      jobs: [{ job_id: "real-1", schedule: "0 17 * * *", prompt_preview: "Reporting…" }],
    }),
  });

  const [job] = await manager.list();

  assert.equal(job.id, "real-1");
  assert.equal(job.schedule_display, "0 17 * * *");
  assert.equal(job.prompt, "Reporting…");
});

test("create crée un job Hermes dans le contexte Agentic Os", async () => {
  let received;
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async (payload) => {
      received = payload;
      return { success: true, job_id: "job-2", job: { id: "job-2", name: payload.name } };
    },
  });

  const job = await manager.create({
    name: "Rapport analytics",
    schedule: "0 17 * * *",
    prompt: "Analyse les chaînes.",
    deliver: "telegram",
  });

  assert.deepEqual(job, { id: "job-2", name: "Rapport analytics" });
  assert.deepEqual(received, {
    action: "create",
    name: "Rapport analytics",
    schedule: "0 17 * * *",
    prompt: "Analyse les chaînes.",
    deliver: "telegram",
    workdir: "E:/Agentic Os",
    attach_to_session: false,
  });
});

test("setEnabled reprend ou met en pause un job Hermes", async () => {
  const calls = [];
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async (payload) => {
      calls.push(payload);
      return { success: true, job: { id: payload.job_id } };
    },
  });

  await manager.setEnabled("job-3", true);
  await manager.setEnabled("job-3", false);

  assert.deepEqual(calls, [
    { action: "resume", job_id: "job-3" },
    { action: "pause", job_id: "job-3" },
  ]);
});

test("runNow déclenche immédiatement un job Hermes", async () => {
  let received;
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async (payload) => {
      received = payload;
      return { success: true, job: { id: payload.job_id } };
    },
  });

  await manager.runNow("job-4");

  assert.deepEqual(received, { action: "run", job_id: "job-4" });
});

test("runNow préfère l’exécuteur CLI durable injecté", async () => {
  let triggered;
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async () => { throw new Error("le pont Python ne doit pas être appelé"); },
    trigger: async (jobId) => {
      triggered = jobId;
      return { id: jobId, executed: true };
    },
  });

  const result = await manager.runNow("job-cli");

  assert.equal(triggered, "job-cli");
  assert.deepEqual(result, { id: "job-cli", executed: true });
});

test("remove supprime un job Hermes", async () => {
  let received;
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async (payload) => {
      received = payload;
      return { success: true, removed_job: { id: payload.job_id } };
    },
  });

  const removed = await manager.remove("job-5");

  assert.deepEqual(received, { action: "remove", job_id: "job-5" });
  assert.deepEqual(removed, { id: "job-5" });
});

test("create refuse un horaire ou une instruction vide", async () => {
  const manager = createHermesCronManager({
    projectRoot: "E:/Agentic Os",
    run: async () => { throw new Error("ne doit pas être appelé"); },
  });

  await assert.rejects(
    manager.create({ name: "Invalide", schedule: "", prompt: "" }),
    /horaire et une instruction/i
  );
});

test("runHermesCronAction interroge le vrai planificateur Hermes", async () => {
  const result = await runHermesCronAction({ action: "list" });

  assert.equal(result.success, true);
  assert.ok(Array.isArray(result.jobs));
});
