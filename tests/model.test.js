import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInThisContext,Script} from 'node:vm';
const {parseAmount,validateBackup,monthlyTotal,dailyExpenses,recentExpenses,walletRemaining,monthDates,changeBillDate}=runInThisContext(readFileSync(new URL('../model.js',import.meta.url),'utf8') + ';({parseAmount,validateBackup,monthlyTotal,dailyExpenses,recentExpenses,walletRemaining,monthDates,changeBillDate})');
test('金额用整数分计算并拒绝无效输入',()=>{
  assert.equal(parseAmount('0.01'),1);assert.equal(parseAmount('12.30'),1230);
  for(const value of ['0','-1','1.001','1e3','','1.','900719925474099'])assert.throws(()=>parseAmount(value));
});
test('恢复校验版本、字段、重复 ID，规范化账单',()=>{
  const bill={id:'a',amount:1,category:'其他',createdAt:'2026-10-10T09:00:00.000Z'};
  assert.deepEqual(validateBackup({schemaVersion:1,bills:[bill]}),[bill]);
  for(const data of [{schemaVersion:3,bills:[]},{schemaVersion:1,bills:[bill,bill]},{schemaVersion:1,bills:[{...bill,amount:1.5}]},{schemaVersion:1,bills:[{...bill,createdAt:'bad'}]}])assert.throws(()=>validateBackup(data));
});

test('双击入口使用普通脚本，无模块加载依赖',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match=>match[1]);
  assert.deepEqual(scripts,['model.js','storage.js','app.js']);
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
  const context={$:id=>elements[id],document:{querySelectorAll:()=>tabs},syncAmountDisplay:()=>{}};
  new Script(switching+`;selectEntryType('income');`).runInNewContext(context);
  assert.equal(elements['expense-panel'].hidden,true);
  assert.equal(elements['income-panel'].hidden,false);
  assert.equal(elements['entry-tabs'].dataset.type,'income');
  assert.equal(tabs[1].attributes['aria-selected'],'true');assert.equal(tabs[1].tabIndex,0);
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
  const context={$:()=>panel,matchMedia:()=>({matches:reduced}),getComputedStyle:()=>({transform:'none',opacity:'1'})};
  const close= new Script(closing+';closeEntry;').runInNewContext(context);
  const pending=close();assert.equal(panel.open,true);await close();assert.equal(animations,1);
  finish();await pending;assert.equal(closes,1);assert.equal(cancels,1);assert.equal(panel.dataset.closing,undefined);
  panel.open=true;reduced=true;await close();assert.equal(closes,2);assert.equal(animations,1);
});


test('编辑事务更新原记录及指定日期，不创建不存在的账单',async()=>{
  const model=readFileSync(new URL('../model.js',import.meta.url),'utf8');
  const validate=new Script(model+';validateBill;').runInNewContext({});
  const original={id:'original',type:'expense',amount:1300,category:'餐饮',createdAt:'2026-10-15T08:00:00.000Z'};
  let current=original,written,aborted=false;
  const store={transaction:{abort(){aborted=true;}},get(id){assert.equal(id,original.id);return {result:current,set onsuccess(callback){callback();}};},put(bill){written=bill;}};
  const source=readFileSync(new URL('../storage.js',import.meta.url),'utf8');
  const api=new Script(source.slice(source.indexOf('const storage ='))+';storage;').runInNewContext({validateBill:validate,transaction:async(mode,action)=>{assert.equal(mode,'readwrite');return action(store);}});
  await api.update({...original,amount:2500,category:'交通',createdAt:'2026-10-16T08:00:00.000Z'});
  assert.equal(written.id,original.id);assert.equal(written.amount,2500);assert.equal(written.category,'交通');assert.equal(written.createdAt,'2026-10-16T08:00:00.000Z');
  assert.throws(()=>api.update({...original,amount:0}));
  current=undefined;written=undefined;await api.update(original);assert.equal(aborted,true);assert.equal(written,undefined);
});

