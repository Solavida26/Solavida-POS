const {chromium}=require('playwright');const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async r=>{const u=r.request().url();if(u.startsWith('file:'))return r.continue();if(u.includes('supabase-js'))return r.fulfill({contentType:'text/javascript',body:`window.supabase={createClient:()=>window.testDb}`});return r.abort();});
await page.addInitScript(()=>{
 const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
 window.mapMarkers=[];window.mapLines=[];
 window.L={map:()=>({setView(){return this;},remove(){},fitBounds(){}}),tileLayer:()=>({addTo(){}}),layerGroup:()=>({addTo(){return this;},clearLayers(){window.mapMarkers=[];window.mapLines=[];}}),divIcon:x=>x,latLngBounds:x=>x,marker:(point,options)=>{window.mapMarkers.push({point,options});return {addTo(){return this;},bindPopup(){return this;},bindTooltip(){return this;}};},polyline:points=>{window.mapLines.push(points);return {addTo(){return this;}};}};
 window.fixture={customers:[{id:'c1',full_name:'Maria Santos',area:'North',active:true,google_maps_url:'https://www.google.com/maps/search/?api=1&query=9.33%2C123.30'},{id:'c2',full_name:'Rosa Cruz',area:'South',active:true}],employees:[{id:'e1',full_name:'Owner',active:true,auth_user_id:'a1'},{id:'e2',full_name:'Driver One',active:true,auth_user_id:'a2'},{id:'e3',full_name:'Helper One',active:true,auth_user_id:null}],orders:[{id:'o1',order_no:'2026-0012',customer_id:'c1',area:'North',business_date:'2026-10-06',status:'pending',payment_status:'unpaid',order_items:[{ordered_qty:4,product:{unit:'container'}}]},{id:'o2',order_no:'2026-0013',customer_id:'c2',area:'South',business_date:d,status:'pending',payment_status:'unpaid',order_items:[{ordered_qty:6,product:{unit:'container'}}]}],delivery_locations:[],delivery_trips:[],delivery_stops:[],delivery_trip_members:[],delivery_route_events:[]};window.calls=[];window.queryCalls=[];
 const query=table=>{const obj={then:resolve=>Promise.resolve({data:window.fixture[table]||[],error:null}).then(resolve)};for(const m of ['select','order','eq','gte','lte','range','in','limit','is','not'])obj[m]=(...args)=>{window.queryCalls.push([table,m,...args]);return obj;};return obj;};
 window.testDb={auth:{signOut:async()=>{window.signedOut=(window.signedOut||0)+1;return {error:null};},getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:query,rpc:async(n,a)=>{window.calls.push([n,a]);if(n==='delivery_can_dispatch')return {data:window.currentEmployeeRole==='owner'||!!window.testDispatcher,error:null};if(n==='delivery_customer_recency')return {data:[],error:null};return {data:null,error:null};}};
});
await page.goto('file://'+require('path').resolve(__dirname,'../index.html'));await page.evaluate(()=>{window.currentEmployeeRole='owner';window.currentEmployeeId='e1';document.getElementById('login').classList.add('hidden');document.getElementById('app').classList.remove('hidden');showTab('map');});

for(const size of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:600},{width:390,height:844},{width:844,height:390}]){
 await page.setViewportSize(size);
 await page.evaluate(()=>{document.getElementById('employee').textContent='Cunnie Solano • owner';});
 const b=await page.locator('#logout').boundingBox();assert.ok(b&&b.x>=0&&b.y>=0&&b.y+b.height<=size.height+1);assert.ok(b.x<220);assert.ok(b.y>size.height/2);
 const main=await page.locator('#app>main').boundingBox();assert.equal(main.y,0);assert.equal(await page.locator('header.top').count(),0);
 await page.locator('#mainTabs .tabs-inner').evaluate(el=>el.scrollTop=el.scrollHeight);
 assert.ok(await page.locator('[data-tab="map"]').isVisible());
 assert.equal(await page.locator('#logout').isVisible(),true);
 if(size.width===1440){await page.screenshot({path:'/tmp/solavida-sidebar-desktop.png'});}
}
for(const role of ['owner','staff']){
 await page.evaluate(role=>{currentEmployeeRole=role;document.getElementById('employee').textContent='Sample User • '+role;document.getElementById('app').classList.remove('hidden');document.getElementById('mainTabs').classList.remove('hidden');document.getElementById('login').classList.add('hidden');document.getElementById('email').value='sample@example.com';document.getElementById('password').value='sample';},role);
 await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});
 assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#mainTabs').isVisible(),false);
 assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#password').inputValue(),'');
}
assert.equal(await page.evaluate(()=>window.signedOut),2);assert.deepEqual(errors,[]);await browser.close();console.log('PASS sidebar desktop/mobile/short-screen layout, visible bottom-left Sign Out, scrollable navigation, Owner and Staff sign-out and cleared login fields');
})().catch(e=>{console.error(e);process.exit(1)});
