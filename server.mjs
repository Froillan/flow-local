import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FLOW_DATA || path.join(here, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const PUBLIC = path.join(here, 'public');
const PORT = Number(process.env.PORT || 4500);
const MODELS_DIR = process.env.MODELS_DIR || path.join(os.homedir(), 'Documents', 'whisper-models');
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const WHISPER = process.env.WHISPER || '/opt/homebrew/bin/whisper-cli';
const WHISPER_SERVER = process.env.WHISPER_SERVER || '/opt/homebrew/bin/whisper-server';
const WS_PORT = Number(process.env.WS_PORT || 4501);
const MODELS = { turbo: 'ggml-large-v3-turbo.bin', small: 'ggml-small.bin', base: 'ggml-base.bin' };
const LANGS = ['es', 'en', 'auto'];
const STYLES = ['natural', 'literal', 'sin-puntuacion', 'formal', 'casual'];
const STOPWORDS = new Set(('de la que el en y a los del se las por un para con no una su al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros es ser soy eres son fue era he has hemos han hay q pa osea bueno ok the and of to is it in').split(' '));

const defaults = () => ({
  createdAt: new Date().toISOString(),
  profile: { name: '', language: 'es', model: 'small', context: '', mic: '', pressEnter: false, autoVocab: true },
  style: 'natural',
  appStyles: [], // { app, style }: estilo según la app donde dictas
  meetings: [], // { id, title, startedAt, endedAt, status, mic, segments: [{ index, at, text }] }
  dictionary: [], // { from, to }
  snippets: [], // { trigger, text }
  notes: [], // { id, title, body, updatedAt }
  history: [], // { id, text, raw, words, seconds, source, app, corrections, fixed, at }
});

let db = defaults();

async function load() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  try {
    db = { ...defaults(), ...JSON.parse(await fs.readFile(DB_FILE, 'utf8')) };
    for (const m of db.meetings) if (m.status === 'recording') m.status = 'interrupted';
  } catch {}
  // restos de reuniones interrumpidas (audio en tramos que ya no se va a procesar)
  for (const d of await fs.readdir(TMP_DIR).catch(() => [])) if (d.startsWith('meet-') && !meeting) await fs.rm(path.join(TMP_DIR, d), { recursive: true, force: true });
  if (typeof db.lifetimeWords !== 'number') db.lifetimeWords = db.history.reduce((a, e) => a + e.words, 0);
  if (maybeUpdateVoiceProfile()) await save();
}

let saving = Promise.resolve();
function save() {
  saving = saving.then(() =>
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db, null, 2)).then(() => fs.rename(DB_FILE + '.tmp', DB_FILE)),
  );
  return saving;
}

