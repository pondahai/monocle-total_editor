# Monocle: Total Editor & Portfolio Manager

> **專為 ADHD 與多專案創作者打造的 Headless (無頭式) 雙介面寫作輔助與 AI Agent 系統。**

本專案採用 **Vibe Coding** 精神開發，重視底層邏輯與資料流的精確掌控，不依賴過度封裝的第三方框架。資料與隱私 100% 留在本地（Local-First），支援本地端 LLM (Ollama) 與獨立的 Embedding 伺服器，確保創作素材不流出內網。

---

## 👁️ 核心設計理念：雙介面連動

- **Macro 視角 (Web Dashboard - 主控中心)**：用於專案初始化、大綱建立、素材上傳、全局時間排程與 Persona (文風) 設定。
- **Micro 視角 (Chrome Extension / Sidebar - 隨身教練)**：掛載於寫作網頁旁，隱藏複雜資訊，僅提供「微任務計時」、「當前段落專屬素材顯示」與「一鍵潤飾」按鈕，幫助收束注意力。

---

## 🛠️ 核心功能模組

### 1. ADHD-友善的「微任務」時間管理器 (Time Manager)
- **微步進機制 (Micro-stepping)**：自動將宏觀大綱切碎為 20 分鐘內可完成、動作極其具體的行動清單（避免 ADHD 創作者因任務過大產生拖延焦慮）。
- **動態優先級排程**：根據跨專案的截止日期 (Deadlines) 自動產生每日聚焦任務配盤，降低心智切換 (Context Switch) 負荷。

### 2. 脈絡化的「材料資源管理器」 (Resource Manager)
- **物理隔離的向量空間 (Isolated Vector Namespaces)**：不同專案的資料完全存放在獨立的資料夾中，在向量檢索上做到物理隔離。
- **大綱錨定與權重加成 (Outline Anchoring & Boosting)**：材料可強制綁定特定大綱節點。當切換寫作章節時，側邊欄會自動撈出關聯度最高的核心材料並給予加分推薦。

### 3. 漸進式的「標準編輯與潤飾」模組 (Editor)
- **無壓力草稿模式**：草稿階段關閉嚴格校對，允許碎片化靈感隨手記錄。
- **Persona 一鍵潤飾**：接收微任務完成信號後，結合 RAG 檢索背景材料與專案設定的 System Prompt (如：硬核科幻、嚴謹技術文件) 自動重構與潤飾文字。

---

## 📂 專案目錄結構

```text
monocle-total_editor/
├── run_backend.py              # 後端服務啟動腳本 (自動處理模組路徑)
├── backend/
│   ├── requirements.txt        # 後端依賴套件清單 (FastAPI, NumPy, HTTPX等)
│   └── app/
│       ├── __init__.py
│       ├── main.py              # FastAPI 路由與 API 接口定義
│       ├── config.py            # 全域設定 (LLM 連線埠、路徑等)
│       ├── database.py          # SQLite 資料庫初始化與資料存取
│       ├── state.py             # 單一事實來源全域狀態機 (控制計時器與活躍狀態)
│       ├── vector_store.py      # 基於 NumPy+SQLite 的專案物理隔離向量庫
│       ├── llm_client.py        # 本地 LLM & Embedding 連線客戶端 (含斷線安全降級)
│       ├── models.py            # Pydantic 資料結構定義
│       └── services/            # 核心領域業務邏輯
│           ├── __init__.py
│           ├── scheduler.py     # 時間管理排程與大綱切碎服務
│           ├── resource.py      # 材料切片與 RAG 檢索服務
│           └── editor.py        # 草稿暫存與 AI 潤飾服務
└── data/                        # [本地自動產生] 儲存所有資料 (不加入 Git)
    ├── total_editor.db          # 系統全域 SQLite 資料庫
    └── projects/                # 專案獨立向量/材料資料夾
        └── {project_id}/
            ├── vectors.npz      # 該專案獨立的材料向量檔
            └── metadata.json    # 該專案獨立的文本切片元資料
```

---

## 🚀 快速開始指南 (本地部署)

### 1. 安裝環境依賴

請確保您的電腦已安裝 Python 3.8+。在終端機中進入本專案根目錄，執行：

```bash
pip install -r backend/requirements.txt
```

### 2. 啟動本機 AI 服務 (選用)

