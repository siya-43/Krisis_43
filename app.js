// Authentication Check
if (!localStorage.getItem("ecg_auth_token")) {
  window.location.href = "./login.html";
}

const state = {
  apiBase: localStorage.getItem("ecg-api-base") || "/api",
  useMock: localStorage.getItem("ecg-use-mock") === "true",
  incidents: [],
  events: [],
  notifications: [],
  directory: [],
  selectedLocation: "Corridor A",
  selectedCameraId: "cam-04",
  selectedIncidentId: null,
  currentScreen: "cctv", // "incident" or "cctv"
  cctvTimers: {},
  webcamStream: null,
};

const CAMERA_UNITS = [
  { camera_id: "cam-01", location: "Lobby" },
  { camera_id: "cam-02", location: "Reception" },
  { camera_id: "cam-03", location: "Kitchen" },
  { camera_id: "cam-04", location: "Corridor A" },
  { camera_id: "cam-05", location: "Banquet Hall" },
  { camera_id: "cam-06", location: "Stairwell" },
];

const els = {
  apiBase: document.getElementById("apiBase"),
  saveApiBase: document.getElementById("saveApiBase"),
  checkHealth: document.getElementById("checkHealth"),
  toggleMode: document.getElementById("toggleMode"),
  connectionStatus: document.getElementById("connectionStatus"),
  metricIncidents: document.getElementById("metricIncidents"),
  metricCritical: document.getElementById("metricCritical"),
  metricNotifications: document.getElementById("metricNotifications"),
  metricAcknowledged: document.getElementById("metricAcknowledged"),
  commandFocus: document.getElementById("commandFocus"),
  incidentList: document.getElementById("commandFocus"),
  eventList: document.getElementById("eventList"),
  notificationList: document.getElementById("notificationList"),
  directoryList: document.getElementById("directoryList"),
  refreshIncidents: document.getElementById("refreshIncidents"),
  refreshEvents: document.getElementById("refreshEvents"),
  refreshNotifications: document.getElementById("refreshNotifications"),
  refreshDirectory: document.getElementById("refreshDirectory"),
  clearMockData: document.getElementById("clearMockData"),
  seedFireScenario: null,
  mapHint: document.getElementById("mapHint"),
  cameraSelect: document.getElementById("cameraSelect"),
  visionSource: document.getElementById("visionSource"),
  visionModelPath: document.getElementById("visionModelPath"),
  visionConfidence: document.getElementById("visionConfidence"),
  visionFrameStride: document.getElementById("visionFrameStride"),
  cameraConfigStatus: document.getElementById("cameraConfigStatus"),
  useWebcamSource: document.getElementById("useWebcamSource"),
  saveSourcePreset: document.getElementById("saveSourcePreset"),
  visionConfigure: document.getElementById("visionConfigure"),
  visionStart: document.getElementById("visionStart"),
  visionStartAll: document.getElementById("visionStartAll"),
  visionStop: document.getElementById("visionStop"),
  visionStatus: document.getElementById("visionStatus"),
  actionSmoke: document.getElementById("actionSmoke"),
  actionFire: document.getElementById("actionFire"),
  actionManual: document.getElementById("actionManual"),
  actionBroadcast: document.getElementById("actionBroadcast"),
  mapZonesContainer: document.getElementById("mapZones"),
  refreshMap: document.getElementById("refreshMap"),
  addCamera: document.getElementById("addCamera"),
  deleteCamera: document.getElementById("deleteCamera"),
  openSystemMenu: document.getElementById("openSystemMenu"),
  closeSystemMenu: document.getElementById("closeSystemMenu"),
  systemDrawer: document.getElementById("systemDrawer"),
  openCameraMenu: document.getElementById("openCameraMenu"),
  closeCameraMenu: document.getElementById("closeCameraMenu"),
  cameraDrawer: document.getElementById("cameraDrawer"),
  openDirectoryMenu: document.getElementById("openDirectoryMenu"),
  closeDirectoryMenu: document.getElementById("closeDirectoryMenu"),
  directoryDrawer: document.getElementById("directoryDrawer"),
  actionLogout: document.getElementById("actionLogout"),
  onboardingOverlay: document.getElementById("onboardingOverlay"),
  onboardingNext: document.getElementById("onboardingNext"),
  onboardingPrev: document.getElementById("onboardingPrev"),
  actionDemo: document.getElementById("actionDemo"),
  
  // Screen Toggles
  showIncidentView: document.getElementById("showIncidentView"),
  showCctvView: document.getElementById("showCctvView"),
  incidentView: document.getElementById("incidentView"),
  cctvView: document.getElementById("cctvView"),
  sidebarRight: document.querySelector(".sidebar-right"),
  
  // CCTV Elements
  cctvGrid: document.getElementById("cctvGrid"),
  cctvBanner: document.getElementById("cctvBanner"),
  cctvBannerText: document.getElementById("cctvBannerText"),
  btnWebcam: document.getElementById("btnWebcam"),
  btnVideos: document.getElementById("btnVideos"),
  btnRefreshStatus: document.getElementById("btnRefresh"),
  analyzeCanvas: document.getElementById("analyzeCanvas"),
};

let onboardingCurrentStep = 1;

const mockStore = {
  incidents: [],
  events: [],
  notifications: [],
  directory: [
    { name: "Anita Verma", role: "Floor Manager", zone: "Reception", phone: "+918889800445", channels: ["sms", "dashboard"], escalation_level: 1 },
    { name: "Rohit Jain", role: "Floor Manager", zone: "Corridor A", phone: "+919425070640", channels: ["sms", "dashboard"], escalation_level: 1 },
    { name: "Arjun Patel", role: "Security Lead", zone: "All Zones", phone: "+917000127676", channels: ["sms", "voice", "dashboard"], escalation_level: 2 },
    { name: "Nidhi Rao", role: "Duty Manager", zone: "All Zones", phone: "+918889800445", channels: ["sms", "voice", "dashboard"], escalation_level: 3 },
  ],
};

function defaultCameraRegistry() {
  const presets = {
    "cam-01": { source: "0", location: "Lobby" },
    "cam-02": { source: "./lobbycam.mp4", location: "Reception" },
    "cam-03": { source: "./kitchencam.mp4", location: "Kitchen" },
    "cam-04": { source: "./corridorCam.mp4", location: "Corridor A" },
    "cam-05": { source: "./banquet hall.mp4", location: "Banquet Hall" },
    "cam-06": { source: "./stairscCamm.mp4", location: "Stairwell" },
  };

  return CAMERA_UNITS.reduce((acc, camera) => {
    const preset = presets[camera.camera_id] || { source: "0", location: camera.location };
    acc[camera.camera_id] = {
      camera_id: camera.camera_id,
      location: preset.location,
      source: preset.source,
      model_path: "vision/models/best.pt",
      confidence: 0.55,
      frame_stride: 12,
    };
    return acc;
  }, {});
}

function loadCameraRegistry() {
  try {
    const raw = localStorage.getItem("ecg-camera-registry");
    if (!raw) return defaultCameraRegistry();
    const parsed = JSON.parse(raw);
    return { ...defaultCameraRegistry(), ...parsed };
  } catch {
    return defaultCameraRegistry();
  }
}

function saveCameraRegistry() {
  localStorage.setItem("ecg-camera-registry", JSON.stringify(state.cameraRegistry));
}

