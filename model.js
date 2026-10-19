const categories = ['餐饮','交通','购物','娱乐','学习','其他'];
const incomeCategories = ['工资','生活费','奖金','兼职','退款','其他'];
function parseAmount(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('请输入大于零、最多两位小数的金额');
  const [yuan, fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('金额必须大于零且不能超出范围');
  return cents;
}
function validateBill(bill) {
  const type = bill?.type === undefined ? 'expense' : bill.type;
  if (!bill || !['expense','income'].includes(type) || typeof bill.id !== 'string' || !bill.id.trim() || !Number.isSafeInteger(bill.amount) || bill.amount <= 0 || !(type === 'income' ? incomeCategories : categories).includes(bill.category) || typeof bill.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(bill.createdAt) || (!Number.isFinite(Date.parse(bill.createdAt)) || new Date(bill.createdAt).toISOString() !== bill.createdAt)) throw new Error('账单字段无效');
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
function monthDates(date){
  const start=new Date(date);start.setDate(1);start.setHours(12,0,0,0);
  const end=new Date(start);end.setMonth(end.getMonth()+1);end.setDate(0);
  return Array.from({length:end.getDate()},(_,index)=>{
    const day=new Date(start);day.setDate(index+1);return localDay(day);
  });
}
function changeBillDate(createdAt, day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error('请选择有效日期');
  const date=new Date(createdAt),[year,month,dateOfMonth]=day.split('-').map(Number);
  date.setFullYear(year,month-1,dateOfMonth);
  if(!Number.isFinite(date.getTime())||localDay(date)!==day)throw new Error('请选择有效日期');
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
  return Array.from({length:7},(_,index)=>{
    const date = new Date(now.getFullYear(),now.getMonth(),now.getDate()-6+index);
    const key = localDay(date);
    return {date:key,total:days.find(day=>day.date===key)?.total || 0};
  });
}

function walletRemaining(expense, income = 0) {
  const remaining = 150000 - expense + income;
  if (!Number.isSafeInteger(expense) || expense < 0 || !Number.isSafeInteger(income) || income < 0 || !Number.isSafeInteger(remaining)) throw new Error('钱包金额超出有效范围');
  return remaining;
}