const uid = () => crypto.randomUUID();
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (s) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(s)}(?![\\p{L}\\p{N}])`, 'giu');
const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Post-procesado: diccionario -> fragmentos -> estilo. Devuelve también las correcciones hechas.
function applyDictionary(text) {
  let corrections = 0;
  const fixed = [];
  for (const { from, to } of db.dictionary) {
    if (!from || !to) continue;
    const re = wordRe(from);
    const hits = text.match(re);
    if (hits) {
      corrections += hits.length;
      fixed.push(...hits.map((h) => h.toLowerCase()));
      text = text.replace(re, to);
    }
  }
  return { text, corrections, fixed };
}

function applySnippets(text) {
  for (const { trigger, text: body } of db.snippets) {
    if (!trigger) continue;
    const clean = text.trim().replace(/[.,;:!?¿¡]+$/, '');
    if (clean.toLowerCase() === trigger.toLowerCase()) return body;
    text = text.replace(wordRe(trigger), body);
  }
  return text;
}

const FILLERS = /(?<![\p{L}])(?:eh+|em+|ehm+|mm+|hmm+)(?![\p{L}])[,.]?\s*/giu;
const ABBREVIATIONS = [[/(?<![\p{L}])q(?![\p{L}])/giu, 'que'], [/(?<![\p{L}])(?:pq|xq)(?![\p{L}])/giu, 'porque'], [/(?<![\p{L}])tmb(?![\p{L}])/giu, 'también']];

function applyStyle(text, style) {
  text = text.trim();
  if (!text || style === 'literal') return text;
  if (style === 'sin-puntuacion') return text.replace(/[.,;:!?¿¡]/g, '').replace(/\s+/g, ' ').trim();
  if (style === 'casual') return (text.replace(/\.+$/, '').charAt(0).toLowerCase() + text.replace(/\.+$/, '').slice(1)).trim();
  if (style === 'formal') {
    text = text.replace(FILLERS, '');
    for (const [re, to] of ABBREVIATIONS) text = text.replace(re, to);
    text = text.replace(/\s+/g, ' ').trim().replace(/(^|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    return /[.!?…]$/.test(text) ? text : text + '.';
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?…]$/.test(text)) text += '.';
  return text;
}

// Estilo según la app donde dictas (ej. WhatsApp → casual, Mail → formal); si no hay regla, el estilo general
function styleFor(appName) {
  const name = String(appName || '').toLowerCase();
  const rule = db.appStyles.find((r) => r.app && name.includes(r.app.toLowerCase()) && STYLES.includes(r.style));
  return rule ? rule.style : db.style;
}

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} salió con código ${code}`))));
    p.stdin.end(input);
  });
}

// Lista los micrófonos que ve AVFoundation (ffmpeg la imprime en stderr y sale con error, es normal)
async function listMics() {
  const out = await new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', () => resolve(err));
    p.on('error', () => resolve(''));
  });
  const audio = out.split('audio devices:')[1] || '';
  return [...audio.matchAll(/\[(\d+)\] (.+)/g)].map((m) => ({ index: Number(m[1]), name: m[2].trim() }));
}

// whisper-server mantiene el modelo cargado en memoria: cada dictado tarda ~0.3 s en vez de 1-2 s
let ws = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureWhisperServer() {
  const modelFile = path.join(MODELS_DIR, MODELS[db.profile.model] || MODELS.small);
  if (ws && ws.model === modelFile && ws.proc.exitCode === null) return ws.ready;
  if (ws) ws.proc.kill();
  await new Promise((r) => spawn('pkill', ['-f', `whisper-server.*--port ${WS_PORT}`]).on('close', r).on('error', r));
  const proc = spawn(WHISPER_SERVER, ['-m', modelFile, '--host', '127.0.0.1', '--port', String(WS_PORT), '-nt', '-l', 'es'], { stdio: 'ignore' });
  const entry = { proc, model: modelFile, ready: null };
  entry.ready = (async () => {
    for (let i = 0; i < 200; i++) {
      if (proc.exitCode !== null) throw new Error('whisper-server no arrancó (¿falta el modelo?)');
      try {
        await fetch(`http://127.0.0.1:${WS_PORT}/`);
        return;
      } catch {
        await sleep(300);
      }
    }
    throw new Error('whisper-server tardó demasiado en arrancar');
  })();
  entry.ready.catch(() => {});
  proc.on('exit', () => {
    if (ws === entry) ws = null;
  });
  ws = entry;
  return entry.ready;
}

