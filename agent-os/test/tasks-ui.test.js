const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sourcePath = path.join(__dirname, "..", "public", "js", "pages", "tasks.js");

function tasksSource() {
  return fs.readFileSync(sourcePath, "utf8");
}

test("la page réserve la création des crons Hermes aux demandes verbales", () => {
  const source = tasksSource();

  assert.doesNotMatch(source, /id="hermes-cron-form"/);
  assert.doesNotMatch(source, /Créer le cron Hermes/);
  assert.match(source, /Création verbale/);
});

test("Cron Jobs, Cron Hermes et le journal partagent trois colonnes compactes", () => {
  const source = tasksSource();

  assert.match(source, /class="grid tasks-ops-grid"/);
  assert.equal((source.match(/class="card tasks-ops-card"/g) || []).length, 3);
  assert.match(source, /cron-compact-title/);
  assert.match(source, /compact-tooltip/);
  assert.doesNotMatch(source, /data-hcron-run/);
});

test("le journal affiche six événements compacts avec détail au survol", () => {
  const source = tasksSource();

  assert.match(source, /const PP = 6;/);
  assert.match(source, /compact-event-title/);
  assert.match(source, /compact-event-meta/);
  assert.doesNotMatch(source, /<table class="tbl">/);
});
