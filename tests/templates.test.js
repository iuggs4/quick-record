import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

function templateHarness(initial=[]){
  const controls=['entry','template-bar','template-list','add-template','manage-templates','template-status','retry-templates','template-manager','template-back','template-items','template-form','template-name','template-type','template-category','template-amount','template-save','template-cancel','template-manager-status','entry-main','entry-tabs','quick-add-title','amount','income-amount','categories','income-categories','edit-date'];
  const created=[],element=(tag='div')=>({tag,children:[],attributes:{},dataset:{},value:'',textContent:'',hidden:false,disabled:false,listeners:{},
    append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},
    addEventListener(name,callback){this.listeners[name]=callback;},focus(){this.focused=true;},click(){if(!this.disabled)return this.onclick?.();}
  });
  const elements=Object.fromEntries(controls.map(id=>[id,element()]));
  elements['template-manager'].hidden=true;elements['entry-tabs'].dataset.type='expense';elements['edit-date'].value='2026-09-30';
  const forms=[{type:'expense',amount:'amount',categories:'categories',values:['餐饮','交通','其他']},{type:'income',amount:'income-amount',categories:'income-categories',values:['工资','奖金','其他']}];
  for(const form of forms){
    for(const value of form.values){const button=element('button');button.textContent=value;elements[form.categories].append(button);}
    form.choose=value=>{for(const button of elements[form.categories].children)button.setAttribute('aria-pressed',String(button.textContent===value));};form.choose('其他');
  }
  const writes=[],context={busy:false,editingBill:null,entryForms:forms,$:id=>elements[id],
    document:{createElement(tag){const node=element(tag);created.push(node);return node;},querySelectorAll(){return [...controls.filter(id=>/template/.test(id)).map(id=>elements[id]),...created.filter(node=>node.tag==='button')];}},
    confirm:()=>true,crypto:{randomUUID:()=> 'new-template'},message(text){context.notice=text;},syncAmountDisplay(){context.synced=true;},
    templateStorage:{all:async()=>context.rows.map(row=>({...row})),get:async id=>context.rows.find(row=>row.id===id),
      add:async template=>{writes.push({method:'add',template});context.rows.push({...template});},
      update:async(template,original)=>{writes.push({method:'update',template,original});context.rows=context.rows.map(row=>row.id===template.id?{...template}:row);},
      remove:async(id,original)=>{writes.push({method:'remove',id,original});context.rows=context.rows.filter(row=>row.id!==id);}
    },rows:initial.map(row=>({...row}))
  };
  let api;context.setBusy=value=>{context.busy=value;api.setTemplateBusy(value);};
  const source=readFileSync(new URL('../model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../templates.js',import.meta.url),'utf8');
  api=new Script(source+';({initTemplates,refreshTemplates,syncTemplateEntry,applyEntryTemplate,openTemplateManager,openTemplateEditor,saveEntryTemplate,deleteEntryTemplate,showTemplateEntry,resetTemplateManager,setTemplateBusy,get snapshot(){return editingTemplate;}});').runInNewContext(context);
  api.initTemplates();return {elements,forms,context,api,writes};
}

const lunch={id:'lunch',name:'午饭',type:'expense',category:'餐饮',amount:1800};

test('面板关闭动画中不再套用模板、切换管理或启动模板读写',async()=>{
  const {elements,context,api,writes}=templateHarness([lunch]);await api.refreshTemplates();
  elements.amount.value='20.00';elements.entry.dataset.closing='true';
  context.confirm=()=>{throw new Error('关闭中不应确认删除');};
  context.templateStorage.get=async()=>{throw new Error('关闭中不应读取编辑快照');};
  api.applyEntryTemplate(lunch);assert.equal(elements.amount.value,'20.00');
  api.openTemplateManager();assert.equal(elements['template-manager'].hidden,true);
  await api.openTemplateEditor(lunch.id);
  assert.equal(elements['template-manager-status'].textContent,'');
  elements['template-name'].value='午饭';elements['template-type'].value='expense';
  elements['template-category'].value='餐饮';elements['template-amount'].value='18.00';
  await api.saveEntryTemplate();await api.deleteEntryTemplate(lunch);assert.equal(writes.length,0);
  elements['template-manager'].hidden=false;api.showTemplateEntry();
  assert.equal(elements['template-manager'].hidden,false);
  elements['template-cancel'].onclick();assert.equal(elements['template-name'].value,'午饭');
});

test('仅显示当前类型模板，套用需确认差异且保留日期，不创建账单',async()=>{
  const {elements,forms,context,api,writes}=templateHarness([lunch,{...lunch,id:'salary',name:'收入',type:'income',category:'工资'}]);
  await api.refreshTemplates();assert.equal(elements['template-list'].children.length,1);assert.match(elements['template-list'].children[0].textContent,/午饭 ¥18\.00/);
  api.applyEntryTemplate(lunch);assert.equal(elements.amount.value,'18.00');assert.equal(elements['edit-date'].value,'2026-09-30');
  assert.equal(forms[0].values.includes(elements.categories.children.find(button=>button.getAttribute('aria-pressed')==='true').textContent),true);
  let confirms=0;context.confirm=text=>{confirms++;assert.equal(text,'替换当前金额和分类？');return false;};
  elements.amount.value='20.00';api.applyEntryTemplate(lunch);assert.equal(elements.amount.value,'20.00');assert.equal(confirms,1);
  context.confirm=()=>true;api.applyEntryTemplate(lunch);assert.equal(elements.amount.value,'18.00');assert.equal(writes.length,0);
  context.confirm=()=>{throw new Error('相同内容不应确认');};api.applyEntryTemplate(lunch);assert.equal(elements.amount.value,'18.00');
  context.editingBill={id:'bill'};api.syncTemplateEntry();assert.equal(elements['template-bar'].hidden,true);
  elements.amount.value='25.00';api.applyEntryTemplate(lunch);assert.equal(elements.amount.value,'25.00');assert.equal(writes.length,0);
});

