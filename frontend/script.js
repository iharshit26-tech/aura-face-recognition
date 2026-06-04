// Global Configuration and State
const API_BASE = window.location.origin;
let currentMode = 'verify'; // 'verify' or 'enroll'
let liveScanInterval = null;
let webcamStream = null;

// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('capture-canvas');
const clockEl = document.getElementById('clock');
const faceReticle = document.getElementById('face-reticle');

// Status Panel Elements
const statusPanel = document.getElementById('scanner-status');
const statusCode = document.getElementById('status-code');
const statusMessage = document.getElementById('status-message');

// Analysis Panel Elements
const profileName = document.getElementById('profile-name');
const profileStatus = document.getElementById('profile-status');
const profileTime = document.getElementById('profile-time');
const profileAge = document.getElementById('profile-age');
const profileGender = document.getElementById('profile-gender');
const genderConfidence = document.getElementById('gender-confidence');

// Emotion progress bars
const emotionBars = {
    neutral: { fill: document.getElementById('em-neutral'), pct: document.getElementById('em-neutral-pct') },
    happy: { fill: document.getElementById('em-happy'), pct: document.getElementById('em-happy-pct') },
    sad: { fill: document.getElementById('em-sad'), pct: document.getElementById('em-sad-pct') },
    angry: { fill: document.getElementById('em-angry'), pct: document.getElementById('em-angry-pct') },
    fear: { fill: document.getElementById('em-fear'), pct: document.getElementById('em-fear-pct') },
    surprise: { fill: document.getElementById('em-surprise'), pct: document.getElementById('em-surprise-pct') }
};

// --------------------------------------------------------
// 1. Clock & Initialization
// --------------------------------------------------------
function startClock() {
    setInterval(() => {
        const now = new Date();
        clockEl.textContent = now.toTimeString().split(' ')[0];
    }, 1000);
}

// Speech Synthesis function
function speak(text) {
    if ('speechSynthesis' in window) {
        // Cancel current speech to prevent overlapping announcements
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.pitch = 0.85; // Slightly robotic/lower pitch
        utterance.rate = 1.0;   // Normal speed
        
        // Try to pick a premium sounding English voice if available
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
            v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Zira'))
        );
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        window.speechSynthesis.speak(utterance);
    }
}

// Request webcam access
async function setupWebcam() {
    updateStatus('AURA_INIT', 'INITIALIZING VIDEO CAPTURE LINK...', 'scanning');
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });
        video.srcObject = webcamStream;
        video.onloadedmetadata = () => {
            updateStatus('AURA_READY', 'SYSTEM STANDBY - READY TO ACQUIRE LINK', '');
            faceReticle.classList.add('detecting');
        };
    } catch (err) {
        console.error("Webcam access error:", err);
        updateStatus('CAM_ERROR', 'CAMERA ACCESS DENIED OR UNAVAILABLE', 'denied');
        speak("Biometric link failure. Camera access denied.");
    }
}

// --------------------------------------------------------
// 2. Mode Management
// --------------------------------------------------------
function setMode(mode) {
    if (currentMode === mode) return;
    currentMode = mode;
    
    // Toggle active tabs
    document.getElementById('tab-verify').classList.toggle('active', mode === 'verify');
    document.getElementById('tab-enroll').classList.toggle('active', mode === 'enroll');
    
    // Toggle active panels
    document.getElementById('panel-verify').classList.toggle('active', mode === 'verify');
    document.getElementById('panel-enroll').classList.toggle('active', mode === 'enroll');
    
    // Reset scanner states
    if (mode === 'enroll') {
        // Disable live scan when enrolling
        const liveScanCheckbox = document.getElementById('live-scan-checkbox');
        if (liveScanCheckbox && liveScanCheckbox.checked) {
            liveScanCheckbox.checked = false;
            toggleLiveScan(liveScanCheckbox);
        }
        updateStatus('AURA_ENROLL', 'READY FOR ENROLLMENT SEED', '');
    } else {
        updateStatus('AURA_READY', 'SYSTEM STANDBY - READY TO ACQUIRE LINK', '');
    }
}

