-- Migration 014: phones registered for push notifications (Firebase Cloud
-- Messaging). One row per phone; logging in on a phone claims it, logging
-- out removes it. `lang` is the app language, so pushes arrive in it.
-- Run this once in the Supabase SQL Editor (after schema.sql / earlier migrations have already been applied).

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android',
  lang text not null default 'en',
  updated_at timestamptz not null default now()
);

alter table device_tokens enable row level security;
create index if not exists device_tokens_user_id_idx on device_tokens(user_id);
