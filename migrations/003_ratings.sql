alter table games add column score_text text;
alter table games add column rating_before double precision;
alter table games add column rating_after double precision;

create table rating_events (
  sub text not null,
  game_id text not null,
  rating_before double precision not null,
  rating_after double precision not null,
  result text not null,
  score_estimate text,
  suggestion text,
  created_at timestamptz not null default now(),
  primary key (sub, game_id)
);
