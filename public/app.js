const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtTime = (iso) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const LANG_NAMES = { es: 'Español', en: 'Inglés', auto: 'Detectar automáticamente' };
const STYLE_INFO = {
  natural: ['Natural', 'Primera letra en mayúscula y punto final. Lo más parecido a escribir a mano.', 'hola como estas → Hola como estas.'],
  literal: ['Literal', 'Texto tal cual lo transcribe el modelo, sin cambios.', 'hola como estas → hola como estas'],
  'sin-puntuacion': ['Sin puntuación', 'Quita comas, puntos y signos. Útil para chats y comandos.', 'hola, como estas? → hola como estas'],
  formal: ['Formal', 'Quita muletillas (eh, em), expande abreviaturas (q → que) y cuida mayúsculas y puntos. Ideal para correo.', 'eh q tal, te escribo pq necesito → Qué tal, te escribo porque necesito.'],
  casual: ['Casual', 'Minúscula inicial y sin punto final. Ideal para WhatsApp y chats.', 'Hola, ya voy para allá. → hola, ya voy para allá'],
};
const MODEL_LABELS = {
  turbo: 'Large v3 turbo (el más preciso)',
  small: 'Small (equilibrado)',
  base: 'Base (más rápido, menos preciso)',
};
const ICONS = {
  mic: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  notas: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  stats: '<svg class="i" viewBox="0 0 24 24"><path d="M5 20V11M12 20V4M19 20v-6"/></svg>',
  perfil: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
  book: '<svg class="i" viewBox="0 0 24 24"><path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11"/></svg>',
  cut: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="6.5" r="2.7"/><circle cx="6" cy="17.5" r="2.7"/><path d="M8.3 8l11 9.2M8.3 16l11-9.2"/></svg>',
  type: '<svg class="i" viewBox="0 0 24 24"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>',
  meet: '<svg class="i" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 20a5 5 0 0 0-2.500-4.300"/></svg>',
  lock: '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  ia: '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13.5h.01M14.5 13.5h.01M9.5 17h5"/></svg>',
  otras: '<svg class="i" viewBox="0 0 24 24"><path d="M8.5 12c0-2.2-1.6-3.5-3.2-3.5S2 9.8 2 12s1.600 3.500 3.300 3.500c3 0 5.400-7 8.700-7 1.700 0 3.300 1.300 3.300 3.500S15.700 15.500 14 15.500c-3.300 0-5.700-7-8.700-7"/></svg>',
  personal: '<svg class="i" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 3.200 6.400L3.500 20l1.200-3.600A8 8 0 0 1 4 12z"/><path d="M9 12h.01M12 12h.01M15 12h.01"/></svg>',
  documentos: '<svg class="i" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/></svg>',
  correo: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.500 7l8.500 6 8.500-6"/></svg>',
  trabajo: '<svg class="i" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5"/></svg>',
};
const NAV = [
  ['dictado', 'Dictado', 'mic'],
  ['estadisticas', 'Estadísticas', 'stats'],
  ['notas', 'Tomador de notas', 'notas'],
  ['reuniones', 'Reuniones', 'meet'],
  ['perfil', 'Perfil de voz', 'perfil'],
  ['diccionario', 'Diccionario', 'book'],
  ['fragmentos', 'Fragmentos', 'cut'],
  ['estilos', 'Estilos', 'type'],
];

if (navigator.userAgent.includes('FlowLocalApp')) document.documentElement.classList.add('native');
let S = null;
let view = location.hash.slice(1) || 'dictado';
let noteId = null;
let statsTab = 'uso';

// Confirmación en pantalla (confirm() del navegador no funciona dentro de la app de Mac)
function confirmClick(btn, label = '¿Seguro? Pulsa otra vez') {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.dataset.orig = btn.textContent;
  btn.textContent = label;
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.orig;
  }, 3000);
  return false;
}

