const { Engine, World, Bodies, Body, Events, Query, Composite } = Matter;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

let W = window.innerWidth;
let H = window.innerHeight;

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const engine = Engine.create();
engine.gravity.y = 1;

// ---- かな ----
const KANA_ROWS = [
  'あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの',
  'はひふへほ', 'まみむめも', 'や ゆ よ', 'らりるれろ', 'わ を ん',
  'がぎぐげご', 'ざじずぜぞ', 'だぢづでど', 'ばびぶべぼ', 'ぱぴぷぺぽ',
];

function toKatakana(ch) {
  return String.fromCharCode(ch.charCodeAt(0) + 0x60);
}

let kanaMode = 'hira';
let selectedKana = 'あ';

const kanaPanel = document.getElementById('kana-panel');
const kanaGrid = document.getElementById('kana-grid');
const tabHira = document.getElementById('tab-hira');
const tabKata = document.getElementById('tab-kata');

function buildKanaGrid() {
  kanaGrid.innerHTML = '';
  for (const row of KANA_ROWS) {
    for (const ch of row) {
      const btn = document.createElement('button');
      if (ch === ' ') {
        btn.disabled = true;
      } else {
        const kana = kanaMode === 'hira' ? ch : toKatakana(ch);
        btn.textContent = kana;
        if (kana === selectedKana) btn.classList.add('selected');
        btn.addEventListener('click', () => {
          selectedKana = kana;
          buildKanaGrid();
          updateHint();
        });
      }
      kanaGrid.appendChild(btn);
    }
  }
}

tabHira.addEventListener('click', () => {
  kanaMode = 'hira';
  tabHira.classList.add('active');
  tabKata.classList.remove('active');
  buildKanaGrid();
});
tabKata.addEventListener('click', () => {
  kanaMode = 'kata';
  tabKata.classList.add('active');
  tabHira.classList.remove('active');
  buildKanaGrid();
});
buildKanaGrid();

// ---- おと ----
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const soundCache = new Map();

function toHiragana(ch) {
  const c = ch.charCodeAt(0);
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
}

function ensureSound(char) {
  const key = toHiragana(char);
  if (soundCache.has(key)) return;
  const b64 = typeof KANA_SOUNDS !== 'undefined' && KANA_SOUNDS[key];
  if (!b64) {
    soundCache.set(key, 'failed');
    return;
  }
  soundCache.set(key, 'loading');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  audioCtx.decodeAudioData(bytes.buffer)
    .then(buffer => {
      const data = buffer.getChannelData(0);
      let i = 0;
      while (i < data.length && Math.abs(data[i]) < 0.01) i++;
      soundCache.set(key, { buffer, offset: i / buffer.sampleRate });
    })
    .catch(() => soundCache.set(key, 'failed'));
}

let jaVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('ja'));
  jaVoice = voices.find(v => v.localService) || voices[0] || null;
}
speechSynthesis.addEventListener('voiceschanged', pickVoice);
pickVoice();

