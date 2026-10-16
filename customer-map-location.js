/* Read exact saved pins; never geocode a descriptive address or map viewport. */
(function(root){
 'use strict';
 const point=(a,b)=>{a=Number(a);b=Number(b);return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180?{latitude:a,longitude:b}:null;};
 function parse(value){
  if(!value||typeof value!=='string')return null;
  let text=value.trim();
  if(/^https?:/i.test(text)){
   let u;try{u=new URL(text);}catch{return null;}
   if(!/^(www\.|maps\.)?google\.(com|com\.ph)$/.test(u.hostname))return null;
   // Place coordinates outrank @camera coordinates, which must never become a pin.
   let path;try{path=decodeURIComponent(u.pathname);}catch{return null;}
   const pin=path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
   if(pin)return point(pin[1],pin[2]);
   text=u.searchParams.get('query')||u.searchParams.get('q')||u.searchParams.get('destination')||'';
  }
  const decimal=text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(decimal)return point(decimal[1],decimal[2]);
  const dms=text.trim().match(/^(\d+(?:\.\d+)?)\s*[°º]\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]\s*([NS])\s*[, ]*\s*(\d+(?:\.\d+)?)\s*[°º]\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]\s*([EW])$/i);
  if(dms){if([2,3,6,7].some(i=>Number(dms[i])>=60))return null;return point((+dms[1]+dms[2]/60+dms[3]/3600)*(/S/i.test(dms[4])?-1:1),(+dms[5]+dms[6]/60+dms[7]/3600)*(/W/i.test(dms[8])?-1:1));}
  const plus=text.toUpperCase().match(/^([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})(?:\s+(.*))?$/);
  if(plus){try{
   let code=plus[1];
   if(OpenLocationCode.isShort(code)){
    // Four omitted digits cover a 1-degree cell. Only resolve explicitly named
    // local service cities, safely near the owner-confirmed station reference.
    if(code.indexOf('+')!==4||! /^(DUMAGUETE(?: CITY)?|VALENCIA)(?:,? NEGROS ORIENTAL)?(?:,? PHILIPPINES)?$/.test(plus[2]||''))return null;
    code=OpenLocationCode.recoverNearest(code,9.3244018,123.2988483);
   }
   if(!OpenLocationCode.isFull(code))return null;
   const p=OpenLocationCode.decode(code);return point(p.latitudeCenter,p.longitudeCenter);
  }catch{return null;}}
  return null;
 }
 root.SolavidaSavedLocation={parse};
})(typeof window!=='undefined'?window:globalThis);
