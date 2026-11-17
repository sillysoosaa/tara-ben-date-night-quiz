create table if not exists public.date_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'),
  participant_one uuid not null references auth.users(id) on delete cascade,
  participant_two uuid references auth.users(id) on delete set null,
  submitted_users uuid[] not null default '{}',
  chosen_activity_id text,
  chosen_activity_name text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (participant_two is null or participant_two <> participant_one)
);

create table if not exists public.date_submissions (
  session_id uuid not null references public.date_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null,
  submitted_at timestamptz not null default now(),
  primary key (session_id, user_id),
  check (jsonb_typeof(answers) = 'object')
);

alter table public.date_sessions enable row level security;
alter table public.date_submissions enable row level security;

drop policy if exists "Participants can read their session" on public.date_sessions;
create policy "Participants can read their session"
  on public.date_sessions for select to authenticated
  using (auth.uid() = participant_one or auth.uid() = participant_two);

drop policy if exists "Participants can create their session" on public.date_sessions;
create policy "Participants can create their session"
  on public.date_sessions for insert to authenticated
  with check (auth.uid() = participant_one and participant_two is null and cardinality(submitted_users) = 0);

drop policy if exists "Participants can submit their own answers" on public.date_submissions;
create policy "Participants can submit their own answers"
  on public.date_submissions for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.date_sessions s
      where s.id = session_id
        and auth.uid() in (s.participant_one, s.participant_two)
        and cardinality(s.submitted_users) < 2
    )
  );

drop policy if exists "Participants can edit their own answers" on public.date_submissions;
create policy "Participants can edit their own answers"
  on public.date_submissions for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.date_sessions s
      where s.id = session_id
        and auth.uid() in (s.participant_one, s.participant_two)
        and cardinality(s.submitted_users) < 2
    )
  );

drop policy if exists "Answers are visible after both people submit" on public.date_submissions;
create policy "Answers are visible after both people submit"
  on public.date_submissions for select to authenticated
  using (
    exists (
      select 1 from public.date_sessions s
      where s.id = session_id
        and cardinality(s.submitted_users) >= 2
        and auth.uid() in (s.participant_one, s.participant_two)
    )
  );

