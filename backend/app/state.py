import json
import time
from typing import Dict, Any, Optional
from backend.app.database import db
from backend.app.config import settings

class StateManager:
    """
    全域狀態機 (State Machine) 的管理器。
    作為單一事實來源 (Single Source of Truth)，將狀態永久保存在 SQLite 的 global_state 中，
    確保 Web Dashboard 與 Chrome Extension 看到的狀態完全一致。
    """
    
    @staticmethod
    def get_value(key: str, default: Any = None) -> Any:
        row = db.query_one("SELECT value FROM global_state WHERE key = ?", (key,))
        if not row:
            return default
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return row["value"]

    @staticmethod
    def set_value(key: str, value: Any):
        db.execute(
            "INSERT OR REPLACE INTO global_state (key, value) VALUES (?, ?)",
            (key, json.dumps(value, ensure_ascii=False))
        )

    def get_full_state(self) -> Dict[str, Any]:
        """
        取得當前全域狀態機快照
        """
        # 同步更新 Timer 的剩餘時間 (如果計時器正在執行)
        timer_state = self.get_value("timer_state")
        if timer_state and timer_state.get("is_running"):
            now = time.time()
            started_at = timer_state.get("started_at")
            elapsed = int(now - started_at)
            
            # 重新計算剩餘秒數
            original_remaining = timer_state.get("original_remaining_seconds", timer_state.get("remaining_seconds", 1200))
            new_remaining = max(0, original_remaining - elapsed)
            
            # 若時間到了，自動停止
            if new_remaining <= 0:
                timer_state["is_running"] = False
                timer_state["remaining_seconds"] = 0
                timer_state["started_at"] = None
                # 將歸零後的停止狀態持久化寫回 DB，
                # 否則下一次讀取仍會看到 is_running=true，計時器永遠卡住。
                self.set_value("timer_state", timer_state)
            else:
                timer_state["remaining_seconds"] = new_remaining
                
        return {
            "active_project_id": self.get_value("active_project_id"),
            "active_outline_node_id": self.get_value("active_outline_node_id"),
            "active_task_id": self.get_value("active_task_id"),
            "timer": timer_state
        }

    def get_llm_config(self) -> Dict[str, str]:
        """
        取得目前使用者選定的 LLM 端點與模型。
        若使用者尚未選擇，回退至 config.py 的初始預設值。
        """
        cfg = self.get_value("llm_config")
        if cfg and cfg.get("api_url") and cfg.get("model"):
            return {
                "api_url": cfg["api_url"],
                "model": cfg["model"],
                "skip_thinking": bool(cfg.get("skip_thinking", False)),
            }
        return {
            "api_url": settings.LLM_API_URL,
            "model": settings.LLM_MODEL,
            "skip_thinking": False,
        }

    def set_llm_config(self, api_url: str, model: str, skip_thinking: bool = False) -> Dict[str, Any]:
        """
        設定並持久化使用者選定的 LLM 端點、模型與「跳過思考」開關 (存入 global_state)。
        """
        cfg = {
            "api_url": api_url.strip(),
            "model": model.strip(),
            "skip_thinking": bool(skip_thinking),
        }
        self.set_value("llm_config", cfg)
        return cfg

    def set_active_project(self, project_id: Optional[str]):
        """
        切換當前活躍專案。切換專案時，應清空當前活躍大綱與活躍任務。
        """
        # 驗證 project_id 是否存在 (非 None 時)
        if project_id and project_id != "null":
            proj = db.query_one("SELECT id FROM projects WHERE id = ?", (project_id,))
            if not proj:
                raise ValueError(f"專案 {project_id} 不存在")
            self.set_value("active_project_id", project_id)
        else:
            self.set_value("active_project_id", None)
            
        self.set_value("active_outline_node_id", None)
        self.set_value("active_task_id", None)
        self.reset_timer(1200) # 預設重設為 20 分鐘

    def set_active_outline_node(self, outline_node_id: Optional[str]):
        """
        切換當前活躍大綱章節。
        """
        if outline_node_id and outline_node_id != "null":
            node = db.query_one("SELECT id, project_id FROM outline_nodes WHERE id = ?", (outline_node_id,))
            if not node:
                raise ValueError(f"大綱節點 {outline_node_id} 不存在")
            
            # 確保大綱節點屬於目前活躍專案，若不屬於，自動切換專案
            active_proj = self.get_value("active_project_id")
            if active_proj != node["project_id"]:
                self.set_value("active_project_id", node["project_id"])
                
            self.set_value("active_outline_node_id", outline_node_id)
        else:
            self.set_value("active_outline_node_id", None)

    def set_active_task(self, task_id: Optional[str]):
        """
        切換並啟動一個微任務。啟動微任務時會同步重設並啟動計時器。
        """
        if task_id and task_id != "null":
            task = db.query_one("SELECT id, project_id, outline_node_id, duration_minutes FROM tasks WHERE id = ?", (task_id,))
            if not task:
                raise ValueError(f"任務 {task_id} 不存在")
                
            # 切換狀態機綁定
            self.set_value("active_project_id", task["project_id"])
            if task["outline_node_id"]:
                self.set_value("active_outline_node_id", task["outline_node_id"])
            self.set_value("active_task_id", task_id)
            
            # 將任務狀態改為 active
            db.execute("UPDATE tasks SET status = 'active' WHERE id = ?", (task_id,))
            
            # 依據任務設定時間，啟動計時器
            duration_seconds = task["duration_minutes"] * 60
            self.reset_timer(duration_seconds)
            self.start_timer()
        else:
            # 取消當前任務
            curr_task_id = self.get_value("active_task_id")
            if curr_task_id:
                db.execute("UPDATE tasks SET status = 'pending' WHERE id = ? AND status = 'active'", (curr_task_id,))
            self.set_value("active_task_id", None)
            self.pause_timer()

    def start_timer(self):
        timer_state = self.get_value("timer_state")
        if not timer_state["is_running"]:
            timer_state["is_running"] = True
            timer_state["started_at"] = time.time()
            timer_state["original_remaining_seconds"] = timer_state.get("remaining_seconds", 1200)
            self.set_value("timer_state", timer_state)

    def pause_timer(self):
        timer_state = self.get_value("timer_state")
        if timer_state["is_running"]:
            now = time.time()
            elapsed = int(now - timer_state["started_at"])
            original_remaining = timer_state.get("original_remaining_seconds", timer_state.get("remaining_seconds", 1200))
            
            timer_state["is_running"] = False
            timer_state["remaining_seconds"] = max(0, original_remaining - elapsed)
            timer_state["started_at"] = None
            timer_state["paused_at"] = now
            self.set_value("timer_state", timer_state)

    def reset_timer(self, duration_seconds: int = 1200):
        timer_state = {
            "is_running": False,
            "started_at": None,
            "remaining_seconds": duration_seconds,
            "original_remaining_seconds": duration_seconds,
            "paused_at": None
        }
        self.set_value("timer_state", timer_state)

state_manager = StateManager()
