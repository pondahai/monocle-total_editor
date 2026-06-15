import json
import logging
from typing import Optional, Dict, Any
from backend.app.database import db
from backend.app.llm_client import ai_client
from backend.app.services.resource import ResourceManagerService

logger = logging.getLogger(__name__)

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
        chapter_title = (node.get("title") or "未命名章節") if node else "未命名章節"

        # 4. 設計動態且穩健的潤飾 Prompt
        prompt = f"你是一位文字編輯大師。請對創作者提供的【原始寫作草稿】進行重構與潤飾。\n\n"
        prompt += f"【當前寫作章節】：{chapter_title}\n"
        
        if reference_context:
            prompt += f"{reference_context}\n"
            
        prompt += f"【原始寫作草稿】：\n{draft_text}\n\n"
        
        prompt += "【潤飾與重構要求】：\n"
        prompt += "1. 嚴格遵守系統提示詞 (System Prompt) 中的【文風設定】進行文字風格調整。\n"
        if reference_context:
            prompt += "2. 充分結合提供的【寫作參考背景材料】中的事實與設定，修正草稿中的模糊表述，確保細節吻合。\n"
        prompt += "3. 保留創作者的核心大綱與中心思想，提升語意流暢度、排版易讀性、用詞豐富度與畫面感。\n"
        prompt += "4. ⚠️非常重要：僅回傳重構與潤飾後的最終正文文章，禁止回傳任何如「好的，以下是潤飾後的內容」或「請提供文風設定」等前言、結尾、廢話或疑問句。不論輸入是否完整，都請直接輸出重構後的文章內容。\n"
        
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

    @staticmethod
    async def generate_guiding_questions(
        project_id: str,
        outline_node_id: str
    ) -> Dict[str, Any]:
        """
        針對當前大綱與專案 Persona 生成 3 個引導作者寫作的具體問題。
        """
        project = db.query_one("SELECT name, persona_prompt FROM projects WHERE id = ?", (project_id,))
        node = db.query_one("SELECT title, description FROM outline_nodes WHERE id = ?", (outline_node_id,))
        if not project:
            raise ValueError(f"專案 {project_id} 不存在")
            
        persona_prompt = project.get("persona_prompt") or "你是一個專業的寫作編輯。"
        chapter_title = (node.get("title") or "未命名章節") if node else "未命名章節"
        chapter_desc = (node.get("description") or "") if node else ""
        
        # 撈取相關背景素材 (RAG)
        context_chunks = await ResourceManagerService.retrieve_active_context_resources(
            project_id=project_id,
            outline_node_id=outline_node_id,
            query_text=chapter_title + " " + chapter_desc,
            top_k=2
        )
        
        reference_context = ""
        if context_chunks:
            reference_context = "\n【參考背景素材】：\n"
            for chunk in context_chunks:
                reference_context += f"- {chunk['metadata']['filename']}: {chunk['metadata']['text'][:200]}...\n"

        prompt = f"""
        你是一位溫和且極具啟發性的寫作教練（Writing Coach）。
        請針對專案風格、當前寫作章節及背景素材，為作者設計 3 個簡單、具體、容易回答的引導問題，協助克服空白頁面焦慮。
        這些問題應該引導作者去思考：環境細節、角色當下情緒/行為、或者接下來要發生的關鍵事件。
        
        【當前章節】：{chapter_title} (描述: {chapter_desc})
        {reference_context}
        
        【要求】：
        1. 僅回傳 3 個問題，問題要簡短（不超過 30 字），不需要長篇大論。
        2. 請以標準 JSON 格式回傳，結構為一個 string array，例如：
        ["在這個場景中，主角首先看到了什麼環境細節？", "主角此時內心最害怕或最渴望的是什麼？", "這個章節結束前，會發生什麼突發狀況？"]
        3. 不要包含 markdown 的 ```json 標記，僅回傳 JSON 字串。若生成失敗或無法連線，必須回傳合法 JSON 格式。
        """
        
        try:
            raw_response = await ai_client.generate(prompt=prompt, system_prompt=persona_prompt)
            # 清理可能的 markdown 語法
            cleaned = raw_response.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            questions = json.loads(cleaned)
            if not isinstance(questions, list):
                raise ValueError("LLM did not return a list")
            questions = [str(q) for q in questions[:3]]
        except Exception as e:
            logger.warning(f"產生引導問題失敗，啟用降級 Mock 問題: {e}")
            questions = [
                f"在「{chapter_title}」這個章節中，主角身處在什麼樣的環境或背景？",
                "此時此刻，主角的心理活動或核心動機是什麼？",
                "本章節中，哪一個細節、衝突或對話是你想特別強調的？"
            ]
            
        return {
            "project_id": project_id,
            "outline_node_id": outline_node_id,
            "questions": questions
        }

    @staticmethod
    async def fuse_answers_to_draft(
        project_id: str,
        outline_node_id: str,
        answers: list
    ) -> Dict[str, Any]:
        """
        將創作者對引導問題的簡短回答，融合成連貫、生動的故事段落或論述草稿。
        """
        project = db.query_one("SELECT name, persona_prompt FROM projects WHERE id = ?", (project_id,))
        node = db.query_one("SELECT title FROM outline_nodes WHERE id = ?", (outline_node_id,))
        if not project:
            raise ValueError(f"專案 {project_id} 不存在")
            
        persona_prompt = project.get("persona_prompt") or "你是一個專業的寫作編輯。"
        chapter_title = (node.get("title") or "未命名章節") if node else "未命名章節"
        
        # 組合問答文本
        qa_text = ""
        for idx, item in enumerate(answers):
            q = item.get("question") or ""
            a = item.get("answer") or ""
            if a.strip():
                qa_text += f"問：{q}\n答：{a}\n\n"
                
        if not qa_text.strip():
            return {
                "fused_draft": "",
                "message": "作者未提供任何回答，無法進行融合。"
            }
            
        # 撈取背景素材 (RAG)
        context_chunks = await ResourceManagerService.retrieve_active_context_resources(
            project_id=project_id,
            outline_node_id=outline_node_id,
            query_text=qa_text,
            top_k=2
        )
        
        reference_context = ""
        if context_chunks:
            reference_context = "\n【寫作參考背景材料】：\n"
            for chunk in context_chunks:
                reference_context += f"- {chunk['metadata']['filename']}: {chunk['metadata']['text']}\n"

        # 3. 設計融合 Prompt
        prompt = f"你是一位寫作融合大師。請將創作者對引導問題的回答，融合擴展為一段連貫、流暢、具有畫面感的故事或論述草稿正文。\n\n"
        prompt += f"【當前寫作章節】：{chapter_title}\n"
        if reference_context:
            prompt += f"{reference_context}\n"
            
        prompt += f"【創作者的引導問答內容】：\n{qa_text}\n"
        
        prompt += "【融合重構要求】：\n"
        prompt += "1. 嚴格遵守系統提示詞 (System Prompt) 中的【文風設定】。\n"
        prompt += "2. 將創作者簡短的碎片化回答進行合理的細節擴展、場景鋪陳與情節串接，形成一段流暢自然的敘事。\n"
        prompt += "3. 不要以問答形式呈現，僅回傳融合完成後的最終文章段落正文。\n"
        prompt += "4. ⚠️非常重要：僅回傳融合後的正文段落。禁止回傳任何解釋、提問、或「好的，以下是融合後的草稿」等冗餘說明，不論輸入是否完整，都請直接輸出最終的文章正文內容。\n"
        
        try:
            fused_draft = await ai_client.generate(prompt=prompt, system_prompt=persona_prompt)
        except Exception as e:
            logger.warning(f"融合問答失敗，啟用降級拼接: {e}")
            fused_draft = "【AI 離線拼接草稿】\n"
            for item in answers:
                fused_draft += f"{item.get('answer', '')} "
            fused_draft = fused_draft.strip()
            
        return {
            "project_id": project_id,
            "outline_node_id": outline_node_id,
            "fused_draft": fused_draft
        }