function speak(text) {
  const sound = soundCache.get(toHiragana(text));
  if (sound && sound.buffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = sound.buffer;
    src.connect(audioCtx.destination);
    src.start(0, sound.offset);
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  if (jaVoice) u.voice = jaVoice;
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

let warmedUp = false;
function warmUpSpeech() {
  if (warmedUp) return;
  warmedUp = true;
  audioCtx.resume();
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

// ---- ぶったい ----
function makeLetter(x, y, char) {
  ensureSound(char);
  const body = Bodies.rectangle(x, y, 72, 72, { isStatic: true });
  body.plugin = { kind: 'letter', char, scale: 1 };
  World.add(engine.world, body);
  return body;
}

function enlargeLetter(body) {
  if (body.plugin.scale >= 3) return;
  Body.scale(body, 1.25, 1.25);
  body.plugin.scale *= 1.25;
}

function makeWallAt(x, y, len, angle) {
  len = Math.max(len, 40);
  const body = Bodies.rectangle(x, y, len, 26, { isStatic: true, angle });
  body.plugin = { kind: 'wall', len };
  World.add(engine.world, body);
  return body;
}

function makeWall(x1, y1, x2, y2) {
  return makeWallAt((x1 + x2) / 2, (y1 + y2) / 2,
    Math.hypot(x2 - x1, y2 - y1), Math.atan2(y2 - y1, x2 - x1));
}

function makeCircle(x, y) {
  const body = Bodies.circle(x, y, 32, { isStatic: true, restitution: 0.8 });
  body.plugin = { kind: 'circle' };
  World.add(engine.world, body);
  return body;
}

function makeTriangle(x, y) {
  const body = Bodies.polygon(x, y, 3, 48, { isStatic: true, angle: -Math.PI / 2 });
  body.plugin = { kind: 'triangle' };
  World.add(engine.world, body);
  return body;
}

const spawnPoint = { x: 60, y: 105 };

function spawnBall() {
  const body = Bodies.circle(spawnPoint.x, spawnPoint.y, 22, {
    restitution: 0.65, friction: 0.02, frictionAir: 0.0008, density: 0.002,
  });
  body.plugin = { kind: 'ball' };
  Body.setVelocity(body, { x: W < 700 ? 0.8 : 5, y: 0 });
  World.add(engine.world, body);
  return body;
}

// ---- シェア ----
async function compressToBase64url(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompressFromBase64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function serializeScene() {
  const objs = [];
  for (const b of Composite.allBodies(engine.world)) {
    const kind = b.plugin?.kind;
    const x = Math.round(b.position.x), y = Math.round(b.position.y);
    const a = +b.angle.toFixed(3);
    if (kind === 'letter') objs.push(['L', b.plugin.char, x, y, a, +b.plugin.scale.toFixed(3)]);
    else if (kind === 'wall') objs.push(['W', x, y, Math.round(b.plugin.len), a]);
    else if (kind === 'circle') objs.push(['C', x, y]);
    else if (kind === 'triangle') objs.push(['T', x, y, a]);
  }
  return { v: 1, w: W, h: H, sp: [Math.round(spawnPoint.x), Math.round(spawnPoint.y)], o: objs };
}

function restoreScene(data) {
  const sx = W / data.w, sy = H / data.h;
  spawnPoint.x = data.sp[0] * sx;
  spawnPoint.y = data.sp[1] * sy;
  for (const o of data.o) {
    if (o[0] === 'L') {
      const b = makeLetter(o[2] * sx, o[3] * sy, o[1]);
      Body.setAngle(b, o[4]);
      if (o[5] !== 1) {
        Body.scale(b, o[5], o[5]);
        b.plugin.scale = o[5];
      }
    } else if (o[0] === 'W') {
      makeWallAt(o[1] * sx, o[2] * sy, o[3], o[4]);
    } else if (o[0] === 'C') {
      makeCircle(o[1] * sx, o[2] * sy);
    } else if (o[0] === 'T') {
      Body.setAngle(makeTriangle(o[1] * sx, o[2] * sy), o[3]);
    }
  }
}

// さいしょのレールとサンプル
function initialScene() {
  const tb = document.getElementById('toolbar').getBoundingClientRect().bottom;
  spawnPoint.x = 60;
  spawnPoint.y = tb + 35;
  if (W < 700) {
    makeWall(-20, tb + 60, 110, tb + 90);
    Body.setAngle(makeLetter(160, tb + 240, 'か'), 0.12);
    Body.setAngle(makeLetter(265, tb + 280, 'ら'), 0.05);
    Body.setAngle(makeLetter(350, tb + 348, 'す'), 0.05);
  } else {
    makeWall(-20, tb + 60, 300, tb + 160);
    makeLetter(460, tb + 287, 'か');
    makeLetter(755, tb + 349, 'ら');
    makeLetter(1057, tb + 471, 'す');
  }
}

(async () => {
  const m = location.hash.match(/^#s=(.+)$/);
  if (m) {
    try {
      restoreScene(JSON.parse(await decompressFromBase64url(m[1])));
      return;
    } catch (e) {
      // こわれたURLは初期シーンにフォールバック
    }
  }
  initialScene();
})();

// ---- しょうとつ ----
const effects = [];

Events.on(engine, 'collisionStart', (ev) => {
  const now = performance.now();
  for (const pair of ev.pairs) {
    const a = pair.bodyA, b = pair.bodyB;
    const ball = a.plugin?.kind === 'ball' ? a : b.plugin?.kind === 'ball' ? b : null;
    const other = ball === a ? b : a;
    if (!ball || other.plugin?.kind !== 'letter') continue;
    const cooldowns = other.plugin.cooldowns || (other.plugin.cooldowns = {});
    if (now < (cooldowns[ball.id] || 0)) continue;
    speak(other.plugin.char);
    cooldowns[ball.id] = now + 400;
    other.plugin.hitUntil = now + 300;
    effects.push({ x: other.position.x, y: other.position.y, t0: now });
  }
});

// ---- モードとそうさ ----
let mode = 'select';
const hint = document.getElementById('hint');
const HINTS = {
  select: 'ドラッグでうごかす / ホイールでまわす / もじは2かいタップでかくだい / ⚪はスタートいち',
  letter: () => `「${selectedKana}」をおくばしょをクリック`,
  wall: 'ドラッグしてかべをひく',
  circle: 'おくばしょをクリック',
  triangle: 'おくばしょをクリック',
  erase: 'けしたいものをクリック',
};

function updateHint() {
  const h = HINTS[mode];
  hint.textContent = typeof h === 'function' ? h() : h;
}

document.querySelectorAll('#toolbar .tool').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
    kanaPanel.classList.toggle('hidden', mode !== 'letter');
    canvas.style.cursor = mode === 'select' ? 'grab' : 'default';
    updateHint();
  });
});
updateHint();
canvas.style.cursor = 'grab';

const toolbarEl = document.getElementById('toolbar');
const toolbarScroll = document.getElementById('toolbar-scroll');
function updateToolbarMore() {
  const more = toolbarScroll.scrollWidth - toolbarScroll.clientWidth - toolbarScroll.scrollLeft > 4;
  toolbarEl.classList.toggle('has-more', more);
}
toolbarScroll.addEventListener('scroll', updateToolbarMore);
window.addEventListener('resize', updateToolbarMore);
updateToolbarMore();

document.getElementById('btn-ball').addEventListener('click', () => {
  warmUpSpeech();
  spawnBall();
});

let autoTimer = null;
const btnAuto = document.getElementById('btn-auto');
btnAuto.addEventListener('click', () => {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
    btnAuto.classList.remove('active');
  } else {
    warmUpSpeech();
    spawnBall();
    autoTimer = setInterval(spawnBall, 1500);
    btnAuto.classList.add('active');
  }
});

