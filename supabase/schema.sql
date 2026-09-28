-- Run this once in Supabase → SQL Editor.
-- Each user keeps their own saved calculations ("scenarios").

create table if not exists public.scenarios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'ชุดใหม่',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists scenarios_user_updated_idx
  on public.scenarios (user_id, updated_at desc);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists scenarios_touch on public.scenarios;
create trigger scenarios_touch
  before update on public.scenarios
  for each row execute function public.touch_updated_at();

-- Row Level Security: a user can only see and change their own rows
alter table public.scenarios enable row level security;

drop policy if exists "scenarios_select_own" on public.scenarios;
drop policy if exists "scenarios_insert_own" on public.scenarios;
drop policy if exists "scenarios_update_own" on public.scenarios;
drop policy if exists "scenarios_delete_own" on public.scenarios;

create policy "scenarios_select_own" on public.scenarios
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "scenarios_insert_own" on public.scenarios
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "scenarios_update_own" on public.scenarios
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "scenarios_delete_own" on public.scenarios
  for delete to authenticated using ((select auth.uid()) = user_id);
