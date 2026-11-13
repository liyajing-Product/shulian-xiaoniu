import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeSSE, loadConversation, createFrameScheduler, customerAnswer } from './lib.mjs';
function response(parts) { return new Response(new ReadableStream({start(controller){for(const part of parts)controller.enqueue(new TextEncoder().encode(part));controller.close();}})); }
test('SSE preserves split JSON and Chinese text across chunks',async()=>{
  const events=[];await consumeSSE(response(['data: {"event":"chu','nk","data":"你"}\n\n','data: {"event":"done","data":{}}\n\n']),event=>events.push(event));
  assert.equal(events[0].data,'你');assert.equal(events[1].event,'done');
});
test('SSE rejects a stream ending without done',async()=>{
  await assert.rejects(()=>consumeSSE(response(['data: {"event":"chunk","data":"a"}\n\n']),()=>{}),/连接已中断/);
});
test('SSE error message reaches caller',async()=>{
  await assert.rejects(()=>consumeSSE(response(['data: {"event":"error","data":{"error":{"message":"模型不可用"}}}\n\n']),()=>{}),/模型不可用/);
});
test('HTTP failure uses structured error',async()=>{
  await assert.rejects(()=>consumeSSE(new Response('{"error":{"message":"请检查配置"}}',{status:503}),()=>{}),/请检查配置/);
});
test('conversation retention expires after seven days',()=>{
  const storage={getItem:()=>JSON.stringify({sessionId:'s',messages:[],updatedAt:1})};
  assert.equal(loadConversation(storage,8*86400000),null);
});
test('malformed local storage does not prevent startup',()=>{
  assert.equal(loadConversation({getItem:()=>'{broken'}),null);
});

test('active conversation removes expired individual messages',()=>{
  const now=10*86400000;
  const storage={getItem:()=>JSON.stringify({sessionId:'s',updatedAt:now,messages:[{text:'old',createdAt:1},{text:'new',createdAt:now}]})};
  assert.deepEqual(loadConversation(storage,now).messages.map(m=>m.text),['new']);
});

test('progress events do not terminate SSE or alter answer chunks',async()=>{
  const events=[];
  await consumeSSE(response(['data: {"event":"status","data":{"stage":"retrieving"}}\n\n','data: {"event":"status","data":{"stage":"preparing","hit":false}}\n\n','data: {"event":"chunk","data":"请补充问题"}\n\n','data: {"event":"done","data":{}}\n\n']),e=>events.push(e));
  assert.deepEqual(events.map(e=>e.event),['status','status','chunk','done']);
});
test('progress without a terminal event still fails',async()=>{
  await assert.rejects(()=>consumeSSE(response(['data: {"event":"status","data":{"stage":"retrieving"}}\n\n']),()=>{}),/连接已中断/);
});
test('public workflow hides internal hit state and completed status bars',async()=>{
  const {workflowStatus}=await import('./lib.mjs');
  assert.equal(workflowStatus({stage:'preparing',hit:false,status:'pending'}).text, '正在整理信息…');
  assert.equal(workflowStatus({stage:'preparing',hit:true,status:'pending'}).text, '正在整理信息…');
  assert.equal(workflowStatus({stage:'preparing',hit:true,status:'succeeded'}), null);
  assert.equal(workflowStatus({stage:'retrieving',status:'error'}).active,false);
  assert.match(workflowStatus({stage:'retrieving',status:'cancelled'}).text,/停止/);
});


