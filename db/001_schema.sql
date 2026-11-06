-- Applied to Supabase project jnmgzjrmlycodxhfaxdj on 2026-11-05 as migrations
-- "rp_robotic_programme_schema" + "rp_lock_function_exec". Kept here for reference / re-creation.
-- All objects are prefixed rp_ so they sit alongside (and never touch) the surgical-registry tables.

create table public.rp_access (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('admin','editor','viewer')),
  added_at timestamptz not null default now()
);

create or replace function public.rp_role_rank(p_email text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select case role when 'admin' then 3 when 'editor' then 2 when 'viewer' then 1 end
                   from public.rp_access where email = lower(p_email)), 0);
$$;

create or replace function public.rp_can(p_min text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.rp_role_rank(coalesce(auth.jwt() ->> 'email','')) >=
         case p_min when 'admin' then 3 when 'editor' then 2 else 1 end;
$$;

create table public.rp_departments (
  code text primary key, name text not null,
  has_surgeon_breakdown boolean not null default false, sort smallint not null default 0);

create table public.rp_surgeons (
  id serial primary key, name text not null unique,
  department_code text not null references public.rp_departments(code),
  active boolean not null default true, sort smallint not null default 0);

create table public.rp_hospital_month (
  month date primary key check (extract(day from month) = 1),
  total_cases int check (total_cases >= 0), notes text,
  updated_at timestamptz not null default now(), updated_by text default (auth.jwt() ->> 'email'));

create table public.rp_department_month (
  month date not null check (extract(day from month) = 1),
  department_code text not null references public.rp_departments(code),
  cases int not null check (cases >= 0),
  updated_at timestamptz not null default now(), updated_by text default (auth.jwt() ->> 'email'),
  primary key (month, department_code));

create table public.rp_surgeon_month (
  month date not null check (extract(day from month) = 1),
  surgeon_id int not null references public.rp_surgeons(id),
  package text not null check (package in ('R1','R2','R3')),
  platform text not null default 'all',   -- reserved for robot-platform comparisons
  cases int not null check (cases >= 0),
  updated_at timestamptz not null default now(), updated_by text default (auth.jwt() ->> 'email'),
  primary key (month, surgeon_id, package, platform));

create table public.rp_audit (
  id bigint generated always as identity primary key, table_name text not null, action text not null,
  old_row jsonb, new_row jsonb, changed_by text default (auth.jwt() ->> 'email'),
  changed_at timestamptz not null default now());

create or replace function public.rp_audit_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT','UPDATE') then new.updated_at := now(); new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by); end if;
  insert into public.rp_audit(table_name, action, old_row, new_row)
  values (tg_table_name, tg_op, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger rp_audit_hosp before insert or update or delete on public.rp_hospital_month for each row execute function public.rp_audit_trg();
create trigger rp_audit_dept before insert or update or delete on public.rp_department_month for each row execute function public.rp_audit_trg();
create trigger rp_audit_surg before insert or update or delete on public.rp_surgeon_month for each row execute function public.rp_audit_trg();

-- Row-level security: viewers read, editors write monthly data, admins manage access & surgeons.
alter table public.rp_access enable row level security;
alter table public.rp_departments enable row level security;
alter table public.rp_surgeons enable row level security;
alter table public.rp_hospital_month enable row level security;
alter table public.rp_department_month enable row level security;
alter table public.rp_surgeon_month enable row level security;
alter table public.rp_audit enable row level security;
create policy rp_access_self on public.rp_access for select to authenticated using (email = lower(auth.jwt() ->> 'email') or public.rp_can('admin'));
create policy rp_access_admin on public.rp_access for all to authenticated using (public.rp_can('admin')) with check (public.rp_can('admin'));
do $$ declare t text; begin
  foreach t in array array['rp_departments','rp_surgeons','rp_hospital_month','rp_department_month','rp_surgeon_month'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.rp_can(''viewer''))', t||'_read', t); end loop;
  foreach t in array array['rp_hospital_month','rp_department_month','rp_surgeon_month'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check (public.rp_can(''editor''))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.rp_can(''editor'')) with check (public.rp_can(''editor''))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.rp_can(''editor''))', t||'_del', t); end loop;
  foreach t in array array['rp_departments','rp_surgeons'] loop
    execute format('create policy %I on public.%I for all to authenticated using (public.rp_can(''admin'')) with check (public.rp_can(''admin''))', t||'_admin', t); end loop;
end $$;
create policy rp_audit_read on public.rp_audit for select to authenticated using (public.rp_can('admin'));
revoke all on public.rp_access, public.rp_departments, public.rp_surgeons, public.rp_hospital_month,
  public.rp_department_month, public.rp_surgeon_month, public.rp_audit from anon;
revoke execute on function public.rp_audit_trg() from public, anon, authenticated;
revoke execute on function public.rp_role_rank(text) from public, anon, authenticated;
revoke execute on function public.rp_can(text) from public, anon;
grant execute on function public.rp_can(text) to authenticated;

-- Flat monthly summary (for ad-hoc SQL lookups in the Supabase SQL editor)
create view public.rp_v_monthly with (security_invoker = true) as
with m as (select month from public.rp_hospital_month union select month from public.rp_department_month union select month from public.rp_surgeon_month),
s as (select month, sum(cases) filter (where package='R1') r1, sum(cases) filter (where package='R2') r2,
             sum(cases) filter (where package='R3') r3, sum(cases) gi_from_surgeons from public.rp_surgeon_month group by month)
select m.month,
  (case when extract(month from m.month) >= 4 then extract(year from m.month) else extract(year from m.month)-1 end)::int as fy_start,
  'FY ' || (case when extract(month from m.month) >= 4 then extract(year from m.month) else extract(year from m.month)-1 end)::int || '-' ||
    lpad((((case when extract(month from m.month) >= 4 then extract(year from m.month) else extract(year from m.month)-1 end)::int + 1) % 100)::text, 2, '0') as fy,
  'Q' || (((extract(month from m.month)::int + 8) % 12) / 3 + 1) as fq,
  h.total_cases as hospital_total,
  coalesce((select cases from public.rp_department_month d where d.month=m.month and d.department_code='GI'), s.gi_from_surgeons) as gastro,
  h.total_cases - coalesce((select cases from public.rp_department_month d where d.month=m.month and d.department_code='GI'), s.gi_from_surgeons, 0) as other_specialties,
  s.r1, s.r2, s.r3, s.gi_from_surgeons
from m left join public.rp_hospital_month h using (month) left join s using (month) order by m.month;
grant select on public.rp_v_monthly to authenticated;
