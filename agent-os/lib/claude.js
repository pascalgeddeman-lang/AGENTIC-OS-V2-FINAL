/**
 * Pont vers Claude Code CLI.
 * - Chaque conversation garde un session_id CLI (--resume) => mémoire persistante.
 * - Le prompt passe par stdin (aucun souci d'échappement Windows).
 * - status() vérifie que le binaire répond ; warmup() est lancé au démarrage du serveur.
 */
const { spawn } = require("child_process");
const path = require("path");
const { readJSON, writeJSON } = require("./store");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
// Coffre Obsidian du « second cerveau » (optionnel) : définir SECOND_BRAIN_DIR dans
// l'environnement ou le .env racine. Sans coffre, le curateur travaille dans le projet.
const VAULT_DIR = process.env.SECOND_BRAIN_DIR || null;

const state = {
  connected: false,
  version: null,
  lastCheck: null,
  lastError: null,
  busy: 0,
  authFails: 0,        // échecs d'authentification CONSÉCUTIFS (il en faut 2 pour alarmer)
  // ⚠ « pas encore vérifié » N'EST PAS « déconnecté ». Le premier contrôle prend ~3 s (vrai
  //   appel) et le serveur accepte des requêtes avant sa fin : sans ce drapeau, toute page
  //   ouverte dans cette fenêtre affichait un bandeau d'alarme alors que tout allait bien.
  checked: false,
};

/** Signature d'une session OAuth morte : le CLI répond, mais refuse d'appeler l'API. */
// ⚠ Motifs ÉTROITS et ancrés. Une première version contenait un `401` nu : il déclenchait sur
//   « Voici 401 mots », « coût 0.401 $ », un id de session contenant 401… La plateforme
//   déclarait alors la session morte alors qu'elle répondait. Un garde-fou trop large fait plus
//   de dégâts que la panne qu'il surveille.
const OAUTH_DEAD = new RegExp([
  "OAuth session expired",
  "could not be refreshed",
  "not authenticated",
  "authentication failed",
  "please run [`'\"]?claude(?: login)?[`'\"]?",
  "invalid_grant",
  "\\b(?:HTTP |status[: ]+)401\\b",
  "401 Unauthorized",
].join("|"), "i");
const isAuthError = (msg) => OAUTH_DEAD.test(String(msg || ""));
/** Message ACTIONNABLE : l'utilisateur doit se reconnecter lui-même, la plateforme ne peut pas. */
const AUTH_HELP = "Session Claude expirée. Ouvre un terminal, tape « claude » et reconnecte-toi, " +
  "puis reviens : la plateforme repart sans redémarrage.";

