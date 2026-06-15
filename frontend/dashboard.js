/* ==========================================================================
   Monocle Workspace Controller - Core JS Engine
   ========================================================================== */

const API_BASE = "http://localhost:8000/api";

// Global Frontend State
let state = {
    activeProjectId: null,
    activeOutlineNodeId: null,
    coachLoadedOutlineNodeId: null,
    activeTaskId: null,
    timer: {
        is_running: false,
        remaining_seconds: 1200,
        original_remaining_seconds: 1200
    },
    projects: [],
    outlines: [],
    dailyTasks: []
};

// Web Audio API Context for Chime Synthesis
let audioCtx = null;

// Confetti Physics State
let confettiParticles = [];
let confettiAnimationId = null;

document.addEventListener("DOMContentLoaded", () => {
    initApp();
    setupEventListeners();
    startPolling();
});

// ==========================================
// 1. App Initialization
// ==========================================
async function initApp() {
    // 載入專案選單
    await refreshProjects();
    
    // 初始化同步全域狀態
    await syncStateWithBackend();
    
    // 預設切換至 Workspace 標籤頁
    switchTab("workspace");

    // 初始化互動引導嚮導
    initOnboardingTour();
}

function setupEventListeners() {
    // 導航 Tab 切換
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const tabName = e.currentTarget.getAttribute("data-tab");
            switchTab(tabName);
        });
    });

    // 全局專案切換下拉選單
    document.getElementById("global-project-select").addEventListener("change", async (e) => {
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
    });

    // 計時器控制
    document.getElementById("btn-timer-toggle").addEventListener("click", toggleTimer);
    document.getElementById("btn-timer-reset").addEventListener("click", resetTimer);

    // 專案管理 - 建立新專案
    document.getElementById("form-create-project").addEventListener("submit", handleCreateProject);

    // 專案管理 - 新增章節大綱
    document.getElementById("form-add-outline").addEventListener("submit", handleAddOutline);

    // 大綱拆解 Modal 開關
    document.getElementById("btn-open-decompose-modal").addEventListener("click", openDecomposeModal);
    document.getElementById("btn-close-decompose-modal").addEventListener("click", closeDecomposeModal);
    document.getElementById("btn-cancel-decompose").addEventListener("click", closeDecomposeModal);
    document.getElementById("btn-execute-decompose").addEventListener("click", handleDecomposeOutline);

    // 今日聚焦排程 - 重新整理
    document.getElementById("btn-refresh-schedule").addEventListener("click", refreshDailySchedule);

    // 背景知識庫 - 專案選擇連動大綱選擇
    document.getElementById("material-project-select").addEventListener("change", (e) => {
        populateMaterialOutlineDropdown(e.target.value);
    });

    // 背景知識庫 - 上傳材料
    document.getElementById("form-ingest-material").addEventListener("submit", handleIngestMaterial);

    // 背景知識庫 - 本地 RAG 檢索測試
    document.getElementById("btn-test-search").addEventListener("click", handleSearchMaterials);

    // 寫作工作區 - 重新整理大綱
    document.getElementById("btn-refresh-outlines").addEventListener("click", async () => {
        if (state.activeProjectId) {
            await refreshProjectDetails(state.activeProjectId);
        }
    });

    // 寫作工作區 - 儲存草稿
    document.getElementById("btn-save-draft").addEventListener("click", saveDraftText);
    
    // 寫作工作區 - AI 一鍵潤飾
    document.getElementById("btn-polish-draft").addEventListener("click", polishDraftText);
    
    // 寫作工作區 - 採納 AI 潤飾內容
    document.getElementById("btn-apply-polished").addEventListener("click", applyPolishedText);
    document.getElementById("btn-append-polished").addEventListener("click", appendPolishedText);

    // 寫作工作區 - AI 寫作教練
    document.getElementById("btn-open-coach").addEventListener("click", toggleCoachPanel);
    document.getElementById("btn-close-coach").addEventListener("click", () => {
        document.getElementById("ai-coach-panel").classList.add("hidden");
    });
    document.getElementById("btn-reload-coach").addEventListener("click", () => loadCoachQuestions(true));
    document.getElementById("btn-fuse-answers").addEventListener("click", fuseCoachAnswers);
}

// ==========================================
// 2. Tab Navigation
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.remove("active");
        if (btn.getAttribute("data-tab") === tabId) {
            btn.classList.add("active");
        }
    });

    document.querySelectorAll(".tab-pane").forEach(pane => {
        pane.classList.remove("active");
    });
    
    const targetPane = document.getElementById(`tab-${tabId}`);
    if (targetPane) targetPane.classList.add("active");

    // 切換 Tab 時的特定載入邏輯
    if (tabId === "workspace") {
        renderWorkspaceOutlines();
        loadActiveChapterDraft();
    } else if (tabId === "projects") {
        renderProjectList();
    } else if (tabId === "scheduler") {
        refreshDailySchedule();
    } else if (tabId === "materials") {
        refreshMaterialsTab();
    }
}

// ==========================================
// 3. API & State Synchronization (Single Source of Truth)
// ==========================================
async function syncStateWithBackend() {
    try {
        const res = await fetch(`${API_BASE}/state`);
        const backendState = await res.json();
        handleStateSync(backendState);
    } catch (err) {
        console.error("狀態同步失敗:", err);
    }
}

function handleStateSync(backendState) {
    // 比對是否有重大切換，若有則重新載入大綱與排程
    const projectChanged = backendState.active_project_id !== state.activeProjectId;
    
    state.activeProjectId = backendState.active_project_id === "null" ? null : backendState.active_project_id;
    state.activeOutlineNodeId = backendState.active_outline_node_id === "null" ? null : backendState.active_outline_node_id;
    state.activeTaskId = backendState.active_task_id === "null" ? null : backendState.active_task_id;
    state.timer = backendState.timer;

    // 更新全局下拉選單選擇值
    document.getElementById("global-project-select").value = state.activeProjectId || "";

    // 同步計時器 UI
    updateTimerUI();

    // 更新 Sidebar 與 Header 上的文字
    updateGlobalTextUI();

    if (projectChanged && state.activeProjectId) {
        refreshProjectDetails(state.activeProjectId);
    }
}

function startPolling() {
    // 每 1.5 秒輪詢一次後端狀態機
    setInterval(syncStateWithBackend, 1500);
}

