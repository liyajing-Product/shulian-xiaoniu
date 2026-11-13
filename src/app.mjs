import { request, importDocument, clearDocuments } from './public-api.mjs';
import { renderAnswer } from './markdown.mjs';
import { consumeSSE, loadConversation, workflowStatus, createFrameScheduler, customerAnswer, publicProcess, PROGRESS_DETAIL_DELAY, LONG_ANSWER_LENGTH } from './lib.mjs';
import { notify } from './notification.mjs';
import { navigationIcon } from './nav-icons.mjs';
const $ = selector => document.querySelector(selector);
const icons = {
  chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6A8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z',
  messages:'M21 15V4a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8l4 3v-1ZM4 8H3v13l4-3h8v-2',
  plug:'m8 3 2 2M3 8l2 2m9-8-4 4m10 4-4 4M6 10l4-4 8 8-4 4-8-8Zm-2 8 4-4m-6 8 3-3',
  box:'M4 4h16v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4Zm0 9h5l2 3h2l2-3h5',
  search:'M3 5h16M3 10h6M3 15h5m12 5-4-4m2-5a5 5 0 1 0-10 0 5 5 0 0 0 10 0Z',
  layers:'m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  chart:'M4 12h4v9H4v-9Zm6-5h4v14h-4V7Zm6-4h4v18h-4V3Z',
  key:'M15 3a6 6 0 0 0-5 9L3 19v3h3v-3h3v-3l3-2a6 6 0 1 0 3-11Zm1 4h.01',
  'arrow-right':'M5 12h14m-5-5 5 5-5 5', 'arrow-up':'M12 19V5m-6 6 6-6 6 6',
  close:'m6 6 12 12M18 6 6 18', chevron:'m7 10 5 5 5-5',menu:'M4 6h16M4 12h16M4 18h16',
  info:'M12 11v5m0-9h.01M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0Z',
  sparkle:'m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z',
  eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6', plus:'M12 5v14M5 12h14',
};
function icon(name) { return navigationIcon(name) || `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.box}"/></svg>`; }
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
hydrateIcons();
const adminMode = false;
document.body.classList.add('customer-mode');
const toast = notify;
async function api(path, options = {}) {
  const response = await request(path, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '请求未完成，请重试');
  return data;
}
let conversation = loadConversation(localStorage) || { sessionId: crypto.randomUUID(), messages:[], updatedAt:Date.now() };
let searchMessages = [], mode = 'chat', view = 'playground', controller = null, busy = false;
let modelStatus = null, workspaceStatus = null, keyBusy = false;
const labels = {playground:'Playground', datasets:'数据集', knowledge:'知识管理', search:'知识检索', chat:'知识问答',channels:'服务渠道',usage:'用量'};
function persist() {
  conversation.updatedAt = Date.now();
  try { localStorage.setItem('shulian-public-conversation', JSON.stringify(conversation,(key,value)=>key==='feedbackSaving'?undefined:value)); }
  catch { toast('浏览器存储不可用，刷新后将无法恢复本次对话'); }
}
function updateButton() {
  $('#send-button').disabled = !$('#question').value.trim() || busy;
  $('#send-button').classList.toggle('hidden', busy);
  $('#stop-button').classList.toggle('hidden', !busy);
  $('#key-button').disabled = busy || keyBusy;
}
const messageNodes = new WeakMap();
const streamPaint = createFrameScheduler(updateStreamingMessage,
  callback => requestAnimationFrame(callback), frame => cancelAnimationFrame(frame));