function runClaude(args, stdinText, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: cwd || PROJECT_ROOT,
      shell: true,
      windowsHide: true,
      env: process.env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude CLI : délai dépassé (${Math.round(timeoutMs / 1000)} s)`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const both = (out + " " + err).trim();
      // ⚠ Le CLI sort parfois en code 0 en écrivant l'erreur d'authentification sur stdout :
      //   sans ce test, on renvoie le message d'erreur comme s'il s'agissait d'une réponse.
      if (isAuthError(both)) {
        // ⚠ On NE bascule PAS l'état global sur un seul échec. Un incident passager ferait
        //   sinon clignoter le bandeau « Claude déconnecté » en pleine génération, et l'état
        //   resterait faux jusqu'au contrôle suivant (45 min plus tard). Il faut DEUX échecs
        //   consécutifs, et le moindre succès remet le compteur à zéro.
        state.authFails = (state.authFails || 0) + 1;
        if (state.authFails >= 2) { state.connected = false; state.lastError = AUTH_HELP; }
        return reject(new Error(AUTH_HELP));
      }
      state.authFails = 0;                       // un appel qui passe efface le doute
      if (code !== 0 && !out.trim()) return reject(new Error(err.trim() || `Claude CLI : code ${code}`));
      resolve(out);
    });
    if (stdinText != null) child.stdin.write(stdinText);
    child.stdin.end();
  });
}

/**
 * ⚠ `claude --version` NE TESTE PAS l'authentification : il répond parfaitement avec une
 *   session OAuth morte. La plateforme s'affichait donc « connectée » pendant que toute
 *   génération échouait. On fait maintenant un VRAI appel minimal (quelques jetons).
 */
async function checkStatus() {
  try {
    state.version = (await runClaude(["--version"], null, PROJECT_ROOT, 30000)).trim();
  } catch (e) {
    state.connected = false; state.version = null;
    state.lastError = `Claude CLI introuvable ou muet : ${e.message}`;
    state.lastCheck = new Date().toISOString();
    state.checked = true;
    return status();
  }
  try {
    await runClaude(["-p"], "Réponds uniquement par : OK", PROJECT_ROOT, 60000);
    state.connected = true;
    state.lastError = null;
  } catch (e) {
    state.connected = false;
    state.lastError = isAuthError(e.message) ? AUTH_HELP : e.message;
  }
  state.lastCheck = new Date().toISOString();
  state.checked = true;
  return status();
}

/**
 * MAINTIEN DE SESSION. On ne peut pas rafraîchir un jeton nous-mêmes — il vit dans le coffre du
 * CLI. Mais un appel réel périodique fait EXERCER au CLI son propre rafraîchissement TANT QUE le
 * jeton de renouvellement est encore valide, ce qui évite la plupart des expirations.
 * Coût : quelques jetons par heure.
 */
function startKeepAlive(minutes = 45) {
  const ms = Math.max(5, minutes) * 60 * 1000;
  // ⚠ PAS de `unref()`. Le serveur vit tant qu'il écoute ; un minuteur détaché n'apporte rien
  //   et rend son déclenchement moins fiable. Constaté : plus de 2 h sans contrôle alors que
  //   l'intervalle est de 45 min — l'état est resté faux pendant tout ce temps.
  return setInterval(() => { checkStatus().catch(() => {}); }, ms);
}

function status() {
  return { ...state };
}

/** Lancé au démarrage du serveur : Claude démarre en même temps que la plateforme. */
async function warmup() {
  await checkStatus();
  return status();
}

// --- Conversations (mémoire) ---
// data/chats.json : [{id, kind: "chat"|"curator", title, sessionId, createdAt, messages:[{role,text,ts,cost}]}]

function loadChats() {
  return readJSON("chats.json", []);
}

function saveChats(chats) {
  writeJSON("chats.json", chats);
}

function listChats(kind) {
  return loadChats()
    .filter((c) => c.kind === kind)
    .map(({ id, title, createdAt, messages }) => ({
      id,
      title,
      createdAt,
      count: messages.length,
      last: messages.length ? messages[messages.length - 1].ts : null,
    }));
}

function getChat(id) {
  return loadChats().find((c) => c.id === id) || null;
}

function createChat(kind, title) {
  const chats = loadChats();
  const chat = {
    id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind,
    title: title || (kind === "curator" ? "Curateur" : "Nouvelle conversation"),
    sessionId: null,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  chats.push(chat);
  saveChats(chats);
  return chat;
}

function deleteChat(id) {
  saveChats(loadChats().filter((c) => c.id !== id));
}

// Documentation de la plateforme injectée aux deux agents : Claude est le référent d'Agentic Os
const PLATFORM_DOC = [
  "[PLATEFORME AGENT OS — http://localhost:4100]",
  "Tu es le référent de la plateforme Agentic Os. Tu peux AGIR via son API locale (utilise curl) :",
  '- Générer une image (Miniature Creator, Kie.ai) : curl -s -X POST http://localhost:4100/api/studio/generate -H "Content-Type: application/json" -d \'{"tool":"nano|gpt|seedream|grok","mode":"t2i","prompt":"...","aspect":"16:9","count":1}\' — i2i : ajouter "mode":"i2i","sources":[{"rel":"<chemin relatif Mes fichiers>"}]. Suivi : GET /api/studio/jobs. Résultats dans agent-os/output/miniatures/.',
  '- Recherche de niches YouTube : POST /api/niche/search {"keywords":["..."],"minViews":...} puis GET /api/niche/job/<id> (nécessite des clés YouTube dans le coffre).',
  '- Notification Telegram : POST /api/notify {"text":"..."}.',
  "- Tâches : GET /api/tasks, POST /api/tasks, PATCH /api/tasks/<id> (status done/published/failed => alerte Telegram).",
  "- Fichiers : GET /api/files?source=local|drive&type=image|video. Chaînes/stats : GET /api/channels/overview, GET /api/stats/series?channel=all&period=month.",
  "- État système : GET /api/health. Crons : GET /api/crons.",
  VAULT_DIR
    ? "Second cerveau : coffre Obsidian « " + path.basename(VAULT_DIR) + " » (" + VAULT_DIR + "). Après avoir créé ou modifié des notes, réindexe le graphe : curl -s -X POST http://localhost:4100/api/brain/reindex"
    : "Second cerveau : non configuré (définir SECOND_BRAIN_DIR dans le .env racine).",
  "RÈGLES IMPORTANTES :",
  "1. La plateforme envoie DÉJÀ une alerte Telegram automatique à la fin de chaque génération/tâche.",
  "   N'envoie JAMAIS de notification Telegram toi-même, ni au début ni à la fin, sauf si l'utilisateur le demande explicitement.",
  "2. Si tu lances un job asynchrone (génération d'image, recherche niche), ATTENDS SA FIN DANS LA MÊME RÉPONSE :",
  "   boucle de polling (ex : `for i in $(seq 1 60); do sleep 10; curl -s ...; done` en vérifiant le status),",
  "   puis rends le résultat final. Ne réponds JAMAIS « j'attends le résultat » : tu ne peux pas envoyer de message plus tard.",
  "3. Une génération d'image est une IMAGE — ne parle pas de « vidéo » dans ce cas.",
  "Sois RAPIDE : 1-2 commandes ciblées, pas d'exploration longue. Réponds en français, concis.",
].join("\n");

const CURATOR_PREFIX = [
  "[RÔLE — AGENT CURATEUR DU SECOND CERVEAU]",
  VAULT_DIR
    ? "Tu es le curateur du coffre Obsidian « " + path.basename(VAULT_DIR) + " » (répertoire courant)."
    : "Tu es le curateur du second cerveau. ATTENTION : aucun coffre n'est configuré (SECOND_BRAIN_DIR absent du .env) — dis-le à l'utilisateur avant toute autre chose.",
  "Tu peux : chercher dans les notes et le graphe graphify-out/graph.json, répondre aux questions,",
  "et créer/mettre à jour des notes .md au format Obsidian (frontmatter, wikilinks [[...]], tags).",
  "Respecte le CLAUDE.md du coffre (règles Zettelkasten). Réponds en français, de façon concise.",
  "",
  PLATFORM_DOC,
  "",
  "[MESSAGE UTILISATEUR]",
].join("\n");

const CHAT_PREFIX = [
  PLATFORM_DOC,
  "Tu travailles dans le répertoire courant du projet : tu peux lire/modifier les fichiers,",
  "lancer des commandes, et piloter machines et APIs quand l'utilisateur le demande.",
  "",
  "[MESSAGE UTILISATEUR]",
].join("\n");

/**
 * Envoie un message dans une conversation et renvoie la réponse.
 * kind "curator" => cwd = coffre Obsidian + préfixe de rôle.
 */
async function sendMessage(chatId, text) {
  const chats = loadChats();
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) throw new Error("Conversation introuvable");

  const isCurator = chat.kind === "curator";
  const cwd = isCurator && VAULT_DIR ? VAULT_DIR : PROJECT_ROOT;
  const prompt = (isCurator ? CURATOR_PREFIX : CHAT_PREFIX) + "\n" + text;

  const args = ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"];
  if (chat.sessionId) args.push("--resume", chat.sessionId);

  chat.messages.push({ role: "user", text, ts: new Date().toISOString() });
  if (chat.messages.length === 1 && !chat.titleSet) {
    chat.title = text.slice(0, 48) + (text.length > 48 ? "…" : "");
    chat.titleSet = true;
  }
  saveChats(chats);

  state.busy++;
  try {
    const raw = await runClaude(args, prompt, cwd, 10 * 60 * 1000);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { result: raw.trim() };
    }
    const reply = parsed.result || parsed.error || "(réponse vide)";
    if (parsed.session_id) chat.sessionId = parsed.session_id;
    // Pas de suivi de coût : le CLI passe par l'abonnement, pas par l'API facturée.
    chat.messages.push({ role: "assistant", text: reply, ts: new Date().toISOString() });
    saveChats(loadChats().map((c) => (c.id === chat.id ? chat : c)));
    state.connected = true;
    return { reply, sessionId: chat.sessionId };
  } catch (e) {
    chat.messages.push({ role: "error", text: e.message, ts: new Date().toISOString() });
    saveChats(loadChats().map((c) => (c.id === chat.id ? chat : c)));
    throw e;
  } finally {
    state.busy--;
  }
}

/**
 * Appel one-shot (sans conversation) — utilisé par les Machines pour générer
 * prompts et scripts. Renvoie le texte brut de la réponse.
 */
async function ask(prompt, { timeoutMs = 5 * 60 * 1000, model } = {}) {
  state.busy++;
  try {
    const args = ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"];
    if (model) args.push("--model", model); // ex. "opus" — sinon modèle par défaut du CLI
    const out = await runClaude(args, prompt, PROJECT_ROOT, timeoutMs);
    const parsed = JSON.parse(out);
    if (parsed.is_error) throw new Error(parsed.result || "Claude CLI : erreur");
    return parsed.result || "";
  } finally {
    state.busy--;
  }
}

/** Extrait un objet JSON d'une réponse Claude (fences ``` tolérées). */
function parseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Réponse Claude sans JSON : " + cleaned.slice(0, 200));
  return JSON.parse(cleaned.slice(start, end + 1));
}

module.exports = { warmup, checkStatus, status, startKeepAlive, isAuthError, listChats, getChat, createChat, deleteChat, sendMessage, ask, parseJson };