// Vocabulario automático: tus nombres propios y términos frecuentes se suman al contexto de Whisper
let vocabCache = { key: '', terms: [] };
function frequentTerms(limit = 30) {
  const count = {};
  const shown = {};
  for (const e of db.history) {
    const toks = e.text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    toks.forEach((t, i) => {
      const k = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (k.length < 4 || STOPWORDS.has(k) || /^\d+$/.test(k)) return;
      // solo términos en mayúscula a mitad de frase (nombres, marcas) o muy repetidos
      const proper = /^\p{Lu}/u.test(t) && i > 0;
      count[k] = count[k] || { n: 0, proper: 0 };
      count[k].n++;
      if (proper) count[k].proper++;
      shown[k] ??= t;
    });
  }
  return Object.entries(count)
    .filter(([, c]) => c.proper >= 2 || c.n >= 6)
    .sort((a, b) => b[1].proper * 3 + b[1].n - (a[1].proper * 3 + a[1].n))
    .slice(0, limit)
    .map(([k, c]) => ({ term: shown[k], count: c.n, proper: c.proper >= 2 }));
}
function whisperPrompt(profile) {
  const parts = [];
  if (profile.context) parts.push(profile.context);
  if (profile.autoVocab !== false) {
    const key = `${db.history.length}:${db.dictionary.length}`;
    if (vocabCache.key !== key) {
      const own = db.dictionary.map((d) => d.to);
      const freq = frequentTerms(20).map((t) => t.term);
      vocabCache = { key, terms: [...new Set([...own, ...freq])] };
    }
    const have = (profile.context || '').toLowerCase();
    const extra = vocabCache.terms.filter((t) => !have.includes(t.toLowerCase())).join(', ');
    if (extra) parts.push(extra);
  }
  return parts.join('. ').slice(0, 600);
}

// Sugerencias: términos para el vocabulario y estilo recomendado por app
function suggestions() {
  const have = `${db.profile.context || ''} ${db.dictionary.map((d) => d.to).join(' ')}`.toLowerCase();
  const vocab = frequentTerms(40).filter((t) => t.proper && !have.includes(t.term.toLowerCase())).slice(0, 6);
  const perApp = {};
  for (const e of db.history) perApp[e.app] = (perApp[e.app] || 0) + 1;
  const want = { personal: 'casual', correo: 'formal' };
  const styles = [];
  for (const [app, n] of Object.entries(perApp)) {
    const style = want[categoryOf(app)];
    if (!style || n < 5) continue;
    if (db.appStyles.some((r) => r.app && app.toLowerCase().includes(r.app.toLowerCase()))) continue;
    if (styleFor(app) === style) continue;
    styles.push({ app, style, dictations: n });
  }
  return { vocab, styles: styles.sort((a, b) => b.dictations - a.dictations).slice(0, 4) };
}

async function transcribeWithServer(wav, profile) {
  await ensureWhisperServer();
  const form = new FormData();
  form.append('file', new Blob([await fs.readFile(wav)]), 'audio.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0.0');
  form.append('language', LANGS.includes(profile.language) ? profile.language : 'es');
  const prompt = whisperPrompt(profile);
  if (prompt) form.append('prompt', prompt);
  const res = await fetch(`http://127.0.0.1:${WS_PORT}/inference`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`whisper-server respondió ${res.status}`);
  return (await res.json()).text || '';
}

async function transcribeWithCli(wav, profile) {
  const model = path.join(MODELS_DIR, MODELS[profile.model] || MODELS.small);
  const args = ['-m', model, '-l', LANGS.includes(profile.language) ? profile.language : 'es', '-nt', '-np', '-f', wav];
  const prompt = whisperPrompt(profile);
  if (prompt) args.push('--prompt', prompt);
  return run(WHISPER, args);
}

async function availableModels() {
  const found = [];
  for (const [k, f] of Object.entries(MODELS)) {
    try {
      await fs.access(path.join(MODELS_DIR, f));
      found.push(k);
    } catch {}
  }
  return found;
}

