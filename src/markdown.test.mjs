import {test} from 'node:test';
import assert from 'node:assert/strict';
import {answerHTML} from './markdown.mjs';

test('answers render headings, numbered points and emphasis as one document', () => {
  const html = answerHTML('先给结论。\n\n### 一、排查信息\n\n1. **发生时间**：记录时间。\n2. **错误提示**：保留原文。');
  assert.match(html, /<p>先给结论。<\/p>/);
  assert.match(html, /<h3>一、排查信息<\/h3>/);
  assert.match(html, /<ol>/); assert.match(html, /<strong>发生时间<\/strong>/);
  assert.doesNotMatch(html, /class=.*card/);
});
test('short answers remain a paragraph without an imposed outline', () => {
  assert.equal(answerHTML('请补充报错提示。'), '<p>请补充报错提示。</p>\n');
});
test('raw HTML and dangerous links cannot become executable markup', () => {
  const html = answerHTML('<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[点我](javascript:alert(1))\n[数据](data:text/html,test)');
  assert.doesNotMatch(html, /<img|<script|href="(?:javascript|data):/i);
  assert.match(html, /&lt;img/);
});
test('remote model images do not load and ordinary links open safely', () => {
  const html = answerHTML('![示意图](https://example.com/tracker.png)\n[参考](https://example.com/help)');
  assert.doesNotMatch(html, /<img|src=/);
  assert.match(html, /示意图/); assert.match(html, /rel="noopener noreferrer"/);
});
test('code whitespace is preserved and unfinished stream fragments remain safe', () => {
  assert.match(answerHTML('```text\na\n\nb\n```'), /a\n\nb/);
  for (const fragment of ['### 标','**关键','1. 字段','[链接](','```js\nconst x = 1']) assert.doesNotThrow(() => answerHTML(fragment));
});