function updateGlobalTextUI() {
    const activeProj = state.projects.find(p => p.id === state.activeProjectId);
    const activeNode = state.outlines.find(o => o.id === state.activeOutlineNodeId);
    
    // 側邊欄專案名稱
    document.getElementById("sidebar-active-project-name").innerText = activeProj ? activeProj.name : "無活躍專案";
    document.getElementById("sidebar-active-project-desc").innerText = activeProj ? (activeProj.description || "無專案描述") : "請至專案管理建立或選擇專案";
    document.getElementById("sidebar-active-chapter-name").innerText = activeNode ? activeNode.title : "無活躍章節";

    // 計時器區塊任務名稱
    const timerTaskTitle = document.getElementById("active-task-title");
    if (state.activeTaskId) {
        // 先在今日任務內找，找不到去當前專案的任務清單找
        fetch(`${API_BASE}/state`) // 重新抓取或本地緩存
        timerTaskTitle.innerText = "微任務計時中...";
        // 異步撈取名稱
        dbQueryTaskName(state.activeTaskId);
    } else {
        timerTaskTitle.innerText = "未選擇任務";
        timerTaskTitle.classList.remove("text-cyan");
    }
}

async function dbQueryTaskName(taskId) {
    if (!taskId) return;
    try {
        const res = await fetch(`${API_BASE}/projects/${state.activeProjectId}`);
        const data = await res.json();
        const task = data.tasks.find(t => t.id === taskId);
        if (task) {
            const el = document.getElementById("active-task-title");
            el.innerText = task.title;
            el.classList.add("text-cyan");
        }
    } catch(e) {}
}

// ==========================================
// 4. Timer Logic
// ==========================================
function updateTimerUI() {
    const remaining = state.timer.remaining_seconds;
    const total = state.timer.original_remaining_seconds || 1200;
    
    // 1. 顯示數字分秒 (例如 20:00)
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    document.getElementById("timer-display").innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    // 2. SVG 圓環倒數
    const circle = document.getElementById("timer-progress");
    const circumference = 282.7; // 2 * PI * 45
    const ratio = remaining / total;
    const offset = circumference * (1 - ratio);
    circle.style.strokeDashoffset = offset;
    
    // 3. 按鈕 Icon 切換 (Play/Pause)
    const btnIcon = document.querySelector("#btn-timer-toggle i");
    if (state.timer.is_running) {
        btnIcon.className = "fa-solid fa-pause";
    } else {
        btnIcon.className = "fa-solid fa-play";
    }
}

async function toggleTimer() {
    const action = state.timer.is_running ? "pause" : "start";
    try {
        const res = await fetch(`${API_BASE}/timer/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action })
        });
        const newState = await res.json();
        handleStateSync(newState);
    } catch (err) {
        console.error("控制計時器失敗:", err);
    }
}

async function resetTimer() {
    try {
        const res = await fetch(`${API_BASE}/timer/control`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reset", duration_seconds: 1200 })
        });
        const newState = await res.json();
        handleStateSync(newState);
    } catch (err) {
        console.error("重設計時器失敗:", err);
    }
}

// ==========================================
// 5. Project Management
// ==========================================
async function refreshProjects() {
    try {
        const res = await fetch(`${API_BASE}/projects`);
        state.projects = await res.json();
        
        // 更新所有的專案 Select 下拉選單
        const select = document.getElementById("global-project-select");
        const materialSelect = document.getElementById("material-project-select");
        
        // 清空 (只留第一個)
        select.innerHTML = '<option value="">請選擇專案...</option>';
        materialSelect.innerHTML = '<option value="">請選擇專案...</option>';
        
        state.projects.forEach(p => {
            const opt1 = document.createElement("option");
            opt1.value = p.id;
            opt1.text = p.name;
            select.appendChild(opt1);
            
            const opt2 = document.createElement("option");
            opt2.value = p.id;
            opt2.text = p.name;
            materialSelect.appendChild(opt2);
        });
    } catch (err) {
        console.error("獲取專案清單失敗:", err);
    }
}

async function handleCreateProject(e) {
    e.preventDefault();
    const name = document.getElementById("proj-name").value;
    const description = document.getElementById("proj-desc").value;
    const persona_prompt = document.getElementById("proj-persona").value;
    let deadline = document.getElementById("proj-deadline").value;

    if (deadline) {
        deadline = new Date(deadline).toISOString();
    } else {
        deadline = null;
    }

    try {
        const res = await fetch(`${API_BASE}/projects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, persona_prompt, deadline })
        });
        if (res.status === 201) {
            document.getElementById("form-create-project").reset();
            await refreshProjects();
            renderProjectList();
            
            // 互動引導嚮導步驟 1 自動跳轉至步驟 2
            if (typeof currentTourStep !== "undefined" && currentTourStep === 1) {
                setTimeout(() => goToTourStep(2), 500);
            }
        }
    } catch (err) {
        console.error("建立專案失敗:", err);
    }
}

async function refreshProjectDetails(projectId) {
    if (!projectId) return;
    try {
        const res = await fetch(`${API_BASE}/projects/${projectId}`);
        const data = await res.json();
        state.outlines = data.outlines || [];
        
        // 渲染章節目錄
        renderWorkspaceOutlines();
    } catch (err) {
        console.error("獲取專案詳情失敗:", err);
    }
}

