// js/main.js
// Init kamera + MediaPipe + Three.js, lalu loop render.
// Stage A: hanya debug overlay + kubus placeholder untuk validasi mapping.
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { HandTracker, LM } from "./hand.js";

const video = document.getElementById("cam");
const glCanvas = document.getElementById("gl");
const debugCanvas = document.getElementById("debug");
const overlay = document.getElementById("overlay");
const overlayMsg = document.getElementById("overlay-msg");
const overlayBtn = document.getElementById("overlay-btn");
const banner = document.getElementById("banner");
const hud = document.getElementById("hud");
const hudFps = document.getElementById("hud-fps");
const hudDelegate = document.getElementById("hud-delegate");
const hudMetrics = document.getElementById("hud-metrics");
const hudChips = document.getElementById("hud-chips");

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const tracker = new HandTracker();
const dbgCtx = debugCanvas.getContext("2d");

// ---------- Three.js: kamera ortho = koordinat piksel layar (y ke bawah) ----------
const renderer = new THREE.WebGLRenderer({
  canvas: glCanvas,
  antialias: false,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
camera.position.z = 500;

// Placeholder Stage A — diganti isi block.js di Stage B
const placeholder = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0x7fe0ff, transparent: true, opacity: 0.85 })
);
placeholder.visible = false;
scene.add(placeholder);

// ---------- Mapping video -> layar (object-fit: cover + mirror) ----------
function visibleRect() {
  const vw = video.videoWidth || CONFIG.camera.width;
  const vh = video.videoHeight || CONFIG.camera.height;
  const cw = glCanvas.clientWidth || window.innerWidth;
  const ch = glCanvas.clientHeight || window.innerHeight;
  const s = Math.max(cw / vw, ch / vh); // cover
  return {
    vw, vh, cw, ch, s,
    ox: (cw - vw * s) / 2,
    oy: (ch - vh * s) / 2,
  };
}

// Satu-satunya tempat mirror & konversi koordinat. x mentah -> layar (dicerminkan).
function landmarkToScreen(x, y, r) {
  return {
    x: r.ox + (1 - x) * r.vw * r.s,
    y: r.oy + y * r.vh * r.s,
  };
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  glCanvas.style.width = w + "px";
  glCanvas.style.height = h + "px";
  camera.left = 0;
  camera.right = w;
  camera.top = 0;
  camera.bottom = h;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  debugCanvas.width = Math.round(w * dpr);
  debugCanvas.height = Math.round(h * dpr);
  dbgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------- Kamera ----------
async function initCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Browser ini tidak mendukung akses kamera (getUserMedia).");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: CONFIG.camera.facingMode,
      width: { ideal: CONFIG.camera.width },
      height: { ideal: CONFIG.camera.height },
      frameRate: { ideal: CONFIG.camera.frameRate, max: 30 },
    },
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 1) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
}

// ---------- Deteksi cahaya kurang (edge case bagian 9) ----------
const lightCanvas = document.createElement("canvas");
lightCanvas.width = 32;
lightCanvas.height = 24;
const lightCtx = lightCanvas.getContext("2d", { willReadFrequently: true });
let lastLightCheck = 0;

function checkLight(now) {
  if (now - lastLightCheck < CONFIG.light.sampleIntervalMs) return;
  lastLightCheck = now;
  if (video.readyState < 2) return;
  lightCtx.drawImage(video, 0, 0, 32, 24);
  const data = lightCtx.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  const luma = sum / (data.length / 4);
  if (luma < CONFIG.light.warnBelowLuma) {
    showBanner("Cahaya kurang, tracking mungkin tidak stabil.");
  } else {
    hideBanner();
  }
}

let bannerTimer = 0;
function showBanner(msg) {
  banner.textContent = msg;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, 4000);
}
function hideBanner() { banner.hidden = true; }

// ---------- Debug overlay ----------
function drawDebug(st, now) {
  dbgCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
  if (!CONFIG.debug.enabled || !CONFIG.debug.showLandmarks) return;
  if (!st.landmarks) return;

  const r = visibleRect();
  const pts = st.landmarks.map((p) => landmarkToScreen(p.x, p.y, r));
  const fresh = st.present;

  dbgCtx.lineWidth = 2;
  dbgCtx.strokeStyle = fresh ? "rgba(127,224,255,0.55)" : "rgba(127,224,255,0.18)";
  dbgCtx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    dbgCtx.moveTo(pts[a].x, pts[a].y);
    dbgCtx.lineTo(pts[b].x, pts[b].y);
  }
  dbgCtx.stroke();

  const TIPS = new Set([LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP]);
  for (let i = 0; i < pts.length; i++) {
    dbgCtx.beginPath();
    dbgCtx.arc(pts[i].x, pts[i].y, TIPS.has(i) ? 5 : 3, 0, Math.PI * 2);
    dbgCtx.fillStyle = TIPS.has(i)
      ? (fresh ? "#ff7f9e" : "rgba(255,127,158,0.25)")
      : (fresh ? "#7fe0ff" : "rgba(127,224,255,0.25)");
    dbgCtx.fill();
  }

  // Label status di dekat telapak
  const c = landmarkToScreen(st.palmCenter.x, st.palmCenter.y, r);
  dbgCtx.font = "11px ui-monospace, monospace";
  dbgCtx.fillStyle = fresh ? "rgba(200,245,255,0.9)" : "rgba(200,245,255,0.35)";
  dbgCtx.fillText(fresh ? "HAND" : `LOST ${Math.round(st.lostMs)}ms`, c.x + 12, c.y - 12);
}

