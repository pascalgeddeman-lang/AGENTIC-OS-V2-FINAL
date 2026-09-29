const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "public", ...p), "utf8");

test("la page Connexions a une carte Hermès Agent avec reconnexion, sous la carte Claude", () => {
  const source = read("js", "pages", "connections.js");

  assert.match(source, /Hermès Agent/);
  assert.match(source, /\/api\/hermes\/status/);
  assert.match(source, /\/api\/hermes\/reconnect/);
  assert.match(source, /img\/hermes\.svg/);
  assert.match(source, /img\/claude\.svg/);
  assert.match(source, /Reconnecter \$\{a\.name\}/);
  assert.match(source, /AgentOS\.refreshLeds\(\)/);
});

test("la barre latérale porte les icônes des services, sans bouton de reconnexion", () => {
  const html = read("index.html");

  for (const icon of ["claude", "hermes", "kie", "drive"]) {
    assert.match(html, new RegExp(`img/${icon}\\.svg`));
  }
  assert.doesNotMatch(html, /btn-hermes-reconnect/);
});
