CREATE OR REPLACE FUNCTION public.cancel_delivery_order(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id uuid;
  v_order public.orders%rowtype;
begin
  v_employee_id := public.current_employee_id();
  if v_employee_id is null or public.current_employee_role() not in ('staff'::public.employee_role,'owner'::public.employee_role) then
    raise exception 'Active staff or owner required';
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.channel <> 'delivery'::public.order_channel then raise exception 'Only delivery orders can be cancelled'; end if;
  if v_order.status in ('delivered'::public.order_status,'cancelled'::public.order_status) then
    raise exception 'This order can no longer be cancelled';
  end if;

  update public.orders
  set status='cancelled'::public.order_status,
      cancelled_at=now(),
      cancelled_by_employee_id=v_employee_id,
      updated_at=now()
  where id=p_order_id;

  insert into public.audit_logs(category,action,order_id,actor_employee_id,before_data,after_data,detail)
  values(
    'order'::public.audit_category,'delivery_cancelled',p_order_id,v_employee_id,
    jsonb_build_object('status',v_order.status),
    jsonb_build_object('status','cancelled'),
    jsonb_build_object('order_no',v_order.order_no)
  );

  return p_order_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.complete_delivery_order_multi_v3(p_order_id uuid, p_actual_items jsonb, p_containers_returned integer, p_received_by text, p_payment_status payment_status, p_payment_method payment_method, p_amount_received numeric, p_reference_number text, p_notes text, p_contributors jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_actual numeric;
  v_amount numeric := 0;
  v_actual_containers numeric := 0;
  v_change numeric := 0;
  v_credit_account_id uuid;
  v_contributor jsonb;
  v_employee uuid;
  v_matched_count integer := 0;
BEGIN
  v_employee_id := public.current_employee_id();
  IF v_employee_id IS NULL OR public.current_employee_role() NOT IN ('staff'::public.employee_role,'owner'::public.employee_role) THEN
    RAISE EXCEPTION 'Active staff or owner required';
  END IF;
  IF jsonb_typeof(p_actual_items) <> 'array' OR jsonb_array_length(p_actual_items)=0 THEN
    RAISE EXCEPTION 'Enter the actual quantity for each delivery product';
  END IF;
  IF coalesce(p_containers_returned,0)<0 THEN RAISE EXCEPTION 'Containers returned cannot be negative'; END IF;
  IF nullif(trim(coalesce(p_received_by,'')),'') IS NULL THEN RAISE EXCEPTION 'Received By is required'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF v_order.channel<>'delivery' THEN RAISE EXCEPTION 'Only delivery orders can be completed'; END IF;
  IF v_order.status<>'on_the_way' THEN RAISE EXCEPTION 'Only On the Way orders can be completed'; END IF;
  IF v_order.customer_id IS NULL THEN RAISE EXCEPTION 'Delivery order customer is required'; END IF;

  FOR v_item IN SELECT * FROM public.order_items WHERE order_id=p_order_id ORDER BY id FOR UPDATE LOOP
    SELECT (elem.value->>'delivered_qty')::numeric INTO v_actual
    FROM jsonb_array_elements(p_actual_items) AS elem(value)
    WHERE elem.value->>'order_item_id'=v_item.id::text
    LIMIT 1;
    IF NOT FOUND OR v_actual IS NULL OR v_actual<0 THEN
      RAISE EXCEPTION 'Enter a valid actual quantity for every product';
    END IF;
    v_matched_count := v_matched_count + 1;
    v_amount := v_amount + round(v_actual*v_item.unit_price,2);
    UPDATE public.order_items SET delivered_qty=v_actual, line_total=round(v_actual*v_item.unit_price,2), notes=coalesce(p_notes,notes) WHERE id=v_item.id;
    IF EXISTS(SELECT 1 FROM public.products p WHERE p.id=v_item.product_id AND p.unit='container') THEN
      v_actual_containers := v_actual_containers + v_actual;
    END IF;
  END LOOP;

  IF v_matched_count <> jsonb_array_length(p_actual_items) THEN
    RAISE EXCEPTION 'Delivery quantities do not match this order';
  END IF;
  IF v_amount<=0 THEN RAISE EXCEPTION 'Actual delivered amount must be greater than zero'; END IF;

  FOR v_contributor IN SELECT value FROM jsonb_array_elements(coalesce(p_contributors,'[]'::jsonb)) LOOP
    v_employee := (v_contributor->>'employee_id')::uuid;
    IF v_employee IS NULL OR NOT EXISTS(SELECT 1 FROM public.employees WHERE id=v_employee AND active=true) THEN
      RAISE EXCEPTION 'Contributor must be an active employee';
    END IF;
  END LOOP;

  IF p_payment_status='paid' THEN
    IF p_payment_method IS NULL THEN RAISE EXCEPTION 'Payment method is required for a paid delivery'; END IF;
    IF p_amount_received<v_amount THEN RAISE EXCEPTION 'Amount received is less than the delivery amount'; END IF;
    IF p_payment_method='cash' THEN
      v_change := round(p_amount_received-v_amount,2);
    ELSIF p_amount_received<>v_amount THEN
      RAISE EXCEPTION 'Amount received must equal the delivery amount for non-cash payments';
    END IF;
  ELSIF p_payment_status='credit' THEN
    p_payment_method:=NULL; p_amount_received:=0; v_change:=0;
  ELSE
    RAISE EXCEPTION 'Delivery payment status must be Paid or Credit';
  END IF;

  UPDATE public.orders SET
    status='delivered', payment_status=p_payment_status, payment_method=p_payment_method,
    delivered_at=now(), actual_qty=v_actual_containers, actual_amount=round(v_amount,2),
    amount_collected=CASE WHEN p_payment_status='paid' THEN round(v_amount,2) ELSE 0 END,
    amount_received=coalesce(p_amount_received,0), change_given=v_change,
    containers_returned=coalesce(p_containers_returned,0), received_by=trim(p_received_by),
    notes=coalesce(p_notes,notes), business_date=public.current_business_date(), updated_at=now()
  WHERE id=p_order_id;

  IF p_payment_status='paid' THEN
    INSERT INTO public.payments(order_id,amount,payment_method,received_by_employee_id,reference_number,received_at,notes)
    VALUES(p_order_id,round(v_amount,2),p_payment_method,v_employee_id,p_reference_number,now(),p_notes);
  ELSE
    SELECT id INTO v_credit_account_id FROM public.credit_accounts WHERE customer_id=v_order.customer_id FOR UPDATE;
    IF v_credit_account_id IS NULL THEN
      INSERT INTO public.credit_accounts(customer_id,notes) VALUES(v_order.customer_id,'Created from delivery credit') RETURNING id INTO v_credit_account_id;
    END IF;
    INSERT INTO public.credit_charges(credit_account_id,order_id,amount,posted_by_employee_id,posted_at)
    VALUES(v_credit_account_id,p_order_id,round(v_amount,2),v_employee_id,now());
  END IF;

  FOR v_contributor IN SELECT value FROM jsonb_array_elements(coalesce(p_contributors,'[]'::jsonb)) LOOP
    INSERT INTO public.order_contributors(order_id,employee_id,contribution_type)
    VALUES(p_order_id,(v_contributor->>'employee_id')::uuid,coalesce(nullif(trim(v_contributor->>'contribution_type'),''),'other_assistance'))
    ON CONFLICT (order_id,employee_id,contribution_type) DO NOTHING;
  END LOOP;

  INSERT INTO public.audit_logs(category,action,order_id,actor_employee_id,before_data,after_data,detail)
  VALUES('order','delivery_completed',v_order.id,v_employee_id,
    jsonb_build_object('status',v_order.status,'payment_status',v_order.payment_status,'actual_qty',v_order.actual_qty,'actual_amount',v_order.actual_amount,'business_date',v_order.business_date),
    jsonb_build_object('status','delivered','payment_status',p_payment_status,'actual_qty',v_actual_containers,'actual_amount',round(v_amount,2),'containers_returned',coalesce(p_containers_returned,0),'received_by',trim(p_received_by),'contributors',p_contributors,'business_date',public.current_business_date()),
    jsonb_build_object('order_no',v_order.order_no));
  RETURN p_order_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.start_delivery_order(p_order_id uuid, p_delivery_personnel_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_employee_id uuid;
  v_order public.orders%rowtype;
  v_person public.employees%rowtype;
begin
  v_employee_id := public.current_employee_id();

  if v_employee_id is null or public.current_employee_role() not in ('staff'::public.employee_role,'owner'::public.employee_role) then
    raise exception 'Active staff or owner required';
  end if;

  if p_delivery_personnel_id is null then
    raise exception 'Delivery personnel is required';
  end if;

  select * into v_person
  from public.employees
  where id = p_delivery_personnel_id and active = true;

  if not found then
    raise exception 'Delivery personnel not found or inactive';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if v_order.channel <> 'delivery'::public.order_channel then raise exception 'Only delivery orders can be assigned'; end if;
  if v_order.status <> 'pending'::public.order_status then raise exception 'Only pending orders can be moved On the Way'; end if;

  update public.orders
  set status='on_the_way'::public.order_status,
      delivery_personnel_id=p_delivery_personnel_id,
      assigned_by_employee_id=v_employee_id,
      on_the_way_at=now(),
      updated_at=now()
  where id=p_order_id;

  insert into public.audit_logs(category,action,order_id,actor_employee_id,before_data,after_data,detail)
  values(
    'order'::public.audit_category,
    'delivery_started',
    p_order_id,
    v_employee_id,
    jsonb_build_object('status',v_order.status,'delivery_personnel_id',v_order.delivery_personnel_id),
    jsonb_build_object('status','on_the_way','delivery_personnel_id',p_delivery_personnel_id),
    jsonb_build_object('order_no',v_order.order_no,'assigned_personnel',v_person.full_name)
  );

  return p_order_id;
end;
$function$
;