// ---------- Update placeholder (validasi mapping) ----------
function updatePlaceholder(st) {
  if (!st.landmarks) {
    placeholder.visible = false;
    return;
  }
  const r = visibleRect();
  const c = landmarkToScreen(st.palmCenter.x, st.palmCenter.y, r);
  const minDim = Math.min(r.cw, r.ch);
  const size = minDim * (0.08 + 0.07 * st.depth01);

  placeholder.visible = true;
  placeholder.position.set(c.x, c.y, 0);
  placeholder.scale.setScalar(size);
  placeholder.rotation.set(0, 0, 0);
  placeholder.material.opacity = st.present ? 0.85 : 0.25;
}

// ---------- HUD ----------
let fpsFrames = 0;
let fpsSince = 0;
function updateHud(st, now) {
  fpsFrames++;
  if (now - fpsSince >= 500) {
    const fps = (fpsFrames * 1000) / (now - fpsSince);
    hudFps.textContent = `${fps.toFixed(0)} fps`;
    fpsFrames = 0;
    fpsSince = now;
  }
  hudDelegate.textContent = `delegate: ${tracker.delegateUsed}`;
  hudMetrics.textContent =
    `palmLen  ${st.palmLen.toFixed(3)}\n` +
    `depth01  ${st.depth01.toFixed(2)}\n` +
    `fistFrac ${st.fistFrac.toFixed(2)}\n` +
    `pinky    ${st.pinkyCurlDeg.toFixed(0)}°\n` +
    `fusionR  ${st.fusionDistRatio.toFixed(2)}`;

  const g = st.gestures;
  const chips = [
    ["GRAB", g.grab],
    ["TENSION", g.tension],
    ["FUSE?", g.fusionCandidate],
    ["FUSION", g.fusion],
  ];
  hudChips.innerHTML = chips
    .map(([label, on]) => `<span class="chip${on ? " on" : ""}">${label}</span>`)
    .join("");
}

// ---------- Loop utama ----------
let rafId = 0;
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const ts = Math.round(now);
  const st = tracker.update(video, ts);
  checkLight(ts);
  updatePlaceholder(st);
  drawDebug(st, ts);
  updateHud(st, ts);
  renderer.render(scene, camera);
}

// ---------- Boot ----------
async function boot() {
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));

  try {
    overlayMsg.textContent = "Minta izin kamera…\nPilih \"Izinkan\" saat diminta.";
    await initCamera();
  } catch (err) {
    console.error("[camera]", err);
    overlayMsg.textContent =
      "Kamera tidak bisa dibuka.\n\n" +
      "1. Pastikan halaman dibuka via HTTPS (GitHub Pages sudah HTTPS).\n" +
      "2. Izinkan akses kamera di pengaturan situs (ikon gembok).\n" +
      "3. Tutup aplikasi lain yang sedang memakai kamera.\n\n" +
      `Detail: ${err.name || "Error"} — ${err.message || ""}`;
    overlayBtn.textContent = "Coba lagi";
    overlayBtn.hidden = false;
    overlayBtn.onclick = () => location.reload();
    return;
  }

  try {
    await tracker.init((msg) => { overlayMsg.textContent = msg; });
  } catch (err) {
    console.error("[mediapipe]", err);
    overlayMsg.textContent =
      "Gagal memuat model tracking.\nPerlu internet pada load pertama (~7MB).\n\n" +
      `Detail: ${err.message || err}`;
    overlayBtn.textContent = "Coba lagi";
    overlayBtn.hidden = false;
    overlayBtn.onclick = () => location.reload();
    return;
  }

  overlay.classList.add("hidden");
  hud.hidden = false;
  fpsSince = performance.now();
  rafId = requestAnimationFrame(loop);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      tracker.lastVideoTs = -1; // paksa timestamp baru setelah resume
      rafId = requestAnimationFrame(loop);
    }
  });
}

boot();
