import { useEffect, useState } from 'react';
import { api, errorText, type Asset, type MaintenanceStatus } from './api';

const ISSUE_TEXT: Record<string, string> = {
  source_moved: '源照片路径已变更', source_missing: '源照片已不可用', upstream_unavailable: '暂时无法连接 Immich',
  output_missing: '成品文件缺失', output_changed: '成品被外部修改', source_or_resource_unavailable: '源照片或资源缺失',
};

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'range', 'button', 'color', 'file'].includes(type);
}

export function Login({ initialized, mode, onDone }: { initialized: boolean; mode: 'loading' | 'ready' | 'error'; onDone: (init: boolean) => void }) {
  const [key, setKey] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(mode === 'error' ? '登录服务暂时不可用，请刷新重试。' : '');
  const submit = (path: string, body: unknown, init: boolean) => { setBusy(true); setMessage(''); api(path, 'POST', body).then(() => onDone(init)).catch(e => setMessage(errorText(e))).finally(() => setBusy(false)); };
  return <main className="login">
    <h1>KARI IMPRINT</h1><p className="login-sub">为 Immich 照片加上摄影信息边框</p>
    {mode === 'loading' ? <p className="hint">正在检查登录状态…</p> : mode === 'ready' && initialized
      ? <form onSubmit={e => { e.preventDefault(); submit('/auth/immich-login', { email, password }, false); }}>
        <label>Immich 邮箱<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Immich 密码<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        <button className="primary" disabled={busy || !email || !password}>{busy ? '正在登录…' : '登录'}</button>
        <p className="hint">使用与面板关联的同一个 Immich 账户。</p>
      </form>
      : mode === 'ready' ? <form onSubmit={e => { e.preventDefault(); submit('/init', { key }, true); }}>
        <p className="hint">首次使用：输入 Immich API Key 完成关联。之后用 Immich 账户密码登录。</p>
        <label>Immich API Key<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" autoFocus /></label>
        <button className="primary" disabled={busy || !key}>{busy ? '正在关联…' : '关联并进入'}</button>
      </form> : null}
    <p role="alert" className="login-alert">{message}</p>
  </main>;
}

export function Maintenance({ assets }: { assets: Asset[] }) {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null), [backup, setBackup] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const refresh = () => api<MaintenanceStatus>('/maintenance').then(setStatus).catch(() => {}); void refresh(); const timer = setInterval(refresh, 60000); return () => clearInterval(timer); }, []);
  const low = status ? status.freeBytes < status.minimumFreeBytes : false;
  const count = (status?.issues.length ?? 0) + (low ? 1 : 0);
  return <details className="menu">
    <summary className={count ? 'warn' : ''}>系统{count ? ` · ${count}` : ''}</summary>
    <div className="menu-card">
      {status ? <>
        <p>可用空间 {(status.freeBytes / 1024 ** 3).toFixed(1)} GB</p>
        {low && <p className="bad">可用空间不足，暂不能生成或上传资源。</p>}
        {status.issues.length > 0 && <p className="bad">发现源照片、成品或资源异常，相关文件已保留。</p>}
        {status.issues.map(issue => <p key={issue.assetId}>{assets.find(a => a.id === issue.assetId)?.name || issue.assetId.slice(0, 8)} — {ISSUE_TEXT[issue.issue] || '需要检查'}</p>)}
      </> : <p>正在读取维护状态…</p>}
      <button type="button" disabled={busy} onClick={() => { setBusy(true); setBackup('正在备份配置和资源…'); api<{ backupId: string }>('/maintenance/backup', 'POST').then(r => setBackup(`备份已保存：${r.backupId}`)).catch(() => setBackup('备份失败，请检查可用空间。')).finally(() => setBusy(false)); }}>备份配置与资源</button>
      {backup && <p role="status">{backup}</p>}
      <p className="hint">原照片只读；成品写入独立的 Imprint 相册。Immich 若显示旧图，刷新页面即可。</p>
    </div>
  </details>;
}

