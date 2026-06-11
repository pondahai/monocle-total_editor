// Monocle Companion Coach - Sidebar JS Engine
const API_BASE = "http://localhost:8000/api";

let activeProjectId = null;
let activeOutlineNodeId = null;
let activeTaskId = null;
let timerState = { is_running: false, remaining_seconds: 1200 };

let audioCtx = null;
let confettiParticles = [];
let confettiAnimationId = null;

document.addEventListener("DOMContentLoaded", () => {
    initSidebar();
    setupEventListeners();
    startPollingState();
});

// ==========================================
// 1. Initialization
// ==========================================
async function initSidebar() {
    await checkApiConnection();
    await loadProjectsDropdown();
}

function setupEventListeners() {
    // Timer Toggle
    document.getElementById("btn-timer-toggle").addEventListener("click", handleTimerToggle);
    document.getElementById("btn-timer-reset").addEventListener("click", handleTimerReset);

    // Complete Task
    document.getElementById("btn-complete-task").addEventListener("click", handleTaskComplete);

    // Dropdown Change Handler
    document.getElementById("project-select").addEventListener("change", handleProjectSelectChange);
    document.getElementById("chapter-select").addEventListener("change", handleChapterSelectChange);

    // Refresh Materials
    document.getElementById("btn-refresh-materials").addEventListener("click", loadActiveMaterials);

    // Text Actions
    document.getElementById("btn-grab-text").addEventListener("click", grabPageSelection);
    document.getElementById("btn-polish").addEventListener("click", polishSelectionText);
    document.getElementById("btn-insert-text").addEventListener("click", insertTextBackToPage);
}

// ==========================================
// 2. State Polling & Synchronization
// ==========================================
async function checkApiConnection() {
    const dot = document.getElementById("api-status-dot");
    try {
        const res = await fetch(`${API_BASE}/state`);
        if (res.ok) {
            dot.className = "status-dot online";
            return true;
        }
    } catch (e) {
        dot.className = "status-dot"; // offline
    }
    return false;
}

function startPollingState() {
    // 每 1.5 秒輪詢後端狀態機，與全局（Web Dashboard）維持單一事實來源同步
    setInterval(async () => {
        const isOnline = await checkApiConnection();
        if (isOnline) {
            await syncState();
        }
    }, 1500);
}

async function syncState() {
    try {
        const res = await fetch(`${API_BASE}/state`);
        const data = await res.json();
        
        // 偵測專案是否變更
        const projectChanged = data.active_project_id !== activeProjectId;
        const chapterChanged = data.active_outline_node_id !== activeOutlineNodeId;
        const taskChanged = data.active_task_id !== activeTaskId;
        
        activeProjectId = data.active_project_id === "null" ? null : data.active_project_id;
        activeOutlineNodeId = data.active_outline_node_id === "null" ? null : data.active_outline_node_id;
        activeTaskId = data.active_task_id === "null" ? null : data.active_task_id;
        timerState = data.timer;
        
        // 更新計時器介面
        updateTimerUI();
        
        // 更新活躍任務與完成按鈕
        const taskTitleEl = document.getElementById("active-task-title");
        const completeBtn = document.getElementById("btn-complete-task");
        
        if (activeTaskId) {
            taskTitleEl.innerText = "載入任務中...";
            taskTitleEl.classList.add("text-cyan");
            completeBtn.classList.remove("hidden");
            // 異步查尋任務名稱
            queryActiveTaskName(activeTaskId);
        } else {
            taskTitleEl.innerText = "未選擇聚焦任務";
            taskTitleEl.classList.remove("text-cyan");
            completeBtn.classList.add("hidden");
        }

        // 同步下拉選單選取狀態 (若從外部變更)
        const projSelect = document.getElementById("project-select");
        if (projSelect.value !== (activeProjectId || "")) {
            projSelect.value = activeProjectId || "";
            if (activeProjectId) {
                await loadChaptersDropdown(activeProjectId);
            }
        }
        
        const chapSelect = document.getElementById("chapter-select");
        if (chapSelect.value !== (activeOutlineNodeId || "")) {
            if (activeProjectId) {
                // 如果章節變更，重新加載章節下拉
                if (projectChanged) {
                    await loadChaptersDropdown(activeProjectId);
                }
                chapSelect.value = activeOutlineNodeId || "";
            } else {
                chapSelect.innerHTML = '<option value="">請先選擇專案</option>';
            }
        }

        // 當大綱章節有變更時，自動重新載入該章節材料
        if (chapterChanged || projectChanged) {
            await loadActiveMaterials();
        }
        
    } catch(e) {}
}

async function queryActiveTaskName(taskId) {
    if (!activeProjectId) return;
    try {
        const res = await fetch(`${API_BASE}/projects/${activeProjectId}`);
        const data = await res.json();
        const task = data.tasks.find(t => t.id === taskId);
        if (task) {
            document.getElementById("active-task-title").innerText = task.title;
        }
    } catch (e) {}
}

