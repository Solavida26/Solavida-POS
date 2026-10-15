-- Additive route workflow. No existing financial functions or rows are replaced.
create table public.delivery_dispatchers(employee_id uuid primary key references public.employees(id), granted_by uuid not null references public.employees(id), granted_at timestamptz not null default now());
create table public.delivery_locations(customer_id uuid primary key references public.customers(id), latitude numeric not null check(latitude between -90 and 90), longitude numeric not null check(longitude between -180 and 180), verified_by uuid not null references public.employees(id), verified_at timestamptz not null default now());
create table public.delivery_trips(id uuid primary key default gen_random_uuid(), business_date date not null, trip_no integer not null check(trip_no between 1 and 9999), status text not null default 'planned' check(status in('planned','on_the_way','completed','cancelled')), driver_id uuid not null references public.employees(id), created_by uuid not null references public.employees(id), created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz, planned_stops jsonb, unique(business_date,trip_no));
create table public.delivery_trip_members(trip_id uuid not null references public.delivery_trips(id), employee_id uuid not null references public.employees(id), primary key(trip_id,employee_id));
create index delivery_trip_members_employee on public.delivery_trip_members(employee_id,trip_id);
create table public.delivery_stops(id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.delivery_trips(id), customer_id uuid not null references public.customers(id), order_id uuid references public.orders(id), released_at timestamptz, position integer not null check(position>0), status text not null default 'pending' check(status in('pending','arrived','completed','skipped')), arrived_at timestamptz, arrived_by uuid references public.employees(id), completed_at timestamptz, completed_by uuid references public.employees(id), outcome text, snapshot jsonb, unique(trip_id,position) deferrable initially deferred);
create unique index delivery_stops_active_order on public.delivery_stops(order_id) where released_at is null;
create index delivery_stops_customer on public.delivery_stops(customer_id);
create table public.delivery_route_events(id bigint generated always as identity primary key, trip_id uuid references public.delivery_trips(id), actor_id uuid not null references public.employees(id), event text not null, recorded_at timestamptz not null default now(), detail jsonb not null default '{}');
create index delivery_route_events_trip on public.delivery_route_events(trip_id,recorded_at);
create function public.delivery_can_dispatch() returns boolean language sql stable security definer set search_path='' as $$ select public.current_employee_role()::text='owner' or exists(select 1 from public.delivery_dispatchers where employee_id=public.current_employee_id()) $$;
create function public.delivery_can_view(p_trip uuid) returns boolean language sql stable security definer set search_path='' as $$ select public.delivery_can_dispatch() or exists(select 1 from public.delivery_trip_members where trip_id=p_trip and employee_id=public.current_employee_id()) $$;
alter table public.delivery_dispatchers enable row level security;
alter table public.delivery_locations enable row level security;
alter table public.delivery_trips enable row level security;
alter table public.delivery_trip_members enable row level security;
alter table public.delivery_stops enable row level security;
alter table public.delivery_route_events enable row level security;
revoke all on public.delivery_dispatchers,public.delivery_locations,public.delivery_trips,public.delivery_trip_members,public.delivery_stops,public.delivery_route_events from anon,authenticated;
grant select on public.delivery_dispatchers,public.delivery_locations,public.delivery_trips,public.delivery_trip_members,public.delivery_stops,public.delivery_route_events to authenticated;
create policy dispatcher_read on public.delivery_dispatchers for select to authenticated using(public.current_employee_role()::text='owner' or employee_id=public.current_employee_id());
create policy location_read on public.delivery_locations for select to authenticated using(public.delivery_can_dispatch() or exists(select 1 from public.delivery_stops s where s.customer_id=delivery_locations.customer_id and public.delivery_can_view(s.trip_id)));
create policy trip_read on public.delivery_trips for select to authenticated using(public.delivery_can_view(id));
create policy members_read on public.delivery_trip_members for select to authenticated using(public.delivery_can_view(trip_id));
create policy stops_read on public.delivery_stops for select to authenticated using(public.delivery_can_view(trip_id));
create policy events_read on public.delivery_route_events for select to authenticated using(public.current_employee_role()::text='owner');

