// RUNETERRA Bot (Discord.js v14)

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

// --- Optional fetch polyfill for older Node ---
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = (...args) =>
      import("node-fetch").then(({ default: f }) => f(...args));
  } catch (e) {
    console.error("Seu Node não tem fetch. Instale node-fetch: npm i node-fetch");
    process.exit(1);
  }
}
const fetch = (...args) => fetchFn(...args);

// ------------------ CONFIG ------------------
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // se colocar, comandos aparecem na hora
const DD_LANG = process.env.DD_LANG || "pt_BR";

if (!TOKEN || !CLIENT_ID) {
  console.log("Faltando DISCORD_TOKEN ou CLIENT_ID no .env");
  process.exit(1);
}

const WELCOME_TEXT =
  process.env.WELCOME_MESSAGE ||
  "Bem-vindo(a)! Me marque no chat ou use /ask para perguntar sobre LoL 🙂";

const CACHE_DIR = path.join(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// ------------------ CLIENT ------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // welcome
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // responder menções
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// ------------------ SLASH COMMANDS ------------------
const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Pergunte sobre LoL (campeões, itens, runas, regiões, etc.)")
    .addStringOption((o) =>
      o
        .setName("pergunta")
        .setDescription("Ex.: 'fala do noxus', 'quem é jinx', 'item gume do infinito'")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("champ")
    .setDescription("Buscar campeão")
    .addStringOption((o) =>
      o.setName("nome").setDescription("Nome do campeão").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("item")
    .setDescription("Buscar item")
    .addStringOption((o) =>
      o.setName("nome").setDescription("Nome do item").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("region")
    .setDescription("Lore de regiões de Runeterra")
    .addStringOption((o) =>
      o
        .setName("nome")
        .setDescription("Digite a região (ex.: Noxus, Demacia, Ionia, Zaun, Vazio)")
        .setRequired(true)
    ),

  new SlashCommandBuilder().setName("help").setDescription("Ajuda do RUNETERRA"),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands,
      });
      console.log("Slash commands registrados (guild).");
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("Slash commands registrados (global). Pode demorar a aparecer.");
    }
  } catch (err) {
    console.error("Erro ao registrar slash commands:", err);
  }
}

// ------------------ SAFETY (não derrubar) ------------------
process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
});

// ------------------ SMALL UTILS ------------------
function norm(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function safeHtmlToText(s) {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function clip(s, max = 1200) {
  s = s || "";
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

function cacheRead(file) {
  const fp = path.join(CACHE_DIR, file);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

function cacheWrite(file, data) {
  const fp = path.join(CACHE_DIR, file);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

async function fetchJsonSafe(url) {
  try {
    return await fetchJson(url);
  } catch (e) {
    return { __error: true, message: e?.message || String(e), url };
  }
}

// ------------------ DATA DRAGON LAYER (CACHED) ------------------
async function getLatestVersion() {
  const cached = cacheRead("dd_versions.json");
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < 6 * 60 * 60 * 1000) return cached.latest;

  const versions = await fetchJson("https://ddragon.leagueoflegends.com/api/versions.json");
  const latest = versions?.[0];
  cacheWrite("dd_versions.json", { ts: now, latest });
  return latest;
}

async function getChampionsIndex() {
  const cached = cacheRead(`champs_${DD_LANG}.json`);
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < 24 * 60 * 60 * 1000) return cached.data;

  const ver = await getLatestVersion();
  const url = `https://ddragon.leagueoflegends.com/cdn/${ver}/data/${DD_LANG}/champion.json`;
  const data = await fetchJson(url);
  cacheWrite(`champs_${DD_LANG}.json`, { ts: now, data });
  return data;
}

async function getChampionFullById(champId) {
  const file = `champ_${DD_LANG}_${champId}.json`;
  const cached = cacheRead(file);
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < 7 * 24 * 60 * 60 * 1000) return cached.data;

  const ver = await getLatestVersion();
  const url = `https://ddragon.leagueoflegends.com/cdn/${ver}/data/${DD_LANG}/champion/${champId}.json`;
  const data = await fetchJson(url);
  cacheWrite(file, { ts: now, data });
  return data;
}

async function getItemsData() {
  const cached = cacheRead(`items_${DD_LANG}.json`);
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < 24 * 60 * 60 * 1000) return cached.data;

  const ver = await getLatestVersion();
  const url = `https://ddragon.leagueoflegends.com/cdn/${ver}/data/${DD_LANG}/item.json`;
  const data = await fetchJson(url);
  cacheWrite(`items_${DD_LANG}.json`, { ts: now, data });
  return data;
}

async function getSummonerSpells() {
  const cached = cacheRead(`spells_${DD_LANG}.json`);
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < 7 * 24 * 60 * 60 * 1000) return cached.data;

  const ver = await getLatestVersion();
  const url = `https://ddragon.leagueoflegends.com/cdn/${ver}/data/${DD_LANG}/summoner.json`;
  const data = await fetchJson(url);
  cacheWrite(`spells_${DD_LANG}.json`, { ts: now, data });
  return data;
}

