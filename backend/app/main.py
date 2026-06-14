import uuid
from datetime import datetime
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List, Optional

from backend.app.config import settings
from backend.app.database import db
from backend.app.state import state_manager
from backend.app.models import (
    ProjectCreate, OutlineNodeCreate, OutlineNodeUpdate, TaskCreate,
    MaterialIngest, StateUpdate, DraftSave,
    DraftPolish, DecomposeOutlineRequest, TimerControl, LLMConfigUpdate
)
from backend.app.services.scheduler import TaskSchedulerService
from backend.app.services.resource import ResourceManagerService
from backend.app.services.editor import EditorService
from backend.app.vector_store import vector_store_manager
from backend.app.llm_client import AIClient

app = FastAPI(
    title="Total Editor & Portfolio Manager Backend",
    description="ADHD-friendly Headless Writing Assistant System Backend Engine",
    version="1.0.0"
)

# 啟用 CORS 跨域請求支援，方便 Chrome Extension 及 Web Dashboard 連線
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 1. 全域狀態機與計時器路由 (State Machine)
# ==========================================

@app.get("/api/state", summary="取得全域狀態快照")
def get_global_state():
    try:
        return state_manager.get_full_state()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/state", summary="更新全域活躍狀態 (切換專案、大綱、任務)")
def update_global_state(state: StateUpdate):
    try:
        if state.active_project_id is not None:
            state_manager.set_active_project(state.active_project_id)
        if state.active_outline_node_id is not None:
            state_manager.set_active_outline_node(state.active_outline_node_id)
        if state.active_task_id is not None:
            state_manager.set_active_task(state.active_task_id)
        return state_manager.get_full_state()
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/timer/control", summary="控制計時器狀態 (啟動、暫停、重設)")
def control_timer(control: TimerControl):
    try:
        action = control.action.lower()
        if action == "start":
            state_manager.start_timer()
        elif action == "pause":
            state_manager.pause_timer()
        elif action == "reset":
            state_manager.reset_timer(control.duration_seconds or 1200)
        else:
            raise HTTPException(status_code=400, detail="不支援的 action 控制動作，僅接受 start, pause, reset")
        return state_manager.get_full_state()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 1b. LLM 引擎選擇 (使用者可選端點/模型)
# ==========================================

@app.get("/api/llm/config", summary="取得 LLM 預設清單與當前 active 設定")
def get_llm_config():
    return {
        "presets": settings.LLM_PRESETS,
        "active": state_manager.get_llm_config()
    }

@app.post("/api/llm/config", summary="設定當前使用的 LLM 端點與模型")
def update_llm_config(cfg: LLMConfigUpdate):
    try:
        return state_manager.set_llm_config(cfg.api_url, cfg.model, cfg.skip_thinking)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/llm/models", summary="向指定端點抓取可用模型清單")