test('账单仅展示时间轴选中日期，行内保留时间和逐条编辑入口',async()=>{
  const element=()=>({children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},setAttribute(){}});
  const list=element();const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const rendering=source.slice(source.indexOf('async function renderBills('),source.indexOf('function renderTimeline('));
  const bills=[{id:'a',category:'餐饮',amount:100,createdAt:new Date(2026,9,15,12).toISOString()},{id:'b',type:'income',category:'工资',amount:200,createdAt:new Date(2026,9,16,12).toISOString()},{id:'c',category:'交通',amount:300,createdAt:new Date(2026,9,15,14).toISOString()}];
  const context={selectedBillDate:'2026-10-15',storage:{all:async()=>bills},$:()=>list,document:{createElement:element},localDay:date=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'),money:amount=>(amount/100).toFixed(2),editingList:true,message:error=>{throw new Error(error);},openBillEditor:()=>{}};
  await new Script(rendering+';renderBills();').runInNewContext(context);
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children[0].children[0].textContent,'2026-10-15');
  assert.equal(list.children[0].children.length,3);
  const row=list.children[0].children[1];
  assert.match(row.children[0].children[0].textContent,/^\d{2}:\d{2}:\d{2}$/);
  assert.equal(row.children[1].children[0].textContent,'− ¥3.00');
  assert.equal(row.children[1].children[1].textContent,'编辑');
});


test('时间轴月份包含闰日并正确跨年',()=>{
  assert.equal(monthDates(new Date(2024,1,15)).length,29);
  assert.equal(monthDates(new Date(2025,1,15)).length,28);
  const december=monthDates(new Date(2026,11,31));
  assert.equal(december[0],'2026-12-01');assert.equal(december.at(-1),'2026-12-31');
  assert.equal(monthDates(new Date(2026,12,1))[0],'2027-01-01');
});

test('时间轴停稳后选择最近中心日期，重复停稳不重复读取账单',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const settling=source.slice(source.indexOf('function timelineStep('),source.indexOf('function updateTimelineTicks('))+source.slice(source.indexOf('function settleTimeline('),source.indexOf('const dateRail='));
  const dates=['2026-10-01','2026-10-02','2026-10-03'];
  const rail={clientWidth:496,dataset:{},scrollLeft:110,children:dates.map(date=>({dataset:{date},attributes:{},setAttribute(name,value){this.attributes[name]=value;}}))};
  const status={};let renders=0;
  const context={updateTodayShortcut:()=>{},page:'bills',selectedBillDate:dates[0],$:id=>id==='date-timeline'?rail:status,renderBills:()=>{renders++;}};
  const run=new Script(settling+';settleTimeline();');
  run.runInNewContext(context);
  assert.equal(context.selectedBillDate,'2026-10-03');assert.equal(renders,1);
  assert.equal(rail.children[2].attributes['aria-pressed'],'true');
  run.runInNewContext(context);assert.equal(renders,1);
  rail.scrollLeft=-50;run.runInNewContext(context);assert.equal(context.selectedBillDate,'2026-10-01');
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
  const context={updateTodayShortcut:()=>{},selectedBillDate:'2026-01-01',monthDates,$:id=>id==='date-timeline'?rail:{},document:{createElement:element}};
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
  const context={matchMedia:()=>({matches:true}),selectedBillDate:'2026-10-16',localDay:()=> '2026-10-18',$:id=>id==='date-timeline'?{children:[]}:button,renderTimeline:()=>{timeline++;},renderBills:()=>{bills++;}};
  new Script(shortcuts+';updateTodayShortcut();').runInNewContext(context);assert.equal(button.hidden,false);
  new Script(shortcuts+';returnToToday();updateTodayShortcut();').runInNewContext(context);
  assert.equal(context.selectedBillDate,'2026-10-18');assert.equal(button.hidden,true);assert.equal(timeline,1);assert.equal(bills,1);
});

test('回到今天优先平滑滚动，跨远月时滑入，减少动态效果时直接恢复',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const returning=source.slice(source.indexOf('function returnToToday('),source.indexOf('function timelineStep('));
  let reduced=false,rendered=0,animated=0;
  const rail={children:[{dataset:{date:'2026-10-18'}},{dataset:{date:'2026-10-19'}}],scrollLeft:0,scrollTo(options){this.target=options;},animate(frames){animated++;assert.equal(frames[1].transform,'translateX(0)');}};
  const context={selectedBillDate:'2026-10-18',localDay:()=> '2026-10-19',$:()=>rail,timelineStep:()=>72,matchMedia:()=>({matches:reduced}),renderTimeline:()=>{rendered++;},renderBills:()=>{}};
  const run=new Script(returning+';returnToToday();');run.runInNewContext(context);
  assert.equal(rail.target.left,72);assert.equal(rail.target.behavior,'smooth');assert.equal(rendered,0);
  rail.children=[];run.runInNewContext(context);assert.equal(context.selectedBillDate,'2026-10-19');assert.equal(animated,1);
  reduced=true;context.selectedBillDate='2026-09-01';run.runInNewContext(context);assert.equal(context.selectedBillDate,'2026-10-19');assert.equal(animated,1);assert.equal(rendered,2);
});
