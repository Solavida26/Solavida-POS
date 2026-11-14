const {chromium}=require('playwright');const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async r=>{const u=r.request().url();if(u.startsWith('file:'))return r.continue();if(u.includes('supabase-js'))return r.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>window.testDb}`});return r.abort();});
await page.addInitScript(()=>{
 const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
 window.mapMarkers=[];window.mapLines=[];
 window.L={map:()=>({setView(){return this;},remove(){},fitBounds(){}}),tileLayer:()=>({addTo(){}}),layerGroup:()=>({addTo(){return this;},clearLayers(){window.mapMarkers=[];window.mapLines=[];}}),divIcon:x=>x,latLngBounds:x=>x,marker:(point,options)=>{window.mapMarkers.push({point,options});return {addTo(){return this;},bindPopup(){return this;},bindTooltip(){return this;}};},polyline:points=>{window.mapLines.push(points);return {addTo(){return this;}};}};
 window.fixture={customers:[{id:'c1',full_name:'Maria Santos',area:'North',active:true,google_maps_url:'https://www.google.com/maps/search/?api=1&query=9.33%2C123.30'},{id:'c2',full_name:'Rosa Cruz',area:'South',active:true}],employees:[{id:'e1',full_name:'Owner',active:true,auth_user_id:'a1'},{id:'e2',full_name:'Driver One',active:true,auth_user_id:'a2'},{id:'e3',full_name:'Helper One',active:true,auth_user_id:null}],orders:[{id:'o1',order_no:'2026-0012',customer_id:'c1',area:'North',business_date:'2026-10-06',status:'pending',payment_status:'unpaid',order_items:[{ordered_qty:4,product:{unit:'container'}}]},{id:'o2',order_no:'2026-0013',customer_id:'c2',area:'South',business_date:d,status:'pending',payment_status:'unpaid',order_items:[{ordered_qty:6,product:{unit:'container'}}]}],delivery_locations:[],delivery_trips:[],delivery_stops:[],delivery_trip_members:[],delivery_route_events:[]};window.calls=[];window.queryCalls=[];
 const query=table=>{const obj={then:resolve=>Promise.resolve({data:window.fixture[table]||[],error:null}).then(resolve)};obj.single=async()=>({data:(window.fixture[table]||[]).find(x=>x.id===obj.id),error:null});for(const m of ['select','order','eq','gte','lte','range','in','limit','is','not'])obj[m]=(...args)=>{window.queryCalls.push([table,m,...args]);if(m==='eq'&&args[0]==='id')obj.id=args[1];return obj;};return obj;};
 window.testDb={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:query,rpc:async(n,a)=>{window.calls.push([n,a]);if(n==='complete_delivery_order_multi_v3'){await new Promise(r=>setTimeout(r,100));fixture.orders[0].status='delivered';fixture.delivery_stops[0].status='completed';return {data:null,error:null};}if(n==='delivery_can_dispatch')return {data:window.currentEmployeeRole==='owner'||!!window.testDispatcher,error:null};if(n==='delivery_customer_recency')return {data:[],error:null};return {data:null,error:null};}};
});
await page.goto('file://'+require('path').resolve(__dirname,'../index.html'));await page.evaluate(()=>{window.currentEmployeeRole='owner';window.currentEmployeeId='e1';document.getElementById('login').classList.add('hidden');document.getElementById('app').classList.remove('hidden');showTab('map');});

await page.evaluate(()=>{
 window.currentEmployeeRole='staff';window.testDispatcher=true;window.currentEmployeeId='e1';
 fixture.orders[0]={...fixture.orders[0],status:'on_the_way',ordered_amount:120,customer:{full_name:'Maria Santos'},delivery_personnel_id:'e2',order_items:[{id:'i1',ordered_qty:4,unit_price:30,product:{name:'Refill',unit:'container'}}],order_contributors:[{employee_id:'e2',contribution_type:'delivery',employee:{full_name:'Driver One'}}]};
 employees=fixture.employees;dashboard=async()=>{};
 fixture.delivery_trips=[{id:'t1',trip_no:1,status:'on_the_way',driver_id:'e2',started_at:new Date().toISOString()}];
 fixture.delivery_stops=[{id:'s1',trip_id:'t1',customer_id:'c1',order_id:'o1',position:1,status:'arrived',arrived_at:new Date().toISOString()}];
 showTab('map');
});
await page.locator('#drTripSearch').fill('Maria');assert.equal(await page.locator('[data-trip-open]').count(),1);
await page.locator('#drTripSearch').fill('missing');assert.equal(await page.locator('[data-trip-open]').count(),0);
await page.locator('#drTripSearch').fill('');await page.locator('[data-trip-open="t1"]').click();
assert.equal(await page.locator('[data-finish]').isDisabled(),true);
await page.locator('[data-order="o1"]').click();
await page.locator('.dr-order-dialog #completeDeliveryBox').waitFor();
assert.equal(await page.locator('#map').isVisible(),true);
assert.equal(await page.locator('#orders').isVisible(),false);
await page.locator('#receivedBy').fill('Maria');
await page.locator('#containersReturned').fill('3');
await page.locator('#finishDelivery').click();
await page.waitForFunction(()=>!document.querySelector('.dr-order-dialog'));
assert.equal(await page.locator('.dr-trip-dialog').isVisible(),true);
assert.equal(await page.locator('[data-finish]').isDisabled(),false);
const calls=await page.evaluate(()=>window.calls.filter(c=>c[0]==='complete_delivery_order_multi_v3'));
assert.equal(calls.length,1);assert.equal(calls[0][1].p_containers_returned,3);assert.equal(calls[0][1].p_actual_items[0].delivered_qty,4);assert.equal(calls[0][1].p_amount_received,120);
assert.equal(await page.locator('#orders #orderDetailPanel').count(),1);
// Batch print reuses the approved receipt HTML, with one popup and no business writes.
await page.evaluate(()=>{window.printed='';window.printWindows=0;window.open=()=>{printWindows++;return {document:{body:{textContent:''},open(){},write(html){window.printed=html;},close(){}},focus(){},print(){},close(){}};};});
await page.locator('[data-trip-print]').click();await page.waitForFunction(()=>window.printed.includes('Returned Containers'));
assert.equal(await page.evaluate(()=>window.printWindows),1);assert.match(await page.evaluate(()=>window.printed),/Maria Santos/);
await page.evaluate(()=>{solavidaPrintDeliveryReceipts([fixture.orders[0],{...fixture.orders[0],id:'o2',order_no:'SECOND',customer:{full_name:'Second Customer'}}]);});
assert.equal(await page.evaluate(()=>new DOMParser().parseFromString(printed,'text/html').querySelectorAll('.paper').length),2);
assert.deepEqual(errors,[]);await browser.close();console.log('PASS trip search, actual order popup, original completion RPC, panel restoration, finish gating, approved batch receipts');
})().catch(e=>{console.error(e);process.exit(1)});
