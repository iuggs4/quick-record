import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInThisContext,Script} from 'node:vm';
import {spawnSync} from 'node:child_process';
const {parseAmount,amountText,validateBill,validateBackup,monthlyTotal,dailyExpenses,recentExpenses,walletRemaining,dateFromDay,monthDates,changeBillDate}=runInThisContext(readFileSync(new URL('../model.js',import.meta.url),'utf8') + ';({parseAmount,amountText,validateBill,validateBackup,monthlyTotal,dailyExpenses,recentExpenses,walletRemaining,dateFromDay,monthDates,changeBillDate})');
test('金额用整数分计算并拒绝无效输入',()=>{
  assert.equal(parseAmount('0.01'),1);assert.equal(parseAmount('12.30'),1230);
  for(const value of ['0','-1','1.001','1e3','','1.','900719925474099'])assert.throws(()=>parseAmount(value));
});

test('极大合法金额的显示和输入往返仍精确到分，负余额保留负号',()=>{
  const cents=9007199254740901;
  assert.equal(amountText(cents),'90071992547409.01');assert.equal(parseAmount(amountText(cents)),cents);
  assert.equal(amountText(Number.MAX_SAFE_INTEGER),'90071992547409.91');
  assert.equal(parseAmount(amountText(Number.MAX_SAFE_INTEGER)),Number.MAX_SAFE_INTEGER);
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const money=new Script(source.slice(source.indexOf('const money ='),source.indexOf('function syncAmountDisplay('))+';money;').runInNewContext({amountText});
  assert.equal(money(cents),'90,071,992,547,409.01');assert.equal(money(-1),'-0.01');
});
test('恢复校验版本、字段、重复 ID，规范化账单',()=>{
  const bill={id:'a',amount:1,category:'其他',createdAt:'2026-10-10T09:00:00.000Z'};
  assert.deepEqual(validateBackup({schemaVersion:1,bills:[bill]}),[bill]);
  for(const data of [{schemaVersion:3,bills:[]},{schemaVersion:1,bills:[bill,bill]},{schemaVersion:1,bills:[{...bill,amount:1.5}]},{schemaVersion:1,bills:[{...bill,createdAt:'bad'}]}])assert.throws(()=>validateBackup(data));
});

test('双击入口使用普通脚本，无模块加载依赖',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match=>match[1]);
  assert.deepEqual(scripts,['model.js','storage.js','calendar.js','templates.js','app.js']);
  assert.ok(!html.includes('type="module"'));
  for(const name of scripts)new Script(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
});

test('当月支出按本地月份汇总，不包含其他月份和年份',()=>{
  const bill=(year,month,day,amount)=>({amount,createdAt:new Date(year,month,day,12).toISOString()});
  assert.equal(monthlyTotal([bill(2026,9,1,123),bill(2026,9,31,200),bill(2026,8,30,999),bill(2025,9,1,999)],new Date(2026,9,15)),323);
  assert.equal(monthlyTotal([],new Date(2026,9,15)),0);
  assert.throws(()=>monthlyTotal([bill(2026,9,1,Number.MAX_SAFE_INTEGER),bill(2026,9,2,1)],new Date(2026,9,15)));
});


test('每日概览计数汇总，七天图跨年补零并排除未来日期',()=>{
  const bill=(year,month,day,amount)=>({amount,createdAt:new Date(year,month,day,12).toISOString()});
  const days=dailyExpenses([bill(2025,11,31,100),bill(2025,11,31,200),bill(2026,0,2,400),bill(2026,0,3,999),bill(2025,11,26,999)]);
  const dec31=days.find(day=>day.date==='2025-12-31');
  assert.equal(dec31.bills.length,2);assert.equal(dec31.total,300);
  const week=recentExpenses(days,new Date(2026,0,2));
  assert.equal(week.length,7);assert.equal(week[0].date,'2025-12-27');assert.equal(week[6].date,'2026-01-02');
  assert.deepEqual(week.map(day=>day.total),[0,0,0,0,300,0,400]);
  assert.equal(dailyExpenses([]).length,0);
  assert.throws(()=>dailyExpenses([bill(2026,0,1,Number.MAX_SAFE_INTEGER),bill(2026,0,1,1)]));
});

test('重复渲染只保留一组七天柱状图和一份空概览',()=>{
  const element=()=>({children:[],style:{},setAttribute(){},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}});
  const chart=element(),overview=element(),subtitle=element();
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const rendering=source.slice(source.indexOf('function renderDailyChart('),source.indexOf('async function renderBills('));
  const context={document:{createElement:element},$:id=>id==='daily-chart'?chart:id==='weekly-summary'?subtitle:overview,money:value=>(value/100).toFixed(2),localDay:date=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')};
  const run=new Script(rendering+';renderDailyChart(days);renderDailyOverview([]);');
  context.days=recentExpenses([],new Date(2026,9,15));
  run.runInNewContext(context);run.runInNewContext(context);
  assert.equal(subtitle.textContent,'花费 0.00 元');
  assert.ok(chart.children.every(column=>column.children[0].textContent==='0%'));
  context.days[6].total=10100;run.runInNewContext(context);
  assert.equal(subtitle.textContent,'花费 101.00 元');
  assert.equal(chart.children[6].children[0].textContent,'100%');
  assert.equal(chart.children[6].children[1].children[0].style.height,'100%');
  context.days[5].total=100;context.days[6].total=300;run.runInNewContext(context);
  assert.equal(chart.children[5].children[0].textContent,'33.3%');
  assert.equal(chart.children[6].children[0].textContent,'100%');
  assert.ok(Math.abs(parseFloat(chart.children[5].children[1].children[0].style.height)-100/3)<0.001);
  assert.equal(chart.children[6].children[1].children[0].style.height,'100%');
  assert.equal(chart.children[6].children[1].children[0].style.backgroundColor,'hsl(0, 0%, 16%)');
  assert.equal(chart.children[5].children[1].children[0].style.backgroundColor,'hsl(0, 0%, 52%)');
  assert.equal(chart.children[0].children[1].children[0].style.height,'0%');
  assert.equal(chart.children.length,7);assert.equal(overview.children.length,1);
  assert.equal(overview.children[0].children[0].children[1].textContent,'¥0.00');
  assert.match(overview.children[0].children[0].children[0].textContent,/^\d{4}-\d{2}-\d{2}$/);
  new Script(rendering+`;renderDailyOverview([{date:'2026-10-14',total:100,bills:[]},{date:'2026-10-15',total:200,bills:[]}],new Date(2026,9,15));`).runInNewContext(context);
  assert.equal(overview.children.length,1);
  assert.equal(overview.children[0].children[0].children[0].textContent,'2026-10-15');
  assert.equal(overview.children[0].children[0].children[1].textContent,'¥2.00');
  new Script(rendering+`;renderDailyOverview([{date:'2026-10-15',total:200,bills:[]}],new Date(2026,10,1));`).runInNewContext(context);
  assert.equal(overview.children[0].children[0].children[0].textContent,'2026-11-01');
  assert.equal(overview.children[0].children[0].children[1].textContent,'¥0.00');
  assert.deepEqual(chart.children.map(column=>column.children[2].dateTime),context.days.map(day=>day.date));
});