document.getElementById('btn-clear').addEventListener('click', () => {
  World.clear(engine.world, false);
});

const btnShare = document.getElementById('btn-share');
btnShare.addEventListener('click', async () => {
  const payload = await compressToBase64url(JSON.stringify(serializeScene()));
  const url = `${location.origin}${location.pathname}#s=${payload}`;
  history.replaceState(null, '', `#s=${payload}`);
  if (navigator.share) {
    try {
      await navigator.share({ url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    btnShare.textContent = '✅ コピーしました';
  } catch (e) {
    prompt('このURLをコピーしてください', url);
    btnShare.textContent = '🔗 シェア';
    return;
  }
  setTimeout(() => { btnShare.textContent = '🔗 シェア'; }, 1500);
});

function canvasPos(ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function bodyAt(p) {
  return Query.point(Composite.allBodies(engine.world), p)[0] || null;
}

let dragging = null;
let dragOffset = { x: 0, y: 0 };
let draggingSpawn = false;
let wallStart = null;
let wallPreview = null;
let lastTap = { t: 0, x: 0, y: 0 };

function overSpawnPoint(p) {
  return Math.hypot(p.x - spawnPoint.x, p.y - spawnPoint.y) < 34;
}

canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  warmUpSpeech();
  const p = canvasPos(ev);
  if (mode === 'select') {
    const now = performance.now();
    const doubleTap = now - lastTap.t < 350 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30;
    lastTap = { t: now, x: p.x, y: p.y };
    if (overSpawnPoint(p)) {
      draggingSpawn = true;
      canvas.style.cursor = 'grabbing';
      return;
    }
    const body = bodyAt(p);
    if (body) {
      if (doubleTap && body.plugin?.kind === 'letter') {
        enlargeLetter(body);
        return;
      }
      dragging = body;
      dragOffset = { x: body.position.x - p.x, y: body.position.y - p.y };
      canvas.style.cursor = 'grabbing';
    }
  } else if (mode === 'letter') {
    makeLetter(p.x, p.y, selectedKana);
  } else if (mode === 'wall') {
    wallStart = p;
    wallPreview = p;
  } else if (mode === 'circle') {
    makeCircle(p.x, p.y);
  } else if (mode === 'triangle') {
    makeTriangle(p.x, p.y);
  } else if (mode === 'erase') {
    const body = bodyAt(p);
    if (body) World.remove(engine.world, body);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  const p = canvasPos(ev);
  if (draggingSpawn) {
    spawnPoint.x = p.x;
    spawnPoint.y = p.y;
  } else if (dragging) {
    Body.setPosition(dragging, { x: p.x + dragOffset.x, y: p.y + dragOffset.y });
    Body.setVelocity(dragging, { x: 0, y: 0 });
  } else if (wallStart) {
    wallPreview = p;
  } else if (mode === 'select') {
    canvas.style.cursor = (overSpawnPoint(p) || bodyAt(p)) ? 'pointer' : 'grab';
  }
});

window.addEventListener('pointerup', (ev) => {
  if (wallStart) {
    const p = canvasPos(ev);
    if (Math.hypot(p.x - wallStart.x, p.y - wallStart.y) > 20) {
      makeWall(wallStart.x, wallStart.y, p.x, p.y);
    }
    wallStart = null;
    wallPreview = null;
  }
  dragging = null;
  draggingSpawn = false;
  if (mode === 'select') canvas.style.cursor = 'grab';
});

canvas.addEventListener('wheel', (ev) => {
  if (mode !== 'select') return;
  const body = bodyAt(canvasPos(ev));
  if (body && body.plugin?.kind !== 'ball') {
    ev.preventDefault();
    Body.rotate(body, ev.deltaY > 0 ? 0.08 : -0.08);
  }
}, { passive: false });

// ---- びょうが ----
function drawVertices(body) {
  ctx.beginPath();
  const v = body.vertices;
  ctx.moveTo(v[0].x, v[0].y);
  for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
  ctx.closePath();
}

function render() {
  const now = performance.now();
  ctx.fillStyle = '#00cc00';
  ctx.fillRect(0, 0, W, H);

  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const k = (now - e.t0) / 600;
    if (k >= 1) {
      effects.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.PI / 4);
    const s1 = 70 + k * 180;
    ctx.globalAlpha = 0.3 * (1 - k);
    ctx.fillStyle = '#ffe14d';
    ctx.fillRect(-s1 / 2, -s1 / 2, s1, s1);
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeRect(-s1 / 2, -s1 / 2, s1, s1);
    const s2 = 40 + k * 300;
    ctx.lineWidth = 4;
    ctx.strokeRect(-s2 / 2, -s2 / 2, s2, s2);
    ctx.restore();
  }

  for (const body of Composite.allBodies(engine.world)) {
    const kind = body.plugin?.kind;
    if (kind === 'ball') {
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#f4fbee';
      ctx.fill();
    } else if (kind === 'letter') {
      drawVertices(body);
      ctx.fillStyle = now < (body.plugin.hitUntil || 0) ? '#ffe14d' : '#f5f7e8';
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.fillStyle = '#111';
      ctx.font = `${Math.round(44 * (body.plugin.scale || 1))}px "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(body.plugin.char, 0, 3);
      ctx.restore();
    } else if (kind === 'circle') {
      ctx.beginPath();
      ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#eef2dc';
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 4;
      ctx.stroke();
    } else {
      drawVertices(body);
      ctx.fillStyle = '#eef2dc';
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(spawnPoint.x, spawnPoint.y, 28, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(spawnPoint.x, spawnPoint.y, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (wallStart && wallPreview) {
    ctx.beginPath();
    ctx.moveTo(wallStart.x, wallStart.y);
    ctx.lineTo(wallPreview.x, wallPreview.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

// ---- メインループ ----
let last = performance.now();
function tick(now) {
  const dt = Math.min(now - last, 33);
  last = now;
  Engine.update(engine, dt);

  // がめんのそとにおちたボールをけす
  for (const body of Composite.allBodies(engine.world)) {
    if (body.plugin?.kind === 'ball' &&
        (body.position.y > H + 200 || body.position.x < -200 || body.position.x > W + 200)) {
      World.remove(engine.world, body);
    }
  }

  render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
