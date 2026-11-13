/** Parse arbitrary SSE network boundaries and require an explicit terminal event. */
export async function consumeSSE(response, onEvent) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || '请求失败，请重试');
  }
  if (!response.body) throw new Error('浏览器不支持流式响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', terminal = false;
  const parse = block => {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (terminal) throw new Error('响应结束后收到额外消息');
    const event = JSON.parse(data);
    if (event.event === 'error') throw new Error(event.data?.error?.message || '生成失败，请重试');
    if (!['status', 'chunk', 'done'].includes(event.event)) throw new Error('收到无法识别的响应');
    if (event.event === 'status' && (!['retrieving','preparing'].includes(event.data?.stage) || (event.data.stage === 'preparing' && typeof event.data.hit !== 'boolean'))) throw new Error('处理状态格式错误');
    if (event.event === 'done') terminal = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let split;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        parse(buffer.slice(0, split)); buffer = buffer.slice(split + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) parse(buffer);
    if (!terminal) throw new Error('连接已中断，可重新发送问题');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function loadConversation(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem('shulian-public-conversation') || 'null');
    if (!value || !Array.isArray(value.messages) || !value.sessionId || now - value.updatedAt > 7 * 86400000) return null;
    value.messages = value.messages.filter(m => now - (m.createdAt || value.updatedAt) <= 7 * 86400000);
    return value;
  } catch { return null; }
}


/** Display only observed public operations; never prompts or private reasoning. */
export const PROGRESS_DETAIL_DELAY = 1800;
export const LONG_ANSWER_LENGTH = 400;
const publicOperations = {retrieving:'查找相关信息',preparing:'整理可用信息',generating:'生成回答'};
export function publicProcess(item) {
  return [...new Set(item.publicStages || [])].filter(stage => Object.hasOwn(publicOperations, stage)).map(stage => publicOperations[stage]);
}
export function workflowStatus(item) {
  if (!item.stage) return null;
  if (item.status === 'error') return {active:false,expanded:false,text:'处理未完成'};
  if (item.status === 'cancelled') return {active:false,expanded:false,text:'处理已停止'};
  if (!['pending','streaming'].includes(item.status)) return null;
  const text = item.status === 'streaming' ? '正在生成回答…' :
    {requesting:'正在提交问题…',retrieving:'正在查找相关信息…',preparing:'正在整理信息…'}[item.stage] || '正在处理…';
  return {active:true,expanded:Boolean(item.progressExpanded || (item.text || '').length >= LONG_ANSWER_LENGTH),text};
}

/** Compact prose spacing while retaining whitespace inside fenced code blocks. */
export function compactAnswerText(text) {
  return text.split(/(```[\s\S]*?(?:```|$))/g).map(part => part.startsWith('```') ? part : part.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g,'\n')).join('');
}


/** Coalesce network bursts into a frame, with cancellation before final rendering. */
export function createFrameScheduler(update, requestFrame, cancelFrame) {
  let frame = null, latest;
  return {
    schedule(value) {
      latest = value;
      if (frame !== null) return;
      frame = requestFrame(() => { frame = null; const value = latest; latest = undefined; update(value); });
    },
    cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null; latest = undefined;
    },
  };
}


/** Remove legacy inventory commentary, preserving actual answer/uncertainty. */
export function customerAnswer(text, pending = false) {
  const raw = String(text || '');
  const inventory = /(?:知识库|知识文档|(?:现有|当前|参考|检索到的)(?:文档|资料)|(?:文档|资料)[中里内])[^。！？\n]{0,24}(?:没有|暂无|未(?:明确)?(?:说明|提供|收录|记载|包含|涉及|涵盖|覆盖|命中|检索到)|不(?:含|包含|涉及)|缺少)/;
  // Preserve line breaks rather than inserting breaks inside normal prose.
  const segments = raw.match(/[^。！？\n]+[。！？]?|\n/g) || [];
  const result = segments.map((part,index) => {
    if (inventory.test(part.trim())) return /尚待核实|无法准确|无法可靠|以正式确认结果为准/.test(part) ? '相关信息尚待核实，请以正式确认结果为准。' : '';
    if (pending && index === segments.length - 1 && !/[。！？\n]$/.test(part) && /知识库|知识文档|文档|资料/.test(part)) return '';
    return part;
  }).join('').replace(/\n{3,}/g,'\n\n').trim();
  if (result || !raw.trim() || pending) return result;
  return '这方面我暂时无法准确判断。请补充您关注的具体问题，我会进一步协助您。';
}