test('金额输入请求系统小数键盘，不提供自定义键盘',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<input id="amount"[^>]*inputmode="decimal"/);
  assert.ok(!html.includes('id="keyboard"'));
  assert.ok(!html.includes('id="keys"'));
});

test('钱包按1500元预算减支出加收入，保留超支负数',()=>{
  assert.equal(walletRemaining(0),150000);
  assert.equal(walletRemaining(100),149900);
  assert.equal(walletRemaining(150000),0);
  assert.equal(walletRemaining(160000),-10000);
  assert.equal(walletRemaining(10000,5000),145000);
  assert.throws(()=>walletRemaining(-1));
  assert.throws(()=>walletRemaining(0,Number.MAX_SAFE_INTEGER));
});





test('收入独立校验、参与余额但不进入支出图，兼容旧账单备份',()=>{
  const expense={id:'old',amount:10000,category:'餐饮',createdAt:new Date(2026,9,15,12).toISOString()};
  const income={id:'income',type:'income',amount:50000,category:'工资',createdAt:expense.createdAt};
  const bills=validateBackup({schemaVersion:2,bills:[expense,income]});
  const now=new Date(2026,9,15);
  assert.equal(monthlyTotal(bills,now),10000);
  assert.equal(monthlyTotal(bills,now,'income'),50000);
  assert.equal(walletRemaining(monthlyTotal(bills,now),monthlyTotal(bills,now,'income')),190000);
  assert.equal(dailyExpenses(bills)[0].total,10000);
  assert.equal(dailyExpenses([income]).length,0);
  assert.deepEqual(validateBackup({schemaVersion:1,bills:[expense]}),[expense]);
  assert.deepEqual(validateBackup({schemaVersion:2,bills:JSON.parse(JSON.stringify(bills))}),bills);
  assert.throws(()=>validateBackup({schemaVersion:1,bills:[income]}));
  assert.throws(()=>validateBackup({schemaVersion:2,bills:[{...income,type:'unknown'}]}));
  assert.throws(()=>validateBackup({schemaVersion:2,bills:[{...income,category:'餐饮'}]}));
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<input id="income-amount"[^>]*inputmode="decimal"/);
  assert.ok(html.includes('Quick Add'));assert.ok(html.includes('Expend'));assert.ok(html.includes('Income'));
});

test('Quick Add切换收支同步选中状态并重置两份金额',()=>{
  const elements={
    'entry-tabs':{dataset:{}},'expense-panel':{hidden:false},'income-panel':{hidden:true},
    'entry-notice':{textContent:''},amount:{value:'12.30'},'income-amount':{value:'100'}
  };
  const tabs=['expense','income'].map(type=>({dataset:{type},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}));
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const switching=source.slice(source.indexOf('function resetEntryAmounts('),source.indexOf('const entryTabs='));
  const context={busy:false,$:id=>elements[id],document:{querySelectorAll:()=>tabs},syncAmountDisplay:()=>{},syncTemplateEntry:()=>{}};
  new Script(switching+`;selectEntryType('income');`).runInNewContext(context);
  assert.equal(elements['expense-panel'].hidden,true);
  assert.equal(elements['income-panel'].hidden,false);
  assert.equal(elements['entry-tabs'].dataset.type,'income');
  assert.equal(tabs[1].attributes['aria-selected'],'true');assert.equal(tabs[1].tabIndex,0);
  context.busy=true;elements['income-amount'].value='100';
  new Script(switching+`;selectEntryType('expense');`).runInNewContext(context);
  assert.equal(elements['entry-tabs'].dataset.type,'income');assert.equal(elements['income-amount'].value,'100');
  context.busy=false;
  new Script(switching+`;selectEntryType('expense');`).runInNewContext(context);
  assert.equal(elements['expense-panel'].hidden,false);assert.equal(elements['income-panel'].hidden,true);
  assert.equal(elements.amount.value,'');assert.equal(elements['income-amount'].value,'');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<dialog id="entry" aria-labelledby="quick-add-title">/);
  assert.match(html,/id="income-panel"[^>]*hidden/);
});

test('金额展示宽度随实时输入与保存清空同步，不改写输入值',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const sync=source.slice(source.indexOf('function syncAmountDisplay('),source.indexOf('function setBusy('));
  const measure={textContent:''};const input={id:'amount',value:'1234.50'};
  const context={$:id=>{assert.equal(id,'amount-measure');return measure;},input};
  const run=new Script(sync+';syncAmountDisplay(input);');
  run.runInNewContext(context);assert.equal(measure.textContent,'1234.50');assert.equal(input.value,'1234.50');
  input.value='';run.runInNewContext(context);assert.equal(measure.textContent,'0.0');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(!html.includes('>金额</label>'));
  assert.match(html,/id="close-entry"[^>]*><svg/);
});

test('记账面板等下滑动画结束才关闭，防重复关闭并适配减少动态效果',async()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const closing=source.slice(source.indexOf('async function closeEntry('),source.indexOf("$('close-entry').onclick="));
  let finish,closes=0,cancels=0,animations=0,reduced=false;
  const panel={open:true,dataset:{},close(){this.open=false;closes++;},animate(frames){animations++;assert.equal(frames[1].transform,'translateY(100%)');return {finished:new Promise(resolve=>{finish=resolve;}),cancel(){cancels++;}};}};
  const context={busy:true,$:()=>panel,matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({transform:'none',opacity:'1'})};
  const close= new Script(closing+';closeEntry;').runInNewContext(context);
  await close();assert.equal(panel.open,true);assert.equal(animations,0);assert.equal(panel.dataset.closing,undefined);
  context.busy=false;
  const pending=close();assert.equal(panel.open,true);await close();assert.equal(animations,1);
  finish();await pending;assert.equal(closes,1);assert.equal(cancels,1);assert.equal(panel.dataset.closing,undefined);
  panel.open=true;reduced=true;context.busy=true;await close();assert.equal(panel.open,true);assert.equal(closes,1);
  context.busy=false;await close();assert.equal(closes,2);assert.equal(animations,1);
});

