// Separate function: existing POS endpoint and financial operations are untouched.
import '../../../road-route.js';
const routing=(globalThis as any).SolavidaRoadRoute;
const site='https://solavida-pos.onrender.com';
const cors={'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==site)return reply({error:'Origin not allowed'},403);
 const authorization=req.headers.get('authorization')||'';
 if(!authorization.startsWith('Bearer '))return reply({error:'Sign in required'},401);
 const base=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
 if(!base||!anon)return reply({error:'Routing connection is not configured'},503);
 const headers={Authorization:authorization,apikey:anon,'Content-Type':'application/json'};
 try{
  const auth=await fetch(base+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return reply({error:'Sign in again'},401);
  const permission=await fetch(base+'/rest/v1/rpc/delivery_can_dispatch',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(10000)});
  if(!permission.ok||await permission.json()!==true)return reply({error:'Owner or authorized dispatcher required'},403);
  const key=Deno.env.get('GOOGLE_ROUTES_API_KEY'),embedKey=Deno.env.get('GOOGLE_MAPS_EMBED_KEY');
  // Fail closed until Owner approves billing and the administrator verifies a
  // provider-side daily quota. A per-instance memory counter is not a safe cap.
  const ready=!!key&&!!embedKey&&Deno.env.get('GOOGLE_ROUTES_ENABLED')==='true'&&Deno.env.get('GOOGLE_ROUTES_QUOTA_CONFIRMED')==='true';
  const raw=await req.text();if(raw.length>15000)return reply({error:'Request too large'},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:'Invalid request'},400);}
  if(body.action==='status')return reply({ready,embedKey:ready?embedKey:null});
  if(!ready)return reply({error:'Google road routing is awaiting account setup.'},503);
  if(body.action!=='optimize'||typeof body.roundTrip!=='boolean')return reply({error:'Invalid action'},400);
  let payload;try{payload=routing.request(body.stops,body.roundTrip);}catch(e){return reply({error:(e as Error).message},400);}
  // Exactly one upstream calculation. No automatic retry or background polling.
  const response=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key!,'X-Goog-FieldMask':'routes.optimizedIntermediateWaypointIndex,routes.duration,routes.distanceMeters'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
  if(!response.ok)return reply({error:response.status===429?'Daily routing limit reached. You can still arrange stops manually.':'Google could not calculate this route. Check the routing connection before retrying.'},response.status===429?429:502);
  return reply({...routing.result(await response.json(),body.stops.length,body.roundTrip),embedKey});
 }catch{return reply({error:'Road routing is temporarily unavailable. Your orders and saved trips are unchanged.'},502);}
});