// --------------------------------------------------------
// 3. Image Capture & API Integration
// --------------------------------------------------------
function captureFrame() {
    return new Promise((resolve) => {
        if (!video.videoWidth) {
            resolve(null);
            return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        // Draw the current video frame (mirrored to match preview)
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        
        canvas.toBlob((blob) => {
            resolve(blob);
        }, 'image/jpeg', 0.95);
    });
}

// --------------------------------------------------------
// 4. Biometric Scan (Verification)
// --------------------------------------------------------
async function triggerVerification() {
    if (statusPanel.classList.contains('scanning')) return; // Prevent double trigger
    
    updateStatus('AURA_SCAN', 'ACQUIRING BIOMETRIC FEED - DO NOT MOVE', 'scanning');
    speak("Scanning biometric feed.");
    
    const blob = await captureFrame();
    if (!blob) {
        updateStatus('SCAN_FAIL', 'BIOMETRIC STREAM FAULT', 'denied');
        speak("Biometric link failure. No face detected.");
        return;
    }
    
    const formData = new FormData();
    formData.append('file', blob, 'scan.jpg');
    
    try {
        const response = await fetch(`${API_BASE}/recognize`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const data = await response.json();
        handleScanResult(data);
    } catch (err) {
        console.error("Scan error:", err);
        updateStatus('LINK_FAIL', 'COMMUNICATION FAULT - PROTOCOL TIMEOUT', 'denied');
        speak("Biometric link failure.");
    }
}

function handleScanResult(data) {
    if (data.status === 'success') {
        const isMatched = data.match;
        const name = data.name;
        const analysis = data.analysis;
        
        // Update Status indicator
        if (isMatched) {
            updateStatus('ACCESS_GRANTED', `IDENTITY CONFIRMED: ${name}`, 'verified');
            // Pronounce identification voice announcement
            speak(`Access granted. Identity verified as ${name}. Estimated age: ${analysis.age}. Dominant emotion: ${analysis.emotion}.`);
        } else {
            updateStatus('ACCESS_DENIED', 'IDENTITY UNKNOWN - SECURE LOG CREATED', 'denied');
            speak("Access denied. Identity unrecognized.");
        }
        
        // Update Demographic UI
        updateDemographicsUI(name, isMatched, analysis, data.timestamp);
        
        // Refresh Audit logs
        fetchHistoryLogs();
    } else {
        updateStatus('SCAN_FAIL', 'IMAGE ACQUISITION FAILED', 'denied');
        speak("Biometric link failure. Face not detected.");
    }
}

// --------------------------------------------------------
// 5. Subject Registration (Enrollment)
// --------------------------------------------------------
async function triggerEnrollment() {
    const nameInput = document.getElementById('enroll-name');
    const name = nameInput.value.trim();
    
    if (!name) {
        speak("Name identifier required.");
        alert("Please enter a Subject Identifier/Name.");
        return;
    }
    
    updateStatus('AURA_ENROLL', `ENROLLING SUBJECT [${name.toUpperCase()}] - KEEP STILL`, 'scanning');
    speak(`Registering new subject. Please look directly into the scanner.`);
    
    const blob = await captureFrame();
    if (!blob) {
        updateStatus('SCAN_FAIL', 'BIOMETRIC STREAM FAULT', 'denied');
        speak("Biometric link failure. No face detected.");
        return;
    }
    
    const formData = new FormData();
    formData.append('name', name);
    formData.append('file', blob, 'enroll.jpg');
    
    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            updateStatus('ENROLL_OK', `SUCCESSFULLY ENROLLED: ${name.toUpperCase()}`, 'verified');
            speak(`Enrollment complete. Subject ${name} registered successfully.`);
            nameInput.value = '';
            
            // Auto switch back to verify mode after 2.5s
            setTimeout(() => {
                setMode('verify');
            }, 2500);
            
            fetchHistoryLogs();
        } else {
            const errorMsg = data.detail || "No face detected.";
            updateStatus('ENROLL_FAIL', `VERIFICATION ERROR: ${errorMsg.toUpperCase()}`, 'denied');
            speak(`Enrollment failed. ${errorMsg}`);
        }
    } catch (err) {
        console.error("Enrollment error:", err);
        updateStatus('LINK_FAIL', 'COMMUNICATION FAULT - PROTOCOL TIMEOUT', 'denied');
        speak("Biometric link failure.");
    }
}

