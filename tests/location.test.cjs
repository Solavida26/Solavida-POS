const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const context={URL};context.globalThis=context;vm.createContext(context);
const bundle=fs.readFileSync('delivery-routes.js','utf8').split('/* Google routing helpers.')[0];
assert.equal(bundle,fs.readFileSync('vendor/openlocationcode.js','utf8')+'\n'+fs.readFileSync('customer-map-location.js','utf8')+'\n');
vm.runInContext(bundle,context);
const parse=context.SolavidaSavedLocation.parse,link=q=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q);
const near=(p,a,b)=>{assert.ok(p);assert.ok(Math.abs(p.latitude-a)<1e-8);assert.ok(Math.abs(p.longitude-b)<1e-8);};
near(parse(link('9°19\'32.09"N 123°17\'48.53"E')),9+19/60+32.09/3600,123+17/60+48.53/3600);
near(parse(link('9°19\'32.09"S 123°17\'48.53"W')),-(9+19/60+32.09/3600),-(123+17/60+48.53/3600));
near(parse(link('9.33,123.30')),9.33,123.30);
near(parse('https://www.google.com/maps/place/Test/@1,2,17z/data=!3m1!4b1!4m6!3m5!1sabc!8m2!3d9.3244018!4d123.2988483'),9.3244018,123.2988483);
near(parse(link('87FX+QG Dumaguete City, Negros Oriental')),9.3244375,123.2988125);
for(const code of ['87FX+RFV Dumaguete City, Negros Oriental','77GJ+99X Dumaguete City, Negros Oriental','8666+C32 Valencia, Negros Oriental','77WJ+95 Dumaguete City, Negros Oriental','873P+F9F Dumaguete City, Negros Oriental']){const p=parse(link(code));assert.ok(p&&p.latitude>9&&p.latitude<9.6&&p.longitude>123&&p.longitude<123.6);}
for(const value of [null,'Bantayan',link('atbang st. paul room 26 seaheven'),link('87FX+QG Paris'),link('87FX+QG'),link('9°60\'00"N 123°17\'00"E'),link('91,123'),'https://www.google.com/maps/@9.3,123.3,17z','https://evil.example/?query=9,123','javascript:alert(1)'])assert.equal(parse(value),null);
// All current exact-coordinate formats must remain readable; customer edits are
// read on every refresh rather than copied into a stale second database table.
console.log('PASS saved map coordinates, DMS, local Plus Codes, place-pin priority, invalid/missing locations and bundled source consistency');
