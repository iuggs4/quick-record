import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

function storageHarness(){
  const opens=[];
  const indexedDB={open(name,version){assert.equal(name,'light-ledger');assert.equal(version,2);const request={};opens.push(request);return request;}};
  const source=readFileSync(new URL('../model.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../storage.js',import.meta.url),'utf8');
  const api=new Script(source+';({storage,templates:templateStorage,validateTemplate});').runInNewContext({indexedDB});
  return {...api,indexedDB,opens,succeed(db,index=opens.length-1){opens[index].result=db;opens[index].onsuccess();}};
}

function mockDatabase(initial=[],{templates=[],stores=['bills','templates']}={}){
  const names=new Set(stores);
  const rows={bills:new Map(initial.map(bill=>[bill.id,{...bill}])),templates:new Map(templates.map((item,index)=>[index+1,{...item}]))};
  let nextKey=templates.length+1,running=false;
  const queue=[];
  function drain(){
    if(running || !queue.length)return;
    running=true;
    queueMicrotask(()=>{queue.shift()();running=false;drain();});
  }
  const db={closed:false,closes:0,
    createdStores:[],createdIndexes:[],objectStoreNames:{contains:name=>names.has(name)},
    close(){this.closed=true;this.closes++;},
    createObjectStore(name,options){
      assert.equal(names.has(name),false);names.add(name);db.createdStores.push(name);
      if(name==='bills')assert.equal(options.keyPath,'id');else{assert.equal(name,'templates');assert.equal(options.autoIncrement,true);assert.equal(options.keyPath,undefined);}
      return {createIndex(index,keyPath,options){assert.equal(name,'templates');assert.equal(index,'id');assert.equal(keyPath,'id');assert.equal(options.unique,true);db.createdIndexes.push(index);}};
    },
    transaction(name,mode){
      assert.ok(names.has(name));assert.ok(['readonly','readwrite'].includes(mode));
      if(this.closed)throw Object.assign(new Error('连接已关闭'),{name:'InvalidStateError'});
      let staged,stagedNext,aborted=false;
      const operations=[];
      const requestFor=operation=>{const request={};operations.push(()=>{request.result=operation();request.onsuccess?.();});return request;};
      const tx={abort(){aborted=true;},objectStore(storeName){assert.equal(storeName,name);return store;}};
      const store={transaction:tx,
        get(key){return requestFor(()=>{const value=staged.get(key);return value?{...value}:undefined;});},
        getAll(){return requestFor(()=>[...staged.entries()].sort((a,b)=>name==='templates'?a[0]-b[0]:String(a[0]).localeCompare(String(b[0]))).map(([,value])=>({...value})));},
        count(){return requestFor(()=>staged.size);},
        index(index){
          assert.equal(name,'templates');assert.equal(index,'id');
          return {
            getKey(id){return requestFor(()=>[...staged].find(([,value])=>value.id===id)?.[0]);},
            get(id){return requestFor(()=>{const value=[...staged.values()].find(value=>value.id===id);return value?{...value}:undefined;});}
          };
        },
        put(value,key){return requestFor(()=>{const target=name==='bills'?value.id:key;if(name==='templates')assert.equal(typeof target,'number');staged.set(target,{...value});return target;});},
        add(value){return requestFor(()=>{if([...staged.values()].some(row=>row.id===value.id))throw new Error('重复 ID');const key=name==='bills'?value.id:stagedNext++;staged.set(key,{...value});return key;});},
        delete(key){return requestFor(()=>staged.delete(key));},
        clear(){return requestFor(()=>staged.clear());}
      };
      queue.push(()=>{
        staged=new Map(rows[name]);stagedNext=nextKey;
        try{while(operations.length && !aborted)operations.shift()();}catch{aborted=true;tx.onerror?.();}
        if(aborted)tx.onabort?.();else{rows[name]=staged;if(name==='templates')nextKey=stagedNext;tx.oncomplete?.();}
      });
      drain();return tx;
    },
    get bills(){return [...rows.bills.values()].map(bill=>({...bill}));},
    get templates(){return [...rows.templates.values()].map(item=>({...item}));}
  };
  return db;
}

