import os

class Settings:
    # API Settings
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # Storage Settings
    DATA_DIR: str = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    
    @property
    def DB_PATH(self) -> str:
        return os.path.join(self.DATA_DIR, "total_editor.db")
        
    @property
    def PROJECTS_DIR(self) -> str:
        return os.path.join(self.DATA_DIR, "projects")

    # Local AI Services Settings
    # 預設本地 Embedding 伺服器 (Port 8002 BGE-M3 等服務)
    EMBEDDING_API_URL: str = os.getenv("EMBEDDING_API_URL", "http://localhost:8002/embed")
    
    # 預設本地/區網 LLM 伺服器 (OpenAI 相容，如 llama.cpp / Ollama / LocalAI)
    # 此為「初始 fallback」；實際 active 設定由使用者於前端選擇並存於 global_state。
    LLM_API_URL: str = os.getenv("LLM_API_URL", "http://192.168.0.17:8080/v1")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemma-4-12B-it-QAT-Q4_0.gguf") # 可由環境變數 LLM_MODEL 覆蓋

    # 前端 LLM 引擎選單的預設選項清單 (使用者亦可選「自訂」手動輸入)
    LLM_PRESETS = [
        {
            "id": "gemma",
            "name": "Gemma 12B (192.168.0.17)",
            "api_url": "http://192.168.0.17:8080/v1",
            "model": "gemma-4-12B-it-QAT-Q4_0.gguf",
        },
        {
            "id": "gpt-oss",
            "name": "GPT-OSS 120B (192.168.0.110)",
            "api_url": "http://192.168.0.110:8001/v1",
            "model": "openai/gpt-oss-120b",
        },
        {
            "id": "ollama",
            "name": "本機 Ollama (localhost:11434)",
            "api_url": "http://localhost:11434",
            "model": "llama3",
        },
    ]

settings = Settings()

# Ensure directories exist
os.makedirs(settings.DATA_DIR, exist_ok=True)
os.makedirs(settings.PROJECTS_DIR, exist_ok=True)