async function transcribe(audio, source, app) {
  const wav = path.join(TMP_DIR, `${uid()}.wav`);
  try {
    await run(FFMPEG, ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', wav], audio);
    const { profile } = db;
    let rawText;
    try {
      rawText = await transcribeWithServer(wav, profile);
    } catch (err) {
      console.warn('whisper-server falló, uso whisper-cli:', err.message);
      rawText = await transcribeWithCli(wav, profile);
    }
    let raw = rawText.replace(/\s+/g, ' ').trim();
    if (/^[\[(].*[\])]$/.test(raw)) raw = ''; // [BLANK_AUDIO] y similares
    const dict = applyDictionary(raw);
    const appName = app || (source === 'web' ? 'Navegador' : 'Desconocida');
    const style = styleFor(appName);
    const text = applyStyle(applySnippets(dict.text), style);
    const edits = wordEdits(raw, applyStyle(dict.text, style));
    const seconds = Math.max(0, ((await fs.stat(wav)).size - 44) / 32000);
    const entry = {
      id: uid(),
      text,
      raw,
      words: words(text),
      seconds: Math.round(seconds * 10) / 10,
      source,
      app: appName,
      corrections: dict.corrections,
      edits,
      fixed: dict.fixed,
      at: new Date().toISOString(),
    };
    if (text) {
      db.history.unshift(entry);
      db.lifetimeWords = (db.lifetimeWords || 0) + entry.words;
      maybeUpdateVoiceProfile();
      db.history = db.history.slice(0, 20000);
      await save();
    }
    return entry;
  } finally {
    await fs.rm(wav, { force: true });
  }
}

// ---------- Notetaker: transcribe reuniones largas por tramos ----------
const MEET_SEGMENT = 30; // segundos por tramo
const HALLUCINATIONS = /^[¡¿\s]*(gracias( por (ver|vernos|escuchar|su atención))?( el video)?|subtítulos.*|suscríbete.*|suscribete.*|dale like.*|amara\.org.*|música|\[.*\]|\(.*\)|\.+)[.!?\s]*$/i;

// Whisper inventa frases ("suscríbete al canal") cuando oye silencio; si el tramo no pasa de -32 dB no se transcribe
async function isSilent(file) {
  const out = await new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', () => resolve(err));
    p.on('error', () => resolve(''));
  });
  const max = out.match(/max_volume: (-?[\d.]+) dB/);
  return max ? Number(max[1]) < -32 : false;
}
let meeting = null; // { rec, proc, dir, done, working, stopping, timer, exited }

async function pumpMeeting() {
  const m = meeting;
  if (!m || m.working) return;
  m.working = true;
  try {
    const files = (await fs.readdir(m.dir)).filter((f) => /^seg\d+\.wav$/.test(f)).sort();
    const ready = m.stopping ? files : files.slice(0, -1); // el último aún se está escribiendo
    for (const f of ready) {
      if (m.done.has(f)) continue;
      const file = path.join(m.dir, f);
      let text = '';
      try {
        if ((await fs.stat(file)).size > 4000 && !(await isSilent(file))) text = (await transcribeWithServer(file, db.profile)).replace(/\s+/g, ' ').trim();
      } catch (err) {
        console.warn('tramo de reunión falló:', err.message);
      }
      if (HALLUCINATIONS.test(text)) text = '';
      const index = Number(f.match(/\d+/)[0]);
      if (text) m.rec.segments.push({ index, at: index * MEET_SEGMENT, text });
      m.done.add(f);
      await fs.rm(file, { force: true });
      await save();
    }
  } finally {
    m.working = false;
  }
}