test('首次连接惰性初始化，共享打开请求，失败后重新打开并读取',async()=>{
  const h=storageHarness();assert.equal(h.opens.length,0);
  const first=h.storage.all(),second=h.storage.all();assert.equal(h.opens.length,1);
  const rejected=Promise.all([assert.rejects(first,/无法打开/),assert.rejects(second,/无法打开/)]);
  h.opens[0].onerror();await rejected;
  const retry=h.storage.all();assert.equal(h.opens.length,2);
  const db=mockDatabase();h.opens[1].result=db;h.opens[1].onupgradeneeded();h.succeed(db);assert.deepEqual(await retry,[]);
  assert.deepEqual(await h.storage.all(),[]);assert.equal(h.opens.length,2);assert.equal(db.closes,0);
});

test('打开调用同步抛错后也能再次建立连接',async()=>{
  const h=storageHarness(),open=h.indexedDB.open;
  h.indexedDB.open=()=>{throw new Error('权限暂不可用');};
  await assert.rejects(h.storage.all(),/权限暂不可用/);
  h.indexedDB.open=open;
  const retry=h.storage.all();assert.equal(h.opens.length,1);
  h.succeed(mockDatabase());assert.deepEqual(await retry,[]);
});

test('blocked 后可重试，旧请求迟到成功仅关闭旧连接，不替换新连接',async()=>{
  const h=storageHarness(),blocked=h.storage.all();
  const rejected=assert.rejects(blocked,/关闭其他记账页面/);
  h.opens[0].onblocked();await rejected;
  const retry=h.storage.all(),current=mockDatabase();h.succeed(current);await retry;
  const late=mockDatabase();h.succeed(late,0);
  assert.equal(late.closes,1);assert.equal(current.closes,0);
  await h.storage.all();assert.equal(h.opens.length,2);
});

test('版本变化或意外关闭可重连，旧连接的迟到关闭不清除新连接',async()=>{
  const h=storageHarness(),first=h.storage.all(),old=mockDatabase();h.succeed(old);await first;
  old.onversionchange();assert.equal(old.closes,1);
  const retry=h.storage.all(),current=mockDatabase();h.succeed(current);await retry;
  old.onclose();await h.storage.all();assert.equal(h.opens.length,2);
  current.closed=true;current.onclose();
  const reopened=h.storage.all();assert.equal(h.opens.length,3);h.succeed(mockDatabase());await reopened;
});

test('连接关闭但尚未收到 close 事件时，事务失败后下次读取仍可重连',async()=>{
  const h=storageHarness(),first=h.storage.all(),old=mockDatabase();h.succeed(old);await first;
  old.closed=true;
  await assert.rejects(h.storage.all(),/连接已关闭/);
  const retry=h.storage.all();assert.equal(h.opens.length,2);h.succeed(mockDatabase());await retry;
});

