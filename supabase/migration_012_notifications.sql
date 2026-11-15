-- Migration 012: in-app notifications (the bell). One row per notification
-- per user. `type` and `data` describe what happened; the app turns them into
-- text in the reader's language. `ref` is set for time-based reminders (e.g.
-- "appointment tomorrow") so each reminder is only created once.
-- Run this once in the Supabase SQL Editor (after schema.sql / earlier migrations have already been applied).

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  link text,
  ref text,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, ref)
);

alter table notifications enable row level security;
create index if not exists notifications_user_created_idx on notifications(user_id, created_at desc);
