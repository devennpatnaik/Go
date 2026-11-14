create table games (
  id text primary key,
  size integer not null,
  rules_id text not null default 'chinese-area-1',
  komi numeric not null default 7.5,
  phase text not null,
  to_play text,
  black_sub text,
  white_sub text,
  black_main_ms integer not null default 600000,
  white_main_ms integer not null default 600000,
  black_periods integer not null default 3,
  white_periods integer not null default 3,
  turn_started_at timestamptz,
  winner text,
  result_reason text,
  black_score numeric,
  white_score numeric,
  stage text not null default 'production',
  created_at timestamptz not null default now()
);

create table moves (
  game_id text not null references games (id),
  move_number integer not null,
  color text not null,
  kind text not null,
  x integer,
  y integer,
  created_at timestamptz not null default now(),
  unique (game_id, move_number)
);