function entrySaveHarness(reduced=false){
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const element=id=>({id,children:[],dataset:{},attributes:{},listeners:{},disabled:false,value:'',textContent:'',
    append(...nodes){this.children.push(...nodes);},setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(name,callback){this.listeners[name]=callback;},closest(){return {addEventListener(){}};},focus(){},
    click(){if(!this.disabled)return this.onclick?.();}
  });
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],element(match[1])]));
  const tabs=['expend-tab','income-tab'].map((id,index)=>{elements[id].dataset.type=index?'income':'expense';return elements[id];});
  elements['entry-tabs'].dataset.type='expense';elements['expense-panel'].hidden=false;elements['income-panel'].hidden=true;
  let resolve,reject,finish,beganClosing,latestBill,readError,renders=0;
  const closing=new Promise(done=>{beganClosing=done;});
  const writes=[],write=(method,bill,original)=>{writes.push({method,bill,original});return new Promise((yes,no)=>{resolve=yes;reject=no;});};
  const panel=elements.entry;
  panel.showModal=()=>{panel.open=true;};panel.close=()=>{panel.open=false;panel.listeners.close();beganClosing();};
  panel.getBoundingClientRect=()=>({left:0,right:100,top:0,bottom:100});
  panel.animate=()=>{beganClosing();return {finished:new Promise(done=>{finish=done;}),cancel(){}};};
  const setup=source.slice(0,source.indexOf('let homeDate ='))+
    source.slice(source.indexOf('async function openBillEditor('),source.indexOf('function selectNav('))+
    source.slice(source.indexOf('async function closeEntry('),source.indexOf("$('more').onclick="));
  const api=new Script(readFileSync(new URL('../model.js',import.meta.url),'utf8')+'\n'+setup+
    ';({forms:entryForms,selectEntryType,openBillEditor,closeEntry,get busy(){return busy;},get editingBill(){return editingBill;}});').runInNewContext({
    document:{getElementById:id=>elements[id],createElement:()=>element(),querySelectorAll:()=>tabs},
    crypto:{randomUUID:()=> 'new-id'},storage:{get:async()=>{if(readError)throw new Error(readError);return latestBill?{...latestBill}:undefined;},add:bill=>write('add',bill),update:(bill,original)=>write('update',bill,original)},
    matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({transform:'none',opacity:'1'}),
    setTemplateBusy(){},syncTemplateEntry(){},resetTemplateManager(){},selectNav(){},renderHome(){renders++;},renderTimeline(){},renderBills(){}
  });
  const open=api.openBillEditor;api.openBillEditor=bill=>{if(!latestBill || latestBill.id!==bill.id)latestBill={...bill};return open(bill);};
  return {elements,api,writes,closing,setLatestBill:bill=>{latestBill={...bill};readError='';},failRead:text=>{readError=text;},resolve:()=>resolve(),reject:(message='写入失败')=>reject(new Error(message)),finish:()=>finish(),renders:()=>renders};
}

test('异步新增拦截重复提交，成功清空金额、保留分类并留在面板',async()=>{
  for(const type of ['expense','income']){
    const h=entrySaveHarness(),{elements,api}=h,form=api.forms.find(form=>form.type===type);
    api.selectEntryType(type);elements.entry.showModal();form.choose(form.values[0]);
    elements[form.amount].value='12.30';elements['edit-date'].value='2026-09-30';
    const pending=elements[form.save].onclick();
    await elements[form.save].onclick();await elements[type==='expense'?'income-save':'save'].onclick();
    assert.equal(h.writes.length,1);assert.equal(h.writes[0].method,'add');assert.equal(api.busy,true);
    assert.equal(elements[form.save].textContent,'保存中…');
    h.resolve();await pending;
    assert.equal(h.writes[0].bill.id,'new-id');assert.equal(h.writes[0].bill.amount,1230);
    assert.equal(h.writes[0].bill.type,type);assert.equal(h.writes[0].bill.category,form.values[0]);
    assert.equal(elements.entry.open,true);assert.equal(elements[form.amount].value,'');
    assert.equal(elements[form.amount+'-measure'].textContent,'0.0');assert.equal(elements[form.categories].children[0].attributes['aria-pressed'],'true');
    assert.equal(elements[form.save].textContent,'完成');assert.equal(api.busy,false);assert.equal(h.renders(),1);
  }
});

test('异步保存失败锁定所有切换与关闭入口，保留完整输入和编辑对象并允许重试',async()=>{
  for(const type of ['expense','income'])for(const editing of [false,true]){
    const h=entrySaveHarness(),{elements,api}=h,form=api.forms.find(form=>form.type===type);
    const original={id:'original',type,amount:500,category:form.values[0],createdAt:new Date(2026,9,15,17,20,47,123).toISOString()};
    if(editing)await api.openBillEditor(original);else{api.selectEntryType(type);elements.entry.showModal();}
    form.choose(form.values[0]);elements[form.amount].value='12.30';elements['edit-date'].value='2026-09-30';
    const pending=elements[form.save].onclick();
    const controls=['amount','income-amount','save','income-save','edit-date','expend-tab','income-tab','close-entry','edit-bills','finish-editing'];
    const buttons=api.forms.flatMap(form=>elements[form.categories].children);
    assert.ok(controls.every(id=>elements[id].disabled));assert.ok(buttons.every(button=>button.disabled));
    form.choose(form.values[1]);api.selectEntryType(type==='expense'?'income':'expense');
    elements[type==='expense'?'income-tab':'expend-tab'].onkeydown({key:'ArrowRight',preventDefault(){}});
    await elements['close-entry'].onclick();
    let prevented=false;elements.entry.listeners.cancel({preventDefault(){prevented=true;}});
    elements.entry.listeners.click({target:elements.entry,clientX:-1,clientY:-1});
    assert.equal(prevented,true);assert.equal(elements.entry.open,true);assert.equal(elements.entry.dataset.closing,undefined);
    assert.equal(elements['entry-tabs'].dataset.type,type);assert.equal(elements[form.amount].value,'12.30');
    h.reject();await pending;
    assert.equal(elements['entry-notice'].textContent,'写入失败');assert.equal(elements[form.amount].value,'12.30');
    assert.equal(elements['edit-date'].value,'2026-09-30');assert.equal(elements['entry-tabs'].dataset.type,type);
    assert.equal(elements[form.categories].children[0].attributes['aria-pressed'],'true');
    if(editing)assert.deepEqual({...api.editingBill},original);else assert.equal(api.editingBill,null);
    assert.equal(original.amount,500);assert.equal(elements.entry.open,true);
    assert.equal(api.busy,false);assert.ok(controls.every(id=>!elements[id].disabled));assert.ok(buttons.every(button=>!button.disabled));
    assert.equal(elements[form.save].textContent,editing?'保存修改':'完成');assert.equal(h.renders(),0);
    const retry=elements[form.save].onclick();assert.equal(h.writes.length,2);
    assert.equal(h.writes[1].bill.category,form.values[0]);assert.equal(h.writes[1].method,editing?'update':'add');
    h.reject();await retry;
  }
});

