let database;
function getDatabase(){
  if(database)return database;
  const opening=new Promise((resolve,reject)=>{
    let settled=false;
    const request=indexedDB.open('light-ledger',2);
    function fail(message){if(settled)return;settled=true;reject(new Error(message));}
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('bills'))db.createObjectStore('bills',{keyPath:'id'});
      if(!db.objectStoreNames.contains('templates'))db.createObjectStore('templates',{autoIncrement:true}).createIndex('id','id',{unique:true});
    };
    request.onsuccess=()=>{
      const db=request.result;
      // blocked 无法取消打开请求，迟到的连接仍需关闭。
      if(settled){db.close();return;}
      settled=true;
      const forget=()=>{if(database===opening)database=undefined;};
      db.onversionchange=()=>{db.close();forget();};
      db.onclose=forget;
      resolve(db);
    };
    request.onerror=()=>fail('无法打开本地账单存储，请检查浏览器权限后重试');
    request.onblocked=()=>fail('数据库升级等待，请关闭其他记账页面后重试');
  });
  database=opening;
  opening.catch(()=>{if(database===opening)database=undefined;});
  return opening;
}
async function transaction(mode, action, storeName='bills') {
  const connection=getDatabase(),db=await connection;
  return new Promise((resolve,reject) => {
    let tx;
    try{tx=db.transaction(storeName,mode);}catch(error){
      if(error.name==='InvalidStateError' && database===connection)database=undefined;
      reject(error);return;
    }
    let request,failure;
    const abort=error=>{failure=error;tx.abort();};
    tx.oncomplete = () => resolve(request?.result);
    tx.onabort = () => reject(failure || new Error('本地存储失败，原有数据未更改。请检查存储空间或浏览器权限'));
    tx.onerror = () => {};
    try { request = action(tx.objectStore(storeName),abort); } catch(error) { abort(error); }
  });
}
const storage = Object.freeze({
  all: () => transaction('readonly', store => store.getAll()),
  get: id => transaction('readonly',store => store.get(id)),
  add: bill => { const clean = validateBill(bill); return transaction('readwrite',store => store.add(clean)); },
  update: (bill, original) => {
    const clean = validateBill(bill);
    if(!original || original.id!==clean.id)throw new Error('缺少账单原始记录，请关闭编辑面板后重新打开');
    const snapshot={id:original.id,amount:original.amount,category:original.category,createdAt:original.createdAt,type:original.type===undefined?'expense':original.type};
    return transaction('readwrite',(store,abort) => {
      const request=store.get(clean.id);
      request.onsuccess=()=>{
        try{
          const current=request.result;
          if(!current){abort(new Error('账单已不存在，输入已保留。请关闭编辑面板后重新打开'));return;}
          if(['id','amount','category','createdAt'].some(key=>current[key]!==snapshot[key]) || (current.type===undefined?'expense':current.type)!==snapshot.type){
            abort(new Error('账单已在其他页面修改，输入已保留。请关闭编辑面板后重新打开'));return;
          }
          store.put(clean);
        }catch(error){abort(error);}
      };
      return request;
    });
  },
  replace: bills => { const clean = bills.map(validateBill); if(new Set(clean.map(b=>b.id)).size !== clean.length) throw new Error('重复账单'); return transaction('readwrite',store => { store.clear(); clean.forEach(b=>store.add(b)); }); }
});

function templateConflict(){
  return Object.assign(new Error('模板已在其他页面修改或删除，请先重新读取最新模板；当前输入已保留'),{code:'TEMPLATE_CONFLICT'});
}
function changeTemplate(id,original,action){
  if(typeof id!=='string' || !id.trim() || !original || original.id!==id)throw templateConflict();
  const keys=['id','name','type','category','amount'];
  const snapshot=Object.fromEntries(keys.map(key=>[key,original[key]]));
  return transaction('readwrite',(store,abort)=>{
    const keyRequest=store.index('id').getKey(id);
    keyRequest.onsuccess=()=>{
      try{
        if(keyRequest.result===undefined){abort(templateConflict());return;}
        const key=keyRequest.result,request=store.get(key);
        request.onsuccess=()=>{
          try{
            if(!request.result || keys.some(field=>request.result[field]!==snapshot[field])){abort(templateConflict());return;}
            action(store,key);
          }catch(error){abort(error);}
        };
      }catch(error){abort(error);}
    };
    return keyRequest;
  },'templates').then(()=>id);
}
const templateStorage=Object.freeze({
  all:()=>transaction('readonly',store=>store.getAll(),'templates'),
  get:id=>transaction('readonly',store=>store.index('id').get(id),'templates'),
  add:template=>{
    const clean=validateTemplate(template);
    return transaction('readwrite',(store,abort)=>{
      const existing=store.index('id').getKey(clean.id);
      existing.onsuccess=()=>{
        try{
          if(existing.result!==undefined){abort(new Error('模板ID已存在，请重新创建'));return;}
          const count=store.count();
          count.onsuccess=()=>{
            try{
              if(count.result>=12){abort(new Error('最多保存12个模板，请先删除不需要的模板'));return;}
              store.add(clean);
            }catch(error){abort(error);}
          };
        }catch(error){abort(error);}
      };
      return existing;
    },'templates').then(()=>clean.id);
  },
  update:(template,original)=>{const clean=validateTemplate(template);return changeTemplate(clean.id,original,(store,key)=>store.put(clean,key));},
  remove:(id,original)=>changeTemplate(id,original,(store,key)=>store.delete(key))
});

