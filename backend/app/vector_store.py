import os
import json
import numpy as np
from typing import List, Dict, Any, Optional
from backend.app.config import settings

class ProjectVectorStore:
    """
    專屬特定專案的向量儲存空間。
    物理隔離：每個專案在硬碟上都有獨立的資料夾，儲存其專屬的 vectors.npz 與 metadata.json。
    """
    def __init__(self, project_id: str):
        self.project_id = project_id
        self.project_dir = os.path.join(settings.PROJECTS_DIR, project_id)
        os.makedirs(self.project_dir, exist_ok=True)
        
        self.vectors_path = os.path.join(self.project_dir, "vectors.npz")
        self.metadata_path = os.path.join(self.project_dir, "metadata.json")
        
        self.embeddings: Optional[np.ndarray] = None
        self.metadata: List[Dict[str, Any]] = []
        self._load()

    def _load(self):
        # 載入 Metadata
        if os.path.exists(self.metadata_path):
            with open(self.metadata_path, "r", encoding="utf-8") as f:
                self.metadata = json.load(f)
        else:
            self.metadata = []

        # 載入 向量陣列
        if os.path.exists(self.vectors_path):
            try:
                data = np.load(self.vectors_path)
                self.embeddings = data.get("embeddings", None)
            except Exception:
                self.embeddings = None
        else:
            self.embeddings = None

    def _save(self):
        # 儲存 Metadata
        with open(self.metadata_path, "w", encoding="utf-8") as f:
            json.dump(self.metadata, f, ensure_ascii=False, indent=2)
        
        # 儲存 向量陣列
        if self.embeddings is not None:
            np.savez_compressed(self.vectors_path, embeddings=self.embeddings)

    def add_chunks(self, chunk_ids: List[str], texts: List[str], vectors: List[List[float]], filename: str, outline_node_id: Optional[str] = None):
        """
        新增材料區塊向量與元資料，並錨定至特定大綱節點。
        """
        new_embeddings = np.array(vectors, dtype=np.float32)
        
        if self.embeddings is None:
            self.embeddings = new_embeddings
        else:
            self.embeddings = np.vstack([self.embeddings, new_embeddings])
            
        for cid, text in zip(chunk_ids, texts):
            self.metadata.append({
                "chunk_id": cid,
                "filename": filename,
                "outline_node_id": outline_node_id, # 大綱錨定
                "text": text,
                "created_at": np.datetime64('now').astype(str)
            })
            
        self._save()

    def delete_chunks_by_filename(self, filename: str):
        """
        刪除特定檔案的所有 Vector 與 Metadata
        """
        if not self.metadata:
            return
            
        keep_indices = []
        new_metadata = []
        
        for idx, meta in enumerate(self.metadata):
            if meta["filename"] != filename:
                keep_indices.append(idx)
                new_metadata.append(meta)
                
        if len(keep_indices) == len(self.metadata):
            return # 沒有需要刪除的
            
        self.metadata = new_metadata
        if self.embeddings is not None:
            if keep_indices:
                self.embeddings = self.embeddings[keep_indices]
            else:
                self.embeddings = None
                
        self._save()

    def delete_chunks_by_prefix(self, chunk_id_prefix: str):
        """
        依 chunk_id 前綴精準刪除某一筆材料的所有 Vector 與 Metadata。
        相較 delete_chunks_by_filename，可避免同檔名多材料時誤刪。
        """
        if not self.metadata:
            return

        keep_indices = []
        new_metadata = []

        for idx, meta in enumerate(self.metadata):
            if not str(meta.get("chunk_id", "")).startswith(chunk_id_prefix):
                keep_indices.append(idx)
                new_metadata.append(meta)

        if len(keep_indices) == len(self.metadata):
            return  # 沒有需要刪除的

        self.metadata = new_metadata
        if self.embeddings is not None:
            if keep_indices:
                self.embeddings = self.embeddings[keep_indices]
            else:
                self.embeddings = None

        self._save()

    def similarity_search(self, query_vector: List[float], outline_node_id: Optional[str] = None, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        在專案 Namespace 內進行餘弦相似度檢索。
        支援大綱錨定優先過濾：若指定了 outline_node_id，可優先篩選與該大綱錨定的材料。
        """
        if self.embeddings is None or len(self.metadata) == 0:
            return []
            
        q_vec = np.array(query_vector, dtype=np.float32)
        
        # 計算餘弦相似度
        norm_embeds = np.linalg.norm(self.embeddings, axis=1)
        norm_q = np.linalg.norm(q_vec)
        
        # 避免除以 0
        norm_embeds[norm_embeds == 0] = 1e-10
        if norm_q == 0:
            norm_q = 1e-10
            
        similarities = np.dot(self.embeddings, q_vec) / (norm_embeds * norm_q)
        
        # 建立結果清單
        results = []
        for idx, meta in enumerate(self.metadata):
            score = float(similarities[idx])
            
            # 若有指定大綱錨定，給予大綱匹配的權重加成，或者進行硬性篩選。
            # 這裡採用「優先推薦錨定於當前章節的材料，但也允許跨章節的全局高度相關材料」的彈性設計
            boosted_score = score
            if outline_node_id and meta.get("outline_node_id") == outline_node_id:
                boosted_score += 0.15 # 錨定加分，提升在側邊欄的優先權
                
            results.append({
                "metadata": meta,
                "score": score,
                "boosted_score": boosted_score
            })
            
        # 依分數排序
        results.sort(key=lambda x: x["boosted_score"], reverse=True)
        return results[:top_k]

class VectorStoreManager:
    """
    向量資料庫管理員，負責動態載入不同專案的 Namespace 儲存體。
    """
    def __init__(self):
        self._stores: Dict[str, ProjectVectorStore] = {}

    def get_store(self, project_id: str) -> ProjectVectorStore:
        if project_id not in self._stores:
            self._stores[project_id] = ProjectVectorStore(project_id)
        return self._stores[project_id]

vector_store_manager = VectorStoreManager()
