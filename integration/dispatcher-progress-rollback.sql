CREATE OR REPLACE FUNCTION public.delivery_order_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.delivery_stop_action(p_stop uuid, p_action text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;