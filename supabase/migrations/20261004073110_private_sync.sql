-- Private, single-owner sync. No owner or device is provisioned by this migration.
-- Configure Auth with public registration disabled, then provision the owner's
-- UUID and random device-key hashes through the private SQL console only.
-- Do not expose dailyhouse_private through the Data API schema settings.
create schema if not exists dailyhouse_private;
revoke all on schema dailyhouse_private from public, anon, authenticated;

create table dailyhouse_private.owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id),
  enabled boolean not null default true
);
create table dailyhouse_private.devices (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 1 and 100),
  key_hash bytea not null check (octet_length(key_hash) = 32),
  scopes text[] not null check (cardinality(scopes) between 1 and 6 and scopes <@ array['todos','reading','ideas','learning','journal','projects']::text[]),
  revoked boolean not null default false,
  administrator boolean not null default false,
  last_seen_at timestamptz
);
create table dailyhouse_private.records (
  kind text not null,
  id text not null check (length(id) between 1 and 4096),
  value jsonb not null,
  version bigint not null check (version between 1 and 9007199254740991),
  source_key text,
  live boolean not null,
  primary key(kind,id)
);
create unique index records_live_reading_source on dailyhouse_private.records(source_key) where kind='reading' and live and source_key is not null;
create index records_source_receipts on dailyhouse_private.records(source_key) where source_key is not null;
create table dailyhouse_private.operations (
  device_id uuid not null references dailyhouse_private.devices(id),
  operation_id uuid not null,
  fingerprint bytea not null check (octet_length(fingerprint)=32),
  result_status text not null check (result_status in ('accepted','conflict')),
  result_kind text not null,
  result_id text not null,
  result_version bigint not null,
  primary key(device_id,operation_id)
);
alter table dailyhouse_private.owner enable row level security;
alter table dailyhouse_private.devices enable row level security;
alter table dailyhouse_private.records enable row level security;
alter table dailyhouse_private.operations enable row level security;
-- No table policy or application table grant: access goes through checked RPCs.
revoke all on all tables in schema dailyhouse_private from public, anon, authenticated;
alter default privileges in schema dailyhouse_private revoke execute on functions from public;

create function dailyhouse_private.scope_of(p_kind text) returns text
language plpgsql immutable set search_path='' as $$
begin
  return case p_kind when 'todo' then 'todos'
    when 'reading' then 'reading' when 'readingReport' then 'reading' when 'readingSuppression' then 'reading' when 'readingExpired' then 'reading'
    when 'idea' then 'ideas' when 'ideaRemoved' then 'ideas' when 'ideaMeta' then 'ideas'
    when 'learning' then 'learning'
    when 'journal' then 'journal' when 'journalSuppression' then 'journal'
    when 'project' then 'projects' when 'gardenProject' then 'projects' else null end;
end $$;

