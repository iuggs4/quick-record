let savedTemplates=[],templateRead=0,templateEditRead=0,templateState='loading',templateError='',editingTemplate=null;
function activeTemplateForm(){return entryForms.find(form=>form.type===$('entry-tabs').dataset.type);}
function entryCategory(form){return [...$(form.categories).children].find(button=>button.getAttribute('aria-pressed')==='true')?.textContent || '其他';}
function templateButton(text,action){
  const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=busy;button.onclick=action;return button;
}
function syncTemplateEntry(){
  $('template-bar').hidden=Boolean(editingBill);
  $('template-list').replaceChildren();
  if(!editingBill && templateState==='ready')for(const template of savedTemplates.filter(item=>item.type===$('entry-tabs').dataset.type)){
    const button=templateButton(template.name+' ¥'+amountText(template.amount),()=>applyEntryTemplate(template));
    button.className='template-chip';$('template-list').append(button);
  }
  $('manage-templates').hidden=!savedTemplates.length;
  $('template-status').textContent=templateState==='loading'?'正在读取模板…':templateState==='error'?'模板读取失败：'+templateError+'，仍可手动记账。':'';
  $('retry-templates').hidden=templateState!=='error';
}
function renderTemplateItems(){
  const list=$('template-items');list.replaceChildren();
  if(templateState==='loading'){const text=document.createElement('p');text.textContent='正在读取模板…';list.append(text);return;}
  if(templateState==='error'){
    const text=document.createElement('p');text.textContent='模板读取失败：'+templateError;
    list.append(text,templateButton('重新读取模板',()=>refreshTemplates()));return;
  }
  if(!savedTemplates.length){const text=document.createElement('p');text.textContent='还没有模板，可在下方添加。';list.append(text);}
  for(const template of savedTemplates){
    const row=document.createElement('div');row.className='template-row';
    const text=document.createElement('span');text.textContent=template.name+' · '+(template.type==='income'?'收入':'支出')+' · '+template.category+' ¥'+amountText(template.amount);
    const edit=templateButton('编辑',()=>openTemplateEditor(template.id)),remove=templateButton('删除',()=>deleteEntryTemplate(template));
    edit.setAttribute('aria-label','编辑模板 '+template.name);remove.setAttribute('aria-label','删除模板 '+template.name);
    row.append(text,edit,remove);list.append(row);
  }
}
async function refreshTemplates(){
  const request=++templateRead;templateState='loading';syncTemplateEntry();renderTemplateItems();
  try{
    const templates=await templateStorage.all();
    if(request!==templateRead)return false;
    templates.forEach(validateTemplate);savedTemplates=templates.map(template=>({...template}));templateState='ready';templateError='';
    syncTemplateEntry();renderTemplateItems();return true;
  }catch(error){
    if(request!==templateRead)return false;
    templateState='error';templateError=error.message;syncTemplateEntry();renderTemplateItems();return false;
  }
}
function applyEntryTemplate(template){
  if(busy || $('entry').dataset.closing || editingBill || !$('template-manager').hidden)return;
  const form=activeTemplateForm();if(!form || form.type!==template.type)return;
  try{
    const clean=validateTemplate(template),input=$(form.amount);let same=false;
    try{same=parseAmount(input.value)===clean.amount && entryCategory(form)===clean.category;}catch{}
    if(input.value.trim() && !same && !confirm('替换当前金额和分类？'))return;
    form.choose(clean.category);input.value=amountText(clean.amount);syncAmountDisplay(input);message('已填入模板，请确认后保存');
  }catch(error){message('无法使用模板：'+error.message);}
}
function fillTemplateCategories(type,category='其他'){
  const values=type==='income'?incomeCategories:categories,select=$('template-category');select.replaceChildren();
  for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
  select.value=values.includes(category)?category:'其他';
}
function prepareNewTemplate(){
  if(busy || $('entry').dataset.closing)return;
  ++templateEditRead;editingTemplate=null;
  const form=activeTemplateForm();$('template-name').value='';$('template-type').value=form?.type || 'expense';
  fillTemplateCategories($('template-type').value,form?entryCategory(form):'其他');
  $('template-amount').value=form?$(form.amount).value:'';
  $('template-save').textContent='添加模板';$('template-cancel').hidden=true;$('template-manager-status').textContent='';
  $('template-name').focus();
}
function openTemplateManager(){
  if(busy || $('entry').dataset.closing || editingBill)return;
  $('entry-main').hidden=true;$('template-manager').hidden=false;$('quick-add-title').textContent='管理模板';
  prepareNewTemplate();refreshTemplates();
}
async function openTemplateEditor(id){
  if(busy || $('entry').dataset.closing)return;
  const request=++templateEditRead;setBusy(true);$('template-manager-status').textContent='正在读取最新模板…';$('template-save').textContent='读取中…';
  try{
    const template=await templateStorage.get(id);
    if(request!==templateEditRead || $('template-manager').hidden)return;
    if(!template)throw new Error('模板已不存在，请重新读取列表');
    validateTemplate(template);setBusy(false);editingTemplate={...template};
    $('template-name').value=template.name;$('template-type').value=template.type;fillTemplateCategories(template.type,template.category);
    $('template-amount').value=amountText(template.amount);$('template-save').textContent='保存修改';$('template-cancel').hidden=false;
    $('template-manager-status').textContent='';$('template-name').focus();
  }catch(error){if(request===templateEditRead && !$('template-manager').hidden)$('template-manager-status').textContent='读取模板失败：'+error.message;}
  finally{setBusy(false);}
}
function showTemplateEntry(){
  if(busy || $('entry').dataset.closing)return;
  ++templateEditRead;editingTemplate=null;$('template-manager').hidden=true;$('entry-main').hidden=false;
  $('quick-add-title').textContent=editingBill?'Edit Bill':'Quick Add';syncTemplateEntry();
  if(!editingBill)$('add-template').focus();
}
function setTemplateBusy(value){
  for(const control of document.querySelectorAll('#template-bar button,#template-manager button,#template-manager input,#template-manager select'))control.disabled=value;
  $('template-save').textContent=value?'保存中…':editingTemplate?'保存修改':'添加模板';
}
async function saveEntryTemplate(){
  if(busy || $('entry').dataset.closing)return;
  ++templateEditRead;
  const original=editingTemplate;let saved=false;
  try{
    const template=validateTemplate({id:original?.id || crypto.randomUUID(),name:$('template-name').value,type:$('template-type').value,category:$('template-category').value,amount:parseAmount($('template-amount').value)});
    setBusy(true);
    if(original)await templateStorage.update(template,original);else await templateStorage.add(template);
    saved=true;await refreshTemplates();
  }catch(error){
    let latest=false;if(error.code==='TEMPLATE_CONFLICT')latest=await refreshTemplates();
    const recovery=latest?(savedTemplates.some(template=>template.id===original?.id)?'。列表已更新，请点“编辑”重新载入后再保存。':'。原模板已删除，当前输入已保留，可取消修改后新建模板。'):'。最新列表读取失败，请重试读取后重新载入模板。';
    $('template-manager-status').textContent=error.message+(error.code==='TEMPLATE_CONFLICT'?recovery:'');
  }finally{setBusy(false);}
  if(saved){showTemplateEntry();message('模板已保存，当前账单内容未改变');}
}
async function deleteEntryTemplate(template){
  if(busy || $('entry').dataset.closing || !confirm('删除模板“'+template.name+'”？历史账单不会改变。'))return;
  ++templateEditRead;
  let removed=false;
  try{
    setBusy(true);await templateStorage.remove(template.id,template);removed=true;await refreshTemplates();
  }catch(error){
    let latest=false;if(error.code==='TEMPLATE_CONFLICT')latest=await refreshTemplates();
    $('template-manager-status').textContent=error.message+(error.code==='TEMPLATE_CONFLICT'?(latest?'。列表已更新，请重新确认操作。':'。最新列表读取失败，请先重试读取。'):'');
  }finally{setBusy(false);}
  if(removed){if(editingTemplate?.id===template.id)prepareNewTemplate();$('template-manager-status').textContent='模板已删除，历史账单未改变';}
}
function resetTemplateManager(){
  ++templateRead;++templateEditRead;editingTemplate=null;
  $('template-manager').hidden=true;$('entry-main').hidden=false;$('template-manager-status').textContent='';
  $('quick-add-title').textContent=editingBill?'Edit Bill':'Quick Add';syncTemplateEntry();
}
function initTemplates(){
  $('add-template').onclick=openTemplateManager;$('manage-templates').onclick=openTemplateManager;
  $('retry-templates').onclick=()=>{if(!busy)refreshTemplates();};$('template-back').onclick=showTemplateEntry;
  $('template-save').onclick=saveEntryTemplate;$('template-cancel').onclick=prepareNewTemplate;
  $('template-type').onchange=()=>{if(!busy)fillTemplateCategories($('template-type').value);};
  $('template-amount').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('template-save').click();}});
  syncTemplateEntry();refreshTemplates();
}