test('异步编辑成功解锁后关闭，保留ID和时分秒，关闭动画中不能再次保存',async()=>{
  for(const reduced of [false,true]){
    const h=entrySaveHarness(reduced),{elements,api}=h;
    const original={id:'original',amount:500,category:'餐饮',createdAt:new Date(2026,9,15,17,20,47,123).toISOString()};
    await api.openBillEditor(original);api.selectEntryType('income');api.forms[1].choose('工资');
    elements['income-amount'].value='25.00';elements['edit-date'].value='2026-09-30';
    const pending=elements['income-save'].onclick();h.resolve();await Promise.race([h.closing,pending]);
    if(!reduced){
      assert.equal(api.busy,false);assert.equal(elements.entry.open,true);assert.equal(elements.entry.dataset.closing,'true');
      await elements['income-save'].onclick();assert.equal(h.writes.length,1);h.finish();
    }
    await pending;
    const {method,bill}=h.writes[0];assert.equal(method,'update');assert.equal(bill.id,original.id);
    assert.deepEqual({...h.writes[0].original},original);assert.notEqual(h.writes[0].original,original);
    assert.equal(bill.type,'income');assert.equal(bill.amount,2500);assert.equal(bill.category,'工资');
    assert.equal(bill.createdAt,changeBillDate(original.createdAt,'2026-09-30'));assert.equal(original.amount,500);
    assert.equal(elements.entry.open,false);assert.equal(api.editingBill,null);assert.equal(api.busy,false);
    assert.equal(elements['income-save'].textContent,'完成');assert.equal(h.renders(),1);
  }
});

test('编辑使用打开时的副本，冲突保留输入且不自动重设快照',async()=>{
  const h=entrySaveHarness(),{elements,api}=h;
  const original={id:'conflict',amount:1000,category:'餐饮',createdAt:new Date(2026,9,15,12).toISOString()};
  await api.openBillEditor(original);original.amount=2000;
  elements.amount.value='12.30';elements['edit-date'].value='2026-09-30';
  const pending=elements.save.onclick();assert.equal(h.writes[0].original.amount,1000);
  h.reject('账单已在其他页面修改，输入已保留。请关闭编辑面板后重新打开');await pending;
  assert.equal(elements.amount.value,'12.30');assert.equal(elements['edit-date'].value,'2026-09-30');
  assert.equal(api.editingBill.amount,1000);assert.equal(elements.entry.open,true);assert.equal(api.busy,false);
  assert.match(elements['entry-notice'].textContent,/其他页面修改.*输入已保留/);
});

test('旧列表编辑冲突后关闭重开按ID读取最新记录，读取失败不打开旧表单',async()=>{
  const h=entrySaveHarness(true),{elements,api}=h;
  const old={id:'reopen',amount:1000,category:'餐饮',createdAt:new Date(2026,9,15,12).toISOString()};
  await api.openBillEditor(old);elements.amount.value='12.30';
  const conflict=elements.save.onclick();h.reject('账单已在其他页面修改，输入已保留');await conflict;
  assert.equal(elements.amount.value,'12.30');assert.equal(api.editingBill.amount,1000);
  await api.closeEntry();h.failRead('最新账单读取失败');
  await api.openBillEditor(old);
  assert.equal(elements.entry.open,false);assert.equal(api.editingBill,null);assert.equal(api.busy,false);
  assert.match(elements.notice.textContent,/最新账单读取失败/);
  const latest={...old,amount:2000,category:'交通'};h.setLatestBill(latest);
  await api.openBillEditor(old);
  assert.equal(elements.entry.open,true);assert.equal(elements.amount.value,'20.00');
  assert.deepEqual({...api.editingBill},latest);assert.equal(old.amount,1000);
  h.failRead('不应重复读取');await api.openBillEditor(old);
  assert.equal(elements.amount.value,'20.00');assert.deepEqual({...api.editingBill},latest);
  elements.amount.value='25.00';const saved=elements.save.onclick();h.resolve();await saved;
  assert.deepEqual({...h.writes[1].original},latest);assert.equal(h.writes[1].bill.amount,2500);
  assert.equal(elements.entry.open,false);
});

test('极大合法金额打开编辑后直接保存不会改变分值',async()=>{
  const h=entrySaveHarness(true),{elements,api}=h;
  const original={id:'large',amount:9007199254740901,category:'其他',createdAt:new Date(2026,9,15,12).toISOString()};
  await api.openBillEditor(original);assert.equal(elements.amount.value,'90071992547409.01');
  const pending=elements.save.onclick();h.resolve();await pending;
  assert.equal(h.writes[0].bill.amount,original.amount);
});

test('新增和编辑拒绝非空超范围日期，不静默改期或写入',async()=>{
  for(const editing of [false,true]){
    const {elements,api,writes}=entrySaveHarness();
    if(editing)await api.openBillEditor({id:'date',amount:1000,category:'餐饮',createdAt:new Date(2026,9,15,12).toISOString()});
    else elements.entry.showModal();
    elements.amount.value='12.30';elements['edit-date'].value='0099-12-31';
    await elements.save.onclick();
    assert.equal(writes.length,0);assert.equal(elements.amount.value,'12.30');assert.equal(elements['edit-date'].value,'0099-12-31');
    assert.match(elements['entry-notice'].textContent,/0100-01-01/);assert.equal(api.busy,false);
  }
});


test('编辑事务更新原记录及指定日期，不创建不存在的账单',async()=>{
  const model=readFileSync(new URL('../model.js',import.meta.url),'utf8');
  const validate=new Script(model+';validateBill;').runInNewContext({});
  const original={id:'original',type:'expense',amount:1300,category:'餐饮',createdAt:'2026-10-15T08:00:00.000Z'};
  let current=original,written,aborted=false;
  const store={transaction:{abort(){aborted=true;}},get(id){assert.equal(id,original.id);return {result:current,set onsuccess(callback){callback();}};},put(bill){written=bill;}};
  const source=readFileSync(new URL('../storage.js',import.meta.url),'utf8');
  const api=new Script(source.slice(source.indexOf('const storage ='))+';storage;').runInNewContext({validateBill:validate,transaction:async(mode,action)=>{assert.equal(mode,'readwrite');return action(store,error=>{store.transaction.abort();throw error;});}});
  await api.update({...original,amount:2500,category:'交通',createdAt:'2026-10-16T08:00:00.000Z'},original);
  assert.equal(written.id,original.id);assert.equal(written.amount,2500);assert.equal(written.category,'交通');assert.equal(written.createdAt,'2026-10-16T08:00:00.000Z');
  assert.throws(()=>api.update({...original,amount:0},original));
  current=undefined;written=undefined;await assert.rejects(api.update(original,original),/已不存在/);assert.equal(aborted,true);assert.equal(written,undefined);
});

test('账单仅展示时间轴选中日期，行内保留时间和逐条编辑入口',async()=>{
  const element=()=>({children:[],dataset:{},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},setAttribute(){}});
  const list=element();const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const rendering=source.slice(source.indexOf('async function renderBills('),source.indexOf('function renderTimeline('));
  const bills=[{id:'a',category:'餐饮',amount:100,createdAt:new Date(2026,9,15,12).toISOString()},{id:'b',type:'income',category:'工资',amount:200,createdAt:new Date(2026,9,16,12).toISOString()},{id:'c',category:'交通',amount:300,createdAt:new Date(2026,9,15,14).toISOString()}];
  const context={billsView:'timeline',billsRequest:0,setReadState(){},selectedBillDate:'2026-10-15',storage:{all:async()=>bills},$:id=>id==='bill-list'?list:element(),document:{createElement:element},localDay:date=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'),money:amount=>(amount/100).toFixed(2),editingList:true,message:error=>{throw new Error(error);},openBillEditor:()=>{}};
  await new Script(rendering+';renderBills();').runInNewContext(context);
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children[0].children[0].textContent,'2026-10-15');
  assert.equal(list.children[0].children.length,3);
  const row=list.children[0].children[1];
  assert.match(row.children[0].children[0].textContent,/^\d{2}:\d{2}:\d{2}$/);
  assert.equal(row.children[1].children[0].textContent,'− ¥3.00');
  assert.equal(row.children[1].children[1].textContent,'编辑');
});

