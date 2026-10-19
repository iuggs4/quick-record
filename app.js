const $ = id => document.getElementById(id);
let busy = false, page = 'home';
let editingBill = null, editingList = false;
let selectedBillDate=localDay(new Date());
let timelineWidth=0;
const message = text => { ($('entry').open ? $('entry-notice') : $('notice')).textContent = text; };
const money = cents => (cents / 100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
function syncAmountDisplay(input){
  $(input.id+'-measure').textContent=input.value || '0.0';
}
function setBusy(value){
  busy=value;
  for(const id of ['save','amount','income-save','income-amount','edit-bills','finish-editing','edit-date']) $(id).disabled=value;
}
const entryForms = [
  {type:'expense',amount:'amount',save:'save',categories:'categories',values:categories,label:'支出'},
  {type:'income',amount:'income-amount',save:'income-save',categories:'income-categories',values:incomeCategories,label:'收入'}
];
for(const form of entryForms){
  let category='其他';
  function choose(value){category=value;for(const button of $(form.categories).children)button.setAttribute('aria-pressed',String(button.textContent===value));}
  form.choose=choose;
  for(const value of form.values){const button=document.createElement('button');button.textContent=value;button.onclick=()=>choose(value);$(form.categories).append(button);}choose(category);
  $(form.save).onclick=async()=>{
    if(busy)return;
    try{
      const cents=parseAmount($(form.amount).value);setEntryDate($('edit-date').value);setBusy(true);
      const original=editingBill;
      const createdAt=changeBillDate(original?.createdAt || new Date().toISOString(),$('edit-date').value);
      const bill={id:original?.id || crypto.randomUUID(),type:form.type,amount:cents,category,createdAt};
      if(original)await storage.update(bill);else await storage.add(bill);
      $(form.amount).value='';syncAmountDisplay($(form.amount));message(original?'账单已更新':'已记下这笔'+form.label);
      if(page==='home')renderHome();else{selectedBillDate=localDay(new Date(bill.createdAt));renderTimeline();renderBills();}
      if(original)await closeEntry();
    }catch(error){message(error.message);}finally{setBusy(false);}
  };
  $(form.amount).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$(form.save).click();}});
  $(form.amount).addEventListener('input',event=>syncAmountDisplay(event.target));
  $(form.amount).closest('.amount-field').addEventListener('click',()=>$(form.amount).focus());
}
let homeDate = '';
async function renderHome(){
  const now = new Date();
  homeDate = localDay(now);
  $('home-month').textContent = now.getFullYear()+'/'+(now.getMonth()+1);
  $('home-month').dateTime = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  $('home-expense').textContent = '—';
  $('home-expense-detail').textContent = '—';
  $('home-income').textContent = '—';
  $('wallet-remaining').textContent = '—';
  $('wallet-expense').textContent = '—';
  $('wallet-progress').hidden = true;
  $('weekly-summary').textContent = '花费 — 元';
  try {
    const bills = await storage.all();
    const days = dailyExpenses(bills);
    const expense = monthlyTotal(bills, now);
    const income = monthlyTotal(bills, now, 'income');
    $('home-income').textContent = money(income);
    const total = money(expense);
    $('wallet-expense').textContent = total;
    const remaining = walletRemaining(expense, income);
    $('wallet-remaining').textContent = money(remaining);
    $('wallet-progress').value = Math.max(0,Math.min(150000,remaining));
    $('wallet-progress').setAttribute('aria-valuetext','剩余 '+money(remaining)+' 元，预算 1500 元');
    $('wallet-progress').hidden = false;
    renderDailyChart(recentExpenses(days, now));
    renderDailyOverview(days, now);
    $('home-expense').textContent = '¥'+total;
    $('home-expense-detail').textContent = total;
  } catch(error) { message(error.message); }
}
function renderDailyChart(days){
  const total = days.reduce((sum,day)=>sum+day.total,0);
  if(!Number.isSafeInteger(total)) throw new Error('七天支出合计超出可显示范围');
  $('weekly-summary').textContent = '花费 '+money(total)+' 元';
  $('daily-chart').replaceChildren();
  const max = Math.max(1,...days.map(day=>day.total));
  for(const day of days){
    const share = day.total/max;
    const percentage = (share*100).toFixed(1).replace(/\.0$/,'')+'%';
    const column = document.createElement('div');column.className='chart-day';column.setAttribute('role','listitem');
    column.setAttribute('aria-label',day.date+' 支出 '+money(day.total)+' 元，相对最高花费日 '+percentage);
    column.title=day.date+'：'+money(day.total)+' 元（'+percentage+'）';
    const value=document.createElement('span');value.className='chart-value';value.textContent=percentage;
    const track=document.createElement('div');track.className='bar-track';track.setAttribute('aria-hidden','true');
    const bar=document.createElement('div');bar.className='bar-fill';
    bar.style.height=share*100+'%';
    bar.style.backgroundColor='hsl(0, 0%, '+(70-share*54)+'%)';
    track.append(bar);
    const label=document.createElement('time');label.dateTime=day.date;label.textContent=Number(day.date.slice(5,7))+'/'+Number(day.date.slice(8));
    column.append(value,track,label);$('daily-chart').append(column);
  }
}
function renderDailyOverview(days, now = new Date()){
  const today = localDay(now);
  days = days.filter(day=>day.date===today);
  $('daily-overview').replaceChildren();
  if(!days.length) days = [{date:today,total:0,bills:[]}];
  for(const day of days){
    const group=document.createElement('section');group.className='overview-day';
    const heading=document.createElement('div');heading.className='overview-heading';
    const date=document.createElement('time');date.dateTime=day.date;date.textContent=day.date;
    const summary=document.createElement('span');summary.textContent='¥'+money(day.total);summary.setAttribute('aria-label','当日总金额 '+money(day.total)+' 元');heading.append(date,summary);group.append(heading);
    for(const bill of [...day.bills].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))){
      const row=document.createElement('div');row.className='overview-transaction';
      const description=document.createElement('div');description.textContent=(bill.type==='income'?'收入 · ':'支出 · ')+bill.category;
      const time=document.createElement('time');time.dateTime=bill.createdAt;time.textContent=new Date(bill.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});description.append(time);
      const value=document.createElement('strong');value.textContent='− ¥'+money(bill.amount);row.append(description,value);group.append(row);
    }
    $('daily-overview').append(group);
  }
}
async function renderBills(){
  try{
    const selected=selectedBillDate;
    const bills=(await storage.all()).filter(bill=>localDay(new Date(bill.createdAt))===selected).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
    if(selected!==selectedBillDate)return;
    $('bill-list').replaceChildren();
    if(!bills.length){ const empty=document.createElement('div');empty.className='card';empty.textContent=selected+' 暂无账单';$('bill-list').append(empty); }
    let dateKey='', group;
    for(const bill of bills){
      const key=localDay(new Date(bill.createdAt));
      if(key!==dateKey){
        dateKey=key;group=document.createElement('section');group.className='card bill-day';
        const heading=document.createElement('h2');heading.className='bill-date';
        const date=document.createElement('time');date.dateTime=key;date.textContent=key;heading.append(date);
        group.append(heading);$('bill-list').append(group);
      }
      const row=document.createElement('div'); row.className='bill';
      const description=document.createElement('div');description.textContent=(bill.type==='income'?'收入 · ':'支出 · ')+bill.category;
      const time=document.createElement('time');time.dateTime=bill.createdAt;time.textContent=new Date(bill.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});description.append(time);
      const value=document.createElement('strong');value.textContent=(bill.type==='income'?'+ ¥':'− ¥')+money(bill.amount);
      const actions=document.createElement('div');actions.className='bill-value';actions.append(value);
      if(editingList){const edit=document.createElement('button');edit.className='edit-bill';edit.textContent='编辑';edit.setAttribute('aria-label','编辑 '+bill.category+' '+money(bill.amount)+' 元账单');edit.onclick=()=>openBillEditor(bill);actions.append(edit);}
      row.append(description,actions);group.append(row);
    }
  }catch(error){message(error.message);}
}
function updateTodayShortcut(){
  $('back-to-today').hidden=selectedBillDate===localDay(new Date());
}
function returnToToday(){
  const today=localDay(new Date()),rail=$('date-timeline');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const index=[...rail.children].findIndex(button=>button.dataset.date===today);
  if(!reduced&&index>=0&&Math.abs(rail.scrollLeft-index*timelineStep(rail))>1){
    rail.scrollTo({left:index*timelineStep(rail),behavior:'smooth'});return;
  }
  const direction=selectedBillDate<today?1:-1;
  selectedBillDate=today;renderTimeline();renderBills();
  if(!reduced)rail.animate([{opacity:.4,transform:'translateX('+direction*24+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:360,easing:'cubic-bezier(.22,1,.36,1)'});
}
function timelineStep(rail){return (rail.clientWidth+8)/7;}
function updateTimelineTicks(rail){
  const center=rail.scrollLeft/timelineStep(rail);
  [...rail.children].forEach((button,index)=>button.style.setProperty('--tick-height',Math.max(6,24-Math.abs(index-center)*6)+'px'));
}
function renderTimeline(){
  const [year,month]=selectedBillDate.split('-').map(Number);
  const rail=$('date-timeline');rail.replaceChildren();
  timelineWidth=rail.clientWidth;
  rail.style.setProperty('--day-width',timelineStep(rail)-8+'px');
  $('timeline-month').textContent=year+' / '+String(month).padStart(2,'0');
  $('month-picker').value=selectedBillDate.slice(0,7);
  const dates=[-1,0,1].flatMap(offset=>monthDates(new Date(year,month-1+offset,1)));
  for(const [index,date] of dates.entries()){
    const button=document.createElement('button');button.dataset.date=date;
    button.setAttribute('aria-label',date);button.setAttribute('aria-pressed',String(date===selectedBillDate));
    const weekday=document.createElement('span');weekday.textContent=['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T12:00:00').getDay()];
    const number=document.createElement('strong');number.textContent=Number(date.slice(8));button.append(weekday,number);
    button.onclick=()=>rail.scrollTo({left:index*timelineStep(rail),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    rail.append(button);
  }
  rail.scrollTo({left:dates.indexOf(selectedBillDate)*timelineStep(rail),behavior:'auto'});
  updateTimelineTicks(rail);
  $('timeline-status').textContent='已选择 '+selectedBillDate;
  updateTodayShortcut();
}
function settleTimeline(){
  const rail=$('date-timeline');if(page!=='bills'||!rail.children.length||rail.dataset.dragging)return;
  const index=Math.max(0,Math.min(rail.children.length-1,Math.round(rail.scrollLeft/timelineStep(rail))));
  const date=rail.children[index].dataset.date;
  if(date===selectedBillDate)return;
  const previousMonth=selectedBillDate.slice(0,7);
  selectedBillDate=date;
  updateTodayShortcut();
  for(const button of rail.children)button.setAttribute('aria-pressed',String(button.dataset.date===date));
  $('timeline-status').textContent='已选择 '+date;renderBills();
  if(date.slice(0,7)!==previousMonth)renderTimeline();
}
function enableMouseTimeline(rail){
  let drag=null, suppressClick=false;
  rail.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='mouse'||event.button!==0)return;
    suppressClick=false;
    drag={id:event.pointerId,start:event.clientX,scroll:rail.scrollLeft,last:event.clientX,time:event.timeStamp,velocity:0,moved:false};
  });
  rail.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(!drag.moved&&Math.abs(event.clientX-drag.start)<4)return;
    if(!drag.moved){drag.moved=true;rail.dataset.dragging='true';rail.setPointerCapture(event.pointerId);}
    event.preventDefault();
    drag.velocity=(drag.last-event.clientX)/Math.max(1,event.timeStamp-drag.time);
    rail.scrollLeft=drag.scroll+drag.start-event.clientX;
    drag.last=event.clientX;drag.time=event.timeStamp;
  });
  function finish(event){
    if(!drag||event.pointerId!==drag.id)return;
    const current=drag;drag=null;
    if(!current.moved)return;
    suppressClick=true;delete rail.dataset.dragging;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const velocity=event.type==='pointercancel'||event.timeStamp-current.time>100?0:current.velocity;
    const projected=rail.scrollLeft+(reduced?0:Math.max(-360,Math.min(360,velocity*160)));
    const step=timelineStep(rail);
    const index=Math.max(0,Math.min(rail.children.length-1,Math.round(projected/step)));
    rail.scrollTo({left:index*step,behavior:reduced?'auto':'smooth'});
    if(rail.hasPointerCapture(event.pointerId))rail.releasePointerCapture(event.pointerId);
  }
  rail.addEventListener('pointerup',finish);
  rail.addEventListener('pointercancel',finish);
  rail.addEventListener('pointerleave',()=>{if(drag&&!drag.moved)drag=null;});
  rail.addEventListener('click',event=>{
    if(!suppressClick)return;
    suppressClick=false;event.preventDefault();event.stopImmediatePropagation();
  },true);
}
const dateRail=$('date-timeline');
$('back-to-today').onclick=returnToToday;
new ResizeObserver(()=>{if(page==='bills'&&dateRail.clientWidth&&dateRail.clientWidth!==timelineWidth)renderTimeline();}).observe(dateRail);
$('month-picker').addEventListener('click',event=>{
  try{event.target.showPicker?.();}catch{event.target.focus();}
});
$('month-picker').addEventListener('change',event=>{
  const value=event.target.value;if(!/^\d{4}-\d{2}$/.test(value))return;
  const [year,month]=value.split('-').map(Number);if(month<1||month>12||year<100)return;
  const days=monthDates(new Date(year,month-1,1));
  selectedBillDate=days[Math.min(Number(selectedBillDate.slice(8)),days.length)-1];
  renderTimeline();renderBills();
});
enableMouseTimeline(dateRail);
dateRail.addEventListener('scroll',()=>updateTimelineTicks(dateRail));
if('onscrollend' in dateRail)dateRail.addEventListener('scrollend',settleTimeline);
else{
  let settleTimer;
  dateRail.addEventListener('scroll',()=>{clearTimeout(settleTimer);settleTimer=setTimeout(settleTimeline,180);});
}
function openBillEditor(bill){
  if(busy)return;
  resetEntryAmounts();selectEntryType(bill.type || 'expense');
  editingBill=bill;
  const form=entryForms.find(form=>form.type===(bill.type || 'expense'));
  form.choose(bill.category);$(form.amount).value=(bill.amount/100).toFixed(2);syncAmountDisplay($(form.amount));
  $('quick-add-title').textContent='Edit Bill';
  setEntryDate(localDay(new Date(bill.createdAt)));
  for(const item of entryForms)$(item.save).textContent='保存修改';
  $('entry').showModal();
}
function resetEntryAmounts(){
  for(const id of ['amount','income-amount']){ $(id).value='';syncAmountDisplay($(id)); }
}
function selectEntryType(type){
  if($('entry-tabs').dataset.type!==type)resetEntryAmounts();
  $('entry-tabs').dataset.type=type;
  $('expense-panel').hidden=type!=='expense';
  $('income-panel').hidden=type!=='income';
  for(const tab of document.querySelectorAll('#entry-tabs button')){
    const selected=tab.dataset.type===type;
    tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
  }
  $('entry-notice').textContent='';
}
const entryTabs=[...document.querySelectorAll('#entry-tabs button')];
for(const tab of entryTabs){
  tab.onclick=()=>selectEntryType(tab.dataset.type);
  tab.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?entryTabs[0]:event.key==='End'?entryTabs[1]:entryTabs.find(item=>item!==tab);
    selectEntryType(next.dataset.type);next.focus();
  };
}
function setEntryDate(value){
  const input=$('edit-date');
  input.value=value || input.dataset.lastDate || localDay(new Date());
  input.dataset.lastDate=input.value;
}
for(const event of ['change','blur'])$('edit-date').addEventListener(event,()=>setEntryDate($('edit-date').value));
function selectNav(name){
  for(const tab of document.querySelectorAll('nav button')){
    tab.removeAttribute('aria-current');if(tab.dataset.page===name)tab.setAttribute('aria-current','page');
  }
}
for(const button of document.querySelectorAll('nav button')) button.onclick=()=>{
  if(button.dataset.page==='entry'){
    $('entry-notice').textContent='';setEntryDate(localDay(new Date()));$('entry').showModal();return;
  }
  page=button.dataset.page;
  for(const name of ['home','bills']) $(name).hidden=name!==page;
  selectNav(page);
  message('');if(page==='home')renderHome();else{renderTimeline();renderBills();}window.scrollTo(0,0);
};
async function closeEntry(){
  const panel=$('entry');
  if(!panel.open || panel.dataset.closing)return;
  panel.dataset.closing='true';
  let animation;
  try{
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const style=getComputedStyle(panel);
      animation=panel.animate([{transform:style.transform,opacity:style.opacity},{transform:'translateY(100%)',opacity:0}],{duration:280,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
      await animation.finished;
    }
  }catch{
    // 动画取消时仍要完成用户请求的关闭操作。
  }finally{
    panel.close();animation?.cancel();delete panel.dataset.closing;
  }
}
$('close-entry').onclick=closeEntry;
$('entry').addEventListener('cancel',event=>{event.preventDefault();closeEntry();});
$('entry').addEventListener('close',()=>{
  editingBill=null;resetEntryAmounts();selectNav(page);
  $('quick-add-title').textContent='Quick Add';for(const form of entryForms)$(form.save).textContent='完成';
  $('edit-date').value='';
});
$('entry').addEventListener('click',event=>{if(event.target===$('entry')){const rect=$('entry').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeEntry();}});
$('more').onclick=()=>{ $('more-menu').hidden=!$('more-menu').hidden;$('more').setAttribute('aria-expanded',String(!$('more-menu').hidden)); };
document.addEventListener('pointerdown',event=>{
  if(!$('more-menu').hidden&&!event.target.closest('.bill-menu')){
    $('more-menu').hidden=true;$('more').setAttribute('aria-expanded','false');
  }
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('more-menu').hidden){
    $('more-menu').hidden=true;$('more').setAttribute('aria-expanded','false');$('more').focus();
  }
});
function setBillEditing(value){
  if(busy)return;
  editingList=value;
  $('edit-bills').setAttribute('aria-pressed',String(editingList));
  $('more').hidden=editingList;$('finish-editing').hidden=!editingList;
  $('more-menu').hidden=true;$('more').setAttribute('aria-expanded','false');renderBills();
  $(editingList?'finish-editing':'more').focus();
}
$('edit-bills').onclick=()=>setBillEditing(true);
$('finish-editing').onclick=()=>setBillEditing(false);
// shortcut: 主屏幕模式缺少明确 Safari 版本时使用普通底栏，获得可靠系统识别接口后再扩展。
const ua=navigator.userAgent,version=/Version\/(\d+)(?:\.|\s)/.exec(ua);
const appleMobile=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
if(appleMobile&&version&&Number(version[1])===26&&/Safari\//.test(ua)&&!/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(ua)&&CSS.supports('backdrop-filter','blur(1px)'))document.body.classList.add('glass');
const slots={'home-cards':$('home-cards'),'form-extra':$('form-extra'),'bill-actions':$('bill-actions'),'more-menu':$('menu-extra')};
const modules=new Set();
window.Ledger=Object.freeze({readBills:()=>storage.all(),addBill:bill=>storage.add(bill),register(module){if(!module||typeof module.id!=='string'||modules.has(module.id)||!slots[module.slot]||typeof module.mount!=='function')throw new Error('扩展模块无效或重复');module.mount(slots[module.slot],window.Ledger);modules.add(module.id);}});
if(location.protocol !== 'file:' && 'serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').then(async registration=>{await navigator.serviceWorker.ready;$('offline').textContent='离线资源已准备好';}).catch(()=>{$('offline').textContent='离线资源准备失败，请联网重新打开';});}
renderHome();














function refreshHomeDate(){
  if(!document.hidden&&page==='bills')updateTodayShortcut();
  if(!document.hidden && page==='home' && homeDate!==localDay(new Date())) renderHome();
}
setInterval(refreshHomeDate,60000);
document.addEventListener('visibilitychange',refreshHomeDate);
window.addEventListener('pageshow',refreshHomeDate);