function renderProjectList() {
    const grid = document.getElementById("project-list-grid");
    grid.innerHTML = "";
    
    if (state.projects.length === 0) {
        grid.innerHTML = '<div class="empty-state">尚無任何寫作專案，請在左側表單建立。</div>';
        return;
    }

    state.projects.forEach(p => {
        const card = document.createElement("div");
        card.className = `project-card glass-card ${state.activeProjectId === p.id ? 'active-project' : ''}`;
        
        const deadlineStr = p.deadline ? new Date(p.deadline).toLocaleDateString() : "無截止日";
        
        card.innerHTML = `
            <div class="project-card-actions">
                <button class="btn-icon btn-delete" data-id="${p.id}" title="刪除專案"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <h3>${p.name}</h3>
            <p>${p.description || "沒有描述。"}</p>
            <div class="project-meta-row">
                <span>建立時間: ${new Date(p.created_at).toLocaleDateString()}</span>
                <span class="text-pink">截止日: ${deadlineStr}</span>
            </div>
        `;
        
        // 點擊卡片切換活躍專案
        card.addEventListener("click", (e) => {
            // 如果點擊到刪除按鈕，不觸發切換
            if (e.target.closest(".btn-delete")) return;
            selectActiveProject(p.id);
        });
        
        // 刪除按鈕事件
        card.querySelector(".btn-delete").addEventListener("click", async (e) => {
            e.stopPropagation();
            if (confirm(`確定要完全刪除「${p.name}」專案嗎？這會清除其本地資料庫記錄與該專案專屬的物理向量空間！`)) {
                await deleteProject(p.id);
            }
        });

        grid.appendChild(card);
    });

    // 如果當前有活躍專案，同步顯示大綱管理面板
    const outlinePanel = document.getElementById("project-outline-manager-panel");
    if (state.activeProjectId) {
        outlinePanel.classList.remove("hidden");
        const activeProj = state.projects.find(p => p.id === state.activeProjectId);
        document.getElementById("outline-manager-title").innerText = `《${activeProj.name}》章節大綱管理`;
        renderProjectOutlinesTable();
    } else {
        outlinePanel.classList.add("hidden");
    }
}

async function selectActiveProject(projectId) {
    try {
        const res = await fetch(`${API_BASE}/state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_project_id: projectId })
        });
        const newState = await res.json();
        handleStateSync(newState);
        renderProjectList();
    } catch (err) {
        console.error("選擇專案失敗:", err);
    }
}

async function deleteProject(projectId) {
    try {
        const res = await fetch(`${API_BASE}/projects/${projectId}`, {
            method: "DELETE"
        });
        if (res.ok) {
            await refreshProjects();
            if (state.activeProjectId === projectId) {
                state.activeProjectId = null;
                state.outlines = [];
            }
            renderProjectList();
        }
    } catch (err) {
        console.error("刪除專案錯誤:", err);
    }
}

// ==========================================
// 6. Outline & Chapter Management
// ==========================================
async function handleAddOutline(e) {
    e.preventDefault();
    if (!state.activeProjectId) return;
    
    const title = document.getElementById("outline-title").value;
    const sort_order = parseInt(document.getElementById("outline-order").value) || 0;

    try {
        const res = await fetch(`${API_BASE}/outlines`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: state.activeProjectId,
                title: title,
                sort_order: sort_order
            })
        });
        if (res.status === 201) {
            document.getElementById("form-add-outline").reset();
            await refreshProjectDetails(state.activeProjectId);
            renderProjectOutlinesTable();
            
            // 互動引導嚮導步驟 2 自動跳轉至步驟 3
            if (typeof currentTourStep !== "undefined" && currentTourStep === 2) {
                setTimeout(() => goToTourStep(3), 500);
            }
        }
    } catch (err) {
        console.error("新增章節失敗:", err);
    }
}

function renderProjectOutlinesTable() {
    const tbody = document.getElementById("project-outlines-table-body");
    tbody.innerHTML = "";
    
    if (state.outlines.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding:20px;">此專案尚未建立大綱。請在上方輸入章節名稱。</td></tr>';
        return;
    }

    state.outlines.forEach(o => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${o.sort_order}</td>
            <td><strong>${o.title}</strong></td>
            <td><span class="status-badge ${o.status}">${o.status}</span></td>
            <td>${new Date(o.created_at).toLocaleDateString()}</td>
            <td>
                <button class="btn-sm btn-secondary btn-set-active" data-id="${o.id}"><i class="fa-solid fa-feather-pointed"></i> 寫作</button>
            </td>
        `;
        
        tr.querySelector(".btn-set-active").addEventListener("click", async () => {
            try {
                const res = await fetch(`${API_BASE}/state`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ active_outline_node_id: o.id })
                });
                const newState = await res.json();
                handleStateSync(newState);
                switchTab("workspace");
            } catch (err) {
                console.error("選取章節失敗:", err);
            }
        });
        
        tbody.appendChild(tr);
    });
}

// 渲染 Workspace 左側章節目錄
function renderWorkspaceOutlines() {
    const list = document.getElementById("workspace-outline-list");
    list.innerHTML = "";
    
    if (!state.activeProjectId) {
        list.innerHTML = '<div class="empty-state">請先至「專案管理」<br>建立或選定專案</div>';
        return;
    }
    
    if (state.outlines.length === 0) {
        list.innerHTML = '<div class="empty-state">此專案尚無章節目錄，<br>請至專案管理分頁新增。</div>';
        return;
    }

    state.outlines.forEach(o => {
        const btn = document.createElement("button");
        btn.className = `outline-item-btn ${state.activeOutlineNodeId === o.id ? 'active' : ''}`;
        btn.innerHTML = `
            <span>${o.title}</span>
            <span class="status-tag ${o.status}">${o.status}</span>
        `;
        
        btn.addEventListener("click", async () => {
            try {
                const res = await fetch(`${API_BASE}/state`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ active_outline_node_id: o.id })
                });
                const newState = await res.json();
                handleStateSync(newState);
                renderWorkspaceOutlines();
                loadActiveChapterDraft();
            } catch (e) {}
        });

        list.appendChild(btn);
    });
}

// 載入當前活躍章節草稿至 TextArea
async function loadActiveChapterDraft() {
    const textarea = document.getElementById("draft-textarea");
    const chapterTitle = document.getElementById("editor-current-chapter-title");
    const statusBadge = document.getElementById("chapter-status-badge");
    
    // 初始化清空
    textarea.value = "";
    chapterTitle.innerText = "請選擇章節開始寫作";
    statusBadge.className = "status-badge";
    statusBadge.innerText = "NONE";
    
    if (!state.activeOutlineNodeId) return;

    const activeNode = state.outlines.find(o => o.id === state.activeOutlineNodeId);
    if (activeNode) {
        chapterTitle.innerText = activeNode.title;
        textarea.value = activeNode.content || "";
        statusBadge.innerText = activeNode.status.toUpperCase();
        statusBadge.className = `status-badge ${activeNode.status}`;
        
        // 切換章節時，自動觸發一次材料推薦（依據目前章節或草稿）
        await fetchRAGContextMaterials(activeNode.content);

        // 如果引導教練面板正開啟，重新載入引導問題
        if (!document.getElementById("ai-coach-panel").classList.contains("hidden")) {
            await loadCoachQuestions();
        }
    }
}

