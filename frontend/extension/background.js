// Chrome Extension Manifest V3 Background Service Worker
// 啟用點擊圖示直接在側邊欄開啟 Monocle Sidebar 介面

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("設定側邊欄開啟失敗:", error));

// 監聽來自 Sidebar 的消息並與 Content Script 進行轉發
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_selection" || request.action === "insert_text") {
        // 取得當前活躍頁面並發送
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) {
                sendResponse({ error: "找不到活動頁面" });
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, request, (response) => {
                sendResponse(response);
            });
        });
        return true; // 表示非同步回覆
    }
});
