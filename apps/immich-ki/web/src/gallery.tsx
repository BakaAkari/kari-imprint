import {useCallback,useEffect,useRef,useState} from 'react';
import {api,type Asset} from './api';
export function useGallery(logged:boolean,album:string){
 const [assets,setAssets]=useState<Asset[]>([]),[state,setState]=useState<'loading'|'ready'|'error'>('ready'),[error,setError]=useState(''),[next,setNext]=useState<string|null>(null);
 const control=useRef<AbortController|null>(null),loading=useRef(false),cursor=useRef<string|null>('1'),seen=useRef(new Set<string>());
 const load=useCallback(async()=>{const owner=control.current,page=cursor.current;if(!owner||owner.signal.aborted||loading.current||!page)return;loading.current=true;setState('loading');setError('');try{
 const data=await api<{items:Asset[];nextPage:string|null}>(`/assets?page=${encodeURIComponent(page)}&album=${encodeURIComponent(album)}`,'GET',undefined,owner.signal);
 if(owner!==control.current||owner.signal.aborted)return;seen.current.add(page);setAssets(old=>Array.from(new Map([...old,...data.items].map(a=>[a.id,a])).values()));const following=data.nextPage&&!seen.current.has(String(data.nextPage))?String(data.nextPage):null;cursor.current=following;setNext(following);setState('ready');
 }catch(e){if(owner===control.current&&!owner.signal.aborted){setError(String(e));setState('error');}}finally{if(owner===control.current)loading.current=false;}},[album]);
 useEffect(()=>{control.current?.abort();control.current=new AbortController();loading.current=false;setAssets([]);setError('');seen.current.clear();cursor.current='1';setNext(null);if(logged&&album)void load();else setState('ready');return()=>control.current?.abort();},[logged,album,load]);
 return {assets,state,error,next,load,setAssets};
}
export function Gallery({assets,loading,error,next,onMore,onSelect,selectedAlbum}:{assets:Asset[];loading:boolean;error:string;next:string|null;onMore:()=>void;onSelect:(a:Asset)=>void;selectedAlbum:boolean}){
 const sentinel=useRef<HTMLDivElement>(null);
 useEffect(()=>{const element=sentinel.current;if(!element||loading||error||!next)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))onMore();},{root:element.closest('.gallery-scroll'),rootMargin:'500px'});observer.observe(element);return()=>observer.disconnect();},[loading,error,next,onMore,assets.length]);
  const badge = (a:Asset) => {
    if (!a.status) return null;
    const {configured, job, published} = a.status;
    const label = published ? '有成品'
      : (job && ['queued','running','publishing','awaiting_import','refresh_pending'].includes(job)) ? '处理中'
      : job === 'failed' ? '处理失败'
      : configured ? '有草稿' : '未制作';
    const tone = published ? 'done' : job === 'failed' ? 'bad' : (job && ['queued','running','publishing'].includes(job)) ? 'busy' : 'saved';
    return <span className={`asset-badge ${tone}`}>{label}</span>;
  };
  return <><div className="photo-masonry">{assets.map(a=><button key={a.id} className="photo-tile" aria-label={a.name} onClick={()=>onSelect(a)}><img src={`/api/assets/${a.id}/thumbnail`} alt="" loading="lazy" decoding="async" style={a.width&&a.height?{aspectRatio:`${a.width}/${a.height}`}:undefined}/><span className="photo-caption">{a.name}</span>{badge(a)}</button>)}</div><div ref={sentinel} className="gallery-sentinel" role="status">{!selectedAlbum?'从左侧选择相册':loading?'正在加载照片…':!assets.length&&!error?'此相册在当前源库中没有可用照片':!next&&!error?'已显示全部可用照片':''}{error&&<><p role="alert">{error}</p><button onClick={onMore}>重新加载</button></>}</div></>;
}