// 儲存原始草稿 (無壓力草稿模式)
async function saveDraftText() {
    if (!state.activeOutlineNodeId) {
        alert("請先在左側選定一個章節大綱！");
        return;
    }
    const text = document.getElementById("draft-textarea").value;
    
    try {
        const res = await fetch(`${API_BASE}/editor/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                outline_node_id: state.activeOutlineNodeId,
                draft_text: text
            })
        });
        if (res.ok) {
            // 重新整理詳情更新狀態
            await refreshProjectDetails(state.activeProjectId);
            const statusBadge = document.getElementById("chapter-status-badge");
            statusBadge.innerText = "WRITING";
            statusBadge.className = "status-badge writing";
            
            // 提示儲存成功 (微動畫)
            showToast("草稿暫存成功");
        }
    } catch(err) {
        console.error("儲存失敗:", err);
    }
}

// ==========================================
// 7. AI Writing Agent & Polish (RAG)
// ==========================================
async function polishDraftText() {
    if (!state.activeProjectId || !state.activeOutlineNodeId) {
        alert("請先選定專案與章節！");
        return;
    }
    
    const draftText = document.getElementById("draft-textarea").value;
    if (!draftText.trim()) {
        alert("請先在編輯器輸入草稿內容！");
        return;
    }

    const btn = document.getElementById("btn-polish-draft");
    const placeholder = document.getElementById("polish-placeholder");
    const resultWrapper = document.getElementById("polish-result-wrapper");
    const resultBox = document.getElementById("polished-text-box");
    
    // UI 轉為 Loading 狀態
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI 潤飾中...';
    placeholder.innerText = "AI 正在從該專案的向量空間檢索材料、套用 Persona 文風重構您的草稿...請稍候...";
    placeholder.classList.remove("hidden");
    resultWrapper.classList.add("hidden");

    try {
        const res = await fetch(`${API_BASE}/editor/polish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: state.activeProjectId,
                outline_node_id: state.activeOutlineNodeId,
                draft_text: draftText
            })
        });
        const data = await res.json();
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 一鍵潤飾 (AI)';
        placeholder.classList.add("hidden");
        
        // 渲染潤飾結果
        resultBox.innerText = data.polished_content;
        resultWrapper.classList.remove("hidden");
        
        // 如果使用的是 Mock，順便給予提醒
        if (data.polished_content.includes("離線模擬")) {
            showToast("本地 AI 離線，已啟用 Mock 降級模擬");
        }

        // 互動引導嚮導步驟 5 完成時，引導進入最後完成階段
        if (typeof currentTourStep !== "undefined" && currentTourStep === 5) {
            setTimeout(() => {
                navigateTour(1);
            }, 3000);
        }
    } catch (err) {
        console.error("AI 潤飾失敗:", err);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 一鍵潤飾 (AI)';
        placeholder.innerText = "潤飾失敗，請檢查本地 AI 連線。";
    }
}

function applyPolishedText() {
    const polishedText = document.getElementById("polished-text-box").innerText;
    document.getElementById("draft-textarea").value = polishedText;
    document.getElementById("polish-result-wrapper").classList.add("hidden");
    document.getElementById("polish-placeholder").classList.remove("hidden");
    document.getElementById("polish-placeholder").innerText = "已採納並覆蓋草稿。建議您隨時按「暫存草稿」保存！";
    
    const statusBadge = document.getElementById("chapter-status-badge");
    statusBadge.innerText = "POLISH";
    statusBadge.className = "status-badge polish";
}

function appendPolishedText() {
    const polishedText = document.getElementById("polished-text-box").innerText;
    const textarea = document.getElementById("draft-textarea");
    const existing = textarea.value.trim();
    if (existing) {
        textarea.value = existing + "\n\n" + polishedText;
    } else {
        textarea.value = polishedText;
    }
    document.getElementById("polish-result-wrapper").classList.add("hidden");
    document.getElementById("polish-placeholder").classList.remove("hidden");
    document.getElementById("polish-placeholder").innerText = "已採納並累加到尾端。建議您隨時按「暫存草稿」保存！";
    
    const statusBadge = document.getElementById("chapter-status-badge");
    statusBadge.innerText = "POLISH";
    statusBadge.className = "status-badge polish";
}

