-- array_to_string is only STABLE, so it cannot be used in a generated column.
-- For text arrays with a constant separator the result never changes, which makes this wrapper safe to mark IMMUTABLE.
create or replace function immutable_array_to_string(items text[], separator text) returns text
language sql immutable parallel safe
set search_path = ''
as $$ select coalesce(pg_catalog.array_to_string(items, separator), '') $$;
