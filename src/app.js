import * as THREE from 'three';

const DATA = JSON.parse(document.getElementById('campus-data').textContent);
const F = DATA.f;
const [LAT0, LON0] = DATA.origin;
const M_LAT = 111320, M_LON = 111320 * Math.cos(LAT0 * Math.PI / 180);

// ---------- geometria segédfüggvények (p = lapos [x,z,x,z,...] tömb) ----------
function pip(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function bbox(p) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  return { x0, z0, x1, z1 };
}
function centroid(p) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const f = p[j] * p[i + 1] - p[i] * p[j + 1];
    a += f; cx += (p[j] + p[i]) * f; cz += (p[j + 1] + p[i + 1]) * f;
  }
  if (Math.abs(a) < 1e-6) { let sx = 0, sz = 0, n = p.length / 2; for (let i = 0; i < p.length; i += 2) { sx += p[i]; sz += p[i + 1]; } return [sx / n, sz / n]; }
  return [cx / (3 * a), cz / (3 * a)];
}
function shapeOf(p) {
  const s = new THREE.Shape();
  s.moveTo(p[0], -p[1]);
  for (let i = 2; i < p.length; i += 2) s.lineTo(p[i], -p[i + 1]);
  return s;
}
function area(p) { let a = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += p[j] * p[i + 1] - p[i] * p[j + 1]; return Math.abs(a / 2); }
const toLatLon = (x, z) => [LAT0 - z / M_LAT, LON0 + x / M_LON];
const hash1 = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- jelenet ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const SKY = 0xc2d8ec;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 280, 1500);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 4000);
camera.rotation.order = 'YXZ';

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b6450, 1.1));
const sun = new THREE.DirectionalLight(0xfff3dd, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 1, far: 600 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-180, 260, 120);

// égbolt: színátmenetes kupola a nappal; ugyanebből készül az ablakokban tükröződő környezet
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { cTop: { value: new THREE.Color(0x5b8fd2) }, cHor: { value: new THREE.Color(SKY) }, cGnd: { value: new THREE.Color(0x7d806f) }, sunDir: { value: SUN_OFF.clone().normalize() } },
    vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 cTop, cHor, cGnd, sunDir; varying vec3 vD;
      void main() {
        vec3 d = normalize(vD); float h = d.y;
        vec3 c = h > 0.0 ? mix(cHor, cTop, pow(min(h * 1.5, 1.0), 0.7)) : mix(cHor, cGnd, min(-h * 5.0, 1.0));
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 4.0 + pow(s, 20.0) * 0.15);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial());
sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
const ENV = (() => {
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
  // a horizont alatt sötétebb "városi" sáv, hogy az üveg ne csak eget tükrözzön
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 9, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x6f716c, side: THREE.BackSide }));
  ring.position.y = 1; es.add(ring);
  const t = pm.fromScene(es, 0.015).texture; pm.dispose(); return t;
})();

// ---------- procedurális textúrák ----------
function canvasTex(w, h, draw, { srgb = true, rep = [1, 1] } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(rep[0], rep[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// varratmentesen ismétlődő foltok
function specks(g, w, h, n, seed, amp, s0, s1, col) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const v = (r() - .5) * 2 * amp, s = s0 + r() * (s1 - s0), x = r() * w, y = r() * h;
    g.fillStyle = col ? col(r, v) : v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    for (const [ox, oy] of [[0, 0], [-w, 0], [0, -h], [-w, -h]]) g.fillRect(x + ox, y + oy, s, s);
  }
}
// a talaj részlettextúrái (szürkeárnyalatos, 0,5 körül): a shader szorozza velük az alapszínt
const T_GRASS = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  specks(g, w, h, 900, 3, .22, 3, 9);
  const r = rng(11);
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h, l = 2 + r() * 5, a = -Math.PI / 2 + (r() - .5) * 1.2, v = r();
    g.strokeStyle = v > .55 ? `rgba(235,240,170,${.25 + r() * .3})` : `rgba(10,30,0,${.25 + r() * .35})`;
    g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
}, { srgb: false });
const T_PAVE = canvasTex(256, 256, (g, w, h) => {
  // 50 cm-es betonlapok fugával (a textúra 2 m-t fed le)
  const r = rng(5);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = 118 + r() * 24 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x * 64, y * 64, 64, 64); }
  specks(g, w, h, 2500, 7, .12, 1, 2);
  g.fillStyle = 'rgba(0,0,0,.45)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * 64 - 1, 0, 2, h); g.fillRect(0, i * 64 - 1, w, 2); }
}, { srgb: false });
const T_ASPH = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  specks(g, w, h, 6000, 9, .18, 1, 2); specks(g, w, h, 60, 13, .08, 20, 50);
}, { srgb: false });
// utak, járdák, kerékpárutak (u = hossz menti méter, v = keresztirány)
function asphaltDraw(base, lines) {
  return (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    specks(g, w, h, 5000, 21, .16, 1, 2); specks(g, w, h, 40, 23, .06, 15, 60);
    if (lines) { // szaggatott felezővonal: 3 m vonal, 5 m hézag (a textúra 8 m hosszú)
      g.fillStyle = 'rgba(240,240,232,.85)'; g.fillRect(0, h / 2 - 2, w * 3 / 8, 4);
    }
  };
}
const T_ROAD = canvasTex(512, 64, asphaltDraw('#55585c', true), { rep: [1 / 8, 1] });
const T_SERVICE = canvasTex(256, 256, asphaltDraw('#5a5d61', false), { rep: [1 / 4, 1 / 4] });
const T_CYCLE = canvasTex(256, 256, asphaltDraw('#9c5246', false), { rep: [1 / 4, 1 / 4] });
const T_FOOT = canvasTex(256, 256, (g, w, h) => {
  // térkő, kötésben (20×10 cm), a textúra 2×2 m
  const r = rng(31), bw = 25.6, bh = 12.8;
  g.fillStyle = '#8f877b'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h / bh; y++) for (let x = -1; x < w / bw + 1; x++) {
    const v = 150 + r() * 40 | 0, o = (y % 2) * bw / 2;
    g.fillStyle = `rgb(${v + 12},${v + 4},${v - 10})`; g.fillRect(x * bw + o, y * bh, bw - 1.5, bh - 1.5);
  }
  specks(g, w, h, 1500, 33, .1, 1, 2);
}, { rep: [1 / 2, 1 / 2] });
const T_CONCRETE = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b7b2a8'; g.fillRect(0, 0, w, h); specks(g, w, h, 4000, 41, .12, 1, 3); specks(g, w, h, 30, 43, .05, 20, 80);
});
const T_GRAVEL = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#8e8f8c'; g.fillRect(0, 0, w, h); specks(g, w, h, 9000, 51, .22, 1, 3);
  specks(g, w, h, 25, 53, .07, 30, 90);
}, { rep: [1 / 6, 1 / 6] });
const T_TILES = canvasTex(256, 256, (g, w, h) => {
  // hódfarkú cserép
  const r = rng(61);
  g.fillStyle = '#6d2e20'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 11; x++) {
    const o = (y % 2) * 12, v = r() * 30 - 15;
    g.fillStyle = `rgb(${158 + v},${74 + v * .6},${52 + v * .4})`;
    g.beginPath(); g.roundRect(x * 24 + o - 12, y * 16, 22, 20, [0, 0, 10, 10]); g.fill();
  }
}, { rep: [1 / 3, 1 / 3] });
const T_METALROOF = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#a7aeb5'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 2, 0, 2, h); }
  specks(g, w, h, 600, 71, .05, 1, 3);
}, { rep: [1 / 4, 1 / 4] });
const T_LEAF = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#b4b4b4'; g.fillRect(0, 0, w, h);
  const r = rng(81);
  for (let i = 0; i < 9000; i++) {
    const v = r(); g.fillStyle = v > .55 ? `rgba(255,255,225,${.12 + r() * .25})` : `rgba(0,25,0,${.12 + r() * .3})`;
    const x = r() * w, y = r() * h, rx = .8 + r() * 2.2, ry = .6 + r() * 1.2, a = r() * 3.14;
    for (const [ox, oy] of [[0, 0], [-w, 0], [0, -h], [-w, -h]]) { g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, Math.PI * 2); g.fill(); }
  }
}, { rep: [3, 3] });
const T_BARK = canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = '#6a5240'; g.fillRect(0, 0, w, h);
  const r = rng(91); for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${.15 + r() * .3})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 8 + r() * 30); }
});

// ---------- elemek szétválogatása ----------
const uni = F.find(f => f.k === 'u');
const CAMPUS_RE = /egyetem|SZE\b|mobilis|tudás|labor|kollégium|campus|sportcsarnok|parkolólemez|bridge|műteremház|innováció|irodaház|üveges|ipar 4\.0|projektközpont|motorok|^[A-E] épület|igazgatás/i;
// egyedileg modellezett elemek: a vasúti kocsi-függőhíd és az Üveges pavilon
const ID_CARRIAGE = 'w697438467', ID_UVEGES = 'r9791554';
// lépcsőszélességek, ahol az alapértéktől (2,6 m) eltér (kezdőpont szerint; Street View)
const STAIR_W = { '107.3,-59.4': 4.6 };
for (const f of F) { f.bb = bbox(f.p); f.c = centroid(f.p); }
const parts = F.filter(f => f.k === 'b' && f.part);
const blds = F.filter(f => f.k === 'b' && !f.part);
for (const f of F.filter(f => f.k === 'b')) {
  f.campus = (uni && pip(f.c[0], f.c[1], uni.p)) || f.bt === 'university' || CAMPUS_RE.test(f.n || '');
  f.custom = f.id === ID_CARRIAGE || f.id === ID_UVEGES;
}
function heights(f) {
  const dorm = /koll|multifunk/i.test(f.n || '');
  // a név nélküli 1–2 szintes egyetemi szárnyak laborok: kb. 4,5 m-es szintmagasság (a Street View
  // és a vasúti kocsi alapján, amely az 1. emeletükre, kb. 4,5 m-re csatlakozik)
  const labWing = f.campus && !(f.n || (f.parent && f.parent.n)) && f.bt === 'university' && parseFloat(f.l) <= 2;
  const lh = labWing ? 4.5 : f.campus && !dorm ? 3.5 : 3.0;
  let h = f.h ? parseFloat(f.h) : NaN, est = true;
  if (!isNaN(h)) est = false;
  else if (f.l) h = parseFloat(f.l) * lh + (f.rs && f.rs !== 'flat' ? 2 : 0) + 0.8;
  if (isNaN(h)) h = /garage|shed|kiosk|carport|hut/.test(f.bt || '') ? 3 : /house|detached|semi/.test(f.bt || '') ? 7 : f.campus ? 10 : 8;
  let mh = f.mh ? parseFloat(f.mh) : f.ml ? parseFloat(f.ml) * lh : 0;
  if (f.bt === 'roof') mh = Math.max(mh, h - 0.6);
  if (!(mh < h)) mh = Math.max(0, h - 1);
  return { h, mh, est, lh };
}
for (const f of [...parts, ...blds]) { f.ownH = !!f.h; Object.assign(f, heights(f)); }
// ha egy körvonalon belül building:part-ok vannak, a körvonalat nem húzzuk ki (OSM 3D szabály)
for (const b of blds) {
  const inside = parts.filter(pt => pt.c[0] >= b.bb.x0 && pt.c[0] <= b.bb.x1 && pt.c[1] >= b.bb.z0 && pt.c[1] <= b.bb.z1 && pip(pt.c[0], pt.c[1], b.p));
  for (const p of inside) {
    p.parent = b; p.campus = p.campus || b.campus;
    // magasság nélküli rész örökli a teljes épület szintszámát/magasságát
    if (!p.l && !p.ownH && (b.l || !b.est)) { if (b.l) p.l = b.l; else p.h = b.h; Object.assign(p, heights(p), { est: b.est }); p.inherited = true; }
  }
  const partArea = inside.reduce((s, p) => s + area(p.p), 0);
  if (inside.length && partArea > 0.8 * area(b.p)) { b.hasParts = true; b.top = Math.max(...inside.map(p => p.h)); }
  else {
    // a részek nem fedik le az épületet (pl. ÚT): a körvonalat is kihúzzuk, a vele azonos magasságú részeket nem
    for (const p of inside) if (p.inherited) p.skip = true;
    b.top = Math.max(b.h, ...inside.filter(p => !p.skip).map(p => p.h));
  }
}
for (let i = parts.length - 1; i >= 0; i--) if (parts[i].skip) parts.splice(i, 1);

// ---------- domborzat ----------
// Az úthálózat csomópontjainak magassága a lépcsőkből (lépcsőfok × 16 cm) számolva, a fő utak = 0 m.
// Ebből erősen súlyozott IDW-vel 2 m-es rács készül: a szintek laposak maradnak, a váltás
// a lépcsőknél és rövid rézsűkön történik (nem mosódik szét 10–15 m-en).
const TE = 500, TS = 2, TN = TE * 2 / TS + 1;
const HF = new Float32Array(TN * TN);
{
  const E = DATA.elev || [], cell = 20, hash = new Map();
  for (let i = 0; i + 2 < E.length; i += 3) { const k = Math.floor(E[i] / cell) + ',' + Math.floor(E[i + 1] / cell); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); }
  const RAD = 26, far = 1 / (RAD * RAD) ** 3;
  for (let iz = 0; iz < TN; iz++) for (let ix = 0; ix < TN; ix++) {
    const x = -TE + ix * TS, z = -TE + iz * TS; let s = 0, ws = 0;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const i of hash.get((gx + a) + ',' + (gz + b)) || []) {
      const d2 = (E[i] - x) ** 2 + (E[i + 1] - z) ** 2; if (d2 > RAD * RAD) continue;
      const w = 1 / (d2 + 0.6) ** 3; s += w * E[i + 2]; ws += w;
    }
    // távolabb a mintáktól a terep fokozatosan 0-ra (utcaszint) simul
    HF[iz * TN + ix] = ws > 0 ? s / (ws + far * 0.5) : 0;
  }
}
function H(x, z) {
  const fx = (x + TE) / TS, fz = (z + TE) / TS;
  if (fx < 0 || fz < 0 || fx >= TN - 1 || fz >= TN - 1) return 0;
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, i = iz * TN + ix;
  return (HF[i] * (1 - tx) + HF[i + 1] * tx) * (1 - tz) + (HF[i + TN] * (1 - tx) + HF[i + TN + 1] * tx) * tz;
}
// a lépcsők mentén a terep a lépcső egyenletes lejtését követi (különben a lépcső egy része
// a rézsű alá süllyedne vagy a levegőben lógna); 1,6 m-en belül pontosan, 4 m-ig átmenettel
for (const st of DATA.steps || []) {
  const q = st.p, pts = []; for (let i = 0; i + 2 < q.length; i += 3) pts.push(q.slice(i, i + 3));
  if (pts.length < 2) continue;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const Lt = cum[cum.length - 1], h0 = pts[0][2], h1 = pts[pts.length - 1][2]; if (Lt < .5) continue;
  const wh = (STAIR_W[pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1)] || 2.6) / 2 + .3;
  const bb = bbox(pts.flatMap(v => [v[0], v[1]]));
  for (let iz = Math.floor((bb.z0 - 5 + TE) / TS); iz <= Math.ceil((bb.z1 + 5 + TE) / TS); iz++)
    for (let ix = Math.floor((bb.x0 - 5 + TE) / TS); ix <= Math.ceil((bb.x1 + 5 + TE) / TS); ix++) {
      if (ix < 0 || iz < 0 || ix >= TN || iz >= TN) continue;
      const x = -TE + ix * TS, z = -TE + iz * TS; let bd = Infinity, ba = 0;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1][0], az = pts[i - 1][1], dx = pts[i][0] - ax, dz = pts[i][1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + t * dx - x, az + t * dz - z);
        if (d < bd) { bd = d; ba = cum[i - 1] + t * Math.sqrt(l2); }
      }
      if (bd >= wh + 2.4) continue;
      const w = bd < wh ? 1 : 1 - (bd - wh) / 2.4, k = iz * TN + ix;
      HF[k] = HF[k] * (1 - w) + (h0 + (h1 - h0) * ba / Lt) * w;
    }
}
// terep lesüllyesztése egy sokszög alatt (hogy ne bökjön át a belső padlón)
function flattenUnder(p, y, grow = 1) {
  const bb = bbox(p);
  for (let iz = Math.floor((bb.z0 - grow + TE) / TS); iz <= Math.ceil((bb.z1 + grow + TE) / TS); iz++)
    for (let ix = Math.floor((bb.x0 - grow + TE) / TS); ix <= Math.ceil((bb.x1 + grow + TE) / TS); ix++) {
      const x = -TE + ix * TS, z = -TE + iz * TS;
      if (pip(x, z, p) || pip(x + grow, z, p) || pip(x - grow, z, p) || pip(x, z + grow, p) || pip(x, z - grow, p)) HF[iz * TN + ix] = Math.min(HF[iz * TN + ix], y);
    }
}
const UVEGES = F.find(f => f.id === ID_UVEGES), CARRIAGE = F.find(f => f.id === ID_CARRIAGE);
if (UVEGES) {
  // az Üveges padlója az udvar szintjén van (az É-i homlokzat előtti terep + egy lépcsőfok)
  const p = UVEGES.p, ax = p[2], az = p[3], bx = p[4], bz = p[5], L = Math.hypot(bx - ax, bz - az);
  const nx = (bz - az) / L, nz = -(bx - ax) / L, s = pip((ax + bx) / 2 + nx, (az + bz) / 2 + nz, p) ? -1 : 1;
  let sum = 0; for (const t of [.2, .4, .6, .8]) sum += H(ax + (bx - ax) * t + nx * s * 1.5, az + (bz - az) * t + nz * s * 1.5);
  UVEGES.floorY = sum / 4 + 0.12;
  flattenUnder(p, UVEGES.floorY - 0.05);
}
// épület talppont: a körvonal pontjai alatti legalacsonyabb terep
for (const f of [...blds, ...parts]) {
  let m = Infinity, M = -Infinity;
  for (let i = 0; i < f.p.length; i += 2) { const h = H(f.p[i], f.p[i + 1]); m = Math.min(m, h); M = Math.max(M, h); }
  f.base = Math.min(m, H(f.c[0], f.c[1])); f.drop = M - f.base;
}
for (const p of parts) if (p.parent) { p.base = p.parent.base; p.drop = p.parent.drop; }
// lejtős telken az alsó oldalon kibukkan egy szuterén/pinceszint (pl. az E épület alatti étterem):
// ilyenkor egy szinttel magasabb a fal, és a földszint a magasabb oldal szintjére kerül
for (const f of [...blds, ...parts]) {
  f.semi = 0;
  if (!f.custom && f.mh === 0 && f.drop > 1.7 && f.bt !== 'roof') { f.semi = Math.max(1, Math.round(f.drop / f.lh)); f.h += f.semi * f.lh; if (f.top) f.top += f.semi * f.lh; }
}
for (const b of blds) if (b.hasParts) b.top = Math.max(...parts.filter(p => p.parent === b).map(p => p.h));

