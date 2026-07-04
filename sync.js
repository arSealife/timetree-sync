// sync.js — Supabase → TimeTree (GitHub Actions)
const TT='https://timetreeapp.com/api/v1', UA='web/2.1.0/en', TZ='America/Cancun', MARK='[SL:';
const {TT_EMAIL,TT_PASSWORD,TT_CALENDAR_ID,SUPABASE_URL,SUPABASE_KEY}=process.env;

async function login(){
  const r=await fetch(`${TT}/auth/email/signin`,{method:'PUT',headers:{'Content-Type':'application/json','X-Timetreea':UA,'User-Agent':'Mozilla/5.0'},body:JSON.stringify({uid:TT_EMAIL,password:TT_PASSWORD,uuid:crypto.randomUUID().replaceAll('-','')})});
  if(!r.ok)throw new Error('login '+await r.text());
  const m=(r.headers.get('set-cookie')||'').match(/_session_id=([^;]+)/);
  if(!m)throw new Error('sin session_id');
  const sid=m[1];const j=await r.json();const uid=j.user&&j.user.id;
  // csrf desde el HTML de la app
  const h=await fetch('https://timetreeapp.com/',{headers:{'Cookie':`_session_id=${sid}`,'User-Agent':'Mozilla/5.0'}});
  const html=await h.text();
  const cm=html.match(/name="csrf-token"\s+content="([^"]+)"/)||html.match(/content="([^"]+)"\s+name="csrf-token"/);
  return {sid, csrf:cm?cm[1]:null, uid};
}
const H=(s,csrf)=>{const h={'Content-Type':'application/json','X-Timetreea':UA,'User-Agent':'Mozilla/5.0','Cookie':`_session_id=${s}`,'Origin':'https://timetreeapp.com'};if(csrf)h['X-CSRF-Token']=csrf;return h;};

async function getEvents(s,c,csrf){let e=[],since=0;for(let i=0;i<20;i++){const r=await fetch(`${TT}/calendar/${c}/events/sync?since=${since}`,{headers:H(s,csrf)});if(!r.ok)throw new Error('events '+r.status);const j=await r.json();e=e.concat(j.events||[]);if(!j.chunk)break;since=j.since;}return e;}
const create=(s,c,ev,csrf)=>fetch(`${TT}/calendar/${c}/event`,{method:'POST',headers:H(s,csrf),body:JSON.stringify(ev)});
const del=(s,c,id,csrf)=>fetch(`${TT}/calendar/${c}/event/${id}`,{method:'DELETE',headers:H(s,csrf)});

function build(r,uid){
  const d=r.reservation_date;let s,e,ad;
  if(r.departure_time){s=new Date(`${d}T${r.departure_time}-05:00`).getTime();e=s+(parseFloat(r.hours)||4)*36e5;ad=false;}
  else{s=new Date(`${d}T00:00:00Z`).getTime();e=s;ad=true;}
  const ca=r.client_type==='uvc'?'Living UVC':r.client_type==='fives'?'Living FIVES':r.client_type==='directo'?'Directo':'Living';
  return{title:`⚓ ${r.yacht} · ${r.hours||'?'}h · ${ca}`,all_day:ad,start_at:s,start_timezone:ad?'UTC':TZ,end_at:e,end_timezone:ad?'UTC':TZ,label_id:1,note:`${MARK}${r.id}]${r.notes?' '+r.notes:''}`,location:'',attendees:uid?[uid]:[],recurrences:[],alerts:[],attachment:{virtual_user_attendees:[]},category:1};
}

(async()=>{
  const today=new Date().toISOString().slice(0,10);
  const sb=await fetch(`${SUPABASE_URL}/rest/v1/reservations?reservation_date=gte.${today}&status=neq.cancelada&select=id,yacht,reservation_date,departure_time,hours,client_type,notes,pre_reserva,pre_reserva_expires`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});
  if(!sb.ok)throw new Error('supabase '+sb.status);
  const now=Date.now();
  const res=(await sb.json()).filter(r=>!r.pre_reserva||(r.pre_reserva_expires&&new Date(r.pre_reserva_expires).getTime()>now));
  const {sid,csrf,uid}=await login();
  console.log('csrf:',csrf?csrf.slice(0,10)+'...':'NULL','uid:',uid);
  const ev=await getEvents(sid,TT_CALENDAR_ID,csrf);
  const ex={};for(const e of ev){if(e.deactivated_at)continue;const m=(e.note||'').match(/\[SL:([0-9a-f-]+)\]/);if(m)ex[m[1]]=e;}
  let c=0,dl=0;const err=[];
  for(const r of res){if(ex[r.id])continue;const x=await create(sid,TT_CALENDAR_ID,build(r,uid),csrf);if(x.ok){c++;}else{console.log('CREATE FAIL',x.status,await x.text());break;}}
  const act=new Set(res.map(r=>r.id));
  for(const[id,e]of Object.entries(ex)){if(act.has(id))continue;const x=await del(sid,TT_CALENDAR_ID,e.id||e.uuid,csrf);x.ok?dl++:err.push('del'+id);}
  console.log(JSON.stringify({created:c,deleted:dl,errors:err}));
  if(err.length)process.exit(1);
})().catch(e=>{console.error(e.message);process.exit(1);});
