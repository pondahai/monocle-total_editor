// Content Script - 負責與目前打開的網頁進行文字交互

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "get_selection") {
        const selectedText = window.getSelection().toString();
        
        // 如果網頁上的正常選取區是空的，嘗試去抓取 active element (如果是 textarea/input)
        if (!selectedText) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT")) {
                const start = activeEl.selectionStart;
                const end = activeEl.selectionEnd;
                if (start !== end) {
                    sendResponse({ text: activeEl.value.substring(start, end) });
                    return;
                }
            }
        }
        
        sendResponse({ text: selectedText });
    }
    
    else if (request.action === "insert_text") {
        const textToInsert = request.text;
        const activeEl = document.activeElement;
        
        // 1. 優先處理 Textarea 或 Input 輸入框
        if (activeEl && (activeEl.tagName === "TEXTAREA" || activeEl.tagName === "INPUT")) {
            const start = activeEl.selectionStart;
            const end = activeEl.selectionEnd;
            const originalVal = activeEl.value;
            
            // 取代選取範圍，或插入在游標處
            activeEl.value = originalVal.substring(0, start) + textToInsert + originalVal.substring(end);
            
            // 重新定位游標
            activeEl.selectionStart = activeEl.selectionEnd = start + textToInsert.length;
            
            // 觸發輸入事件以相容現代前端框架 (如 React/Vue)
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
            sendResponse({ success: true });
        } 
        
        // 2. 處理 Rich Text / ContentEditable 編輯器 (如 Notion, Google Docs 等)
        else {
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                
                const textNode = document.createTextNode(textToInsert);
                range.insertNode(textNode);
                
                // 將光標移至插入文本的末尾
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);
                
                sendResponse({ success: true });
            } else {
                sendResponse({ error: "找不到有效的文字輸入定位點，請先點擊網頁上的輸入框！" });
            }
        }
    }
});