/**
 * ✅ RUNAS (corrigido)
 * Usa Data Dragon runesReforged.json (estável). Alguns idiomas podem variar;
 * se pt_BR não existir, cai pra en_US automaticamente.
 */
async function getRunesReforged() {
  const cached = cacheRead(`runesReforged_${DD_LANG}.json`);
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < 7 * 24 * 60 * 60 * 1000) return cached.data;

  const ver = await getLatestVersion();
  const tryLangs = [DD_LANG, "en_US"];

  for (const lang of tryLangs) {
    const url = `https://ddragon.leagueoflegends.com/cdn/${ver}/data/${lang}/runesReforged.json`;
    const data = await fetchJsonSafe(url);
    if (!data.__error) {
      cacheWrite(`runesReforged_${DD_LANG}.json`, { ts: now, data });
      return data;
    }
  }

  // se tudo falhar
  return null;
}

// ------------------ LORE (REGIONS) ------------------
const REGIONS = {
  noxus:
    "Noxus é um império expansionista que valoriza força, mérito e ambição. Origem não importa: quem prova valor sobe. É uma potência militar e política, cheia de intriga, conquista e pragmatismo.",
  demacia:
    "Demacia valoriza honra, disciplina e tradição. Sua cultura é fortemente militar e desconfiada de magia. Ótima para histórias de dever, segredo e conflito ideológico.",
  ionia:
    "Ionia é espiritual e ligada ao equilíbrio natural. Tradições antigas, ordens e facções diversas. Perfeita para histórias de harmonia, resistência e poder espiritual.",
  freljord:
    "Freljord é um território gelado de clãs, sobrevivência e deuses antigos. Conflitos tribais e a brutalidade do inverno moldam tudo.",
  shurima:
    "Shurima é deserto, ruínas de impérios e lendas de Ascensão. Exploração, relíquias e forças antigas são o coração da região.",
  targon:
    "Targon trata de fé, provações e o domínio celestial. A montanha e seus Aspectos conectam mortais ao cosmo e a forças superiores.",
  ixtal:
    "Ixtal é isolada e dominadora de magias elementais e tradição. Selva, segredo e maestria elemental definem sua identidade.",
  piltover:
    "Piltover é a cidade do progresso: ciência, invenção, comércio e influência. Brilho, status e tecnologia movem suas histórias.",
  zaun:
    "Zaun é a cidade subterrânea: química, risco e desigualdade. Onde Piltover brilha, Zaun sobrevive e se transforma.",
  bandopolis:
    "Bandópolis é o lar yordle: magia leve, atalhos impossíveis e travessuras. Realidade flexível e humor perigoso.",
  "ilhas das sombras":
    "As Ilhas das Sombras são ruína e névoa: mortos-vivos, maldições e horror. Histórias de perda, vingança e sobrevivência.",
  vazio:
    "O Vazio é uma ameaça alienígena que consome e corrompe. Terror cósmico, invasão e mutação definem essa força.",
};

// ------------------ SEARCH / FORMAT ------------------
async function findChampionByName(name) {
  const idx = await getChampionsIndex();
  const champs = Object.values(idx?.data || {});
  const q = norm(name);

  let best =
    champs.find((c) => norm(c.name) === q) ||
    champs.find((c) => norm(c.id) === q) ||
    champs.find((c) => norm(c.name).includes(q)) ||
    champs.find((c) => norm(c.title).includes(q));

  if (!best) {
    const parts = q.split(/\s+/).filter(Boolean);
    best = champs.find((c) => parts.every((p) => norm(c.name).includes(p)));
  }
  return best || null;
}

