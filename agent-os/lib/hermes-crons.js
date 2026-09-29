const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runHermes } = require("./hermes");

const PROJECT_ROOT = path.join(__dirname, "..");

// Python du venv Hermes selon l'installation native : Windows (%LOCALAPPDATA%\hermes)
// ou macOS/Linux (~/.hermes). HERMES_PYTHON force un chemin si l'install est ailleurs.
function findHermesPython() {
  const candidates = [];
  if (process.env.HERMES_PYTHON) candidates.push(process.env.HERMES_PYTHON);
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "hermes", "hermes-agent", "venv", "Scripts", "python.exe"));
  }
  const home = os.homedir();
  if (home) {
    candidates.push(path.join(home, ".hermes", "hermes-agent", "venv", "bin", "python"));
    candidates.push(path.join(home, ".hermes", "hermes-agent", "venv", "Scripts", "python.exe"));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function runHermesCronAction(payload) {
  const python = findHermesPython();
  if (!python) {
    return Promise.reject(new Error("Python du venv Hermes introuvable — Hermes est-il installe ?"));
  }
  const script = path.join(PROJECT_ROOT, "scripts", "hermes-cron-bridge.py");

  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], { cwd: PROJECT_ROOT, windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Le planificateur Hermes ne répond pas"));
    }, 120000);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code !== 0) return finish(reject, new Error(stderr.trim() || `Hermes cron : code ${code}`));
      try {
        finish(resolve, JSON.parse(stdout));
      } catch {
        finish(reject, new Error(`Réponse cron Hermes invalide : ${stdout.trim() || stderr.trim()}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

async function runHermesCronNow(jobId) {
  if (!/^[\w-]+$/.test(jobId || "")) throw new Error("Identifiant de cron Hermes invalide");
  const output = await runHermes(
    ["cron", "run", jobId, "--accept-hooks"],
    PROJECT_ROOT,
    30 * 60 * 1000
  );
  return { id: jobId, executed: true, output: String(output).trim() };
}

function ensureSuccess(result) {
  if (!result || result.success === false) {
    throw new Error(result?.error || "Erreur du planificateur Hermes");
  }
  return result;
}

function createHermesCronManager({ run, projectRoot, trigger }) {
  async function list() {
    const result = ensureSuccess(await run({ action: "list", include_disabled: true }));
    return (result.jobs || []).map((job) => ({
      ...job,
      ...(!job.id && job.job_id ? { id: job.job_id } : {}),
      ...(!job.schedule_display && job.schedule ? { schedule_display: job.schedule } : {}),
      ...(!job.prompt && job.prompt_preview ? { prompt: job.prompt_preview } : {}),
    }));
  }

  async function create(data) {
    if (!data.schedule?.trim() || !data.prompt?.trim()) {
      throw new Error("Le cron Hermes exige un horaire et une instruction");
    }
    const result = ensureSuccess(await run({
      action: "create",
      name: data.name,
      schedule: data.schedule,
      prompt: data.prompt,
      deliver: data.deliver || "local",
      workdir: projectRoot,
      attach_to_session: false,
    }));
    return result.job || { id: result.job_id, name: data.name };
  }

  async function setEnabled(jobId, enabled) {
    const result = ensureSuccess(await run({
      action: enabled ? "resume" : "pause",
      job_id: jobId,
    }));
    return result.job;
  }

  async function runNow(jobId) {
    if (trigger) return trigger(jobId);
    const result = ensureSuccess(await run({ action: "run", job_id: jobId }));
    return result.job;
  }

  async function remove(jobId) {
    const result = ensureSuccess(await run({ action: "remove", job_id: jobId }));
    return result.removed_job;
  }

  return { list, create, setEnabled, runNow, remove };
}

const manager = createHermesCronManager({
  run: runHermesCronAction,
  projectRoot: PROJECT_ROOT,
  trigger: runHermesCronNow,
});

module.exports = Object.assign(manager, {
  createHermesCronManager,
  findHermesPython,
  runHermesCronAction,
  runHermesCronNow,
});