function updateStreamingMessage(item) {
  const nodes = messageNodes.get(item);
  if (!nodes?.row.isConnected) return;
  const host = $('#messages');
  const followLatest = host.scrollHeight - host.scrollTop - host.clientHeight < 60;
  const value = customerAnswer(item.text, true);
  if (value !== nodes.value) {
    renderAnswer(nodes.text, value);
    nodes.value = value;
    nodes.text.classList.toggle('hidden', !value);
  }
  const workflow = workflowStatus(item);
  if (workflow && nodes.progress) {
    nodes.progress.classList.toggle('is-active', workflow.active);
    nodes.progress.classList.toggle('is-expanded', workflow.expanded);
    syncProcessSteps(nodes.steps, item, !workflow.expanded);
    if (nodes.label.textContent !== workflow.text) nodes.label.textContent = workflow.text;
  }
  const rowClass = `message ${item.role} ${item.status || ''}`;
  if (nodes.row.className !== rowClass) nodes.row.className = rowClass;
  if (followLatest) host.scrollTop = host.scrollHeight;
}
function syncProcessSteps(list, item, hidden = false) {
  if (!list) return;
  list.hidden = hidden;
  const steps = publicProcess(item);
  if (list.dataset.stages === steps.join('|')) return;
  list.dataset.stages = steps.join('|');
  list.replaceChildren(...steps.map(step => { const li = document.createElement('li'); li.textContent = step; return li; }));
}
function renderMessages() {
  streamPaint.cancel();
  const messages = view === 'playground' ? [] : mode === 'search' ? searchMessages : conversation.messages;
  $('.studio-content').classList.toggle('has-messages', messages.length > 0);
  const host = $('#messages');
  const previousTop = host.scrollTop;
  const followLatest = host.scrollHeight - host.scrollTop - host.clientHeight < 60;
  host.replaceChildren();
  for (const item of messages) {
    const row = document.createElement('article'); row.className = `message ${item.role} ${item.status || ''}`;
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.innerHTML = item.role === 'user' ? '我' : icon('sparkle');
    const body = document.createElement('div'); body.className = 'message-body';
    const role = document.createElement('div'); role.className = 'message-role'; role.textContent = item.role === 'user' ? '你' : mode === 'search' ? '检索结果' : '数链小牛';
    const text = document.createElement('div'); text.className = 'message-text';
    const visibleText = (item.role === 'assistant' ? customerAnswer(item.text, ['pending','streaming'].includes(item.status)) : item.text) || (item.stage ? '' : '正在检索业务知识…');
    if (item.role === 'assistant') renderAnswer(text, visibleText); else text.textContent = visibleText;
    body.append(role);
    const workflow = workflowStatus(item);
    let progress, marker, label, steps;
    if (workflow) {
      progress = document.createElement('div'); progress.className = 'workflow-status' + (workflow.active ? ' is-active' : '') + (workflow.expanded ? ' is-expanded' : '');
      progress.setAttribute('role','status');
      marker = document.createElement('span'); marker.className = 'workflow-marker'; marker.setAttribute('aria-hidden','true'); marker.textContent = workflow.active ? '' : ['error','cancelled'].includes(item.status) ? '–' : '✓';
      label = document.createElement('span'); label.textContent = workflow.text;
      const line = document.createElement('div'); line.className = 'workflow-line'; line.append(marker,label);
      steps = document.createElement('ol'); steps.className = 'workflow-steps'; syncProcessSteps(steps,item,!workflow.expanded);
      progress.append(line,steps); body.append(progress);
    }
    text.classList.toggle('hidden', !text.textContent);
    body.append(text);
    messageNodes.set(item, {row, text, value:visibleText, progress, marker, label, steps});
    if (item.status === 'succeeded' && (item.text || '').length >= LONG_ANSWER_LENGTH && publicProcess(item).length) {
      const detail = document.createElement('details'); detail.className = 'workflow-history';
      const summary = document.createElement('summary'); summary.textContent = '查看处理过程';
      const list = document.createElement('ol'); list.className = 'workflow-steps'; syncProcessSteps(list,item);
      detail.append(summary,list); body.append(detail);
    }
    if (item.results) for (const [index, result] of item.results.entries()) {
      const card = document.createElement('div'); card.className = 'search-result';
      const info = document.createElement('small'); info.textContent = `相关片段 ${index + 1} · 相似度 ${result.score.toFixed(2)} · ${result.status === 'draft' ? '草稿' : '知识片段'}`;
      const snippet = document.createElement('div'); snippet.textContent = result.text;
      card.append(snippet); body.append(card);
    }
    if (item.meta && ['error', 'cancelled'].includes(item.status)) { const meta = document.createElement('div'); meta.className = 'message-meta'; meta.textContent = item.meta; body.append(meta); }
    if (item.status === 'error' || item.status === 'cancelled') {
      const retry = document.createElement('button'); retry.className = 'secondary-button'; retry.textContent = '重新提问';
      retry.onclick = () => { const index = messages.indexOf(item); $('#question').value = messages[index - 1]?.text || ''; updateButton(); $('#question').focus(); };
      body.append(retry);
    }
    if (item.role === 'assistant' && item.callId && item.status === 'succeeded' && mode === 'chat') {
      const feedback = document.createElement('div'); feedback.className = 'answer-feedback';
      const legend = document.createElement('span'); legend.textContent = '这次回答有帮助吗？'; feedback.append(legend);
      for (const [value,label] of [['helpful','有帮助'],['not_helpful','没解决']]) {
        const button = document.createElement('button'); button.type='button';button.className='feedback-choice';button.textContent=label;
        button.setAttribute('aria-pressed',String(item.feedback===value));button.disabled=busy||item.feedbackSaving;
        button.onclick=()=>saveAnswerFeedback(item,value,item.feedbackNote||'');feedback.append(button);
      }
      if (item.feedback === 'not_helpful') {
        const form=document.createElement('form');form.className='feedback-reason';
        const input=document.createElement('textarea');input.maxLength=500;input.rows=2;input.placeholder='哪里没有解决？（选填，请勿填写密码等敏感信息）';input.setAttribute('aria-label','没解决的原因');input.value=item.feedbackDraft??item.feedbackNote??'';
        input.oninput=()=>{item.feedbackDraft=input.value;};
        const submit=document.createElement('button');submit.type='submit';submit.className='secondary-button';submit.textContent=item.feedbackSaving?'正在保存…':'保存原因';submit.disabled=busy||item.feedbackSaving;
        form.append(input,submit);form.onsubmit=e=>{e.preventDefault();saveAnswerFeedback(item,'not_helpful',input.value);};feedback.append(form);
      }
      body.append(feedback);
    }
    row.append(avatar, body); host.append(row);
  }
  host.scrollTop = followLatest ? host.scrollHeight : previousTop;
}
async function saveAnswerFeedback(item,value,note) {
  if (busy||item.feedbackSaving) return;
  item.feedbackSaving=true;renderMessages();
  try {
    const saved={value,note};
    item.feedback=saved.value;item.feedbackNote=saved.note;item.feedbackDraft=saved.note;persist();toast('反馈仅保存在当前浏览器','success');
  } catch(error) {toast(error.message,'error');}
  finally {item.feedbackSaving=false;renderMessages();}
}
function setMode(next) {
  if (busy) { toast('请先停止当前请求，再切换模式'); return; }
  mode = next;
  $('#mode-chat').classList.toggle('selected', next === 'chat'); $('#mode-search').classList.toggle('selected', next === 'search');
  $('#mode-chat').setAttribute('aria-pressed', String(next === 'chat')); $('#mode-search').setAttribute('aria-pressed', String(next === 'search'));
  $('#question').placeholder = next === 'search' ? '输入检索词，查找相关的业务知识…' : '输入你的业务问题，让知识为你解答…';
  renderMessages();
}
function panelHeader(eyebrow, title, subtitle) {
  const panel = $('#settings-panel'); panel.innerHTML = `<div class="section-eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p>`; return panel;
}
function detailCard(title, iconName, rows, description='') {
  const card = document.createElement('section'); card.className = 'detail-card';
  const heading = document.createElement('h2'); heading.innerHTML = icon(iconName); heading.append(document.createTextNode(title)); card.append(heading);
  if (description) { const p = document.createElement('p'); p.textContent = description; card.append(p); }
  for (const [label, value] of rows) { const row = document.createElement('div'); row.className = 'detail-row'; const l = document.createElement('span'); l.textContent = label; const v = document.createElement('strong'); v.textContent = value; row.append(l,v); card.append(row); }
  return card;
}
function renderDetail() {}
function showView(next) {
  if (!(next in labels)) next = 'playground';
  if (!adminMode && !['playground','chat','search'].includes(next)) next = 'playground';
  if (busy) { toast('请先停止当前请求，再切换页面'); return; }
  view = next; $('#page-label').textContent = labels[next];
  document.querySelectorAll('.nav-item').forEach(button => { const active = button.dataset.view === next; button.classList.toggle('active', active); button.setAttribute('aria-current', active ? 'page':'false'); });
  const playground = ['playground','chat','search'].includes(next);
  $('#playground-panel').classList.toggle('hidden',!playground); $('#settings-panel').classList.toggle('hidden',playground);
  if (playground) setMode(next === 'search' ? 'search':'chat'); else renderDetail();
  $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded','false');
  history.replaceState(null,'','#'+next);
}
$('#navigation').addEventListener('click', event => { const button = event.target.closest('[data-view],[data-action]'); if (!button) return;
  if (busy) { toast('请先停止当前请求，再开始新对话或切换页面'); return; }
  if (button.dataset.action === 'new-chat') { setMode('chat'); if (startNewConversation()) showView('chat'); }
  else showView(button.dataset.view); });