create or replace function public.join_date_session(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  found_session public.date_sessions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to join a date quiz.';
  end if;

  select * into found_session
  from public.date_sessions
  where code = upper(trim(p_code))
  for update;

  if not found then
    raise exception 'No date quiz was found for that code.';
  end if;
  if found_session.participant_one = auth.uid() then
    raise exception 'Open the quiz from the browser that created it.';
  end if;
  if found_session.participant_two is not null and found_session.participant_two <> auth.uid() then
    raise exception 'Both places in this quiz session are already taken.';
  end if;

  update public.date_sessions
  set participant_two = auth.uid()
  where id = found_session.id and participant_two is null;

  return found_session.id;
end;
$$;

create or replace function public.submit_date_answers(p_session_id uuid, p_answers jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  session_row public.date_sessions%rowtype;
  answer_key text;
  allowed_options jsonb;
  answer_value jsonb;
  submitted_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required to submit answers.';
  end if;
  if coalesce(jsonb_typeof(p_answers) <> 'object', true) then
    raise exception 'Answers must be an object.';
  end if;
  if not (p_answers ?& array['weather', 'time', 'energy', 'vibe', 'budget']) then
    raise exception 'Answers must include all five quiz questions.';
  end if;

  select * into session_row
  from public.date_sessions
  where id = p_session_id
  for update;
  if not found or (
    auth.uid() <> session_row.participant_one
    and (session_row.participant_two is null or auth.uid() <> session_row.participant_two)
  ) then
    raise exception 'This browser is not a participant in that quiz.';
  end if;
  if cardinality(session_row.submitted_users) >= 2 then
    raise exception 'Answers cannot be changed after both people have submitted.';
  end if;

  for answer_key, allowed_options in
    select * from (values
      ('weather', '["Sunny","Rainy"]'::jsonb),
      ('time', '["Under an hour","1–2 hours","3–6 hours","1 day"]'::jsonb),
      ('energy', '["None","Little","Medium","Lots"]'::jsonb),
      ('vibe', '["Adventure","Cosy","Exercise","Outside","Learning","Romantic","Playful","Competitive","Creative","Connection"]'::jsonb),
      ('budget', '["$0","$25","$50","$100+"]'::jsonb)
    ) as question(key, options)
  loop
    answer_value := p_answers -> answer_key;
    if coalesce(jsonb_typeof(answer_value) <> 'array', true) then
      raise exception 'Choose at least one answer for %.', answer_key;
    end if;
    if jsonb_array_length(answer_value) = 0 then
      raise exception 'Choose at least one answer for %.', answer_key;
    end if;
    if exists (
      select 1 from jsonb_array_elements(answer_value) selected(value)
      where jsonb_typeof(selected.value) <> 'string'
        or not (allowed_options ? (selected.value #>> '{}'))
    ) then
      raise exception 'An answer for % is not recognised.', answer_key;
    end if;
  end loop;

  if (select count(*) from jsonb_object_keys(p_answers)) <> 5 then
    raise exception 'Answers must contain exactly the five quiz questions.';
  end if;

  insert into public.date_submissions (session_id, user_id, answers)
  values (p_session_id, auth.uid(), p_answers)
  on conflict (session_id, user_id)
  do update set answers = excluded.answers, submitted_at = now();

  update public.date_sessions
  set submitted_users = array(
    select distinct submitted.submitted_user
    from unnest(array_append(session_row.submitted_users, auth.uid())) as submitted(submitted_user)
  )
  where id = p_session_id
  returning cardinality(submitted_users) into submitted_count;

  return submitted_count;
end;
$$;

create or replace function public.get_my_date_answers(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_answers jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.date_sessions s
    where s.id = p_session_id and auth.uid() in (s.participant_one, s.participant_two)
  ) then
    raise exception 'This browser is not a participant in that quiz.';
  end if;

  select answers into saved_answers
  from public.date_submissions
  where session_id = p_session_id and user_id = auth.uid();

  return saved_answers;
end;
$$;

create or replace function public.reopen_date_answers(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.date_sessions
  set submitted_users = array_remove(submitted_users, auth.uid())
  where id = p_session_id
    and auth.uid() in (participant_one, participant_two)
    and cardinality(submitted_users) < 2;

  if not found then
    raise exception 'Answers cannot be edited after both people have submitted.';
  end if;
end;
$$;

create or replace function public.record_completed_date(p_session_id uuid, p_activity_id text, p_activity_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.date_sessions
  set chosen_activity_id = p_activity_id,
      chosen_activity_name = p_activity_name,
      completed_at = now()
  where id = p_session_id
    and auth.uid() in (participant_one, participant_two)
    and cardinality(submitted_users) >= 2
    and length(trim(p_activity_id)) > 0
    and length(trim(p_activity_name)) > 0;

  if not found then
    raise exception 'Only a participant in a completed quiz can add a date to the journal.';
  end if;
end;
$$;

revoke all on function public.join_date_session(text) from public;
revoke all on function public.submit_date_answers(uuid, jsonb) from public;
revoke all on function public.get_my_date_answers(uuid) from public;
revoke all on function public.reopen_date_answers(uuid) from public;
revoke all on function public.record_completed_date(uuid, text, text) from public;
grant execute on function public.join_date_session(text) to authenticated;
grant execute on function public.submit_date_answers(uuid, jsonb) to authenticated;
grant execute on function public.get_my_date_answers(uuid) to authenticated;
grant execute on function public.reopen_date_answers(uuid) to authenticated;
grant execute on function public.record_completed_date(uuid, text, text) to authenticated;
grant select, insert on public.date_sessions to authenticated;
grant select, insert, update on public.date_submissions to authenticated;