// ==========================================
// 3. UI Updates (Timer & Dropdowns)
// ==========================================
function updateTimerUI() {
    const remaining = timerState.remaining_seconds;
    const total = timerState.original_remaining_seconds || 1200;
    
    // 數字顯示
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    document.getElementById("timer-display").innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    // SVG Progress
    const circle = document.getElementById("timer-progress");
    const circumference = 282.7;
    const ratio = remaining / total;
    const offset = circumference * (1 - ratio);
    circle.style.strokeDashoffset = offset;
    
    // Button Icon
    const icon = document.querySelector("#btn-timer-toggle i");
    if (timerState.is_running) {
        icon.className = "fa-solid fa-pause";
    } else {
        icon.className = "fa-solid fa-play";
    }
}

async function loadProjectsDropdown() {
    const select = document.getElementById("project-select");
    select.innerHTML = '<option value="">請選擇專案...</option>';
    
    try {
        const res = await fetch(`${API_BASE}/projects`);
        const projects = await res.json();
        
        projects.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.text = p.name;
            select.appendChild(opt);
        });
        
        if (activeProjectId) {
            select.value = activeProjectId;
            await loadChaptersDropdown(activeProjectId);
        }
    } catch (e) {
        select.innerHTML = '<option value="">連線錯誤</option>';
    }
}

async function loadChaptersDropdown(projectId) {
    const select = document.getElementById("chapter-select");
    select.innerHTML = '<option value="">請選擇章節...</option>';
    
    if (!projectId) {
        select.innerHTML = '<option value="">請先選擇專案</option>';
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/projects/${projectId}`);
        const data = await res.json();
        
        data.outlines.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o.id;
            opt.text = o.title;
            select.appendChild(opt);
        });
        
        if (activeOutlineNodeId) {
            select.value = activeOutlineNodeId;
        }
    } catch (e) {
        select.innerHTML = '<option value="">載入失敗</option>';
    }
}

// ==========================================
// 4. API Event Actions
// ==========================================
async function handleProjectSelectChange(e) {
    const pid = e.target.value;
    try {
        const res = await fetch(`${API_BASE}/state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_project_id: pid || "null" })
        });
        const newState = await res.json();
        handleStateSync(newState);
    } catch (err) {
        console.error("切換專案失敗:", err);
    }
}

async function handleChapterSelectChange(e) {
    const oid = e.target.value;
    try {
        const res = await fetch(`${API_BASE}/state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_outline_node_id: oid || "null" })
        });
        const newState = await res.json();
        handleStateSync(newState);
    } catch (err) {
        console.error("切換章節失敗:", err);
    }
}

function handleStateSync(backendState) {
    activeProjectId = backendState.active_project_id === "null" ? null : backendState.active_project_id;
    activeOutlineNodeId = backendState.active_outline_node_id === "null" ? null : backendState.active_outline_node_id;
    activeTaskId = backendState.active_task_id === "null" ? null : backendState.active_task_id;
    timerState = backendState.timer;
    updateTimerUI();
}

async function handleTimerToggle() {
    const action = timerState.is_running ? "pause" : "start";
    try {
        const res = await fetch(`${API_BASE}/timer/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action })
        });
        const newState = await res.json();
        handleStateSync(newState);
    } catch (e) {}
}

