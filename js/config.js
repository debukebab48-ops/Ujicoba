// js/config.js
// Satu-satunya tempat angka tunable. Ubah di sini, jangan di file lain.
// Rujukan: HANDOFF-AI.md bagian 6 (threshold gestur) & bagian 7 (kendala device).

export const CONFIG = {
  camera: {
    facingMode: "user",
    width: 640,
    height: 480,
    frameRate: 30,
  },

  tracking: {
    numHands: 1,          // 1 tangan cukup; "tangan lain bebas" = tidak di-track
    delegate: "GPU",      // fallback otomatis ke "CPU" kalau gagal
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
  },

  gestures: {
    // Kepalan = rata-rata curl 4 jari tanpa jempol (0 = lurus, 1 = penuh)
    fistClosed: 0.70,
    fistOpen: 0.55,             // hysteresis keluar

    // Tekuk kelingking, derajat di sendi PIP
    pinkyCurlEnterDeg: 60,
    pinkyCurlExitDeg: 45,       // hysteresis

    // Fusion: jarak ujung jempol-kelingking / panjang telapak
    fusionMaxDistRatio: 0.42,
    fusionHoldMs: 80,           // respons total < 200ms sesuai spesifikasi

    handLostMs: 500,            // balok tetap di posisi terakhir
  },

  depth: {
    // Panjang telapak (wrist -> middle MCP) dalam satuan tinggi frame
    palmMin: 0.10,              // tangan jauh
    palmMax: 0.35,              // tangan dekat
    smoothAlpha: 0.15,
    deadZone: 0.01,             // satuan depth01, cegah jitter
  },

  light: {
    sampleIntervalMs: 1000,
    warnBelowLuma: 40,
  },

  debug: {
    enabled: true,
    showLandmarks: true,
  },
};