function ledgerReadHarness(){
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const document={activeElement:null,body:{}};
  const element=()=>({children:[],dataset:{},attributes:{},style:{},textContent:'',
    append(...nodes){this.children.push(...nodes);},contains(node){return this.children.includes(node);},focus(){document.activeElement=this;},
    replaceChildren(...nodes){if(this.contains(document.activeElement))document.activeElement=document.body;this.children=nodes;},
    setAttribute(name,value){this.attributes[name]=value;}
  });
  document.createElement=element;
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],element()]));
  for(const id of ['home-expense','home-income','home-expense-detail','wallet-remaining','wallet-expense'])elements[id].textContent='—';
  const requests=[];
  const rendering=source.slice(source.indexOf('let homeDate ='),source.indexOf('function updateTodayShortcut('));
  const api=new Script(readFileSync(new URL('../model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../calendar.js',import.meta.url),'utf8')+'\n'+rendering+
    ';({renderHome,renderBills,setDate(value){selectedBillDate=value;},setView(value){billsView=value;},get selectedDate(){return selectedBillDate;}});').runInNewContext({
    Date:class extends Date{constructor(...args){super(...(args.length?args:[2026,9,26,12]));}},
    $:id=>elements[id],document,selectCalendarDate(){},storage:{all:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))},
    money:amount=>(amount/100).toFixed(2),billsView:'timeline',selectedBillDate:'2026-10-15',editingList:true,openBillEditor(){}
  });
  return {elements,requests,api,document};
}

test('首页区分读取、空账本和失败，旧读取的成功或错误不能覆盖最新统计',async()=>{
  const {elements,requests,api}=ledgerReadHarness();
  const failed=api.renderHome();
  assert.equal(elements.home.dataset.readState,'loading');assert.equal(elements['home-cards'].attributes['aria-busy'],'true');
  requests[0].reject(new Error('无法读取'));await failed;
  assert.equal(elements.home.dataset.readState,'error');assert.equal(elements['home-expense'].textContent,'—');
  assert.equal(elements['home-income'].textContent,'—');assert.equal(elements['home-retry'].hidden,false);
  assert.match(elements['home-read-status'].textContent,/无法读取/);
  const empty=api.renderHome();requests[1].resolve([]);await empty;
  assert.equal(elements.home.dataset.readState,'empty');assert.equal(elements['home-expense'].textContent,'¥0.00');
  assert.equal(elements['home-cards'].attributes['aria-busy'],'false');assert.equal(elements['home-retry'].hidden,true);
  assert.match(elements['home-read-status'].textContent,/暂无账单/);assert.equal(elements['daily-chart'].children.length,7);
  const olderSuccess=api.renderHome(),olderFailure=api.renderHome(),latest=api.renderHome();
  const bill={id:'latest',amount:300,category:'其他',createdAt:new Date(2026,9,26,12).toISOString()};
  requests[4].resolve([bill]);await latest;
  requests[2].resolve([{...bill,amount:100}]);await olderSuccess;
  requests[3].reject(new Error('过期错误'));await olderFailure;
  assert.equal(elements.home.dataset.readState,'ready');assert.equal(elements['home-expense'].textContent,'¥3.00');
  assert.equal(elements['home-read-status'].textContent,'');assert.equal(elements['home-retry'].hidden,true);
  const update=api.renderHome();assert.match(elements['home-read-status'].textContent,/上次读取结果/);
  requests[5].reject(new Error('更新失败'));await update;
  assert.equal(elements['home-expense'].textContent,'¥3.00');assert.equal(elements.home.dataset.readState,'error');
  assert.match(elements['home-read-status'].textContent,/更新失败.*上次读取结果/);
  const historical=api.renderHome();
  const old={...bill,createdAt:new Date(2026,8,1,12).toISOString(),amount:Number.MAX_SAFE_INTEGER};
  requests[6].resolve([bill,{...old,id:'old-a'},{...old,id:'old-b'}]);await historical;
  assert.equal(elements.home.dataset.readState,'ready');assert.equal(elements['home-expense'].textContent,'¥3.00');
});

test('账单同日并发只显示最新结果，切换日期后不保留旧列表，失败可重读为空状态',async()=>{
  const {elements,requests,api}=ledgerReadHarness(),list=elements['bill-list'];
  const bill={id:'old',amount:100,category:'其他',createdAt:new Date(2026,9,15,12).toISOString()};
  const first=api.renderBills();requests[0].resolve([bill]);await first;
  assert.equal(list.dataset.date,'2026-10-15');assert.equal(list.children.length,1);
  const stale=api.renderBills(),latest=api.renderBills();
  assert.equal(list.children.length,1);assert.equal(list.attributes['aria-busy'],'true');
  requests[2].resolve([{...bill,amount:300}]);await latest;
  requests[1].resolve([bill]);await stale;
  assert.equal(list.children[0].children[1].children[1].children[0].textContent,'− ¥3.00');
  const staleError=api.renderBills();
  api.setDate('2026-10-16');const failed=api.renderBills();
  assert.equal(list.children.length,0);assert.equal(list.dataset.date,undefined);
  assert.match(elements['bills-read-status'].textContent,/2026-10-16.*读取/);
  requests[4].reject(new Error('日期读取失败'));await failed;
  requests[3].reject(new Error('过期错误'));await staleError;
  assert.equal(elements.bills.dataset.readState,'error');assert.equal(elements['bills-retry'].hidden,false);
  assert.match(elements['bills-read-status'].textContent,/2026-10-16.*日期读取失败/);assert.equal(list.children.length,0);
  const retry=api.renderBills();requests[5].resolve([]);await retry;
  assert.equal(elements.bills.dataset.readState,'empty');assert.equal(elements['bills-retry'].hidden,true);
  assert.match(elements['bills-read-status'].textContent,/2026-10-16 暂无账单/);assert.equal(api.selectedDate,'2026-10-16');
  assert.equal(list.attributes['aria-busy'],'false');
});

