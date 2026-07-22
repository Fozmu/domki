-- Domki Cesarz — reservations schema.
-- Run this once in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists btree_gist;

create table if not exists houses (
  id smallint primary key,
  name text not null,
  is_special boolean not null default false
);

insert into houses (id, name, is_special) values
  (1, 'Domek 1', false),
  (2, 'Domek 2', false),
  (3, 'Domek 3', false),
  (4, 'Domek 4', false),
  (5, 'Domek 5', false),
  (6, 'Domek 6', false),
  (7, 'Domek 7', false),
  (8, 'Domek 8', false),
  (9, 'Domek Specjalny', true)
on conflict (id) do nothing;

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  house_id smallint not null references houses(id),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  check_in date not null,
  check_out date not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  deposit_amount integer not null default 500,
  deposit_paid boolean not null default false,
  stripe_payment_intent_id text,
  cleaned boolean not null default false,
  created_at timestamptz not null default now(),
  constraint check_out_after_check_in check (check_out > check_in),
  -- Same house can't hold two overlapping, non-cancelled bookings.
  exclude using gist (
    house_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status <> 'cancelled')
);

create index if not exists bookings_check_in_idx on bookings (check_in);

alter table houses enable row level security;
alter table bookings enable row level security;
-- No policies: only the service_role key (used server-side by Netlify functions) can read/write.
-- The anon key gets no access at all.

-- Atomically assigns the first free house for the given date range, or raises
-- 'no_availability' if all 9 are booked. Race-safe: the exclude constraint
-- above enforces it even under concurrent calls, this loop just retries
-- across houses within one transaction.
create or replace function create_booking(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_check_in date,
  p_check_out date
) returns bookings
language plpgsql
as $$
declare
  house_row record;
  result bookings;
begin
  for house_row in select id from houses order by id loop
    begin
      insert into bookings (house_id, first_name, last_name, email, phone, check_in, check_out)
      values (house_row.id, p_first_name, p_last_name, p_email, p_phone, p_check_in, p_check_out)
      returning * into result;
      return result;
    exception when exclusion_violation then
      continue;
    end;
  end loop;

  raise exception 'no_availability';
end;
$$;