// ---------- homlokzatok: stílusok ----------
// Minden stílus egy 2 soros "atlasz": felső sor = emeleti ablakmező (egy szint × egy tengely),
// alsó sor = földszint. A maszk R = üveg, G = színezhető fal, B = színes kiemelés.
// Az üvegek mögé a shader valódi perspektívájú "szobát" rajzol (interior mapping), és a
// környezeti térképből tükröződnek.
const FS = 256;
function facadeAtlas(draw) {
  const a = document.createElement('canvas'), m = document.createElement('canvas');
  a.width = m.width = FS; a.height = m.height = FS * 2;
  const ga = a.getContext('2d'), gm = m.getContext('2d');
  for (const ground of [false, true]) {
    const oy = ground ? FS : 0;
    // téglalap a mező koordinátáiban: x 0..1 balról jobbra, y 0..1 a padlótól a födémig
    const R = (x0, y0, x1, y1, col, glass = 0, tint = 0, acc = 0) => {
      const px = x0 * FS, py = oy + (1 - y1) * FS, w = (x1 - x0) * FS, h = (y1 - y0) * FS;
      ga.fillStyle = col; ga.fillRect(px, py, w, h);
      gm.fillStyle = `rgb(${glass * 255 | 0},${tint * 255 | 0},${acc * 255 | 0})`; gm.fillRect(px, py, w, h);
    };
    draw(R, ground, ga, oy);
  }
  // finom vakolat-/betonszemcse a falon
  const r = rng(7);
  for (let i = 0; i < 5000; i++) { const v = (r() - .5) * .14; ga.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; ga.fillRect(r() * FS, r() * FS * 2, 1 + r() * 2, 1 + r() * 2); }
  const ta = new THREE.CanvasTexture(a), tm = new THREE.CanvasTexture(m);
  ta.colorSpace = THREE.SRGBColorSpace;
  for (const t of [ta, tm]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; }
  return [ta, tm];
}
// keretezett ablak: keret (nem színezett), benne üveg; osztók x-pozíciói
function win(R, x0, y0, x1, y1, frame, fw, mull = [], tr = null, acc = 0) {
  R(x0, y0, x1, y1, frame, 0, 0, acc);
  R(x0 + fw, y0 + fw, x1 - fw, y1 - fw, '#1d242b', 1);
  for (const x of mull) R(x - fw / 2, y0, x + fw / 2, y1, frame, 0, 0, acc);
  if (tr !== null) R(x0, tr - fw / 2, x1, tr + fw / 2, frame, 0, 0, acc);
}
const STYLES = {
  // 70-es évekbeli központi épületek (A–D): beton mellvédsávok, végigfutó szalagablak
  ribbon: { bay: 3.6, wall: '#d6d9db', glass: '#18222c', metal: .2, depth: 4.5, lights: .35, tints: ['#ffffff', '#f6f4ef', '#eef0f2'],
    draw(R, g) {
      R(0, 0, 1, 1, '#d6d9db', 0, 1);
      if (g) { win(R, 0, .06, 1, .9, '#5b636b', .012, [.333, .667], .72); return; }
      R(0, .3, 1, .325, '#aeb2b5', 0, 1);
      win(R, 0, .34, 1, .9, '#5b636b', .012, [.5], .78);
    } },
  // alacsony laborépületek: fehér vakolat, hosszú üvegsáv (mint a fotón a kocsi mellett)
  lab: { bay: 3.75, wall: '#d9dcde', glass: '#1c2934', metal: .15, depth: 5, lights: .4, tints: ['#ffffff', '#f4f5f6', '#eceef0'],
    acc: ['#1f3450', '#1f3450', '#24395a', '#d9dcde'],
    draw(R, g) {
      R(0, 0, 1, 1, '#d9dcde', 0, 1);
      if (g) { win(R, 0, .3, 1, .86, '#7d8791', .012, [.333, .667]); return; }
      // emeleten sötétkék panelsáv függőleges hézagokkal, benne álló ablak (mint a kocsi melletti épületeken)
      R(0, .2, 1, .94, '#1f3450', 0, 0, 1);
      for (const x of [.25, .5, .75]) R(x - .004, .2, x + .004, .94, '#14233a');
      win(R, .36, .36, .64, .84, '#9aa3ab', .02);
    } },
  // kollégiumok: lyukarchitektúra, a parapetek színes panelek
  dorm: { bay: 3.0, wall: '#e3e5e6', glass: '#1b232b', metal: 0, depth: 3.8, lights: .3, tints: ['#ffffff', '#f5efe4'], acc: ['#2b4466', '#2b4466', '#3d5a80', '#c9d0d6'],
    draw(R, g) {
      R(0, 0, 1, 1, '#e3e5e6', 0, 1);
      if (!g) R(.14, .06, .86, .29, '#2b4466', 0, 0, 1);
      win(R, .16, .3, .84, .86, '#f2f2f0', .022, [.5]);
    } },
  // Multifunkcionális Épület: fehér, színes ablakkeretek
  multi: { bay: 3.2, wall: '#f1f1ee', glass: '#1b232b', metal: 0, depth: 3.8, lights: .3, tints: ['#ffffff'], acc: ['#d64541', '#f2b632', '#3fa34d', '#2e6fb5'],
    draw(R, g) {
      R(0, 0, 1, 1, '#f1f1ee', 0, 1);
      if (g) { win(R, .04, .08, .96, .9, '#4a5560', .015, [.5], .74); return; }
      win(R, .2, .26, .8, .86, '#d64541', .05, [], null, 1);
    } },
  // új építésű oktatási/irodaépületek: függönyfal, sötét mellvédsáv, függőleges bordák
  modern: { bay: 3.0, wall: '#e6e8e9', glass: '#2a4256', metal: .45, depth: 5, lights: .45, tints: ['#ffffff', '#f2f4f5'],
    draw(R, g) {
      R(0, 0, 1, 1, '#e6e8e9', 0, 1);
      R(0, 0, 1, g ? .04 : .16, '#3a4148');
      R(.035, g ? .04 : .16, 1, 1, '#1d242b', 1);
      R(.48, g ? .04 : .16, .5, 1, '#8f979f');
      R(0, 0, .035, 1, '#d7dadc');
    } },
  // csarnokok, műhelyek: trapézlemez burkolat, földszinten üvegsáv
  hall: { bay: 6, wall: '#b9bfc5', glass: '#1c2934', metal: .2, depth: 7, lights: .5, tints: ['#ffffff', '#e9eef2', '#f2efe8'],
    draw(R, g) {
      R(0, 0, 1, 1, '#b9bfc5', 0, 1);
      for (let x = 0; x < 1; x += 1 / 24) { R(x, 0, x + .012, 1, '#9aa1a8', 0, 1); }
      if (g) win(R, .03, .4, .97, .86, '#6c747c', .008, [.25, .5, .75]);
    } },
  // parkolóház: nyitott szintek
  parking: { bay: 5, wall: '#bdb9b0', glass: '#2b2d2f', metal: 0, depth: 8, lights: 0, tints: ['#ffffff'],
    draw(R) {
      R(0, 0, 1, 1, '#bdb9b0', 0, 1);
      R(.06, .3, 1, .98, '#2e3133');
      R(.06, .3, 1, .36, '#3b3f42');
    } },
  // belvárosi és egyéb házak: vakolt fal (a színt épületenként kapja), keretes ablakok párkánnyal
  city: { bay: 3.4, wall: '#ffffff', glass: '#1b2128', metal: 0, depth: 4, lights: .3,
    tints: ['#f3e9d2', '#efd9bb', '#e8d6a6', '#f2f1ec', '#e7cfc3', '#d9dfcf', '#f4e1b5', '#e7e2d8', '#dfe4e6', '#f0e6d8'],
    draw(R, g) {
      R(0, 0, 1, 1, '#ffffff', 0, 1);
      R(0, .955, 1, 1, '#e4e0d8', 0, 1);
      if (g) { win(R, .14, .1, .86, .82, '#4a4a48', .02, [.5]); return; }
      R(.24, .27, .76, .31, '#cfcac0');
      win(R, .28, .31, .72, .86, '#f4f4f2', .025, [.5], .7);
      R(.25, .86, .75, .9, '#d8d3ca', 0, 1);
    } },
  // panelházak (4+ szint): panelhézagok, nagyobb ablakok
  panel: { bay: 3.6, wall: '#ffffff', glass: '#1b2128', metal: 0, depth: 4, lights: .3,
    tints: ['#ece8df', '#e2e5e6', '#efe6d6', '#dfe3dc', '#f0eadc'],
    draw(R, g) {
      R(0, 0, 1, 1, '#ffffff', 0, 1);
      R(0, 0, .008, 1, '#b8b4ab', 0, 1); R(0, 0, 1, .008, '#b8b4ab', 0, 1);
      win(R, .2, .3, .8, .82, '#f4f4f2', .02, [.45]);
      if (!g) R(.18, .27, .82, .3, '#c9c4ba');
    } },
  // templomok: kő, magas íves ablakok
  church: { bay: 5, wall: '#ffffff', glass: '#1c2229', metal: 0, depth: 10, lights: .6, tints: ['#efe5cf', '#e6dcc6', '#f2ece0'],
    draw(R) {
      R(0, 0, 1, 1, '#ffffff', 0, 1);
      R(.4, .12, .6, .82, '#8d8676'); R(.42, .14, .58, .8, '#1d242b', 1);
    } },
};
function facadeMaterial(st) {
  const [alb, msk] = facadeAtlas(st.draw);
  const acc = (st.acc || ['#ffffff', '#ffffff', '#ffffff', '#ffffff']).map(c => new THREE.Color(c));
  const m = new THREE.MeshStandardMaterial({ roughness: .88, metalness: 0, envMap: ENV, envMapIntensity: 1 });
  const U = {
    facAlb: { value: alb }, facMask: { value: msk }, facWall: { value: new THREE.Color(st.wall) },
    accA: { value: acc[0] }, accB: { value: acc[1] }, accC: { value: acc[2] }, accD: { value: acc[3] },
    glassTint: { value: new THREE.Color(st.glass) }, glassMetal: { value: st.metal }, roomDepth: { value: st.depth }, lightsOn: { value: st.lights },
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 fuv; attribute vec4 fsc; attribute vec3 fcol;
        varying vec2 vFuv; varying vec4 vFsc; varying vec3 vFcol; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vFuv = fuv; vFsc = fsc; vFcol = fcol;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D facAlb, facMask;
        uniform vec3 facWall, accA, accB, accC, accD, glassTint;
        uniform float roomDepth, lightsOn, glassMetal;
        varying vec2 vFuv; varying vec4 vFsc; varying vec3 vFcol; varying vec3 vWPos; varying vec3 vWN;
        float fh21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <map_fragment>', `
        float fSeed = floor(vFsc.w + 0.5), fLv = mod(floor(vFsc.z + 0.5), 100.0);
        float fFl = vFuv.y / vFsc.y, fI = floor(fFl), fB = floor(vFuv.x);
        bool fSolid = vFuv.x < -0.5 || fI < 0.0 || fI >= fLv;
        vec2 fT = vec2(fract(vFuv.x), fract(fFl));
        float fRow = (fI < 0.5 && vFsc.z < 99.5) ? 0.0 : 0.5;
        vec2 fA = vec2(fT.x, fRow + clamp(fT.y, 0.004, 0.996) * 0.5);
        vec2 fGx = dFdx(vec2(vFuv.x, fFl)) * vec2(1.0, 0.5), fGy = dFdy(vec2(vFuv.x, fFl)) * vec2(1.0, 0.5);
        vec4 fAlb = textureGrad(facAlb, fA, fGx, fGy);
        vec4 fMsk = textureGrad(facMask, fA, fGx, fGy);
        if (fSolid) { fAlb = vec4(facWall, 1.0); fMsk = vec4(0.0, 1.0, 0.0, 1.0); if (vFuv.y < 0.0) fAlb.rgb *= 0.7; }
        // paneltáblánként kicsit eltérő árnyalat, hogy ne legyen steril
        float fPan = fh21(vec2(floor(vFuv.x * 0.5) * 0.37 + fSeed, fI * 0.71));
        vec3 fCol = mix(fAlb.rgb, fAlb.rgb * vFcol * (0.94 + 0.1 * fPan), fMsk.g);
        float fR = fh21(vec2(fB, fI) + fSeed);
        vec3 fAcc = fR < 0.25 ? accA : fR < 0.5 ? accB : fR < 0.75 ? accC : accD;
        fCol = mix(fCol, fAcc, fMsk.b);
        float fGlass = fSolid ? 0.0 : fMsk.r;
        diffuseColor.rgb *= mix(fCol, glassTint, fGlass);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.06, fGlass);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, glassMetal, fGlass);')
      .replace('#include <opaque_fragment>', `
        if (fGlass > 0.01) {
          // "szoba" az ablak mögött: sugár–doboz metszés a szint × tengely méretű cellában
          vec3 fN = normalize(vec3(vWN.x, 0.0, vWN.z)), fTn = vec3(fN.z, 0.0, -fN.x);
          vec3 fV = normalize(vWPos - cameraPosition);
          vec3 fD = vec3(dot(fV, fTn) / vFsc.x, fV.y / vFsc.y, max(dot(fV, -fN), 0.02) / roomDepth);
          vec3 fP = vec3(fT, 0.0);
          float tX = fD.x > 0.0 ? (1.0 - fP.x) / fD.x : fP.x / max(-fD.x, 1e-4);
          float tY = fD.y > 0.0 ? (1.0 - fP.y) / fD.y : fP.y / max(-fD.y, 1e-4);
          float tZ = 1.0 / fD.z, tM = min(min(tX, tY), tZ);
          vec3 fH = fP + fD * tM;
          float rr = fh21(vec2(fB * 1.37 + fSeed, fI * 2.11 + 0.5));
          vec3 rW = mix(vec3(0.82, 0.80, 0.75), vec3(0.72, 0.78, 0.82), rr);
          vec3 rc;
          if (tM == tZ) {
            rc = rW * 0.95;
            float dx = 0.2 + 0.6 * fract(rr * 7.13);
            if (abs(fH.x - dx) < 0.11 && fH.y < 0.72) rc = vec3(0.48, 0.38, 0.29);
            else if (fract(rr * 3.7) > 0.5 && fH.y < 0.55 && abs(fH.x - 0.5) < 0.38) rc = vec3(0.36, 0.33, 0.30);
          } else if (tM == tX) rc = rW * 0.78;
          else if (fD.y > 0.0) rc = vec3(0.92) * (0.75 + 0.35 * smoothstep(0.35, 0.0, length(fH.xz - vec2(0.5))));
          else rc = fract(rr * 5.3) > 0.5 ? vec3(0.40, 0.31, 0.24) : vec3(0.42, 0.44, 0.47);
          rc *= 1.0 - 0.5 * fH.z;
          rc *= fract(rr * 11.7) < lightsOn ? 0.5 : 0.24;
          // redőny / függöny az üveg síkjában
          float fBl = fh21(vec2(fI * 3.3, fB * 1.9) + fSeed + 0.3);
          if (fBl > 0.72 && fT.y > 1.0 - (fBl - 0.72) * 3.0) rc = vec3(0.80, 0.78, 0.72) * 0.62;
          float fFr = 0.04 + 0.96 * pow(1.0 - max(dot(-fV, fN), 0.0), 5.0), fRef = 0.1 + 0.55 * fFr + 0.25 * glassMetal;
          outgoingLight += rc * fGlass * (1.0 - fRef);
          // az üveg erősebben tükrözi az eget, mint egy sima dielektrikum (bevonatos üveg)
          #ifdef USE_ENVMAP
          outgoingLight += radiance * fGlass * fRef * 1.6;
          #endif
        }
        #include <opaque_fragment>`);
  };
  return m;
}
const FAC_MATS = {};
for (const k in STYLES) FAC_MATS[k] = facadeMaterial(STYLES[k]);
function styleOf(f) {
  const n = ((f.parent && f.parent.n) || '') + ' ' + (f.n || ''), bt = f.bt || (f.parent && f.parent.bt) || '';
  if (/parkolólemez/i.test(n) || bt === 'parking') return 'parking';
  if (/multifunk/i.test(n)) return 'multi';
  if (/koll/i.test(n) || bt === 'dormitory') return 'dorm';
  if (/sportcsarnok|járműhajtás|csomagolás|laborépület/i.test(n) || /industrial|warehouse|garage|garages|hangar|sports_hall|shed/.test(bt)) return 'hall';
  if (/új tudás|ipar 4\.0|projektközpont|tudásmenedzsment|menedzsment|irodaház|igazgatás|mobilis|innovációs park/i.test(n)) return 'modern';
  if (f.campus) return parseFloat(f.l || (f.parent && f.parent.l) || 0) >= 5 ? 'ribbon' : 'lab';
  if (/church|chapel|basilica|cathedral/.test(bt)) return 'church';
  if (/apartments|residential|office/.test(bt) && parseFloat(f.l) >= 4) return 'panel';
  return 'city';
}