function renderMap() {
  const zones = [
    "Lobby", "Reception", "Kitchen", "Corridor A", "Banquet Hall", "Stairwell",
    "Floor 1", "Floor 2", "Floor 3", "Rooftop", "Basement", "Command Center"
  ];

  els.mapZonesContainer.innerHTML = zones.map(zoneName => {
    const isActive = state.incidents.some(i => i.location === zoneName);
    const staffInZone = state.directory.filter(s => s.current_zone === zoneName);
    
    return `
      <div class="map-zone ${isActive ? 'active-alert' : ''}">
        <div class="zone-label">${escapeHtml(zoneName)}</div>
        <div class="staff-marker-list">
          ${staffInZone.map(s => `
            <div class="staff-marker" data-name="${escapeHtml(s.name)} (${escapeHtml(s.role)})">
              ${s.name.split(" ").map(n => n[0]).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function updateRemoteQr() {
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const sosUrl = new URL("./sos.html", window.location.href).href;
  
  // Larger size for easier scanning
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(sosUrl)}&margin=10`;
  
  const img = document.getElementById("remoteQr");
  const container = document.getElementById("remoteQrContainer");
  
  if (img) {
    img.src = qrUrl;
    img.onerror = () => {
      img.style.display = 'none';
      const fallback = document.createElement('div');
      fallback.innerHTML = `<a href="${sosUrl}" target="_blank" style="font-size:10px; color:blue;">Open Remote Link</a>`;
      container.appendChild(fallback);
    };
  }

  // Add a helpful hint for local testing
  if (isLocal && container) {
    let hint = document.getElementById("qrLocalHint");
    if (!hint) {
      hint = document.createElement("p");
      hint.id = "qrLocalHint";
      hint.style = "color: #d32f2f; font-size: 8px; font-weight: 800; margin-top: 8px; border-top: 1px solid #eee; padding-top: 4px;";
      hint.textContent = "NOTE: Use your Local IP (not localhost) to scan from phone.";
      container.appendChild(hint);
    }
  }
}

function playAlertBeep() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = "sine";
    oscillator.frequency.value = 880; 
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, context.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.3);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.3);
  } catch (e) {
    console.warn("Audio alert failed:", e);
  }
}

function init() {
  updateRemoteQr();
  els.apiBase.value = state.apiBase;
  state.cameraRegistry = loadCameraRegistry();
  
  // Start on CCTV by default
  switchScreen("cctv");
  // Auto-select first camera if selectedCameraId is missing or deleted
  if (!state.cameraRegistry[state.selectedCameraId]) {
    const firstCam = Object.values(state.cameraRegistry)[0];
    if (firstCam) {
        state.selectedCameraId = firstCam.camera_id;
        state.selectedLocation = firstCam.location;
    }
  }
  
  syncModeUi();
  renderDynamicUI();
  bindEvents();
  if (Object.keys(state.cameraRegistry).length > 0) {
    selectCamera(state.selectedCameraId);
    selectLocation(state.selectedLocation);
  }
  refreshAll();
  refreshVisionHealth();
  setInterval(() => {
    if (!state.useMock) {
      refreshAll();
    }
  }, 3000);

  // Trigger onboarding if first time
  if (!localStorage.getItem("ecg_setup_complete")) {
    els.onboardingOverlay.classList.add("active");
    updateOnboardingUI();
  }
}

function logout() {
  localStorage.removeItem("ecg_auth_token");
  window.location.href = "./login.html";
}

function moveOnboarding(delta) {
  const nextStep = onboardingCurrentStep + delta;
  if (nextStep < 1) return;
  
  if (nextStep > 3) {
    els.onboardingOverlay.classList.remove("active");
    localStorage.setItem("ecg_setup_complete", "true");
    return;
  }

  onboardingCurrentStep = nextStep;
  updateOnboardingUI();
}

function updateOnboardingUI() {
  const slides = document.querySelectorAll(".onboarding-slide");
  const dots = document.querySelectorAll(".step-dot");

  slides.forEach(s => s.classList.remove("active"));
  dots.forEach(d => d.classList.remove("active"));

  const currentSlide = document.querySelector(`.onboarding-slide[data-step="${onboardingCurrentStep}"]`);
  const currentDot = document.querySelector(`.step-dot[data-step="${onboardingCurrentStep}"]`);
  
  if (currentSlide) currentSlide.classList.add("active");
  if (currentDot) currentDot.classList.add("active");

  els.onboardingPrev.style.visibility = onboardingCurrentStep === 1 ? "hidden" : "visible";
  els.onboardingNext.textContent = onboardingCurrentStep === 3 ? "Get Started" : "Next Step";
}

function renderDynamicUI() {
  const cameras = Object.values(state.cameraRegistry).sort((a, b) => a.camera_id.localeCompare(b.camera_id));
  
  // Render Select Options
  if (els.cameraSelect) {
    els.cameraSelect.innerHTML = cameras.map(cam => 
      `<option value="${cam.camera_id}">${cam.camera_id} · ${escapeHtml(cam.location)}</option>`
    ).join("");
  }
}

function on(el, type, fn) {
  if (el) el.addEventListener(type, fn);
}

function bindEvents() {
  on(els.saveApiBase, "click", () => {
    state.apiBase = els.apiBase.value.trim().replace(/\/$/, "");
    localStorage.setItem("ecg-api-base", state.apiBase);
    setStatus(`Saved API base: ${state.apiBase}`, "neutral");
  });

  on(els.checkHealth, "click", checkHealth);
  on(els.toggleMode, "click", toggleMode);
  on(els.refreshIncidents, "click", refreshIncidents);
  on(els.refreshEvents, "click", refreshEvents);
  on(els.refreshNotifications, "click", refreshNotifications);
  on(els.refreshDirectory, "click", refreshDirectory);
  on(els.clearMockData, "click", clearMockData);
  on(els.cameraSelect, "change", (event) => selectCamera(event.target.value));
  on(els.useWebcamSource, "click", setWebcamSource);
  on(els.saveSourcePreset, "click", saveSourcePreset);
  on(els.visionConfigure, "click", configureVision);
  on(els.visionStart, "click", startVision);
  on(els.visionStartAll, "click", startAllVision);
  on(els.visionStop, "click", stopVision);
  on(els.actionSmoke, "click", runSmokeScenario);
  on(els.actionFire, "click", runFireScenario);
  on(els.actionManual, "click", sendManualEmergency);
  on(els.actionBroadcast, "click", broadcastSms);
  on(els.actionLogout, "click", logout);
  on(els.actionDemo, "click", () => {
    onboardingCurrentStep = 1;
    els.onboardingOverlay.classList.add("active");
    updateOnboardingUI();
  });

  on(els.onboardingNext, "click", () => moveOnboarding(1));
  on(els.onboardingPrev, "click", () => moveOnboarding(-1));
  
  on(els.addCamera, "click", addCamera);
  on(els.deleteCamera, "click", deleteCamera);
  
  on(els.openSystemMenu, "click", () => els.systemDrawer.showModal());
  on(els.closeSystemMenu, "click", () => els.systemDrawer.close());

  on(els.openCameraMenu, "click", () => els.cameraDrawer.showModal());
  on(els.closeCameraMenu, "click", () => els.cameraDrawer.close());

  on(els.openDirectoryMenu, "click", () => els.directoryDrawer.showModal());
  on(els.closeDirectoryMenu, "click", () => els.directoryDrawer.close());

  on(els.showIncidentView, "click", () => switchScreen("incident"));
  on(els.showCctvView, "click", () => switchScreen("cctv"));
  
  on(els.btnWebcam, "click", () => {
    localStorage.setItem("ecg-camera-registry", JSON.stringify(defaultCameraRegistry()));
    window.location.reload();
  });
  
  on(els.btnVideos, "click", () => {
    localStorage.removeItem("ecg-camera-registry");
    window.location.reload();
  });
  
  on(els.btnRefreshStatus, "click", refreshCctvStatus);
}

function switchScreen(screenName) {
  state.currentScreen = screenName;
  
  if (screenName === "incident") {
    els.incidentView.style.display = "grid";
    els.cctvView.style.display = "none";
    els.sidebarRight.style.display = "flex";
    els.showIncidentView.classList.add("active");
    els.showCctvView.classList.remove("active");
    document.querySelector(".app-shell").classList.remove("cctv-mode");
    // Stop CCTV timers if they exist
    Object.values(state.cctvTimers).forEach(t => clearTimeout(t));
    state.cctvTimers = {};
  } else {
    els.incidentView.style.display = "none";
    els.cctvView.style.display = "block";
    els.sidebarRight.style.display = "none";
    els.showIncidentView.classList.remove("active");
    els.showCctvView.classList.add("active");
    document.querySelector(".app-shell").classList.add("cctv-mode");
    
    // Initialize CCTV
    initCctv();
  }
}

// --- CCTV Logic Integrated ---

const ANALYSIS_INTERVAL = 2500;

function initCctv() {
  buildCctvGrid();
  wireCctvFeeds();
  refreshCctvStatus();
}

function buildCctvGrid() {
  const cameras = Object.values(state.cameraRegistry).sort((a, b) => a.camera_id.localeCompare(b.camera_id));
  els.cctvGrid.innerHTML = cameras.map(cam => `
    <div class="cam" id="cam-${escapeHtml(cam.camera_id)}"
         data-location="${escapeHtml(cam.location)}"
         data-camera-id="${escapeHtml(cam.camera_id)}"
         data-ai="0" data-sending="0">

      <div class="cam-head">
        <div>
          <div class="cam-id">${escapeHtml(cam.camera_id)}</div>
          <div class="cam-loc">${escapeHtml(cam.location)}</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn-clear" onclick="resolveIncident('${escapeHtml(cam.location)}')">✅ Clear</button>
          <button class="btn-panic" onclick="triggerPanic('${escapeHtml(cam.camera_id)}', '${escapeHtml(cam.location)}')">🚨 PANIC</button>
          <span class="cam-badge clear" id="badge-${escapeHtml(cam.camera_id)}">CLEAR</span>
        </div>
      </div>

      <div class="cam-feed" id="feed-${escapeHtml(cam.camera_id)}">
        <div class="cam-placeholder" id="ph-${escapeHtml(cam.camera_id)}">
          <span>Connecting…</span>
        </div>
        <div class="cam-overlay"></div>
        <div class="cam-alert-chip">⚠ Alert</div>
        <div class="cam-alert-msg" id="msg-${escapeHtml(cam.camera_id)}"><span>FIRE DETECTED</span></div>
        <div class="ai-pip">AI ON</div>
        <div class="send-pip">Sending…</div>
      </div>

      <div class="cam-meta">
        <span class="cam-meta-l">${escapeHtml(cam.source === "0" ? "Webcam" : cam.source)}</span>
        <span class="cam-meta-r" id="signal-${escapeHtml(cam.camera_id)}">—</span>
      </div>
    </div>
  `).join("");
}

async function wireCctvFeeds() {
  const cameras = Object.values(state.cameraRegistry).sort((a, b) => a.camera_id.localeCompare(b.camera_id));
  const needsWebcam = cameras.some(c => c.source === "0");

  if (needsWebcam && !state.webcamStream) {
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        state.webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err) {
        console.warn("[cctv] getUserMedia failed:", err.message);
      }
    }
  }

  cameras.forEach((cam, index) => {
    const feedEl = document.getElementById(`feed-${cam.camera_id}`);
    const phEl = document.getElementById(`ph-${cam.camera_id}`);
    if (!feedEl) return;

    let videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;

    if (cam.source === "0") {
      if (!state.webcamStream) {
        if (phEl) phEl.querySelector("span").textContent = "Camera unavailable";
        return;
      }
      videoEl.srcObject = state.webcamStream;
    } else {
      videoEl.loop = true;
      const src = resolveVideoSrc(cam.source);
      videoEl.src = src ?? "";
      if (!src) {
        if (phEl) phEl.querySelector("span").textContent = "Invalid source";
        return;
      }
    }

    videoEl.onloadeddata = () => phEl?.remove();
    feedEl.insertBefore(videoEl, feedEl.firstChild);

    const stagger = index * Math.floor(ANALYSIS_INTERVAL / cameras.length);
    setTimeout(() => startCctvAnalysisLoop(cam, videoEl), stagger);
  });
}

function resolveVideoSrc(source) {
  if (!source || String(source).trim() === "0") return null;
  const s = String(source).trim();
  if (/^[a-zA-Z]:[/\\]/.test(s) || s.startsWith("/")) {
    return `${state.apiBase.replace("/api", "/visionapi")}/media?path=${encodeURIComponent(s)}`;
  }
  return s; 
}

function startCctvAnalysisLoop(cam, videoEl) {
  const ctx = els.analyzeCanvas.getContext("2d");
  
  async function tick() {
    if (state.currentScreen !== "cctv") return;
    
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      const cardEl = document.getElementById(`cam-${cam.camera_id}`);
      if (cardEl) cardEl.dataset.sending = "1";

      try {
        ctx.drawImage(videoEl, 0, 0, els.analyzeCanvas.width, els.analyzeCanvas.height);
        const blob = await new Promise(resolve => els.analyzeCanvas.toBlob(resolve, "image/jpeg", 0.75));

        const visionUrl = `${state.apiBase.replace("/api", "/visionapi")}/analyze-frame`
          + `?camera_id=${encodeURIComponent(cam.camera_id)}`
          + `&location=${encodeURIComponent(cam.location)}`
          + `&confidence=${cam.confidence ?? 0.45}`
          + `&model_path=${encodeURIComponent(cam.model_path ?? "vision/models/best.pt")}`;

        const resp = await fetch(visionUrl, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });

        if (resp.ok) {
          const data = await resp.json();
          if (cardEl) cardEl.dataset.ai = "1";

          for (const det of (data.detections || [])) {
            fetch(resolveApiUrl("/ingest/detection"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                camera_id: cam.camera_id,
                location: cam.location,
                label: det.label,
                confidence: det.confidence,
              }),
            });
          }
        }
      } catch (_) {
        if (cardEl) cardEl.dataset.ai = "0";
      } finally {
        if (cardEl) cardEl.dataset.sending = "0";
      }
    }
    state.cctvTimers[cam.camera_id] = setTimeout(tick, ANALYSIS_INTERVAL);
  }
  tick();
}

async function refreshCctvStatus() {
  if (state.currentScreen !== "cctv") return;
  
  try {
    const incidents = state.incidents;
    const alertZones = new Set(
      incidents
        .filter(i => ["fire", "warning", "medical", "security"].includes(i.type))
        .map(i => i.location)
    );

    if (!alertZones.size) {
      els.cctvBanner.className = "status-banner";
      els.cctvBannerText.textContent = "All zones clear — no active incidents.";
    } else {
      const top = incidents.find(i => alertZones.has(i.location));
      els.cctvBanner.className = "status-banner alert";
      els.cctvBannerText.textContent = `⚠ ALERT — ${[...alertZones].join(", ")}${top ? `: ${top.summary}` : ""}`;
    }

    Object.values(state.cameraRegistry).forEach(cam => {
      const card = document.getElementById(`cam-${cam.camera_id}`);
      const badge = document.getElementById(`badge-${cam.camera_id}`);
      const signal = document.getElementById(`signal-${cam.camera_id}`);
      if (!card) return;

      const isAlert = alertZones.has(cam.location);
      const incident = incidents.find(i => i.location === cam.location);
      const msg = document.getElementById(`msg-${cam.camera_id}`);

      card.classList.toggle("alert", isAlert);
      badge.className = `cam-badge ${isAlert ? "caution" : "clear"}`;
      
      if (isAlert && incident) {
        badge.textContent = incident.type.toUpperCase();
        if (msg) msg.querySelector("span").textContent = `${incident.type.toUpperCase()} DETECTED`;
      } else {
        badge.textContent = "CLEAR";
        if (msg) msg.querySelector("span").textContent = "";
      }

      if (signal) {
        signal.textContent = incident ? `${incident.type} · ${incident.severity}` : "No signal";
      }
    });
  } catch (err) {
    console.error("CCTV status refresh failed:", err);
  }
}

async function triggerPanic(camId, location) {
  if (!confirm(`Trigger EMERGENCY protocol for ${location}?`)) return;
  const payload = {
    trigger_id: `manual-${Date.now()}`,
    location: location,
    trigger_type: "panic_button",
    notes: `Manual panic trigger from CCTV Wall (Camera ${camId})`
  };
  await sendEvent("manual", payload);
  refreshCctvStatus();
}
window.triggerPanic = triggerPanic;

function toggleMode() {
  state.useMock = !state.useMock;
  localStorage.setItem("ecg-use-mock", String(state.useMock));
  syncModeUi();
  setStatus(
    state.useMock
      ? "Mock mode enabled. Command room is using simulated incidents."
      : "Backend mode enabled. Live backend data is active.",
    "neutral"
  );
  refreshAll();
}

function syncModeUi() {
  els.toggleMode.textContent = state.useMock ? "Mock Mode" : "Live Mode";
  els.toggleMode.classList.toggle("live", !state.useMock);
}

function setStatus(message, tone) {
  els.connectionStatus.textContent = message;
  els.connectionStatus.className = `status ${tone}`;
}

function selectLocation(location) {
  state.selectedLocation = location;
  if (els.mapHint) els.mapHint.textContent = `Selected zone: ${location}`;
  
  const cameras = Object.values(state.cameraRegistry);
  const matchingCamera = cameras.find((camera) => camera.location === location);
  if (matchingCamera && matchingCamera.camera_id !== state.selectedCameraId) {
    selectCamera(matchingCamera.camera_id);
  }
  renderVisionLocation(location);
}

function selectCamera(cameraId) {
  state.selectedCameraId = cameraId;
  if (els.cameraSelect) els.cameraSelect.value = cameraId;
  const config = state.cameraRegistry[cameraId];
  if (!config) return;
  if (els.visionSource) els.visionSource.value = config.source;
  if (els.visionModelPath) els.visionModelPath.value = config.model_path;
  if (els.visionConfidence) els.visionConfidence.value = String(config.confidence);
  if (els.visionFrameStride) els.visionFrameStride.value = String(config.frame_stride);
  state.selectedLocation = config.location;
  if (els.mapHint) els.mapHint.textContent = `Selected zone: ${config.location}`;
  if (els.cameraConfigStatus) {
    els.cameraConfigStatus.textContent = `Editing ${config.camera_id} for ${config.location}.`;
    els.cameraConfigStatus.className = "status neutral";
  }
  renderVisionLocation(config.location);
}

async function checkHealth() {
  if (state.useMock) {
    setStatus("Mock mode active. No live health check required.", "neutral");
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/health"));
    if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
    const data = await response.json();
    setStatus(`System synchronized: backend ${data.status}`, "good");
  } catch (error) {
    setStatus(`Backend check failed: ${error.message}`, "bad");
  }

  await refreshVisionHealth();
}

async function sendQuickDetection(label, confidence) {
  const payload = {
    camera_id: "cam-03",
    location: state.selectedLocation,
    label,
    confidence,
  };
  await sendEvent("detection", payload);
}

function setWebcamSource() {
  els.visionSource.value = "0";
  updateSelectedCameraConfig();
  saveCameraRegistry();
  renderVisionLocation(state.selectedLocation);
  setVisionStatus(`Vision source set to webcam (0) for ${state.selectedCameraId}.`, "good");
}

function saveSourcePreset() {
  updateSelectedCameraConfig();
  saveCameraRegistry();
  const config = state.cameraRegistry[state.selectedCameraId];
  els.cameraConfigStatus.textContent = `Saved ${config.camera_id} source: ${config.source || "empty"}`;
  els.cameraConfigStatus.className = "status good";
  setVisionStatus(`Saved source for ${config.location}.`, "good");
  renderDynamicUI(); // Re-render in case location name changed
  selectCamera(state.selectedCameraId);
}

function addCamera() {
  const locName = prompt("Enter the zone/location name for the new camera (e.g., 'Pool'):");
  if (!locName || !locName.trim()) return;
  
  // Generate next available cam-XX id
  let maxId = 0;
  Object.keys(state.cameraRegistry).forEach(id => {
      const match = id.match(/cam-(\d+)/);
      if (match) {
          maxId = Math.max(maxId, parseInt(match[1]));
      }
  });
  const nextId = `cam-${String(maxId + 1).padStart(2, '0')}`;
  
  state.cameraRegistry[nextId] = {
    camera_id: nextId,
    location: locName.trim(),
    source: "0",
    model_path: "vision/models/best.pt",
    confidence: 0.65,
    frame_stride: 12,
  };
  
  saveCameraRegistry();
  renderDynamicUI();
  selectCamera(nextId);
  setStatus(`Created new camera unit ${nextId} at ${locName}`, "good");
}

function deleteCamera() {
  if (Object.keys(state.cameraRegistry).length <= 1) {
    alert("You cannot delete the last remaining camera unit.");
    return;
  }
  
  const toDelete = state.selectedCameraId;
  if (!confirm(`Are you sure you want to delete ${toDelete}?`)) return;
  
  delete state.cameraRegistry[toDelete];
  saveCameraRegistry();
  
  const firstCam = Object.values(state.cameraRegistry)[0];
  state.selectedCameraId = firstCam.camera_id;
  state.selectedLocation = firstCam.location;
  
  renderDynamicUI();
  selectCamera(firstCam.camera_id);
  setStatus(`Deleted camera unit ${toDelete}`, "neutral");
}

async function sendManualEmergency() {
  const payload = {
    trigger_id: `manual-${Date.now()}`,
    location: state.selectedLocation,
    trigger_type: "panic_button",
    notes: "Manual escalation raised from operations panel",
  };
  await sendEvent("manual", payload);
}

async function runSmokeScenario() {
  const location = state.selectedLocation;
  const sequence = [
    ["detection", { camera_id: "cam-03", location, label: "smoke", confidence: 0.68 }],
    ["detection", { camera_id: "cam-03", location, label: "smoke", confidence: 0.74 }],
  ];

  for (const [kind, payload] of sequence) {
    await sendEvent(kind, payload);
  }
}

async function runFireScenario() {
  const location = state.selectedLocation;
  const sequence = [
    ["detection", { camera_id: "cam-03", location, label: "smoke", confidence: 0.71 }],
    ["detection", { camera_id: "cam-03", location, label: "smoke", confidence: 0.76 }],
    ["sensor", { sensor_id: "temp-08", location, sensor_type: "temperature", value: 64 }],
    ["detection", { camera_id: "cam-03", location, label: "fire", confidence: 0.81 }],
    ["detection", { camera_id: "cam-03", location, label: "fire", confidence: 0.84 }],
    ["detection", { camera_id: "cam-03", location, label: "fire", confidence: 0.88 }],
  ];

  for (const [kind, payload] of sequence) {
    await sendEvent(kind, payload);
  }
}

async function sendEvent(kind, payload) {
  if (state.useMock) {
    processMockEvent(kind, payload);
    setStatus(`${kind} event injected into mock command workflow.`, "good");
    renderAll();
    return;
  }

  const endpointByKind = {
    detection: "/ingest/detection",
    sensor: "/ingest/sensor",
    manual: "/ingest/manual",
  };

  try {
    const response = await fetch(resolveApiUrl(endpointByKind[kind]), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    setStatus(`${kind} input accepted by command system.`, "good");
    await refreshAll();
  } catch (error) {
    setStatus(`Request failed: ${error.message}`, "bad");
  }
}

function processMockEvent(kind, payload) {
  mockStore.events.unshift({
    kind,
    received_at: new Date().toISOString(),
    payload,
  });

  const sameLocation = mockStore.events.filter((entry) => entry.payload.location === payload.location);
  const detections = sameLocation.filter((entry) => entry.kind === "detection");
  const fireHits = detections.filter((entry) => entry.payload.label === "fire" && Number(entry.payload.confidence) >= 0.55).length;
  const smokeHits = detections.filter((entry) => entry.payload.label === "smoke" && Number(entry.payload.confidence) >= 0.45).length;

  let incident = null;
  if (kind === "manual") {
    incident = createMockIncident(payload.location, "fire", "critical", "Manual emergency override triggered.");
  } else if (kind === "broadcast") {
    incident = createMockIncident("All Zones", "broadcast", "medium", "System Broadcast: " + payload.message);
    incident.recommended_action = payload.message;
  } else if (fireHits >= 3 && smokeHits >= 1) {
    incident = createMockIncident(payload.location, "fire", "high", "Confirmed fire pattern detected from camera and supporting signals.");
  } else if (smokeHits >= 2) {
    incident = createMockIncident(payload.location, "warning", "medium", "Smoke detected with enough persistence to trigger early warning.");
  }

  if (incident) {
    upsertMockIncident(incident);
    syncMockNotifications(incident);
  }

  state.incidents = mockStore.incidents;
  state.events = mockStore.events;
  state.notifications = mockStore.notifications;
  state.directory = mockStore.directory;
}

function createMockIncident(location, type, severity, summary) {
  const now = new Date().toISOString();
  return {
    incident_id: type === "broadcast" ? `broadcast-${Date.now()}` : `mock-${location.toLowerCase().replace(/\s+/g, "-")}`,
    type,
    severity,
    location,
    status: "active",
    summary,
    recommended_action: severity === "critical"
      ? "Dispatch security lead, front office, and duty manager immediately."
      : "Verify on site and prepare escalation if conditions worsen.",
    first_seen: now,
    last_updated: now,
    evidence: ["mock:event_stream"],
  };
}

function upsertMockIncident(incident) {
  const index = mockStore.incidents.findIndex((item) => item.location === incident.location);
  if (index >= 0) {
    incident.first_seen = mockStore.incidents[index].first_seen;
    mockStore.incidents[index] = incident;
  } else {
    mockStore.incidents.unshift(incident);
  }
}

function syncMockNotifications(incident) {
  mockStore.notifications = mockStore.directory.map((contact, index) => ({
    notification_id: `${incident.incident_id}:${index}`,
    incident_id: incident.incident_id,
    location: incident.location,
    incident_type: incident.type,
    severity: incident.severity,
    recipient: contact,
    channel: contact.channels.includes("voice") && incident.severity === "critical" ? "voice" : "sms",
    message: `${incident.type.toUpperCase()} | ${incident.location} | ${incident.recommended_action}`,
    status: contact.escalation_level >= 3 && incident.severity === "critical" ? "escalated" : "sent",
    created_at: incident.last_updated,
    updated_at: incident.last_updated,
    acknowledged_at: null,
    reason: contact.zone === incident.location ? "zone_owner" : "command_escalation",
  }));
}

let lastIncidentCount = 0;

async function refreshAll() {
  await Promise.all([refreshIncidents(), refreshEvents(), refreshNotifications(), refreshDirectory()]);
  
  // Alert Logic: Glow sidebar if incidents exist while on CCTV
  const activeCount = state.incidents.length;
  if (activeCount > 0 && state.currentScreen === "cctv") {
    els.showIncidentView.classList.add("glow-alert");
    if (activeCount > lastIncidentCount) {
      playAlertBeep();
    }
  } else {
    els.showIncidentView.classList.remove("glow-alert");
  }
  lastIncidentCount = activeCount;

  renderAll();
}

function renderAll() {
  renderOverview();
  renderCommandFocus();
  renderEvents();
  renderNotifications();
  renderDirectory();
  renderMap();
  if (state.currentScreen === "cctv") {
    refreshCctvStatus();
  }
}

async function refreshIncidents() {
  if (state.useMock) {
    state.incidents = mockStore.incidents;
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/incidents/active"));
    if (!response.ok) throw new Error(`Incident refresh failed with ${response.status}`);
    state.incidents = await response.json();
  } catch (error) {
    setStatus(`Could not fetch incidents: ${error.message}`, "bad");
  }
}

async function refreshEvents() {
  if (state.useMock) {
    state.events = mockStore.events;
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/events"));
    if (!response.ok) throw new Error(`Event refresh failed with ${response.status}`);
    state.events = await response.json();
  } catch (error) {
    setStatus(`Could not fetch events: ${error.message}`, "bad");
  }
}

async function refreshNotifications() {
  if (state.useMock) {
    state.notifications = mockStore.notifications;
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/notifications"));
    if (!response.ok) throw new Error(`Notification refresh failed with ${response.status}`);
    state.notifications = await response.json();
  } catch (error) {
    setStatus(`Could not fetch notifications: ${error.message}`, "bad");
  }
}

async function refreshDirectory() {
  if (state.useMock) {
    state.directory = mockStore.directory;
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/directory"));
    if (!response.ok) throw new Error(`Directory refresh failed with ${response.status}`);
    state.directory = await response.json();
  } catch (error) {
    setStatus(`Could not fetch directory: ${error.message}`, "bad");
  }
}

function clearMockData() {
  mockStore.incidents = [];
  mockStore.events = [];
  mockStore.notifications = [];
  if (state.useMock) {
    state.incidents = [];
    state.events = [];
    state.notifications = [];
    renderAll();
    setStatus("Mock command data cleared.", "neutral");
  }
}

function renderOverview() {
  const incidentCount = state.incidents.length;
  const criticalCount = state.incidents.filter((incident) => incident.severity === "critical").length;
  const notificationCount = state.notifications.length;
  const acknowledged = state.notifications.filter((item) => item.status === "acknowledged").length;
  const acknowledgedRate = notificationCount ? Math.round((acknowledged / notificationCount) * 100) : 0;

  els.metricIncidents.textContent = String(incidentCount);
  els.metricCritical.textContent = String(criticalCount);
  els.metricNotifications.textContent = String(notificationCount);
  els.metricAcknowledged.textContent = `${acknowledgedRate}%`;
}

async function resolveIncident(location) {
  if (!confirm(`Are you sure you want to resolve the incident at ${location}?`)) return;
  
  try {
    const res = await fetch(`${resolveApiUrl("/incidents")}/${encodeURIComponent(location)}/resolve`, {
      method: "POST"
    });
    const data = await res.json();
    if (data.ok) {
      if (state.selectedIncidentId) state.selectedIncidentId = null;
      await refreshAll();
      setStatus(`Incident at ${location} resolved manually.`, "good");
    }
  } catch (err) {
    console.error("Resolution failed:", err);
    setStatus(`Failed to resolve incident: ${err.message}`, "bad");
  }
}
window.resolveIncident = resolveIncident;

function selectIncident(incidentId) {
  if (state.selectedIncidentId === incidentId) {
    state.selectedIncidentId = null; // deselect if clicked again
  } else {
    state.selectedIncidentId = incidentId;
  }
  renderAll();
}
window.selectIncident = selectIncident;

function toggleCommandCard(incidentId) {
  const card = document.getElementById(`incident-${incidentId}`);
  if (card) {
    card.classList.toggle("collapsed");
  }
}
window.toggleCommandCard = toggleCommandCard;

function renderCommandFocus() {
  if (!state.incidents.length) {
    els.commandFocus.className = "command-focus empty-state";
    els.commandFocus.textContent =
      "No active incident yet. Once a fire, smoke, medical, or security event is confirmed, the live response card will appear here.";
    return;
  }

  els.commandFocus.className = "command-focus";
  els.commandFocus.innerHTML = state.incidents
    .map((incident, index) => {
      const routed = state.notifications.filter((item) => item.incident_id === incident.incident_id).length;
      const acknowledged = state.notifications.filter(
        (item) => item.incident_id === incident.incident_id && item.status === "acknowledged"
      ).length;

      const isSelected = state.selectedIncidentId === incident.incident_id;
      return `
        <article class="command-card ${isSelected ? 'expanded' : 'collapsed'}" 
                 id="incident-${incident.incident_id}" 
                 onclick="selectIncident('${incident.incident_id}')">
          <div class="command-topline">
            <span class="badge ${incident.type}">${escapeHtml(incident.type)}</span>
            <span class="badge ${incident.severity}">${escapeHtml(incident.severity)}</span>
            <span class="badge">${escapeHtml(incident.location)}</span>
          </div>
          <div class="focus-title">
            <div>
              <h3>${escapeHtml(incident.summary)}</h3>
              <p class="focus-summary">${escapeHtml(incident.recommended_action)}</p>
              ${!isSelected ? '<span style="font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px;">+ Click to expand details</span>' : ''}
            </div>
          </div>
          <div class="focus-grid">
            <div class="focus-stat">
              <span>Last Updated</span>
              <strong>${formatDate(incident.last_updated)}</strong>
            </div>
            <div class="focus-stat">
              <span>Notifications Routed</span>
              <strong>${routed}</strong>
            </div>
            <div class="focus-stat">
              <span>Acknowledged</span>
              <strong>${acknowledged}</strong>
            </div>
          </div>
          <ul class="focus-evidence">
            ${(incident.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
          <div class="incident-actions">
            <div class="dispatch-actions">
              ${(incident.type === 'medical' ? [{label: "💉 First Aid", msg: "Bring First Aid Kit to location and assess patient."}, {label: "🚑 Call 911", msg: "Condition critical. Call 911 immediately."}] : incident.type === 'fire' ? [{label: "🏃 Evacuate", msg: "Evacuate zone immediately. Guide guests to assembly point."}, {label: "🧯 Extinguish", msg: "Use nearest fire extinguisher if safe. Isolate power."}] : [{label: "🔒 Lock Down", msg: "Secure all exits and isolate area. Do not confront."}, {label: "👮 Police", msg: "Call local law enforcement for backup."}]).map(t => `<button class="dispatch-btn ${incident.type}-action" onclick="event.stopPropagation(); sendQuickAction('${escapeHtml(incident.location)}', '${escapeHtml(t.msg)}')">${t.label}</button>`).join('')}
            </div>
            <button class="btn-resolve" onclick="event.stopPropagation(); resolveIncident('${escapeHtml(incident.incident_id)}')">
              <span>✅</span> Verify & Resolve Incident
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderEvents() {
  if (!state.events.length) {
    els.eventList.className = "card-list empty-state";
    els.eventList.textContent = "No events yet.";
    return;
  }

  els.eventList.className = "card-list";
  els.eventList.innerHTML = state.events
    .map((event) => {
      const payload = event.payload || {};
      return `
        <article class="event-card">
          <div class="event-meta">
            <span class="badge">${escapeHtml(event.kind)}</span>
            <span class="badge">${escapeHtml(payload.location || "unknown")}</span>
          </div>
          <p>${renderPayloadSummary(event.kind, payload)}</p>
          <p><strong>Received:</strong> ${formatDate(event.received_at)}</p>
        </article>
      `;
    })
    .join("");
}

function renderNotifications() {
  els.notificationList.className = "card-list";
  
  if (!state.selectedIncidentId) {
    els.notificationList.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 24px; margin-bottom: 12px;">👆</div>
        <p><strong>Select an incident</strong> from the command center to view its specific notification routing and responders.</p>
      </div>
    `;
    return;
  }

  const selected = state.incidents.find(i => i.incident_id === state.selectedIncidentId);
  const notifications = state.notifications.filter(n => n.incident_id === state.selectedIncidentId);
  
  if (!notifications.length) {
    els.notificationList.innerHTML = `<p class="empty-state">No notification routing active for this incident yet.</p>`;
    return;
  }

  const phoneNumbers = notifications.map(n => n.recipient.phone);
  
  els.notificationList.innerHTML = `
    <div style="margin-bottom: 12px; padding: 10px 16px; background: var(--accent-strong); border-radius: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 15px rgba(187, 62, 3, 0.3);">
      <div style="display: flex; flex-direction: column;">
        <span style="font-size: 9px; font-weight: 800; text-transform: uppercase; color: rgba(255,255,255,0.8); letter-spacing: 1px;">Routing Status</span>
        <span style="font-size: 13px; font-weight: 700; color: #fff;">${notifications.length} Active Responders</span>
      </div>
      <button class="button" style="background: #fff; color: var(--accent-strong); border: none; padding: 5px 10px; font-weight: 900; font-size: 9px; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);" onclick="sendBulkSMS(${JSON.stringify(phoneNumbers).replace(/"/g, "'")})">
        📢 BROADCAST ALL
      </button>
    </div>
    <div style="margin-bottom: 12px; font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; padding-left: 4px;">Responder Log</div>
    ${notifications.map((notification) => {
      const isNew = !notification.acknowledged_at && (new Date() - new Date(notification.created_at) < 60000);
      return `
        <article class="notification-card minimized ${isNew ? 'new-alert' : ''}" style="margin-bottom: 4px; padding: 10px 12px; background: #fff; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 800; color: #1a1a1a;">${escapeHtml(notification.recipient.name)} <span style="color: var(--accent-strong); margin-left: 8px;">${escapeHtml(notification.recipient.phone)}</span></div>
              <div style="font-size: 10px; color: #666; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">${escapeHtml(notification.recipient.role)}</div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="badge ${notification.status}" style="font-size: 9px; padding: 2px 8px; font-weight: 800;">${escapeHtml(notification.status)}</span>
              ${notification.status !== 'acknowledged' ? `
                <button class="dispatch-btn" style="padding: 5px 10px; font-size: 10px; background: rgba(0,0,0,0.05); color: #333;" onclick="acknowledgeNotification('${notification.notification_id}')">Verify</button>
              ` : ''}
              <button class="dispatch-btn" style="padding: 5px 10px; font-size: 10px; background: var(--accent-strong); color: #fff; border: none;" onclick="sendRealSMS('${notification.recipient.phone}', '${escapeHtml(notification.message)}')">SMS</button>
            </div>
          </div>
        </article>
      `;
    }).join("")}
  `;
}


function renderDirectory() {
  if (!state.directory) state.directory = [];
  
  els.directoryList.className = "directory-table-container";
  els.directoryList.innerHTML = `
    <table class="directory-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Role</th>
          <th>Zone</th>
          <th>Phone</th>
          <th>Channels (csv)</th>
          <th>Level</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="directoryTableBody">
        ${state.directory.map((contact, index) => `
          <tr data-index="${index}" data-id="${escapeHtml(contact.contact_id || '')}">
            <td><input type="text" class="dir-input name-input" value="${escapeHtml(contact.name || "")}"></td>
            <td><input type="text" class="dir-input role-input" value="${escapeHtml(contact.role || "")}"></td>
            <td><input type="text" class="dir-input zone-input" value="${escapeHtml(contact.zone || "")}"></td>
            <td><input type="text" class="dir-input phone-input" value="${escapeHtml(contact.phone || "")}"></td>
            <td><input type="text" class="dir-input channels-input" value="${escapeHtml((contact.channels || []).join(","))}"></td>
            <td><input type="number" class="dir-input level-input" value="${escapeHtml(String(contact.escalation_level || 1))}" min="1"></td>
            <td style="display: flex; gap: 4px;">
              <button class="button subtle" style="padding: 6px 10px; font-size: 12px; border-color: rgba(60, 150, 200, 0.4);" onclick="sendManualSms('${escapeHtml(contact.phone || '')}', '${escapeHtml(contact.name || 'Responder')}')">Ping</button>
              <button class="button subtle danger btn-remove-row" style="padding: 6px 10px; font-size: 12px;">Del</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <div class="directory-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
      <button id="addDirectoryRow" class="button subtle">Add Row</button>
      <button id="saveDirectory" class="button">Save Changes</button>
    </div>
  `;

  document.getElementById("addDirectoryRow").addEventListener("click", () => {
    syncDirectoryTableToState();
    state.directory.push({
      name: "", role: "", zone: "", phone: "", channels: ["sms"], escalation_level: 1
    });
    renderDirectory();
  });

  document.getElementById("saveDirectory").addEventListener("click", saveDirectory);

  Array.from(els.directoryList.querySelectorAll(".btn-remove-row")).forEach((btn, index) => {
    btn.addEventListener("click", () => {
      syncDirectoryTableToState();
      state.directory.splice(index, 1);
      renderDirectory();
    });
  });
}

function syncDirectoryTableToState() {
  const rows = Array.from(els.directoryList.querySelectorAll("#directoryTableBody tr"));
  state.directory = rows.map((row) => {
    return {
      contact_id: row.dataset.id || undefined,
      name: row.querySelector(".name-input").value.trim(),
      role: row.querySelector(".role-input").value.trim(),
      zone: row.querySelector(".zone-input").value.trim(),
      phone: row.querySelector(".phone-input").value.trim(),
      channels: row.querySelector(".channels-input").value.split(",").map(c => c.trim()).filter(c => c),
      escalation_level: parseInt(row.querySelector(".level-input").value) || 1,
    };
  });
}

async function saveDirectory() {
  syncDirectoryTableToState();
  if (state.useMock) {
    mockStore.directory = [...state.directory];
    setStatus("Directory saved to mock store.", "good");
    return;
  }
  
  try {
    const response = await fetch(resolveApiUrl("/directory"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.directory),
    });
    if (!response.ok) throw new Error(`Directory save failed: ${response.status}`);
    const data = await response.json();
    state.directory = data.directory;
    renderDirectory();
    setStatus("Directory updated on backend.", "good");
  } catch (error) {
    setStatus(`Failed to save directory: ${error.message}`, "bad");
  }
}

async function sendManualSms(phone, name) {
  if (!phone) {
    alert("This contact does not have a valid phone number.");
    return;
  }
  const message = prompt(`Type an SMS to send to ${name} (${phone}):`);
  if (!message || !message.trim()) return;

  await dispatchSms(phone, message.trim());
}

async function broadcastSms() {
  const message = prompt(`Type a broadcast message. This will be routed to ALL staff as a formal notification:`);
  if (!message || !message.trim()) return;

  if (state.useMock) {
    processMockEvent("broadcast", { message: message.trim() });
    setStatus("Mock broadcast incident created and routed.", "good");
    renderAll();
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/ingest/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message.trim() }),
    });
    if (!response.ok) throw new Error(`Broadcast failed with ${response.status}`);
    setStatus(`Broadcast incident created and routed.`, "good");
    await refreshAll();
  } catch (error) {
    setStatus(`Failed to broadcast: ${error.message}`, "bad");
  }
}

async function dispatchSms(phone, message) {
  if (state.useMock) {
    mockStore.events.unshift({
      kind: "manual_sms",
      received_at: new Date().toISOString(),
      payload: { phone, message }
    });
    setStatus(`Mock SMS sent to ${phone}: ${message}`, "good");
    return;
  }

  try {
    const response = await fetch(resolveApiUrl("/manual-sms"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, message }),
    });
    if (!response.ok) throw new Error(`SMS send failed with ${response.status}`);
    setStatus(`SMS successfully routed to ${phone}.`, "good");
  } catch (error) {
    setStatus(`Failed to send SMS to ${phone}: ${error.message}`, "bad");
  }
}

