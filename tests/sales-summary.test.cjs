const assert=require('node:assert/strict');
const {build,day}=require('../sales-summary.js');
const order=(id,date,amount,qty,more={})=>({id,business_date:date,actual_amount:amount,actual_qty:qty,status:'delivered',channel:'delivery',area:'North',...more});
const data={from:'2026-11-01',to:'2026-11-12',orders:[
 order('old','2026-10-01',100,5),order('a','2026-11-01',200,10),order('w','2026-11-02',30,2,{channel:'walk_in'}),
 order('bad','2026-11-02',900,99,{status:'cancelled'}),order('later','2026-11-13',800,8),
 order('unassigned','2026-11-12',0.30,0,{area:null})
],payments:[
 {id:'p1',order_id:'old',amount:40,payment_method:'cash',received_at:'2026-10-31T16:00:00Z'},
 {id:'p2',order_id:'w',amount:30,payment_method:'gcash',received_at:'2026-11-02T02:00:00Z'},
 {id:'p3',order_id:'a',amount:50,payment_method:'bank_transfer',received_at:'2026-11-13T00:00:00Z'},
 {id:'p4',order_id:'bad',amount:900,payment_method:'cash',received_at:'2026-11-02T00:00:00Z'},
 {id:'p5',order_id:'a',amount:0.10,payment_method:'other',received_at:'2026-11-12T15:59:59Z'},
 {id:'p6',order_id:'a',amount:0.20,payment_method:'other',received_at:'2026-11-12T15:59:59Z'}
],charges:[
 {id:'c0',credit_account_id:'acct',order_id:'old',amount:100,posted_at:'2026-10-01T00:00:00Z'},
 {id:'c1',credit_account_id:'acct',order_id:'a',amount:200,posted_at:'2026-11-01T00:00:00Z'},
 {id:'c2',credit_account_id:'other',order_id:null,amount:50,posted_at:'2026-09-01T00:00:00Z'},
 {id:'c3',credit_account_id:'acct',order_id:'bad',amount:900,posted_at:'2026-11-02T00:00:00Z'}
],collections:[
 {id:'r0',credit_account_id:'acct',amount:60,payment_method:'cash',business_date:'2026-10-20'},
 {id:'r1',credit_account_id:'acct',amount:70,payment_method:'bank_transfer',business_date:'2026-11-03'},
 {id:'r2',credit_account_id:'acct',amount:170,payment_method:'cash',business_date:'2026-11-13'},
 {id:'r3',credit_account_id:'other',amount:50,payment_method:'gcash',business_date:'2026-11-04',cancelled_at:'2026-11-04T12:00:00Z'},
 {id:'r4',credit_account_id:'unrelated',amount:999,payment_method:'cash',business_date:'2026-10-01'}
]};
let s=build(data);
assert.equal(s.sales,23030);assert.equal(s.tc,12);
assert.deepEqual(s.methods,{cash:4000,gcash:3000,bank_transfer:7000,other:30});assert.equal(s.payments,14030);
assert.equal(s.current,17000);assert.equal(s.previous,5000);assert.equal(s.credit,22000);
assert.equal(s.areas.reduce((n,a)=>n+a.sales,0),s.sales);assert.equal(s.areas.reduce((n,a)=>n+a.tc,0),s.tc);
assert.equal(s.areas.find(a=>a.name==='Walk-in').tc,2);assert.ok(s.areas.find(a=>a.name==='Unassigned'));
assert.equal(day('2026-11-12T16:00:00Z'),'2026-11-13');
const doubled={...data};for(const k of ['orders','payments','collections','charges'])doubled[k]=[...data[k],...data[k]];
assert.deepEqual(build(doubled),s);
s=build({...data,to:'2026-11-13'});assert.equal(s.current,0);assert.equal(s.previous,5000);assert.equal(s.methods.cash,21000);
s=build({from:'2026-11-01',to:'2026-11-12'});assert.equal(s.sales+s.tc+s.payments+s.credit,0);
// A future charge and a collection after the cutoff must not change historical debt.
s=build({...data,charges:[...data.charges,{id:'future',credit_account_id:'acct',order_id:'later',amount:800,posted_at:'2026-11-13'}]});assert.equal(s.credit,22000);
assert.deepEqual(data.orders[0],order('old','2026-10-01',100,5));
console.log('PASS sales/TC, all receipt methods, Philippine date edges, account-isolated FIFO, partial/cancelled/future collections, opening debts, duplicate IDs, empty range, unchanged inputs');
