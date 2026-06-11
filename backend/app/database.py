import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from backend.app.config import settings

class Database:
    def __init__(self, db_path: str = None):
        self.db_path = db_path or settings.DB_PATH
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Returns dict-like rows
        return conn

    def init_db(self):
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # 1. Projects Table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    persona_prompt TEXT,
                    deadline TEXT,
                    created_at TEXT NOT NULL
                )
            """)

            # 2. Outline Nodes Table (大綱錨定與內容)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS outline_nodes (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    sort_order INTEGER NOT NULL,
                    status TEXT NOT NULL, -- 'draft', 'writing', 'polish', 'done'
                    content TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)

            # 3. Micro-tasks Table (20分鐘微任務計時)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    outline_node_id TEXT,
                    title TEXT NOT NULL,
                    duration_minutes INTEGER DEFAULT 20,
                    status TEXT NOT NULL, -- 'pending', 'active', 'completed'
                    completed_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY (outline_node_id) REFERENCES outline_nodes(id) ON DELETE SET NULL
                )
            """)

            # 4. Materials Table (參考材料)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS materials (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    outline_node_id TEXT, -- 可選，錨定特定大綱節點
                    filename TEXT NOT NULL,
                    source_url TEXT,
                    raw_content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY (outline_node_id) REFERENCES outline_nodes(id) ON DELETE SET NULL
                )
            """)

            # 5. Global State Machine (單一事實來源狀態機)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS global_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            
            # 初始化預設狀態值
            cursor.execute("INSERT OR IGNORE INTO global_state (key, value) VALUES ('active_project_id', 'null')")
            cursor.execute("INSERT OR IGNORE INTO global_state (key, value) VALUES ('active_outline_node_id', 'null')")
            cursor.execute("INSERT OR IGNORE INTO global_state (key, value) VALUES ('active_task_id', 'null')")
            cursor.execute("INSERT OR IGNORE INTO global_state (key, value) VALUES ('timer_state', '{\"is_running\": false, \"started_at\": null, \"remaining_seconds\": 1200, \"paused_at\": null}')")
            
            conn.commit()

    # Generic Query Helpers
    def query_one(self, query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            row = conn.execute(query, params).fetchone()
            return dict(row) if row else None

    def query_all(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        with self.get_connection() as conn:
            rows = conn.execute(query, params).fetchall()
            return [dict(row) for row in rows]

    def execute(self, query: str, params: tuple = ()):
        with self.get_connection() as conn:
            conn.execute(query, params)
            conn.commit()

db = Database()