create function dailyhouse_private.authorize(p_device_id uuid,p_device_key text) returns dailyhouse_private.devices
language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid(); v_claims jsonb := auth.jwt(); v_session uuid; v_device dailyhouse_private.devices;
begin
  if v_uid is null or coalesce(v_claims->>'role','') <> 'authenticated'
    or coalesce(v_claims->>'exp','') !~ '^[0-9]{1,12}$'
    or (v_claims->>'exp')::numeric <= extract(epoch from clock_timestamp())
    or coalesce(v_claims->>'session_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(v_claims->>'is_anonymous','false') <> 'false' then
    raise exception using errcode='42501', message='Owner authentication required';
  end if;
  v_session := (v_claims->>'session_id')::uuid;
  -- The owner-row lock serializes this small one-person ledger, including
  -- different reading IDs sharing a source and device revocation races.
  perform 1 from dailyhouse_private.owner where singleton and enabled and user_id=v_uid for update;
  if not found then raise exception using errcode='42501', message='Owner authentication required'; end if;
  if not exists(select 1 from auth.sessions s where s.id=v_session and s.user_id=v_uid and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception using errcode='42501', message='Active owner session required';
  end if;
  if p_device_key is null or p_device_key !~ '^[A-Za-z0-9_-]{43}$' then raise exception using errcode='42501', message='Device authorization required'; end if;
  select * into v_device from dailyhouse_private.devices where id=p_device_id and not revoked
    and key_hash=sha256(convert_to(p_device_key,'UTF8')) for update;
  if not found then raise exception using errcode='42501', message='Device authorization required'; end if;
  update dailyhouse_private.devices set last_seen_at=clock_timestamp() where id=p_device_id;
  return v_device;
end $$;

create function dailyhouse_private.fields(p_value jsonb,p_allowed text[],p_required text[]) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  return p_value ?& p_required and not exists(select 1 from jsonb_object_keys(p_value) k where not(k=any(p_allowed)));
end $$;
create function dailyhouse_private.text_value(p_value jsonb,p_max integer,p_required boolean default false) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='string' and length(p_value#>>'{}')<=p_max and (not p_required or length(btrim(p_value#>>'{}'))>0),false)
$$;
create function dailyhouse_private.uuid_value(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(jsonb_typeof(p_value)='string' and (p_value#>>'{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
$$;
create function dailyhouse_private.idea_id(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select dailyhouse_private.uuid_value(p_value) or coalesce((p_value#>>'{}') ~ '^legacy-[a-f0-9]{24}$',false)
$$;
create function dailyhouse_private.timestamp_value(p_value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if not dailyhouse_private.text_value(p_value,40,true) or (p_value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:\d{2})$' then return false; end if;
  perform (p_value#>>'{}')::timestamptz; return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
create function dailyhouse_private.date_value(p_value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if not dailyhouse_private.text_value(p_value,10,true) or (p_value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char((p_value#>>'{}')::date,'YYYY-MM-DD')=p_value#>>'{}';
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
create function dailyhouse_private.url_value(p_value jsonb,p_empty boolean default true) returns boolean
language sql immutable set search_path='' as $$
  select dailyhouse_private.text_value(p_value,4096) and ((p_empty and p_value='""'::jsonb)
    or coalesce((p_value#>>'{}') ~* '^https?://[^/@[:space:]]+([/?#].*)?$' and (p_value#>>'{}') !~ '[[:cntrl:]]',false))
$$;
-- Device producers normalize URLs with the existing WHATWG parser. The server
-- independently compares origin/path and decoded, sorted non-tracking params;
-- a caller cannot evade the source index by supplying an unrelated sourceKey.
create function dailyhouse_private.query_value(p_value text) returns text
language plpgsql immutable set search_path='' as $$
declare v_bytes bytea:=''::bytea; v_index integer:=1; v_character text;
begin
  while v_index<=length(p_value) loop
    v_character:=substr(p_value,v_index,1);
    if v_character='%' and substr(p_value,v_index+1,2) ~ '^[0-9a-fA-F]{2}$' then
      v_bytes:=v_bytes||decode(substr(p_value,v_index+1,2),'hex'); v_index:=v_index+3;
    else
      v_bytes:=v_bytes||convert_to(case when v_character='+' then ' ' else v_character end,'UTF8'); v_index:=v_index+1;
    end if;
  end loop;
  return convert_from(v_bytes,'UTF8');
exception when character_not_in_repertoire then
  -- Invalid UTF-8 URLs are excluded rather than leaking parser diagnostics.
  raise exception using errcode='22023',message='Unsupported sync source';
end $$;
create function dailyhouse_private.form_value(p_value text) returns text
language plpgsql immutable set search_path='' as $$
declare v_bytes bytea:=convert_to(p_value,'UTF8'); v_index integer; v_byte integer; v_result text:='';
begin
  for v_index in 0..octet_length(v_bytes)-1 loop
    v_byte:=get_byte(v_bytes,v_index);
    if v_byte=32 then v_result:=v_result||'+';
    elsif v_byte between 48 and 57 or v_byte between 65 and 90 or v_byte between 97 and 122 or v_byte in (42,45,46,95) then v_result:=v_result||chr(v_byte);
    else v_result:=v_result||'%'||upper(lpad(to_hex(v_byte),2,'0')); end if;
  end loop; return v_result;
end $$;
create function dailyhouse_private.canonical_url(p_url text) returns text
language plpgsql immutable set search_path='' as $$
declare v_parts text[]; v_host text; v_path text; v_query text;
begin
  v_parts:=regexp_match(p_url,'^(https?)://([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$','i');
  if v_parts is null or not dailyhouse_private.url_value(to_jsonb(p_url),false) then return null; end if;
  v_host:=lower(v_parts[2]); v_path:=coalesce(nullif(v_parts[3],''),'/');
  if lower(v_parts[1])='https' then v_host:=regexp_replace(v_host,':443$',''); else v_host:=regexp_replace(v_host,':80$',''); end if;
  select string_agg(dailyhouse_private.form_value(name)||'='||dailyhouse_private.form_value(value),'&' order by name collate "C",ordinality) into v_query
    from (select ordinality,dailyhouse_private.query_value(split_part(part,'=',1)) as name,
      dailyhouse_private.query_value(case when strpos(part,'=')>0 then substring(part from strpos(part,'=')+1) else '' end) as value
      from unnest(string_to_array(coalesce(v_parts[4],''),'&')) with ordinality as p(part,ordinality) where part<>'') q
    where name !~* '^(utm_.+|spm|spm_id_from|from_spmid|vd_source|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref_src|ref_url|share_source|share_medium|share_plat|share_session_id|share_tag)$';
  return lower(v_parts[1])||'://'||v_host||v_path||case when v_query is null then '' else '?'||v_query end;
end $$;
create function dailyhouse_private.source_url_key(p_url text) returns text
language plpgsql immutable set search_path='' as $$
declare v_parts text[]; v_host text; v_path text; v_bvid text; v_params jsonb;
begin
  if p_url='' then return null; end if;
  v_parts:=regexp_match(p_url,'^(https?)://([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$','i');
  if v_parts is null then raise exception using errcode='22023',message='Unsupported sync source'; end if;
  v_host:=lower(v_parts[2]); v_path:=coalesce(nullif(v_parts[3],''),'/');
  if lower(v_parts[1])='https' then v_host:=regexp_replace(v_host,':443$',''); else v_host:=regexp_replace(v_host,':80$',''); end if;
  if v_host in ('bilibili.com','www.bilibili.com','m.bilibili.com') then
    v_bvid:=substring(v_path from '^/video/(BV[0-9A-Za-z]{10})/?$');
    if v_bvid is not null then return 'bilibili:'||v_bvid; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(name,value) order by name collate "C",ordinality),'[]'::jsonb) into v_params
    from (select ordinality,dailyhouse_private.query_value(split_part(part,'=',1)) as name,
      dailyhouse_private.query_value(case when strpos(part,'=')>0 then substring(part from strpos(part,'=')+1) else '' end) as value
      from unnest(string_to_array(coalesce(v_parts[4],''),'&')) with ordinality as p(part,ordinality) where part<>'') q
    where name !~* '^(utm_.+|spm|spm_id_from|from_spmid|vd_source|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref_src|ref_url|share_source|share_medium|share_plat|share_session_id|share_tag)$';
  return lower(v_parts[1])||'://'||v_host||v_path||v_params::text;
end $$;
create function dailyhouse_private.text_array(p_value jsonb,p_count integer,p_length integer,p_unique boolean default false) returns boolean
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_value)>p_count or exists(select 1 from jsonb_array_elements(p_value) e where not dailyhouse_private.text_value(e,p_length,true)) then return false; end if;
  return not p_unique or (select count(*)=count(distinct value) from jsonb_array_elements(p_value));
end $$;
create function dailyhouse_private.source_snapshot(p_value jsonb,p_depth integer default 0) returns boolean
language plpgsql immutable set search_path='' as $$
declare v_child jsonb;
begin
  if p_depth>8 or not dailyhouse_private.fields(p_value,array['id','title','body','updatedAt','sources'],array['id','title','body','updatedAt'])
    or not dailyhouse_private.idea_id(p_value->'id') or not dailyhouse_private.text_value(p_value->'title',200,true)
    or not dailyhouse_private.text_value(p_value->'body',100000) or not dailyhouse_private.timestamp_value(p_value->'updatedAt') then return false; end if;
  if p_value ? 'sources' then
    if jsonb_typeof(p_value->'sources') is distinct from 'array' or jsonb_array_length(p_value->'sources')>8 then return false; end if;
    for v_child in select value from jsonb_array_elements(p_value->'sources') loop
      if not dailyhouse_private.source_snapshot(v_child,p_depth+1) then return false; end if;
    end loop;
    if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_value->'sources')) then return false; end if;
  end if; return true;
end $$;
create function dailyhouse_private.entries(p_kind text,p_entries jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v_entry jsonb; v_link jsonb; v_index integer:=0;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_entries)>5000 or (p_kind='idea' and jsonb_array_length(p_entries)=0) then return false; end if;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    if not dailyhouse_private.fields(v_entry,case when p_kind='idea' then array['id','kind','content','createdAt','updatedAt'] else array['id','kind','content','links','nextStep','nextStepId','createdAt','updatedAt','removedAt','expiresAt'] end,
      case when p_kind='idea' then array['id','kind','content','createdAt','updatedAt'] else array['id','kind','content','links','nextStep','nextStepId','createdAt','updatedAt'] end)
      or not dailyhouse_private.text_value(v_entry->'id',128,true) or not dailyhouse_private.text_value(v_entry->'content',20000,p_kind='idea')
      or not dailyhouse_private.timestamp_value(v_entry->'createdAt') or not dailyhouse_private.timestamp_value(v_entry->'updatedAt') then return false; end if;
    if p_kind='idea' then
      if coalesce(v_entry->>'kind','') not in ('initial','note','progress','decision','question') or (v_entry->>'kind'='initial')<>(v_index=0) then return false; end if;
    else
      if not dailyhouse_private.uuid_value(v_entry->'id') or not dailyhouse_private.uuid_value(v_entry->'nextStepId')
        or coalesce(v_entry->>'kind','') not in ('initial','progress','question','milestone','resource') or not dailyhouse_private.text_value(v_entry->'nextStep',200)
        or jsonb_typeof(v_entry->'links') is distinct from 'array' or jsonb_array_length(v_entry->'links')>20 then return false; end if;
      if v_entry->>'content'='' and jsonb_array_length(v_entry->'links')=0 then return false; end if;
      for v_link in select value from jsonb_array_elements(v_entry->'links') loop
        if not dailyhouse_private.fields(v_link,array['id','title','url'],array['id','title','url']) or not dailyhouse_private.uuid_value(v_link->'id')
          or not dailyhouse_private.text_value(v_link->'title',200,true) or not dailyhouse_private.url_value(v_link->'url',false) or length(v_link->>'url')>2048 then return false; end if;
      end loop;
      if (v_entry ? 'removedAt')<>(v_entry ? 'expiresAt') then return false; end if;
      if v_entry ? 'removedAt' then
        if not dailyhouse_private.timestamp_value(v_entry->'removedAt') or not dailyhouse_private.timestamp_value(v_entry->'expiresAt')
          or (v_entry->>'expiresAt')::timestamptz-(v_entry->>'removedAt')::timestamptz<>interval '30 days' then return false; end if;
      end if;
    end if;
    v_index:=v_index+1;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_entries)) then return false; end if;
  if p_kind='learning' and (select count(*)<>count(distinct link->>'id') from jsonb_array_elements(p_entries) e cross join lateral jsonb_array_elements(e->'links') link) then return false; end if;
  return true;
end $$;

-- authorize() already holds the owner-row lock. Preserve strict receipt order
-- for a canonical source even within one millisecond or after clock rollback.
create function dailyhouse_private.next_sync_time(p_source text) returns text
language sql volatile set search_path='' as $$
  select to_char(greatest(date_trunc('milliseconds',clock_timestamp()),
    (select max((value->>'syncedAt')::timestamptz)+interval '1 millisecond'
      from dailyhouse_private.records where source_key=p_source))
    at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create function dailyhouse_private.clean_expired() returns void
language plpgsql security definer set search_path='' as $$
begin
  update dailyhouse_private.records set version=version+1, live=false,
    value=(value - 'expiresAt') || jsonb_build_object('body',null,'version',version+1,'syncedAt',dailyhouse_private.next_sync_time(source_key))
  where value->'body' <> 'null'::jsonb and value ? 'expiresAt' and (value->>'expiresAt')::timestamptz <= clock_timestamp();
  -- Learning nodes have their own existing recovery deadline. Keep the plan,
  -- remove expired node content, and advance CAS so an offline body cannot
  -- silently reintroduce it or replay an old accepted node snapshot.
  update dailyhouse_private.records r set version=version+1,
    value=jsonb_set(value,'{body,entries}',(select coalesce(jsonb_agg(e order by ordinal),'[]'::jsonb)
      from jsonb_array_elements(r.value#>'{body,entries}') with ordinality as entry(e,ordinal)
      where not(e ? 'expiresAt') or (e->>'expiresAt')::timestamptz>clock_timestamp()))
      ||jsonb_build_object('version',version+1,'syncedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    where kind='learning' and value->'body'<>'null'::jsonb and exists(select 1 from jsonb_array_elements(r.value#>'{body,entries}') e
      where e ? 'expiresAt' and (e->>'expiresAt')::timestamptz<=clock_timestamp());
end
$$;

create function dailyhouse_private.no_private_fields(p_body jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v_key text; v_value jsonb;
begin
  if jsonb_typeof(p_body)='object' then
    for v_key,v_value in select key,value from jsonb_each(p_body) loop
      if v_key in ('path','cwd','vaultPath','calendarUrl','settings','token','password','accessToken','refreshToken','privateKey','conversations','drafts','threadId','codexProjectId','downloadUrl','excerpt','projectActions','resumeCommand') then return false; end if;
      if not dailyhouse_private.no_private_fields(v_value) then return false; end if;
    end loop;
  elsif jsonb_typeof(p_body)='array' then
    for v_value in select value from jsonb_array_elements(p_body) loop if not dailyhouse_private.no_private_fields(v_value) then return false; end if; end loop;
  end if;
  return true;
end $$;

create function dailyhouse_private.validate_record(p_record jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare v_kind text; v_id text; v_body jsonb; v_keys text[]; v_required text[]; v_deleted timestamptz; v_expires timestamptz; v_key text; v_source jsonb; v_attachment jsonb;
begin
  if not dailyhouse_private.fields(p_record,array['kind','id','body','deletedAt','expiresAt'],array['kind','id','body'])
    or jsonb_typeof(p_record->'kind') is distinct from 'string' or jsonb_typeof(p_record->'id') is distinct from 'string'
    or octet_length(p_record::text)>8388608 then raise exception using errcode='22023',message='Invalid sync record'; end if;
  v_kind:=p_record->>'kind'; v_id:=p_record->>'id'; v_body:=p_record->'body';
  if dailyhouse_private.scope_of(v_kind) is null or length(v_id) not between 1 and (case when v_kind='readingSuppression' then 4096 else 128 end)
    or v_id in ('__proto__','constructor','prototype') then raise exception using errcode='22023',message='Invalid sync record'; end if;
  if v_kind in ('todo','learning','gardenProject','project') and not dailyhouse_private.uuid_value(p_record->'id') then raise exception using errcode='22023',message='Invalid sync record'; end if;
  if v_kind in ('idea','ideaRemoved','ideaMeta') and not dailyhouse_private.idea_id(p_record->'id') then raise exception using errcode='22023',message='Invalid sync record'; end if;
  if v_kind in ('journal','journalSuppression') and not dailyhouse_private.date_value(p_record->'id') then raise exception using errcode='22023',message='Invalid sync record'; end if;
  if v_kind='readingReport' and (v_id !~ '^report:(tech|aesthetic):\d{4}-\d{2}-\d{2}$' or not dailyhouse_private.date_value(to_jsonb(split_part(v_id,':',3)))) then raise exception using errcode='22023',message='Invalid sync record'; end if;
  if v_kind='readingSuppression' and v_id !~ '^(file:[a-f0-9]{64}|bilibili:BV[0-9A-Za-z]{10})$'
    and dailyhouse_private.canonical_url(v_id) is distinct from v_id then raise exception using errcode='22023',message='Invalid sync record'; end if;
  if p_record ? 'deletedAt' then
    if not dailyhouse_private.timestamp_value(p_record->'deletedAt') then raise exception using errcode='22023',message='Invalid recovery deadline'; end if;
    v_deleted:=(p_record->>'deletedAt')::timestamptz;
  end if;
  if p_record ? 'expiresAt' then
    if not dailyhouse_private.timestamp_value(p_record->'expiresAt') then raise exception using errcode='22023',message='Invalid recovery deadline'; end if;
    v_expires:=(p_record->>'expiresAt')::timestamptz;
  end if;
  if (v_body='null'::jsonb and v_expires is not null) or (v_expires is not null and (v_deleted is null or v_expires-v_deleted<>interval '30 days'))
    or (v_body<>'null'::jsonb and v_deleted is not null and v_expires is null) then raise exception using errcode='22023',message='Invalid recovery deadline'; end if;
  if v_body='null'::jsonb then return p_record; end if;
  if v_deleted is not null and v_kind not in ('reading','idea','learning','gardenProject','journal','project') then raise exception using errcode='22023',message='Invalid recovery deadline'; end if;
  if jsonb_typeof(v_body)<>'object' or not dailyhouse_private.no_private_fields(v_body) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  v_keys:=case v_kind
    when 'todo' then array['id','title','done','createdAt','dueDate','source']
    when 'reading' then array['id','title','type','url','notes','status','category','finishedAt','sourceKey','addedAt','updatedAt','origin','reportSource','reportDate','coverageDate','attachmentMetadata','manualCategory']
    when 'readingReport' then array['status','hidden','category','finishedAt']
    when 'readingSuppression' then array['removedAt'] when 'readingExpired' then array['expiredAt']
    when 'idea' then array['id','title','status','createdAt','updatedAt','entries'] when 'ideaRemoved' then array['removed']
    when 'learning' then array['id','title','course','goal','nextStep','nextStepId','dueDate','status','createdAt','updatedAt','entries']
    when 'ideaMeta' then array['id','tags','pinned','sources']
    when 'gardenProject' then array['id','title','goal','mvp','acceptance','nextStep','nextStepId','sourceBubbleId','sourceSnapshot','status','createdAt','updatedAt','todoId','finishedAt']
    when 'project' then array['id','title','goal','decisions','progress','nextStep','repoUrl','sourceIdeaId','createdAt','updatedAt']
    when 'journal' then array['date','timezone','title','codex','life','reflection','status','lifeState','createdAt','updatedAt','editedFields','writer']
    when 'journalSuppression' then array['deleted'] else array[]::text[] end;
  v_required:=case v_kind when 'todo' then array['id','title','done','createdAt','dueDate']
    when 'reading' then array['id','title','type','url','notes','status','addedAt','updatedAt','origin']
    when 'readingReport' then array['status'] when 'readingSuppression' then array['removedAt'] when 'readingExpired' then array['expiredAt']
    when 'idea' then v_keys when 'ideaRemoved' then v_keys when 'learning' then v_keys when 'ideaMeta' then v_keys
    when 'gardenProject' then array['id','title','goal','mvp','acceptance','nextStep','nextStepId','sourceBubbleId','sourceSnapshot','status','createdAt','updatedAt']
    when 'project' then array['id','title','goal','decisions','progress','nextStep','repoUrl','createdAt','updatedAt']
    when 'journal' then v_keys when 'journalSuppression' then v_keys else array[]::text[] end;
  if not dailyhouse_private.fields(v_body,v_keys,v_required)
    or (v_kind in ('todo','reading','idea','learning','ideaMeta','gardenProject','project') and (v_body->>'id' is distinct from v_id))
    or (v_kind='journal' and (v_body->>'date' is distinct from v_id or v_body->>'timezone' is distinct from 'America/New_York'))
    or (v_kind='todo' and (jsonb_typeof(v_body->'done') is distinct from 'boolean' or length(btrim(v_body->>'title')) not between 1 and 200))
    or (v_kind='reading' and (coalesce(v_body->>'status','') not in ('unread','reading','done') or coalesce(v_body->>'origin','') not in ('manual','report')))
    then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  foreach v_key in array array['createdAt','updatedAt','addedAt','finishedAt','removedAt','expiredAt'] loop
    if v_body ? v_key and not dailyhouse_private.timestamp_value(v_body->v_key) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  end loop;
  foreach v_key in array array['dueDate','reportDate','coverageDate'] loop
    if v_body ? v_key and not(v_key='dueDate' and v_body->v_key='null'::jsonb) and not dailyhouse_private.date_value(v_body->v_key) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  end loop;
  if v_body ? 'title' and not dailyhouse_private.text_value(v_body->'title',case when v_kind='reading' then 300 when v_kind='journal' then 160 when v_kind='gardenProject' then 120 else 200 end,true) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  if v_kind in ('reading','readingReport') then
    if coalesce(v_body->>'status','') not in ('unread','reading','done') or (v_body ? 'category' and coalesce(v_body->>'category','') not in ('programming_ai','technology','design','science','humanities','language','business','career','life','other','programming','ai'))
      or (v_body ? 'hidden' and jsonb_typeof(v_body->'hidden') is distinct from 'boolean') then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  end if;
  if v_kind='todo' and v_body ? 'source' then
    v_source:=v_body->'source';
    if not dailyhouse_private.fields(v_source,array['kind','id','title','type','url','stepId'],array['kind','id','title','url']) or not dailyhouse_private.text_value(v_source->'id',128,true)
      or not dailyhouse_private.text_value(v_source->'title',300,true) or coalesce(v_source->>'kind','') not in ('reading','learning') then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
    if v_source->>'kind'='learning' then
      if not dailyhouse_private.uuid_value(v_source->'id') or not dailyhouse_private.uuid_value(v_source->'stepId') or v_source ? 'type' or v_source->>'url' is distinct from '#/learning/'||(v_source->>'id') then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
    elsif not dailyhouse_private.url_value(v_source->'url') or coalesce(v_source->>'type','') not in ('book','video','course','tutorial','github','article') or v_source ? 'stepId' then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  end if;
  if v_kind='reading' then
    if coalesce(v_body->>'type','') not in ('book','video','course','tutorial','github','article') or not dailyhouse_private.url_value(v_body->'url') or not dailyhouse_private.text_value(v_body->'notes',10000)
      or (v_body ? 'manualCategory' and jsonb_typeof(v_body->'manualCategory') is distinct from 'boolean')
      or (v_body ? 'reportSource' and coalesce(v_body->>'reportSource','') not in ('tech','aesthetic')) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
    if v_body ? 'attachmentMetadata' then
      v_attachment:=v_body->'attachmentMetadata';
      if not dailyhouse_private.fields(v_attachment,array['id','name','size','mime','extension'],array['id','name','size','mime','extension'])
        or not dailyhouse_private.text_value(v_attachment->'name',200,true) or (v_attachment->>'name') ~ '[\\/:<>"|?*[:cntrl:]]' or (v_attachment->>'name') ~ '^\.|[. ]$'
        or coalesce(v_attachment->>'id','') !~ '^[a-f0-9]{64}\.(pdf|epub|md|txt)$' or split_part(v_attachment->>'id','.',2) is distinct from v_attachment->>'extension'
        or jsonb_typeof(v_attachment->'size') is distinct from 'number' or coalesce(v_attachment->>'size','') !~ '^[0-9]{1,8}$' then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
      if (v_attachment->>'size')::bigint not between 1 and 52428800 or v_attachment->>'mime' is distinct from (case v_attachment->>'extension' when 'pdf' then 'application/pdf' when 'epub' then 'application/epub+zip' else 'text/plain; charset=utf-8' end) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
    end if;
    if v_body ? 'sourceKey' then
      if not dailyhouse_private.text_value(v_body->'sourceKey',4096,true) or (coalesce(v_body->>'sourceKey','') !~ '^(file:[a-f0-9]{64}|bilibili:BV[0-9A-Za-z]{10})$' and not dailyhouse_private.url_value(v_body->'sourceKey',false)) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
      if v_body->>'sourceKey' !~ '^(file:|bilibili:)' and dailyhouse_private.canonical_url(v_body->>'sourceKey') is distinct from v_body->>'sourceKey' then raise exception using errcode='22023',message='Unsupported sync source'; end if;
      if v_body->>'sourceKey' ~ '^file:' and v_body->>'sourceKey' is distinct from 'file:'||split_part(v_attachment->>'id','.',1) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
      if v_body->>'sourceKey' !~ '^file:' then
        if (v_body->>'sourceKey' ~ '^bilibili:' and dailyhouse_private.source_url_key(v_body->>'url') is distinct from v_body->>'sourceKey')
          or (v_body->>'sourceKey' !~ '^bilibili:' and dailyhouse_private.source_url_key(v_body->>'url') is distinct from dailyhouse_private.source_url_key(v_body->>'sourceKey')) then raise exception using errcode='22023',message='Unsupported sync source'; end if;
      end if;
    end if;
  elsif v_kind in ('idea','learning') then
    if not dailyhouse_private.entries(v_kind,v_body->'entries') or (v_kind='idea' and coalesce(v_body->>'status','') not in ('growing','parked','done'))
      or (v_kind='learning' and (coalesce(v_body->>'status','') not in ('active','paused','done') or not dailyhouse_private.text_value(v_body->'course',200)
        or not dailyhouse_private.text_value(v_body->'goal',4000) or not dailyhouse_private.text_value(v_body->'nextStep',200) or not dailyhouse_private.uuid_value(v_body->'nextStepId'))) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  elsif v_kind='ideaMeta' then
    if jsonb_typeof(v_body->'pinned') is distinct from 'boolean' or not dailyhouse_private.text_array(v_body->'tags',8,32,true) or jsonb_typeof(v_body->'sources') is distinct from 'array' or jsonb_array_length(v_body->'sources')>8 then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
    for v_source in select value from jsonb_array_elements(v_body->'sources') loop if not dailyhouse_private.source_snapshot(v_source) then raise exception using errcode='22023',message='Unsupported sync fields'; end if; end loop;
    if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(v_body->'sources')) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  elsif v_kind='gardenProject' then
    if not dailyhouse_private.text_value(v_body->'goal',2000,true) or not dailyhouse_private.text_value(v_body->'nextStep',200,true) or not dailyhouse_private.uuid_value(v_body->'nextStepId')
      or not dailyhouse_private.idea_id(v_body->'sourceBubbleId') or not dailyhouse_private.source_snapshot(v_body->'sourceSnapshot') or not dailyhouse_private.text_array(v_body->'mvp',12,1000)
      or not dailyhouse_private.text_array(v_body->'acceptance',12,1000) or coalesce(v_body->>'status','') not in ('active','done','archived') or (v_body ? 'todoId' and not dailyhouse_private.uuid_value(v_body->'todoId')) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  elsif v_kind='project' then
    if not dailyhouse_private.text_value(v_body->'goal',20000,true) or not dailyhouse_private.text_value(v_body->'progress',20000) or not dailyhouse_private.text_value(v_body->'nextStep',2000)
      or not dailyhouse_private.text_value(v_body->'decisions',20000) or not dailyhouse_private.text_value(v_body->'repoUrl',500)
      or (v_body->>'repoUrl'<>'' and v_body->>'repoUrl' !~ '^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') or (v_body ? 'sourceIdeaId' and not dailyhouse_private.idea_id(v_body->'sourceIdeaId')) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  elsif v_kind='journal' then
    if not dailyhouse_private.text_value(v_body->'codex',24000) or not dailyhouse_private.text_value(v_body->'life',24000) or not dailyhouse_private.text_value(v_body->'reflection',12000)
      or (v_body->>'codex'='' and v_body->>'life'='' and v_body->>'reflection'='') or coalesce(v_body->>'status','') not in ('draft','final') or coalesce(v_body->>'lifeState','') not in ('waiting','provided','skipped')
      or (v_body->>'lifeState'='provided' and v_body->>'life'='') or coalesce(v_body->>'writer','') not in ('codex','manual') or not dailyhouse_private.text_array(v_body->'editedFields',6,16,true)
      or exists(select 1 from jsonb_array_elements_text(v_body->'editedFields') f where f not in ('title','codex','life','reflection','status','lifeState')) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
    foreach v_key in array array['title','codex','life','reflection'] loop if v_body->>v_key is distinct from btrim(v_body->>v_key) then raise exception using errcode='22023',message='Unsupported sync fields'; end if; end loop;
  elsif (v_kind='ideaRemoved' and v_body->'removed' is distinct from 'true'::jsonb) or (v_kind='journalSuppression' and v_body->'deleted' is distinct from 'true'::jsonb) then raise exception using errcode='22023',message='Unsupported sync fields'; end if;
  return p_record;
end $$;

create function dailyhouse_private.sync_pull(p_device_id uuid,p_device_key text,p_scopes text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_device dailyhouse_private.devices; v_items jsonb;
begin
  v_device:=dailyhouse_private.authorize(p_device_id,p_device_key);
  if p_scopes is null or cardinality(p_scopes)>6 or not(p_scopes <@ v_device.scopes) then raise exception using errcode='42501',message='Unauthorized sync scope'; end if;
  perform dailyhouse_private.clean_expired();
  select coalesce(jsonb_agg(value order by kind,id),'[]'::jsonb) into v_items from dailyhouse_private.records where dailyhouse_private.scope_of(kind)=any(p_scopes);
  if jsonb_array_length(v_items)>50000 or octet_length(v_items::text)>67108864 then raise exception using errcode='54000',message='Sync scope too large'; end if;
  return jsonb_build_object('items',v_items,'complete',true);
end $$;

create function dailyhouse_private.sync_push(p_device_id uuid,p_device_key text,p_operation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_device dailyhouse_private.devices; v_record jsonb; v_kind text; v_id text; v_op uuid; v_base bigint; v_action text; v_hash bytea;
  v_prior dailyhouse_private.operations; v_current dailyhouse_private.records; v_duplicate dailyhouse_private.records; v_next jsonb; v_result jsonb; v_status text; v_source text;
begin
  v_device:=dailyhouse_private.authorize(p_device_id,p_device_key);
  if not dailyhouse_private.fields(p_operation,array['id','record','baseVersion','action'],array['id','record','baseVersion','action'])
    or not dailyhouse_private.uuid_value(p_operation->'id') or jsonb_typeof(p_operation->'baseVersion') is distinct from 'number' or coalesce(p_operation->>'baseVersion','') !~ '^[0-9]{1,16}$'
    or coalesce(p_operation->>'action','') not in ('upsert','delete','restore','purge') then raise exception using errcode='22023',message='Invalid sync operation'; end if;
  v_op:=(p_operation->>'id')::uuid; v_base:=(p_operation->>'baseVersion')::bigint; v_action:=p_operation->>'action';
  if v_base>9007199254740991 then raise exception using errcode='22023',message='Invalid sync version'; end if;
  v_record:=dailyhouse_private.validate_record(p_operation->'record'); v_kind:=v_record->>'kind'; v_id:=v_record->>'id';
  if not(dailyhouse_private.scope_of(v_kind)=any(v_device.scopes)) then raise exception using errcode='42501',message='Unauthorized sync scope'; end if;
  v_hash:=sha256(convert_to(p_operation::text,'UTF8'));
  perform dailyhouse_private.clean_expired();
  select * into v_prior from dailyhouse_private.operations where device_id=p_device_id and operation_id=v_op;
  if found then
    if v_prior.fingerprint<>v_hash then raise exception using errcode='22023',message='Retry cannot change its operation'; end if;
    select * into v_current from dailyhouse_private.records where kind=v_prior.result_kind and id=v_prior.result_id;
    return jsonb_build_object('status',case when v_prior.result_status='accepted' and v_current.version=v_prior.result_version then 'accepted' else 'conflict' end,'record',v_current.value);
  end if;
  select * into v_current from dailyhouse_private.records where kind=v_kind and id=v_id;
  if v_kind='reading' and v_record->'body'<>'null'::jsonb then
    v_source:=case when v_record#>>'{body,sourceKey}' ~ '^file:' then v_record#>>'{body,sourceKey}' else dailyhouse_private.source_url_key(coalesce(v_record#>>'{body,url}','')) end;
  elsif v_kind='readingSuppression' then
    v_source:=case when v_id ~ '^(file:|bilibili:)' then v_id else dailyhouse_private.source_url_key(v_id) end;
  elsif v_kind='reading' and v_record->'body'='null'::jsonb then
    v_source:=v_current.source_key;
  end if;
  if v_kind='reading' and v_record->'body'<>'null'::jsonb and not(v_record ? 'deletedAt') and v_source is not null then
    select * into v_duplicate from dailyhouse_private.records where kind='reading' and id<>v_id and live and source_key=v_source limit 1;
    if v_duplicate.kind is null and not(v_action='restore' and v_current.kind is not null and v_current.value->'body'<>'null'::jsonb and v_current.value ? 'deletedAt' and v_current.value ? 'expiresAt') then
      -- Removal suppression outlives the recoverable snapshot. An independently
      -- collected old record with a different UUID cannot revive this source.
      select * into v_duplicate from dailyhouse_private.records where kind='readingSuppression' and live and source_key=v_source limit 1;
      if v_duplicate.kind is null then
        -- The deleted reading itself closes the gap before its separately
        -- queued suppression marker arrives. Only a newer server-accepted
        -- explicit marker removal permits a new identity for that source.
        select * into v_duplicate from dailyhouse_private.records deleted
          where deleted.kind='reading' and deleted.id<>v_id and not deleted.live and deleted.source_key=v_source
          and not exists(select 1 from dailyhouse_private.records cleared where cleared.kind='readingSuppression'
            and cleared.source_key=v_source and cleared.value->'body'='null'::jsonb
            and (cleared.value->>'syncedAt')::timestamptz > (deleted.value->>'syncedAt')::timestamptz)
          order by (deleted.value->>'syncedAt')::timestamptz desc limit 1;
      end if;
    end if;
  end if;
  if v_duplicate.kind is not null then v_current:=v_duplicate; v_status:='conflict';
  elsif coalesce(v_current.version,0)<>v_base or (v_current.kind is not null and (v_current.value ? 'deletedAt' or v_current.value->'body'='null'::jsonb)
    and not(v_record ? 'deletedAt') and v_record->'body'<>'null'::jsonb and (v_action<>'restore' or v_current.value->'body'='null'::jsonb)) then v_status:='conflict';
  else
    if (v_action='purge' and v_record->'body'<>'null'::jsonb) or (v_action='delete' and not(v_record ? 'deletedAt'))
      or (v_action in ('upsert','restore') and (v_record ? 'deletedAt' or v_record->'body'='null'::jsonb)) then raise exception using errcode='22023',message='Deletion intent mismatch'; end if;
    v_next:=v_record || jsonb_build_object('version',coalesce(v_current.version,0)+1,'sourceDeviceId',p_device_id,'sourceDeviceName',v_device.name,'syncedAt',dailyhouse_private.next_sync_time(v_source));
    insert into dailyhouse_private.records(kind,id,value,version,source_key,live) values(v_kind,v_id,v_next,coalesce(v_current.version,0)+1,v_source,v_record->'body'<>'null'::jsonb and not(v_record ? 'deletedAt'))
      on conflict(kind,id) do update set value=excluded.value,version=excluded.version,source_key=excluded.source_key,live=excluded.live;
    select * into v_current from dailyhouse_private.records where kind=v_kind and id=v_id; v_status:='accepted';
  end if;
  insert into dailyhouse_private.operations(device_id,operation_id,fingerprint,result_status,result_kind,result_id,result_version)
    values(p_device_id,v_op,v_hash,v_status,coalesce(v_current.kind,v_kind),coalesce(v_current.id,v_id),coalesce(v_current.version,0));
  return jsonb_build_object('status',v_status,'record',v_current.value);
end $$;

create function dailyhouse_private.sync_devices(p_device_id uuid,p_device_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform dailyhouse_private.authorize(p_device_id,p_device_key);
  return jsonb_build_object('items',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'scopes',scopes,'revoked',revoked,'administrator',administrator,'lastSeenAt',last_seen_at) order by id),'[]'::jsonb) from dailyhouse_private.devices));
end $$;
create function dailyhouse_private.sync_revoke(p_device_id uuid,p_device_key text,p_target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_device dailyhouse_private.devices;
begin
  v_device:=dailyhouse_private.authorize(p_device_id,p_device_key);
  if not v_device.administrator then raise exception using errcode='42501',message='Device administrator required'; end if;
  update dailyhouse_private.devices set revoked=true where id=p_target_id;
  if not found then raise exception using errcode='22023',message='Device not found'; end if;
  return jsonb_build_object('revoked',true);
end $$;
create function dailyhouse_private.sync_probe(p_device_id uuid,p_device_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_device dailyhouse_private.devices;
begin
  v_device:=dailyhouse_private.authorize(p_device_id,p_device_key);
  return jsonb_build_object('deviceId',v_device.id,'name',v_device.name,'scopes',v_device.scopes,'administrator',v_device.administrator);
end $$;

create function public.dailyhouse_sync_pull(p_device_id uuid,p_device_key text,p_scopes text[]) returns jsonb language sql security invoker set search_path='' as $$ select dailyhouse_private.sync_pull(p_device_id,p_device_key,p_scopes) $$;
create function public.dailyhouse_sync_push(p_device_id uuid,p_device_key text,p_operation jsonb) returns jsonb language sql security invoker set search_path='' as $$ select dailyhouse_private.sync_push(p_device_id,p_device_key,p_operation) $$;
create function public.dailyhouse_sync_devices(p_device_id uuid,p_device_key text) returns jsonb language sql security invoker set search_path='' as $$ select dailyhouse_private.sync_devices(p_device_id,p_device_key) $$;
create function public.dailyhouse_sync_revoke(p_device_id uuid,p_device_key text,p_target_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select dailyhouse_private.sync_revoke(p_device_id,p_device_key,p_target_id) $$;
create function public.dailyhouse_sync_probe(p_device_id uuid,p_device_key text) returns jsonb language sql security invoker set search_path='' as $$ select dailyhouse_private.sync_probe(p_device_id,p_device_key) $$;
revoke all on all functions in schema dailyhouse_private from public, anon, authenticated;
revoke all on function public.dailyhouse_sync_pull(uuid,text,text[]),public.dailyhouse_sync_push(uuid,text,jsonb),public.dailyhouse_sync_devices(uuid,text),public.dailyhouse_sync_revoke(uuid,text,uuid),public.dailyhouse_sync_probe(uuid,text) from public, anon, authenticated;
grant usage on schema dailyhouse_private to authenticated;
grant execute on function dailyhouse_private.sync_pull(uuid,text,text[]),dailyhouse_private.sync_push(uuid,text,jsonb),dailyhouse_private.sync_devices(uuid,text),dailyhouse_private.sync_revoke(uuid,text,uuid),dailyhouse_private.sync_probe(uuid,text) to authenticated;
grant execute on function public.dailyhouse_sync_pull(uuid,text,text[]),public.dailyhouse_sync_push(uuid,text,jsonb),public.dailyhouse_sync_devices(uuid,text),public.dailyhouse_sync_revoke(uuid,text,uuid),public.dailyhouse_sync_probe(uuid,text) to authenticated;