test('月历和列表共用一次读取，同月选日保留焦点，切月失败不残留旧热度与空月文案',async()=>{
  const {elements,requests,api,document}=ledgerReadHarness(),grid=elements['calendar-days'];
  api.setView('calendar');
  const bill={id:'calendar',amount:100,category:'餐饮',createdAt:new Date(2026,9,15,12).toISOString()};
  const first=api.renderBills();assert.equal(requests.length,1);requests[0].resolve([bill]);await first;
  assert.equal(elements['calendar-view'].dataset.month,'2026-10');
  assert.equal(elements['bill-list'].children.length,1);assert.match(elements['calendar-summary'].textContent,/支出 ¥1.00/);
  const date=grid.children.find(node=>node.dataset.date==='2026-10-16');date.focus();api.setDate('2026-10-16');
  const next=api.renderBills();assert.equal(document.activeElement,date);assert.equal(date.attributes['aria-pressed'],'true');
  requests[1].resolve([bill]);await next;
  assert.equal(document.activeElement.dataset.date,'2026-10-16');assert.equal(document.activeElement.tabIndex,0);
  assert.match(elements['calendar-summary'].textContent,/无记录/);assert.equal(elements['bill-list'].children.length,0);
  const stale=api.renderBills();api.setDate('2026-11-16');const failed=api.renderBills();
  assert.equal(grid.children.length,0);assert.equal(elements['calendar-summary'].textContent,'');
  assert.equal(elements['calendar-legend'].textContent,'');
  requests[3].reject(new Error('切月失败'));await failed;requests[2].resolve([]);await stale;
  assert.equal(grid.children.length,0);assert.match(elements['bills-read-status'].textContent,/切月失败/);
  assert.equal(elements['bills-retry'].hidden,false);
  const retry=api.renderBills();requests[4].resolve([]);await retry;
  assert.equal(elements['calendar-view'].dataset.month,'2026-11');assert.equal(elements.bills.dataset.readState,'empty');
  assert.match(elements['calendar-legend'].textContent,/本月暂无账单/);
});

test('恢复事件合并读取并保留历史日期，定时器只检查跨天，扩展仅在写入成功后刷新',async()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const timers=new Map(),listeners={},elements={'home-retry':{},'bills-retry':{}};
  let nextTimer=0,tick,homeReads=0,billReads=0,shortcuts=0,write;
  const context={page:'home',homeDate:'2026-10-26',selectedBillDate:'2026-09-30',localDay:()=> '2026-10-26',
    $:id=>elements[id],document:{hidden:false,addEventListener(name,callback){listeners[name]=callback;}},
    window:{addEventListener(name,callback){listeners[name]=callback;}},
    setTimeout(callback){const id=++nextTimer;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},
    setInterval(callback,delay){assert.equal(delay,60000);tick=callback;},
    renderHome(){homeReads++;},renderBills(){billReads++;},updateTodayShortcut(){shortcuts++;},
    initTemplates(){},storage:{add:()=>new Promise((resolve,reject)=>{write={resolve,reject};}),all:async()=>[]},slots:{},modules:new Set()
  };
  const setup=source.slice(source.indexOf('let refreshTimer;'))+
    source.slice(source.indexOf('window.Ledger='),source.indexOf("if(location.protocol"));
  new Script(setup).runInNewContext(context);
  const flush=()=>{const callbacks=[...timers.values()];timers.clear();for(const callback of callbacks)callback();};
  listeners.pageshow();listeners.visibilitychange();assert.equal(timers.size,1);flush();assert.equal(homeReads,1);
  tick();assert.equal(timers.size,0);assert.equal(homeReads,1);
  context.homeDate='2026-10-25';tick();assert.equal(timers.size,1);flush();assert.equal(homeReads,2);
  context.document.hidden=true;listeners.visibilitychange();listeners.pageshow();assert.equal(timers.size,0);
  context.page='bills';context.document.hidden=false;listeners.visibilitychange();listeners.pageshow();
  assert.equal(timers.size,1);flush();assert.equal(billReads,1);assert.equal(context.selectedBillDate,'2026-09-30');
  const before=shortcuts;tick();assert.equal(shortcuts,before+1);assert.equal(billReads,1);assert.equal(timers.size,0);
  listeners.pageshow();elements['bills-retry'].onclick();assert.equal(timers.size,0);assert.equal(billReads,2);
  const added=context.window.Ledger.addBill({id:'extension'});assert.equal(timers.size,0);
  write.resolve('extension');assert.equal(await added,'extension');assert.equal(timers.size,1);flush();assert.equal(billReads,3);
  const rejected=context.window.Ledger.addBill({id:'failed'});write.reject(new Error('写入失败'));
  await assert.rejects(rejected,/写入失败/);assert.equal(timers.size,0);assert.equal(billReads,3);
  context.storage.add=()=>{throw new Error('账单字段无效');};
  assert.throws(()=>context.window.Ledger.addBill({}),/账单字段无效/);assert.equal(timers.size,0);
});


test('时间轴月份包含闰日并正确跨年',()=>{
  assert.equal(monthDates(new Date(2024,1,15)).length,29);
  assert.equal(monthDates(new Date(2025,1,15)).length,28);
  const december=monthDates(new Date(2026,11,31));
  assert.equal(december[0],'2026-12-01');assert.equal(december.at(-1),'2026-12-31');
  assert.equal(monthDates(new Date(2026,12,1))[0],'2027-01-01');
});

test('日期校验、月份列表和保存使用相同的本地0100至9999年边界',()=>{
  assert.equal(monthDates(dateFromDay('0100-01-01'))[0],'0100-01-01');
  assert.equal(monthDates(dateFromDay('9999-12-31')).at(-1),'9999-12-31');
  const before=dateFromDay('0100-01-01');before.setMonth(-1);assert.deepEqual(monthDates(before),[]);
  const after=dateFromDay('9999-12-31');after.setMonth(12);assert.deepEqual(monthDates(after),[]);
  assert.equal(dateFromDay('0400-02-29').getFullYear(),400);
  for(const day of ['0099-12-31','0000-01-01','10000-01-01','0100-02-29','9999-13-01'])assert.throws(()=>dateFromDay(day));
  const original=new Date(2026,9,15,12).toISOString();
  for(const day of ['0100-01-01','9999-12-31']){
    const createdAt=changeBillDate(original,day);
    assert.equal(validateBill({id:day,amount:1,category:'其他',createdAt}).createdAt,createdAt);
  }
  const outside=dateFromDay('0100-01-01');outside.setDate(0);
  assert.throws(()=>validateBill({id:'invalid',amount:1,category:'其他',createdAt:outside.toISOString()}));
  assert.throws(()=>changeBillDate(original,'0099-12-31'));
  const week=recentExpenses([],dateFromDay('0100-01-03'));
  assert.deepEqual(week.map(day=>day.date),['0100-01-01','0100-01-02','0100-01-03']);
});