async function acknowledgeNotification(notificationId) {
  if (state.useMock) {
    mockStore.notifications = mockStore.notifications.map((item) =>
      item.notification_id === notificationId
        ? { ...item, status: "acknowledged", acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : item
    );
    state.notifications = mockStore.notifications;
    renderOverview();
    renderNotifications();
    return;
  }

  try {
    const response = await fetch(resolveApiUrl(`/notifications/${notificationId}/acknowledge`), {
      method: "POST",
    });
    if (!response.ok) throw new Error(`Acknowledge failed with ${response.status}`);
    await refreshNotifications();
    renderOverview();
    renderNotifications();
  } catch (error) {
    setStatus(`Could not acknowledge notification: ${error.message}`, "bad");
  }
}

function renderPayloadSummary(kind, payload) {
  if (kind === "detection") {
    return `<strong>${escapeHtml(payload.label)}</strong> from ${escapeHtml(payload.camera_id)} with confidence ${escapeHtml(String(payload.confidence))}`;
  }
  if (kind === "sensor") {
    return `<strong>${escapeHtml(payload.sensor_type)}</strong> reading ${escapeHtml(String(payload.value))} from ${escapeHtml(payload.sensor_id)}`;
  }
  return `<strong>${escapeHtml(payload.trigger_type)}</strong> from ${escapeHtml(payload.trigger_id)}${payload.notes ? `, ${escapeHtml(payload.notes)}` : ""}`;
}

function renderVisionLocation(location) {
  const sourceHint = els.visionSource.value.trim();
  els.visionStatus.textContent = `Vision target: ${state.selectedCameraId} in ${location}. Current source: ${sourceHint || "not set"}.`;
  els.visionStatus.className = "status neutral";
}

function visionPayload() {
  updateSelectedCameraConfig();
  saveCameraRegistry();
  const selected = state.cameraRegistry[state.selectedCameraId];
  const payload = {
    source: selected.source,
    location: selected.location,
    camera_id: selected.camera_id,
    model_path: selected.model_path,
    confidence: Number(selected.confidence),
    frame_stride: Number(selected.frame_stride),
    backend_url: "http://127.0.0.1:8000",
  };
  return payload;
}

function updateSelectedCameraConfig() {
  const existing = state.cameraRegistry[state.selectedCameraId];
  state.cameraRegistry[state.selectedCameraId] = {
    ...(existing || {}),
    camera_id: state.selectedCameraId,
    location: Object.values(state.cameraRegistry).find((item) => item.camera_id === state.selectedCameraId)?.location || state.selectedLocation,
    source: els.visionSource.value.trim(),
    model_path: els.visionModelPath.value.trim(),
    confidence: Number(els.visionConfidence.value),
    frame_stride: Number(els.visionFrameStride.value),
  };
}

async function configureVision() {
  try {
    const response = await fetch("/visionapi/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(visionPayload()),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Configure failed with ${response.status}`);
    updateVisionStatus(data);
  } catch (error) {
    setVisionStatus(`Vision configure failed: ${error.message}`, "bad");
  }
}

async function startVision() {
  try {
    await configureVision();
    const response = await fetch("/visionapi/start", { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camera_id: state.selectedCameraId })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Start failed with ${response.status}`);
    updateVisionStatus(data);
    setTimeout(refreshAll, 1500);
  } catch (error) {
    setVisionStatus(`Vision start failed: ${error.message}`, "bad");
  }
}

async function startAllVision() {
  const cameras = Object.values(state.cameraRegistry);
  if (cameras.length === 0) {
    els.visionStatus.textContent = "No cameras registered.";
    els.visionStatus.className = "status bad";
    return;
  }

  els.visionStatus.textContent = `Starting ${cameras.length} cameras...`;
  els.visionStatus.className = "status neutral";

  let started = 0;
  for (const cam of cameras) {
    try {
      // Ensure backend knows the camera config first
      await fetch("/visionapi/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cam),
      });

      const res = await fetch("/visionapi/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera_id: cam.camera_id }),
      });
      if (res.ok) started++;
    } catch (e) {
      console.error(`Failed to start ${cam.camera_id}:`, e);
    }
  }

  els.visionStatus.textContent = `Successfully started ${started} / ${cameras.length} cameras.`;
  els.visionStatus.className = started === cameras.length ? "status good" : "status warning";
}

async function stopVision() {
  try {
    const response = await fetch("/visionapi/stop", { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camera_id: state.selectedCameraId })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Stop failed with ${response.status}`);
    updateVisionStatus(data);
  } catch (error) {
    setVisionStatus(`Vision stop failed: ${error.message}`, "bad");
  }
}

async function detectVisionOnce() {
  try {
    await configureVision();
    const response = await fetch("/visionapi/detect-once", { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ camera_id: state.selectedCameraId })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Detect once failed with ${response.status}`);
    updateVisionStatus(data);
    await refreshAll();
  } catch (error) {
    setVisionStatus(`Vision detect failed: ${error.message}`, "bad");
  }
}

async function refreshVisionHealth() {
  try {
    const response = await fetch("/visionapi/health");
    const data = await response.json();
    if (!response.ok) throw new Error(`Vision health failed with ${response.status}`);
    updateVisionStatus(data[state.selectedCameraId] || {});
  } catch (error) {
    setVisionStatus(`Vision service unavailable: ${error.message}`, "neutral");
  }
}

function updateVisionStatus(data) {
  const stateBlock = data.state || {};
  const notes = [];
  notes.push(stateBlock.running ? "running" : "idle");
  notes.push(stateBlock.ready ? "ready" : "not ready");
  if (stateBlock.frames_processed) notes.push(`frames ${stateBlock.frames_processed}`);
  if (stateBlock.emitted_events) notes.push(`events ${stateBlock.emitted_events}`);
  if (stateBlock.last_detections && stateBlock.last_detections.length) {
    const labels = stateBlock.last_detections.map((item) => `${item.label} ${item.confidence}`).join(", ");
    notes.push(`last detections: ${labels}`);
  }
  if (stateBlock.last_error) notes.push(`error: ${stateBlock.last_error}`);
  setVisionStatus(`Vision ${notes.join(" | ")}`, stateBlock.ready ? "good" : "neutral");
}

function setVisionStatus(message, tone) {
  els.visionStatus.textContent = message;
  els.visionStatus.className = `status ${tone}`;
}

function formatDate(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function resolveApiUrl(path) {
  const base = state.apiBase.trim().replace(/\/$/, "");
  return `${base}${path}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

window.acknowledgeNotification = acknowledgeNotification;

async function sendRealSMS(phone, message) {
  let target = phone.trim();
  // Fail-safe: Prepend +91 if country code is missing
  if (!target.startsWith("+")) {
    target = "+91" + target;
  }
  
  try {
    const response = await fetch(`${state.apiBase}/sms/real`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: target, message })
    });
    const data = await response.json();
    if (data.sent) {
      alert(`SMS message successfully routed via Twilio to ${phone}`);
    } else {
      alert(`Twilio SMS routing failed: ${data.error}`);
    }
  } catch (error) {
    alert(`System Error connecting to Twilio SMS: ${error.message}`);
  }
}

window.sendRealSMS = sendRealSMS;

async function sendBulkSMS(phones) {
  const message = prompt("Enter broadcast message for all responders:", "CRITICAL ALERT: Emergency detected. Please check the Crisis Grid dashboard immediately.");
  if (!message) return;

  try {
    const response = await fetch(`${state.apiBase}/sms/bulk-real`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phones, message })
    });
    const data = await response.json();
    if (data.sent) {
      alert(`Broadcast sent successfully to ${data.count} responders.`);
    } else {
      alert(`Broadcast failed: ${data.error}`);
    }
  } catch (error) {
    alert(`System Error connecting to Broadcast service: ${error.message}`);
  }
}
window.sendBulkSMS = sendBulkSMS;

init();
