import sys
import os
import uvicorn

# 自動將當前專案根目錄加入 Python 模組搜尋路徑，避免 Import 錯誤
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    print("Starting Total Editor & Portfolio Manager Backend...")
    print("API docs will be available at http://localhost:8000/docs")
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