async function handleTimerReset() {
    try {
        const res = await fetch(`${API_BASE}/timer/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reset", duration_seconds: 1200 })
        });
        const newState = await res.json();
        handleStateSync(newState);
    } catch (e) {}
}

async function handleTaskComplete() {
    if (!activeTaskId) return;
    try {
        const res = await fetch(`${API_BASE}/tasks/${activeTaskId}/complete`, {
            method: "POST"
        });
        const result = await res.json();
        if (result.dopamine_trigger) {
            playDopamineChime();
            triggerConfettiExplosion();
            
            // 重設活躍任務與隱藏按鈕
            activeTaskId = null;
            document.getElementById("btn-complete-task").classList.add("hidden");
            document.getElementById("active-task-title").innerText = "任務完成！";
            
            // 同步一次狀態
            await syncState();
        }
    } catch (e) {}
}

// ==========================================
// 5. RAG Materials & Editor Polish
// ==========================================
async function loadActiveMaterials() {
    const container = document.getElementById("materials-container");
    container.innerHTML = "";
    
    if (!activeProjectId || !activeOutlineNodeId) {
        container.innerHTML = '<div class="empty-state">選擇章節後自動撈取關聯素材</div>';
        return;
    }
    
    try {
        // 利用大綱章節為參數直接呼叫搜尋，空查詢會回傳當前章節的錨定材料
        const res = await fetch(
            `${API_BASE}/materials/retrieve?project_id=${activeProjectId}&outline_node_id=${activeOutlineNodeId}&query=&top_k=3`
        );
        const data = await res.json();
        
        if (data.length === 0) {
            container.innerHTML = '<div class="empty-state">此章節尚未錨定任何參考材料。</div>';
            return;
        }

        data.forEach(item => {
            const card = document.createElement("div");
            card.className = "material-item";
            card.innerHTML = `
                <div class="title">
                    <span><i class="fa-solid fa-file-lines"></i> ${item.metadata.filename}</span>
                    <span class="score">錨定</span>
                </div>
                <div>${item.metadata.text}</div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        container.innerHTML = '<div class="empty-state">獲取參考材料失敗。</div>';
    }
}

// 抓取網頁目前選取的文字
function grabPageSelection() {
    // 發信號給 Background Script 請求抓取網頁反白文字
    chrome.runtime.sendMessage({ action: "get_selection" }, (response) => {
        if (response && response.text) {
            document.getElementById("draft-input").value = response.text;
        } else {
            alert("請先在打開的網頁上，用滑鼠反白（選取）一段文字草稿，然後再次點擊此按鈕！");
        }
    });
}

// 一鍵 AI 潤飾選取的文字
async function polishSelectionText() {
    const text = document.getElementById("draft-input").value;
    if (!text.trim()) {
        alert("請先輸入或點擊「抓取網頁選取」載入文字草稿！");
        return;
    }
    
    if (!activeProjectId || !activeOutlineNodeId) {
        alert("請先在上面選擇目前寫作的專案與大綱章節！");
        return;
    }
    
    const btn = document.getElementById("btn-polish");
    const resultBox = document.getElementById("polished-output");
    const wrapper = document.getElementById("result-box-wrapper");
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 潤飾中...';
    resultBox.innerText = "AI 正在從本機向量空間檢索相關材料並套用文風潤飾...請稍候...";
    wrapper.classList.remove("hidden");

    try {
        const res = await fetch(`${API_BASE}/editor/polish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: activeProjectId,
                outline_node_id: activeOutlineNodeId,
                draft_text: text
            })
        });
        const data = await res.json();
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> 一鍵潤飾';
        
        resultBox.innerText = data.polished_content;
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> 一鍵潤飾';
        resultBox.innerText = "潤飾連線出錯，請確認後端伺服器是否在本地 Port 8000 啟動中。";
    }
}

// 填回網頁輸入框
function insertTextBackToPage() {
    const text = document.getElementById("polished-output").innerText;
    if (!text) return;
    
    chrome.runtime.sendMessage({ action: "insert_text", text: text }, (response) => {
        if (response && response.success) {
            // 提示成功淡出
            alert("成功將潤飾文字填回網頁！");
        } else if (response && response.error) {
            alert(response.error);
        }
    });
}

// ==========================================
// 6. Dopamine Web Audio Chime Synthesis
// ==========================================
function playDopamineChime() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const now = audioCtx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        
        notes.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.type = index % 2 === 0 ? "sine" : "triangle";
            osc.frequency.setValueAtTime(freq, now + index * 0.08);
            
            gain.gain.setValueAtTime(0, now + index * 0.08);
            gain.gain.linearRampToValueAtTime(0.25, now + index * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.4);
            
            osc.start(now + index * 0.08);
            osc.stop(now + index * 0.08 + 0.5);
        });
    } catch (e) {}
}

// ==========================================
// 7. Confetti Particle System
// ==========================================
function triggerConfettiExplosion() {
    const canvas = document.getElementById("confetti-canvas");
    const ctx = canvas.getContext("2d");
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    confettiParticles = [];
    const colors = ["#a855f7", "#ec4899", "#06b6d4", "#f59e0b", "#10b981"];
    
    for (let i = 0; i < 40; i++) {
        confettiParticles.push({
            x: canvas.width / 2,
            y: canvas.height + 5,
            angle: Math.random() * Math.PI - Math.PI,
            speed: Math.random() * 8 + 6,
            radius: Math.random() * 3 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * 360,
            rotationSpeed: Math.random() * 6 - 3,
            gravity: 0.2,
            friction: 0.97,
            opacity: 1
        });
    }
    
    if (confettiAnimationId) {
        cancelAnimationFrame(confettiAnimationId);
    }
    animateConfetti(canvas, ctx);
}

function animateConfetti(canvas, ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let activeParticles = 0;
    
    confettiParticles.forEach(p => {
        if (p.opacity <= 0) return;
        activeParticles++;
        
        p.speed *= p.friction;
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed + p.gravity;
        p.rotation += p.rotationSpeed;
        p.opacity -= 0.015;
        
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillRect(-p.radius, -p.radius, p.radius * 2, p.radius * 2);
        ctx.restore();
    });
    
    if (activeParticles > 0) {
        confettiAnimationId = requestAnimationFrame(() => animateConfetti(canvas, ctx));
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}
