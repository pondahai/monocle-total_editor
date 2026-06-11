import os
from pydantic_settings import BaseSettings if False else object # Allow fallback if pydantic-settings not installed

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
    
    # 預設本地 LLM 伺服器 (如 Ollama API 或 LocalAI)
    LLM_API_URL: str = os.getenv("LLM_API_URL", "http://localhost:11434")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "llama3") # 可以由用戶自由設定

settings = Settings()

# Ensure directories exist
os.makedirs(settings.DATA_DIR, exist_ok=True)
os.makedirs(settings.PROJECTS_DIR, exist_ok=True)