test('同一事务比较原记录，两份旧快照后保存的那份不能覆盖先前修改',async()=>{
  const original={id:'bill',amount:1000,category:'餐饮',createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness(),db=mockDatabase([original]),ready=h.storage.all();h.succeed(db);await ready;
  const first=h.storage.update({...original,amount:2000},original);
  const stale=h.storage.update({...original,category:'交通'},{...original});
  const rejected=assert.rejects(stale,/其他页面修改.*输入已保留.*关闭编辑面板后重新打开/);
  await first;await rejected;
  assert.deepEqual(db.bills,[{...original,amount:2000}]);
  const current=db.bills[0];await h.storage.update({...current,category:'交通'},current);
  assert.deepEqual(db.bills,[{...current,category:'交通'}]);
});

test('旧记录缺少 type 按支出比较，原始快照在异步读取前复制',async()=>{
  const original={id:'legacy',amount:500,category:'其他',createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness(),db=mockDatabase([original]);
  const snapshot={...original,type:'expense'};
  const pending=h.storage.update({...original,type:'expense',amount:600},snapshot);
  snapshot.amount=999;h.succeed(db);await pending;
  assert.equal(db.bills[0].amount,600);assert.equal(db.bills[0].type,'expense');
});

test('编辑必须提供对应的原始记录，不存在的 ID 拒绝且不创建账单',async()=>{
  const bill={id:'missing',amount:100,category:'其他',createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness();
  assert.throws(()=>h.storage.update(bill),/原始记录/);
  assert.throws(()=>h.storage.update(bill,{...bill,id:'another'}),/原始记录/);
  assert.equal(h.opens.length,0);
  const pending=h.storage.update(bill,bill),db=mockDatabase();h.succeed(db);
  await assert.rejects(pending,/不存在.*输入已保留/);assert.deepEqual(db.bills,[]);
});

test('原始快照比较不使用新的写入范围，旧超范围记录可被修正',async()=>{
  const original={id:'old-date',amount:100,category:'其他',createdAt:'0099-06-01T12:00:00.000Z'};
  const fixed={...original,createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness(),pending=h.storage.update(fixed,original),db=mockDatabase([original]);
  h.succeed(db);await pending;assert.equal(db.bills[0].createdAt,fixed.createdAt);
});

test('升级到版本2只补缺失仓库和模板身份索引，保留版本1账单',async()=>{
  const bill={id:'existing',amount:1800,category:'餐饮',createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness(),pending=h.storage.all(),db=mockDatabase([bill],{stores:['bills']});
  h.opens[0].result=db;h.opens[0].onupgradeneeded();h.succeed(db);await pending;
  assert.deepEqual(db.createdStores,['templates']);assert.deepEqual(db.createdIndexes,['id']);assert.deepEqual(db.bills,[bill]);
  h.opens[0].onupgradeneeded();assert.deepEqual(db.createdStores,['templates']);
  const fresh=storageHarness(),ready=fresh.templates.all(),empty=mockDatabase([],{stores:[]});
  fresh.opens[0].result=empty;fresh.opens[0].onupgradeneeded();fresh.succeed(empty);await ready;
  assert.deepEqual(empty.createdStores,['bills','templates']);assert.deepEqual(empty.createdIndexes,['id']);
});

test('模板名称按码点去首尾空白，类型分类金额统一校验，丢弃账单相关字段',()=>{
  const {validateTemplate}=storageHarness();
  const template={id:'meal',name:' 午饭 ',type:'expense',category:'餐饮',amount:1800,createdAt:'not-a-date',billId:'history'};
  assert.deepEqual({...validateTemplate(template)},{id:'meal',name:'午饭',type:'expense',category:'餐饮',amount:1800});
  assert.equal(validateTemplate({...template,name:'🍜'.repeat(12)}).name,'🍜'.repeat(12));
  for(const change of [{id:''},{name:' '},{name:'🍜'.repeat(13)},{type:undefined},{type:'other'},{amount:0},{amount:1.5},{amount:Number.MAX_SAFE_INTEGER+1},{type:'income',category:'餐饮'}])assert.throws(()=>validateTemplate({...template,...change}));
  assert.equal(validateTemplate({...template,type:'income',category:'工资'}).type,'income');
});

test('模板独立CRUD按创建顺序返回，修改保留顺序且不修改历史账单',async()=>{
  const bill={id:'history',amount:1800,category:'餐饮',createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness(),db=mockDatabase([bill]),ready=h.storage.all();h.succeed(db);await ready;
  const first={id:'z-first',name:'午饭',type:'expense',category:'餐饮',amount:1800};
  const second={id:'a-second',name:'通勤',type:'expense',category:'交通',amount:300};
  assert.equal(await h.templates.add(first),first.id);assert.equal(await h.templates.add(second),second.id);
  assert.deepEqual((await h.templates.all()).map(item=>item.id),['z-first','a-second']);
  const current=await h.templates.get(first.id);assert.deepEqual({...current},first);
  const edited={...current,name:'工资',type:'income',category:'工资',amount:2000};
  assert.equal(await h.templates.update(edited,current),first.id);
  assert.deepEqual((await h.templates.all()).map(item=>item.id),['z-first','a-second']);
  assert.equal((await h.templates.get(first.id)).amount,2000);
  assert.equal(await h.templates.remove(first.id,edited),first.id);
  assert.equal(await h.templates.get(first.id),undefined);assert.deepEqual(db.bills,[bill]);
  assert.deepEqual((await h.templates.all()).map(item=>item.id),['a-second']);
});

test('模板上限在事务内核对，并发创建最多留下12个且拒绝重复ID',async()=>{
  const templates=Array.from({length:11},(_,index)=>({id:'initial-'+index,name:'餐饮'+index,type:'expense',category:'餐饮',amount:1800}));
  const h=storageHarness(),db=mockDatabase([],{templates}),ready=h.templates.all();h.succeed(db);await ready;
  const first=h.templates.add({...templates[0],id:'twelfth'});
  const rejected=assert.rejects(h.templates.add({...templates[0],id:'thirteenth'}),/12个模板/);
  await first;await rejected;assert.equal(db.templates.length,12);
  await assert.rejects(h.templates.add(templates[0]),/ID已存在/);assert.equal(db.templates.length,12);
});

test('模板修改和删除都拒绝旧快照，原始副本不被调用方异步修改',async()=>{
  const original={id:'shared',name:'午饭',type:'expense',category:'餐饮',amount:1800};
  const h=storageHarness(),db=mockDatabase([],{templates:[original]}),ready=h.templates.all();h.succeed(db);await ready;
  const first=h.templates.update({...original,amount:2000},original);
  const conflict=assert.rejects(h.templates.update({...original,category:'交通'},original),error=>error.code==='TEMPLATE_CONFLICT');
  await first;await conflict;assert.equal(db.templates[0].amount,2000);
  await assert.rejects(h.templates.remove(original.id,original),error=>error.code==='TEMPLATE_CONFLICT');
  const current=await h.templates.get(original.id),snapshot={...current};
  const fixed={...current,category:'交通'},pending=h.templates.update(fixed,snapshot);snapshot.amount=999;
  await pending;assert.equal(db.templates[0].amount,2000);assert.equal(db.templates[0].category,'交通');
  assert.throws(()=>h.templates.update(fixed),error=>error.code==='TEMPLATE_CONFLICT');
  assert.throws(()=>h.templates.remove(fixed.id),error=>error.code==='TEMPLATE_CONFLICT');
  await h.templates.remove(fixed.id,fixed);
  await assert.rejects(h.templates.remove(fixed.id,fixed),error=>error.code==='TEMPLATE_CONFLICT');
});

test('重新读取同一ID可取得其他页面的新值，旧列表快照关闭重开后能够正常保存',async()=>{
  const original={id:'latest',amount:1000,category:'餐饮',createdAt:new Date(2026,9,26,12).toISOString()};
  const h=storageHarness(),db=mockDatabase([original]),ready=h.storage.all();h.succeed(db);await ready;
  const old=await h.storage.get(original.id);await h.storage.update({...old,amount:2000},old);
  await assert.rejects(h.storage.update({...old,category:'交通'},old),/其他页面修改/);
  const reopened=await h.storage.get(original.id);assert.equal(reopened.amount,2000);
  await h.storage.update({...reopened,category:'交通'},reopened);
  assert.equal(db.bills[0].amount,2000);assert.equal(db.bills[0].category,'交通');assert.equal(await h.storage.get('missing'),undefined);
});
