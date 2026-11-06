// js/hand.js
// Baca 21 landmark + hitung metrik gestur. Tidak tahu apa-apa soal Three.js.
import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { CONFIG } from "./config.js";
import { angleDeg, clamp, dist, ema } from "./util.js";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// 4 jari tanpa jempol, dipakai untuk hitung kepalan
const FINGERS = [
  { mcp: LM.INDEX_MCP,  tip: LM.INDEX_TIP  },
  { mcp: LM.MIDDLE_MCP, tip: LM.MIDDLE_TIP },
  { mcp: LM.RING_MCP,   tip: LM.RING_TIP   },
  { mcp: LM.PINKY_MCP,  tip: LM.PINKY_TIP  },
];

const PALM_IDS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];

export function emptyHandState() {
  return {
    present: false,
    lostMs: 0,
    landmarks: null,                                  // 21 titik, frame mentah (x,y,z ternormalisasi)
    aspect: 1,
    palmLen: 0,                                       // satuan tinggi frame
    palmCenter: { x: 0.5, y: 0.5 },                   // ternormalisasi, frame mentah
    fingertipsCenter: { x: 0.5, y: 0.5 },
    depth01: 0.5,                                     // 0 = jauh, 1 = dekat
    fistFrac: 0,
    pinkyCurlDeg: 0,
    fusionDistRatio: 0,
    gestures: { grab: false, tension: false, fusionCandidate: false, fusion: false },
  };
}

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.delegateUsed = "-";
    this.lastVideoTs = -1;
    this.lastSeenAt = -1;
    this.lastLandmarks = null;
    this.depthSmooth = null;
    this.fusionSince = 0;
    this.hyst = { grab: false, tension: false };
    this.state = emptyHandState();
  }

  async init(onProgress = () => {}) {
    onProgress("Memuat MediaPipe (WASM)…");
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);

    const create = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: CONFIG.tracking.numHands,
        minHandDetectionConfidence: CONFIG.tracking.minHandDetectionConfidence,
        minTrackingConfidence: CONFIG.tracking.minTrackingConfidence,
        minHandPresenceConfidence: CONFIG.tracking.minHandPresenceConfidence,
      });

    onProgress("Memuat model tangan (~7MB, sekali saja)…");
    try {
      this.landmarker = await create(CONFIG.tracking.delegate);
      this.delegateUsed = CONFIG.tracking.delegate;
    } catch (err) {
      console.warn("[hand] delegate GPU gagal, fallback ke CPU:", err);
      onProgress("GPU tidak tersedia, pakai CPU…");
      this.landmarker = await create("CPU");
      this.delegateUsed = "CPU";
    }
    onProgress("Siap.");
  }

  update(video, tsMs) {
    if (!this.landmarker || video.readyState < 2) return this.state;
    if (tsMs === this.lastVideoTs) return this.state; // MediaPipe minta timestamp unik
    this.lastVideoTs = tsMs;

    const res = this.landmarker.detectForVideo(video, tsMs);
    const lm = res && res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
    const aspect = video.videoWidth / Math.max(1, video.videoHeight);

    if (!lm) {
      // Tangan hilang: pertahankan landmark terakhir, tandai present = false
      const st = this.state;
      st.present = false;
      st.gestures.grab = false;
      st.gestures.tension = false;
      st.gestures.fusionCandidate = false;
      st.gestures.fusion = false;
      this.fusionSince = 0;
      if (this.lastSeenAt >= 0) st.lostMs = tsMs - this.lastSeenAt;
      return st;
    }

    this.lastSeenAt = tsMs;
    this.lastLandmarks = lm;
    this.state = this._measure(lm, aspect, tsMs);
    return this.state;
  }

  _measure(lm, aspect, now) {
    // Ruang "satuan tinggi frame": x dikali aspect supaya jarak tidak terdistorsi.
    // Semua threshold jarak dihitung di ruang ini.
    const P = lm.map((p) => ({ x: p.x * aspect, y: p.y }));

    const palmLen = Math.max(1e-4, dist(P[0].x, P[0].y, P[9].x, P[9].y));

    // Pusat telapak & pusat ujung jari (rata-rata linear, aman di ruang mentah)
    let cx = 0, cy = 0;
    for (const id of PALM_IDS) { cx += lm[id].x; cy += lm[id].y; }
    const palmCenter = { x: cx / PALM_IDS.length, y: cy / PALM_IDS.length };

    const TIPS = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
    let tx = 0, ty = 0;
    for (const id of TIPS) { tx += lm[id].x; ty += lm[id].y; }
    const fingertipsCenter = { x: tx / TIPS.length, y: ty / TIPS.length };

    // --- Kepalan: rasio panjang jari terhadap panjang telapak ---
    let curlSum = 0;
    for (const f of FINGERS) {
      const ext = dist(P[f.tip].x, P[f.tip].y, P[f.mcp].x, P[f.mcp].y) / palmLen;
      curlSum += clamp((0.95 - ext) / 0.5, 0, 1);
    }
    const fistFrac = curlSum / FINGERS.length;

    // --- Tekuk kelingking: sudut di PIP (18) antara MCP (17) dan TIP (20) ---
    const bendAngle = angleDeg(
      P[LM.PINKY_MCP].x, P[LM.PINKY_MCP].y,
      P[LM.PINKY_PIP].x, P[LM.PINKY_PIP].y,
      P[LM.PINKY_TIP].x, P[LM.PINKY_TIP].y
    );
    const pinkyCurlDeg = 180 - bendAngle;

    // --- Fusion: jarak ujung jempol-kelingking, dinormalisasi panjang telapak ---
    const fusionDistRatio =
      dist(P[LM.THUMB_TIP].x, P[LM.THUMB_TIP].y, P[LM.PINKY_TIP].x, P[LM.PINKY_TIP].y) / palmLen;

    // --- Depth dari ukuran telapak + smoothing + dead-zone ---
    const d = CONFIG.depth;
    const raw01 = clamp((palmLen - d.palmMin) / (d.palmMax - d.palmMin), 0, 1);
    if (this.depthSmooth === null || Math.abs(raw01 - this.depthSmooth) > d.deadZone) {
      this.depthSmooth = ema(this.depthSmooth, raw01, d.smoothAlpha);
    }
    const depth01 = clamp(this.depthSmooth ?? raw01, 0, 1);

    // --- Gestur, dengan hysteresis supaya tidak berkedip ---
    const g = CONFIG.gestures;
    if (!this.hyst.grab && fistFrac >= g.fistClosed) this.hyst.grab = true;
    else if (this.hyst.grab && fistFrac <= g.fistOpen) this.hyst.grab = false;

    if (!this.hyst.tension && pinkyCurlDeg >= g.pinkyCurlEnterDeg) this.hyst.tension = true;
    else if (this.hyst.tension && pinkyCurlDeg <= g.pinkyCurlExitDeg) this.hyst.tension = false;

    const fusionCandidate = fusionDistRatio <= g.fusionMaxDistRatio;
    let fusion = false;
    if (fusionCandidate) {
      if (this.fusionSince === 0) this.fusionSince = now;
      fusion = now - this.fusionSince >= g.fusionHoldMs;
    } else {
      this.fusionSince = 0;
    }

    return {
      present: true,
      lostMs: 0,
      landmarks: lm,
      aspect,
      palmLen,
      palmCenter,
      fingertipsCenter,
      depth01,
      fistFrac,
      pinkyCurlDeg,
      fusionDistRatio,
      gestures: {
        grab: this.hyst.grab,
        tension: this.hyst.tension,
        fusionCandidate,
        fusion,
      },
    };
  }
}
