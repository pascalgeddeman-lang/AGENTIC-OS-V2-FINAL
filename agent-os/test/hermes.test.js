const test = require("node:test");
const assert = require("node:assert/strict");

const { createHermesBridge, mergeHermesStreams, parseHermesOutput, runHermes } = require("../lib/hermes");

test("parseHermesOutput extrait le session_id et conserve la réponse", () => {
  const parsed = parseHermesOutput("session_id: 20260728_160130_3f9a34\r\nBonjour depuis Hermes\r\n");

  assert.deepEqual(parsed, {
    sessionId: "20260728_160130_3f9a34",
    reply: "Bonjour depuis Hermes",
  });
});

test("mergeHermesStreams récupère le session_id écrit sur stderr", () => {
  const output = mergeHermesStreams("Réponse Web\r\n", "\r\nsession_id: session-stderr-1\r\n");

  assert.equal(output, "session_id: session-stderr-1\nRéponse Web\r\n");
});

test("sendMessage crée puis reprend la même session Hermes", async () => {
  let chats = [];
  const calls = [];
  const run = async (args, cwd) => {
    calls.push({ args, cwd });
    return calls.length === 1
      ? "session_id: session-web-1\nPremière réponse"
      : "session_id: session-web-1\nDeuxième réponse";
  };
  const bridge = createHermesBridge({
    run,
    projectRoot: "C:\\Agentic-Os",
    load: () => structuredClone(chats),
    save: (value) => { chats = structuredClone(value); },
  });
  const chat = bridge.createChat();

  await bridge.sendMessage(chat.id, "Premier message");
  await bridge.sendMessage(chat.id, "Deuxième message");

  assert.equal(bridge.getChat(chat.id).sessionId, "session-web-1");
  assert.equal(bridge.getChat(chat.id).messages.length, 4);
  assert.equal(calls[0].cwd, "C:\\Agentic-Os");
  assert.ok(calls[0].args.includes("--source"));
  assert.ok(calls[0].args.includes("agentic-os-web"));
  assert.ok(calls[0].args.includes("--yolo"));
  assert.equal(calls[0].args.includes("--resume"), false);
  assert.deepEqual(calls[1].args.slice(calls[1].args.indexOf("--resume"), calls[1].args.indexOf("--resume") + 2), [
    "--resume",
    "session-web-1",
  ]);
});

test("sendMessage persiste une erreur Hermes dans la conversation", async () => {
  let chats = [];
  const bridge = createHermesBridge({
    run: async () => { throw new Error("Hermes indisponible"); },
    projectRoot: "C:\\Agentic-Os",
    load: () => structuredClone(chats),
    save: (value) => { chats = structuredClone(value); },
  });
  const chat = bridge.createChat();

  await assert.rejects(() => bridge.sendMessage(chat.id, "Bonjour"), /Hermes indisponible/);

  assert.deepEqual(
    bridge.getChat(chat.id).messages.map(({ role, text }) => ({ role, text })),
    [
      { role: "user", text: "Bonjour" },
      { role: "error", text: "Hermes indisponible" },
    ]
  );
});

test("listChats résume les conversations et deleteChat les supprime", () => {
  let chats = [];
  const bridge = createHermesBridge({
    run: async () => "",
    projectRoot: "C:\\Agentic-Os",
    load: () => structuredClone(chats),
    save: (value) => { chats = structuredClone(value); },
  });
  const first = bridge.createChat("Premier");
  bridge.createChat("Second");

  assert.deepEqual(bridge.listChats().map(({ title, count }) => ({ title, count })), [
    { title: "Premier", count: 0 },
    { title: "Second", count: 0 },
  ]);

  bridge.deleteChat(first.id);
  assert.equal(bridge.getChat(first.id), null);
  assert.equal(bridge.listChats().length, 1);
});

test("checkStatus expose la version Hermes et l'état de connexion", async () => {
  const bridge = createHermesBridge({
    run: async (args) => {
      assert.deepEqual(args, ["--version"]);
      return "Hermes Agent 1.2.3\n";
    },
    projectRoot: "C:\\Agentic-Os",
    load: () => [],
    save: () => {},
  });

  const status = await bridge.checkStatus();

  assert.equal(status.connected, true);
  assert.equal(status.version, "Hermes Agent 1.2.3");
  assert.equal(status.lastError, null);
  assert.ok(status.lastCheck);
});

test("runHermes exécute le binaire local sans shell", async () => {
  const output = await runHermes(["--version"], __dirname, 30000);

  assert.match(output, /Hermes Agent/i);
});