// ---------- épületek ----------
// legkisebb befoglaló téglalap (a ferde/íves tetőkhöz)
function obb(p) {
  let best = null;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const a = Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]), c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let j = 0; j < p.length; j += 2) { const u = p[j] * c + p[j + 1] * s, v = -p[j] * s + p[j + 1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, a, c, s, um: (u0 + u1) / 2, vm: (v0 + v1) / 2, eu: u1 - u0, ev: v1 - v0 };
  }
  const { a, c, s, um, vm, eu, ev } = best;
  return { cx: um * c - vm * s, cz: um * s + vm * c, ang: eu >= ev ? a : a + Math.PI / 2, len: Math.max(eu, ev), wid: Math.min(eu, ev) };
}
const tileMat = new THREE.MeshStandardMaterial({ map: T_TILES, roughness: .85, side: THREE.DoubleSide });
const roofMats = { round: new THREE.MeshStandardMaterial({ map: T_METALROOF, color: 0xd5dade, roughness: .45, metalness: .3, envMap: ENV, side: THREE.DoubleSide }), gabled: tileMat };
function roofMesh(f, base) {
  const o = obb(f.p); let geo, rh;
  if (f.rs === 'round') {
    rh = Math.min(o.wid * .22, 9);
    geo = new THREE.CylinderGeometry(o.wid / 2, o.wid / 2, o.len, 24, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2); geo.scale(1, rh / (o.wid / 2), 1);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.wid * 1.6, uv.getY(i) * o.len);
  } else {
    rh = Math.min(o.wid * .35, 6);
    const s = new THREE.Shape([new THREE.Vector2(-o.wid / 2, 0), new THREE.Vector2(o.wid / 2, 0), new THREE.Vector2(0, rh)]);
    geo = new THREE.ExtrudeGeometry(s, { depth: o.len, bevelEnabled: false }); geo.translate(0, 0, -o.len / 2); geo.rotateY(Math.PI / 2);
  }
  const m = new THREE.Mesh(geo, f.rs === 'round' ? roofMats.round : roofMats.gabled);
  m.position.set(o.cx, base, o.cz); m.rotation.y = -o.ang; m.castShadow = m.receiveShadow = true;
  return { m, rh };
}
// falak + tetőfödém + attikaszegély: stílusonként egyetlen összevont háló; a háromszögekhez
// eltároljuk a tulajdonos épületet (célzott épület infó)
const buildingMeshes = [];
const roofFlatMat = new THREE.MeshStandardMaterial({ map: T_GRAVEL, roughness: 1 });
const copingMat = new THREE.MeshStandardMaterial({ color: 0x9da2a6, roughness: .5, metalness: .3, envMap: ENV });
const slabMat = new THREE.MeshStandardMaterial({ color: 0x8e8478, roughness: .9 });
{
  const W = {}, roof = { pos: [], nor: [], uv: [], idx: [], own: [] }, cop = { pos: [], nor: [] }, slab = { pos: [], nor: [], uv: [], idx: [], own: [] };
  const cap = (B, f, p, y, flip) => {
    const pts = []; for (let i = 0; i < p.length - 2; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
    let tri; try { tri = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { return; }
    const b = B.pos.length / 3;
    for (const v of pts) { B.pos.push(v.x, y, v.y); B.nor.push(0, flip ? -1 : 1, 0); B.uv.push(v.x, v.y); }
    for (const [i, j, k] of tri) {
      const A = pts[i], Bv = pts[j], C = pts[k];
      const up = (Bv.y - A.y) * (C.x - A.x) - (Bv.x - A.x) * (C.y - A.y) > 0; // a háromszög felfelé néz-e
      if (up !== !!flip) B.idx.push(b + i, b + j, b + k); else B.idx.push(b + i, b + k, b + j);
      B.own.push(f);
    }
  };
  for (const f of [...blds.filter(b => !b.hasParts), ...parts]) {
    if (f.custom) continue;
    let wallTop = f.h;
    if (f.rs && /round|gabled|hipped|pyramidal|half-hipped/.test(f.rs) && f.bt !== 'roof') {
      const tmp = roofMesh(f, 0); wallTop = Math.max(f.mh + 2.5, f.h - tmp.rh);
      tmp.m.position.y = f.base + wallTop; tmp.m.userData.f = f; scene.add(tmp.m); buildingMeshes.push(tmp.m);
    }
    f.wallTop = wallTop;
    if (f.bt === 'roof') { // tetőszerkezet (pl. előtető): vékony födém
      cap(slab, f, f.p, f.base + f.h, false); cap(slab, f, f.p, f.base + f.mh, true); continue;
    }
    const style = styleOf(f), st = STYLES[style];
    f.style = style;
    // a földig érő épületek 3 m-rel a terep alá nyúlnak, hogy lejtőn se lógjanak a levegőben
    const sink = f.mh === 0 ? 3 : 0, y0 = f.base + f.mh - sink, y1 = f.base + wallTop, fl0 = f.base + f.mh;
    const lv0 = f.l ? Math.round(parseFloat(f.l)) + f.semi : Math.floor((wallTop - f.mh) / f.lh);
    const levels = Math.max(1, Math.min(lv0, Math.floor((wallTop - f.mh) / f.lh + 0.25)));
    const code = levels + (f.mh > 0 ? 100 : 0), seed = Math.floor(hash1(f.id) * 97);
    const tint = new THREE.Color(st.tints ? st.tints[Math.floor(hash1(f.id + 't') * st.tints.length)] : '#ffffff');
    const G = W[style] || (W[style] = { pos: [], nor: [], fuv: [], fsc: [], fcol: [], idx: [], own: [] });
    const p = f.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      let ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue;
      let nx = (bz - az) / L, nz = -(bx - ax) / L;
      if (pip((ax + bx) / 2 + nx * 0.05, (az + bz) / 2 + nz * 0.05, p)) { nx = -nx; nz = -nz; }
      // u a (nz, -nx) irányba nő, ami kívülről nézve balról jobbra halad; A legyen a bal oldali pont
      if ((bx - ax) * nz - (bz - az) * nx < 0) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
      const nb = Math.round(L / st.bay), solid = nb < 1 || L < st.bay * 0.6, bw = solid ? st.bay : L / nb;
      const b = G.pos.length / 3;
      for (const [x, z, u] of [[ax, az, solid ? -1 : 0], [bx, bz, solid ? -1 : nb]]) for (const y of [y0, y1]) {
        G.pos.push(x, y, z); G.nor.push(nx, 0, nz); G.fuv.push(u, y - fl0); G.fsc.push(bw, f.lh, code, seed); G.fcol.push(tint.r, tint.g, tint.b);
      }
      G.idx.push(b, b + 2, b + 3, b, b + 3, b + 1); G.own.push(f, f);
      // attikaszegély (fémlemez fedés) a lapostetős épületek tetején
      if (wallTop === f.h) {
        const ox = nx * .07, oz = nz * .07, ix = -nx * .3, iz = -nz * .3, yt = y1 + .1;
        cop.pos.push(ax + ox, yt, az + oz, bx + ox, yt, bz + oz, bx + ix, yt, bz + iz, ax + ox, yt, az + oz, bx + ix, yt, bz + iz, ax + ix, yt, az + iz);
        for (let k = 0; k < 6; k++) cop.nor.push(0, 1, 0);
        cop.pos.push(ax + ox, y1 - .15, az + oz, bx + ox, y1 - .15, bz + oz, bx + ox, yt, bz + oz, ax + ox, y1 - .15, az + oz, bx + ox, yt, bz + oz, ax + ox, yt, az + oz);
        for (let k = 0; k < 6; k++) cop.nor.push(nx, 0, nz);
      }
    }
    cap(roof, f, p, y1, false);
    if (f.mh > 0) cap(slab, f, p, f.base + f.mh, true);
  }
  const mk = (B, mat, attrs) => {
    const g = new THREE.BufferGeometry();
    for (const [k, n] of attrs) g.setAttribute(k, new THREE.Float32BufferAttribute(B[k === 'position' ? 'pos' : k === 'normal' ? 'nor' : k], n));
    if (B.idx) g.setIndex(B.idx);
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.userData.own = B.own; scene.add(m);
    if (B.own) buildingMeshes.push(m);
    return m;
  };
  for (const k in W) mk(W[k], FAC_MATS[k], [['position', 3], ['normal', 3], ['fuv', 2], ['fsc', 4], ['fcol', 3]]);
  mk(roof, roofFlatMat, [['position', 3], ['normal', 3], ['uv', 2]]);
  mk(slab, slabMat, [['position', 3], ['normal', 3], ['uv', 2]]);
  const cm = mk(cop, copingMat, [['position', 3], ['normal', 3]]); cm.castShadow = false;
}
T_GRAVEL.repeat.set(1 / 6, 1 / 6);

// ---------- terepfelület: a burkolatok, gyep, parkolók egy rajzolt "talajtérképen" a domborzatra feszítve ----------
const GPX = 2.5; // pixel / méter
const gcan = document.createElement('canvas'); gcan.width = gcan.height = TE * 2 * GPX;
const gctx = gcan.getContext('2d');
const GP = (x, z) => [(x + TE) * GPX, (z + TE) * GPX];
function gpoly(f, fill) { gctx.beginPath(); for (let i = 0; i < f.p.length; i += 2) { const [a, b] = GP(f.p[i], f.p[i + 1]); i ? gctx.lineTo(a, b) : gctx.moveTo(a, b); } gctx.closePath(); gctx.fillStyle = fill; gctx.fill(); }
gctx.fillStyle = '#93a173'; gctx.fillRect(0, 0, gcan.width, gcan.height);
if (uni) gpoly(uni, '#c4bfb2');
F.filter(f => f.k === 'g').forEach(f => gpoly(f, '#7fa25e'));
F.filter(f => f.k === 'p').forEach(f => gpoly(f, '#86888a'));
F.filter(f => f.k === 'w').forEach(f => gpoly(f, '#4f86b0'));
const PITCH_COL = { grass: '#5f9e4a', artificial_turf: '#3f9a55', clay: '#b5553a', tartan: '#a8473a', asphalt: '#6c7075', concrete: '#9a9a96', sand: '#d8c48f' };
F.filter(f => f.k === 'pt').forEach(f => gpoly(f, PITCH_COL[f.sf] || (f.sp === 'tennis' ? '#b5553a' : f.sp === 'basketball' ? '#6c7075' : '#4f9a50')));
F.filter(f => f.k === 'pool').forEach(f => gpoly(f, '#4fb3d9'));
gctx.strokeStyle = '#f2f2ee'; gctx.lineWidth = 0.12 * GPX * 2;
for (const f of F.filter(f => f.k === 'ps' || f.k === 'pt')) { gctx.beginPath(); for (let i = 0; i < f.p.length; i += 2) { const [a, b] = GP(f.p[i], f.p[i + 1]); i ? gctx.lineTo(a, b) : gctx.moveTo(a, b); } gctx.stroke(); }
// az Üveges előtti terasz térkővel
const keepOut = []; // fák nélkül hagyandó területek
let uvegesTerrace = null;
if (UVEGES) {
  const p = UVEGES.p, ax = p[2], az = p[3], bx = p[4], bz = p[5], L = Math.hypot(bx - ax, bz - az), nx = (bz - az) / L, nz = -(bx - ax) / L;
  const s = pip((ax + bx) / 2 + nx, (az + bz) / 2 + nz, p) ? -1 : 1, d = 6;
  uvegesTerrace = { p: [ax - (bx - ax) / L * .5, az - (bz - az) / L * .5, bx + (bx - ax) / L * .5, bz + (bz - az) / L * .5, bx + nx * s * d, bz + nz * s * d, ax + nx * s * d, az + nz * s * d, ax - (bx - ax) / L * .5, az - (bz - az) / L * .5] };
  uvegesTerrace.bb = bbox(uvegesTerrace.p);
  gpoly(uvegesTerrace, '#c9c1b1'); keepOut.push(uvegesTerrace);
}
const gtex = new THREE.CanvasTexture(gcan); gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 8;
// a talaj anyaga: az alapszínből kiolvassa, hogy gyep / térkő / aszfalt, és arra illő részlettextúrát kever rá
function terrainMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 1 });
  m.onBeforeCompile = sh => {
    sh.uniforms.dGrass = { value: T_GRASS }; sh.uniforms.dPave = { value: T_PAVE }; sh.uniforms.dAsph = { value: T_ASPH };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D dGrass, dPave, dAsph;\nvarying vec3 vTW;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 tb = diffuseColor.rgb;
        float tg = clamp((tb.g - max(tb.r, tb.b)) * 14.0, 0.0, 1.0);
        float tp = (1.0 - tg) * clamp((tb.r - tb.b) * 22.0, 0.0, 1.0);
        vec3 td = mix(mix(texture2D(dAsph, vTW.xz / 3.0).rgb, texture2D(dPave, vTW.xz / 2.0).rgb, tp), texture2D(dGrass, vTW.xz / 2.2).rgb, tg);
        float tmac = texture2D(dAsph, vTW.xz / 53.0).r * 0.6 + texture2D(dGrass, vTW.xz / 17.0).r * 0.4;
        diffuseColor.rgb *= td * 2.0 * (0.82 + 0.36 * tmac);
        // meredek rézsűn kicsit sötétebb, földesebb gyep
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.92, 0.88, 0.8), smoothstep(0.85, 0.6, normalize(vNormal).y));`);
  };
  return m;
}
{
  const seg = TN - 1, g = new THREE.PlaneGeometry(TE * 2, TE * 2, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) pa.setY(i, H(pa.getX(i), pa.getZ(i)));
  g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, terrainMaterial(gtex));
  terrain.receiveShadow = true; scene.add(terrain);
}
// távoli talaj a terepkivágáson kívül (lyukas, hogy a terep mélyebb részeit ne takarja)
{
  const s = new THREE.Shape([new THREE.Vector2(-4000, -4000), new THREE.Vector2(4000, -4000), new THREE.Vector2(4000, 4000), new THREE.Vector2(-4000, 4000)]);
  const e = TE - TS; s.holes.push(new THREE.Path([new THREE.Vector2(-e, -e), new THREE.Vector2(-e, e), new THREE.Vector2(e, e), new THREE.Vector2(e, -e)]));
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(g, terrainMaterial(null)); ground.material.color.set(0x93a173);
  ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);
}
// a folyók a terepkivágáson kívül is látsszanak
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a7fa6, roughness: .15, metalness: .1, envMap: ENV });
  for (const f of F.filter(f => f.k === 'w')) { try { const g = new THREE.ShapeGeometry(shapeOf(f.p)); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = -0.02; scene.add(m); } catch (e) {} }
}

// ---------- utak ----------
const RW = { motorway: 12, trunk: 11, primary: 10, secondary: 8, tertiary: 7, unclassified: 6, residential: 6, living_street: 5, service: 4, pedestrian: 5, footway: 2.2, path: 1.8, cycleway: 2.2, steps: 2.2, track: 3, bridleway: 2 };
const FOOT = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bridleway', 'track']);
// szalag a domborzaton; uv: u = hossz menti méter, v = keresztirány (méterben, vagy 0..1 ha norm)
function ribbonGeo(list, norm = false) {
  const pos = [], uv = [], idx = [];
  for (const f of list) {
    const w = (parseFloat(f.wd) || RW[f.t]) / 2, p = f.p; let cum = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      let ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < .01) continue;
      const ux = dx / L, uz = dz / L, nx = -uz * w, nz = ux * w;
      ax -= ux * w * .5; az -= uz * w * .5; bx += ux * w * .5; bz += uz * w * .5;
      const Lx = L + w, u0s = cum - w * .5; cum += L;
      // 1,5 m-es darabokra bontjuk, hogy kövesse a domborzatot (a terep rácsa 2 m)
      const n = Math.max(1, Math.ceil(Lx / 1.5));
      const vl = norm ? 1 : w, vr = norm ? 0 : -w;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const b = pos.length / 3;
        pos.push(x0 + nx, H(x0 + nx, z0 + nz), z0 + nz, x0 - nx, H(x0 - nx, z0 - nz), z0 - nz, x1 - nx, H(x1 - nx, z1 - nz), z1 - nz, x1 + nx, H(x1 + nx, z1 + nz), z1 + nz);
        uv.push(u0s + Lx * t0, vl, u0s + Lx * t0, vr, u0s + Lx * t1, vr, u0s + Lx * t1, vl);
        idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const closedLine = f => f.p.length >= 8 && f.p[0] === f.p[f.p.length - 2] && f.p[1] === f.p[f.p.length - 1];
const isArea = f => String(f.id || '').startsWith('r') || (f.t === 'pedestrian' && closedLine(f));
const allRoads = F.filter(f => f.k === 'r' && RW[f.t]);
const roads = allRoads.filter(f => !isArea(f));
{
  // területek: azonos azonosítójú gyűrűk együtt, páros-páratlan kitöltéssel (a belső gyűrű lyuk)
  const byId = new Map(); for (const f of allRoads.filter(isArea)) { if (!byId.has(f.id)) byId.set(f.id, []); byId.get(f.id).push(f); }
  for (const rings of byId.values()) {
    gctx.beginPath();
    for (const f of rings) for (let i = 0; i < f.p.length; i += 2) { const [a, b] = GP(f.p[i], f.p[i + 1]); i ? gctx.lineTo(a, b) : gctx.moveTo(a, b); }
    gctx.fillStyle = FOOT.has(rings[0].t) ? '#c4bba9' : '#5c5f63'; gctx.fill('evenodd');
  }
  gctx.lineCap = gctx.lineJoin = 'round';
  for (const [list, col] of [[roads.filter(r => FOOT.has(r.t)), '#c4bba9'], [roads.filter(r => r.t === 'cycleway'), '#9c5246'], [roads.filter(r => !FOOT.has(r.t)), '#5c5f63']]) {
    gctx.strokeStyle = col;
    for (const r of list) { gctx.lineWidth = (parseFloat(r.wd) || RW[r.t]) * GPX; gctx.beginPath(); for (let i = 0; i < r.p.length; i += 2) { const [a, b] = GP(r.p[i], r.p[i + 1]); i ? gctx.lineTo(a, b) : gctx.moveTo(a, b); } gctx.stroke(); }
  }
  gtex.needsUpdate = true;
}
const LINED = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential']);
const wide = r => LINED.has(r.t) && (parseFloat(r.wd) || RW[r.t]) >= 5.5;
// rétegek alulról felfelé: járda, kerékpárút, kiszolgáló út, főút (az autóút takarja a járdát a kereszteződésben)
[[roads.filter(r => FOOT.has(r.t) && r.t !== 'cycleway'), T_FOOT, false],
 [roads.filter(r => r.t === 'cycleway'), T_CYCLE, false],
 [roads.filter(r => !FOOT.has(r.t) && !wide(r)), T_SERVICE, false],
 [roads.filter(r => !FOOT.has(r.t) && wide(r)), T_ROAD, true]].forEach(([list, map, norm], k) => {
  const m = new THREE.Mesh(ribbonGeo(list, norm), new THREE.MeshStandardMaterial({ map, roughness: .95, polygonOffset: true, polygonOffsetFactor: -2 - k, polygonOffsetUnits: -4 - 4 * k, side: THREE.DoubleSide }));
  m.position.y = 0.04 + k * 0.012; m.renderOrder = k; m.receiveShadow = true; scene.add(m);
});

// ---------- összevont statikus hálók (bútorok, kocsi, pavilon): anyagonként egy rajzolás ----------
const batches = new Map();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function addGeo(geo, mat, m4, opt = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.applyMatrix4(m4);
  const key = mat.uuid + (opt.cast === false ? 'n' : 'c');
  let b = batches.get(key); if (!b) batches.set(key, b = { mat, pos: [], nor: [], uv: [], cast: opt.cast !== false, own: opt.own || null });
  const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv && g.attributes.uv.array;
  for (let i = 0; i < P.length; i++) { b.pos.push(P[i]); b.nor.push(N[i]); }
  for (let i = 0; i < P.length / 3; i++) { b.uv.push(U ? U[i * 2] : 0, U ? U[i * 2 + 1] : 0); }
  g.dispose();
}
// doboz egy lokális keretben (frame = Matrix4), rot = forgatás a függőleges tengely körül
function box(frame, mat, w, h, d, x, y, z, rot = 0, opt) {
  _m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, rot, 0)), _s.set(1, 1, 1));
  addGeo(new THREE.BoxGeometry(w, h, d), mat, new THREE.Matrix4().multiplyMatrices(frame, _m4), opt);
}
function geoAt(frame, mat, geo, x, y, z, rx = 0, ry = 0, rz = 0, opt) {
  _m4.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(1, 1, 1));
  addGeo(geo, mat, new THREE.Matrix4().multiplyMatrices(frame, _m4), opt);
}
function flushBatches() {
  const out = [];
  for (const b of batches.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const m = new THREE.Mesh(g, b.mat); m.castShadow = b.cast && !b.mat.transparent; m.receiveShadow = true;
    if (b.mat.transparent) m.renderOrder = 2;
    scene.add(m); out.push(m);
  }
  batches.clear(); return out;
}
const frameAt = (x, y, z, ang) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -ang, 0)), new THREE.Vector3(1, 1, 1));

// ---------- ütközők: forgatott dobozok és járható padlók (belső terek) ----------
const boxes = [], floors = [];
// lokális keretben megadott doboz ütközőként (keret: középpont + szög)
function collider(F0, x, z, hx, hz, y0, y1, rot = 0) {
  const c = Math.cos(F0.ang), s = Math.sin(F0.ang);
  const wx = F0.x + x * c - z * s, wz = F0.z + x * s + z * c, a = F0.ang + rot;
  boxes.push({ x: wx, z: wz, c: Math.cos(a), s: Math.sin(a), hx, hz, y0, y1, r: Math.hypot(hx, hz) });
}
// a pozitív forgatás (rot) a lokális keretben a THREE rotation.y-nal ellentétes irányú; a frame -ang-gal forgat
const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb8c4, roughness: .05, metalness: .1, transparent: true, opacity: .22, envMap: ENV, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false });
const alu = new THREE.MeshStandardMaterial({ color: 0x3b4146, roughness: .45, metalness: .6, envMap: ENV });
const steel = new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: .55, metalness: .5, envMap: ENV });
const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: .12, metalness: 1, envMap: ENV });
const textTex = (w, h, draw) => { const t = canvasTex(w, h, draw); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
const emissiveMat = (c, i = 1, o = {}) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: .6, ...o });
const specialHover = []; // egyedi modellek a célzott infóhoz

// ---------- vasúti kocsi-függőhíd ----------
// MÁV Bhv-típusú személykocsi a laborépületek és a központi épület között, 1975 óta átjáró;
// 2023-ban felújították: MÁV–VOLÁN-arculat, tükröződő fólia, „Tiéd a Pálya!” felirat.
let CAR = null;
if (CARRIAGE) {
  const o = obb(CARRIAGE.p), L = o.len, Wc = Math.max(2.82, o.wid), ang = o.ang;
  let gmin = Infinity; for (let i = 0; i < CARRIAGE.p.length; i += 2) gmin = Math.min(gmin, H(CARRIAGE.p[i], CARRIAGE.p[i + 1]));
  const ub = gmin + 4.0, yF = ub + .55, side = 2.35, rise = .5; // alváz alja, padló, oldalfal, tetőív
  const fr = frameAt(o.cx, yF, o.cz, ang);
  CAR = { x: o.cx, z: o.cz, ang, L, W: Wc, yF };
  // ablakok: 9 db, 2,35 m-es osztással, a kocsi közepére szimmetrikusan
  const WIN = []; for (let i = -4; i <= 4; i++) WIN.push(i * 2.35);
  const wW = 1.45, wB = .85, wT = 1.85, pb = .15 - .55; // ablak szélesség, parapet, szemöldök; az oldallap alja a padlóhoz képest
  const PH = side - pb, PX = 2048, PY = 256, sx = PX / L, sy = PY / PH; // oldallap mérete és felbontása
  const toPx = (u, v) => [(u + L / 2) * sx, (PH - (v - pb)) * sy];
  const holes = g => { for (const c of WIN) { const [x0, y0] = toPx(c - wW / 2, wT), [x1, y1] = toPx(c + wW / 2, wB); g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, 12); g.fill(); } };
  // külső festés (lyukak = átlátszó, alphaTest)
  const livery = textTex(PX, PY, (g, w, h) => {
    const [, yWin] = toPx(0, .72), [, yTop] = toPx(0, side - .1);
    const gr = g.createLinearGradient(0, 0, w, 0); // tükröző fólia: foltos ezüst-szürke
    for (let i = 0; i <= 12; i++) gr.addColorStop(i / 12, i % 2 ? '#8e98a3' : '#c3cad1');
    g.fillStyle = gr; g.fillRect(0, 0, w, yWin);
    specks(g, w, yWin, 600, 101, .12, 3, 18);
    g.fillStyle = '#4a545e'; g.fillRect(0, 0, w, yTop);       // tető pereme
    g.fillStyle = '#f2c300'; g.fillRect(0, yTop, w, 7);      // sárga csík
    g.fillStyle = '#e9eef2'; g.fillRect(0, yWin, w, h - yWin); // alsó sáv
    g.fillStyle = '#7b848c'; g.fillRect(0, h - 10, w, 10);
    // kék „lendület”
    const band = (c, x0, x1, sk, t, b) => { g.fillStyle = c; g.beginPath(); g.moveTo(x0 + sk, t); g.lineTo(x1 + sk, t); g.lineTo(x1, b); g.lineTo(x0, b); g.closePath(); g.fill(); };
    band('#1f4fa3', w * .22, w * .9, 40, yWin + 22, h - 26);
    band('#29a8e0', w * .3, w * .78, 30, yWin + 22, h - 46);
    // felirat
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(w * .43, yWin + 20, w * .34, 66, 8); g.fill();
    g.fillStyle = '#1f3f86'; g.font = 'italic 800 46px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText('Tiéd a Pálya!', w * .45, yWin + 54);
    g.font = '700 21px system-ui, sans-serif'; g.fillText('SZÉCHENYI', w * .655, yWin + 44); g.fillText('EGYETEM', w * .655, yWin + 67);
    g.fillStyle = '#1f3f86'; for (let i = 0; i < 4; i++) g.fillRect(w * .638, yWin + 34 + i * 9, 18 - i * 3, 5);
    // ablakkeretek, majd lyukak
    g.fillStyle = '#f4f6f7'; for (const c of WIN) { const [x0, y0] = toPx(c - wW / 2 - .05, wT + .05), [x1, y1] = toPx(c + wW / 2 + .05, wB - .05); g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, 15); g.fill(); }
    g.globalCompositeOperation = 'destination-out'; holes(g); g.globalCompositeOperation = 'source-over';
  });
  // fémesség/érdesség: a fóliás felső sáv tükröz
  const liveryRM = textTex(PX, PY, (g, w, h) => {
    const [, yWin] = toPx(0, .72);
    g.fillStyle = 'rgb(0,70,220)'; g.fillRect(0, 0, w, yWin); g.fillStyle = 'rgb(0,120,40)'; g.fillRect(0, yWin, w, h - yWin);
  });
  liveryRM.colorSpace = THREE.NoColorSpace;
  // belső falburkolat: fehér, sárga-kék grafika
  const inner = textTex(PX, PY, (g, w, h) => {
    g.fillStyle = '#f3f4f2'; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 9; i++) {
      const x = r() * w, c = ['#f5b335', '#2a9fd8', '#1f4fa3'][i % 3], bw = 60 + r() * 140;
      g.fillStyle = c; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + bw, 0); g.lineTo(x + bw - 120, h); g.lineTo(x - 120, h); g.closePath(); g.fill();
    }
    g.fillStyle = '#f3f4f2'; for (const c of WIN) { const [x0, y0] = toPx(c - wW / 2 - .12, wT + .12), [x1, y1] = toPx(c + wW / 2 + .12, wB - .12); g.fillRect(x0, y0, x1 - x0, y1 - y0); }
    g.fillStyle = '#1f3f86'; g.font = '800 40px system-ui, sans-serif'; g.textBaseline = 'top';
    g.fillText('Vonz.', w * .07, 14); g.fillText('Lenyűgöz.', w * .56, 14); g.fillText('Tiéd a Pálya!', w * .82, 14);
    g.font = '700 22px system-ui, sans-serif'; g.fillText('SZÉCHENYI EGYETEM · UNIVERSITY OF GYŐR', w * .25, 22);
    g.globalCompositeOperation = 'destination-out'; holes(g); g.globalCompositeOperation = 'source-over';
  });
  const outerMat = new THREE.MeshStandardMaterial({ map: livery, roughnessMap: liveryRM, metalnessMap: liveryRM, roughness: 1, metalness: 1, alphaTest: .5, envMap: ENV, envMapIntensity: 1.2 });
  const innerMat = new THREE.MeshStandardMaterial({ map: inner, alphaTest: .5, roughness: .6, emissive: 0xffffff, emissiveMap: inner, emissiveIntensity: .18 });
  const sideGeo = new THREE.PlaneGeometry(L, PH), revealM = new THREE.MeshStandardMaterial({ color: 0xeef0ee, roughness: .5 });
  for (const s of [1, -1]) {
    // kívül: kifelé néző lap; belül: befelé néző lap ugyanazokkal a lyukakkal
    geoAt(fr, outerMat, sideGeo, 0, pb + PH / 2, s * Wc / 2, 0, s > 0 ? 0 : Math.PI, 0);
    geoAt(fr, innerMat, sideGeo, 0, pb + PH / 2, s * (Wc / 2 - .07), 0, s > 0 ? Math.PI : 0, 0);
    for (const c of WIN) geoAt(fr, glassMat, new THREE.PlaneGeometry(wW, wT - wB), c, (wB + wT) / 2, s * (Wc / 2 - .035), 0, 0, 0, { cast: false });
    // ablakkáva (a fal vastagsága) és az osztósín az ablak felső harmadában
    for (const c of WIN) {
      box(fr, revealM, wW, .02, .07, c, wB, s * (Wc / 2 - .035)); box(fr, revealM, wW, .02, .07, c, wT, s * (Wc / 2 - .035));
      box(fr, alu, wW, .035, .03, c, wT - .3, s * (Wc / 2 - .03));
    }
    box(fr, emissiveMat(0xf2c300, .2), L, .05, .04, 0, side - .08, s * (Wc / 2 + .01)); // sárga csík
    // fűtőtest-burkolat a padló mentén
    box(fr, new THREE.MeshStandardMaterial({ color: 0xf1f2f0, roughness: .5, emissive: 0xffffff, emissiveIntensity: .08 }), L - .8, .34, .24, 0, .17, s * (Wc / 2 - .19));
    box(fr, steel, L - .8, .02, .2, 0, .345, s * (Wc / 2 - .19));
  }
  // tető: kívül sötétszürke ív, belül fehér mennyezet lámpákkal
  const roofGeo = new THREE.CylinderGeometry(Wc / 2, Wc / 2, L, 24, 1, true, 0, Math.PI);
  roofGeo.rotateZ(Math.PI / 2); roofGeo.scale(1, rise / (Wc / 2), 1);
  geoAt(fr, new THREE.MeshStandardMaterial({ color: 0x4d5762, roughness: .5, metalness: .4, envMap: ENV, side: THREE.FrontSide }), roofGeo, 0, side, 0);
  const ceilGeo = roofGeo.clone(); ceilGeo.scale(1, .96, .97);
  geoAt(fr, new THREE.MeshStandardMaterial({ color: 0xf4f5f3, roughness: .7, side: THREE.BackSide, emissive: 0xffffff, emissiveIntensity: .25 }), ceilGeo, 0, side - .02, 0);
  const lampM = emissiveMat(0xfff6dd, 1.6);
  for (let i = -5; i <= 5; i++) geoAt(fr, lampM, new THREE.CylinderGeometry(.13, .13, .04, 16), i * 2.2, side + rise * .7, 0, 0, 0, 0, { cast: false });
  // padló, alváz, véglapok
  box(fr, new THREE.MeshStandardMaterial({ map: T_ASPH, color: 0x9da2a8, roughness: .7 }), L - .1, .06, Wc - .1, 0, -.03, 0);
  box(fr, new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: .7, metalness: .3 }), L - .3, .5, Wc - .25, 0, -.31, 0);
  const endM = new THREE.MeshStandardMaterial({ color: 0x4d5762, roughness: .6, metalness: .2 });
  for (const e of [1, -1]) {
    box(fr, endM, .08, side + rise * .8, Wc, e * (L / 2 - .04), side / 2, 0);
    box(fr, revealM, .01, side + rise * .7, Wc - .14, e * (L / 2 - .084), side / 2 + .05, 0, 0, { cast: false });
    // átjáró ajtó az épület felé (üvegezett), fölötte zöld kijárat-jelzés és tévé
    box(fr, alu, .06, 2.05, 1.05, e * (L / 2 - .1), 1.03, 0);
    box(fr, glassMat, .02, 1.7, .8, e * (L / 2 - .14), 1.12, 0, 0, { cast: false });
    box(fr, emissiveMat(0x18a058, .9), .03, .14, .36, e * (L / 2 - .14), 2.2, 0);
  }
  // tévéképernyő a déli véglapon
  const tvTex = textTex(512, 288, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#163a7a'); gr.addColorStop(1, '#1f8fd0'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = '800 44px system-ui, sans-serif'; g.fillText('Tiéd a Pálya!', 30, 80);
    g.font = '500 26px system-ui, sans-serif'; g.fillText('MÁV-csoport × Széchenyi Egyetem', 30, 130);
    g.fillText('Képzések · Ösztöndíjak · Gyakornoki programok', 30, 175); g.fillStyle = '#f5b335'; g.fillRect(30, 210, 220, 8);
  });
  const tvM = new THREE.MeshStandardMaterial({ map: tvTex, emissive: 0xffffff, emissiveMap: tvTex, emissiveIntensity: .9, roughness: .3 });
  box(fr, steel, .06, .62, 1.02, -(L / 2 - .16), 1.75, .6);
  geoAt(fr, tvM, new THREE.PlaneGeometry(.95, .54), -(L / 2 - .2), 1.75, .6, 0, Math.PI / 2, 0, { cast: false });
  // acél tartószerkezet: két rácsos tartó a kocsi alatt, a végeken konzol az épületekbe
  const trussY = -.55 - .35;
  for (const s of [1, -1]) {
    box(fr, steel, L, .18, .16, 0, trussY + .35, s * .85); box(fr, steel, L, .14, .14, 0, trussY - .35, s * .85);
    const n = 14, dx = L / n;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + dx * (i + .5), a = Math.atan2(.7, dx) * (i % 2 ? 1 : -1);
      _m4.compose(_v.set(x, trussY, s * .85), _q.setFromEuler(_e.set(0, 0, a)), _s.set(1, 1, 1));
      addGeo(new THREE.BoxGeometry(Math.hypot(dx, .7), .1, .1), steel, new THREE.Matrix4().multiplyMatrices(fr, _m4));
    }
  }
  for (let i = 0; i <= 7; i++) box(fr, steel, .12, .12, 1.9, -L / 2 + i * L / 7, trussY - .35, 0);
  // ütközők: a kocsi belseje egy keskeny folyosó
  const K = { x: o.cx, z: o.cz, ang };
  for (const s of [1, -1]) collider(K, 0, s * (Wc / 2 - .15), L / 2, .16, yF - .2, yF + side + rise);
  for (const e of [1, -1]) collider(K, e * (L / 2 - .1), 0, .12, Wc / 2, yF - .2, yF + side + rise);
  floors.push({ p: rectPoly(K, L / 2 - .05, Wc / 2 - .05), y: yF });
  // a kocsi teteje is járható (repülésből leszállva)
  floors.push({ p: rectPoly(K, L / 2, Wc / 2 - .3), y: yF + side + rise * .9 });
  const hov = new THREE.Mesh(new THREE.BoxGeometry(L, side + rise + .55, Wc), new THREE.MeshBasicMaterial({ visible: false }));
  hov.position.set(o.cx, yF + (side + rise - .55) / 2, o.cz); hov.rotation.y = -ang; hov.updateMatrixWorld();
  hov.userData.f = { info: `<b>Vasúti kocsi – függőhíd</b><br>MÁV személykocsi, 1975 óta átjáró a laborok és a központi épület között · OSM ${CARRIAGE.id}` };
  scene.add(hov); specialHover.push(hov);
}
function rectPoly(K, hx, hz) {
  const c = Math.cos(K.ang), s = Math.sin(K.ang), out = [];
  for (const [a, b] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]]) out.push(K.x + a * c - b * s, K.z + a * s + b * c);
  return out;
}

// ---------- Üveges: üvegfalú pavilon (söröző), bejárható belső térrel ----------
let UV = null;
if (UVEGES) {
  const p = UVEGES.p, fy = UVEGES.floorY;
  // keret: origó az É-Ny-i sarok, x az É-i homlokzat mentén K felé, z befelé (D felé)
  const P = []; for (let i = 0; i < p.length - 2; i += 2) P.push([p[i], p[i + 1]]);
  // keret: origó a homlokzat (udvar felőli, üveges) egyik sarka, x a homlokzat mentén, z befelé
  const [nw, ne] = inward(P[1], P[2], p), ang = Math.atan2(ne[1] - nw[1], ne[0] - nw[0]);
  const c = Math.cos(ang), s = Math.sin(ang), loc = ([x, z]) => [(x - nw[0]) * c + (z - nw[1]) * s, -(x - nw[0]) * s + (z - nw[1]) * c];
  const Lx = Math.hypot(ne[0] - nw[0], ne[1] - nw[1]), sw = loc(P[0]), se = loc(P[3]);
  if (!(sw[1] > 0 && se[1] > 0)) console.warn('Üveges: a keret nem befelé néz', sw, se);
  const Wd = (sw[1] + se[1]) / 2, WH = 3.5; // mélység, belmagasság
  const fr = frameAt(nw[0], fy, nw[1], ang), K = { x: nw[0], z: nw[1], ang };
  UV = { fy, K, Lx, Wd, ang, nw };
  // padló, lábazat, födém
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3a2618'; g.fillRect(0, 0, w, h); const r = rng(201); for (let y = 0; y < 8; y++) for (let x = -1; x < 3; x++) { const v = r() * 30; g.fillStyle = `rgb(${150 + v},${108 + v * .7},${70 + v * .4})`; g.fillRect(x * 128 + (y % 2) * 64, y * 32, 126, 31); }
    specks(g, w, h, 1500, 203, .08, 1, 3);
  }, { rep: [1 / 2.5, 1 / 2.5] });
  const sh = shapeOf(p), slab = (y0, y1, mat, grow = 0) => {
    const pp = grow ? growPoly(p, grow) : p; const g = new THREE.ExtrudeGeometry(shapeOf(pp), { depth: y1 - y0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, y0, 0); addGeo(g, mat, new THREE.Matrix4());
  };
  slab(fy - 2.5, fy - .02, new THREE.MeshStandardMaterial({ map: T_CONCRETE, roughness: 1 }));
  { const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, fy, 0); const uv = g.attributes.uv, pa = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i), pa.getZ(i)); addGeo(g, new THREE.MeshStandardMaterial({ map: floorTex, roughness: .55, envMap: ENV, envMapIntensity: .4 }), new THREE.Matrix4()); }
  slab(fy + WH, fy + WH + .45, new THREE.MeshStandardMaterial({ color: 0x1f3450, roughness: .55, metalness: .3, envMap: ENV }), .35);
  // mennyezet (sötét) fénycsíkokkal
  { const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, fy + WH - .01, 0); addGeo(g, new THREE.MeshStandardMaterial({ color: 0x45494d, roughness: .9, side: THREE.BackSide, emissive: 0xffffff, emissiveIntensity: .06 }), new THREE.Matrix4(), { cast: false }); }
  const lightM = emissiveMat(0xfff1d6, 1.5);
  for (let x = 2; x < Lx - 1; x += 3) box(fr, lightM, 1.6, .03, .12, x, WH - .04, Wd * .3, 0, { cast: false }), box(fr, lightM, 1.6, .03, .12, x, WH - .04, Wd * .7, 0, { cast: false });
  // üvegfalak a Ny-i, É-i és K-i oldalon; ajtónyílások: É-on középen kétszárnyú, Ny-on egy szárny
  const edges = [[P[0], P[1], [[Wd * .5 - .55, Wd * .5 + .55]]], [P[1], P[2], [[Lx * .5 - 1, Lx * .5 + 1]]], [P[2], P[3], []]];
  for (const [a0, b0, gaps] of edges) {
    const [a, b] = inward(a0, b0, p);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ea = Math.atan2(b[1] - a[1], b[0] - a[0]), ef = frameAt(a[0], fy, a[1], ea), EK = { x: a[0], z: a[1], ang: ea };
    const n = Math.max(1, Math.round(L / 1.6)), seg = L / n;
    const inGap = t => gaps.some(([g0, g1]) => t > g0 - .01 && t < g1 + .01);
    // üvegtáblák a nyílások kihagyásával
    let t0 = 0; const cuts = [0, ...gaps.flat(), L].sort((x, y) => x - y);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u0 = cuts[i], u1 = cuts[i + 1]; if (u1 - u0 < .05 || inGap((u0 + u1) / 2)) continue;
      geoAt(ef, glassMat, new THREE.PlaneGeometry(u1 - u0, WH - .12), (u0 + u1) / 2, (WH - .12) / 2 + .06, 0, 0, 0, 0, { cast: false });
      collider(EK, (u0 + u1) / 2, 0, (u1 - u0) / 2, .08, fy - .3, fy + WH);
      t0 = u1;
    }
    // felülvilágító sáv a nyílások fölött
    for (const [g0, g1] of gaps) geoAt(ef, glassMat, new THREE.PlaneGeometry(g1 - g0, WH - 2.35), (g0 + g1) / 2, 2.3 + (WH - 2.35) / 2, 0, 0, 0, 0, { cast: false });
    // osztók, alsó és felső keret, vízszintes osztó 2,3 m-en
    for (let i = 0; i <= n; i++) { const t = i * seg; if (!inGap(t)) box(ef, alu, .07, WH, .12, t, WH / 2, 0); }
    for (const [g0, g1] of gaps) { box(ef, alu, .09, WH, .14, g0, WH / 2, 0); box(ef, alu, .09, WH, .14, g1, WH / 2, 0); }
    box(ef, alu, L, .1, .14, L / 2, WH - .05, 0); box(ef, alu, L, .06, .12, L / 2, 2.3, 0);
    for (let i = 0; i + 1 < cuts.length; i++) { const u0 = cuts[i], u1 = cuts[i + 1]; if (u1 - u0 > .05 && !inGap((u0 + u1) / 2)) box(ef, alu, u1 - u0, .08, .14, (u0 + u1) / 2, .04, 0); }
    // nyitott tolóajtó-szárnyak a nyílás mellett (a fix üveg előtt)
    for (const [g0, g1] of gaps) { const w = (g1 - g0) / 2; box(ef, glassMat, w, 2.2, .02, g0 - w / 2 + .05, 1.12, .09, 0, { cast: false }); if (g1 - g0 > 1.5) box(ef, glassMat, w, 2.2, .02, g1 + w / 2 - .05, 1.12, .09, 0, { cast: false }); }
  }
  // hátsó (D-i) fal belülről: sötét fa burkolat a pult mögött, krétatábla a Ny-i részen
  const [b0, b1] = inward(P[3], P[0], p), backAng = Math.atan2(b1[1] - b0[1], b1[0] - b0[0]);
  const bf = frameAt(b0[0], fy, b0[1], backAng), BL = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
  const wood = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#5a3b26'; g.fillRect(0, 0, w, h); const r = rng(211); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${r() > .5 ? '255,220,180' : '0,0,0'},${.05 + r() * .12})`; g.fillRect(0, r() * h, w, 1 + r() * 3); } }), roughness: .7 });
  box(bf, wood, BL, WH, .1, BL / 2, WH / 2, .08);
  const boardTex = textTex(512, 320, (g, w, h) => {
    g.fillStyle = '#1f2a24'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4f1e8'; g.font = '800 54px system-ui, sans-serif'; g.fillText('ÜVEGES', 28, 70);
    g.font = '500 28px system-ui, sans-serif'; ['Csapolt sörök · Fröccs', 'Kávé · Tea · Üdítők', 'Szendvics · Pizzaszelet', 'Meccsközvetítés a kivetítőn'].forEach((t, i) => g.fillText(t, 30, 130 + i * 44));
    g.strokeStyle = '#c9a25a'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  });
  geoAt(bf, new THREE.MeshStandardMaterial({ map: boardTex, roughness: .9, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: .15 }), new THREE.PlaneGeometry(2.4, 1.5), BL - 4, 1.9, .14, 0, 0, 0, { cast: false });
  // söntés: pult a K-i részen a hátsó fal előtt, mögötte polc palackokkal, csapok, kávégép, hűtő
  const bx0 = Lx * .58, bx1 = Lx - 1.6, bz = Wd - 1.8;
  const counterTop = new THREE.MeshStandardMaterial({ color: 0x1f2225, roughness: .25, metalness: .2, envMap: ENV });
  box(fr, wood, bx1 - bx0, 1.05, .6, (bx0 + bx1) / 2, .525, bz); box(fr, counterTop, bx1 - bx0 + .1, .05, .75, (bx0 + bx1) / 2, 1.075, bz - .05);
  box(fr, wood, .6, 1.05, 1.2, bx0 + .3, .525, bz + .9); box(fr, counterTop, .7, .05, 1.25, bx0 + .3, 1.075, bz + .9);
  box(fr, emissiveMat(0xffc56b, .8), bx1 - bx0, .03, .03, (bx0 + bx1) / 2, .06, bz - .32, 0, { cast: false }); // lábléc-fény
  collider(K, (bx0 + bx1) / 2, bz, (bx1 - bx0) / 2, .4, fy - .2, fy + 1.1); collider(K, bx0 + .3, bz + .9, .35, .6, fy - .2, fy + 1.1);
  for (let i = 0; i < 4; i++) { const x = bx0 + 1.6 + i * .35; box(fr, chrome, .05, .32, .05, x, 1.26, bz - .1); box(fr, chrome, .16, .05, .05, x, 1.42, bz - .1); box(fr, new THREE.MeshStandardMaterial({ color: [0xc9302c, 0x1f3f86, 0x2f7d32, 0xd9a521][i] }), .05, .14, .05, x, 1.5, bz - .1); }
  box(fr, new THREE.MeshStandardMaterial({ color: 0x9c1f1f, roughness: .3, metalness: .4, envMap: ENV }), .55, .5, .45, bx1 - .5, 1.35, bz + .1);
  const shelfZ = Wd - .3, bottleCols = [0x2e6b2f, 0x6b3b1d, 0xd9c9a3, 0x1d3f6b, 0x8a1c1c, 0xe0e0d8];
  for (const y of [1.25, 1.75, 2.25]) {
    box(fr, wood, bx1 - bx0 + .4, .04, .3, (bx0 + bx1) / 2, y, shelfZ);
    for (let x = bx0; x < bx1; x += .16) { const k = Math.floor(hash1('b' + x.toFixed(2) + y) * 6); geoAt(fr, new THREE.MeshStandardMaterial({ color: bottleCols[k], roughness: .15, metalness: .1, envMap: ENV }), new THREE.CylinderGeometry(.035, .04, .28, 8), x, y + .16, shelfZ, 0, 0, 0, { cast: false }); }
  }
  // üvegajtós hűtő a sarokban
  box(fr, steel, .75, 2.0, .65, Lx - .7, 1.0, Wd - .45);
  box(fr, emissiveMat(0xdff3ff, .7), .62, 1.75, .02, Lx - .7, 1.05, Wd - .79, 0, { cast: false });
  // asztalok székekkel a Ny-i részen, magas pult az É-i üvegfal mentén
  const tableTop = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: .6 });
  const chairM = new THREE.MeshStandardMaterial({ color: 0x2d3236, roughness: .5, metalness: .3 });
  const table = (F0, K0, x, z, n = 4, outdoor = false) => {
    box(F0, tableTop, .8, .04, .8, x, .75, z); box(F0, steel, .06, .73, .06, x, .365, z); box(F0, steel, .5, .03, .5, x, .015, z);
    for (let k = 0; k < n; k++) {
      const a = k * Math.PI * 2 / n, cx = x + Math.cos(a) * .62, cz = z + Math.sin(a) * .62;
      box(F0, outdoor ? new THREE.MeshStandardMaterial({ color: 0x6b7a3a, roughness: .6 }) : chairM, .42, .04, .42, cx, .45, cz, -a);
      box(F0, chairM, .04, .45, .04, cx, .225, cz, -a);
      const bxp = cx + Math.cos(a) * .2, bzp = cz + Math.sin(a) * .2; box(F0, chairM, .06, .45, .42, bxp, .68, bzp, -a);
    }
    collider(K0, x, z, .55, .55, fy - .2, fy + .8);
  };
  for (const x of [2.2, 5.0, 7.8]) for (const z of [Wd * .3, Wd * .72]) table(fr, K, x, z);
  box(fr, tableTop, Lx * .38, .05, .4, Lx * .76, 1.05, .45); collider(K, Lx * .76, .45, Lx * .19, .22, fy - .2, fy + 1.1);
  for (let x = Lx * .58; x < Lx * .95; x += .9) { box(fr, chrome, .05, .75, .05, x, .38, .95); geoAt(fr, chairM, new THREE.CylinderGeometry(.19, .19, .06, 14), x, .77, .95); }
  // függőlámpák
  for (const x of [2.2, 5.0, 7.8]) for (const z of [Wd * .3, Wd * .72]) { box(fr, steel, .01, .9, .01, x, WH - .45, z, 0, { cast: false }); geoAt(fr, new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: .4, metalness: .6, side: THREE.DoubleSide }), new THREE.ConeGeometry(.22, .25, 16, 1, true), x, WH - 1.0, z, 0, 0, 0, { cast: false }); geoAt(fr, emissiveMat(0xffd9a0, 2), new THREE.CircleGeometry(.18, 16), x, WH - 1.12, z, Math.PI / 2, 0, 0, { cast: false }); }
  // kivetítő
  const tv2 = textTex(512, 288, (g, w, h) => { g.fillStyle = '#123d1f'; g.fillRect(0, 0, w, h); g.fillStyle = '#2f8a3c'; for (let i = 0; i < 8; i++) g.fillRect(i * 64, 0, 32, h); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(20, 20, w - 40, h - 40); g.beginPath(); g.moveTo(w / 2, 20); g.lineTo(w / 2, h - 20); g.stroke(); g.beginPath(); g.arc(w / 2, h / 2, 40, 0, 7); g.stroke(); g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(20, 20, 170, 40); g.fillStyle = '#fff'; g.font = '700 24px system-ui'; g.fillText('ETO 2 – 1', 34, 48); });
  geoAt(bf, new THREE.MeshStandardMaterial({ map: tv2, emissive: 0xffffff, emissiveMap: tv2, emissiveIntensity: .8 }), new THREE.PlaneGeometry(2.0, 1.12), BL - 7.6, 2.05, .15, 0, 0, 0, { cast: false });
  box(bf, steel, 2.1, 1.22, .04, BL - 7.6, 2.05, .12);
  // növények
  for (const [x, z] of [[.6, .6], [Lx - .6, .6], [.6, Wd - .7]]) { geoAt(fr, new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: .9 }), new THREE.CylinderGeometry(.25, .2, .5, 12), x, .25, z); geoAt(fr, new THREE.MeshStandardMaterial({ map: T_LEAF, color: 0x4f7f3a, roughness: 1 }), new THREE.IcosahedronGeometry(.45, 1), x, .95, z); collider(K, x, z, .3, .3, fy - .2, fy + 1.3); }
  // felirat az attikán (kívül, É-i oldal)
  const signTex = textTex(1024, 128, (g, w, h) => { g.fillStyle = '#1f3450'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.font = '800 92px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ÜVEGES', w / 2, h / 2 + 4); });
  geoAt(fr, new THREE.MeshStandardMaterial({ map: signTex, roughness: .5, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: .25 }), new THREE.PlaneGeometry(3.6, .45), Lx / 2, WH + .225, -.37, 0, Math.PI, 0, { cast: false });
  // terasz (a Street View alapján): a lépcső felőli végén nagy, többszínű, nyolcszögletű ernyő
  // piros sörpad-garnitúrákkal, a többi részen asztalok, mellette zöld szemetesek
  const tw = (lx, lz) => [nw[0] + lx * c - lz * s, nw[1] + lx * s + lz * c];
  const red = new THREE.MeshStandardMaterial({ color: 0xb3352a, roughness: .7 });
  const picnic = (F0, x, z, rot) => {
    box(F0, red, 1.9, .05, .75, x, .76, z, rot); box(F0, red, 1.9, .05, .28, x - Math.sin(rot) * .62, .45, z - Math.cos(rot) * .62, rot); box(F0, red, 1.9, .05, .28, x + Math.sin(rot) * .62, .45, z + Math.cos(rot) * .62, rot);
    for (const e of [-.75, .75]) box(F0, red, .06, .74, 1.5, x + Math.cos(rot) * e, .37, z - Math.sin(rot) * e, rot);
  };
  {
    const lx = Lx * .22, lz = -4, [wx, wz] = tw(lx, lz), gy = H(wx, wz), f2 = frameAt(nw[0], gy, nw[1], ang);
    const cols = [0xc23a2f, 0x1f5fb0, 0x2e8b45, 0xc23a2f, 0x1f5fb0, 0xe0b52b, 0x2e8b45, 0x1f5fb0];
    for (let i = 0; i < 8; i++) geoAt(f2, new THREE.MeshStandardMaterial({ color: cols[i], roughness: .8, side: THREE.DoubleSide }), new THREE.ConeGeometry(4.6, 1.1, 1, 1, true, i * Math.PI / 4, Math.PI / 4), lx, 3.35, lz);
    for (let i = 0; i < 8; i++) { const a = (i + .5) * Math.PI / 4; box(f2, new THREE.MeshStandardMaterial({ color: cols[i], roughness: .8 }), 3.5, .32, .02, lx + Math.sin(a) * 4.25, 2.66, lz + Math.cos(a) * 4.25, a + Math.PI / 2); }
    geoAt(f2, steel, new THREE.CylinderGeometry(.07, .09, 3.9, 10), lx, 1.95, lz);
    for (const [dx, dz] of [[-1.7, -1.4], [1.7, -1.4], [-1.7, 1.4], [1.7, 1.4]]) { picnic(f2, lx + dx, lz + dz, 0); collider(K, lx + dx, lz + dz, 1.0, .95, gy - .2, gy + .8); }
    const bin = new THREE.MeshStandardMaterial({ color: 0x2f9d4a, roughness: .5 });
    for (const dx of [-4.8, 5.2]) geoAt(f2, bin, new THREE.CylinderGeometry(.3, .27, 1.0, 14), lx + dx, .5, lz - 1.8);
  }
  for (const x of [Lx * .7, Lx * .9]) {
    const lz = -3.2, [wx, wz] = tw(x, lz), gy = H(wx, wz), f2 = frameAt(nw[0], gy, nw[1], ang);
    picnic(f2, x, lz, Math.PI / 2); collider(K, x, lz, .95, 1.0, gy - .2, gy + .8);
  }
  floors.push({ p: p, y: fy });
  const hov = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: WH, bevelEnabled: false }), new THREE.MeshBasicMaterial({ visible: false }));
  hov.geometry.rotateX(-Math.PI / 2); hov.position.y = fy; hov.updateMatrixWorld();
  hov.userData.f = { info: `<b>Üveges</b><br>üvegfalú pavilon, söröző · 1 szint · bejárható · OSM ${UVEGES.id}` };
  scene.add(hov); specialHover.push(hov);
}
// egy él végpontjai olyan sorrendben, hogy a lokális +z (balra merőleges) a sokszög belseje felé mutasson
function inward(a, b, p) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), zx = -(b[1] - a[1]) / L, zz = (b[0] - a[0]) / L;
  return pip((a[0] + b[0]) / 2 + zx * .5, (a[1] + b[1]) / 2 + zz * .5, p) ? [a, b] : [b, a];
}
function growPoly(p, d) {
  // egyszerű kifelé tolás a súlypontból (konvex, kis sokszögekhez elég)
  const [cx, cz] = centroid(p), out = [];
  for (let i = 0; i < p.length; i += 2) { const dx = p[i] - cx, dz = p[i + 1] - cz, l = Math.hypot(dx, dz) || 1; out.push(p[i] + dx / l * d, p[i + 1] + dz / l * d); }
  return out;
}
flushBatches();
for (const f of floors) f.bb = bbox(f.p);

