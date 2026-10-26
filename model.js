const categories = ['餐饮','交通','购物','娱乐','学习','其他'];
const incomeCategories = ['工资','生活费','奖金','兼职','退款','其他'];
const MIN_YEAR=100,MAX_YEAR=9999;
function parseAmount(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('请输入大于零、最多两位小数的金额');
  const [yuan, fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('金额必须大于零且不能超出范围');
  return cents;
}
function amountText(cents){
  const value=Math.abs(cents);
  return (cents<0?'-':'')+Math.floor(value/100)+'.'+String(value%100).padStart(2,'0');
}
function validateBill(bill) {
  const type = bill?.type === undefined ? 'expense' : bill.type;
  const date=new Date(bill?.createdAt);
  if (!bill || !['expense','income'].includes(type) || typeof bill.id !== 'string' || !bill.id.trim() || !Number.isSafeInteger(bill.amount) || bill.amount <= 0 || !(type === 'income' ? incomeCategories : categories).includes(bill.category) || typeof bill.createdAt !== 'string' || !Number.isFinite(date.getTime()) || date.toISOString()!==bill.createdAt || date.getFullYear()<MIN_YEAR || date.getFullYear()>MAX_YEAR) throw new Error('账单字段无效，日期须在0100-01-01至9999-12-31之间');
  return {id:bill.id, amount:bill.amount, category:bill.category, createdAt:bill.createdAt, ...(bill.type === undefined ? {} : {type})};
}
function validateBackup(data) {
  if (!data || ![1,2].includes(data.schemaVersion) || !Array.isArray(data.bills)) throw new Error('备份结构或版本不支持');
  if (data.schemaVersion === 1 && data.bills.some(bill => bill?.type !== undefined)) throw new Error('旧版备份不能包含收支类型字段');
  const bills = data.bills.map(validateBill);
  if (new Set(bills.map(b => b.id)).size !== bills.length) throw new Error('备份中存在重复账单');
  return bills;
}



function monthlyTotal(bills, now = new Date(), type = 'expense') {
  const total = bills.reduce((sum, bill) => {
    const date = new Date(bill.createdAt);
    return (bill.type || 'expense') === type && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() ? sum + bill.amount : sum;
  }, 0);
  if (!Number.isSafeInteger(total)) throw new Error('当月收支合计超出可显示范围');
  return total;
}

function localDay(date) {
  return String(date.getFullYear()).padStart(4,'0')+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}
function dateFromDay(day){
  if(typeof day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('请选择有效日期');
  const [year,month,dateOfMonth]=day.split('-').map(Number);
  if(year<MIN_YEAR || year>MAX_YEAR)throw new Error('日期须在0100-01-01至9999-12-31之间');
  const date=new Date(0);date.setHours(12,0,0,0);date.setFullYear(year,month-1,dateOfMonth);
  if(localDay(date)!==day)throw new Error('请选择有效日期');
  return date;
}
function monthDates(date){
  if(!Number.isFinite(date.getTime()) || date.getFullYear()<MIN_YEAR || date.getFullYear()>MAX_YEAR)return [];
  const start=new Date(date);start.setDate(1);start.setHours(12,0,0,0);
  const end=new Date(0);end.setUTCFullYear(start.getFullYear(),start.getMonth()+1,0);
  return Array.from({length:end.getUTCDate()},(_,index)=>{
    const day=new Date(start);day.setDate(index+1);
    return day.getFullYear()===start.getFullYear() && day.getMonth()===start.getMonth() && day.getDate()===index+1?localDay(day):null;
  }).filter(Boolean);
}
function changeBillDate(createdAt, day){
  const selected=dateFromDay(day),date=new Date(createdAt);
  const time=[date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()];
  date.setFullYear(selected.getFullYear(),selected.getMonth(),selected.getDate());
  if(!Number.isFinite(date.getTime())||localDay(date)!==day)throw new Error('请选择有效日期');
  if([date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()].some((value,index)=>value!==time[index]))throw new Error('所选日期无法保留原时刻，请选择其他日期');
  return date.toISOString();
}
function dailyExpenses(bills) {
  const days = new Map();
  for (const bill of bills) {
    if (bill.type === 'income') continue;
    const key = localDay(new Date(bill.createdAt));
    if (!days.has(key)) days.set(key,{date:key,total:0,bills:[]});
    const day = days.get(key);
    day.total += bill.amount;
    if (!Number.isSafeInteger(day.total)) throw new Error('每日支出合计超出可显示范围');
    day.bills.push(bill);
  }
  return [...days.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
function recentExpenses(days, now = new Date()) {
  const seen=new Set();
  return Array.from({length:7},(_,index)=>{
    const date = new Date(now);date.setHours(12,0,0,0);date.setDate(date.getDate()-6+index);
    if(date.getFullYear()<MIN_YEAR || date.getFullYear()>MAX_YEAR)return null;
    const key = localDay(date);
    if(seen.has(key))return null;seen.add(key);
    return {date:key,total:days.find(day=>day.date===key)?.total || 0};
  }).filter(Boolean);
}

function walletRemaining(expense, income = 0) {
  const remaining = 150000 - expense + income;
  if (!Number.isSafeInteger(expense) || expense < 0 || !Number.isSafeInteger(income) || income < 0 || !Number.isSafeInteger(remaining)) throw new Error('钱包金额超出有效范围');
  return remaining;
}

function validateTemplate(template){
  const name=typeof template?.name==='string'?template.name.trim():'';
  if(!template || typeof template.id!=='string' || !template.id.trim() || !['expense','income'].includes(template.type) || [...name].length<1 || [...name].length>12 || !Number.isSafeInteger(template.amount) || template.amount<=0 || !(template.type==='income'?incomeCategories:categories).includes(template.category))throw new Error('模板名称须为1至12个字符，金额和分类须有效');
  return {id:template.id,name,type:template.type,category:template.category,amount:template.amount};
}