async function formatChampionAnswer(name) {
  const base = await findChampionByName(name);
  if (!base) return null;

  const full = await getChampionFullById(base.id);
  const champ = full?.data?.[base.id];
  if (!champ) return null;

  const passive = champ.passive
    ? `Passiva: ${champ.passive.name} — ${safeHtmlToText(champ.passive.description)}`
    : "";

  const spells = (champ.spells || [])
    .map((s, i) => `${["Q", "W", "E", "R"][i]}: ${s.name} — ${clip(safeHtmlToText(s.description), 260)}`)
    .join("\n");

  const tags = champ.tags?.length ? champ.tags.join(", ") : "—";
  const blurb = champ.lore ? clip(champ.lore, 700) : champ.blurb ? clip(champ.blurb, 500) : "";

  const out =
    `${champ.name} — ${champ.title}\n` +
    `Classes: ${tags}\n\n` +
    `${blurb}\n\n` +
    `${passive}\n` +
    `${spells ? `\nHabilidades:\n${spells}` : ""}`;

  return clip(out, 1800);
}

async function findItemByName(name) {
  const items = await getItemsData();
  const data = items?.data || {};
  const q = norm(name);

  const all = Object.entries(data).map(([id, it]) => ({ id, ...it }));
  let best = all.find((it) => norm(it.name) === q) || all.find((it) => norm(it.name).includes(q));

  if (!best) {
    const parts = q.split(/\s+/).filter(Boolean);
    best = all.find((it) => parts.every((p) => norm(it.name).includes(p)));
  }
  return best || null;
}

async function formatItemAnswer(name) {
  const it = await findItemByName(name);
  if (!it) return null;

  const desc = clip(safeHtmlToText(it.description || ""), 900);
  const gold = it.gold?.total ? `Custo: ${it.gold.total}` : "";
  const tags = it.tags?.length ? `Tags: ${it.tags.join(", ")}` : "";

  let stats = "";
  if (it.plaintext) stats = it.plaintext;

  return clip(
    `${it.name}\n${gold}\n${tags}\n\n${stats}\n\n${desc}`.replace(/\n{3,}/g, "\n\n"),
    1800
  );
}

async function formatSpellAnswer(name) {
  const spells = await getSummonerSpells();
  const all = Object.values(spells?.data || {});
  const q = norm(name);

  const best =
    all.find((s) => norm(s.name) === q) ||
    all.find((s) => norm(s.name).includes(q)) ||
    all.find((s) => norm(s.description).includes(q));

  if (!best) return null;

  return clip(`${best.name}\n\n${clip(safeHtmlToText(best.description), 1200)}`, 1800);
}

/**
 * ✅ RUNAS: procura por nome dentro do runesReforged (árvores + runas)
 */
async function formatRuneAnswer(name) {
  const rr = await getRunesReforged();
  if (!rr) return null;

  const q = norm(name);

  // rr = [{id, key, name, slots:[{runes:[{id,key,name,shortDesc,longDesc}]}]}]
  for (const tree of rr) {
    // se a pessoa digitar o nome da árvore (Precisão, Dominação...)
    if (norm(tree.name) === q || norm(tree.name).includes(q) || q.includes(norm(tree.name))) {
      return clip(
        `${tree.name}\n\n${clip(safeHtmlToText(tree.longDesc || tree.shortDesc || ""), 1400)}`,
        1800
      );
    }

    for (const slot of tree.slots || []) {
      for (const rune of slot.runes || []) {
        if (norm(rune.name) === q || norm(rune.name).includes(q) || q.includes(norm(rune.name))) {
          return clip(
            `${rune.name}\n\n${clip(safeHtmlToText(rune.longDesc || rune.shortDesc || ""), 1400)}`,
            1800
          );
        }
      }
    }
  }
  return null;
}

function formatRegionAnswer(name) {
  const k = norm(name);
  const key =
    Object.keys(REGIONS).find((r) => norm(r) === k) ||
    Object.keys(REGIONS).find((r) => norm(r).includes(k)) ||
    Object.keys(REGIONS).find((r) => k.includes(norm(r)));

  if (!key) return null;

  const title = key
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return `${title}\n\n${REGIONS[key]}`;
}

function quickHelp() {
  return (
    "RUNETERRA • Ajuda\n\n" +
    "Use:\n" +
    "- /ask pergunta\n" +
    "- /champ nome\n" +
    "- /item nome\n" +
    "- /region nome\n\n" +
    "Ou me marque: @RUNETERRA 'quem é jinx', 'item gume do infinito', 'runa eletrocutar', 'feitiço flash', 'fala de noxus'."
  );
}