// ---------- fák ----------
// OSM-fák + műholdképről detektált lombkoronák (épületbe, vízbe, úttestre nem teszünk fát)
function buildTrees() {
const TREES = []; for (let i = 0; i + 1 < DATA.trees.length; i += 2) TREES.push([DATA.trees[i], DATA.trees[i + 1]]);
const OC = 25, occ = new Map();
for (const f of [...blds, ...parts, ...F.filter(f => f.k === 'w' || f.k === 'pool'), ...keepOut]) {
  for (let gx = Math.floor(Math.max(f.bb.x0, -1200) / OC); gx <= Math.floor(Math.min(f.bb.x1, 1200) / OC); gx++)
    for (let gz = Math.floor(Math.max(f.bb.z0, -1200) / OC); gz <= Math.floor(Math.min(f.bb.z1, 1200) / OC); gz++) {
      const k = gx + ',' + gz; if (!occ.has(k)) occ.set(k, []); occ.get(k).push(f);
    }
}
const occupied = (x, z) => (occ.get(Math.floor(x / OC) + ',' + Math.floor(z / OC)) || []).some(f => x >= f.bb.x0 - 1 && x <= f.bb.x1 + 1 && z >= f.bb.z0 - 1 && z <= f.bb.z1 + 1 && (pip(x, z, f.p) || pip(x + 1.5, z, f.p) || pip(x - 1.5, z, f.p) || pip(x, z + 1.5, f.p) || pip(x, z - 1.5, f.p)));
function onCarRoad(x, z) {
  const gx = Math.floor(x / 20), gz = Math.floor(z / 20);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [ax, az, bx, bz, w] of carSegGrid.get((gx + a) + ',' + (gz + b)) || []) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    if (Math.hypot(ax + t * dx - x, az + t * dz - z) < w / 2 + 1) return true;
  }
  return false;
}
const ST = DATA.satTrees || [];
for (let i = 0; i + 1 < ST.length; i += 2) { const x = ST[i], z = ST[i + 1]; if (!occupied(x, z) && !onCarRoad(x, z)) TREES.push([x, z]); }
if (TREES.length) {
  const n = TREES.length;
  // kifejlett lombos fák: ~12–20 m magas, 7–9 m széles korona; a korona kissé szabálytalan, levéltextúrával
  const crownGeo = new THREE.IcosahedronGeometry(3.6, 1);
  { // göröngyös korona, gömbi (sima) normálokkal; alul és belül sötétebb (vertex-AO)
    const pa = crownGeo.attributes.position, na = crownGeo.attributes.normal, col = [];
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), l = Math.hypot(x, y, z);
      const k = 1 + .2 * Math.sin(x * 1.9 + y * 1.3) * Math.cos(z * 1.7 - y * .9) + .08 * Math.sin(x * 4.1 - z * 3.7 + y * 2.9);
      pa.setXYZ(i, x * k, y * k, z * k); na.setXYZ(i, x / l, y / l, z / l);
      const ao = .55 + .45 * (y / l * .5 + .5); col.push(ao, ao, ao);
    }
    crownGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.22, .32, 6, 7), new THREE.MeshStandardMaterial({ map: T_BARK, roughness: 1 }), n);
  const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ map: T_LEAF, roughness: 1, vertexColors: true }), n);
  const o = new THREE.Object3D(), col = new THREE.Color();
  TREES.forEach(([x, z], i) => {
    const r = ((i * 9301 + 49297) % 233280) / 233280, s = .8 + r * .55, y = H(x, z);
    o.position.set(x, y + 3 * s, z); o.scale.set(s, s, s); o.rotation.set(0, r * 6.28, 0); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix);
    o.position.set(x, y + 8 * s, z); o.scale.set(s, s * 1.15, s); o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
    crown.setColorAt(i, col.setHSL(.24 + r * .07, .38 + r * .12, .3 + ((i * 7) % 10) / 90));
  });
  trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true;
  scene.add(trunk, crown);
}
return TREES.length;
}

