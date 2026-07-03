// sync.js — Supabase → TimeTree (GitHub Actions)
const TT='https://timetreeapp.com/api/v1', UA='web/2.1.0/en', TZ='America/Cancun', MARK='[SL:';
const {TT_EMAIL,TT_PASSWORD,TT_CALENDAR_ID,SUPABASE_URL,SUPABASE_KEY}=process.env;

async function login(){
  const r=await fetch(`${TT}/auth/email/signin`,{method:'PUT',headers:{'Content-Type':'application/json','X-Timetreea':UA,'User-Agent':'Mozilla/5.0'},body:JSON.stringify({uid:TT_EMAIL,password:TT_PASSWORD,uuid:crypto.randomUUID().replaceAll('-','')})});
  if(!r.ok)throw new Error('login '+await r.text());
  const m=(r.headers.get('set-cookie')||'').match(/_session_id=([^;]+)/);
  if(!m)throw new Error('sin session_id');
  return m[1];
}
const H=s=>({'Content-Type':'application/json','X-Timetreea':UA,'User-Agent':'Mozilla/5.0','Cookie':`_session_id=${s}`});

async function getEvents(s,c){let e=[],since=0;for(let i=0;i<20;i++){const r=await fetch(`${TT}/calendar/${c}/events/sync?since=${since}`,{headers:H(s)});if(!r.ok)throw new Error('events '+r.status);const j=await r.json();e=e.concat(j.events||[]);if(!j.chunk)break;since=j.since;}return e;}
const create=(s,c,ev)=>fetch(`${TT}/calendar/${c}/event`,{method:'POST',headers:H(s),body:JSON.stringify(ev)});
const del=(s,c,id)=>fetch(`${TT}/calendar/${c}/event/${id}`,{method:'DELETE',headers:H(s)});

function build(r){
  const d=r.reservation_date;let s,e,ad;
  if(r.departure_time){s=new Date(`${d}T${r.departure_time}-05:00`).getTime();e=s+(parseFloat(r.hours)||4)*36e5;ad=false;}
  else{s=new Date(`${d}T00:00:00Z`).getTime();e=s;ad=true;}
  const ca=r.client_type==='uvc'?'Living UVC':r.client_type==='fives'?'Living FIVES':r.client_type==='directo'?'Directo':'Living';
  return{title:`⚓ ${r.yacht} · ${r.hours||'?'}h · ${ca}`,category:1,all_day:ad,start_at:s,start_timezone:TZ,end_at:e,end_timezone:TZ,label_id:1,note:`${MARK}${r.id}]${r.notes?' '+r.notes:''}`,location:'',url:'',attendees:[],alerts:ad?[]:[60]};
}

(async()=>{
  const today=new Date().toISOString().slice(0,10);
  const sb=await fetch(`${SUPABASE_URL}/rest/v1/reservations?reservation_date=gte.${today}&status=neq.cancelada&select=id,yacht,reservation_date,departure_time,hours,client_type,notes,pre_reserva,pre_reserva_expires`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});
  if(!sb.ok)throw new Error('supabase '+sb.status);
  const now=Date.now();
  const res=(await sb.json()).filter(r=>!r.pre_reserva||(r.pre_reserva_expires&&new Date(r.pre_reserva_expires).getTime()>now));
  const s=await login(),ev=await getEvents(s,TT_CALENDAR_ID);
  const ex={};for(const e of ev){if(e.deactivated_at)continue;const m=(e.note||'').match(/\[SL:([0-9a-f-]+)\]/);if(m)ex[m[1]]=e;}
  let c=0,dl=0;const err=[];
  for(const r of res){if(ex[r.id])continue;const x=await create(s,TT_CALENDAR_ID,build(r));x.ok?c++:err.push(r.id+' '+await x.text());}
  const act=new Set(res.map(r=>r.id));
  for(const[id,e]of Object.entries(ex)){if(act.has(id))continue;const x=await del(s,TT_CALENDAR_ID,e.id||e.uuid);x.ok?dl++:err.push('del'+id);}
  console.log(JSON.stringify({created:c,deleted:dl,errors:err}));
  if(err.length)process.exit(1);
})().catch(e=>{console.error(e.message);process.exit(1);});