// 根據草稿內文，自動檢索 RAG 材料顯示在右邊
async function fetchRAGContextMaterials(text) {
    const container = document.getElementById("workspace-context-materials");
    container.innerHTML = "";
    
    if (!state.activeProjectId || !state.activeOutlineNodeId) {
        container.innerHTML = '<div class="empty-state">尚未選擇專案或章節</div>';
        return;
    }

    try {
        const res = await fetch(
            `${API_BASE}/materials/retrieve?project_id=${state.activeProjectId}&outline_node_id=${state.activeOutlineNodeId}&query=${encodeURIComponent(text || "")}&top_k=3`
        );
        const data = await res.json();
        
        if (data.length === 0) {
            container.innerHTML = '<div class="empty-state">此章節尚未錨定任何參考材料。<br>可至背景知識庫新增。</div>';
            return;
        }

        data.forEach(item => {
            const card = document.createElement("div");
            card.className = "context-chunk-card";
            card.innerHTML = `
                <div class="chunk-source">
                    <span><i class="fa-solid fa-file-lines"></i> ${item.metadata.filename}</span>
                    <span class="score">關聯度: ${(item.score * 100).toFixed(0)}%</span>
                </div>
                <div class="chunk-text">${item.metadata.text}</div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        container.innerHTML = '<div class="empty-state">獲取推薦材料失敗。</div>';
    }
}

// ==========================================
// 8. ADHD Timeline Scheduler
// ==========================================
async function refreshDailySchedule() {
    const container = document.getElementById("daily-task-timeline-container");
    container.innerHTML = "";
    
    const btn = document.getElementById("btn-refresh-schedule");
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 載入中...';

    try {
        const res = await fetch(`${API_BASE}/tasks/daily`);
        state.dailyTasks = await res.json();
        
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 重新排程';
        
        // 更新側邊欄排程徽章
        document.getElementById("daily-task-count").innerText = state.dailyTasks.length;
        
        if (state.dailyTasks.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding:60px 0;">
                    <i class="fa-solid fa-circle-check" style="font-size:48px; color:#10b981; margin-bottom:12px;"></i>
                    今天目前無聚焦微任務配盤！<br>
                    您可以點擊專案大綱進行「AI 拆解微任務」來為大綱生成子步驟。
                </div>`;
            return;
        }

        state.dailyTasks.forEach((task, idx) => {
            const isActive = state.activeTaskId === task.id;
            const item = document.createElement("div");
            item.className = `timeline-task-item ${isActive ? 'active-task' : ''}`;
            
            item.innerHTML = `
                <div class="timeline-marker"></div>
                <div class="timeline-content-card glass-card">
                    <div class="task-item-left">
                        <span class="task-project-tag">${task.project_name} • ${task.outline_title || '全局'}</span>
                        <h3 class="task-title">${task.title}</h3>
                        <span class="task-meta"><i class="fa-regular fa-clock"></i> 建議時間: ${task.duration_minutes} 分鐘 • 優先級權重: #${task.urgency_rank}</span>
                    </div>
                    <div class="task-item-right">
                        ${isActive 
                            ? `<button class="btn-secondary btn-pause-task" data-id="${task.id}"><i class="fa-solid fa-pause"></i> 暫停計時</button>`
                            : `<button class="btn-primary btn-start-task" data-id="${task.id}"><i class="fa-solid fa-play"></i> 啟動任務</button>`
                        }
                        <button class="btn-secondary btn-complete-task" data-id="${task.id}" title="完成此步驟"><i class="fa-solid fa-check text-pink"></i> 完成</button>
                    </div>
                </div>
            `;
            
            // 點擊啟動
            const startBtn = item.querySelector(".btn-start-task");
            if (startBtn) {
                startBtn.addEventListener("click", async () => {
                    await triggerTaskActive(task.id);
                });
            }

            // 點擊暫停
            const pauseBtn = item.querySelector(".btn-pause-task");
            if (pauseBtn) {
                pauseBtn.addEventListener("click", async () => {
                    await triggerTaskActive("null");
                });
            }

            // 點擊完成 (觸發多巴胺回饋)
            item.querySelector(".btn-complete-task").addEventListener("click", async () => {
                await triggerTaskComplete(task.id, task.title);
            });

            container.appendChild(item);
        });
    } catch (err) {
        console.error("更新聚焦流失敗:", err);
        btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> 重新排程';
    }
}

async function triggerTaskActive(taskId) {
    try {
        const res = await fetch(`${API_BASE}/state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active_task_id: taskId })
        });
        const newState = await res.json();
        handleStateSync(newState);
        await refreshDailySchedule();
    } catch (e) {}
}

async function triggerTaskComplete(taskId, taskTitle) {
    try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}/complete`, {
            method: "POST"
        });
        const result = await res.json();
        if (result.dopamine_trigger) {
            // 1. 播放極清脆的和弦多巴胺音效
            playDopamineChime();
            
            // 2. 觸發彩帶粒子爆炸
            triggerConfettiExplosion();
            
            // 3. 提示
            showToast(`恭喜完成任務！\n「${taskTitle}」`);
            
            // 4. 重新同步狀態並重新載入今日排程
            await syncStateWithBackend();
            await refreshDailySchedule();
        }
    } catch (e) {
        console.error("完成任務失敗:", e);
    }
}

// ==========================================
// 9. RAG Knowledge Materials Ingest
// ==========================================
async function refreshMaterialsTab() {
    // 重新整理專案下拉與現有材料表
    if (state.activeProjectId) {
        document.getElementById("material-project-select").value = state.activeProjectId;
        populateMaterialOutlineDropdown(state.activeProjectId);
    }
    await renderUploadedMaterialsList();
}

async function populateMaterialOutlineDropdown(projectId) {
    const dropdown = document.getElementById("material-outline-select");
    dropdown.innerHTML = '<option value="">全局材料 (不錨定章節)</option>';
    
    if (!projectId) return;
    
    try {
        const res = await fetch(`${API_BASE}/projects/${projectId}`);
        const data = await res.json();
        
        data.outlines.forEach(o => {
            const opt = document.createElement("option");
            opt.value = o.id;
            opt.text = o.title;
            dropdown.appendChild(opt);
        });
    } catch (e) {}
}

async function handleIngestMaterial(e) {
    e.preventDefault();
    const pid = document.getElementById("material-project-select").value;
    const oid = document.getElementById("material-outline-select").value || null;
    const filename = document.getElementById("material-filename").value;
    const content = document.getElementById("material-content").value;

    const btn = document.querySelector("#form-ingest-material button");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 進行向量切片寫入中...';

    try {
        const res = await fetch(`${API_BASE}/materials/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: pid,
                outline_node_id: oid,
                filename: filename,
                raw_content: content
            })
        });
        const result = await res.json();
        
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-import"></i> 寫入隔離向量庫';
        
        if (res.ok) {
            document.getElementById("form-ingest-material").reset();
            showToast("知識庫上傳成功且向量隔離已建立");
            await renderUploadedMaterialsList();
            
            // 互動引導嚮導步驟 4 自動跳轉至步驟 5
            if (typeof currentTourStep !== "undefined" && currentTourStep === 4) {
                setTimeout(() => goToTourStep(5), 500);
            }
        }
    } catch (err) {
        console.error("匯入知識庫失敗:", err);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-file-import"></i> 寫入隔離向量庫';
    }
}

async function renderUploadedMaterialsList() {
    const tbody = document.getElementById("materials-list-table-body");
    tbody.innerHTML = "";
    
    if (!state.activeProjectId) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state" style="padding:20px;">請先在左邊或上方選擇專案。</td></tr>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/projects/${state.activeProjectId}`);
        const data = await res.json();
        
        const materials = data.materials || [];
        const outlines = data.outlines || [];

        if (materials.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state" style="padding:20px;">此專案尚未上傳任何文獻。</td></tr>';
            return;
        }

        materials.forEach(m => {
            const tr = document.createElement("tr");
            const outlineNode = outlines.find(o => o.id === m.outline_node_id);
            const anchorName = outlineNode ? outlineNode.title : "全局材料";
            
            tr.innerHTML = `
                <td><strong>${m.filename}</strong></td>
                <td><span class="text-purple">${anchorName}</span></td>
                <td>${new Date(m.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn-sm btn-secondary btn-view-content" data-id="${m.id}"><i class="fa-regular fa-eye"></i> 檢視</button>
                </td>
            `;
            
            tr.querySelector(".btn-view-content").addEventListener("click", () => {
                alert(`材料正文內容：\n\n(此處預留檢視介面，您可以直接在 SQLite 查看此片段)`);
            });
            
            tbody.appendChild(tr);
        });
    } catch(e) {}
}

async function handleSearchMaterials() {
    const q = document.getElementById("material-search-query").value;
    const resultsContainer = document.getElementById("material-search-results");
    resultsContainer.innerHTML = "";
    
    if (!state.activeProjectId) {
        alert("請選擇活躍專案！");
        return;
    }
    if (!q.trim()) return;

    try {
        const res = await fetch(
            `${API_BASE}/materials/retrieve?project_id=${state.activeProjectId}&query=${encodeURIComponent(q)}&top_k=3`
        );
        const data = await res.json();
        
        if (data.length === 0) {
            resultsContainer.innerHTML = '<div class="empty-state">查無相似內容片段。</div>';
            return;
        }

        data.forEach(item => {
            const card = document.createElement("div");
            card.className = "context-chunk-card";
            card.innerHTML = `
                <div class="chunk-source">
                    <span>${item.metadata.filename} (${item.metadata.outline_node_id ? '章節錨定' : '全局'})</span>
                    <span class="score" style="background-color:rgba(168,85,247,0.1); color:var(--accent-purple);">相似度得分: ${item.boosted_score.toFixed(3)}</span>
                </div>
                <div class="chunk-text">${item.metadata.text}</div>
            `;
            resultsContainer.appendChild(card);
        });
    } catch (err) {
        console.error("搜尋材料失敗:", err);
    }
}

// ==========================================
// 10. AI Decompose Outline Modal
// ==========================================
function openDecomposeModal() {
    if (!state.activeProjectId || !state.activeOutlineNodeId) {
        alert("請先選取左側寫作工作區的具體章節！");
        return;
    }
    
    const activeProj = state.projects.find(p => p.id === state.activeProjectId);
    const activeNode = state.outlines.find(o => o.id === state.activeOutlineNodeId);
    
    document.getElementById("decompose-project-name").value = activeProj.name;
    document.getElementById("decompose-outline-name").value = activeNode.title;
    
    // 帶入該大綱目前的描述作為預設值
    document.getElementById("decompose-macro-text").value = activeNode.description || "";
    
    document.getElementById("decompose-modal").classList.remove("hidden");
}

function closeDecomposeModal() {
    document.getElementById("decompose-modal").classList.add("hidden");
}

async function handleDecomposeOutline() {
    const macro_text = document.getElementById("decompose-macro-text").value;
    if (!macro_text.trim()) {
        alert("請輸入大綱細節以利拆解！");
        return;
    }
    
    const btn = document.getElementById("btn-execute-decompose");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI 拆解中...';
    
    try {
        const res = await fetch(`${API_BASE}/outlines/decompose`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: state.activeProjectId,
                outline_node_id: state.activeOutlineNodeId,
                macro_text: macro_text
            })
        });
        if (res.ok) {
            closeDecomposeModal();
            showToast("AI 拆解微任務成功！");
            await refreshDailySchedule();
            switchTab("scheduler");
            
            // 互動引導嚮導步驟 3 自動跳轉至步驟 4
            if (typeof currentTourStep !== "undefined" && currentTourStep === 3) {
                setTimeout(() => goToTourStep(4), 1000);
            }
        }
    } catch(e) {
        console.error("AI 拆解失敗:", e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-scissors"></i> 開始切碎大綱';
    }
}