// ---------- falak, kerítések, sövények, gát ----------
function wallGeo(p, w, h, y0 = 0) {
  const pos = [], idx = [];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < .01) continue;
    const nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2, b = pos.length / 3;
    for (const [x, z] of [[ax + nx, az + nz], [ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz]]) pos.push(x, H(x, z) + y0 - .3, z);
    for (const [x, z] of [[ax + nx, az + nz], [ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz]]) pos.push(x, H(x, z) + y0 + h, z);
    idx.push(b, b + 3, b + 7, b, b + 7, b + 4, b + 1, b + 5, b + 6, b + 1, b + 6, b + 2, b + 4, b + 7, b + 6, b + 4, b + 6, b + 5, b, b + 4, b + 5, b, b + 5, b + 1, b + 3, b + 2, b + 6, b + 3, b + 6, b + 7);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
function addWall(list, w, h, mat, cast = true) {
  for (const f of list) {
    const g = wallGeo(f.p, w, parseFloat(f.h) || h); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true; scene.add(m);
  }
}
const barriers = F.filter(f => f.k === 'x');
addWall(barriers.filter(f => f.t === 'wall'), .3, 2, new THREE.MeshStandardMaterial({ color: 0xb9b1a3, roughness: 1, side: THREE.DoubleSide }));
addWall(barriers.filter(f => f.t === 'retaining_wall'), .4, 1, new THREE.MeshStandardMaterial({ color: 0xa39d92, roughness: 1, side: THREE.DoubleSide }));
addWall(barriers.filter(f => f.t === 'city_wall'), 2, 6, new THREE.MeshStandardMaterial({ color: 0xc2ad8a, roughness: 1, side: THREE.DoubleSide }));
addWall(barriers.filter(f => f.t === 'hedge'), .9, 1.3, new THREE.MeshStandardMaterial({ color: 0x47703a, roughness: 1, side: THREE.DoubleSide }));
addWall(barriers.filter(f => /fence|guard_rail|handrail/.test(f.t)), .05, 1.5, new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: .6, transparent: true, opacity: .55, side: THREE.DoubleSide }), false);
for (const f of F.filter(f => f.k === 'dk')) { // árvízvédelmi gát: trapéz keresztmetszet
  const pos = [], g = new THREE.BufferGeometry();
  // két ferde rézsű + korona, szalagként a gát vonala mentén
  for (let i = 0; i + 3 < f.p.length; i += 2) {
    const ax = f.p[i], az = f.p[i + 1], bx = f.p[i + 2], bz = f.p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < .01) continue;
    const ux = -(bz - az) / L, uz = (bx - ax) / L;
    const P = (x, z, o, y) => [x + ux * o, y + H(x + ux * o, z + uz * o), z + uz * o];
    for (const [o1, y1, o2, y2] of [[-6, 0, -2, 2.2], [-2, 2.2, 2, 2.2], [2, 2.2, 6, 0]]) {
      const a1 = P(ax, az, o1, y1), a2 = P(ax, az, o2, y2), b1 = P(bx, bz, o1, y1), b2 = P(bx, bz, o2, y2);
      pos.push(...a1, ...b1, ...b2, ...a1, ...b2, ...a2);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x7f9d5a, roughness: 1, side: THREE.DoubleSide })); m.receiveShadow = true; scene.add(m);
}