Monocle 預設會嘗試連線至以下本地 AI 服務：
- **Embedding 伺服器**：預設連接 `http://localhost:8002/embed` (例如提供 BGE-M3 向量模型的服務)。
- **LLM 伺服器**：預設連接 `http://localhost:11434` (Ollama 預設 Port)。

> **💡 安全降級提示**：
> 如果您未啟動上述本地服務，系統將自動啟用 **Mock 安全降級模式**。它會使用隨機的 1024 維向量進行餘弦相似度運算，並輸出虛擬的 AI 潤飾文字，讓您無須 AI 環境即可進行後端功能開發與測試。

### 3. 運行後端 API

在根目錄下執行：

```bash
python run_backend.py
```

伺服器啟動後會運行在 `http://localhost:8000`。

### 4. 體驗 Web Dashboard 寫作工作區

伺服器運行後，直接打開瀏覽器前往：
👉 **[http://localhost:8000/](http://localhost:8000/)**

您會看到一個整合了專案管理、大綱切碎、今日排程、背景知識庫以及富含 Web Audio 多巴胺完成音效與 Canvas 紙花物理效果的**太空黑玻璃擬態（Glassmorphism）主控台**！

### 5. 安裝 Chrome Extension (Micro 隨身教練側邊欄)

為了在任何寫作網站（如 Notion, Google Docs, Medium）旁掛載隨身側邊欄：

1. 開啟 Chrome 瀏覽器，前往 `chrome://extensions/`。
2. 開啟右上角的 **「開發者模式 (Developer mode)」** 開關。
3. 點擊左上角的 **「載入未封裝項目 (Load unpacked)」** 按鈕。
4. 選擇本專案目錄中的 `frontend/extension` 資料夾。
5. 成功載入後，在瀏覽器右上角釘選 **Monocle Companion** 圖示。
6. 點擊該圖示，側邊欄（Side Panel）會立即滑出。它會與本地後端自動同步，讓您在寫作時隨時享有一鍵抓取草稿、AI 潤飾、RAG 材料撈取與微步驟計時功能！

> **⚠️ 注意**：擴充功能透過 content script 與網頁互動（抓取選取文字 / 填回潤飾結果）。載入或更新擴充功能後，**已經開啟的分頁需要重新整理 (F5)** 一次，content script 才會注入生效；之後新開的分頁則會自動注入。

*(API 的 Swagger 技術文件仍可於 [http://localhost:8000/docs](http://localhost:8000/docs) 存取)*


---

## 📡 核心 API 端點概覽

| 功能模組 | HTTP 方法 | 端點 | 說明 |
| :--- | :--- | :--- | :--- |
| **全域狀態** | `GET` | `/api/state` | 取得當前活躍專案、活躍大綱、活躍任務及計時器狀態快照 |
| **全域狀態** | `POST` | `/api/state` | 切換活躍專案/大綱/微任務，會同步重設/啟動計時器 |
| **計時器** | `POST` | `/api/timer/control` | 控制計時器狀態 (`start`, `pause`, `reset`) |
| **專案管理** | `POST` | `/api/projects` | 建立新專案，設定專案截止日與寫作 Persona |
| **專案管理** | `GET` | `/api/projects` | 列出系統內所有專案清單 |
| **大綱結構** | `POST` | `/api/outlines/decompose` | **[AI 工具]** 自動將大綱切碎為數個 20 分鐘的微任務 |
| **時間管理** | `GET` | `/api/tasks/daily` | **[ADHD 友善]** 根據多專案截止日，動態排序今日聚焦任務流 |
| **時間管理** | `POST` | `/api/tasks/{id}/complete` | 完成任務並回傳多巴胺回饋訊號 (動畫與音效觸發鍵) |
| **材料管理** | `POST` | `/api/materials/ingest` | **[AI 工具]** 匯入 PDF/筆記材料，做向量切片並綁定大綱 |
| **寫作編輯** | `POST` | `/api/editor/save` | 快速、碎片化暫存原始草稿文字 |
| **寫作編輯** | `POST` | `/api/editor/polish` | **[AI 工具]** 依據專案文風與相關背景材料，對草稿進行 AI 潤飾 |

---

## 🛡️ 隱私安全承諾

Monocle 承諾所有資料本機儲存。
所有匯入的背景知識庫、大綱、寫作草稿以及產生的向量數組，皆存放在本機的 [data/](file:///C:/Users/pondahai/monocle-total_editor/data) 目錄中。請勿將 `data/` 資料夾提交至任何公開的程式碼倉庫。系統已預設在 `.gitignore` 中將其排除。