test('东、西时区的合法本地边界可使用UTC0099年或10000年的规范ISO时间',()=>{
  const model=readFileSync(new URL('../model.js',import.meta.url),'utf8');
  const checks=`
    for(const [day,hour] of [['0100-01-01',0],['9999-12-31',23]]){
      const date=dateFromDay(day);date.setHours(hour,30,0,0);
      const createdAt=date.toISOString(),bill={id:day,amount:1,category:'其他',createdAt};
      assert.equal(validateBill(bill).createdAt,createdAt);assert.equal(localDay(date),day);
      assert.equal(changeBillDate(createdAt,day),createdAt);
      if(process.env.TZ==='Asia/Shanghai' && hour===0)assert.ok(createdAt.startsWith('0099-'));
      if(process.env.TZ==='America/Los_Angeles' && hour===23)assert.ok(createdAt.startsWith('+010000-'));
    }
  `;
  for(const timezone of ['Asia/Shanghai','America/Los_Angeles']){
    const result=spawnSync(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';\n"+model+checks],{env:{...process.env,TZ:timezone},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr || result.error?.message);
  }
});

test('夏令时不存在的原时刻拒绝改期，整日跳过不会生成重复时间轴或图表日期',()=>{
  const model=readFileSync(new URL('../model.js',import.meta.url),'utf8');
  const checks=`
    if(process.env.TZ==='America/New_York'){
      const original=new Date(2026,2,7,2,30,15,123).toISOString();
      assert.throws(()=>changeBillDate(original,'2026-03-08'),/原时刻/);
      const next=new Date(changeBillDate(original,'2026-03-09'));
      assert.equal(next.getHours(),2);assert.equal(next.getMinutes(),30);
    }else{
      assert.throws(()=>dateFromDay('2011-12-30'));
      const dates=monthDates(dateFromDay('2011-12-01'));
      assert.ok(!dates.includes('2011-12-30'));assert.equal(new Set(dates).size,dates.length);
      const week=recentExpenses([],new Date(2012,0,1,12));
      assert.equal(new Set(week.map(day=>day.date)).size,week.length);
    }
  `;
  for(const timezone of ['America/New_York','Pacific/Apia']){
    const result=spawnSync(process.execPath,['--input-type=module','-e',"import assert from 'node:assert/strict';\n"+model+checks],{env:{...process.env,TZ:timezone},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr || result.error?.message);
  }
});

test('时间轴停稳后选择最近中心日期，重复停稳不重复读取账单',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const settling=source.slice(source.indexOf('function timelineStep('),source.indexOf('function updateTimelineTicks('))+source.slice(source.indexOf('function settleTimeline('),source.indexOf('const dateRail='));
  const dates=['2026-10-01','2026-10-02','2026-10-03'];
  const rail={clientWidth:496,dataset:{},scrollLeft:110,children:dates.map(date=>({dataset:{date},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}))};
  const status={};let renders=0;
  const context={updateTodayShortcut:()=>{},page:'bills',billsView:'timeline',selectedBillDate:dates[0],$:id=>id==='date-timeline'?rail:status,renderBills:()=>{renders++;}};
  const run=new Script(settling+';settleTimeline();');
  run.runInNewContext(context);
  assert.equal(context.selectedBillDate,'2026-10-03');assert.equal(renders,1);
  assert.equal(rail.children[2].attributes['aria-pressed'],'true');
  run.runInNewContext(context);assert.equal(renders,1);
  rail.scrollLeft=-50;run.runInNewContext(context);assert.equal(context.selectedBillDate,'2026-10-01');
  const count=renders;context.billsView='calendar';rail.scrollLeft=110;run.runInNewContext(context);
  assert.equal(context.selectedBillDate,'2026-10-01');assert.equal(renders,count);
});

test('鼠标拖动时间轴后按速度滑向日期，阻止误点击并保留触屏原生滚动',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const binding=source.slice(source.indexOf('function timelineStep('),source.indexOf('function updateTimelineTicks('))+source.slice(source.indexOf('function enableMouseTimeline('),source.indexOf('const dateRail='));
  const handlers={},rail={clientWidth:496,dataset:{},scrollLeft:720,children:Array(31),addEventListener(name,callback){handlers[name]=callback;},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){},scrollTo(options){this.target=options;}};
  new Script(binding+';enableMouseTimeline(rail);').runInNewContext({rail,matchMedia:()=>({matches:false})});
  const event=(type,x,time)=>({type,pointerType:'mouse',button:0,pointerId:1,clientX:x,timeStamp:time,preventDefault(){},stopImmediatePropagation(){this.stopped=true;}});
  handlers.pointerdown(event('pointerdown',200,0));handlers.pointermove(event('pointermove',128,100));
  assert.equal(rail.scrollLeft,792);assert.equal(rail.dataset.dragging,'true');
  handlers.pointerup(event('pointerup',128,110));
  assert.equal(rail.target.left,936);assert.equal(rail.target.behavior,'smooth');assert.equal(rail.dataset.dragging,undefined);
  const click=event('click',128,111);handlers.click(click);assert.equal(click.stopped,true);
  const touch={...event('pointerdown',200,200),pointerType:'touch'};handlers.pointerdown(touch);handlers.pointermove({...touch,clientX:100});assert.equal(rail.scrollLeft,792);
});

test('时间轴无月份箭头，刻度居中最高且向两侧对称变短，日期可跨月',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const rendering=source.slice(source.indexOf('function timelineStep('),source.indexOf('function settleTimeline('));
  const element=()=>({children:[],dataset:{},style:{setProperty(name,value){this[name]=value;}},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},setAttribute(){}});
  const rail=element();rail.clientWidth=386;rail.scrollLeft=0;rail.scrollTo=options=>{rail.scrollLeft=options.left;};
  const context={updateTodayShortcut:()=>{},billsView:'timeline',selectedBillDate:'2026-01-01',dateFromDay,monthDates,$:id=>id==='date-timeline'?rail:{},document:{createElement:element}};
  new Script(rendering+';renderTimeline();').runInNewContext(context);
  assert.equal(rail.children[0].dataset.date,'2025-12-01');
  assert.equal(rail.children.at(-1).dataset.date,'2026-02-28');
  assert.ok(Math.abs(Number.parseFloat(rail.style['--day-width'])*7+48-rail.clientWidth)<0.001);
  assert.ok(Math.abs(Number.parseFloat(rail.children[31].style['--tick-height'])-24)<0.001);
  assert.ok(Math.abs(Number.parseFloat(rail.children[30].style['--tick-height'])-18)<0.001);
  assert.ok(Math.abs(Number.parseFloat(rail.children[32].style['--tick-height'])-18)<0.001);
  assert.ok(Math.abs(Number.parseFloat(rail.children[29].style['--tick-height'])-12)<0.001);
  assert.ok(Math.abs(Number.parseFloat(rail.children[33].style['--tick-height'])-12)<0.001);
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.ok(!html.includes('id="previous-month"'));assert.ok(!html.includes('id="next-month"'));
  for(const [selected,first,last] of [['0100-01-01','0100-01-01','0100-02-28'],['9999-12-31','9999-11-01','9999-12-31']]){
    context.selectedBillDate=selected;new Script(rendering+';renderTimeline();').runInNewContext(context);
    assert.equal(rail.children[0].dataset.date,first);assert.equal(rail.children.at(-1).dataset.date,last);
    assert.ok(rail.children.every(button=>/^\d{4}-\d{2}-\d{2}$/.test(button.dataset.date)));
  }
});

