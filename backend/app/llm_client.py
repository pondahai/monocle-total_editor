import httpx
import logging
import random
from typing import List, Optional
from backend.app.config import settings

logger = logging.getLogger(__name__)

class AIClient:
    """
    負責與本地 LLM (如 Ollama) 及 Embedding 伺服器 (Port 8002 BGE-M3) 對接。
    包含安全降級與 Mock 機制，確保本機測試時若伺服器未開啟，系統不會崩潰。
    """
    
    @staticmethod
    async def get_embedding(text: str) -> List[float]:
        """
        請求本地 Embedding 伺服器取得向量 (預設維度: 1024，如 BGE-M3)。
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # 支援兩種常見的本地 Embedding API 格式
                # 格式 A: 自訂輕量級服務 {"text": "..."} -> {"embedding": [...]}
                # 格式 B: OpenAI 規格 {"input": "..."} -> {"data": [{"embedding": [...]}]}
                
                # 嘗試發送 格式 A
                response = await client.post(
                    settings.EMBEDDING_API_URL, 
                    json={"text": text}
                )
                if response.status_code == 200:
                    data = response.json()
                    if "embedding" in data:
                        return data["embedding"]
                    elif "embeddings" in data and len(data["embeddings"]) > 0:
                        return data["embeddings"][0]

                # 嘗試發送 格式 B (OpenAI/Ollama 相容)
                response = await client.post(
                    settings.EMBEDDING_API_URL, 
                    json={"input": text, "model": "bge-m3"}
                )
                if response.status_code == 200:
                    data = response.json()
                    if "data" in data and len(data["data"]) > 0:
                        return data["data"][0]["embedding"]
                    
            raise Exception(f"Embedding server returned status {response.status_code}")
            
        except Exception as e:
            logger.warning(f"無法連線至 Embedding 伺服器 ({settings.EMBEDDING_API_URL}): {str(e)}。啟用 Mock 隨機向量降級。")
            # 降級機制：回傳隨機 1024 維度向量（模擬 BGE-M3）
            # 為了讓相同文字回傳相同 mock 向量以進行相似度測試，我們使用 hash seed
            random.seed(hash(text))
            mock_vector = [random.uniform(-1.0, 1.0) for _ in range(1024)]
            # 歸一化
            norm = sum(x**2 for x in mock_vector)**0.5
            return [x/norm for x in mock_vector]

    @staticmethod
    async def generate(prompt: str, system_prompt: Optional[str] = None) -> str:
        """
        呼叫本地 LLM (如 Ollama 或 OpenAI 相容伺服器) 生成文本。
        """
        model_name = settings.LLM_MODEL
        url = settings.LLM_API_URL.strip()
        
        # 動態常規化 API 端點
        if "/v1/models" in url:
            openai_url = url.replace("/v1/models", "/v1/chat/completions")
            base_url = url.replace("/v1/models", "").rstrip("/")
            ollama_url = f"{base_url}/api/generate"
        elif "/v1" in url:
            openai_url = f"{url.rstrip('/')}/chat/completions"
            base_url = url.split("/v1")[0].rstrip("/")
            ollama_url = f"{base_url}/api/generate"
        else:
            ollama_url = f"{url.rstrip('/')}/api/generate"
            openai_url = f"{url.rstrip('/')}/v1/chat/completions"
            
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                # 1. 優先嘗試以 OpenAI 相容格式發送 (因為設定了 /v1/models 這類 OpenAI 格式)
                if "/v1" in url or "/v1/models" in url:
                    openai_payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt or "你是一個專業的寫作助手。"},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.7
                    }
                    response = await client.post(openai_url, json=openai_payload)
                    if response.status_code == 200:
                        return response.json()["choices"][0]["message"]["content"].strip()
                
                # 2. 備用或預設嘗試 Ollama API 格式
                if ollama_url:
                    payload = {
                        "model": model_name,
                        "prompt": prompt,
                        "system": system_prompt or "你是一個專業的寫作助手。",
                        "stream": False
                    }
                    response = await client.post(ollama_url, json=payload)
                    if response.status_code == 200:
                        return response.json().get("response", "").strip()
                        
                # 3. 如果前面的條件沒滿足或失敗，嘗試用另一種格式作為 fallback
                if "/v1" not in url and "/v1/models" not in url:
                    openai_payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt or "你是一個專業的寫作助手。"},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.7
                    }
                    response = await client.post(openai_url, json=openai_payload)
                    if response.status_code == 200:
                        return response.json()["choices"][0]["message"]["content"].strip()
                    
            raise Exception(f"LLM server returned status {response.status_code}")
            
        except Exception as e:
            logger.warning(f"無法連線至 LLM 伺服器 ({settings.LLM_API_URL}): {str(e)}。啟用 Mock 文本產出。")
            # 降級機制：回傳模擬的 AI 處理結果
            return f"【本地 LLM 離線模擬回覆】\n收到提示詞：「{prompt[:60]}...」\n本系統正在模擬離線狀態下的處理。如果您已啟動 Ollama 或其他 LLM，請檢查 API 端點是否為 {settings.LLM_API_URL}。\n\n[模擬潤飾文字]\n您輸入的草稿已經過 Mock 模組改寫，文風設定：{system_prompt or '預設寫作風格'}"

ai_client = AIClient()
