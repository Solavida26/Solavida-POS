/* Google routing helpers. No requests or persistence occur in this module. */
(function(root){
 'use strict';
 const station={latitude:9.3244018,longitude:123.2988483};
 const valid=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
 function validate(stops){if(!Array.isArray(stops)||!stops.length||stops.length>20)throw Error('Choose between 1 and 20 stops.');if(stops.some(s=>!valid(s)))throw Error('Every selected stop needs a saved precise pin.');return stops;}
 const waypoint=p=>({location:{latLng:{latitude:p.latitude,longitude:p.longitude}}});
 function request(stops,roundTrip=true){validate(stops);return {origin:waypoint(station),destination:waypoint(roundTrip?station:stops[stops.length-1]),intermediates:(roundTrip?stops:stops.slice(0,-1)).map(waypoint),travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',optimizeWaypointOrder:true,languageCode:'en',units:'METRIC'};}
 function result(data,count,roundTrip=true){const route=data?.routes?.[0],n=roundTrip?count:count-1,indices=route?.optimizedIntermediateWaypointIndex??(n===0?[]:null);if(!Array.isArray(indices)||indices.length!==n||new Set(indices).size!==n||indices.some(i=>!Number.isInteger(i)||i<0||i>=n))throw Error('Google returned an incomplete stop sequence. Please try again.');const match=/^(\d+(?:\.\d+)?)s$/.exec(route.duration||'');if(!match||!Number.isFinite(route.distanceMeters)||route.distanceMeters<0)throw Error('Google returned an invalid route estimate.');return {indices:roundTrip?indices:[...indices,count-1],minutes:Math.ceil(Number(match[1])/60),kilometers:route.distanceMeters/1000};}
 function embed(stops,key,roundTrip=true){validate(stops);if(!key)throw Error('Google Maps connection is not configured.');const coords=p=>p.latitude+','+p.longitude;const p=new URLSearchParams({key,origin:coords(station),destination:coords(roundTrip?station:stops[stops.length-1]),mode:'driving',units:'metric'});const middle=roundTrip?stops:stops.slice(0,-1);if(middle.length)p.set('waypoints',middle.map(coords).join('|'));return 'https://www.google.com/maps/embed/v1/directions?'+p;}
 root.SolavidaRoadRoute={station,validate,request,result,embed};
})(typeof window!=='undefined'?window:globalThis);
