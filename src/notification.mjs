/** Shared, text-only notifications styled after Element Notification. */
const notices = new Map();
const types = {info:['提示','i'],success:['成功','✓'],warning:['注意','!'],error:['操作失败','×']};
export function notify(message, type = 'info') {
  if (!types[type]) type = 'info';
  const text = String(message), key = type + ':' + text;
  if (notices.has(key)) return;
  let host = document.getElementById('notification-region');
  if (!host) { host = document.createElement('div'); host.id = 'notification-region'; host.className = 'app-notifications'; document.body.append(host); }
  const card = document.createElement('section'); card.className = 'app-notification app-notification--' + type;
  card.setAttribute('role', type === 'error' ? 'alert' : 'status'); card.setAttribute('aria-atomic','true');
  const icon = document.createElement('span'); icon.className = 'app-notification-icon'; icon.textContent = types[type][1]; icon.setAttribute('aria-hidden','true');
  const group = document.createElement('div'); group.className = 'app-notification-group';
  const title = document.createElement('p'); title.className = 'app-notification-title'; title.textContent = types[type][0];
  const content = document.createElement('p'); content.className = 'app-notification-content'; content.textContent = text;
  group.append(title,content); card.append(icon,group);
  let timer;
  const dismiss = () => { clearTimeout(timer); card.remove(); notices.delete(key); if (!host.children.length) host.remove(); };
  notices.set(key,{dismiss}); host.append(card);
  timer = setTimeout(dismiss,3000);
  if (notices.size > 4) notices.values().next().value.dismiss();
}
