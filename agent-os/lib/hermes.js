const { spawn } = require("child_process");
const path = require("path");
const { readJSON, writeJSON } = require("./store");

const PROJECT_ROOT = path.join(__dirname, "..");

function mergeHermesStreams(stdout, stderr) {
  const sessionLine = String(stderr || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((line) => /^session_id:\s*\S+\s*$/.test(line));
  return sessionLine ? `${sessionLine}\n${stdout}` : stdout;
}

function runHermes(args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("hermes", args, {
      cwd: cwd || PROJECT_ROOT,
      shell: false,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`Hermes CLI : délai dépassé (${Math.round(timeoutMs / 1000)} s)`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(reject, error));
    child.on("close", (code) => {
      if (code !== 0) return finish(reject, new Error(stderr.trim() || stdout.trim() || `Hermes CLI : code ${code}`));
      finish(resolve, mergeHermesStreams(stdout, stderr));
    });
  });
}

function parseHermesOutput(raw) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  let sessionId = null;
  const replyLines = [];
  for (const line of lines) {
    const match = /^session_id:\s*(\S+)\s*$/.exec(line);
    if (match) sessionId = match[1];
    else replyLines.push(line);
  }
  return { sessionId, reply: replyLines.join("\n").trim() };
}

function createHermesBridge({ run, projectRoot, load, save }) {
  const state = {
    connected: false,
    version: null,
    lastCheck: null,
    lastError: null,
    busy: 0,
  };

  function status() {
    return { ...state };
  }

  async function checkStatus() {
    try {
      state.version = String(await run(["--version"], projectRoot, 30000)).trim().split(/\r?\n/)[0];
      state.connected = true;
      state.lastError = null;
    } catch (error) {
      state.connected = false;
      state.lastError = error.message;
    }
    state.lastCheck = new Date().toISOString();
    return status();
  }

  function listChats() {
    return load().map(({ id, title, createdAt, messages }) => ({
      id,
      title,
      createdAt,
      count: messages.length,
      last: messages.length ? messages[messages.length - 1].ts : null,
    }));
  }

  function getChat(id) {
    return load().find((chat) => chat.id === id) || null;
  }

  function createChat(title) {
    const chats = load();
    const chat = {
      id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title || "Nouvelle conversation",
      sessionId: null,
      createdAt: new Date().toISOString(),
      messages: [],
    };
    chats.push(chat);
    save(chats);
    return chat;
  }

  function deleteChat(id) {
    save(load().filter((chat) => chat.id !== id));
  }

  async function sendMessage(chatId, text) {
    const chats = load();
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) throw new Error("Conversation Hermes introuvable");

    chat.messages.push({ role: "user", text, ts: new Date().toISOString() });
    if (!chat.titleSet) {
      chat.title = text.slice(0, 48) + (text.length > 48 ? "…" : "");
      chat.titleSet = true;
    }
    save(chats);

    const args = [
      "chat",
      "-Q",
      "--source",
      "agentic-os-web",
      "--pass-session-id",
      "--yolo",
      "-q",
      text,
    ];
    if (chat.sessionId) args.push("--resume", chat.sessionId);

    try {
      const parsed = parseHermesOutput(await run(args, projectRoot, 30 * 60 * 1000));
      chat.sessionId = parsed.sessionId || chat.sessionId;
      chat.messages.push({ role: "assistant", text: parsed.reply || "(réponse vide)", ts: new Date().toISOString() });
      save(load().map((item) => (item.id === chat.id ? chat : item)));
      return { reply: parsed.reply, sessionId: chat.sessionId };
    } catch (error) {
      chat.messages.push({ role: "error", text: error.message, ts: new Date().toISOString() });
      save(load().map((item) => (item.id === chat.id ? chat : item)));
      throw error;
    }
  }

  return { checkStatus, createChat, deleteChat, getChat, listChats, sendMessage, status };
}

const bridge = createHermesBridge({
  run: runHermes,
  projectRoot: PROJECT_ROOT,
  load: () => readJSON("hermes-chats.json", []),
  save: (chats) => writeJSON("hermes-chats.json", chats),
});

bridge.warmup = bridge.checkStatus;

module.exports = Object.assign(bridge, { createHermesBridge, mergeHermesStreams, parseHermesOutput, runHermes });
