/* Solavida Sales & Collections: read-only reporting, no database writes. */
(function(root){
 'use strict';
 const cents=x=>Math.round(Number(x||0)*100);
 const day=v=>!v?'':(/^\d{4}-\d{2}-\d{2}$/.test(String(v))?String(v):new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)));
 const completed=o=>o.status==='delivered'||String(o.channel||'').includes('walk')&&['completed','paid'].includes(o.status);
 const saleDay=o=>day(o.business_date||o.delivered_at||o.created_at);
 const unique=rows=>[...new Map(rows.map(x=>[x.id,x])).values()];
 function build({orders=[],payments=[],collections=[],charges=[],from,to}){
  const within=d=>d>=from&&d<=to;
  const orderMap=new Map(unique(orders).map(o=>[o.id,o]));
  const done=[...orderMap.values()].filter(completed);
  const sales=done.filter(o=>within(saleDay(o)));
  const areas=new Map(['Walk-in','North','South','Central'].map(name=>[name,{name,sales:0,tc:0}]));
  for(const o of sales){
   const raw=String(o.area||o.customer?.area||'Unassigned').trim();
   const name=String(o.channel||'').includes('walk')?'Walk-in':(['North','South','Central'].find(a=>a.toLowerCase()===raw.toLowerCase())||raw||'Unassigned');
   if(!areas.has(name))areas.set(name,{name,sales:0,tc:0});
   const a=areas.get(name);a.sales+=cents(o.actual_amount);a.tc+=Number(o.actual_qty||0);
  }
  const methods={cash:0,gcash:0,bank_transfer:0,other:0};
  const receipts=[];
  const add=(record,type,date)=>{
   const method=Object.hasOwn(methods,record.payment_method)?record.payment_method:'other';
   methods[method]+=cents(record.amount);receipts.push({...record,type,date});
  };
  for(const p of unique(payments)){
   const o=orderMap.get(p.order_id),d=day(p.received_at);
   if(o&&completed(o)&&within(d))add(p,'Sale payment',d);
  }
  const activeCollections=unique(collections).filter(c=>!c.cancelled_at);
  for(const c of activeCollections){const d=day(c.business_date||c.collected_at);if(within(d))add(c,'Credit collection',d);}
  // Collections are account-level. Age the remaining balance oldest-charge-first,
  // separately for each account; never offset one customer's debt with another's.
  const paid=new Map();
  for(const c of activeCollections){const d=day(c.business_date||c.collected_at);if(d&&d<=to)paid.set(c.credit_account_id,(paid.get(c.credit_account_id)||0)+cents(c.amount));}
  const aged=unique(charges).map(c=>{
   const o=orderMap.get(c.order_id);
   return {...c,date:o?saleDay(o):day(c.posted_at),valid:!c.order_id||!!o&&completed(o)};
  }).filter(c=>c.valid&&c.date&&c.date<=to).sort((a,b)=>a.date.localeCompare(b.date)||String(a.posted_at||'').localeCompare(String(b.posted_at||''))||String(a.id).localeCompare(String(b.id)));
  let current=0,previous=0;
  const outstanding=[];
  for(const c of aged){
   const available=Math.max(0,paid.get(c.credit_account_id)||0),amount=Math.max(0,cents(c.amount)),used=Math.min(available,amount),balance=amount-used;
   paid.set(c.credit_account_id,available-used);
   if(c.date>=from)current+=balance;else previous+=balance;
   if(balance)outstanding.push({...c,balance});
  }
  return {from,to,sales:sales.reduce((s,o)=>s+cents(o.actual_amount),0),tc:sales.reduce((s,o)=>s+Number(o.actual_qty||0),0),areas:[...areas.values()],methods,payments:Object.values(methods).reduce((a,b)=>a+b,0),current,previous,credit:current+previous,receipts,outstanding};
 }
 const api={build,day,saleDay};
 if(typeof module!=='undefined')module.exports=api;
 if(!root.document)return;
 root.SolavidaSales=api;
 root.r94SalesData=null;
 const money=c=>r85Money(c/100),count=n=>Number(n).toLocaleString('en-PH');
 const note=s=>'Sales and TC: completed deliveries and walk-in sales, '+s.from+' to '+s.to+'. Payments: money received in that period, including credit collections. Collectibles: unpaid through '+s.to+'; Current = charges in the selected period; Previous = all earlier charges. Collections reduce the oldest charges first within each customer account.';
 const table=(headers,rows)=>'<table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map((r,i)=>'<tr'+(i===rows.length-1?' class="s94-total"':'')+'>'+r.map(x=>'<td>'+esc(String(x))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 const valid=()=>root.r94SalesData&&root.r94SalesData.from===$('r85From').value&&root.r94SalesData.to===$('r85To').value;
 root.r94RenderSales=function(){
  r85ManageRender();r85Headers=[];r85Rows=[];
  if(!valid()){$('r85Kpis').innerHTML='';$('r85Table').innerHTML='';r85Warn('Choose dates and click Search or Refresh to load Sales & Collections.');return;}
  const s=root.r94SalesData;r85Warn('');
  $('r85Kpis').innerHTML='<section class="s94-card"><h2>Sales Summary</h2><dl><div><dt>Total Sales</dt><dd>'+money(s.sales)+'</dd></div><div><dt>Total TC</dt><dd>'+count(s.tc)+'</dd></div></dl><p class="muted">TC = containers delivered and sold walk-in.</p><h3>Per Area</h3>'+table(['Area','Sales','TC'],[...s.areas.map(a=>[a.name,money(a.sales),count(a.tc)]),['Total',money(s.sales),count(s.tc)]])+'</section>';
  const payments=[['Cash',money(s.methods.cash)],['GCash',money(s.methods.gcash)],['Bank Transfer',money(s.methods.bank_transfer)]];
  if(s.methods.other!==0)payments.push(['Other / Unspecified',money(s.methods.other)]);
  payments.push(['Total',money(s.payments)]);
  $('r85Table').innerHTML='<section class="s94-card"><h2>Payments</h2><p class="muted">All payments received from sales and collections.</p>'+table(['Method','Amount'],payments)+'</section><section class="s94-card"><h2>Collectibles</h2><p class="muted">Still unpaid as of '+esc(s.to)+'.</p>'+table(['Period','Amount'],[['Current',money(s.current)],['Previous',money(s.previous)],['Total',money(s.credit)]])+'</section><p class="s94-note">'+esc(note(s))+'</p>';
 };
 function rows(s){
  const r=[['Solavida — Sales & Collections'],['From',s.from,'To',s.to],[],['Sales Summary'],['Total Sales',s.sales/100],['Total TC',s.tc],[],['Per Area','Sales','TC'],...s.areas.map(a=>[a.name,a.sales/100,a.tc]),['Total',s.sales/100,s.tc],[],['Payments','Amount'],['Cash',s.methods.cash/100],['GCash',s.methods.gcash/100],['Bank Transfer',s.methods.bank_transfer/100]];
  if(s.methods.other!==0)r.push(['Other / Unspecified',s.methods.other/100]);
  r.push(['Total Payments',s.payments/100],[],['Collectibles as of',s.to],['Current',s.current/100],['Previous',s.previous/100],['Total Collectibles',s.credit/100],[],[note(s)]);
  return r;
 }
 root.r94ExportSales=function(){
  if(!valid()){alert('Load the selected date range before exporting.');return;}
  r89Csv('Solavida_Sales_Collections_'+root.r94SalesData.from+'_'+root.r94SalesData.to+'.csv',rows(root.r94SalesData).map(row=>row.map(v=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v)));
 };
 root.r94PrintOwnerReport=function(){
  if(r85Tab!==3){window.print();return;}
  if(!valid()){alert('Load the selected date range before printing.');return;}
  const s=root.r94SalesData,w=window.open('','_blank');if(!w){alert('Allow pop-ups to print this report.');return;}
  w.document.write('<!doctype html><html><head><title>Solavida Sales & Collections '+esc(s.from)+' to '+esc(s.to)+'</title><style>body{font:12px Arial;color:#15374b;margin:20px}h1{font-size:22px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}h2{font-size:17px}h3{margin-top:24px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px;border-bottom:1px solid #d6e2e8}th:not(:first-child),td:not(:first-child){text-align:right}.s94-total{font-weight:bold}dl div{display:flex;justify-content:space-between;padding:8px 0}dd{font-size:18px;font-weight:bold;margin:0}.muted,.s94-note{color:#526775;font-size:11px;line-height:1.5}.s94-card{break-inside:avoid;margin-bottom:20px}@page{size:A4 portrait;margin:12mm}</style></head><body><h1>Solavida — Sales & Collections</h1><p>'+esc(s.from)+' to '+esc(s.to)+'</p><div class="columns"><div>'+$('r85Kpis').innerHTML+'</div><div>'+$('r85Table').innerHTML+'</div></div></body></html>');
  w.document.close();w.focus();setTimeout(()=>w.print(),350);
 };
 const style=document.createElement('style');style.textContent='.r85-sales-layout .r85-summary{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.r85-sales-layout #r85Kpis{display:block}.s94-card{background:#fff;border:1px solid #d9e7ed;border-radius:14px;padding:20px;margin-bottom:16px;min-width:0}.s94-card h2{font-size:20px;margin:0 0 12px}.s94-card h3{margin:24px 0 10px}.s94-card dl{margin:0}.s94-card dl div{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #e3eef2}.s94-card dd{margin:0;font-size:24px;font-weight:700;color:#064c73}.s94-card td:not(:first-child),.s94-card th:not(:first-child){text-align:right}.s94-total{font-weight:700;background:#edf6fa}.s94-note{font-size:12px;color:#536d7b;line-height:1.5}.r85-sales-layout #r85Table{border:0;background:transparent;overflow:visible}.r85-sales-layout #r85Table .muted{margin:0 0 12px}@media(max-width:800px){.r85-sales-layout .r85-summary{grid-template-columns:minmax(0,1fr)}.s94-card{padding:14px}.s94-card dd{font-size:22px}}';document.head.appendChild(style);
})(typeof window==='undefined'?globalThis:window);
