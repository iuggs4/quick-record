import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {spawnSync} from 'node:child_process';

const model=readFileSync(new URL('../model.js',import.meta.url),'utf8');
const calendar=readFileSync(new URL('../calendar.js',import.meta.url),'utf8');
function calendarHarness(){
  const document={activeElement:null};
  const element=()=>({children:[],dataset:{},style:{},attributes:{},textContent:'',
    append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},
    setAttribute(name,value){this.attributes[name]=value;},contains(node){return this.children.includes(node);},
    focus(){document.activeElement=this;}
  });
  const elements=Object.fromEntries(['calendar-view','calendar-days','calendar-summary','calendar-legend'].map(id=>[id,element()]));
  document.createElement=element;
  const selections=[];
  const api=new Script(model+'\n'+calendar+';({calendarMonth,renderCalendar,renderCalendarSummary,dateFromDay});').runInNewContext({
    document,$:id=>elements[id],selectCalendarDate:date=>selections.push(date)
  });
  return {api,elements,document,selections};
}
const bill=(day,amount,type)=>({id:day+'-'+amount,amount,category:type==='income'?'工资':'餐饮',createdAt:new Date(day+'T12:00:00').toISOString(),...(type?{type}:{})});

test('同月按日合并收支、笔数，收入不加深热度，无记录明确独立',()=>{
  const {api}=calendarHarness();
  const summary=api.calendarMonth([bill('2026-10-18',100),bill('2026-10-18',200,'expense'),bill('2026-10-18',500,'income'),bill('2026-10-19',1000,'income'),bill('2026-10-17',100),bill('2026-10-16',200),bill('2026-09-30',9999)],'2026-10-18');
  const spend=summary.days.find(day=>day.date==='2026-10-18'),income=summary.days.find(day=>day.date==='2026-10-19'),empty=summary.days[0];
  assert.equal(spend.expense,300);assert.equal(spend.income,500);assert.equal(spend.count,3);assert.equal(spend.heat,3);
  assert.equal(income.expense,0);assert.equal(income.income,1000);assert.equal(income.heat,0);assert.equal(income.incomeCount,1);
  assert.equal(empty.count,0);assert.equal(empty.heat,0);assert.equal(summary.maxExpense,300);assert.equal(summary.hasRecords,true);
  assert.equal(summary.days.find(day=>day.date==='2026-10-17').heat,1);assert.equal(summary.days.find(day=>day.date==='2026-10-16').heat,2);
});

test('空月和只有收入月份没有除零，单日合计溢出只标记该方向且不影响其它日',()=>{
  const {api}=calendarHarness();
  const empty=api.calendarMonth([],'2026-10-01');assert.equal(empty.hasRecords,false);assert.ok(empty.days.every(day=>day.heat===0));
  const incomeOnly=api.calendarMonth([bill('2026-10-18',1000,'income')],'2026-10-18');
  assert.equal(incomeOnly.hasRecords,true);assert.equal(incomeOnly.maxExpense,0);assert.ok(incomeOnly.days.every(day=>day.heat===0));
  const summary=api.calendarMonth([bill('2026-10-18',Number.MAX_SAFE_INTEGER),bill('2026-10-18',1),bill('2026-10-18',500,'income'),bill('2026-10-19',200)],'2026-10-18');
  const overflow=summary.days.find(day=>day.date==='2026-10-18'),normal=summary.days.find(day=>day.date==='2026-10-19');
  assert.equal(overflow.expense,null);assert.equal(overflow.income,500);assert.equal(overflow.count,3);assert.equal(overflow.heat,null);assert.equal(overflow.error,true);
  assert.equal(normal.expense,200);assert.equal(normal.heat,3);assert.equal(summary.maxExpense,200);assert.equal(summary.hasErrors,true);
});