async function startMeeting({ title, mic }) {
  if (meeting) throw new Error('Ya hay una reunión en curso');
  const mics = await listMics();
  const pick = mics.find((x) => x.name === (mic || db.profile.mic)) || mics[0];
  if (!pick) throw new Error('No encontré ningún micrófono');
  const rec = {
    id: uid(),
    title: String(title || '').trim().slice(0, 120) || `Reunión del ${new Date().toLocaleDateString('es', { day: 'numeric', month: 'long' })}`,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'recording',
    mic: pick.name,
    segments: [],
  };
  const dir = path.join(TMP_DIR, `meet-${rec.id}`);
  await fs.mkdir(dir, { recursive: true });
  const proc = spawn(
    FFMPEG,
    ['-loglevel', 'error', '-f', 'avfoundation', '-i', `:${pick.index}`, '-ac', '1', '-ar', '16000', '-f', 'segment', '-segment_time', String(MEET_SEGMENT), '-reset_timestamps', '1', path.join(dir, 'seg%04d.wav')],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let err = '';
  proc.stderr.on('data', (d) => (err += d));
  meeting = { rec, proc, dir, done: new Set(), working: false, stopping: false, timer: null, exited: null };
  meeting.exited = new Promise((resolve) =>
    proc.on('close', (code) => {
      if (meeting?.rec === rec && !meeting.stopping) {
        rec.status = 'error';
        rec.error = err.trim().slice(-300) || `ffmpeg salió con código ${code}`;
        clearInterval(meeting.timer);
        meeting = null;
        save();
      }
      resolve();
    }),
  );
  meeting.timer = setInterval(() => pumpMeeting().catch(() => {}), 2500);
  db.meetings.unshift(rec);
  await save();
  return rec;
}

async function stopMeeting() {
  const m = meeting;
  if (!m) throw new Error('No hay ninguna reunión en curso');
  m.stopping = true;
  clearInterval(m.timer);
  m.proc.kill('SIGINT');
  await m.exited;
  while (m.working) await sleep(200);
  await pumpMeeting();
  m.rec.status = 'done';
  m.rec.endedAt = new Date().toISOString();
  meeting = null;
  await fs.rm(m.dir, { recursive: true, force: true });
  await save();
  return m.rec;
}

// ---------- Perfil de voz por niveles (como el original) ----------
// Se desbloquea con VOICE.unlock palabras; cada hito abre una carta nueva y después se actualiza cada VOICE.refresh palabras.
const VOICE = {
  unlock: Number(process.env.VOICE_UNLOCK || 2000),
  refresh: Number(process.env.VOICE_REFRESH || 25000),
  milestones: [
    ['phrase', Number(process.env.VOICE_PHRASE || 5000)],
    ['word', Number(process.env.VOICE_WORD || 10000)],
    ['fixed', Number(process.env.VOICE_FIXED || 15000)],
  ],
};
const voiceThresholds = () => [VOICE.unlock, ...VOICE.milestones.map(([, w]) => w)];
const voiceLevel = (words) => voiceThresholds().filter((t) => words >= t).length;

function nextVoiceUpdateAt(vp) {
  const ahead = voiceThresholds().filter((t) => t > vp.lastUpdateWords);
  return ahead.length ? ahead[0] : vp.lastUpdateWords + VOICE.refresh;
}

// Congela una "foto" del perfil al desbloquearlo, al subir de nivel y cada VOICE.refresh palabras
function maybeUpdateVoiceProfile() {
  const words = db.lifetimeWords || 0;
  const vp = db.voiceProfile;
  if (vp ? words < nextVoiceUpdateAt(vp) : words < VOICE.unlock) return false;
  const s = stats();
  const now = new Date().toISOString();
  db.voiceProfile = {
    createdAt: vp?.createdAt || now,
    updatedAt: now,
    lastUpdateWords: words,
    updates: (vp?.updates || 0) + 1,
    level: voiceLevel(words),
    snapshot: {
      archetype: s.archetype,
      wpm: s.wpm,
      bestSlot: s.voice.bestSlot,
      topPhrase: s.voice.topPhrase,
      topWord: s.voice.topWord,
      topFixed: s.voice.topFixed,
    },
  };
  return true;
}

function voiceProfileView() {
  const words = db.lifetimeWords || 0;
  const vp = db.voiceProfile;
  const base = { words, unlockAt: VOICE.unlock, maxLevel: voiceThresholds().length, locks: Object.fromEntries(VOICE.milestones), refresh: VOICE.refresh };
  if (!vp) return { ...base, unlocked: false, level: 0, nextUpdateIn: Math.max(0, VOICE.unlock - words), cycle: Math.min(1, words / VOICE.unlock) };
  const nextAt = nextVoiceUpdateAt(vp);
  return {
    ...base,
    unlocked: true,
    level: vp.level,
    createdAt: vp.createdAt,
    updatedAt: vp.updatedAt,
    updates: vp.updates,
    nextUpdateIn: Math.max(0, nextAt - words),
    cycle: Math.min(1, Math.max(0, (words - vp.lastUpdateWords) / (nextAt - vp.lastUpdateWords))),
    snapshot: vp.snapshot,
  };
}

// Tipo de uso según la app donde dictas (para el panel "Uso por aplicación")
const CATEGORIES = [
  ['ia', 'instrucciones de IA', /claude|chatgpt|openai|cursor|windsurf|antigravity|copilot|perplexity|gemini|terminal|iterm|warp|ghostty|kitty|alacritty|vs ?code|xcode|zed/i],
  ['personal', 'mensajes personales', /whatsapp|telegram|messages|mensajes|imessage|messenger|instagram|signal|facetime|discord/i],
  ['documentos', 'documentos', /notion|obsidian|pages|word|docs|textedit|notes|notas|bear|keynote|numbers|excel|sheets|preview|vista previa/i],
  ['correo', 'correos', /mail|outlook|gmail|spark|superhuman|correo/i],
  ['trabajo', 'mensajes de trabajo', /slack|teams|linear|asana|trello|clickup|zoom|monday|jira/i],
];
const categoryOf = (app) => (CATEGORIES.find(([, , re]) => re.test(app || '')) || ['otras'])[0];
const CATEGORY_LABELS = { ...Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l])), otras: 'otras tareas' };