const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const save = (key, body) => api(`/api/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const load = async () => {
  S = await api('/api/state');
  S.mics = await api('/api/mics').catch(() => []);
};

// Grabación desde el navegador: el audio se manda al mismo endpoint que usa el helper de fn
let rec = null;
let chunks = [];
let stream = null;
async function startRec() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
}
function stopRec() {
  return new Promise((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.stop();
  });
}
function recorderFor(btn, status, onText) {
  let recording = false;
  return async () => {
    if (!recording) {
      try {
        await startRec();
      } catch (err) {
        status.textContent = 'Sin permiso de micrófono: ' + err.message;
        return;
      }
      recording = true;
      btn.classList.add('live');
      status.textContent = 'Grabando… pulsa otra vez para parar';
      return;
    }
    recording = false;
    btn.classList.remove('live');
    status.textContent = 'Transcribiendo…';
    try {
      const blob = await stopRec();
      const res = await fetch('/api/transcribe?source=web', { method: 'POST', body: blob });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      status.textContent = j.text ? 'Listo' : 'No se escuchó nada';
      if (j.text) onText(j);
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
    }
  };
}

function nav() {
  $('#nav').innerHTML =
    '<div class="brand">Flow Local <span style="font-size:11px;font-weight:500;color:var(--muted,#888);border:1px solid currentColor;border-radius:6px;padding:0 5px;margin-left:4px;opacity:.7">beta 0.1</span></div>' +
    NAV.map(([id, label, ico]) => `<button data-v="${id}" title="${label}" class="${view === id ? 'on' : ''}"><span class="ico">${ICONS[ico]}</span>${label}</button>`).join('') +
    `<div class="local">Todo corre en tu Mac, sin límite semanal.<br>Modelo whisper: ${esc(S.profile.model)}</div>`;
}
$('#nav').onclick = (e) => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  view = b.dataset.v;
  location.hash = view;
  render();
};

// ---------- Dictado ----------
const fmtClock = (iso) => new Date(iso).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
function dayLabel(iso) {
  const d = new Date(iso);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return 'Hoy';
  if (d.toDateString() === y.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

function viewDictado() {
  const s = S.stats;
  let last = '';
  const rows =
    S.history.map((e) => {
      const label = dayLabel(e.at);
      const head = label !== last ? `<div class="daylabel">${esc(label)}</div>` : '';
      last = label;
      return `${head}<div class="entry">
        <span class="time">${fmtClock(e.at)}</span>
        <span class="body">${esc(e.text)}</span>
        <span class="acts">
          <button class="iconbtn" data-copy="${e.id}" title="Copiar">⧉</button>
          <button class="iconbtn" data-del="${e.id}" title="Borrar">×</button>
        </span>
      </div>`;
    }).join('') || '<p class="muted" style="margin-top:24px">Aún no hay dictados. Mantén fn en cualquier app o pulsa Dictar.</p>';
  const name = S.profile.name ? `, ${esc(S.profile.name)}` : '';
  return `
    <h1>Hola de nuevo${name}</h1>
    <div class="two">
      <div>
        <div class="dictate">
          <button id="rec" class="btn-mic" title="Dictar">${ICONS.mic}<span>Dictar</span></button>
          <span id="status">o mantén fn en cualquier app</span>
        </div>
        <div class="history">${rows}</div>
      </div>
      <aside class="summary">
        <div class="stat"><span class="n">${fmtK(s.totalWords)}</span>palabras totales</div>
        <div class="stat"><span class="n">${s.wpm}</span>ppm</div>
        <div class="stat"><span class="n">${s.streak}</span>días seguidos</div>
        <div class="small muted">Sin límite semanal. Todo corre en tu Mac.</div>
      </aside>
    </div>`;
}
function bindDictado() {
  const toggle = recorderFor($('#rec'), $('#status'), async () => { await load(); render(); });
  $('#rec').onclick = toggle;
  $('#main').onclick = async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) {
      const entry = S.history.find((x) => x.id === c.dataset.copy);
      await navigator.clipboard.writeText(entry.text);
      c.textContent = '✓';
      setTimeout(() => (c.textContent = '⧉'), 900);
      return;
    }
    const d = e.target.closest('[data-del]');
    if (d) {
      await api(`/api/history/${d.dataset.del}`, { method: 'DELETE' });
      await load();
      render();
    }
  };
}

// ---------- Tomador de notas ----------
function viewNotas() {
  const notes = [...S.notes].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (!S.notes.find((n) => n.id === noteId)) noteId = notes[0]?.id ?? null;
  const cur = S.notes.find((n) => n.id === noteId);
  const list =
    notes.map((n) => `
      <div class="item" data-note="${n.id}" style="cursor:pointer;${n.id === noteId ? 'outline:2px solid var(--acc)' : ''}">
        <div class="txt"><b>${esc(n.title || 'Sin título')}</b><div class="meta">${esc((n.body || '').slice(0, 60))}</div></div>
      </div>`).join('') || '<p class="muted">Sin notas.</p>';
  const editor = cur
    ? `<input id="nTitle" value="${esc(cur.title)}" placeholder="Título">
       <textarea id="nBody" style="min-height:360px">${esc(cur.body)}</textarea>
       <div class="row">
         <button class="btn btn-mic" id="nRec">${ICONS.mic}<span>Dictar en la nota</span></button>
         <span id="nStatus" class="muted"></span>
         <button class="btn danger" id="nDel" style="margin-left:auto">Borrar nota</button>
       </div>`
    : '<p class="muted">Crea una nota para empezar.</p>';
  return `
    <h1>Tomador de notas</h1>
    <p class="sub">Escribe o dicta. Se guarda solo.</p>
    <div class="grid" style="grid-template-columns:260px 1fr;align-items:start">
      <div><button class="btn" id="newNote">+ Nueva nota</button><div class="list" style="margin-top:12px">${list}</div></div>
      <div class="stack">${editor}</div>
    </div>`;
}
function bindNotas() {
  $('#main').onclick = async (e) => {
    const n = e.target.closest('[data-note]');
    if (n) {
      noteId = n.dataset.note;
      return render();
    }
    if (e.target.id === 'newNote') {
      const note = { id: crypto.randomUUID(), title: '', body: '', updatedAt: new Date().toISOString() };
      S.notes.push(note);
      noteId = note.id;
      await save('notes', S.notes);
      return render();
    }
    if (e.target.id === 'nDel') {
      if (!confirmClick(e.target)) return;
      S.notes = S.notes.filter((x) => x.id !== noteId);
      noteId = null;
      await save('notes', S.notes);
      render();
    }
  };
  const cur = S.notes.find((n) => n.id === noteId);
  if (!cur) return;
  let timer;
  const persist = () => {
    cur.title = $('#nTitle').value;
    cur.body = $('#nBody').value;
    cur.updatedAt = new Date().toISOString();
    clearTimeout(timer);
    timer = setTimeout(() => save('notes', S.notes).catch(() => {}), 400);
  };
  $('#nTitle').oninput = persist;
  $('#nBody').oninput = persist;
  $('#nRec').onclick = recorderFor($('#nRec'), $('#nStatus'), (j) => {
    const ta = $('#nBody');
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos);
    const sep = before && !/\s$/.test(before) ? ' ' : '';
    ta.value = before + sep + j.text + ta.value.slice(pos);
    persist();
  });
}

// ---------- Reuniones (Notetaker) ----------
let meetPoll = null;
let meetTick = null;
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const meetText = (m) => m.segments.map((x) => `[${fmtDur(x.at)}] ${x.text}`).join('\n');

function viewReuniones() {
  const active = S.meetings.find((m) => m.id === S.activeMeeting);
  const past = S.meetings.filter((m) => m.id !== S.activeMeeting);
  const top = active
    ? `<div class="card">
         <div class="row"><span class="recdot"></span><b>Grabando</b><span id="elapsed" class="muted">0:00</span>
           <button class="btn danger" id="mStop" style="margin-left:auto">Terminar reunión</button></div>
         <div class="transcript">${active.segments.length ? esc(meetText(active)) : '<span class="muted">Escuchando… el texto aparece cada ~30 segundos.</span>'}</div>
       </div>`
    : `<div class="card stack" style="max-width:700px">
         <input id="mTitle" placeholder="Nombre de la reunión (opcional)">
         <label class="stack"><span class="muted">Entrada de audio</span>
           <select id="mMic"><option value="">Predeterminada (${esc(S.mics[0]?.name || 'ninguna')})</option>${S.mics.map((m) => `<option value="${esc(m.name)}" ${m.name === S.profile.mic ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
         </label>
         <div class="row"><button class="btn" id="mStart">Iniciar reunión</button><span id="mMsg" class="muted"></span></div>
         <p class="muted small" style="margin:0">Graba el audio elegido y lo transcribe cada 30 segundos con el modelo local. Con el micrófono solo se oye tu voz y lo que salga por los altavoces; para incluir también a los demás en Zoom o Meet, elige un dispositivo de audio virtual (como BlackHole). Avisa a los participantes de que estás grabando.</p>
       </div>`;
  const list =
    past.map((m) => {
      const dur = m.endedAt ? fmtDur((new Date(m.endedAt) - new Date(m.startedAt)) / 1000) : '—';
      const wordsCount = m.segments.reduce((a, x) => a + x.text.split(/\s+/).length, 0);
      const state = m.status === 'error' ? `Error: ${esc(m.error || '')}` : m.status === 'interrupted' ? 'Interrumpida' : '';
      return `<details class="item meet">
        <summary><b>${esc(m.title)}</b><span class="muted"> · ${fmtTime(m.startedAt)} · ${dur} · ${wordsCount} palabras ${state}</span></summary>
        <div class="transcript">${m.segments.length ? esc(meetText(m)) : '<span class="muted">Sin texto.</span>'}</div>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost" data-mcopy="${m.id}">Copiar</button>
          <button class="btn ghost" data-mnote="${m.id}">Guardar como nota</button>
          <button class="btn danger" data-mdel="${m.id}">Borrar</button>
        </div>
      </details>`;
    }).join('') || '<p class="muted">Todavía no hay reuniones.</p>';
  return `
    <h1>Reuniones</h1>
    <p class="sub">Transcribe una reunión completa. Todo queda en tu Mac.</p>
    ${top}
    <h2>Historial</h2>
    <div class="list">${list}</div>`;
}

function bindReuniones() {
  const active = S.meetings.find((m) => m.id === S.activeMeeting);
  if (active) {
    const tick = () => {
      const el = $('#elapsed');
      if (el) el.textContent = fmtDur((Date.now() - new Date(active.startedAt)) / 1000);
    };
    tick();
    meetTick = setInterval(tick, 1000);
    meetPoll = setInterval(async () => {
      await load();
      if (view === 'reuniones') render();
    }, 3000);
  }
  const call = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  $('#main').onclick = async (e) => {
    const id = e.target.dataset;
    if (e.target.id === 'mStart') {
      try {
        e.target.disabled = true;
        await call('/api/meetings/start', { title: $('#mTitle').value, mic: $('#mMic').value });
        await load();
        render();
      } catch (err) {
        e.target.disabled = false;
        $('#mMsg').textContent = err.message;
      }
    } else if (e.target.id === 'mStop') {
      e.target.disabled = true;
      e.target.textContent = 'Procesando…';
      await call('/api/meetings/stop');
      await load();
      render();
    } else if (id.mcopy) {
      await navigator.clipboard.writeText(meetText(S.meetings.find((m) => m.id === id.mcopy)));
      e.target.textContent = '¡Copiado!';
    } else if (id.mnote) {
      const m = S.meetings.find((x) => x.id === id.mnote);
      S.notes.push({ id: crypto.randomUUID(), title: m.title, body: meetText(m), updatedAt: new Date().toISOString() });
      await save('notes', S.notes);
      e.target.textContent = 'Guardada en Notas';
    } else if (id.mdel) {
      if (!confirmClick(e.target)) return;
      await api(`/api/meetings/${id.mdel}`, { method: 'DELETE' });
      await load();
      render();
    }
  };
}

// ---------- Estadísticas (Tu uso) ----------
function gauge(wpm) {
  // Medio círculo que se llena según tu ritmo (200 ppm = lleno)
  const frac = Math.max(0.02, Math.min(1, wpm / 200));
  const r = 62;
  const len = Math.PI * r;
  return `<svg viewBox="0 0 160 90" class="gauge"><path d="M18 82a62 62 0 0 1 124 0" fill="none" stroke="var(--line)" stroke-width="16" stroke-linecap="round"/>
    <path d="M18 82a62 62 0 0 1 124 0" fill="none" stroke="var(--acc)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(len * frac).toFixed(1)} ${len.toFixed(1)}"/></svg>`;
}

// Calendario por día de la semana (filas) y semanas (columnas), con meses y leyenda
function calendar(days) {
  const first = new Date(days[0].day + 'T12:00:00');
  const cells = [...Array(first.getDay()).fill(null), ...days];
  const weeks = Math.ceil(cells.length / 7);
  const max = Math.max(1, ...days.map((d) => d.words));
  const shade = (w) => {
    if (!w) return 'var(--line)';
    const q = w / max;
    return `color-mix(in srgb, var(--acc) ${q > 0.75 ? 100 : q > 0.5 ? 75 : q > 0.25 ? 50 : 28}%, #fff)`;
  };
  let lastMonth = -1;
  let lastCol = -9;
  const months = [];
  for (let c = 0; c < weeks; c++) {
    const cell = cells.slice(c * 7, c * 7 + 7).find(Boolean);
    const m = cell ? new Date(cell.day + 'T12:00:00').getMonth() : lastMonth;
    if (m !== lastMonth && c - lastCol >= 3) {
      lastCol = c;
      months.push(`<span style="grid-column:${c + 1}">${new Date(2000, m, 1).toLocaleDateString('es', { month: 'short' })}</span>`);
      lastMonth = m;
    }
  }
  const dayNames = ['Dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'Sáb'];
  const grid = cells.map((d) => (d ? `<i title="${d.day}: ${d.words} palabras" style="background:${shade(d.words)}"></i>` : '<i style="visibility:hidden"></i>')).join('');
  return `<div class="cal2">
    <div></div><div class="months" style="grid-template-columns:repeat(${weeks},minmax(0,1fr))">${months.join('')}</div>
    <div class="dnames">${dayNames.map((n) => `<span>${n}</span>`).join('')}</div>
    <div class="cgrid" style="grid-template-columns:repeat(${weeks},minmax(0,1fr))">${grid}</div>
  </div>
  <div class="legend"><span>Más</span>${[100, 75, 50, 28].map((p) => `<i style="background:color-mix(in srgb, var(--acc) ${p}%, #fff)"></i>`).join('')}<span>Menos</span></div>`;
}

// Cuántos días del calendario caben legibles según el ancho de la ventana
const calDays = () => (innerWidth > 1250 ? 22 : innerWidth > 1000 ? 16 : 11) * 7;

function viewEstadisticas() {
  const s = S.stats;
  const tabs = `<div class="tabs"><button data-tab="uso" class="${statsTab === 'uso' ? 'on' : ''}">Tu uso</button><button data-tab="voz" class="${statsTab === 'voz' ? 'on' : ''}">Tu voz</button></div>`;
  const head = `<div class="row" style="justify-content:space-between;align-items:flex-start"><h1>Estadísticas</h1><button class="btn ghost" id="share">Copiar resumen</button></div>${tabs}`;
  return head + (statsTab === 'uso' ? statsUso(s) : statsVoz(s));
}

function statsUso(s) {
  const times = s.wpm ? (s.wpm / 40).toFixed(1) : '0';
  const styleFixes = Math.max(0, s.wordsCorrected - s.corrections);
  const cats = s.categories
    .map((c) => `<div class="catrow"><span class="cicon">${ICONS[c.key] || ICONS.otras}</span>
      <div class="catbar"><span class="${c.count ? '' : 'zero'}" style="width:${Math.max(c.pct, c.count ? 7 : 0)}%">${c.pct ? c.pct + '%' : ''}</span></div>
      <span class="clabel">${c.count} ${esc(c.label)}</span></div>`).join('');
  return `
    <p class="sub">Tu uso desde ${fmtDate(s.since)}.</p>
    <div class="grid3">
      <div class="card"><div class="big">${s.wpm}</div><div class="label">Palabras por minuto</div>${gauge(s.wpm)}<div class="muted small center">≈ ${times}× más rápido que escribir (40 ppm)</div></div>
      <div class="card"><div class="big">${s.wordsCorrected.toLocaleString('en-US')}</div><div class="label">Correcciones hechas por Flow</div>
        <hr><div class="kv"><b>${styleFixes}</b> palabras corregidas<br><span class="muted small">muletillas, abreviaturas y estilo</span></div>
        <div class="kv"><b>${s.corrections}</b> correcciones de diccionario</div></div>
      <div class="card"><div class="big">${s.totalWords.toLocaleString('en-US')}</div><div class="label">Total de palabras dictadas</div>
        <hr><div class="kv">${ICONS.mic} Escritorio<br>${s.totalWords.toLocaleString('en-US')} palabras<br><span class="muted small">${s.dictations} dictados · hoy ${s.todayWords} · semana ${s.week}</span></div></div>
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card catcard"><div class="cardhead"><h2>Uso en escritorio</h2><span class="label">Total de aplicaciones usadas | ${s.appsUsed}</span></div>${cats}</div>
      <div class="card"><div class="cardhead"><h2>Racha de ${s.streak} días</h2><span class="label">Racha más larga | ${s.longestStreak} días</span></div>${calendar(s.calendar.slice(-calDays()))}</div>
    </div>`;
}

function statsVoz(s) {
  const vp = s.voiceProfile;
  const n = (x) => Math.round(x).toLocaleString('en-US');
  const info = `Tu perfil se actualiza al desbloquear cada nivel y después cada ${n(vp.refresh)} palabras.`;
  const bar = (frac) => `<div class="vp-bar"><span style="width:${Math.max(2, Math.round(frac * 100))}%"></span></div>`;
  const locked = (label, at) => `<div class="card locked"><div class="lockrow">${ICONS.lock}<span>Se desbloquea a las ${n(at)} palabras</span></div><div class="label">${label}</div></div>`;
  const q = (x) => (x ? `“${esc(x)}”` : '—');

  if (!vp.unlocked) {
    return `
      ${bar(vp.cycle)}
      <div class="vp-meta"><span>Perfil de voz bloqueado</span><span class="muted" title="${esc(info)}">Se desbloquea en ${n(vp.nextUpdateIn)} palabras más ⓘ</span></div>
      <div class="hero card"><h2 class="serif">Tu perfil se está formando</h2><div class="label">Perfil de voz</div>
        <p>Llevas ${n(vp.words)} de ${n(vp.unlockAt)} palabras. Al llegar, Flow Local descubrirá tu arquetipo y tu mejor momento para dictar; después irás desbloqueando más cartas con cada nivel.</p></div>
      <div class="grid2" style="margin-top:16px;align-items:start">
        <div class="stack">${locked('Frase distintiva', vp.locks.phrase)}${locked('Palabra más usada', vp.locks.word)}${locked('Palabra más corregida', vp.locks.fixed)}</div>
        ${locked('Tu mejor momento y lugar', vp.unlockAt)}
      </div>`;
  }

  const v = vp.snapshot;
  const lvl = vp.level;
  const slot = v.bestSlot ? `${DAYS[v.bestSlot.weekday]}, ${v.bestSlot.hour}:00` : 'Aún sin datos';
  const slotText = v.bestSlot
    ? `Los ${DAYS[v.bestSlot.weekday]} a las ${v.bestSlot.hour}:00 sueles dictar más${v.bestSlot.app ? `, sobre todo en ${esc(v.bestSlot.app)}` : ''}.`
    : 'Dicta unas cuantas veces más y aquí aparecerá tu mejor momento.';
  const next = lvl < vp.maxLevel
    ? ` · Siguiente nivel: ${n(vp.nextUpdateIn)} palabras más`
    : '';
  return `
    ${bar(vp.cycle)}
    <div class="vp-meta"><span>Creado el ${fmtDate(vp.createdAt)} · actualizado el ${fmtDate(vp.updatedAt)}</span><span class="muted" title="${esc(info)}">Próxima actualización en ${n(vp.nextUpdateIn)} palabras más ⓘ</span></div>
    <div class="hero card"><h2 class="serif">${esc(v.archetype.name)}</h2><div class="label">Perfil de voz · Nivel ${lvl} de ${vp.maxLevel}</div><p>${esc(v.archetype.description)}</p>
      <div class="levels">${Array.from({ length: vp.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}<span class="muted small">${lvl < vp.maxLevel ? `Nivel ${lvl + 1} a las ${n([vp.unlockAt, ...Object.values(vp.locks)][lvl])} palabras` : 'Nivel máximo'}</span></div></div>
    <div class="grid2" style="margin-top:16px;align-items:start">
      <div class="stack">
        ${lvl >= 2 ? `<div class="card"><div class="quote">${q(v.topPhrase?.phrase)}</div><div class="label">Frase distintiva</div></div>` : locked('Frase distintiva', vp.locks.phrase)}
        ${lvl >= 3 ? `<div class="card"><div class="quote">${q(v.topWord?.word)}</div><div class="label">Palabra más usada</div></div>` : locked('Palabra más usada', vp.locks.word)}
        ${lvl >= 4 ? `<div class="card"><div class="quote">${q(v.topFixed?.word)}</div><div class="label">Palabra más corregida</div></div>` : locked('Palabra más corregida', vp.locks.fixed)}
      </div>
      <div class="card"><div class="quote" style="font-size:34px">${esc(slot)}</div><div class="label">Tu mejor momento y lugar</div><p style="margin-top:18px">${slotText}</p></div>
    </div>`;
}

function bindEstadisticas() {
  $('#main').onclick = async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      statsTab = t.dataset.tab;
      return render();
    }
    if (e.target.id === 'share') {
      const s = S.stats;
      await navigator.clipboard.writeText(`Con Flow Local dicté ${s.totalWords.toLocaleString('en-US')} palabras a ${s.wpm} ppm, ${s.streak} días seguidos.`);
      e.target.textContent = '¡Copiado!';
      setTimeout(() => (e.target.textContent = 'Copiar resumen'), 1500);
    }
  };
}

// ---------- Perfil de voz (Tu voz + configuración) ----------
function viewPerfil() {
  const p = S.profile;
  return `
    <h1>Perfil de voz</h1>
    <p class="sub">Ajustes de cómo te escucha Flow Local. Tu perfil y tus estadísticas de voz están en Estadísticas → Tu voz.</p>
    <div class="card stack" style="max-width:620px">
      <label class="stack"><span class="muted">Nombre</span><input id="pName" value="${esc(p.name)}"></label>
      <label class="stack"><span class="muted">Idioma</span>
        <select id="pLang">${S.languages.map((l) => `<option value="${l}" ${l === p.language ? 'selected' : ''}>${LANG_NAMES[l]}</option>`).join('')}</select>
      </label>
      <label class="stack"><span class="muted">Micrófono</span>
        <select id="pMic"><option value="">Predeterminado (${esc(S.mics[0]?.name || 'ninguno')})</option>${S.mics.map((m) => `<option value="${esc(m.name)}" ${m.name === p.mic ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      </label>
      <label class="stack"><span class="muted">Modelo de transcripción</span>
        <select id="pModel">${S.models.map((m) => `<option value="${m}" ${m === p.model ? 'selected' : ''}>${MODEL_LABELS[m] || m}</option>`).join('')}</select>
      </label>
      <label class="stack"><span class="muted">Contexto: nombres, marcas y jerga que quieres que reconozca</span><textarea id="pCtx">${esc(p.context)}</textarea></label>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="pAuto" style="width:auto" ${p.autoVocab !== false ? 'checked' : ''}><span>Vocabulario automático: añade tus nombres y términos más usados al contexto del modelo</span></label>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="pEnter" style="width:auto" ${p.pressEnter ? 'checked' : ''}><span>Presionar Enter al terminar un dictado con manos libres (doble toque de fn)</span></label>
      <div class="row"><button class="btn" id="pSave">Guardar</button><span id="pMsg" class="muted"></span></div>
    </div>`;
}
function bindPerfil() {
  $('#pSave').onclick = async () => {
    try {
      await save('profile', {
        name: $('#pName').value,
        language: $('#pLang').value,
        model: $('#pModel').value,
        mic: $('#pMic').value,
        pressEnter: $('#pEnter').checked,
        autoVocab: $('#pAuto').checked,
        context: $('#pCtx').value,
      });
      await load();
      render();
      $('#pMsg').textContent = 'Guardado';
    } catch (e) {
      $('#pMsg').textContent = e.message;
    }
  };
}

// ---------- Diccionario ----------
function viewDiccionario() {
  const rows =
    S.dictionary.map((d, i) => `<div class="item"><div class="txt"><b>${esc(d.from)}</b> → ${esc(d.to)}</div><button class="iconbtn" data-ddel="${i}" title="Borrar">🗑</button></div>`).join('') ||
    '<p class="muted">Sin entradas. Agrega palabras que Flow escribe mal: nombres, marcas, jerga.</p>';
  return `
    <h1>Diccionario</h1>
    <p class="sub">Cambia palabras automáticamente después de transcribir.</p>
    <div class="card row" style="max-width:760px">
      <input id="dFrom" placeholder="Lo que dice Flow (ej. cloud code)" style="flex:1">
      <input id="dTo" placeholder="Cómo debe escribirse (ej. Claude Code)" style="flex:1">
      <button class="btn" id="dAdd">Agregar</button>
    </div>
    ${(S.suggestions?.vocab || []).length ? `<h2>Sugerencias</h2>
    <p class="muted" style="max-width:760px">Nombres y términos que dictas seguido. Si los agregas al vocabulario, el modelo los reconoce mejor.</p>
    <div class="list">${S.suggestions.vocab.map((v) => `<div class="item"><div class="txt"><b>${esc(v.term)}</b> <span class="meta">${v.count} veces</span></div><button class="btn" data-vadd="${esc(v.term)}">Agregar</button></div>`).join('')}</div>` : ''}
    <h2>Entradas</h2>
    <div class="list">${rows}</div>`;
}
function bindDiccionario() {
  $('#dAdd').onclick = async () => {
    const from = $('#dFrom').value.trim();
    const to = $('#dTo').value.trim();
    if (!from || !to) return;
    await save('dictionary', [...S.dictionary, { from, to }]);
    await load();
    render();
  };
  $('#main').onclick = async (e) => {
    const v = e.target.closest('[data-vadd]');
    if (v) {
      const p = S.profile;
      await save('profile', { ...p, context: [p.context, v.dataset.vadd].filter(Boolean).join(', ') });
      await load();
      return render();
    }
    const b = e.target.closest('[data-ddel]');
    if (!b) return;
    await save('dictionary', S.dictionary.filter((_, i) => i !== Number(b.dataset.ddel)));
    await load();
    render();
  };
}

// ---------- Fragmentos ----------
function viewFragmentos() {
  const rows =
    S.snippets.map((s, i) => `<div class="item"><div class="txt"><b>${esc(s.trigger)}</b><div class="meta">${esc(s.text)}</div></div><button class="iconbtn" data-sdel="${i}" title="Borrar">🗑</button></div>`).join('') ||
    '<p class="muted">Sin fragmentos. Di una frase corta y Flow la reemplaza por un texto largo, por ejemplo tu correo o tu dirección.</p>';
  return `
    <h1>Fragmentos</h1>
    <p class="sub">Atajos de texto: si dictas el disparador, se escribe el texto completo.</p>
    <div class="card stack" style="max-width:760px">
      <input id="sTrig" placeholder="Disparador (ej. mi correo)">
      <textarea id="sText" style="min-height:90px" placeholder="Texto que se escribe"></textarea>
      <div><button class="btn" id="sAdd">Agregar fragmento</button></div>
    </div>
    <h2>Fragmentos</h2>
    <div class="list">${rows}</div>`;
}
function bindFragmentos() {
  $('#sAdd').onclick = async () => {
    const trigger = $('#sTrig').value.trim();
    const text = $('#sText').value.trim();
    if (!trigger || !text) return;
    await save('snippets', [...S.snippets, { trigger, text }]);
    await load();
    render();
  };
  $('#main').onclick = async (e) => {
    const b = e.target.closest('[data-sdel]');
    if (!b) return;
    await save('snippets', S.snippets.filter((_, i) => i !== Number(b.dataset.sdel)));
    await load();
    render();
  };
}

// ---------- Estilos ----------
function viewEstilos() {
  const opts = S.styles
    .map((id) => {
      const [name, desc, ex] = STYLE_INFO[id];
      return `<label class="opt ${S.style === id ? 'on' : ''}">
        <input type="radio" name="style" value="${id}" ${S.style === id ? 'checked' : ''}>
        <div><div style="font-weight:600">${name}</div><div class="muted" style="margin:4px 0">${desc}</div><div class="muted" style="font-size:13px"><i>${esc(ex)}</i></div></div>
      </label>`;
    })
    .join('');
  return `
    <h1>Estilos</h1>
    <p class="sub">Cómo se escribe el texto después de transcribirlo.</p>
    <div class="stack" style="max-width:680px">${opts}</div>
    ${(S.suggestions?.styles || []).length ? `<h2>Recomendado para ti</h2>
    <div class="list" style="max-width:680px">${S.suggestions.styles.map((x) => `<div class="item"><div class="txt">Dictas mucho en <b>${esc(x.app)}</b> (${x.dictations} veces). ¿Usar estilo <b>${STYLE_INFO[x.style][0]}</b> ahí?</div><button class="btn" data-sadd="${esc(x.app)}|${x.style}">Aplicar</button></div>`).join('')}</div>` : ''}
    <h2>Estilo según la app</h2>
    <p class="muted" style="max-width:680px">Si dictas en una app de esta lista, se usa su estilo en vez del general. Escribe parte del nombre, por ejemplo WhatsApp o Mail.</p>
    <div class="card row" style="max-width:680px">
      <input id="aApp" list="knownApps" placeholder="Nombre de la app" style="flex:1">
      <datalist id="knownApps">${(S.knownApps || []).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
      <select id="aStyle" style="width:auto">${S.styles.map((id) => `<option value="${id}">${STYLE_INFO[id][0]}</option>`).join('')}</select>
      <button class="btn" id="aAdd">Agregar</button>
    </div>
    <div class="list" style="max-width:680px;margin-top:12px">${
      (S.appStyles || []).map((r, i) => `<div class="item"><div class="txt"><b>${esc(r.app)}</b> → ${STYLE_INFO[r.style]?.[0] || r.style}</div><button class="iconbtn" data-adel="${i}" title="Borrar">🗑</button></div>`).join('') ||
      '<p class="muted">Sin reglas todavía.</p>'
    }</div>`;
}
function bindEstilos() {
  $('#main').onchange = async (e) => {
    if (e.target.name !== 'style') return;
    await save('style', e.target.value);
    await load();
    render();
  };
  $('#aAdd').onclick = async () => {
    const app = $('#aApp').value.trim();
    if (!app) return;
    await save('appstyles', [...S.appStyles, { app, style: $('#aStyle').value }]);
    await load();
    render();
  };
  $('#main').onclick = async (e) => {
    const sg = e.target.closest('[data-sadd]');
    if (sg) {
      const [app, style] = sg.dataset.sadd.split('|');
      await save('appstyles', [...S.appStyles, { app, style }]);
      await load();
      return render();
    }
    const b = e.target.closest('[data-adel]');
    if (!b) return;
    await save('appstyles', S.appStyles.filter((_, i) => i !== Number(b.dataset.adel)));
    await load();
    render();
  };
}

const VIEWS = {
  dictado: [viewDictado, bindDictado],
  notas: [viewNotas, bindNotas],
  reuniones: [viewReuniones, bindReuniones],
  estadisticas: [viewEstadisticas, bindEstadisticas],
  perfil: [viewPerfil, bindPerfil],
  diccionario: [viewDiccionario, bindDiccionario],
  fragmentos: [viewFragmentos, bindFragmentos],
  estilos: [viewEstilos, bindEstilos],
};

// Avisos de la beta: qué limitaciones tiene cada sección
const WARNINGS = {
  notas: 'Las notas se guardan solo en este Mac (en data/db.json). Todavía no hay sincronización, exportación ni búsqueda.',
  reuniones: 'Solo graba tu micrófono: en una llamada, la otra persona se oye únicamente si va por altavoz. Se transcribe en tramos de 30 s y, en los silencios, Whisper a veces inventa frases. No cierres la app durante la reunión: si se cierra, queda como "Interrumpida" y se pierde el audio del último tramo.',
  perfil: 'Cambiar de modelo carga otro en memoria: el primer dictado después del cambio tarda más. Los modelos grandes (turbo) necesitan más RAM; si tu Mac va justo, usa small.',
  diccionario: 'Reemplaza texto exacto después de transcribir, sin distinguir contexto. Funciona si Whisper escribe siempre igual lo que pones en "Lo que dice Flow". Las sugerencias salen de tu historial y mejoran con el uso.',
  fragmentos: 'El disparador tiene que dictarse completo y tal cual; Whisper puede escribirlo distinto (otra puntuación o una palabra parecida) y entonces no se activa.',
  estilos: 'Son reglas simples (mayúsculas, puntuación, muletillas): no reescriben ni traducen. La regla por app busca el nombre dentro del nombre de la app, así que usa una parte única como "WhatsApp".',
};
const warnBox = (v) => (WARNINGS[v] ? `<div class="warn"><b>Beta · limitaciones</b><br>${WARNINGS[v]}</div>` : '');

// Enter en un campo de texto equivale a pulsar el botón de su formulario
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT' || e.target.type === 'checkbox' || e.target.type === 'radio') return;
  const btn = e.target.closest('.card')?.querySelector('button.btn');
  if (btn) {
    e.preventDefault();
    btn.click();
  }
});

function render() {
  if (!VIEWS[view]) view = 'dictado';
  clearInterval(meetPoll);
  clearInterval(meetTick);
  nav();
  $('#main').onclick = null;
  $('#main').onchange = null;
  $('#main').innerHTML = warnBox(view) + VIEWS[view][0]();
  VIEWS[view][1]();
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => view === 'estadisticas' && render(), 200);
});

window.addEventListener('hashchange', () => {
  view = location.hash.slice(1) || 'dictado';
  render();
});

await load();
render();