$('#mode-chat').onclick = () => setMode('chat'); $('#mode-search').onclick = () => setMode('search');
$('#menu-button').onclick = () => { const open = $('#sidebar').classList.toggle('open'); $('#menu-button').setAttribute('aria-expanded',String(open)); };
document.addEventListener('click', event => { if (window.innerWidth <= 720 && !event.target.closest('#sidebar,#menu-button')) { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded','false'); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { $('#sidebar').classList.remove('open'); $('#menu-button').setAttribute('aria-expanded','false'); } });

$('#workspace-info').onclick = () => toast('公开体验：仅含通用示例，可临时导入自己的非敏感文本。');
$('#suggestions').onclick = event => { const button = event.target.closest('[data-question]'); if (!button || busy) return; $('#question').value = button.dataset.question; updateButton(); $('#question').focus(); };
$('#question').oninput = updateButton;
$('#question').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if ($('#question').value.trim() && !busy) $('#ask-form').requestSubmit(); } };
$('#stop-button').onclick = () => controller?.abort();
function startNewConversation() {
  if (busy) { toast('请先停止当前请求'); return false; }
  if (mode === 'search') searchMessages = [];
  else {
    try { const history = JSON.parse(localStorage.getItem('shulian-public-history') || '[]'); if (conversation.messages.length) history.push(conversation); const cutoff = Date.now()-7*86400000; for(let i=history.length-1;i>=0;i--) if(history[i].updatedAt<cutoff) history.splice(i,1); localStorage.setItem('shulian-public-history',JSON.stringify(history)); } catch { toast('历史归档未成功，本次未清空对话'); return false; }
    conversation = {sessionId:crypto.randomUUID(),messages:[],updatedAt:Date.now()}; persist();
  }
  renderMessages(); $('#question').focus(); return true;
}
$('#ask-form').onsubmit = async event => {
  event.preventDefault(); const question = $('#question').value.trim(); if (!question || busy) return;
  await refreshSettings();
  if (busy || keyBusy) return;
  if (!modelStatus?.configured) { openKey(); return; }
  if (view === 'playground') {
    const target = mode;
    if (!startNewConversation()) return;
    showView(target);
  }
  busy = true; controller = new AbortController(); updateButton();
  const activeMode = mode; const entries = activeMode === 'search' ? searchMessages : conversation.messages;
  entries.push({role:'user',text:question,createdAt:Date.now()}); const result = {role:'assistant',text:'',status:'pending',kind:activeMode,publicStages:[],stage:activeMode === 'chat' ? 'requesting' : 'retrieving',createdAt:Date.now()}; entries.push(result);
  $('#question').value = ''; renderMessages();
  const progressTimer = setTimeout(() => { if (['pending','streaming'].includes(result.status)) { result.progressExpanded=true; streamPaint.schedule(result); } }, PROGRESS_DETAIL_DELAY);
  try {
    if (activeMode === 'search') {
      const data = await api('/api/v1/knowledge/search',{method:'POST',body:JSON.stringify({query:question,top_k:3}),signal:controller.signal});
      result.text = data.hit ? `找到 ${data.chunks.length} 个相关知识片段。` : '暂未找到足够相关的内容，试试补充业务场景或换个检索词。';
      result.hit = data.hit; result.stage = 'preparing';
      result.results = data.chunks; result.meta = '检索模式 · 未调用回答生成模型';
    } else {
      const response = await request('/api/v1/chat/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,session_id:conversation.sessionId,include_progress:true,history:conversation.messages.slice(0,-2).map(m=>({role:m.role,content:m.text}))}),signal:controller.signal});
      await consumeSSE(response, event => {
        if (event.event === 'status') { result.stage = event.data.stage; if (!result.publicStages.includes(event.data.stage)) result.publicStages.push(event.data.stage); if (typeof event.data.hit === 'boolean') result.hit = event.data.hit; streamPaint.schedule(result); }
        else if (event.event === 'chunk') { result.text += event.data; result.status = 'streaming'; if (!result.publicStages.includes('generating')) result.publicStages.push('generating'); streamPaint.schedule(result); }
        else { result.hit = event.data.hit; result.callId = event.data.call_id; result.stage = 'preparing'; result.text = event.data.answer; result.sources = event.data.sources || []; result.meta = event.data.hit ? '已依据业务知识回答 · 草稿内容请核实' : '暂无相关知识 · 建议补充信息'; }
      });
    }
    result.status = 'succeeded';
  } catch (error) {
    if (error.name === 'AbortError' || controller?.signal.aborted) { result.status = 'cancelled'; result.text ||= '已停止本次请求。'; result.meta = '本次生成已停止，已产生的模型费用仍可能计入账单。'; }
    else { result.status = 'error'; result.text ||= error.message || '请求失败，请重试'; result.meta = '请求未完成，请稍后重新提问。'; }
  } finally { clearTimeout(progressTimer);busy=false;controller=null;if(activeMode === 'chat')persist();renderMessages();updateButton(); }
};
async function refreshSettings() {
  try {
    modelStatus = await api('/api/v1/settings/model');
    $('#model-name').textContent = modelStatus.model; $('#model-button').setAttribute('aria-label','当前模型：'+modelStatus.model);
    const own = modelStatus.personal;
    for (const id of ['key-button']) $('#'+id).classList.toggle('hidden', !adminMode && !modelStatus.requires_personal_key);
    $('#key-status-dot').classList.toggle('configured',modelStatus.configured);
    $('#key-entry-label').textContent = 'API Key配置';
    $('#clear-key').disabled = !own || keyBusy;
    $('#key-config-state').textContent = own ? '当前页面已配置，刷新后清除；调用费用计入你的百炼账号。' : modelStatus.requires_personal_key ? '尚未配置个人 Key，不会使用站点管理员的额度。' : modelStatus.configured ? '当前使用工作区配置。' : '尚未配置模型服务。';
  } catch { modelStatus = null; $('#key-config-state').textContent = '读取配置失败，请稍后重试。'; }
}
function setKeyBusy(value) {
  keyBusy=value;
  for (const id of ['save-key','cancel-key','close-key']) $('#'+id).disabled=value;
  $('#clear-key').disabled=value || !modelStatus?.personal;
  $('#api-key').disabled=value;
  $('#save-key').textContent=value?'正在验证…':adminMode?'保存配置':'验证并保存';
  updateButton();
}
function openKey() {
  if (busy || keyBusy) return;
  if (modelStatus && !modelStatus.requires_personal_key && !adminMode) return;
  $('#api-key').value='';$('#api-key').type='password';$('#key-error').textContent='';
  $('#key-title').textContent=adminMode?'配置工作区 API Key':'配置我的 API Key';
  $('#save-key').textContent=adminMode?'保存配置':'验证并保存';
  if (!$('#key-dialog').open) $('#key-dialog').showModal(); refreshSettings();
}
$('#key-button').onclick = openKey;
for (const id of ['close-key','cancel-key']) $('#'+id).onclick = () => { if (!keyBusy) $('#key-dialog').close(); };
$('#key-dialog').addEventListener('cancel',event => { if (keyBusy) event.preventDefault(); });
$('#key-dialog').addEventListener('close',() => { $('#api-key').value='';$('#api-key').type='password'; });
$('#key-dialog').addEventListener('click', event => { if (!keyBusy && event.target === $('#key-dialog')) { const bounds = event.target.getBoundingClientRect(); if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom) event.target.close(); } });
$('#toggle-key').onclick = () => { const field=$('#api-key');field.type=field.type === 'password'?'text':'password';$('#toggle-key').setAttribute('aria-label',field.type === 'password'?'显示输入的密钥':'隐藏输入的密钥'); };
$('#key-form').onsubmit = async event => {
  event.preventDefault(); if(keyBusy)return;
  const key = $('#api-key').value;
  if (!key) { $('#key-error').textContent = '请输入你的 API Key；留空不会更改已有配置。'; return; }
  setKeyBusy(true);$('#key-error').textContent='';
  try {
    await api('/api/v1/settings/visitor-key',{method:'PUT',body:JSON.stringify({api_key:key})});
    $('#api-key').value='';await refreshSettings();$('#key-dialog').close();toast(adminMode?'工作区配置已保存。':'两个模型验证通过，已保存你的 Key。','success');
  } catch(error) { $('#key-error').textContent=error.message; }
  finally { setKeyBusy(false); }
};
$('#clear-key').onclick = async () => {
  if (keyBusy || !modelStatus?.personal) return;
  setKeyBusy(true);$('#key-error').textContent='';
  try { await api('/api/v1/settings/visitor-key',{method:'DELETE'});$('#api-key').value='';await refreshSettings();toast('已清除当前浏览器的 Key。','success'); }
  catch(error) { $('#key-error').textContent=error.message; }
  finally { setKeyBusy(false); }
};
async function initialize() {
  showView(location.hash.slice(1)||'playground');updateButton();refreshSettings();
  try { workspaceStatus=await api('/api/v1/workspace');if(!['playground','chat','search'].includes(view))renderDetail(); }
  catch { /* Workspace errors remain visible in the knowledge detail panel. */ }
}
window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
initialize();


$('#import-docs').onclick=()=>{if(busy||keyBusy){toast('请先结束当前请求');return;}$('#docs-file').click();};
$('#docs-file').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{await importDocument(file);toast('资料已临时导入，刷新后清除；相关片段将发送百炼。','success');}catch(error){toast(error.message,'error');}finally{event.target.value='';}};
$('#clear-docs').onclick=()=>{if(busy||keyBusy){toast('请先结束当前请求');return;}clearDocuments();toast('已清除导入资料，使用通用示例。','success');};