test('编辑日期保留原本地时间并重新计入对应月份，拒绝无效日期',()=>{
  const original=new Date(2026,9,16,17,20,47,123).toISOString();
  const changed=changeBillDate(original,'2026-09-30');const result=new Date(changed);
  assert.equal(result.getFullYear(),2026);assert.equal(result.getMonth(),8);assert.equal(result.getDate(),30);
  assert.equal(result.getHours(),17);assert.equal(result.getMinutes(),20);assert.equal(result.getSeconds(),47);assert.equal(result.getMilliseconds(),123);
  assert.equal(changeBillDate(original,'2026-10-16'),original);
  assert.throws(()=>changeBillDate(original,'2026-02-30'));assert.throws(()=>changeBillDate(original,''));
  const bill={amount:1300,createdAt:changed};
  assert.equal(monthlyTotal([bill],new Date(2026,9,16)),0);
  assert.equal(monthlyTotal([bill],new Date(2026,8,30)),1300);
});



test('浮层编辑菜单点击外部或Esc关闭，焦点可回到更多按钮',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const handlers=source.slice(source.indexOf("document.addEventListener('pointerdown'"),source.indexOf('function setBillEditing('));
  const listeners={},menu={hidden:false},more={attributes:{},focusCount:0,setAttribute(name,value){this.attributes[name]=value;},focus(){this.focusCount++;}};
  new Script(handlers).runInNewContext({$:id=>id==='more-menu'?menu:more,document:{addEventListener(name,callback){listeners[name]=callback;}}});
  listeners.pointerdown({target:{closest:()=>({})}});assert.equal(menu.hidden,false);
  listeners.pointerdown({target:{closest:()=>null}});assert.equal(menu.hidden,true);assert.equal(more.attributes['aria-expanded'],'false');
  menu.hidden=false;listeners.keydown({key:'Escape'});assert.equal(menu.hidden,true);assert.equal(more.focusCount,1);
});

test('Quick Add新增也提供日期选择，可回填历史日期并保留保存时刻',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<label id="edit-date-field" class="edit-date-field">/);
  assert.match(html,/<input id="edit-date" type="date"/);
  const now=new Date(2026,9,18,9,30,15);
  const createdAt=changeBillDate(now.toISOString(),'2026-09-30');
  assert.equal(new Date(createdAt).getMonth(),8);assert.equal(new Date(createdAt).getDate(),30);
  assert.equal(new Date(createdAt).getHours(),9);assert.equal(new Date(createdAt).getMinutes(),30);
  assert.equal(monthlyTotal([{amount:1234,createdAt}],new Date(2026,8,30)),1234);
  assert.equal(monthlyTotal([{amount:1234,createdAt}],now),0);
});

test('日期清空或退出选择器时恢复上次选择，重新新增和编辑各自初始化日期',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const dateHandlers=source.slice(source.indexOf('function setEntryDate('),source.indexOf('function selectNav('));
  const handlers={},input={value:'',dataset:{},addEventListener(name,callback){handlers[name]=callback;}};
  let notice='';
  const setDate=new Script(dateHandlers+';setEntryDate;').runInNewContext({$:()=>input,localDay:()=> '2026-10-19',dateFromDay,message:text=>{notice=text;}});
  setDate('');assert.equal(input.value,'2026-10-19');
  input.value='2026-09-30';handlers.change();
  input.value='';handlers.change();assert.equal(input.value,'2026-09-30');
  input.value='';handlers.blur();assert.equal(input.value,'2026-09-30');
  setDate('2026-10-19');input.value='';handlers.blur();assert.equal(input.value,'2026-10-19');
  setDate('2026-08-12');input.value='';handlers.change();assert.equal(input.value,'2026-08-12');
  input.value='0099-12-31';handlers.change();assert.equal(input.value,'0099-12-31');assert.match(notice,/0100-01-01/);
  assert.equal(input.dataset.lastDate,'2026-08-12');assert.throws(()=>setDate('0099-12-31'));
});

test('编辑状态在页头显示完成编辑，退出时恢复更多按钮',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const editing=source.slice(source.indexOf('function setBillEditing('),source.indexOf("$('edit-bills').onclick="));
  const elements=Object.fromEntries(['edit-bills','more','finish-editing','more-menu'].map(id=>[id,{hidden:false,setAttribute(){},focus(){this.focused=true;}}]));
  let renders=0;
  const context={busy:false,editingList:false,$:id=>elements[id],renderBills:()=>{renders++;}};
  new Script(editing+';setBillEditing(true);').runInNewContext(context);
  assert.equal(elements.more.hidden,true);assert.equal(elements['finish-editing'].hidden,false);assert.equal(elements['more-menu'].hidden,true);
  new Script(editing+';setBillEditing(false);').runInNewContext(context);
  assert.equal(elements.more.hidden,false);assert.equal(elements['finish-editing'].hidden,true);assert.equal(context.editingList,false);assert.equal(renders,2);
});

test('非今天显示回到今天图标，点击后恢复当天时间轴及账单并隐藏图标',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const shortcuts=source.slice(source.indexOf('function updateTodayShortcut('),source.indexOf('function timelineStep('));
  const button={hidden:true};let timeline=0,bills=0;
  const context={billsView:'timeline',matchMedia:()=>({matches:true}),selectedBillDate:'2026-10-16',localDay:()=> '2026-10-18',$:id=>id==='date-timeline'?{children:[]}:button,renderTimeline:()=>{timeline++;},renderBills:()=>{bills++;}};
  new Script(shortcuts+';updateTodayShortcut();').runInNewContext(context);assert.equal(button.hidden,false);
  new Script(shortcuts+';returnToToday();updateTodayShortcut();').runInNewContext(context);
  assert.equal(context.selectedBillDate,'2026-10-18');assert.equal(button.hidden,true);assert.equal(timeline,1);assert.equal(bills,1);
});

test('回到今天优先平滑滚动，跨远月时滑入，减少动态效果时直接恢复',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const returning=source.slice(source.indexOf('function returnToToday('),source.indexOf('function timelineStep('));
  let reduced=false,rendered=0,animated=0;
  const rail={children:[{dataset:{date:'2026-10-18'}},{dataset:{date:'2026-10-19'}}],scrollLeft:0,scrollTo(options){this.target=options;},animate(frames){animated++;assert.equal(frames[1].transform,'translateX(0)');}};
  const context={billsView:'timeline',selectedBillDate:'2026-10-18',localDay:()=> '2026-10-19',$:()=>rail,timelineStep:()=>72,matchMedia:()=>({matches:reduced}),renderTimeline:()=>{rendered++;},renderBills:()=>{}};
  const run=new Script(returning+';returnToToday();');run.runInNewContext(context);
  assert.equal(rail.target.left,72);assert.equal(rail.target.behavior,'smooth');assert.equal(rendered,0);
  rail.children=[];run.runInNewContext(context);assert.equal(context.selectedBillDate,'2026-10-19');assert.equal(animated,1);
  reduced=true;context.selectedBillDate='2026-09-01';run.runInNewContext(context);assert.equal(context.selectedBillDate,'2026-10-19');assert.equal(animated,1);assert.equal(rendered,2);
});