// “Inteligência” simples: tenta detectar o que a pessoa quer
async function smartAnswer(question) {
  const q = norm(question);

  if (!q || q === "help" || q === "ajuda") return { text: quickHelp() };

  const regionHit = formatRegionAnswer(q);
  if (regionHit) return { text: regionHit };

  const isItem =
    q.includes("item") || q.includes("itens") || q.includes("gume") || q.includes("lamina") || q.includes("cajado");
  const isChamp =
    q.includes("quem é") || q.includes("quem e") || q.includes("campeao") || q.includes("campeão") || q.includes("champ") || q.includes("personagem");
  const isRune = q.includes("runa") || q.includes("runas") || q.includes("colheita") || q.includes("eletrocutar") || q.includes("precisao") || q.includes("domina");
  const isSpell =
    q.includes("feiti") || q.includes("flash") || q.includes("ignite") || q.includes("barreira") || q.includes("curar") || q.includes("teleporte");

  const cleaned = q
    .replace(/\b(quem e|quem é|fala|sobre|do|da|de|a|o|os|as|um|uma|no|na|nos|nas|por favor|pfv|pls|item|itens|campeao|campeão|runa|runas|feitico|feitiço)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (isChamp) {
    const ans = await formatChampionAnswer(cleaned || question);
    if (ans) return { text: ans };
  }
  if (isItem) {
    const ans = await formatItemAnswer(cleaned || question);
    if (ans) return { text: ans };
  }
  if (isRune) {
    const ans = await formatRuneAnswer(cleaned || question);
    if (ans) return { text: ans };
  }
  if (isSpell) {
    const ans = await formatSpellAnswer(cleaned || question);
    if (ans) return { text: ans };
  }

  // tentativa geral
  let ans = await formatChampionAnswer(cleaned || question);
  if (ans) return { text: ans };

  ans = await formatItemAnswer(cleaned || question);
  if (ans) return { text: ans };

  ans = await formatRuneAnswer(cleaned || question);
  if (ans) return { text: ans };

  ans = await formatSpellAnswer(cleaned || question);
  if (ans) return { text: ans };

  return {
    text:
      "Entendi, mas preciso de um detalhe.\n" +
      "Você quer: campeão, item, runa, feitiço ou região?\n" +
      "Exemplos: 'campeão jinx', 'item gume do infinito', 'runa eletrocutar', 'feitiço flash', 'região noxus'.",
  };
}

// ------------------ EVENTS ------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`RUNETERRA online como ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await member.send(WELCOME_TEXT);
  } catch {
    // DM bloqueada
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "help") {
      return interaction.reply({ content: quickHelp(), ephemeral: true });
    }

    if (interaction.commandName === "ask") {
      const q = interaction.options.getString("pergunta", true);
      await interaction.deferReply();
      const ans = await smartAnswer(q);
      return interaction.editReply(ans.text);
    }

    if (interaction.commandName === "champ") {
      const name = interaction.options.getString("nome", true);
      await interaction.deferReply();
      const ans = await formatChampionAnswer(name);
      return interaction.editReply(ans || "Não encontrei esse campeão. Tente outro nome.");
    }

    if (interaction.commandName === "item") {
      const name = interaction.options.getString("nome", true);
      await interaction.deferReply();
      const ans = await formatItemAnswer(name);
      return interaction.editReply(ans || "Não encontrei esse item. Tente outro nome.");
    }

    if (interaction.commandName === "region") {
      const name = interaction.options.getString("nome", true);
      const ans = formatRegionAnswer(name);
      return interaction.reply({
        content: ans || "Não reconheci essa região. Tente: Noxus, Demacia, Ionia, etc.",
      });
    }
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply("Deu erro aqui. Tenta de novo em alguns segundos.");
    }
    return interaction.reply({ content: "Deu erro aqui. Tenta de novo.", ephemeral: true });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!client.user) return;

  const mentioned =
    message.mentions.users.has(client.user.id) ||
    message.content.includes(`<@${client.user.id}>`) ||
    message.content.includes(`<@!${client.user.id}>`);

  if (!mentioned) return;

  const content = message.content
    .replaceAll(`<@${client.user.id}>`, "")
    .replaceAll(`<@!${client.user.id}>`, "")
    .trim();

  if (!content) return message.reply(quickHelp());

  // rate limit simples por usuário
  const now = Date.now();
  client._rl = client._rl || new Map();
  const last = client._rl.get(message.author.id) || 0;
  if (now - last < 1200) return;
  client._rl.set(message.author.id, now);

  try {
    const ans = await smartAnswer(content);
    return message.reply(ans.text);
  } catch (e) {
    console.error("Erro respondendo mensagem:", e);
    return message.reply("Deu erro ao buscar dados agora. Tenta de novo.");
  }
});

// ------------------ START ------------------
client.login(TOKEN);