// ==========================================
// 11. Web Audio Chime Synthesis (Dopamine hit)
// ==========================================
function playDopamineChime() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        const now = audioCtx.currentTime;
        
        // 音效一：C5 -> E5 -> G5 -> C6 (清脆和弦上升)
        const notes = [523.25, 659.25, 783.99, 1046.50];
        
        notes.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            // 混合波形營造水晶質感
            osc.type = index % 2 === 0 ? "sine" : "triangle";
            osc.frequency.setValueAtTime(freq, now + index * 0.08);
            
            // 指數型包絡線 (水晶剔透的淡出感)
            gain.gain.setValueAtTime(0, now + index * 0.08);
            gain.gain.linearRampToValueAtTime(0.3, now + index * 0.08 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.5);
            
            osc.start(now + index * 0.08);
            osc.stop(now + index * 0.08 + 0.6);
        });
    } catch (e) {
        console.error("Web Audio 音效播放失敗:", e);
    }
}

// ==========================================
// 12. Confetti Particle System (Visual reward)
// ==========================================
function triggerConfettiExplosion() {
    const canvas = document.getElementById("confetti-canvas");
    const ctx = canvas.getContext("2d");
    
    // 設定畫布尺寸
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // 初始化粒子數組
    confettiParticles = [];
    const colors = ["#a855f7", "#ec4899", "#06b6d4", "#f59e0b", "#10b981"];
    
    // 噴發 100 個彩帶粒子
    for (let i = 0; i < 100; i++) {
        confettiParticles.push({
            x: canvas.width / 2,
            y: canvas.height + 10,
            angle: Math.random() * Math.PI - Math.PI, // 向上噴射角度 (-180度 到 0度)
            speed: Math.random() * 12 + 10,
            radius: Math.random() * 4 + 4,
            color: colors[Math.floor(Math.random() * colors.length)],
            rotation: Math.random() * 360,
            rotationSpeed: Math.random() * 8 - 4,
            gravity: 0.25,
            friction: 0.98,
            opacity: 1
        });
    }
    
    // 取消可能正在執行的前一次動畫
    if (confettiAnimationId) {
        cancelAnimationFrame(confettiAnimationId);
    }
    
    // 執行繪製循環
    animateConfetti(canvas, ctx);
}

