const database = new Promise((resolve,reject) => {
  const request = indexedDB.open('light-ledger',1);
  request.onupgradeneeded = () => request.result.createObjectStore('bills',{keyPath:'id'});
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('无法打开本地账单存储'));
  request.onblocked = () => reject(new Error('请关闭其他记账页面后重试'));
});
async function transaction(mode, action) {
  const db = await database;
  return new Promise((resolve,reject) => {
    const tx = db.transaction('bills',mode);
    let request;
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = () => reject(new Error('本地存储失败，原有数据未更改。请检查存储空间或浏览器权限'));
    tx.onerror = () => {};
    try { request = action(tx.objectStore('bills')); } catch(error) { tx.abort(); reject(error); }
  });
}
const storage = Object.freeze({
  all: () => transaction('readonly', store => store.getAll()),
  add: bill => { const clean = validateBill(bill); return transaction('readwrite',store => store.add(clean)); },
  update: bill => {
    const clean = validateBill(bill);
    return transaction('readwrite',store => {
      const request=store.get(clean.id);
      request.onsuccess=()=>{
        if(!request.result){store.transaction.abort();return;}
        store.put(clean);
      };
      return request;
    });
  },
  replace: bills => { const clean = bills.map(validateBill); if(new Set(clean.map(b=>b.id)).size !== clean.length) throw new Error('重复账单'); return transaction('readwrite',store => { store.clear(); clean.forEach(b=>store.add(b)); }); }
});

