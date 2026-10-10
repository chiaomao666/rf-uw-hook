// uw_hook.js - 同源 JS 圖資路徑掃描器
console.log("[UW] 圖資路徑掃描器已載入（不依賴 WebSocket）");

(function(){
    // 圖資缺漏檢查工具可直接解析這些路徑。
    const assetPaths = new Set();
    const scannedScripts = new Set();
    const MEDIA_ORIGIN = 'https://media.komisureiya.com';
    const ASSET_ROOT_RE = /^(?:images|audio|video)\//i;
    const ASSET_PATH_RE = /(?:https?:\/\/[^\s"'<>\\]+\/)?[A-Za-z0-9_@.\-/]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp|mp3|ogg|wav|m4a|aac|opus|mp4|webm|mov|m3u8|uw)(?:[?#][^\s"'<>\\]*)?/gi;
    const ASSET_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|mp3|ogg|wav|m4a|aac|opus|mp4|webm|mov|m3u8|uw)(?:[?#].*)?$/i;

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
        // JS 有時會以 ../images/ 或 assets/passionfruit/images/ 形式寫路徑；
        // 統一截成 CDN 實際使用的 images/、audio/、video/ 相對路徑。
        const rootedPath = path.match(/(?:^|\/)((?:images|audio|video)\/.*)$/i);
        if(rootedPath) path = rootedPath[1];
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

    // 嘗試讀取頁面已載入的 JS 原始碼；不依賴 WebSocket，也不下載圖資檔本身。
    // 跨網域 JS 只有在伺服器允許瀏覽器讀取時才會成功，失敗時直接略過。
    function scanLoadedAssets(){
        let scriptsFound = 0;
        let inlineFound = 0;
        document.querySelectorAll('script:not([src])').forEach(script => {
            inlineFound += collectAssetPaths(script.textContent || '');
        });
        document.querySelectorAll('script[src]').forEach(script => {
            const src = script.src;
            if(!src || scannedScripts.has(src)) return;
            scannedScripts.add(src);
            scriptsFound++;
            fetch(src).then(resp => {
                if(!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.text();
            }).then(source => {
                const found = collectAssetPaths(source);
                if(found) flashStatus('JS 掃描新增 ' + found + ' 筆圖資（共 ' + assetPaths.size + ' 筆）');
            }).catch(() => {
                console.debug('[UW] 無法讀取 JS（可能未開放跨網域讀取）：', src);
            });
        });
        if(scriptsFound) flashStatus('開始掃描 ' + scriptsFound + ' 個同源 JS 檔');
        else if(inlineFound) flashStatus('內嵌 JS 新增 ' + inlineFound + ' 筆圖資');
        else if(assetPaths.size === 0) flashStatus('尚未在可讀 JS 中找到圖資路徑');
        return scriptsFound + inlineFound;
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

    // ---- 頁面內面板 ----
    let panelEl, assetCountEl, statusEl;

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
                <b>[UW] 圖資掃描</b>
                <span class="uw-min" id="uw-min">—</span>
            </div>
            <div class="uw-body" id="uw-body">
                <div class="uw-assets">從同源 JS 找到 <b id="uw-assets">0</b> 筆圖資路徑</div>
                <div class="uw-row">
                    <button id="uw-scan">重新掃描圖資路徑</button>
                    <button id="uw-assets-copy">複製圖資</button>
                </div>
                <div class="uw-row">
                    <button id="uw-assets-dl">下載圖資 .txt</button>
                </div>
                <div class="uw-status" id="uw-status"></div>
            </div>
        `;
        document.body.appendChild(panelEl);

        assetCountEl = document.getElementById('uw-assets');
        statusEl = document.getElementById('uw-status');

        document.getElementById('uw-scan').addEventListener('click', scanLoadedAssets);
        document.getElementById('uw-assets-copy').addEventListener('click', copyAssetList);
        document.getElementById('uw-assets-dl').addEventListener('click', downloadAssetList);

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

    function updatePanel(){
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

    // 遊戲切換時補掃新插入的同源 JS 節點。畫面批次重繪時合併成一次。
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