function animateConfetti(canvas, ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let activeParticles = 0;
    
    confettiParticles.forEach(p => {
        if (p.opacity <= 0) return;
        
        activeParticles++;
        
        // 更新物理屬性
        p.speed *= p.friction;
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed + p.gravity;
        p.rotation += p.rotationSpeed;
        p.opacity -= 0.012; // 漸漸消失
        
        // 繪製粒子
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.opacity);
        
        // 繪製彩色方塊
        ctx.fillRect(-p.radius, -p.radius, p.radius * 2, p.radius * 2);
        ctx.restore();
    });
    
    if (activeParticles > 0) {
        confettiAnimationId = requestAnimationFrame(() => animateConfetti(canvas, ctx));
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// ==========================================
// 13. UI Toasts
// ==========================================
function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "glass-card";
    toast.style.position = "fixed";
    toast.style.bottom = "24px";
    toast.style.right = "24px";
    toast.style.padding = "14px 24px";
    toast.style.background = "rgba(168,85,247,0.15)";
    toast.style.borderColor = "var(--accent-purple)";
    toast.style.color = "#fff";
    toast.style.fontWeight = "600";
    toast.style.borderRadius = "10px";
    toast.style.boxShadow = "0 4px 14px var(--accent-purple-glow)";
    toast.style.zIndex = "999";
    toast.style.backdropFilter = "blur(12px)";
    toast.innerHTML = `<i class="fa-solid fa-sparkles text-pink" style="margin-right:8px;"></i> ${message.replace("\n", "<br>")}`;
    
    document.body.appendChild(toast);
    
    // 淡入動畫
    toast.animate([
        { transform: "translateY(20px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 }
    ], { duration: 300, easing: "ease-out" });
    
    // 3 秒後銷毀
    setTimeout(() => {
        toast.animate([
            { opacity: 1 },
            { opacity: 0 }
        ], { duration: 300 }).onfinish = () => toast.remove();
    }, 3000);
}

// ==========================================
// 13.5 AI Writing Coach (Interactive Guidance)
// ==========================================
let coachQuestionsList = [];

async function toggleCoachPanel() {
    if (!state.activeProjectId || !state.activeOutlineNodeId) {
        alert("請先選擇一個專案與章節！");
        return;
    }
    
    const panel = document.getElementById("ai-coach-panel");
    panel.classList.toggle("hidden");
    
    if (!panel.classList.contains("hidden")) {
        await loadCoachQuestions();
    }
}

async function loadCoachQuestions(force = false) {
    if (!state.activeProjectId || !state.activeOutlineNodeId) return;
    
    let debugEl = document.getElementById("coach-debug-info");
    if (!debugEl) {
        debugEl = document.createElement("div");
        debugEl.id = "coach-debug-info";
        debugEl.style.fontSize = "9px";
        debugEl.style.color = "rgba(255, 255, 255, 0.4)";
        debugEl.style.marginTop = "10px";
        debugEl.style.borderTop = "1px dashed rgba(255, 255, 255, 0.1)";
        debugEl.style.paddingTop = "5px";
        debugEl.style.fontFamily = "monospace";
        debugEl.style.wordBreak = "break-all";
        const coachBody = document.querySelector(".coach-body");
        if (coachBody) coachBody.appendChild(debugEl);
    }
    
    const cleanStack = (new Error().stack || "").split("\n").slice(1, 4).join(" | ").replace(/http:\/\/localhost:8000\/frontend\//g, "");
    
    // 如果不是強制刷新，且已經載入過當前章節的引導問題，則直接跳過，避免重複載入或打字中被重新整理
    if (!force && state.coachLoadedOutlineNodeId === state.activeOutlineNodeId) {
        if (debugEl) debugEl.innerHTML = `[Debug] 跳過載入於 ${new Date().toLocaleTimeString()} (原因: 已存在 | 來源: ${cleanStack})`;
        return;
    }
    
    if (debugEl) debugEl.innerHTML = `[Debug] 載入問題中... ${new Date().toLocaleTimeString()} (Force: ${force} | 來源: ${cleanStack})`;
    
    const container = document.getElementById("coach-questions-container");
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-spinner fa-spin text-cyan"></i> AI 正在為您設計引導問題...</div>';
    
    try {
        const res = await fetch(`${API_BASE}/editor/guide?project_id=${state.activeProjectId}&outline_node_id=${state.activeOutlineNodeId}`);
        if (!res.ok) throw new Error("獲取引導問題失敗");
        
        const data = await res.json();
        coachQuestionsList = data.questions || [];
        
        container.innerHTML = "";
        if (coachQuestionsList.length === 0) {
            container.innerHTML = '<div class="empty-state">無法產生引導問題，請重試。</div>';
            return;
        }
        
        coachQuestionsList.forEach((q, idx) => {
            const item = document.createElement("div");
            item.className = "coach-q-item";
            item.innerHTML = `
                <label class="coach-q-label">問題 ${idx + 1}：${q}</label>
                <textarea class="coach-q-input" id="coach-ans-${idx}" placeholder="簡短回答您的想法...不需要完整句子，單字或碎片詞彙也可！"></textarea>
            `;
            container.appendChild(item);
        });
        
        // 成功載入，紀錄當前章節 ID 避免重複載入
        state.coachLoadedOutlineNodeId = state.activeOutlineNodeId;
    } catch (e) {
        console.error("載入寫作教練問題失敗:", e);
        container.innerHTML = '<div class="empty-state">載入失敗，請檢查本地 API 是否開啟。</div>';
    }
}

async function fuseCoachAnswers() {
    if (!state.activeProjectId || !state.activeOutlineNodeId) {
        alert("請先選擇專案與章節！");
        return;
    }
    
    const btn = document.getElementById("btn-fuse-answers");
    const originalText = btn.innerHTML;
    
    // 收集答案
    const answers = [];
    let hasAnswer = false;
    for (let idx = 0; idx < coachQuestionsList.length; idx++) {
        const ansVal = document.getElementById(`coach-ans-${idx}`).value;
        answers.push({
            question: coachQuestionsList[idx],
            answer: ansVal
        });
        if (ansVal.trim()) hasAnswer = true;
    }
    
    if (!hasAnswer) {
        alert("請至少回答一個問題以進行融合！");
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 融合創作中...';
    
    try {
        const res = await fetch(`${API_BASE}/editor/fuse`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_id: state.activeProjectId,
                outline_node_id: state.activeOutlineNodeId,
                answers: answers
            })
        });
        
        if (!res.ok) throw new Error("融合失敗");
        const data = await res.json();
        
        if (data.fused_draft) {
            // 把融合完成的草稿累加或寫入主 TextArea
            const textarea = document.getElementById("draft-textarea");
            const existing = textarea.value.trim();
            if (existing) {
                textarea.value = existing + "\n\n" + data.fused_draft;
            } else {
                textarea.value = data.fused_draft;
            }
            
            // 自動儲存一次草稿
            await saveDraftText();
            
            showToast("AI 已將您的靈感融合成初稿！");
            
            // 關閉 Coach Panel
            document.getElementById("ai-coach-panel").classList.add("hidden");
            // 重設紀錄，下次再打開時重新載入新問題
            state.coachLoadedOutlineNodeId = null;
        }
    } catch (e) {
        console.error("融合失敗:", e);
        showToast("融合失敗，請檢查本地 AI 是否運行");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// ==========================================================================
// 14. Interactive Onboarding Tour Engine
// ==========================================================================
let currentTourStep = 1;
const tourSteps = {
    1: {
        title: "步驟 1：建立寫作專案",
        desc: "每一個大作都有一個起點。點擊左側導航的<strong>『專案管理』</strong>，並在左邊的表單填寫專案名稱、描述與最重要的 Persona（文風 Prompt，例如：硬核科幻小說風格），點擊『建立專案』！",
        tab: "projects",
        highlightSelector: "#form-create-project"
    },
    2: {
        title: "步驟 2：建立章節大綱",
        desc: "有了專案後，請在右側的<strong>『專案大綱結構管理』</strong>區域中，輸入您的第一個章節名稱（如：第一章：覺醒），點擊『新增章節』按鈕。",
        tab: "projects",
        highlightSelector: "#project-outline-manager-panel"
    },
    3: {
        title: "步驟 3：AI 拆解微任務 (ADHD 友善)",
        desc: "單一任務太大容易讓人退縮？選取該大綱後點擊<strong>『AI 拆解微任務』</strong>，輸入情節，AI 就會自動將其切碎成多個 20 分鐘的具體微小任務！",
        tab: "projects",
        highlightSelector: "#project-outline-manager-panel table"
    },
    4: {
        title: "步驟 4：匯入背景素材 (RAG 知識庫)",
        desc: "切換到<strong>『背景知識庫』</strong>分頁。在這裡您可以上傳文獻或世界觀設定。寫作時，AI 向量庫會自動根據您的內容撈取並推薦這些資料！",
        tab: "materials",
        highlightSelector: "#form-ingest-material"
    },
    5: {
        title: "步驟 5：寫作工作區與 AI 潤飾",
        desc: "現在，點擊左側<strong>『寫作工作區』</strong>。選擇您的活躍章節，點擊啟動計時器開始聚焦！在下方寫下草稿，點擊<strong>『一鍵潤飾 (AI)』</strong>，AI 就會自動為您潤色！完成後還能播放多巴胺音效慶祝！",
        tab: "workspace",
        highlightSelector: ".workspace-center"
    }
};

function initOnboardingTour() {
    const wizard = document.getElementById("onboarding-wizard");
    const btnPrev = document.getElementById("btn-wizard-prev");
    const btnNext = document.getElementById("btn-wizard-next");
    const btnClose = document.getElementById("btn-close-wizard");
    const btnStart = document.getElementById("btn-start-tour");

    if (!wizard) return;

    btnPrev.addEventListener("click", () => navigateTour(-1));
    btnNext.addEventListener("click", () => navigateTour(1));
    btnClose.addEventListener("click", closeTour);
    btnStart.addEventListener("click", startTour);

    // 點擊進度小點也可以切換
    document.querySelectorAll(".step-dot").forEach(dot => {
        dot.addEventListener("click", (e) => {
            const step = parseInt(e.target.getAttribute("data-step"));
            goToTourStep(step);
        });
    });

    // 載入時，如果使用者還沒有任何專案，自動開啟導覽
    setTimeout(() => {
        if (!state.projects || state.projects.length === 0) {
            startTour();
        } else {
            // 如果已有專案，隱藏引導並顯示浮動重啟按鈕
            closeTour();
        }
    }, 1000);
}

function startTour() {
    currentTourStep = 1;
    document.getElementById("onboarding-wizard").classList.remove("hidden");
    document.getElementById("btn-start-tour").classList.add("hidden");
    goToTourStep(1);
}

function closeTour() {
    document.getElementById("onboarding-wizard").classList.add("hidden");
    document.getElementById("btn-start-tour").classList.remove("hidden");
    removeHighlights();
}

function removeHighlights() {
    document.querySelectorAll(".highlight-glow").forEach(el => {
        el.classList.remove("highlight-glow");
    });
}

function goToTourStep(step) {
    if (step < 1 || step > 5) return;
    currentTourStep = step;
    
    const stepData = tourSteps[step];
    
    // 更新標題與描述
    document.getElementById("wizard-step-title").innerHTML = stepData.title;
    document.getElementById("wizard-step-desc").innerHTML = stepData.desc;
    
    // 更新導覽按鈕狀態
    document.getElementById("btn-wizard-prev").disabled = (step === 1);
    const btnNext = document.getElementById("btn-wizard-next");
    if (step === 5) {
        btnNext.innerHTML = "完成導覽 <i class='fa-solid fa-check'></i>";
    } else {
        btnNext.innerHTML = "下一步 <i class='fa-solid fa-arrow-right'></i>";
    }

    // 更新進度小點樣式
    document.querySelectorAll(".step-dot").forEach(dot => {
        const dotStep = parseInt(dot.getAttribute("data-step"));
        dot.classList.remove("active", "completed");
        if (dotStep === step) {
            dot.classList.add("active");
        } else if (dotStep < step) {
            dot.classList.add("completed");
        }
    });

    // 自動切換至對應的 Tab
    if (stepData.tab) {
        switchTab(stepData.tab);
    }

    // 移除舊的高亮，並套用新的高亮
    removeHighlights();
    setTimeout(() => {
        if (stepData.highlightSelector) {
            const targetEl = document.querySelector(stepData.highlightSelector);
            if (targetEl) {
                targetEl.classList.add("highlight-glow");
                // 捲動至該元素以方便檢視
                targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }
    }, 300);
}

function navigateTour(direction) {
    const nextStep = currentTourStep + direction;
    if (nextStep >= 1 && nextStep <= 5) {
        goToTourStep(nextStep);
    } else if (nextStep > 5) {
        // 點擊「完成導覽」
        showToast("恭喜完成 Monocle 核心功能導航！開始您的創作吧！🚀");
        triggerConfettiExplosion();
        playDopamineChime();
        closeTour();
    }
}
