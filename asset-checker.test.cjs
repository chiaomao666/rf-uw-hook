const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createChecker} = require('./asset-checker.js');

(async function(){
  const data = new Map();
  const storage = {getItem:key => data.get(key), setItem:(key, value) => data.set(key, value)};
  let time = 1000000, active = 0, peak = 0, requests = 0, updates = 0;
  const urls = Array.from({length:40}, (_, index) => 'https://media.example/' + index + '.png');
  const probe = async url => {
    requests++;
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if(url.endsWith('/0.png')) throw new Error('Network failure');
    return Number(url.match(/(\d+)\.png$/)[1]) % 2 ? 'alive' : 'gone';
  };
  const checker = createChecker({probe, storage, now:() => time});
  const results = [];
  const first = await checker.run(urls, {
    onResult:(index, status) => results.push([index, status]),
    onProgress:() => updates++
  });
  assert.equal(peak, 16, 'Checks must run in parallel within the limit');
  assert.equal(first.completed, 40);
  assert.equal(first.alive, 20);
  assert.equal(first.gone, 19);
  assert.equal(first.unknown, 1);
  assert.equal(new Set(results.map(([index]) => index)).size, 40);
  assert(updates < 40, 'Progress rendering should be batched');

  requests = 0;
  const second = await checker.run(urls);
  assert.equal(requests, 1, 'Repeat checks should retry only the unknown result');
  assert.equal(second.cached, 39);

  requests = 0;
  const reloaded = createChecker({probe, storage, now:() => time});
  assert.equal((await reloaded.run(urls)).cached, 39, 'Cache should survive page reloads');
  time += 10 * 60 * 1000;
  requests = 0;
  assert.equal((await reloaded.run(urls)).cached, 20, 'Missing-file cache must expire after ten minutes');
  assert.equal(requests, 20);
  time += 24 * 60 * 60 * 1000;
  assert.equal((await reloaded.run(urls)).cached, 0, 'Positive cache must also expire');
  assert.equal((await checker.run(['https://other.example/1.png'])).cached, 0, 'Cache keys must include the origin');
  const blockedStorage = {getItem(){throw Error('Blocked');}, setItem(){throw Error('Full');}};
  assert.equal((await createChecker({probe, storage:blockedStorage}).run([urls[1]])).alive, 1);
  assert.equal((await checker.run([])).completed, 0);

  // Exercise the real image/audio/video probes without downloading media.
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  const instances = [];
  class Media {
    constructor(){instances.push(this);}
    removeAttribute(name){if(name === 'src') this.srcRemoved = true;}
    load(){this.stopped = true;}
  }
  const context = {
    window:{}, console, setTimeout, clearTimeout, Image:Media, Audio:Media,
    document:{getElementById(){return {addEventListener(){}};}, createElement(){return new Media();}}
  };
  vm.createContext(context);
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'window.probeAsset = probeAsset; })();'), context);
  const audioResult = context.window.probeAsset('https://media.example/test.mp3', 1000);
  const audio = instances.at(-1);
  assert.equal(audio.preload, 'metadata', 'Audio should not wait for full playback data');
  audio.onloadedmetadata();
  assert.equal(await audioResult, 'alive');
  assert(audio.srcRemoved && audio.stopped, 'Audio transfer must be stopped after the check');
  const imageResult = context.window.probeAsset('https://media.example/test.png', 1000);
  const image = instances.at(-1);
  image.onerror();
  assert.equal(await imageResult, 'gone');
  assert(image.srcRemoved);
  const timeoutResult = context.window.probeAsset('https://media.example/test.mp4', 1);
  const video = instances.at(-1);
  assert.equal(await timeoutResult, 'unknown', 'Timeouts must not be classified as missing files');
  assert(video.srcRemoved && video.stopped, 'Timed-out transfers must be stopped');
  console.log('Concurrency, caching, cache expiry, error handling and media cleanup passed.');
})().catch(error => {console.error(error);process.exitCode = 1;});
