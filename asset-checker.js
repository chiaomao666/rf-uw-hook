(function(root){
  'use strict';
  const CACHE_KEY = 'uw-asset-checks-v1';
  const ALIVE_TTL = 24 * 60 * 60 * 1000;
  const GONE_TTL = 10 * 60 * 1000;

  function createChecker({probe, storage, now = Date.now, concurrency = 16}){
    const cache = new Map();
    const fresh = entry => entry && ['alive', 'gone'].includes(entry.status) &&
      Number.isFinite(entry.time) && now() >= entry.time &&
      now() - entry.time < (entry.status === 'alive' ? ALIVE_TTL : GONE_TTL);
    try{
      const entries = JSON.parse(storage && storage.getItem(CACHE_KEY) || '[]');
      if(Array.isArray(entries)) entries.forEach(entry => {
        if(Array.isArray(entry) && typeof entry[0] === 'string' && fresh(entry[1])) cache.set(entry[0], entry[1]);
      });
    }catch(error){ /* Storage may be unavailable or contain invalid data. */ }

    async function run(urls, {onResult = () => {}, onProgress = () => {}} = {}){
      let cursor = 0, lastProgress = -Infinity;
      const counts = {total:urls.length, completed:0, alive:0, gone:0, unknown:0, cached:0};
      const report = force => {
        if(force || now() - lastProgress >= 150){
          lastProgress = now();
          onProgress({...counts});
        }
      };
      report(true);
      async function worker(){
        while(cursor < urls.length){
          const index = cursor++;
          const url = urls[index];
          const entry = cache.get(url);
          const cached = fresh(entry);
          let status = 'unknown';
          if(cached){
            status = entry.status;
            counts.cached++;
          }else{
            try{ status = await probe(url, 8000); }catch(error){}
            if(!['alive', 'gone'].includes(status)) status = 'unknown';
            if(status !== 'unknown') cache.set(url, {status, time:now()});
          }
          counts.completed++;
          counts[status]++;
          onResult(index, status, cached);
          report(false);
        }
      }
      await Promise.all(Array.from({length:Math.min(Math.max(1, concurrency), urls.length)}, worker));
      report(true);
      try{
        const entries = Array.from(cache).filter(([, entry]) => fresh(entry)).slice(-20000);
        if(storage) storage.setItem(CACHE_KEY, JSON.stringify(entries));
      }catch(error){ /* A full cache must not interrupt checks. */ }
      return counts;
    }
    return {run};
  }
  if(typeof module !== 'undefined' && module.exports) module.exports = {createChecker};
  else root.UWAssetChecker = {createChecker};
})(typeof globalThis !== 'undefined' ? globalThis : this);
