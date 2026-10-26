function calendarMonth(bills,selectedDate){
  const dates=monthDates(dateFromDay(selectedDate));
  const days=dates.map(date=>({date,expense:0,income:0,count:0,incomeCount:0,error:false,heat:0}));
  const byDate=new Map(days.map(day=>[day.date,day]));
  for(const bill of bills){
    const day=byDate.get(localDay(new Date(bill.createdAt)));
    if(!day)continue;
    const field=bill.type==='income'?'income':'expense';
    day.count++;if(field==='income')day.incomeCount++;
    if(day[field]===null)continue;
    const total=day[field]+bill.amount;
    if(!Number.isSafeInteger(bill.amount) || bill.amount<=0 || !Number.isSafeInteger(total)){
      day[field]=null;day.error=true;
    }else day[field]=total;
  }
  const maxExpense=Math.max(0,...days.map(day=>day.expense===null?0:day.expense));
  for(const day of days){
    day.heat=day.expense===null?null:day.expense===0?0:day.expense/maxExpense<=1/3?1:day.expense/maxExpense<=2/3?2:3;
  }
  return {month:selectedDate.slice(0,7),days,hasRecords:days.some(day=>day.count>0),hasErrors:days.some(day=>day.error),maxExpense};
}
function calendarDayTotals(day){
  return '已记录支出 '+(day.expense===null?'无法统计':'¥'+amountText(day.expense))+' · 收入 '+(day.income===null?'无法统计':'¥'+amountText(day.income));
}
function renderCalendarSummary(summary,selectedDate){
  const day=summary.days.find(day=>day.date===selectedDate);
  $('calendar-summary').textContent=!day || !day.count?selectedDate+' · 无记录':selectedDate+' · '+calendarDayTotals(day)+' · '+day.count+'笔';
}
function renderCalendar(summary,selectedDate){
  const grid=$('calendar-days'),active=document.activeElement;
  const focusedDate=active?.dataset?.date,restoreFocus=active && grid.contains(active);
  grid.replaceChildren();grid.setAttribute('role','group');grid.setAttribute('aria-label',summary.month+' 消费日历');
  $('calendar-view').dataset.month=summary.month;
  $('calendar-legend').textContent=(summary.hasRecords?'':'本月暂无账单。')+'颜色仅表示本月已记录支出的相对高低；• 表示收入。'+(summary.hasErrors?' 部分日期合计超出范围，可查看并编辑单笔账单。':'');
  renderCalendarSummary(summary,selectedDate);
  if(!summary.days.length)return;
  const first=summary.days[0],firstNumber=Number(first.date.slice(8));
  const firstWeekday=(dateFromDay(first.date).getDay()+6)%7;
  const offset=(firstWeekday-(firstNumber-1)%7+7)%7;
  const rows=Math.floor((offset+Number(summary.days[summary.days.length-1].date.slice(8))-1)/7)+1;
  const slots=new Map(summary.days.map(day=>{
    const row=Math.floor((offset+Number(day.date.slice(8))-1)/7);
    return [row*7+(dateFromDay(day.date).getDay()+6)%7,day];
  }));
  const buttons=new Map(),today=localDay(new Date());
  const focusDay=date=>{for(const [value,button] of buttons)button.tabIndex=value===date?0:-1;buttons.get(date)?.focus();};
  for(let cell=0;cell<rows*7;cell++){
    const day=slots.get(cell),node=document.createElement(day?'button':'span');
    node.style.gridRow=String(Math.floor(cell/7)+1);node.style.gridColumn=String(cell%7+1);
    if(!day){node.className='calendar-blank';node.setAttribute('aria-hidden','true');grid.append(node);continue;}
    node.type='button';node.className='calendar-day';node.dataset.date=day.date;node.dataset.heat=day.heat===null?'error':String(day.heat);
    node.dataset.today=String(day.date===today);node.tabIndex=day.date===selectedDate?0:-1;
    node.setAttribute('aria-pressed',String(day.date===selectedDate));
    node.setAttribute('aria-label',day.date+(day.count?'，'+calendarDayTotals(day)+'，'+day.count+'笔账单':'，无记录，支出和收入无记录，0笔账单'));
    const number=document.createElement('span');number.textContent=Number(day.date.slice(8));node.append(number);
    for(const [show,className,text] of [[day.date===today,'calendar-today','今'],[day.incomeCount>0,'calendar-income','•'],[day.error,'calendar-error','!']]){
      if(!show)continue;
      const marker=document.createElement('span');marker.className=className;marker.textContent=text;marker.setAttribute('aria-hidden','true');node.append(marker);
    }
    node.onclick=()=>selectCalendarDate(day.date);
    node.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();
      let target;
      if(event.key==='ArrowLeft' || event.key==='ArrowRight'){
        const index=summary.days.indexOf(day)+(event.key==='ArrowLeft'?-1:1);target=summary.days[index];
      }else if(event.key==='Home' || event.key==='End'){
        const rowStart=Math.floor(cell/7)*7,values=[...slots].filter(([slot])=>slot>=rowStart && slot<rowStart+7);
        target=values[event.key==='Home'?0:values.length-1]?.[1];
      }else{
        const step=event.key==='ArrowUp'?-7:7;
        for(let slot=cell+step;slot>=0 && slot<rows*7;slot+=step){if(slots.has(slot)){target=slots.get(slot);break;}}
      }
      if(target)focusDay(target.date);
    };
    buttons.set(day.date,node);grid.append(node);
  }
  if(restoreFocus)focusDay(buttons.has(focusedDate)?focusedDate:selectedDate);
}