create function public.delivery_set_dispatcher(p_employee uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.current_employee_role()::text is distinct from 'owner' then raise exception 'Owner access required'; end if;
 if not exists(select 1 from public.employees where id=p_employee and active and auth_user_id is not null) then raise exception 'An active personal login is required'; end if;
 if p_enabled then insert into public.delivery_dispatchers(employee_id,granted_by) values(p_employee,public.current_employee_id()) on conflict(employee_id) do nothing;
 else delete from public.delivery_dispatchers where employee_id=p_employee; end if;
 insert into public.delivery_route_events(actor_id,event,detail) values(public.current_employee_id(),'dispatcher_permission',jsonb_build_object('employee_id',p_employee,'enabled',p_enabled));
end $$;
create function public.delivery_save_location(p_customer uuid,p_lat numeric,p_lng numeric) returns void language plpgsql security definer set search_path='' as $$
declare old_location jsonb;
begin
 if not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher access required'; end if;
 if p_lat is null or p_lng is null then raise exception 'Verified latitude and longitude required'; end if;
 select to_jsonb(l) into old_location from public.delivery_locations l where customer_id=p_customer;
 insert into public.delivery_locations values(p_customer,p_lat,p_lng,public.current_employee_id(),now()) on conflict(customer_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,verified_by=excluded.verified_by,verified_at=excluded.verified_at;
 insert into public.delivery_route_events(actor_id,event,detail) values(public.current_employee_id(),'location_verified',jsonb_build_object('customer_id',p_customer,'before',old_location,'latitude',p_lat,'longitude',p_lng));
end $$;

-- Creating a plan is idempotent using a client-generated request UUID.
create function public.delivery_plan(p_id uuid,p_date date,p_driver uuid,p_members uuid[],p_stops jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare n integer; i integer:=0; s jsonb; o public.orders%rowtype; cust uuid;
begin
 if not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher access required'; end if;
 perform pg_advisory_xact_lock(hashtext('delivery_plan:'||p_id::text));
 if exists(select 1 from public.delivery_trips where id=p_id and created_by=public.current_employee_id()) then return p_id; end if;
 if p_date is null or p_date<(now() at time zone 'Asia/Manila')::date then raise exception 'Plan for today or a future date'; end if;
 if p_driver is null or p_members is null or not(p_driver=any(p_members)) or cardinality(p_members)=0 then raise exception 'Choose a driver and all delivery personnel'; end if;
 if exists(select 1 from unnest(p_members) e where not exists(select 1 from public.employees where id=e and active)) then raise exception 'Personnel must be active'; end if;
 if jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops)=0 then raise exception 'Select at least one customer'; end if;
 perform pg_advisory_xact_lock(hashtext('delivery_number:'||p_date::text));
 select coalesce(max(trip_no),0)+1 into n from public.delivery_trips where business_date=p_date;
 if n>9999 then raise exception 'Daily trip number limit reached'; end if;
 insert into public.delivery_trips(id,business_date,trip_no,driver_id,created_by) values(p_id,p_date,n,p_driver,public.current_employee_id());
 insert into public.delivery_trip_members select p_id,e from (select distinct unnest(p_members) e) a;
 -- Lock orders in deterministic order to avoid conflicting assignments.
 perform id from public.orders where id in(select (x->>'order_id')::uuid from jsonb_array_elements(p_stops) x) order by id for update;
 for s in select * from jsonb_array_elements(p_stops) loop
  i:=i+1;
  if nullif(s->>'order_id','') is not null then
   select * into strict o from public.orders where id=(s->>'order_id')::uuid;
   if o.channel::text<>'delivery' or o.status::text<>'pending' then raise exception 'Only pending delivery orders can be assigned'; end if;
   cust:=o.customer_id;
  else cust:=(s->>'customer_id')::uuid; end if;
  if not exists(select 1 from public.customers where id=cust and active) then raise exception 'Customer is not active'; end if;
  insert into public.delivery_stops(trip_id,customer_id,order_id,position) values(p_id,cust,nullif(s->>'order_id','')::uuid,i);
 end loop;
 insert into public.delivery_route_events(trip_id,actor_id,event,detail) values(p_id,public.current_employee_id(),'planned',jsonb_build_object('stops',p_stops,'members',p_members,'driver',p_driver));
 return p_id;
end $$;

create function public.delivery_depart(p_trip uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.delivery_trips%rowtype; s public.delivery_stops%rowtype;
begin
 if not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher access required'; end if;
 select * into strict t from public.delivery_trips where id=p_trip for update;
 if t.status='on_the_way' then return; end if;
 if t.status<>'planned' then raise exception 'Trip has already finished'; end if;
 if t.business_date<>(now() at time zone 'Asia/Manila')::date then raise exception 'Departures must be recorded on the actual Philippine date'; end if;
 update public.delivery_trips set started_at=now(),status='on_the_way',planned_stops=(select jsonb_agg(to_jsonb(ds)||jsonb_build_object('location',(select to_jsonb(dl) from public.delivery_locations dl where dl.customer_id=ds.customer_id)) order by ds.position) from public.delivery_stops ds where ds.trip_id=p_trip) where id=p_trip;
 for s in select * from public.delivery_stops where trip_id=p_trip and order_id is not null order by order_id loop
  perform public.start_delivery_order(s.order_id,t.driver_id);
  insert into public.order_contributors(order_id,employee_id,contribution_type) select s.order_id,employee_id,'delivery' from public.delivery_trip_members where trip_id=p_trip on conflict do nothing;
 end loop;
 insert into public.delivery_route_events(trip_id,actor_id,event) values(p_trip,public.current_employee_id(),'departed');
end $$;

create function public.delivery_reorder(p_trip uuid,p_ids uuid[],p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare before_ids uuid[]; t public.delivery_trips%rowtype;
begin
 if not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher access required'; end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Enter the reason for changing this route'; end if;
 select * into strict t from public.delivery_trips where id=p_trip for update;
 if t.status in('completed','cancelled') then raise exception 'Finished trip cannot be changed'; end if;
 select array_agg(id order by position) into before_ids from public.delivery_stops where trip_id=p_trip;
 if p_ids is null or cardinality(p_ids)<>cardinality(before_ids) or not(p_ids@>before_ids and p_ids<@before_ids) then raise exception 'All existing stops must be retained exactly once'; end if;
 update public.delivery_stops s set position=x.n from unnest(p_ids) with ordinality x(id,n) where s.id=x.id and s.trip_id=p_trip;
 insert into public.delivery_route_events(trip_id,actor_id,event,detail) values(p_trip,public.current_employee_id(),'reordered',jsonb_build_object('before',before_ids,'after',p_ids,'reason',trim(p_reason)));
end $$;

create function public.delivery_stop_action(p_stop uuid,p_action text,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare s public.delivery_stops%rowtype; t public.delivery_trips%rowtype; actor uuid:=public.current_employee_id(); member boolean;
begin
 select * into strict s from public.delivery_stops where id=p_stop for update;
 select * into strict t from public.delivery_trips where id=s.trip_id;
 member:=exists(select 1 from public.delivery_trip_members where trip_id=t.id and employee_id=actor);
 if not coalesce(member,false) and public.current_employee_role()::text is distinct from 'owner' then raise exception 'Only assigned personnel or the Owner may record progress'; end if;
 if not member and length(trim(coalesce(p_note,'')))<3 then raise exception 'Owner entry requires a note identifying who reported the progress'; end if;
 if t.status<>'on_the_way' then raise exception 'Trip must be on the way'; end if;
 if s.status in('completed','skipped') then raise exception 'Stop already finished'; end if;
 if p_action='arrive' then
  if s.arrived_at is not null then return; end if;
  update public.delivery_stops set status='arrived',arrived_at=now(),arrived_by=actor where id=p_stop;
 elsif p_action='visit_complete' and s.order_id is null then
  if s.arrived_at is null or length(trim(coalesce(p_note,'')))<3 then raise exception 'Record arrival and visit outcome first'; end if;
  update public.delivery_stops set status='completed',completed_at=now(),completed_by=actor,outcome=trim(p_note) where id=p_stop;
 elsif p_action='skip' and coalesce(public.delivery_can_dispatch(),false) then
  if length(trim(coalesce(p_note,'')))<3 then raise exception 'Enter the reason for skipping'; end if;
  -- Do not leave an on-the-way order silently detached from a finished route.
  if s.order_id is not null and exists(select 1 from public.orders where id=s.order_id and status::text<>'cancelled') then raise exception 'Cancel the order through Orders before skipping its delivery'; end if;
  update public.delivery_stops set status='skipped',completed_at=now(),completed_by=actor,outcome=trim(p_note) where id=p_stop;
 else raise exception 'Invalid action'; end if;
 insert into public.delivery_route_events(trip_id,actor_id,event,detail) values(t.id,actor,p_action,jsonb_build_object('stop_id',s.id,'note',p_note,'assigned_personnel',member));
end $$;
create function public.delivery_finish(p_trip uuid) returns void language plpgsql security definer set search_path='' as $$
declare t public.delivery_trips%rowtype;
begin
 if not coalesce(public.delivery_can_view(p_trip),false) then raise exception 'Assigned personnel required'; end if;
 select * into strict t from public.delivery_trips where id=p_trip for update;
 if t.status='completed' then return; end if;
 if t.status<>'on_the_way' or exists(select 1 from public.delivery_stops where trip_id=p_trip and status not in('completed','skipped')) then raise exception 'Finish every delivery or visit before ending this trip'; end if;
 update public.delivery_trips set status='completed',finished_at=now() where id=p_trip;
 insert into public.delivery_route_events(trip_id,actor_id,event) values(p_trip,public.current_employee_id(),'finished');
end $$;

-- Enforce route permissions even when an existing Orders RPC or direct API is used.
create function public.delivery_order_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.delivery_stops%rowtype; t public.delivery_trips%rowtype; actor uuid:=public.current_employee_id();
begin
 select * into s from public.delivery_stops where order_id=old.id and released_at is null;
 if not found then return new; end if;
 select * into strict t from public.delivery_trips where id=s.trip_id;
 if (new.customer_id,new.channel) is distinct from (old.customer_id,old.channel) then raise exception 'Routed order customer and channel cannot be changed'; end if;
 if public.current_employee_role()::text is distinct from 'owner' and (
  (old.status::text in('delivered','cancelled') and new.status is distinct from old.status)
  or (old.on_the_way_at is not null and new.on_the_way_at is distinct from old.on_the_way_at)
  or (old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at)
 ) then raise exception 'Existing route history cannot be rewritten'; end if;
 if old.status::text='on_the_way' and new.status::text='pending' then raise exception 'Route cannot be returned to pending'; end if;
 if (new.delivery_personnel_id,new.assigned_by_employee_id) is distinct from (old.delivery_personnel_id,old.assigned_by_employee_id) and not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Only the Owner or dispatcher may change route assignments'; end if;
 if old.status::text='pending' and new.status::text='on_the_way' then
  if not coalesce(public.delivery_can_dispatch(),false) or t.status<>'on_the_way' or new.delivery_personnel_id is distinct from t.driver_id then raise exception 'Start this trip from Delivery / Map'; end if;
 end if;
 if old.status::text='on_the_way' and new.status::text='delivered' then
  if not exists(select 1 from public.delivery_trip_members where trip_id=t.id and employee_id=actor) and public.current_employee_role()::text is distinct from 'owner' then raise exception 'Only assigned personnel or the Owner may complete this delivery'; end if;
  if s.arrived_at is null then raise exception 'Record arrival in Delivery / Map first'; end if;
 end if;
 if new.status::text='cancelled' and new.status is distinct from old.status and not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher authorization required to cancel a routed order'; end if;
 return new;
end $$;
create trigger delivery_order_guard before update on public.orders for each row execute function public.delivery_order_guard();
create function public.delivery_order_record() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.delivery_stops%rowtype;
begin
 if old.status is not distinct from new.status or new.status::text not in('delivered','cancelled') then return new; end if;
 select * into s from public.delivery_stops where order_id=new.id and released_at is null;
 if not found then return new; end if;
 -- Keep original completion snapshots; later Owner financial corrections remain in the existing audit.
 if s.status in('completed','skipped') then return new; end if;
 update public.delivery_stops set status=case when new.status::text='delivered' then 'completed' else 'skipped' end,completed_at=now(),completed_by=public.current_employee_id(),outcome=case when new.status::text='cancelled' then 'Order cancelled in Orders' else 'Delivered' end,snapshot=to_jsonb(new) where id=s.id;
 insert into public.delivery_route_events(trip_id,actor_id,event,detail) values(s.trip_id,public.current_employee_id(),'order_'||new.status::text,jsonb_build_object('stop_id',s.id,'order_id',new.id,'assigned_personnel',exists(select 1 from public.delivery_trip_members where trip_id=s.trip_id and employee_id=public.current_employee_id())));
 return new;
end $$;
create trigger delivery_order_record after update on public.orders for each row execute function public.delivery_order_record();
-- Explicitly restrict all new function execution; no anonymous route access.
revoke all on function public.delivery_can_dispatch(),public.delivery_can_view(uuid),public.delivery_set_dispatcher(uuid,boolean),public.delivery_save_location(uuid,numeric,numeric),public.delivery_plan(uuid,date,uuid,uuid[],jsonb),public.delivery_depart(uuid),public.delivery_reorder(uuid,uuid[],text),public.delivery_stop_action(uuid,text,text),public.delivery_finish(uuid),public.delivery_order_guard(),public.delivery_order_record() from public,anon;
grant execute on function public.delivery_can_dispatch(),public.delivery_can_view(uuid),public.delivery_set_dispatcher(uuid,boolean),public.delivery_save_location(uuid,numeric,numeric),public.delivery_plan(uuid,date,uuid,uuid[],jsonb),public.delivery_depart(uuid),public.delivery_reorder(uuid,uuid[],text),public.delivery_stop_action(uuid,text,text),public.delivery_finish(uuid) to authenticated;

create function public.delivery_cancel_plan(p_trip uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare t public.delivery_trips%rowtype;
begin
 if not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher access required'; end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Enter a reason for cancelling the plan'; end if;
 select * into strict t from public.delivery_trips where id=p_trip for update;
 if t.status<>'planned' then raise exception 'Only an unstarted plan can be cancelled'; end if;
 update public.delivery_trips set status='cancelled' where id=p_trip;
 update public.delivery_stops set released_at=now(),status='skipped',outcome=p_reason where trip_id=p_trip;
 insert into public.delivery_route_events(trip_id,actor_id,event,detail) values(p_trip,public.current_employee_id(),'plan_cancelled',jsonb_build_object('reason',p_reason));
end $$;
create function public.delivery_customer_recency() returns table(customer_id uuid,last_delivered_at timestamptz) language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.delivery_can_dispatch(),false) then raise exception 'Owner or dispatcher access required'; end if;
 return query select o.customer_id,max(o.delivered_at) from public.orders o where o.channel::text='delivery' and o.status::text='delivered' group by o.customer_id;
end $$;
revoke all on function public.delivery_cancel_plan(uuid,text),public.delivery_customer_recency() from public,anon;
grant execute on function public.delivery_cancel_plan(uuid,text),public.delivery_customer_recency() to authenticated;