const normTokens = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Palabras que cambian entre lo que oyó whisper y el texto final (diccionario, muletillas, abreviaturas)
function wordEdits(a, b) {
  const x = normTokens(a);
  const y = normTokens(b);
  const dp = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return dp[x.length][y.length];
}

// Arquetipo de voz según dónde y cómo dictas (reglas locales, sin IA)
const ARCHETYPES = {
  ia: 'Arquitecto de prompts',
  personal: 'Conversador',
  documentos: 'Curador de contenido',
  correo: 'Comunicador formal',
  trabajo: 'Coordinador de equipo',
  otras: 'Explorador',
};

function stats() {
  const h = db.history;
  const totalWords = h.reduce((a, e) => a + e.words, 0);
  const totalSec = h.reduce((a, e) => a + (e.seconds || 0), 0);
  const corrections = h.reduce((a, e) => a + (e.corrections || 0), 0);
  const wordsCorrected = h.reduce((a, e) => a + (e.edits || 0), 0);

  // Días con dictado y racha
  const perDay = {};
  for (const e of h) perDay[localDay(e.at)] = (perDay[localDay(e.at)] || 0) + e.words;
  const days = new Set(Object.keys(perDay));
  const today = localDay(new Date().toISOString());
  const cursor = new Date();
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(cursor.toISOString()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const sorted = [...days].sort();
  let longest = 0;
  let run_ = 0;
  let prev = null;
  for (const d of sorted) {
    const diff = prev ? (new Date(d) - new Date(prev)) / 86400000 : null;
    run_ = diff === 1 ? run_ + 1 : 1;
    longest = Math.max(longest, run_);
    prev = d;
  }

  // Uso por app
  const byApp = {};
  for (const e of h) byApp[e.app] = (byApp[e.app] || 0) + e.words;
  const apps = Object.entries(byApp)
    .map(([name, w]) => ({ name, words: w, pct: totalWords ? Math.round((w / totalWords) * 100) : 0 }))
    .sort((a, b) => b.words - a.words);

  // Voz: palabra más usada, más corregida, frase distintiva, mejor momento
  const counts = {};
  const shown = {};
  const bigrams = {};
  const fixedCounts = {};
  const slots = {};
  for (const e of h) {
    const rawToks = e.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const toks = rawToks.map((t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    rawToks.forEach((t, i) => (shown[toks[i]] ??= t));  // forma con tilde para mostrarla
    for (let i = 0; i < toks.length; i++) {
      if (!STOPWORDS.has(toks[i])) counts[toks[i]] = (counts[toks[i]] || 0) + 1;
      if (i + 1 < toks.length && !(STOPWORDS.has(toks[i]) && STOPWORDS.has(toks[i + 1]))) {
        const bg = `${toks[i]} ${toks[i + 1]}`;
        bigrams[bg] = (bigrams[bg] || 0) + 1;
      }
    }
    for (const f of e.fixed || []) fixedCounts[f] = (fixedCounts[f] || 0) + 1;
    const d = new Date(e.at);
    const slot = `${d.getDay()}-${d.getHours()}`;
    slots[slot] = slots[slot] || { words: 0, apps: {} };
    slots[slot].words += e.words;
    slots[slot].apps[e.app] = (slots[slot].apps[e.app] || 0) + e.words;
  }
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const show = (t) => shown[t] || t;
  const topWord = top(counts);
  const topBigram = top(bigrams);
  const topFixed = top(fixedCounts);
  const bestSlot = top(Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.words])));
  const bestApp = bestSlot ? top(slots[bestSlot[0]].apps)?.[0] : null;

  // Uso por tipo de app (cuenta dictados, como el panel original)
  const catCounts = {};
  for (const e of h) catCounts[categoryOf(e.app)] = (catCounts[categoryOf(e.app)] || 0) + 1;
  const categories = Object.entries(CATEGORY_LABELS)
    .map(([key, label]) => ({ key, label, count: catCounts[key] || 0, pct: h.length ? Math.round(((catCounts[key] || 0) / h.length) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  const appsUsed = new Set(h.map((e) => e.app)).size;
  const topCat = categories[0];
  const wpm = totalSec ? Math.round(totalWords / (totalSec / 60)) : 0;
  const topApps = apps.slice(0, 2).map((a) => a.name);
  const archetype =
    h.length < 10
      ? { name: 'Voz en construcción', description: 'Dicta unas cuantas veces más y Flow Local descubrirá tu estilo.' }
      : {
          name: ARCHETYPES[topCat.key],
          description: `Dictas sobre todo en ${topApps.join(' y ')}, con un ritmo de ${wpm} palabras por minuto${topWord ? `. Tu palabra más usada es “${show(topWord[0])}”` : ''}.`,
        };

  // Palabras de la semana actual (lunes a hoy)
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const week = h.filter((e) => new Date(e.at) >= weekStart).reduce((a, e) => a + e.words, 0);

  // Calendario de los últimos 150 días
  const calendar = [];
  for (let i = 149; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const k = localDay(dt.toISOString());
    calendar.push({ day: k, words: perDay[k] || 0 });
  }

  return {
    since: db.createdAt,
    totalWords,
    dictations: h.length,
    wpm,
    corrections,
    wordsCorrected,
    categories,
    appsUsed,
    archetype,
    voiceProfile: voiceProfileView(),
    todayWords: perDay[today] || 0,
    week,
    streak,
    longestStreak: longest,
    apps,
    calendar,
    voice: {
      topWord: topWord ? { word: show(topWord[0]), count: topWord[1] } : null,
      topFixed: topFixed ? { word: topFixed[0], count: topFixed[1] } : null,
      topPhrase: topBigram && topBigram[1] > 1 ? { phrase: topBigram[0].split(' ').map(show).join(' '), count: topBigram[1] } : null,
      bestSlot: bestSlot ? { weekday: Number(bestSlot[0].split('-')[0]), hour: Number(bestSlot[0].split('-')[1]), app: bestApp } : null,
    },
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Archivo demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/state') {
      return send(res, 200, {
        ...db,
        history: db.history.slice(0, 300),
        activeMeeting: meeting?.rec.id || null,
        stats: stats(),
        suggestions: suggestions(),
        models: await availableModels(),
        knownApps: [...new Set(db.history.map((e) => e.app))].slice(0, 30),
        languages: LANGS,
        styles: STYLES,
      });
    }

    if (req.method === 'POST' && p === '/api/transcribe') {
      const audio = await readBody(req, 50e6);
      if (!audio.length) return send(res, 400, { error: 'Sin audio' });
      const entry = await transcribe(audio, url.searchParams.get('source') || 'web', url.searchParams.get('app'));
      return send(res, 200, entry);
    }

    const hist = p.match(/^\/api\/history\/([\w-]+)$/);
    if (req.method === 'DELETE' && hist) {
      db.history = db.history.filter((e) => e.id !== hist[1]);
      await save();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && p === '/api/meetings/start') {
      const body = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
      return send(res, 200, await startMeeting(body));
    }
    if (req.method === 'POST' && p === '/api/meetings/stop') return send(res, 200, await stopMeeting());
    const meet = p.match(/^\/api\/meetings\/([\w-]+)$/);
    if (req.method === 'DELETE' && meet) {
      if (meeting?.rec.id === meet[1]) return send(res, 400, { error: 'Termina la reunión antes de borrarla' });
      db.meetings = db.meetings.filter((m) => m.id !== meet[1]);
      await save();
      return send(res, 200, { ok: true });
    }

    const col = p.match(/^\/api\/(profile|style|dictionary|snippets|notes|appstyles)$/);
    if (req.method === 'PUT' && col) {
      const key = col[1];
      const body = JSON.parse((await readBody(req, 5e6)).toString() || 'null');
      if (key === 'profile') {
        db.profile = {
          name: String(body?.name || '').slice(0, 80),
          language: LANGS.includes(body?.language) ? body.language : 'es',
          model: MODELS[body?.model] ? body.model : 'small',
          context: String(body?.context || '').slice(0, 1000),
          mic: String(body?.mic || '').slice(0, 200),
          pressEnter: Boolean(body?.pressEnter),
          autoVocab: body?.autoVocab !== false,
        };
        ensureWhisperServer().catch(() => {}); // precarga el modelo elegido
      } else if (key === 'style') {
        if (!STYLES.includes(body)) return send(res, 400, { error: 'Estilo no válido' });
        db.style = body;
      } else if (key === 'appstyles') {
        if (!Array.isArray(body)) return send(res, 400, { error: 'Se esperaba una lista' });
        db.appStyles = body
          .filter((r) => r && typeof r.app === 'string' && r.app.trim() && STYLES.includes(r.style))
          .map((r) => ({ app: r.app.trim().slice(0, 80), style: r.style }))
          .slice(0, 200);
      } else {
        if (!Array.isArray(body)) return send(res, 400, { error: 'Se esperaba una lista' });
        db[key] = body.slice(0, 5000);
      }
      await save();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });

    if (req.method === 'GET' && p === '/api/mics') return send(res, 200, await listMics());

    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p.slice(1)));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Prohibido' });
    const data = await fs.readFile(file);
    return send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, { error: 'No encontrado' });
    return send(res, 500, { error: e.message });
  }
});

await load();
if (!process.env.FLOW_NO_WHISPER) ensureWhisperServer().catch((e) => console.warn('whisper-server:', e.message));
const stopWhisper = () => {
  ws?.proc.kill();
  process.exit(0);
};
process.on('SIGINT', stopWhisper);
process.on('SIGTERM', stopWhisper);
process.on('exit', () => {
  ws?.proc.kill();
  meeting?.proc.kill('SIGINT');
});
for (const [k, f] of Object.entries(MODELS)) {
  try {
    await fs.access(path.join(MODELS_DIR, f));
  } catch {
    console.warn(`Aviso: falta el modelo ${k} en ${MODELS_DIR}`);
  }
}
server.listen(PORT, '127.0.0.1', () => console.log(`Flow Local en http://127.0.0.1:${PORT}`));
