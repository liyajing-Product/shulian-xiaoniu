import MarkdownIt from 'markdown-it';

// Model output is untrusted: raw HTML stays text, images never auto-load.
const md = new MarkdownIt({html:false,breaks:true,linkify:false,typographer:false});
md.renderer.rules.image = (tokens,index) => md.utils.escapeHtml(tokens[index].content);
const defaultLink = md.renderer.rules.link_open || ((tokens,index,options,env,self) => self.renderToken(tokens,index,options));
md.renderer.rules.link_open = (tokens,index,options,env,self) => {
  tokens[index].attrSet('target','_blank');
  tokens[index].attrSet('rel','noopener noreferrer');
  return defaultLink(tokens,index,options,env,self);
};
const rendered = new WeakMap();
export function answerHTML(text) { return md.render(String(text || '')); }

/** Update answer blocks while preserving the separate progress animation nodes. */
export function renderAnswer(host,text) {
  const html = answerHTML(text);
  if (rendered.get(host) === html) return;
  rendered.set(host,html);
  const template = document.createElement('template'); template.innerHTML = html;
  let current = host.firstChild;
  for (const node of [...template.content.childNodes]) {
    if (current?.isEqualNode(node)) { current=current.nextSibling; continue; }
    if (current) { const next=current.nextSibling; current.replaceWith(node); current=next; }
    else host.append(node);
  }
  while (current) { const next=current.nextSibling; current.remove(); current=next; }
}
