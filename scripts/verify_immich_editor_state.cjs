/** Pure draft persistence regression. Run node scripts/verify_immich_editor_state.cjs. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'apps/immich-ki/web/node_modules/typescript'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const state = require('../apps/immich-ki/web/src/editor-state.ts');
const {buildDefaultConfig} = require('../apps/immich-ki/web/src/defaults.ts');
const value = buildDefaultConfig();
value.custom_text = 'legacy fallback';
value.regions[0].slots['primary-end'] = {enabled:false,style:{...value.defaults,color:'#123456'},content:{chips:[],separator:' / '}};
value.regions[0].slots['primary-start'].content.chips = [{field_id:'custom_text',custom_text:'first'},{field_id:'camera_model'},{field_id:'custom_text',custom_text:'second'},{field_id:'camera_model'}];
value.regions.push({id:'saved-signature',type:'free',enabled:false,slots:{sig1:{enabled:true,style:null,content:{path:'existing-resource',invert_mono:true,size_level:'small',size_ratio:null,orientation:'upright',placement:'end',track:'span'}}}});
for(const config of [value, buildDefaultConfig(), {...buildDefaultConfig(),regions:[]}]) {
  const draft = state.editableConfig(config);
  assert.deepEqual(state.serializeEditorConfig(draft),config,'load/save must be lossless');
  assert.notEqual(draft,config);
}
const changed=state.updateSlot(value,'footer','primary-end',{enabled:true});
assert.deepEqual(changed.regions[0].slots['primary-start'],value.regions[0].slots['primary-start']);
assert.deepEqual(changed.regions[1],value.regions[1]);
const inherited=state.updateSlot(changed,'footer','primary-end',{style:null});
assert.equal(inherited.regions[0].slots['primary-end'].style,null);
assert.deepEqual(inherited.regions[0].slots['primary-end'].content,value.regions[0].slots['primary-end'].content);
const missing=state.updateSlot(value,'footer','secondary-end',{enabled:true});
assert.equal(missing.regions[0].slots['secondary-end'].enabled,true);
assert.equal(value.regions[0].slots['secondary-end'],undefined);
const side=state.moveRegion(value.regions[0],'left');
assert.deepEqual(side.slots,value.regions[0].slots);
assert.equal(side.height,undefined);
assert.equal(state.slotLabel(side,'primary-start'),'主轨 · 起点');
assert.equal(state.moveRegion(side,'footer').width,undefined);
assert.equal(state.addRegion(value).regions.at(-1).id,'footer-new');
assert.equal(state.addRegion({...value,regions:[]}).regions.length,1);
console.log('PASS: exact roundtrip, disabled populated signature, empty styled slot, duplicate/order/local chips, legacy text, null inheritance, missing slot, side switch, no-flow addition');