async def list_llm_models(api_url: str):
    try:
        return {"models": await AIClient.list_models(api_url)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 2. 專案管理路由 (Project Manager)
# ==========================================

@app.post("/api/projects", status_code=status.HTTP_201_CREATED, summary="建立新專案")
def create_project(proj: ProjectCreate):
    project_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    
    try:
        db.execute(
            """
            INSERT INTO projects (id, name, description, persona_prompt, deadline, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (project_id, proj.name, proj.description, proj.persona_prompt, proj.deadline, created_at)
        )
        return {"id": project_id, "name": proj.name, "created_at": created_at}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects", response_model=List[Dict[str, Any]], summary="列出所有專案")
def list_projects():
    try:
        return db.query_all("SELECT * FROM projects ORDER BY created_at DESC")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/projects/{project_id}", summary="取得特定專案詳情 (包含大綱、微任務與材料)")
def get_project_details(project_id: str):
    project = db.query_one("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="專案不存在")
        
    try:
        outlines = db.query_all("SELECT * FROM outline_nodes WHERE project_id = ? ORDER BY sort_order ASC", (project_id,))
        tasks = db.query_all("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at ASC", (project_id,))
        materials = db.query_all("SELECT id, outline_node_id, filename, source_url, created_at FROM materials WHERE project_id = ?", (project_id,))
        
        return {
            "project": project,
            "outlines": outlines,
            "tasks": tasks,
            "materials": materials
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/projects/{project_id}", summary="刪除專案 (並清理其向量 Namespace 目錄)")
def delete_project(project_id: str):
    project = db.query_one("SELECT id FROM projects WHERE id = ?", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="專案不存在")
        
    try:
        # 1. 刪除資料庫關聯 (SQLite CASCADE 外鍵會處理 outline_nodes, tasks, materials)
        db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        
        # 2. 物理刪除該專案的向量資料夾與 index
        import shutil
        project_dir = os.path.join(settings.PROJECTS_DIR, project_id)
        if os.path.exists(project_dir):
            shutil.rmtree(project_dir)
            
        # 3. 如果刪除的是當前活躍專案，重設狀態機
        active_pid = state_manager.get_value("active_project_id")
        if active_pid == project_id:
            state_manager.set_active_project(None)
            
        return {"status": "success", "message": f"專案 {project_id} 及其本機向量空間已完全清除。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 3. 大綱結構與切碎工具 (Outline & Chunking)
# ==========================================

@app.post("/api/outlines", status_code=status.HTTP_201_CREATED, summary="新增大綱節點")
def create_outline_node(node: OutlineNodeCreate):
    node_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    try:
        db.execute(
            """
            INSERT INTO outline_nodes (id, project_id, title, description, sort_order, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'draft', ?)
            """,
            (node_id, node.project_id, node.title, node.description, node.sort_order, created_at)
        )
        return {"id": node_id, "title": node.title, "sort_order": node.sort_order}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/outlines/{node_id}", summary="更新大綱節點 (標題、描述、排序)")
def update_outline_node(node_id: str, update: OutlineNodeUpdate):
    node = db.query_one("SELECT id FROM outline_nodes WHERE id = ?", (node_id,))
    if not node:
        raise HTTPException(status_code=404, detail="大綱節點不存在")

    # 僅更新有提供的欄位 (部分更新)
    fields = []
    params: List[Any] = []
    if update.title is not None:
        fields.append("title = ?")
        params.append(update.title)
    if update.description is not None:
        fields.append("description = ?")
        params.append(update.description)
    if update.sort_order is not None:
        fields.append("sort_order = ?")
        params.append(update.sort_order)

    if not fields:
        raise HTTPException(status_code=400, detail="未提供任何要更新的欄位")

    try:
        params.append(node_id)
        db.execute(f"UPDATE outline_nodes SET {', '.join(fields)} WHERE id = ?", tuple(params))
        return {"status": "success", "id": node_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/outlines/{node_id}", summary="刪除大綱節點 (關聯任務/材料的錨定會自動解除)")
def delete_outline_node(node_id: str):
    node = db.query_one("SELECT id FROM outline_nodes WHERE id = ?", (node_id,))
    if not node:
        raise HTTPException(status_code=404, detail="大綱節點不存在")

    try:
        # FK 開啟後，tasks / materials 的 outline_node_id 會自動 SET NULL
        db.execute("DELETE FROM outline_nodes WHERE id = ?", (node_id,))

        # 若刪除的是當前活躍大綱，重設狀態機
        active_oid = state_manager.get_value("active_outline_node_id")
        if active_oid == node_id:
            state_manager.set_active_outline_node(None)

        return {"status": "success", "message": f"大綱節點 {node_id} 已刪除。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/outlines/decompose", summary="[工具] 自動將大綱拆解為 20分鐘微任務清單")
async def decompose_outline(req: DecomposeOutlineRequest):
    try:
        tasks = await TaskSchedulerService.decompose_outline_to_tasks(
            project_id=req.project_id,
            outline_node_id=req.outline_node_id,
            macro_text=req.macro_text
        )
        return {"status": "success", "tasks_created": tasks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 4. 微任務與 ADHD 優先級排程 (Micro-tasks & Scheduler)
# ==========================================

@app.post("/api/tasks", status_code=status.HTTP_201_CREATED, summary="新增手動微任務")
def create_task(task: TaskCreate):
    task_id = str(uuid.uuid4())
    created_at = datetime.now().isoformat()
    try:
        db.execute(
            """
            INSERT INTO tasks (id, project_id, outline_node_id, title, duration_minutes, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
            """,
            (task_id, task.project_id, task.outline_node_id, task.title, task.duration_minutes, created_at)
        )
        return {"id": task_id, "title": task.title, "status": "pending"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tasks/daily", summary="取得 ADHD 每日跨專案配盤任務清單 (今日聚焦流)")
def get_daily_tasks():
    try:
        return TaskSchedulerService.get_daily_schedule()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tasks/{task_id}/complete", summary="完成任務並觸發多巴胺回饋")
def complete_task(task_id: str):
    task = db.query_one("SELECT * FROM tasks WHERE id = ?", (task_id,))
    if not task:
        raise HTTPException(status_code=404, detail="微任務不存在")
        
    try:
        # 更新任務狀態
        db.execute(
            "UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?",
            (datetime.now().isoformat(), task_id)
        )
        
        # 若目前活躍任務就是此完成任務，重設活躍任務與計時器
        active_tid = state_manager.get_value("active_task_id")
        if active_tid == task_id:
            state_manager.set_value("active_task_id", None)
            state_manager.pause_timer()
            
        return {
            "status": "success", 
            "message": "任務完成！播放多巴胺音效，啟動彩帶物理灑落動畫！",
            "dopamine_trigger": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 5. 材料資源管理器與物理隔離 RAG (Resource Manager)
# ==========================================

@app.post("/api/materials/ingest", summary="[工具] 匯入材料背景資料並強制綁定 Namespace 進行 Embedding")
async def ingest_material(material: MaterialIngest):
    try:
        result = await ResourceManagerService.ingest_and_anchor_material(
            project_id=material.project_id,
            filename=material.filename,
            raw_content=material.raw_content,
            outline_node_id=material.outline_node_id,
            source_url=material.source_url
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/materials/retrieve", summary="[工具] 依當前編輯內容，從專案 Namespace 檢索最相關背景材料")
async def retrieve_materials(project_id: str, query: str, outline_node_id: Optional[str] = None, top_k: int = 3):
    try:
        return await ResourceManagerService.retrieve_active_context_resources(
            project_id=project_id,
            outline_node_id=outline_node_id,
            query_text=query,
            top_k=top_k
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/materials/{material_id}", summary="取得單筆材料詳情 (含完整正文)")
def get_material(material_id: str):
    material = db.query_one("SELECT * FROM materials WHERE id = ?", (material_id,))
    if not material:
        raise HTTPException(status_code=404, detail="材料不存在")
    return material

@app.delete("/api/materials/{material_id}", summary="刪除材料 (並清除其物理隔離向量)")
def delete_material(material_id: str):
    material = db.query_one("SELECT id, project_id FROM materials WHERE id = ?", (material_id,))
    if not material:
        raise HTTPException(status_code=404, detail="材料不存在")

    try:
        # 1. 刪除該材料在專案 Namespace 內的向量與 metadata (依 chunk_id 前綴精準刪除)
        store = vector_store_manager.get_store(material["project_id"])
        store.delete_chunks_by_prefix(f"{material_id}_chunk_")

        # 2. 刪除 DB 記錄
        db.execute("DELETE FROM materials WHERE id = ?", (material_id,))

        return {"status": "success", "message": f"材料 {material_id} 及其向量已清除。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 6. 漸進式編輯與 AI 潤飾 (Editor & Polish)
# ==========================================

@app.post("/api/editor/save", summary="快速暫存原始草稿 (無壓力草稿模式)")
def save_draft(draft: DraftSave):
    try:
        return EditorService.save_raw_draft(
            outline_node_id=draft.outline_node_id,
            draft_text=draft.draft_text
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/editor/polish", summary="[工具] 套用 Persona 與相關素材對草稿進行 AI 潤飾與文字重構")
async def polish_draft(req: DraftPolish):
    try:
        result = await EditorService.polish_draft_with_tone(
            project_id=req.project_id,
            outline_node_id=req.outline_node_id,
            draft_text=req.draft_text
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import os
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# 取得目前專案根目錄中的 frontend 資料夾
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend")

# 開機首頁直接載入並顯示 Dashboard 網頁介面
@app.get("/")
def read_root():
    dashboard_path = os.path.join(FRONTEND_DIR, "dashboard.html")
    if os.path.exists(dashboard_path):
        return FileResponse(dashboard_path)
    return {
        "status": "online",
        "system": "Total Editor & Portfolio Manager Backend",
        "message": "Frontend dashboard.html not found, please check directories."
    }

# 掛載靜態檔案目錄，處理 css/js 載入 (放在最底下以防阻擋 API 路由)
app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")