// ---------- hidak: korlát a hídon futó utak két oldalán ----------
{
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: .5 });
  for (const f of roads.filter(r => r.br)) {
    const w = (parseFloat(f.wd) || RW[f.t]) / 2 + .1, p = f.p, L = [], Rr = [];
    for (let i = 0; i < p.length; i += 2) {
      const j = Math.min(i, p.length - 4), dx = p[j + 2] - p[j], dz = p[j + 3] - p[j + 1], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * w, nz = dx / l * w;
      L.push(p[i] + nx, p[i + 1] + nz); Rr.push(p[i] - nx, p[i + 1] - nz);
    }
    for (const side of [L, Rr]) { const g = wallGeo(side, .12, 1.1, .05); g.computeVertexNormals(); const m = new THREE.Mesh(g, railMat); m.castShadow = true; scene.add(m); }
  }
}

// ---------- lépcsők (OSM highway=steps, lépcsőfok-számmal) ----------
// beton fokok, két oldalt beton arcfal, 5 foktól korlát; az udvari főlépcső szélesebb (Street View)
{
  const list = DATA.steps || [], mats = [], cheeks = [];
  const railM = new THREE.MeshStandardMaterial({ color: 0x8d949a, roughness: .35, metalness: .8, envMap: ENV });
  const I = new THREE.Matrix4();
  // rúd két pont között (korlát)
  const beam = (ax, ay, az, bx, by, bz, r) => {
    const d = new THREE.Vector3(bx - ax, by - ay, bz - az), L = d.length(); if (L < .01) return;
    const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1));
    addGeo(new THREE.CylinderGeometry(r, r, L, 8), railM, m);
  };
  for (const s of list) {
    const p = s.p; if (p.length < 6) continue;
    // polilinia hossza és pontjai (x,z)
    const pts = []; for (let i = 0; i < p.length; i += 3) pts.push([p[i], p[i + 1]]);
    const seg = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
    if (L < .5) continue;
    const W = STAIR_W[pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1)] || 2.6;
    const h0 = H(pts[0][0], pts[0][1]), h1 = H(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const N = Math.max(2, s.n || Math.round(Math.abs(h1 - h0) / 0.16) || Math.round(L / 0.32));
    const at = t => { let d = t * L; for (let i = 0; i < seg.length; i++) { if (d <= seg[i] || i === seg.length - 1) { const k = seg[i] ? d / seg[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k, Math.atan2(-(pts[i + 1][1] - pts[i][1]), pts[i + 1][0] - pts[i][0])]; } d -= seg[i]; } };
    const lo = Math.min(h0, h1) - .4, rail = [];
    for (let i = 0; i < N; i++) {
      const [x, z, a] = at((i + .5) / N), top = h0 + (h1 - h0) * (i + (h1 > h0 ? 1 : 0)) / N + .14;
      mats.push({ x, z, a, d: L / N + .02, w: W, top, lo });
      // arcfalak a lépcső két oldalán (fokonként lépcsőzve, a fok fölé 25 cm-rel)
      for (const sd of [-1, 1]) cheeks.push({ x: x + Math.sin(a) * sd * (W / 2 + .1), z: z + Math.cos(a) * sd * (W / 2 + .1), a, d: L / N + .02, w: .2, top: top + .25, lo });
      rail.push([x + Math.sin(a) * (W / 2 - .05), top, z + Math.cos(a) * (W / 2 - .05)]);
    }
    if (N >= 5) { // korlát a bal arcfalon: oszlopok + ferde kapaszkodó
      const up = h1 > h0 ? rail : rail.slice().reverse(), q = up.map(([x, y, z]) => [x, y + .25, z]);
      for (let i = 0; i < q.length; i += Math.max(1, Math.round(q.length / 4))) beam(q[i][0], q[i][1], q[i][2], q[i][0], q[i][1] + .9, q[i][2], .025);
      beam(q[q.length - 1][0], q[q.length - 1][1], q[q.length - 1][2], q[q.length - 1][0], q[q.length - 1][1] + .9, q[q.length - 1][2], .025);
      beam(q[0][0], q[0][1] + .9, q[0][2], q[q.length - 1][0], q[q.length - 1][1] + .9, q[q.length - 1][2], .03);
    }
  }
  const all = [...mats, ...cheeks];
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: T_CONCRETE, color: 0xd8d3c8, roughness: .95 }), Math.max(1, all.length));
  const o = new THREE.Object3D();
  all.forEach((m, i) => { const hh = Math.max(.05, m.top - m.lo); o.position.set(m.x, m.lo + hh / 2, m.z); o.rotation.set(0, m.a, 0); o.scale.set(m.d, hh, m.w); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.count = all.length; im.castShadow = im.receiveShadow = true; scene.add(im);
}

// ---------- helyi részletek a Street View fotói alapján ----------
{
  const conc = new THREE.MeshStandardMaterial({ map: T_CONCRETE, color: 0xcfcac0, roughness: .95 }), I = new THREE.Matrix4();
  // alacsony beton támfal a parkoló szélén, a lépcsőtől délre (előtte a kerékpártámasz, mögötte a füves udvar)
  const wallLine = [[107.6, -54.0], [118.6, -54.5]];
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12, t1 = (i + 1) / 12, [[ax, az], [bx, bz]] = wallLine;
    const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1, xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    const L = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
    const low = H(xm, zm - 1.2), top = Math.max(H(xm, zm + 1.2) + .12, low + .7);
    box(frameAt(xm, 0, zm, a), conc, L + .02, top - low + .4, .3, 0, (top + low - .4) / 2, 0);
    collider({ x: xm, z: zm, ang: a }, 0, 0, L / 2, .15, low - .4, top);
  }
  // OTP-automata a laborépület sarkán, sötétkék panelben (OSM amenity=atm, OTP Bank)
  const atm = (DATA.poi || []).find(q => /otp/i.test(q.n || '')) || { p: [124.3, -63.0] };
  const host = blds.filter(f => !f.custom && f.campus).map(f => {
    let best = null;
    for (let i = 0; i + 3 < f.p.length; i += 2) {
      const ax = f.p[i], az = f.p[i + 1], dx = f.p[i + 2] - ax, dz = f.p[i + 3] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(.1, Math.min(.9, ((atm.p[0] - ax) * dx + (atm.p[1] - az) * dz) / l2)), px = ax + t * dx, pz = az + t * dz, d = Math.hypot(px - atm.p[0], pz - atm.p[1]);
      if (!best || d < best.d) best = { d, px, pz, ang: Math.atan2(dz, dx), f };
    }
    return best;
  }).filter(Boolean).sort((a, b) => a.d - b.d)[0];
  if (host && host.d < 6) {
    let { px, pz, ang, f } = host;
    // kifelé néző lokális +z
    if (pip(px - Math.sin(ang) * .3, pz + Math.cos(ang) * .3, f.p)) ang += Math.PI;
    const gy = H(px + -Math.sin(ang) * 1, pz + Math.cos(ang) * 1), fr = frameAt(px, gy, pz, ang);
    const navy = new THREE.MeshStandardMaterial({ color: 0x1f3450, roughness: .5, metalness: .2, envMap: ENV });
    const green = new THREE.MeshStandardMaterial({ color: 0x52ae32, roughness: .45 });
    const otpTex = textTex(256, 128, (g, w, h) => { g.fillStyle = '#52ae32'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '800 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('otp', w / 2, h / 2 - 4); g.font = '600 24px system-ui'; g.fillText('bank', w / 2, h - 20); });
    box(fr, navy, 2.0, 5.6, .12, 0, 2.8, .06);                       // sötétkék panelsáv a homlokzaton
    box(fr, new THREE.MeshStandardMaterial({ color: 0x5d646b, roughness: .4, metalness: .6, envMap: ENV }), .9, 1.75, .28, 0, .88, .16); // automata
    box(fr, green, 1.0, .28, .45, 0, 1.85, .25);                      // zöld napellenző
    box(fr, new THREE.MeshStandardMaterial({ color: 0x0f1a14, emissive: 0x3a9a5a, emissiveIntensity: .35 }), .42, .3, .02, 0, 1.3, .31); // kijelző
    box(fr, new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: .4, metalness: .6 }), .7, .06, .2, 0, 1.0, .38); // billentyűzet-polc
    geoAt(fr, new THREE.MeshStandardMaterial({ map: otpTex, roughness: .5, emissive: 0xffffff, emissiveMap: otpTex, emissiveIntensity: .15 }), new THREE.PlaneGeometry(.9, .45), -1.6, 2.9, .26, 0, 0, 0, { cast: false });
    box(fr, green, .95, .5, .2, -1.6, 2.9, .15);                        // „otp” tábla a falon
    collider({ x: px, z: pz, ang }, 0, .2, .55, .25, gy - .2, gy + 2);
  }
  flushBatches();
}