test('闰日和本地年份边界仅生成当前月有效日期',()=>{
  const {api}=calendarHarness();
  assert.equal(api.calendarMonth([],'2024-02-29').days.length,29);
  assert.equal(api.calendarMonth([],'0100-01-01').days[0].date,'0100-01-01');
  assert.equal(api.calendarMonth([],'9999-12-31').days.at(-1).date,'9999-12-31');
  assert.throws(()=>api.calendarMonth([],'0099-12-31'));
});

test('按周一布局4至6行，读屏区分无记录和溢出，键盘只移动焦点',()=>{
  const {api,elements,document,selections}=calendarHarness();
  const summary=api.calendarMonth([bill('2026-10-18',100),bill('2026-10-18',200,'income')],'2026-10-18');
  api.renderCalendar(summary,'2026-10-18');
  const grid=elements['calendar-days'],buttons=grid.children.filter(node=>node.dataset.date),selected=buttons.find(node=>node.dataset.date==='2026-10-18');
  assert.equal(grid.children.length,35);assert.equal(buttons[0].style.gridColumn,'4');
  assert.match(selected.attributes['aria-label'],/2026-10-18.*支出 ¥1.00.*收入 ¥2.00.*2笔/);
  assert.equal(selected.attributes['aria-pressed'],'true');assert.match(elements['calendar-summary'].textContent,/支出 ¥1.00/);
  assert.match(buttons[0].attributes['aria-label'],/无记录/);
  selected.focus();let prevented=false;selected.onkeydown({key:'ArrowLeft',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(document.activeElement.dataset.date,'2026-10-17');assert.equal(selections.length,0);
  document.activeElement.onkeydown({key:'ArrowUp',preventDefault(){}});assert.equal(document.activeElement.dataset.date,'2026-10-10');
  document.activeElement.onclick();assert.deepEqual(selections,['2026-10-10']);
  api.renderCalendar(summary,'2026-10-10');assert.equal(document.activeElement.dataset.date,'2026-10-10');
  const overflow=api.calendarMonth([bill('2026-10-18',Number.MAX_SAFE_INTEGER),bill('2026-10-18',1)],'2026-10-18');
  api.renderCalendar(overflow,'2026-10-18');
  assert.match(elements['calendar-summary'].textContent,/支出 无法统计/);
  assert.equal(elements['calendar-days'].children.find(node=>node.dataset.date==='2026-10-18').dataset.heat,'error');
  for(const [date,cells] of [['2021-02-01',28],['2026-08-01',42]]){
    api.renderCalendar(api.calendarMonth([],date),date);assert.equal(elements['calendar-days'].children.length,cells);
  }
});

test('跳过整日的时区留空而不移动后续星期，月末跳日仍显示整月',()=>{
  const source="import assert from 'node:assert/strict';\n"+model+'\n'+calendar+`
    const selected=process.env.TZ==='Pacific/Apia'?'2011-12-31':'1994-12-30';
    const missing=process.env.TZ==='Pacific/Apia'?'2011-12-30':'1994-12-31';
    const summary=calendarMonth([],selected);
    assert.ok(!summary.days.some(day=>day.date===missing));assert.equal(summary.days.length,30);
    const nodes=[],elements={'calendar-days':{replaceChildren(){nodes.length=0;},setAttribute(){},append(node){nodes.push(node);},contains(){return false;}},'calendar-view':{dataset:{}},'calendar-summary':{},'calendar-legend':{}};
    globalThis.$=id=>elements[id];globalThis.document={activeElement:null,createElement(){return {dataset:{},style:{},setAttribute(){},append(){}};}};
    renderCalendar(summary,selected);
    const last=nodes.find(node=>node.dataset.date===selected);
    assert.equal(Number(last.style.gridColumn),(dateFromDay(selected).getDay()+6)%7+1);
    assert.equal(nodes.filter(node=>node.dataset.date).length,30);
  `;
  for(const timezone of ['Pacific/Apia','Pacific/Kiritimati']){
    const result=spawnSync(process.execPath,['--input-type=module','-e',source],{env:{...process.env,TZ:timezone},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr || result.error?.message);
  }
});
