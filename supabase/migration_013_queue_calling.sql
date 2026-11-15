-- Migration 013: calling patients in from the queue. A ticket is "waiting"
-- after check-in, "called" when staff call the patient in (they get a
-- "your turn" notification), and "done" once they've been seen.
-- Run this once in the Supabase SQL Editor (after schema.sql / earlier migrations have already been applied).

alter table queue_tickets add column if not exists status text not null default 'waiting';
alter table queue_tickets add column if not exists called_at timestamptz;
alter table queue_tickets add column if not exists called_by text;
alter table queue_tickets drop constraint if exists queue_tickets_status_check;
alter table queue_tickets add constraint queue_tickets_status_check check (status in ('waiting', 'called', 'done'));
