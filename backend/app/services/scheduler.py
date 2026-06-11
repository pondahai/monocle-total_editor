import uuid
from datetime import datetime
from typing import List, Dict, Any
from backend.app.database import db
from backend.app.llm_client import ai_client
import json

class TaskSchedulerService:
    """
    ADHD-友善的「微任務」時間管理器 (Time Manager)
    """
    
    @staticmethod
    async def decompose_outline_to_tasks(project_id: str, outline_node_id: str, macro_text: str) -> List[Dict[str, Any]]:
        """
        [工具] decompose_outline_to_tasks
        自動將宏觀大綱切碎為 20 分鐘內可完成的行動清單。
        """
        # 1. 取得大綱與專案資訊
        node = db.query_one("SELECT title, description FROM outline_nodes WHERE id = ?", (outline_node_id,))
        node_title = node["title"] if node else "未命名章節"
        
        # 2. 設計 Prompt 請求 LLM 拆解
        prompt = f"""
        你是一位專門協助 ADHD 創作者的注意力引導教練。
        我們的目標是將以下宏觀的寫作大綱/章節內容，拆解為數個可在 20 分鐘內專注完成、動作極其具體的「微步驟任務」(Micro-steps)。
        
        【大綱/章節名稱】：{node_title}
        【大綱描述與內容】：
        {macro_text}
        
        請拆解成 3 ~ 6 個具體任務，每個任務的設計原則：
        1. 動作必須極度具體（例如：「寫出主角出場的 3 句外貌描述」，而非「寫主角出場」；「列出第3段技術名詞的定義」，而非「撰寫技術細節」）。
        2. 預期時間為 15~25 分鐘。
        3. 任務之間有前後邏輯關聯，能減輕工作記憶負擔。
        
        請務必以 JSON 格式回傳，格式範例如下：
        {{
            "tasks": [
                {{"title": "微任務名稱 1", "duration_minutes": 20}},
                {{"title": "微任務名稱 2", "duration_minutes": 15}}
            ]
        }}
        """
        
        system_prompt = "你是一位精通 ADHD 心理學與高效寫作的工作流拆解專家。只回傳 JSON 格式，不要有額外贅字。"
        
        # 3. 呼叫 LLM
        response_text = await ai_client.generate(prompt, system_prompt=system_prompt)
        
        # 4. 解析 JSON
        try:
            # 清理 Markdown 代碼區塊標記
            cleaned_response = response_text.replace("```json", "").replace("```", "").strip()
            task_data = json.loads(cleaned_response)
            tasks_list = task_data.get("tasks", [])
        except Exception:
            # 解析失敗時的降級防錯機制 (模擬拆解)
            tasks_list = [
                {"title": f"【草稿】撰寫 {node_title} 的核心觀點及架構", "duration_minutes": 20},
                {"title": f"【素材】檢索並整理與 {node_title} 相關的 2 個文獻/參考資料", "duration_minutes": 20},
                {"title": f"【寫作】進行 {node_title} 的碎片化靈感寫作與草稿打底", "duration_minutes": 20},
                {"title": f"【潤飾】對 {node_title} 初步草稿進行語意潤飾與 Persona 套用", "duration_minutes": 15}
            ]

        # 5. 寫入資料庫
        created_tasks = []
        created_at = datetime.now().isoformat()
        
        for idx, t in enumerate(tasks_list):
            task_id = str(uuid.uuid4())
            title = t.get("title", f"微任務 {idx + 1}")
            duration = t.get("duration_minutes", 20)
            
            db.execute(
                """
                INSERT INTO tasks (id, project_id, outline_node_id, title, duration_minutes, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?)
                """,
                (task_id, project_id, outline_node_id, title, duration, created_at)
            )
            created_tasks.append({
                "id": task_id,
                "project_id": project_id,
                "outline_node_id": outline_node_id,
                "title": title,
                "duration_minutes": duration,
                "status": "pending"
            })
            
        return created_tasks

    @staticmethod
    def get_daily_schedule() -> List[Dict[str, Any]]:
        """
        [功能] 動態優先級排程
        自動根據多專案的截稿日 (Deadlines)，分配每日的跨專案任務配盤。
        演算法：
        1. 撈出所有待處理任務 (status = 'pending') 及其所屬專案的截止日期。
        2. 將專案依截止日期排序（越近的優先權越高；無截止日期的排最後）。
        3. 當天任務配盤策略：
           - 優先度高的專案分配 3 個任務。
           - 次要專案分配 1-2 個任務。
           - 形成一條清晰、無 Context Switch 負擔的「今日聚焦任務流」。
        """
        # 1. 取得所有專案資訊 (包括 deadline)
        projects = db.query_all("SELECT id, name, deadline FROM projects")
        
        # 2. 依截止日期排序專案
        # 將 None 或空的 deadline 排在最後面
        def parse_deadline(p):
            dl = p.get("deadline")
            if not dl:
                return datetime.max
            try:
                return datetime.fromisoformat(dl)
            except ValueError:
                return datetime.max
                
        sorted_projects = sorted(projects, key=parse_deadline)
        
        # 3. 撈取所有 Pending 任務
        all_pending_tasks = db.query_all("""
            SELECT t.id, t.title, t.duration_minutes, t.project_id, p.name as project_name, t.outline_node_id, o.title as outline_title
            FROM tasks t
            JOIN projects p ON t.project_id = p.id
            LEFT JOIN outline_nodes o ON t.outline_node_id = o.id
            WHERE t.status = 'pending'
        """)
        
        # 按照 project_id 將任務分組
        tasks_by_project: Dict[str, List[Dict[str, Any]]] = {}
        for task in all_pending_tasks:
            pid = task["project_id"]
            if pid not in tasks_by_project:
                tasks_by_project[pid] = []
            tasks_by_project[pid].append(task)
            
        # 4. 配盤：建立每日推薦工作流 (限制今日總任務數，防範 ADHD 創作者看見清單崩潰)
        daily_schedule = []
        max_daily_tasks = 5 # 每日上限 5 個任務，降低認知載重
        
        # 從排序後的專案依序取任務，截止日期越近取越多
        task_allocations = {
            0: 3, # 最緊急的專案取 3 個任務
            1: 1, # 次緊急專案取 1 個任務
            2: 1  # 第三緊急專案取 1 個任務
        }
        
        for idx, proj in enumerate(sorted_projects):
            pid = proj["id"]
            if pid not in tasks_by_project or not tasks_by_project[pid]:
                continue
                
            # 決定此專案的分配額度
            allocation = task_allocations.get(idx, 1)
            project_tasks = tasks_by_project[pid][:allocation]
            
            for t in project_tasks:
                if len(daily_schedule) < max_daily_tasks:
                    daily_schedule.append({
                        **t,
                        "urgency_rank": idx + 1
                    })
                    
        return daily_schedule