// ---------- utcabútorok (OSM pontok) ----------
// legközelebbi út iránya, hogy a padok/megállók az úttal párhuzamosan álljanak
const segGrid = new Map();
for (const r of roads) for (let i = 0; i + 3 < r.p.length; i += 2) {
  const k = Math.floor((r.p[i] + r.p[i + 2]) / 2 / 20) + ',' + Math.floor((r.p[i + 1] + r.p[i + 3]) / 2 / 20);
  if (!segGrid.has(k)) segGrid.set(k, []); segGrid.get(k).push([r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]]);
}
function roadAngle(x, z) {
  let best = 1e9, ang = 0; const gx = Math.floor(x / 20), gz = Math.floor(z / 20);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [ax, az, bx, bz] of segGrid.get((gx + a) + ',' + (gz + b)) || []) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const d = Math.hypot(ax + t * dx - x, az + t * dz - z); if (d < best) { best = d; ang = Math.atan2(-dz, dx); }
  }
  return ang;
}
const D = DATA.d || {};
const ptsOf = t => { const a = D[t] || [], r = []; for (let i = 0; i + 1 < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .7, ...o });
// egy "tárgy" = [geometria, anyag, eltolás y] részek listája; InstancedMesh-ként rakjuk le
function place(type, parts, { align = false, cast = true } = {}) {
  const P = ptsOf(type); if (!P.length) return;
  const o = new THREE.Object3D();
  for (const [geo, mat, dy = 0, dx = 0, dz = 0] of parts) {
    const im = new THREE.InstancedMesh(geo, mat, P.length);
    P.forEach(([x, z], i) => {
      const a = align ? roadAngle(x, z) : 0;
      o.position.set(x + Math.cos(a) * dx + Math.sin(a) * dz, dy + H(x, z), z - Math.sin(a) * dx + Math.cos(a) * dz); o.rotation.set(0, a, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    });
    im.castShadow = cast; im.receiveShadow = true; scene.add(im);
  }
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), CY = (r1, r2, h, s = 8) => new THREE.CylinderGeometry(r1, r2, h, s);
const metal = std(0x3b4047, { metalness: .4, roughness: .5 }), wood = std(0x8a6038), concrete = std(0xb4afa6, { roughness: 1 });
place('lamp', [[CY(.07, .1, 6), metal, 3], [B(.25, .12, .7), metal, 6.05, 0, .3], [B(.18, .03, .5), std(0xfff6d8, { emissive: 0xfff0c0, emissiveIntensity: .6 }), 5.98, 0, .3]], { align: true });
place('bench', [[B(1.8, .06, .45), wood, .45], [B(1.8, .4, .06), wood, .7, 0, -.22], [B(.08, .45, .45), metal, .22, -.8], [B(.08, .45, .45), metal, .22, .8]], { align: true });
place('seat', [[B(1.8, .06, .45), wood, .45], [B(.08, .45, .45), metal, .22, -.8], [B(.08, .45, .45), metal, .22, .8]], { align: true });
place('bin', [[CY(.25, .22, .9, 10), std(0x2f4f3a), .45]]);
place('hydrant', [[CY(.12, .14, .8, 10), std(0xc0392b), .4], [new THREE.SphereGeometry(.13, 10, 6), std(0xc0392b), .8]]);
place('bollard', [[CY(.08, .08, .9, 8), metal, .45]], { cast: false });
{ // kerékpártámasz: ívelt csőkorlátok sorban
  const hoop = new THREE.TorusGeometry(.38, .028, 6, 14, Math.PI);
  place('bike', [-1.2, -.6, 0, .6, 1.2].map(dz => [hoop, metal, .45, 0, dz]), { align: true });
}
place('bikerent', [[B(4, 1.0, .3), std(0x2b78c2), .5], [B(1.2, .05, .6), std(0x2b78c2), 1.2]], { align: true });
place('bus', [[B(3.2, .1, 1.6), std(0x56606b), 2.6, 0, -.8], [B(3.2, 2.5, .04), std(0x9fc3d6, { transparent: true, opacity: .45 }), 1.3, 0, -1.55], [CY(.05, .05, 2.6), metal, 1.3, 1.5, -1.55], [CY(.05, .05, 2.6), metal, 1.3, -1.5, -1.55], [B(.5, .5, .04), std(0xf2c230), 2.9, 1.9, 0]], { align: true });
place('info', [[CY(.05, .05, 1.2), metal, .6], [B(1.0, .8, .06), std(0x1f3c63), 1.5]], { align: true });
place('water', [[CY(.15, .2, 1.0, 10), metal, .5]]);
place('vend', [[B(.9, 1.9, .8), std(0xb33a3a), .95]]);
place('recycle', [[B(1.6, 1.5, 1.6), std(0x3d7d47), .75], [B(1.6, 1.5, 1.6), std(0xe0b52b), .75, 1.8], [B(1.6, 1.5, 1.6), std(0x2f6fb5), .75, 3.6]], { align: true });
place('gate', [[B(.3, 1, .3), std(0xd9d9d9), .5, 0, -2.6], [B(.12, .12, 5), std(0xd23b3b), .95, 0, 0], [B(.13, .02, .5), std(0xf2f2f2), 1.02, 0, -1.2], [B(.13, .02, .5), std(0xf2f2f2), 1.02, 0, 1.2]], { align: true });
place('memorial', [[B(1.2, 1.4, 1.2), concrete, .7], [CY(.25, .35, 1.4, 8), std(0x5d6b5e, { metalness: .5 }), 2.1]]);
place('art', [[B(1.2, .8, 1.2), concrete, .4], [new THREE.TorusKnotGeometry(.45, .12, 48, 8), std(0x6b5a45, { metalness: .6, roughness: .4 }), 1.5]]);
place('fountain', [[CY(2.2, 2.4, .5, 24), concrete, .25], [CY(2.0, 2.0, .05, 24), std(0x5aa6cf, { roughness: .1, metalness: .2 }), .48], [CY(.15, .2, 1.5, 8), concrete, .75]]);
place('play', [[B(2, .15, 2), std(0xd9772b), 1.2], [CY(.06, .06, 2.4), std(0x2b78c2), 1.2, .9, .9], [CY(.06, .06, 2.4), std(0x2b78c2), 1.2, -.9, -.9], [B(.6, .05, 2.6), std(0xe2c033), .7, 1.4, 0]]);
const namedPoi = DATA.poi || [];
const carSegGrid = new Map();
for (const r of roads) for (let i = 0; i + 3 < r.p.length; i += 2) {
  const k = Math.floor((r.p[i] + r.p[i + 2]) / 2 / 20) + ',' + Math.floor((r.p[i + 1] + r.p[i + 3]) / 2 / 20);
  if (!carSegGrid.has(k)) carSegGrid.set(k, []); carSegGrid.get(k).push([r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], parseFloat(r.wd) || RW[r.t]]);
}
const treeCount = buildTrees();

// ---------- feliratok ----------
const labels = new THREE.Group(); scene.add(labels);
function label(text, sub) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const fs = 44; g.font = `700 ${fs}px system-ui, sans-serif`;
  const w1 = g.measureText(text).width; g.font = `400 30px system-ui, sans-serif`; const w2 = sub ? g.measureText(sub).width : 0;
  c.width = Math.ceil(Math.max(w1, w2) + 40); c.height = sub ? 104 : 68;
  g.fillStyle = 'rgba(18,22,28,.8)'; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 16); g.fill();
  g.fillStyle = '#fff'; g.font = `700 ${fs}px system-ui, sans-serif`; g.textBaseline = 'top'; g.fillText(text, 20, 12);
  if (sub) { g.fillStyle = '#e3a33b'; g.font = `400 30px system-ui, sans-serif`; g.fillText(sub, 20, 62); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, transparent: true }));
  const k = 0.045; s.scale.set(c.width * k, c.height * k, 1);
  return s;
}
const named = [...blds, ...parts].filter(f => f.n && f.campus && !(f.part && f.parent && f.parent.n === f.n));
for (const f of named) {
  const s = label(f.n, f.l ? `${f.l} szint` : null);
  s.position.set(f.c[0], (f.base || 0) + (f.custom && f.floorY ? f.floorY - f.base + 4 : (f.top || f.h)) + 5, f.c[1]); labels.add(s);
}
if (CAR) { const s = label('Vasúti kocsi', 'függőhíd, 1975 óta'); s.position.set(CAR.x, CAR.yF + 6, CAR.z); labels.add(s); }