// --------------------------------------------------------
// 6. UI Updates and Helpers
// --------------------------------------------------------
function updateStatus(code, msg, styleClass) {
    // Clear styles
    statusPanel.className = 'scanner-status-panel';
    
    statusCode.textContent = code;
    statusMessage.textContent = msg;
    
    if (styleClass) {
        statusPanel.classList.add(styleClass);
    }
}

function updateDemographicsUI(name, isMatched, analysis, timestamp) {
    profileName.textContent = name;
    
    profileStatus.textContent = isMatched ? "VERIFIED" : "UNKNOWN";
    profileStatus.className = `status-tag ${isMatched ? 'verified' : 'unknown'}`;
    
    profileTime.textContent = `TIMESTAMP: ${timestamp.split(' ')[1]}`;
    profileAge.textContent = analysis.age || "N/A";
    
    profileGender.textContent = analysis.gender || "UNKNOWN";
    genderConfidence.style.width = analysis.gender !== 'Unknown' ? '100%' : '0%';
    
    // Update emotion bars
    const emotions = analysis.emotions || {};
    
    for (const key in emotionBars) {
        // deepface returns scores out of 100
        const score = emotions[key] !== undefined ? emotions[key] : 0;
        const percentage = Math.min(100, Math.max(0, Math.round(score)));
        
        emotionBars[key].fill.style.width = `${percentage}%`;
        emotionBars[key].pct.textContent = `${percentage}%`;
    }
}

// --------------------------------------------------------
// 7. Continuous Monitoring (Live Scan Toggle)
// --------------------------------------------------------
function toggleLiveScan(checkbox) {
    if (checkbox.checked) {
        // Start live interval
        liveScanInterval = setInterval(() => {
            triggerVerification();
        }, 10000); // Every 10s
        // Trigger first scan immediately
        triggerVerification();
    } else {
        // Stop interval
        if (liveScanInterval) {
            clearInterval(liveScanInterval);
            liveScanInterval = null;
        }
        updateStatus('AURA_READY', 'SYSTEM STANDBY - READY TO ACQUIRE LINK', '');
    }
}

// --------------------------------------------------------
// 8. History Log Loader
// --------------------------------------------------------
async function fetchHistoryLogs() {
    try {
        const response = await fetch(`${API_BASE}/history`);
        const history = await response.json();
        const logsList = document.getElementById('logs-list');
        
        if (!history || history.length === 0) {
            logsList.innerHTML = '<div class="empty-logs">NO SCAN EVENT DATA RECORDED</div>';
            return;
        }
        
        let logsHTML = '';
        history.forEach(entry => {
            const isVerified = entry.status === 'Verified';
            const attr = entry.attributes || {};
            const timeOnly = entry.timestamp.split(' ')[1];
            
            logsHTML += `
                <div class="log-item ${isVerified ? 'verified' : 'unknown'}">
                    <div class="log-info-left">
                        <span class="log-subject-name">${entry.name}</span>
                        <span class="log-meta-line">AGE: ${attr.age || '--'} | GENDER: ${attr.gender || '--'} | EMOTION: ${attr.emotion || '--'}</span>
                        <span class="log-meta-line" style="opacity: 0.6;">TIME: ${timeOnly}</span>
                    </div>
                    <div class="log-status-badge">
                        ${entry.status.toUpperCase()}
                    </div>
                </div>
            `;
        });
        
        logsList.innerHTML = logsHTML;
    } catch (err) {
        console.error("Failed to load logs:", err);
    }
}

// --------------------------------------------------------
// Page load triggers
// --------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    startClock();
    setupWebcam();
    fetchHistoryLogs();
    
    // Trigger audio greeting when speech synthesis voices are loaded
    if ('speechSynthesis' in window) {
        // Chrome loads voices asynchronously
        window.speechSynthesis.onvoiceschanged = () => {
            speak("AURA neural identity protocol online.");
            // Reset to prevent double greeting on subsequent state changes
            window.speechSynthesis.onvoiceschanged = null;
        };
        // Fallback for Safari/Firefox
        setTimeout(() => {
            speak("AURA neural identity protocol online.");
        }, 1000);
    }
});