test('创建模板失败保留管理输入，连点不重复写入，主账单内容不变',async()=>{
  const {elements,context,api,writes}=templateHarness();await api.refreshTemplates();
  elements.amount.value='18.00';api.openTemplateManager();await api.refreshTemplates();
  assert.equal(elements['template-amount'].value,'18.00');elements['template-name'].value='午饭';elements['template-category'].value='餐饮';
  let reject;context.templateStorage.add=template=>{writes.push({method:'add',template});return new Promise((yes,no)=>{reject=no;});};
  const pending=api.saveEntryTemplate();assert.equal(context.busy,true);await api.saveEntryTemplate();assert.equal(writes.length,1);
  reject(new Error('存储失败'));await pending;
  assert.equal(elements['template-name'].value,'午饭');assert.equal(elements['template-amount'].value,'18.00');
  assert.equal(elements['template-manager'].hidden,false);assert.match(elements['template-manager-status'].textContent,/存储失败/);
  assert.equal(elements.amount.value,'18.00');assert.equal(elements['edit-date'].value,'2026-09-30');assert.equal(context.busy,false);
  context.templateStorage.add=async template=>{writes.push({method:'add',template});context.rows.push({...template});};
  await api.saveEntryTemplate();assert.equal(elements['template-manager'].hidden,true);assert.equal(elements.amount.value,'18.00');
  assert.equal(writes.length,2);assert.ok(writes.every(write=>write.method==='add'));assert.equal(context.rows.length,1);
});

test('模板编辑先读最新快照，冲突保留输入且必须明确重新载入才更新快照',async()=>{
  const {elements,context,api,writes}=templateHarness([lunch]);await api.refreshTemplates();api.openTemplateManager();await api.refreshTemplates();
  context.rows=[{...lunch,amount:2000}];await api.openTemplateEditor(lunch.id);
  assert.equal(elements['template-amount'].value,'20.00');assert.equal(api.snapshot.amount,2000);
  elements['template-amount'].value='22.00';
  context.templateStorage.update=async()=>{context.rows=[{...lunch,amount:2500}];throw Object.assign(new Error('模板已在其他页面修改'),{code:'TEMPLATE_CONFLICT'});};
  await api.saveEntryTemplate();assert.equal(elements['template-amount'].value,'22.00');assert.equal(api.snapshot.amount,2000);
  assert.match(elements['template-manager-status'].textContent,/其他页面修改.*重新载入/);assert.match(elements['template-items'].children[0].children[0].textContent,/25\.00/);
  await api.openTemplateEditor(lunch.id);assert.equal(elements['template-amount'].value,'25.00');assert.equal(api.snapshot.amount,2500);
  context.templateStorage.update=async(template,original)=>{writes.push({method:'update',template,original});context.rows=[{...template}];};
  elements['template-amount'].value='26.00';await api.saveEntryTemplate();
  assert.equal(writes[0].original.amount,2500);assert.equal(writes[0].template.amount,2600);assert.equal(elements['template-manager'].hidden,true);
  api.openTemplateManager();await api.refreshTemplates();await api.openTemplateEditor(lunch.id);elements['template-amount'].value='27.00';
  context.templateStorage.update=async()=>{context.rows=[];throw Object.assign(new Error('模板已删除'),{code:'TEMPLATE_CONFLICT'});};
  await api.saveEntryTemplate();assert.equal(elements['template-amount'].value,'27.00');assert.equal(api.snapshot.amount,2600);
  assert.match(elements['template-manager-status'].textContent,/已删除.*取消修改后新建/);
});

test('模板类型切换重置合法分类，删除先确认且不修改主账单',async()=>{
  const {elements,context,api,writes}=templateHarness([lunch]);await api.refreshTemplates();elements.amount.value='19.00';api.openTemplateManager();await api.refreshTemplates();
  await api.openTemplateEditor(lunch.id);elements['template-type'].value='income';elements['template-type'].onchange();
  assert.equal(elements['template-category'].value,'其他');assert.ok(!elements['template-category'].children.some(option=>option.value==='餐饮'));
  context.confirm=()=>false;await api.deleteEntryTemplate(lunch);assert.equal(writes.length,0);
  context.confirm=()=>true;await api.deleteEntryTemplate(lunch);assert.equal(writes[0].method,'remove');assert.equal(context.rows.length,0);
  assert.equal(elements.amount.value,'19.00');assert.equal(elements['edit-date'].value,'2026-09-30');assert.equal(api.snapshot,null);
});

test('模板读取失败显示重试且不影响手动输入，关闭管理后迟到读取不覆盖表单',async()=>{
  const {elements,context,api}=templateHarness([lunch]);await api.refreshTemplates();elements.amount.value='12.30';
  context.templateStorage.all=async()=>{throw new Error('无法读取模板');};await api.refreshTemplates();
  assert.equal(elements['retry-templates'].hidden,false);assert.match(elements['template-status'].textContent,/读取失败.*手动记账/);assert.equal(elements.amount.value,'12.30');
  context.templateStorage.all=async()=>[{...lunch}];api.openTemplateManager();await api.refreshTemplates();
  let resolve;context.templateStorage.get=()=>new Promise(done=>{resolve=done;});
  const pending=api.openTemplateEditor(lunch.id);api.resetTemplateManager();resolve({...lunch,amount:3500});await pending;
  assert.equal(elements['template-manager'].hidden,true);assert.equal(elements['entry-main'].hidden,false);assert.equal(elements.amount.value,'12.30');assert.equal(api.snapshot,null);
});
