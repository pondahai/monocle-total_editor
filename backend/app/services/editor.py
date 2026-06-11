from typing import Optional, Dict, Any
from backend.app.database import db
from backend.app.llm_client import ai_client
from backend.app.services.resource import ResourceManagerService

class EditorService:
    """
    漸進式的「標準編輯與潤飾」模組 (Editor)
    """
    
    @staticmethod
    async def polish_draft_with_tone(
        project_id: str, 
        outline_node_id: str, 
        draft_text: str
    ) -> Dict[str, Any]:
        """
        [工具] polish_draft_with_tone
        接收微任務完成的訊號後，依據該專案設定的 Persona 自動重構與潤飾文字。
        """
        # 1. 撈取專案資訊 (主要為 Persona/Style 設定)
        project = db.query_one("SELECT name, persona_prompt FROM projects WHERE id = ?", (project_id,))
        if not project:
            raise ValueError(f"專案 {project_id} 不存在")
            
        persona_prompt = project.get("persona_prompt") or "你是一個專業的寫作編輯，請用流暢、生動且結構清晰的文字進行潤飾。"
        
        # 2. 自動撈取與該草稿高度相關的「參考材料上下文」 (RAG)
        # 藉由將草稿文字做 Query，自向量資料庫中撈出最相關的片段
        context_chunks = await ResourceManagerService.retrieve_active_context_resources(
            project_id=project_id,
            outline_node_id=outline_node_id,
            query_text=draft_text,
            top_k=3
        )
        
        # 組合參考材料文字
        reference_context = ""
        if context_chunks:
            reference_context = "\n【寫作參考背景材料】：\n"
            for idx, chunk in enumerate(context_chunks):
                ref_text = chunk["metadata"]["text"]
                ref_file = chunk["metadata"]["filename"]
                reference_context += f"--- 參考來源 [{ref_file}] ---\n{ref_text}\n"
        
        # 3. 取得目前大綱章節名稱
        node = db.query_one("SELECT title FROM outline_nodes WHERE id = ?", (outline_node_id,))
        chapter_title = node["title"] if node else "未命名章節"

        # 4. 設計潤飾 Prompt
        prompt = f"""
        你是一位文字編輯大師。請依據指定的【文風設定】與提供之【寫作參考背景材料】，對創作者提供的【原始寫作草稿】進行重構與潤飾。
        
        【當前寫作章節】：{chapter_title}
        {reference_context}
        
        【原始寫作草稿】：
        {draft_text}
        
        【潤飾要求】：
        1. 嚴格遵守下方給予的【文風設定】。
        2. 充分結合【寫作參考背景材料】中的事實與專有名詞，修正草稿中的模糊表述或資訊遺漏。
        3. 保留作者的核心思想，但提升語意流暢度、排版易讀性與詞彙精確度。
        4. 僅回傳潤飾完成後的最終正文，不要有任何「好的，以下是潤飾後的內容：」等冗餘說明。
        """
        
        # 5. 呼叫本地 LLM
        polished_text = await ai_client.generate(prompt=prompt, system_prompt=persona_prompt)
        
        # 6. 自動更新大綱節點中的 content (草稿暫存)
        db.execute(
            "UPDATE outline_nodes SET content = ?, status = 'polish' WHERE id = ?",
            (polished_text, outline_node_id)
        )
        
        return {
            "project_id": project_id,
            "outline_node_id": outline_node_id,
            "original_draft": draft_text,
            "polished_content": polished_text,
            "context_used": [c["metadata"]["filename"] for c in context_chunks]
        }

    @staticmethod
    def save_raw_draft(outline_node_id: str, draft_text: str):
        """
        草稿模式下，關閉嚴格校對，快速、碎片化地儲存靈感紀錄。
        """
        db.execute(
            "UPDATE outline_nodes SET content = ?, status = 'writing' WHERE id = ?",
            (draft_text, outline_node_id)
        )
        return {"status": "success", "saved_length": len(draft_text)}
