-- Chat thread paging (CLAUDE.md §8 F12 "Messages").
insert into settings (key, value_type, default_value, min_sample, unit, description) values
  ('chat.messagesPerPage', 'integer', '50'::jsonb, 0, 'messages', 'Messages loaded at a time when a conversation opens or scrolls back')
on conflict (key) do nothing;