test('stream bursts paint once per frame and preserve the latest text', () => {
  const callbacks = new Map(), painted = []; let serial = 0;
  const scheduler = createFrameScheduler(value => painted.push(value.text),
    callback => { const id = serial++; callbacks.set(id, callback); return id; },
    id => callbacks.delete(id));
  const item = {text:''};
  for (const chunk of ['正','在','整','理','回','答']) { item.text += chunk; scheduler.schedule(item); }
  assert.equal(callbacks.size, 1);
  const callback = callbacks.get(0); callbacks.delete(0); callback();
  assert.deepEqual(painted, ['正在整理回答']);
  item.text += '。'; scheduler.schedule(item); callbacks.get(1)();
  assert.deepEqual(painted, ['正在整理回答', '正在整理回答。']);
});
test('completion cancels a queued frame without blocking the next request', () => {
  const callbacks = new Map(), painted = []; let serial = 0;
  const scheduler = createFrameScheduler(value => painted.push(value),
    callback => { const id = serial++; callbacks.set(id, callback); return id; },
    id => callbacks.delete(id));
  scheduler.schedule('old stream'); scheduler.cancel();
  assert.equal(callbacks.size, 0); assert.deepEqual(painted, []);
  scheduler.schedule('next request'); callbacks.get(1)();
  assert.deepEqual(painted, ['next request']);
});


test('legacy inventory sentence is hidden while useful reply and uncertainty remain', () => {
  const raw = '知识库中没有关于公司评价的相关内容，也未提供管理层背景。\n\n我无法对公司或个人作出可靠评价。\n公司聚焦大宗商品供应链数字化。';
  const shown = customerAnswer(raw);
  assert.doesNotMatch(shown, /知识库|管理层背景/);
  assert.match(shown, /无法对公司或个人作出可靠评价/);
  assert.match(shown, /公司聚焦大宗商品供应链数字化/);
});
test('inventory-only replies retain an honest clarification rather than an empty answer', () => {
  assert.match(customerAnswer('当前知识库未提供合作流程。'), /暂时无法准确判断/);
  assert.equal(customerAnswer('当前知识库未提供合作流程', true), '');
});
test('business facts and document maintenance instructions are preserved', () => {
  const text = '请检查知识库连接。\n价格尚待核实，不承诺上线时间。\n请上传文档后重试。';
  assert.equal(customerAnswer(text), text);
});

test('inventory commentary is hidden even when the sentence starts with its topic', () => {
  const shown = customerAnswer('我无法对个人作出可靠评价。\n关于管理层背景，当前知识库未收录，也不在客服范围内。请说明关注点。');
  assert.equal(shown, '我无法对个人作出可靠评价。\n请说明关注点。');
  assert.equal(customerAnswer('我无法作出评价。关于背景，当前知识库', true), '我无法作出评价。');
});

test('missing user-provided business documents remain actionable and visible', () => {
  const text = '您的申请资料缺少营业执照，请补充后提交。订单资料没有盖章，请核对。';
  assert.equal(customerAnswer(text), text);
});

test('short requests stay compact and long processing can reveal public steps', async () => {
  const {workflowStatus,publicProcess,LONG_ANSWER_LENGTH} = await import('./lib.mjs');
  assert.equal(workflowStatus({stage:'retrieving',status:'pending'}).expanded,false);
  assert.equal(workflowStatus({stage:'preparing',status:'pending',progressExpanded:true}).expanded,true);
  assert.equal(workflowStatus({stage:'preparing',status:'streaming',text:'文'.repeat(LONG_ANSWER_LENGTH)}).expanded,true);
  assert.deepEqual(publicProcess({publicStages:['retrieving','system_prompt','retrieving','preparing','generating','secret']}),['查找相关信息','整理可用信息','生成回答']);
  assert.deepEqual(publicProcess({}),[]);
});
test('paragraph spacing compacts without damaging code or list line breaks', async () => {
  const {compactAnswerText} = await import('./lib.mjs');
  assert.equal(compactAnswerText('第一段。\n\n第二段。\n\n- 一\n- 二'),'第一段。\n第二段。\n- 一\n- 二');
  assert.equal(compactAnswerText('说明\n\n```text\na\n\nb\n```\n\n结尾'),'说明\n```text\na\n\nb\n```\n结尾');
});

test('internal explanation inside a caution keeps the user-facing uncertainty', () => {
  const text='> 注：以下信息尚待核实，请以正式确认结果为准——当前知识库未明确说明具体提交入口。';
  assert.equal(customerAnswer(text),'相关信息尚待核实，请以正式确认结果为准。');
});
