const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const generator = require('./asset-generator.js');

const result = generator.generate([
  'assets/passionfruit/images/actor/half_full/FROR06.png',
  'images/actor/head/avatarCM01A.png',
  'images/actor/half/bustTB04A1.png',
  'images/actor/battle/FRXXF01CMR/FRXXF01CMRa1.png',
  'images/actor/half_full/CMILSY.png',
  'images/prop/ITC060.png',
  'images/weapon/w99A.png',
  'images/actor/outfit/smallavatarNOTAROLE.png'
]);
assert.deepEqual([...result.ids].sort(), ['CM01A', 'CMILSY', 'FROR06', 'FRXXF01CM', 'TB04A1']);
for(const path of [
  'images/actor/head/smallavatarFROR06.png',
  'images/actor/piece/esotericaCMILSY.png',
  'images/actor/battle/TB04A1R/TB04A1Rc8.png',
  'images/site/street/svspc_CM01A2.png',
  'images/slide/actor/FROR0604b.png',
  'images/bundles/GFROR06.png',
  'images/prop/ITC059.png',
  'images/prop/SP014.png',
  'images/slide/background/T0002.png',
  'images/uw/uw02c.png',
  'images/greeting/039_jp.png',
  'images/greeting/20261012_sc.png',
  'images/greeting/三亞改名三上悠亞_tc.png',
  'audio/battle/FROR06Rb1.mp3',
  'video/recruit/FROR06.mp4'
]) assert(result.paths.has(path), 'Missing candidate: ' + path);
for(const path of result.paths){
  assert(!path.startsWith('images/actor/outfit/'), 'Unselected outfit folder included');
  assert(!path.startsWith('images/weapon/'), 'Unselected weapon folder included');
  assert(!path.startsWith('images/nation/'), 'Unselected nation folder included');
  assert(!/FROR07|NOTAROLE|\.DS_Store|Thumbs\.db|複製/.test(path), 'Unwanted ID/file: ' + path);
  const date = path.match(/^images\/greeting\/(\d{8})/);
  if(date){
    const value = date[1];
    const parsed = new Date(value.slice(0,4) + '-' + value.slice(4,6) + '-' + value.slice(6,8) + 'T00:00:00Z');
    assert.equal(parsed.toISOString().slice(0,10).replaceAll('-', ''), value, 'Invalid greeting date');
  }
}
assert(!result.paths.has('images/prop/ITC061.png'), 'Numbering extended beyond known range');
assert(!result.paths.has('images/greeting/20261013_tc.png'), 'Unobserved greeting date generated');
assert(!result.paths.has('images/bundles/TB04A.png'), 'Unobserved character variant generated');

// Exercise the page's actual folder-input handler and comparison lookup.
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
new vm.Script(script);
const elements = new Map();
const element = id => {
  if(!elements.has(id)) elements.set(id, {value:'', listeners:{}, addEventListener(type, fn){this.listeners[type] = fn;}});
  return elements.get(id);
};
const context = {
  window:{UWAssetGenerator:generator}, UWAssetGenerator:generator,
  document:{getElementById:element}, console,
  FileReader:class {readAsText(file){this.onload({target:{result:file.text}});}}
};
vm.createContext(context);
vm.runInContext(script.replace(/\}\)\(\);\s*$/, 'window.testPresent = isLocallyPresent; window.testRequired = () => Array.from(requiredAssets); })();'), context);
element('folderInput').listeners.change({target:{files:[{
  name:'FROR06.png', webkitRelativePath:'images/actor/half_full/FROR06.png'
}]}});
assert(context.window.testPresent('images/actor/half_full/FROR06.png'));
assert(!context.window.testPresent('images/slide/actor/FROR06.png'), 'Same filename in another folder hid a missing file');
assert(element('generatorStat').innerHTML.includes('1</b>'), 'Folder selection did not generate candidates');
element('folderInput').listeners.change({target:{files:[{
  name:'ITC060.png', webkitRelativePath:'passionfruit/images/prop/ITC060.png'
}]}});
assert(context.window.testPresent('images/prop/ITC060.png'));
assert(element('generatorStat').innerHTML.includes('0</b>'), 'Previous folder character IDs persisted');

// A newly recorded outfit must appear even when it has no files locally yet.
element('txtFileInput').listeners.change({target:{files:[{
  name:'uw_asset_paths.txt',
  text:'images/actor/gif/tachieTW05B.gif\nimages/actor/half/bustTW05B.png\nimages/site/street/svspc_TW05B.png'
}]}});
let required = context.window.testRequired();
assert(required.includes('images/actor/gif/tachieTW05B.gif'), 'Upload did not automatically parse the new outfit');
assert(required.includes('images/actor/head/avatarTW05B.png'), 'Recorded outfit ID did not feed the generator');
assert(required.includes('images/actor/battle/TW05BR/TW05BRa1.png'));
assert(!required.includes('images/actor/gif/tachietw05b.gif'), 'CDN path casing was changed');
assert(!context.window.testPresent('images/actor/gif/tachieTW05B.gif'));
element('logInput').value = 'Users/wuser/Desktop/2.28/assets/passionfruit/images/actor/gif/tachieTW05B.gif\nhttps://media.komisureiya.com/video/recruit/TW05B.mp4?version=2';
element('parseBtn').listeners.click();
required = context.window.testRequired();
assert(required.includes('video/recruit/TW05B.mp4'), 'Recorded video path was not parsed');
assert(!required.some(path => path.startsWith('Users/')), 'Local filesystem prefix leaked into CDN path');
element('clearLogBtn').listeners.click();
assert(!context.window.testRequired().includes('images/actor/gif/tachieTW05B.gif'), 'Cleared recording ID remained in the generator');
console.log('Selected folders, exact IDs, numbering, greeting dates and page integration passed.');
