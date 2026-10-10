// uw_hook.js - 獨立的 WebSocket 攔截副程式（v2：加上頁面內面板，方便一鍵複製/下載側錄結果）
console.log("[UW] 啟動外部副程式：WebSocket 攔截器已載入");

(function(){
    const captured = []; // { len, url, data, time }
    // 圖資缺漏檢查工具可直接解析這些路徑。
    const assetPaths = new Set();
    const MEDIA_ORIGIN = 'https://media.komisureiya.com';
    const ASSET_ROOT_RE = /^(?:images|audio|video)\//i;
    const ASSET_PATH_RE = /(?:https?:\/\/[^\s"'<>\\]+\/)?[A-Za-z0-9_@.\-/]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|mp3|ogg|wav|m4a|aac|opus|mp4|webm|mov|m3u8|uw)(?:[?#][^\s"'<>\\]*)?/gi;
    const ASSET_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|mp3|ogg|wav|m4a|aac|opus|mp4|webm|mov|m3u8|uw)(?:[?#].*)?$/i;

    function addCapture(url, data){
        captured.push({
            len: data.length,
            url: url || '(unknown)',
            data: data,
            time: new Date().toLocaleTimeString()
        });
        updatePanel();
    }

    function normalizeAssetPath(value){
        if(!value) return '';
        let path = String(value).trim().replace(/\\\//g, '/');
        if(/^https?:\/\//i.test(path)){
            try{
                const url = new URL(path);
                if(url.origin !== MEDIA_ORIGIN) return '';
                path = url.pathname;
            }catch(e){ return ''; }
        }
        path = path.replace(/[?#].*$/, '');
        path = path.replace(/^\/+/, '');
        return ASSET_ROOT_RE.test(path) && ASSET_EXT_RE.test(path) ? path : '';
    }

    function collectAssetPaths(text){
        if(typeof text !== 'string') return 0;
        let added = 0;
        ASSET_PATH_RE.lastIndex = 0;
        let match;
        while((match = ASSET_PATH_RE.exec(text)) !== null){
            const path = normalizeAssetPath(match[0]);
            if(path && !assetPaths.has(path)){
                assetPaths.add(path);
                added++;
            }
        }
        if(added) updatePanel();
        return added;
    }

    // 不讀取任何 JS 原始碼，也不主動下載圖資；只收集目前頁面實際載入的三種圖資網址。
    function scanLoadedAssets(){
        let added = 0;
        const scan = value => { added += collectAssetPaths(value || ''); };

        try{
            performance.getEntriesByType('resource').forEach(entry => scan(entry.name));
        }catch(e){}
        document.querySelectorAll('img[src],audio[src],video[src],source[src],link[href]').forEach(el => {
            scan(el.currentSrc || el.src || el.href);
        });

        if(added) flashStatus('已載入資源掃描完成，圖資清單共 ' + assetPaths.size + ' 筆');
        return added;
    }

    function formatAssetList(){
        return Array.from(assetPaths).sort().join('\n');
    }

    function copyAssetList(){
        if(assetPaths.size === 0){ flashStatus('目前還沒找到圖資路徑，請稍候或按「重新掃描」'); return; }
        const text = formatAssetList();
        const done = () => flashStatus('已複製 ' + assetPaths.size + ' 筆圖資路徑，可貼到缺漏檢查工具');
        if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(text).then(done).catch(() => {
                const ok = legacyCopyFallback(text);
                flashStatus(ok ? '已複製 ' + assetPaths.size + ' 筆圖資路徑' : '複製失敗，請改用下載');
            });
        }else{
            const ok = legacyCopyFallback(text);
            flashStatus(ok ? '已複製 ' + assetPaths.size + ' 筆圖資路徑' : '複製失敗，請改用下載');
        }
    }

    function downloadAssetList(){
        if(assetPaths.size === 0){ flashStatus('目前還沒找到圖資路徑'); return; }
        const blob = new Blob([formatAssetList()], {type:'text/plain;charset=utf-8'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'uw_asset_paths_' + Date.now() + '.txt';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 500);
        flashStatus('已下載 ' + assetPaths.size + ' 筆圖資路徑；可直接匯入缺漏檢查工具');
    }

    // ---- 攔截 WebSocket ----
    if (window.WebSocket) {
        const OriginalWebSocket = window.WebSocket;

        window.WebSocket = function(url, protocols) {
            console.log("[UW] [WebSocket] 攔截到連線，目標: ", url);
            const ws = new OriginalWebSocket(url, protocols);

            ws.addEventListener('message', function(event) {
                if (typeof event.data === 'string') {
                    // 小封包也可能只帶一個 icon/image 路徑，因此不再只看大型封包。
                    collectAssetPaths(event.data);
                    // 【全量側錄】只要資料長度大於 500 個字元（通常代表一次傳來大量清單），就存起來！
                    if (event.data.length > 500) {
                        console.log("[UW] [發現大型資料包！長度: " + event.data.length + "]", event.data);
                        addCapture(url, event.data);
                    }
                }
            });

            const originalSend = ws.send;
            ws.send = function(data) {
                if (typeof data === 'string') {
                    if (data.includes('actor') || data.includes('pool')) {
                        console.log("[UW] [發送請求]", data);
                    }
                }
                return originalSend.apply(this, arguments);
            };
            return ws;
        };
        window.WebSocket.prototype = OriginalWebSocket.prototype;
    }

    // ---- 頁面內面板 ----
    let panelEl, countEl, assetCountEl, statusEl;

    function buildPanel(){
        const style = document.createElement('style');
        style.textContent = `
            #uw-panel{
                position:fixed; right:14px; bottom:14px; z-index:2147483647;
                width:230px; font-family:ui-monospace,Menlo,Consolas,monospace;
                background:#14160f; color:#e8e4d5; border:1px solid #3a3f2c;
                border-radius:4px; box-shadow:0 4px 18px rgba(0,0,0,.5);
                font-size:12px; overflow:hidden;
            }
            #uw-panel .uw-head{
                background:#1c2018; padding:8px 10px; display:flex;
                align-items:center; justify-content:space-between; cursor:move;
                border-bottom:1px solid #3a3f2c;
            }
            #uw-panel .uw-head b{color:#d9a441; font-weight:600; font-size:11.5px;}
            #uw-panel .uw-body{padding:10px;}
            #uw-panel .uw-row{display:flex; gap:6px; margin-top:6px;}
            #uw-panel button{
                flex:1; background:#1f2318; color:#e8e4d5; border:1px solid #6a5322;
                border-radius:2px; padding:6px 4px; font-size:11px; cursor:pointer;
                font-family:inherit;
            }
            #uw-panel button:hover{background:#d9a441; color:#161810;}
            #uw-panel .uw-count{color:#8b9284; font-size:11px;}
            #uw-panel .uw-count b{color:#d9a441;}
            #uw-panel .uw-assets{color:#8b9284; font-size:11px; margin-top:4px;}
            #uw-panel .uw-assets b{color:#79b8a3;}
            #uw-panel .uw-status{color:#6f9b5c; font-size:10.5px; margin-top:6px; min-height:14px;}
            #uw-panel .uw-min{cursor:pointer; color:#8b9284; font-size:13px; user-select:none;}
        `;
        document.head.appendChild(style);

        panelEl = document.createElement('div');
        panelEl.id = 'uw-panel';
        panelEl.innerHTML = `
            <div class="uw-head" id="uw-drag">
                <b>[UW] 側錄面板</b>
                <span class="uw-min" id="uw-min">—</span>
            </div>
            <div class="uw-body" id="uw-body">
                <div class="uw-count">已攔截 <b id="uw-count">0</b> 筆大型封包(大於 500 個字元)</div>
                <div class="uw-assets">自動找到 <b id="uw-assets">0</b> 筆圖資路徑</div>
                <div class="uw-row">
                    <button id="uw-scan">掃描已載入圖資</button>
                    <button id="uw-assets-copy">複製圖資</button>
                </div>
                <div class="uw-row">
                    <button id="uw-assets-dl">下載圖資 .txt</button>
                </div>
                <div class="uw-row">
                    <button id="uw-copy">複製全部</button>
                    <button id="uw-dl">下載 .txt</button>
                </div>
                <div class="uw-row">
                    <button id="uw-clear">清空</button>
                </div>
                <div class="uw-status" id="uw-status"></div>
            </div>
        `;
        document.body.appendChild(panelEl);

        countEl = document.getElementById('uw-count');
        assetCountEl = document.getElementById('uw-assets');
        statusEl = document.getElementById('uw-status');

        document.getElementById('uw-scan').addEventListener('click', scanLoadedAssets);
        document.getElementById('uw-assets-copy').addEventListener('click', copyAssetList);
        document.getElementById('uw-assets-dl').addEventListener('click', downloadAssetList);
        document.getElementById('uw-copy').addEventListener('click', copyAll);
        document.getElementById('uw-dl').addEventListener('click', downloadAll);
        document.getElementById('uw-clear').addEventListener('click', clearAll);

        // 收合/展開
        const body = document.getElementById('uw-body');
        const minBtn = document.getElementById('uw-min');
        let collapsed = false;
        minBtn.addEventListener('click', function(){
            collapsed = !collapsed;
            body.style.display = collapsed ? 'none' : 'block';
            minBtn.textContent = collapsed ? '+' : '—';
        });

        // 簡易拖曳
        const dragHandle = document.getElementById('uw-drag');
        let dragging = false, offX = 0, offY = 0;
        dragHandle.addEventListener('mousedown', function(e){
            dragging = true;
            const rect = panelEl.getBoundingClientRect();
            offX = e.clientX - rect.left;
            offY = e.clientY - rect.top;
        });
        document.addEventListener('mousemove', function(e){
            if(!dragging) return;
            panelEl.style.left = (e.clientX - offX) + 'px';
            panelEl.style.top = (e.clientY - offY) + 'px';
            panelEl.style.right = 'auto';
            panelEl.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function(){ dragging = false; });
    }

    function formatAll(){
        return captured.map(c =>
            `[UW] [封包 時間:${c.time} 長度:${c.len} URL:${c.url}]\n${c.data}`
        ).join('\n\n---\n\n');
    }

    const LARGE_WARN_LEN = 3 * 1024 * 1024; // 約 3MB 文字，超過就提醒改用下載比較保險

    function legacyCopyFallback(text){
        // navigator.clipboard 在某些情況（頁面失焦、內容過大、部分瀏覽器安全限制）會直接失敗且不丟明確錯誤
        // 用傳統 execCommand 當備援方案再試一次
        try{
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        }catch(e){
            return false;
        }
    }

    function copyAll(){
        if(captured.length === 0){ flashStatus('目前沒有側錄到任何資料'); return; }
        const text = formatAll();

        if(text.length > LARGE_WARN_LEN){
            flashStatus('資料量偏大(' + (text.length/1024/1024).toFixed(1) + 'MB)，複製可能失敗，建議改用下載 .txt');
        }

        navigator.clipboard.writeText(text).then(function(){
            flashStatus('已複製 ' + captured.length + ' 筆到剪貼簿 ✓');
        }).catch(function(){
            const ok = legacyCopyFallback(text);
            flashStatus(ok ? '已複製 ' + captured.length + ' 筆到剪貼簿 ✓（備援方式）' : '複製失敗，資料量可能太大，請改用下載 .txt');
        });
    }

    function downloadAll(){
        if(captured.length === 0){ flashStatus('目前沒有側錄到任何資料'); return; }
        const blob = new Blob([formatAll()], {type:'text/plain'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'uw_capture_' + Date.now() + '.txt';
        a.click();
        URL.revokeObjectURL(a.href);
        flashStatus('已下載 ' + captured.length + ' 筆');
    }

    function clearAll(){
        captured.length = 0;
        updatePanel();
        flashStatus('已清空');
    }

    function updatePanel(){
        if(countEl) countEl.textContent = captured.length;
        if(assetCountEl) assetCountEl.textContent = assetPaths.size;
    }

    function flashStatus(msg){
        if(!statusEl) return;
        statusEl.textContent = msg;
        setTimeout(function(){ if(statusEl.textContent === msg) statusEl.textContent = ''; }, 2500);
    }

    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', function(){
            buildPanel();
            scanLoadedAssets();
        });
    } else {
        buildPanel();
        scanLoadedAssets();
    }

    // 直接觀察新發出的資源請求，無須讀取 JS 原始碼；只會保留三個指定路徑前綴的圖資。
    if(window.PerformanceObserver){
        try{
            const resourceObserver = new PerformanceObserver(function(list){
                let added = 0;
                list.getEntries().forEach(function(entry){ added += collectAssetPaths(entry.name); });
                if(added) flashStatus('偵測到新載入圖資 ' + added + ' 筆（共 ' + assetPaths.size + ' 筆）');
            });
            resourceObserver.observe({type: 'resource', buffered: true});
        }catch(e){}
    }

    // 遊戲切換時補掃 DOM 內的新圖片／音訊／影片節點。畫面批次重繪時合併成一次。
    let scheduledScan = null;
    function scheduleAssetScan(){
        if(scheduledScan) return;
        scheduledScan = setTimeout(function(){
            scheduledScan = null;
            scanLoadedAssets();
        }, 500);
    }
    const observer = new MutationObserver(function(records){
        if(records.some(record => record.addedNodes.length)) scheduleAssetScan();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});

    window.UWAssetCollector = {
        scan: scanLoadedAssets,
        getPaths: () => Array.from(assetPaths).sort(),
        download: downloadAssetList
    };
})();