// ---------- ütközés (2D rács a földig érő épületekre) ----------
const CELL = 25, grid = new Map();
const solids = [...blds.filter(b => !b.hasParts), ...parts].filter(f => f.mh < 2 && f.h > 1.5 && f.bt !== 'roof' && !f.custom);
for (const s of solids) {
  for (let gx = Math.floor(s.bb.x0 / CELL); gx <= Math.floor(s.bb.x1 / CELL); gx++)
    for (let gz = Math.floor(s.bb.z0 / CELL); gz <= Math.floor(s.bb.z1 / CELL); gz++) {
      const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s);
    }
}
const R = 0.35, BODY = 1.75, STEP = 0.45;
function blockedAt(x, z, feet) {
  const l = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (l) for (const s of l) {
    if (feet >= s.base + s.h - 0.3) continue;
    if (x < s.bb.x0 - R || x > s.bb.x1 + R || z < s.bb.z0 - R || z > s.bb.z1 + R) continue;
    if (pip(x, z, s.p) || pip(x + R, z, s.p) || pip(x - R, z, s.p) || pip(x, z + R, s.p) || pip(x, z - R, s.p)) return true;
  }
  for (const b of boxes) {
    if (feet >= b.y1 - 0.3 || feet + BODY <= b.y0) continue;
    const dx = x - b.x, dz = z - b.z; if (dx * dx + dz * dz > (b.r + R) ** 2) continue;
    const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx + R && Math.abs(lz) < b.hz + R) return true;
  }
  return false;
}
// a talaj magassága ott, ahol a játékos áll: terep, belső padló vagy épülettető (ha onnan érkezik)
function groundAt(x, z, feet) {
  let g = H(x, z);
  for (const f of floors) if (x >= f.bb.x0 && x <= f.bb.x1 && z >= f.bb.z0 && z <= f.bb.z1 && feet >= f.y - STEP && pip(x, z, f.p)) g = Math.max(g, f.y);
  const l = grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
  if (l) for (const s of l) { const top = s.base + (s.wallTop || s.h); if (feet >= top - STEP && x >= s.bb.x0 && x <= s.bb.x1 && z >= s.bb.z0 && z <= s.bb.z1 && pip(x, z, s.p)) g = Math.max(g, top); }
  return g;
}
function freeSpotNear(x, z, prefer) {
  if (!blockedAt(x, z, -1e9)) return [x, z];
  // 32 irányban kifelé: az első szabad pont után mennyi tér van még (max 25 m) –
  // az nyer, ahol legtöbb a szabad rálátás, és nem túl messze van az épülettől
  let best = null;
  for (let a = 0; a < 32; a++) {
    const dx = Math.cos(a / 32 * Math.PI * 2), dz = Math.sin(a / 32 * Math.PI * 2);
    for (let r = 2; r < 200; r += 2) {
      if (blockedAt(x + dx * r, z + dz * r, -1e9)) continue;
      let run = 0; while (run < 25 && !blockedAt(x + dx * (r + run + 1), z + dz * (r + run + 1), -1e9)) run++;
      const score = run - r * 0.15;
      if (!best || score > best.score) best = { score, x: x + dx * (r + Math.min(run, 18)), z: z + dz * (r + Math.min(run, 18)) };
      break;
    }
  }
  return best ? [best.x, best.z] : [x, z];
}

// ---------- játékos ----------
const EYE = 1.7;
const player = { x: 0, z: 0, y: 0, vy: 0, yaw: 0, pitch: 0, fly: false, onGround: true };
function lookAt(tx, tz) { player.yaw = Math.atan2(-(tx - player.x), -(tz - player.z)); player.pitch = 0.05; }
function teleportTo(f) {
  const [x, z] = freeSpotNear(f.c[0], f.c[1]);
  player.x = x; player.z = z; player.y = groundAt(x, z, -1e9); player.vy = 0; player.fly = false;
  lookAt(f.c[0], f.c[1]);
}
// kezdőpont: a kampusz belső udvara / az egyetem területének közepe
const court = F.filter(f => f.k === 'g' && /belső udvar/i.test(f.n || '')).sort((a, b) => (b.bb.x1 - b.bb.x0) * (b.bb.z1 - b.bb.z0) - (a.bb.x1 - a.bb.x0) * (a.bb.z1 - a.bb.z0))[0];
const startF = court || uni || { c: [0, 0] };
function goStart() {
  const [x, z] = freeSpotNear(startF.c[0], startF.c[1]);
  Object.assign(player, { x, z, y: H(x, z), vy: 0, fly: false });
  const a = blds.find(b => b.n === 'A épület'); if (a) lookAt(a.c[0], a.c[1]);
}
goStart();
// #lat,lon[,irány[,dőlés[,magasság]]] a címben: oda tesz le (pl. Google Maps koordinátákkal összevetéshez);
// a magasság a talaj fölött értendő, 3 m fölött repülő módban
function fromHash() {
  const m = location.hash.slice(1).split(',').map(Number);
  if (m.length < 2 || m.some(isNaN)) return;
  const x = (m[1] - LON0) * M_LON, z = -(m[0] - LAT0) * M_LAT, alt = m[4] || 0, want = H(x, z) + alt;
  // ha a megadott magasságban padló van (pl. a vasúti kocsi), arra áll rá; különben 3 m fölött repül
  const g = groundAt(x, z, want + 0.05), onFloor = Math.abs(g - want) < 0.6;
  Object.assign(player, { x, z, y: onFloor || alt <= 3 ? g : want, vy: 0, fly: !onFloor && alt > 3, pitch: (m[3] || 0) * Math.PI / 180 });
  if (m.length > 2) player.yaw = -m[2] * Math.PI / 180;
}
fromHash(); addEventListener('hashchange', fromHash);

// ---------- teleport gombok ----------
const tp = document.getElementById('tp');
const startBtn = document.createElement('button'); startBtn.textContent = '★ Kezdőpont (belső udvar)';
startBtn.onclick = () => { goStart(); begin(); }; tp.appendChild(startBtn);
if (CAR) {
  const b = document.createElement('button'); b.textContent = '🚃 Vasúti kocsi (belül)';
  b.onclick = () => { Object.assign(player, { x: CAR.x, z: CAR.z, y: CAR.yF, vy: 0, fly: false, pitch: 0, yaw: -CAR.ang - Math.PI / 2 }); begin(); }; tp.appendChild(b);
}
if (UV) {
  const b = document.createElement('button'); b.textContent = '🍺 Üveges (belül)';
  b.onclick = () => {
    const { K, Lx, Wd } = UV, c = Math.cos(K.ang), s = Math.sin(K.ang), lx = Lx * .32, lz = Wd * .5;
    Object.assign(player, { x: K.x + lx * c - lz * s, z: K.z + lx * s + lz * c, y: UV.fy, vy: 0, fly: false, pitch: -0.05, yaw: -K.ang - Math.PI / 2 });
    begin();
  }; tp.appendChild(b);
}
const seen = new Set();
named.filter(f => f.campus).sort((a, b) => a.n.localeCompare(b.n, 'hu')).forEach(f => {
  if (seen.has(f.n)) return; seen.add(f.n);
  const b = document.createElement('button'); b.textContent = f.n;
  b.onclick = () => { teleportTo(f); begin(); }; tp.appendChild(b);
});

// ---------- bemenet ----------
const keys = {};
const overlay = document.getElementById('overlay'), menuBtn = document.getElementById('menuBtn');
const isTouch = matchMedia('(pointer: coarse)').matches;
let running = false;
function begin() {
  overlay.classList.add('hidden'); running = true;
  if (isTouch) { menuBtn.style.display = 'block'; document.getElementById('joy').style.display = 'block'; }
  else canvas.requestPointerLock?.();
}
function pause() { running = false; overlay.classList.remove('hidden'); menuBtn.style.display = 'none'; document.getElementById('joy').style.display = 'none'; }
document.getElementById('start').onclick = begin;
menuBtn.onclick = pause;
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && !isTouch) pause(); });
canvas.addEventListener('click', () => { if (running && !isTouch && !document.pointerLockElement) canvas.requestPointerLock?.(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0022; player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});
addEventListener('keydown', e => {
  keys[e.code] = true;
  // rövid koppintásra is forduljon egy kicsit
  if (running && !e.repeat) {
    if (e.code === 'ArrowLeft') player.yaw += 0.04;
    if (e.code === 'ArrowRight') player.yaw -= 0.04;
  }
  if (e.code === 'KeyF') { player.fly = !player.fly; player.vy = 0; if (player.fly) player.y = Math.max(player.y, H(player.x, player.z)); }
  if (e.code === 'KeyL') labels.visible = !labels.visible;
  if (e.code === 'KeyM') mini.classList.toggle('big');
  if (e.code === 'Space' && !player.fly && player.onGround && running) { player.vy = 5.2; player.onGround = false; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });

// érintés: bal fél = joystick, jobb fél = nézelődés
const joy = { id: null, x: 0, y: 0, ox: 0, oy: 0 }, look = { id: null, x: 0, y: 0 };
const joyKnob = document.querySelector('#joy i');
canvas.addEventListener('touchstart', e => {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && joy.id === null) Object.assign(joy, { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 });
    else if (look.id === null) Object.assign(look, { id: t.identifier, x: t.clientX, y: t.clientY });
  }
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.x = Math.max(-1, Math.min(1, (t.clientX - joy.ox) / 50)); joy.y = Math.max(-1, Math.min(1, (t.clientY - joy.oy) / 50)); joyKnob.style.transform = `translate(${joy.x * 40}px,${joy.y * 40}px)`; }
    if (t.identifier === look.id) { player.yaw -= (t.clientX - look.x) * 0.005; player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - (t.clientY - look.y) * 0.005)); look.x = t.clientX; look.y = t.clientY; }
  }
}, { passive: true });
canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; joyKnob.style.transform = ''; }
    if (t.identifier === look.id) look.id = null;
  }
});

// ---------- minitérkép ----------
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
const MAP_S = 1.2, EXT = 1100; // px/méter, ±méter
const off = document.createElement('canvas'); off.width = off.height = EXT * 2 * MAP_S;
{
  const g = off.getContext('2d'), P = (x, z) => [(x + EXT) * MAP_S, (z + EXT) * MAP_S];
  const poly = (f, fill) => { g.beginPath(); for (let i = 0; i < f.p.length; i += 2) { const [a, b] = P(f.p[i], f.p[i + 1]); i ? g.lineTo(a, b) : g.moveTo(a, b); } g.closePath(); g.fillStyle = fill; g.fill(); };
  g.fillStyle = '#e6e3da'; g.fillRect(0, 0, off.width, off.height);
  if (uni) poly(uni, '#f3ecd9');
  F.filter(f => f.k === 'g').forEach(f => poly(f, '#bcd9a3'));
  F.filter(f => f.k === 'p').forEach(f => poly(f, '#d3d3d3'));
  F.filter(f => f.k === 'w').forEach(f => poly(f, '#9cc3e6'));
  g.lineCap = g.lineJoin = 'round';
  for (const r of roads) {
    g.beginPath(); for (let i = 0; i < r.p.length; i += 2) { const [a, b] = P(r.p[i], r.p[i + 1]); i ? g.lineTo(a, b) : g.moveTo(a, b); }
    g.strokeStyle = FOOT.has(r.t) ? '#c9b99a' : '#ffffff'; g.lineWidth = (parseFloat(r.wd) || RW[r.t]) * MAP_S * (FOOT.has(r.t) ? .7 : 1); g.stroke();
  }
  [...blds.filter(b => !b.hasParts), ...parts].forEach(f => poly(f, f.id === ID_CARRIAGE ? '#2a9fd8' : f.id === ID_UVEGES ? '#8fc6d8' : f.campus ? '#8f877a' : '#c4beb3'));
  g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#1d1d1d';
  for (const f of named) { if (f.part) continue; const [a, b] = P(f.c[0], f.c[1]); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.8)'; g.strokeText(f.n, a, b); g.fillText(f.n, a, b); }
}
function drawMini() {
  const W = mini.width, view = mini.classList.contains('big') ? 450 : 170;
  const sx = (player.x - view + EXT) * MAP_S, sz = (player.z - view + EXT) * MAP_S, sw = view * 2 * MAP_S;
  mctx.fillStyle = '#e6e3da'; mctx.fillRect(0, 0, W, W);
  mctx.drawImage(off, sx, sz, sw, sw, 0, 0, W, W);
  mctx.save(); mctx.translate(W / 2, W / 2); mctx.rotate(-player.yaw);
  mctx.fillStyle = 'rgba(227,163,59,.25)'; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, 60, -Math.PI / 2 - .6, -Math.PI / 2 + .6); mctx.fill();
  mctx.fillStyle = '#d6452f'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 3;
  mctx.beginPath(); mctx.moveTo(0, -14); mctx.lineTo(9, 10); mctx.lineTo(0, 5); mctx.lineTo(-9, 10); mctx.closePath(); mctx.stroke(); mctx.fill();
  mctx.restore();
}

// ---------- célzott épület infó ----------
const ray = new THREE.Raycaster(); ray.far = 400;
const info = document.getElementById('info'), status = document.getElementById('status');
let frame = 0;
function updateHover() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = ray.intersectObjects([...buildingMeshes, ...specialHover], false)[0];
  if (!hit) { info.style.display = 'none'; return; }
  const o = hit.object, f = o.userData.own ? o.userData.own[hit.faceIndex] : o.userData.f;
  if (!f) { info.style.display = 'none'; return; }
  if (f.info) { info.innerHTML = `${f.info} · ${Math.round(hit.distance)} m-re`; info.style.display = 'block'; return; }
  const base = f.parent || f;
  const name = f.n || base.n || (f.campus ? 'Egyetemi épület (név nélkül)' : 'Épület');
  const lv = f.l ? `${f.l} szint${f.semi ? ` + ${f.semi} szuterén` : ''} · ` : '';
  const hTxt = f.est ? `~${f.h.toFixed(1)} m (becsült)` : `${f.h} m (OSM)`;
  info.innerHTML = `<b>${name}</b><br>${lv}${hTxt} · ${Math.round(hit.distance)} m-re · OSM ${f.id}`;
  info.style.display = 'block';
}

// ---------- fő ciklus ----------
const clock = new THREE.Clock();
function step(dt) {
  let fwd = 0, side = 0;
  if (keys.KeyW) fwd += 1;
  if (keys.KeyS) fwd -= 1;
  if (keys.KeyD) side += 1;
  if (keys.KeyA) side -= 1;
  // nyilakkal forgás (egér nélkül)
  const turn = 2.0 * dt, tilt = 1.2 * dt;
  if (keys.ArrowLeft) player.yaw += turn;
  if (keys.ArrowRight) player.yaw -= turn;
  if (keys.ArrowUp) player.pitch = Math.min(1.5, player.pitch + tilt);
  if (keys.ArrowDown) player.pitch = Math.max(-1.5, player.pitch - tilt);
  if (joy.id !== null) { fwd -= joy.y; side += joy.x; }
  const len = Math.hypot(fwd, side); if (len > 1) { fwd /= len; side /= len; }
  const run = keys.ShiftLeft || keys.ShiftRight;
  const speed = player.fly ? (run ? 80 : 25) : (run ? 9 : 4.5);
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const dx = (-sy * fwd + cy * side) * speed * dt, dz = (-cy * fwd - sy * side) * speed * dt;
  if (player.fly) {
    player.x += dx; player.z += dz;
    if (keys.Space) player.y += speed * dt;
    if (keys.KeyC || keys.ControlLeft) player.y = Math.max(H(player.x, player.z), player.y - speed * dt);
  } else {
    // lépcsőfoknyi (45 cm) szintkülönbségre fel lehet lépni, magasabb peremre nem
    const canGo = (x, z) => !blockedAt(x, z, player.y) && groundAt(x, z, player.y) <= player.y + STEP;
    if (canGo(player.x + dx, player.z)) player.x += dx;
    if (canGo(player.x, player.z + dz)) player.z += dz;
    player.vy -= 14 * dt; player.y += player.vy * dt;
    const gy = groundAt(player.x, player.z, player.y);
    if (player.y <= gy) { player.y = gy; player.vy = 0; player.onGround = true; }
  }
  player.x = Math.max(-EXT, Math.min(EXT, player.x)); player.z = Math.max(-EXT, Math.min(EXT, player.z));
}
function renderFrame() {
  camera.position.set(player.x, player.y + EYE, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  sun.target.position.set(player.x, 0, player.z); sun.position.copy(sun.target.position).add(SUN_OFF);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (running) step(dt);
  if (window.__kampusz.pause) return;
  if (++frame % 6 === 0) {
    updateHover(); drawMini();
    const [la, lo] = toLatLon(player.x, player.z);
    status.textContent = `${player.fly ? '✈ Repülés' : '🚶 Séta'} · ${la.toFixed(5)}, ${lo.toFixed(5)} · magasság ${player.y.toFixed(1)} m`;
  }
  renderFrame();
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
// tesztelési horog: egy képkocka kirajzolása és lementése (fej nélküli böngészőhöz)
window.__kampusz = { pause: false, player, H, groundAt, blockedAt, scene, renderer, camera, CAR: () => CAR, UV: () => UV,
  sim(k, t) { for (const c of k) keys[c] = true; for (let i = 0; i < t / 0.02; i++) step(0.02); for (const c of k) keys[c] = false; return { x: +player.x.toFixed(2), z: +player.z.toFixed(2), y: +player.y.toFixed(2) }; },
  snap(type = "image/jpeg") { renderFrame(); updateHover(); drawMini(); renderFrame(); return renderer.domElement.toDataURL(type, .9); } };
document.getElementById('loading').remove();
drawMini(); loop();
