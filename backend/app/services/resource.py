import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from backend.app.database import db
from backend.app.vector_store import vector_store_manager
from backend.app.llm_client import ai_client

class ResourceManagerService:
    """
    脈絡化的「材料資源管理器」 (Resource Manager)
    """
    
    @staticmethod
    def _chunk_text(text: str, chunk_size: int = 400, overlap: int = 80) -> List[str]:
        """
        將長文本切碎為重疊的區塊 (Chunks)
        """
        chunks = []
        if not text:
            return chunks
            
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = min(start + chunk_size, text_len)
            chunks.append(text[start:end])
            if end == text_len:
                break
            start += chunk_size - overlap
            
        return chunks

    @classmethod
    async def ingest_and_anchor_material(
        cls, 
        project_id: str, 
        filename: str, 
        raw_content: str, 
        outline_node_id: Optional[str] = None,
        source_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        [工具] ingest_and_anchor_material
        將上傳的 PDF/網頁/筆記進行 Embedding，並強制綁定特定專案的 Namespace 與大綱節點。
        """
        # 1. 寫入 SQLite 記錄 (材料總檔)
        material_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        
        db.execute(
            """
            INSERT INTO materials (id, project_id, outline_node_id, filename, source_url, raw_content, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (material_id, project_id, outline_node_id, filename, source_url, raw_content, created_at)
        )
        
        # 2. 將文字切碎成語意區塊 (Chunks)
        chunks = cls._chunk_text(raw_content)
        if not chunks:
            return {"material_id": material_id, "chunks_ingested": 0}
            
        # 3. 呼叫本地 Embedding 伺服器，批次取得向量
        chunk_ids = []
        vectors = []
        for idx, chunk in enumerate(chunks):
            chunk_id = f"{material_id}_chunk_{idx}"
            vector = await ai_client.get_embedding(chunk)
            
            chunk_ids.append(chunk_id)
            vectors.append(vector)
            
        # 4. 寫入該專案「物理隔離」的向量資料庫 (Namespace)
        store = vector_store_manager.get_store(project_id)
        # 如果該檔案之前已被上傳，先清除舊的 Vector 與 Metadata (防範重複寫入)
        store.delete_chunks_by_filename(filename)
        store.add_chunks(
            chunk_ids=chunk_ids,
            texts=chunks,
            vectors=vectors,
            filename=filename,
            outline_node_id=outline_node_id
        )
        
        return {
            "material_id": material_id,
            "filename": filename,
            "outline_node_id": outline_node_id,
            "chunks_count": len(chunks)
        }

    @staticmethod
    async def retrieve_active_context_resources(
        project_id: str, 
        outline_node_id: Optional[str], 
        query_text: str, 
        top_k: int = 3
    ) -> List[Dict[str, Any]]:
        """
        [工具] retrieve_active_context_resources
        當前端狀態機切換到特定章節時，自動撈出該章節關聯度最高的核心材料，推送至側邊欄。
        """
        if not query_text or query_text.strip() == "":
            # 如果沒有查詢字詞，則撈取該大綱節點下最新上傳的幾筆片段作為預設上下文
            store = vector_store_manager.get_store(project_id)
            # 遍歷元資料直接過濾出該 outline_node_id 的片段
            matched = [
                {"metadata": meta, "score": 1.0, "boosted_score": 1.0} 
                for meta in store.metadata 
                if outline_node_id and meta.get("outline_node_id") == outline_node_id
            ]
            return matched[:top_k]
            
        # 1. 取得 query_text 的向量
        query_vector = await ai_client.get_embedding(query_text)
        
        # 2. 在該專案的 Namespace 下進行相似度搜尋
        store = vector_store_manager.get_store(project_id)
        search_results = store.similarity_search(
            query_vector=query_vector,
            outline_node_id=outline_node_id,
            top_k=top_k
        )
        
        return search_results
