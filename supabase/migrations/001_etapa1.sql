-- =====================================================================
-- 001_etapa1.sql — schema base: players, payment_records, settings + RLS
-- Idempotente: pode ser executado mais de uma vez sem efeito colateral.
-- Rode ANTES do 002_etapa2.sql.
-- =====================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Jogadores. Nunca são apagados: "excluir" = marcar ativo = false.
-- ---------------------------------------------------------------------
create table if not exists public.players (
  id             uuid primary key default gen_random_uuid(),
  nome           text        not null check (length(trim(nome)) > 0),
  apelido        text        not null check (length(trim(apelido)) > 0),
  telefone       text,                       -- só dígitos, com 55 na frente
  numero_camisa  integer     check (numero_camisa is null or numero_camisa between 0 and 999),
  observacoes    text,
  ativo          boolean     not null default true,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Um registro por jogador por mês. mes_referencia é sempre o dia 1.
-- ---------------------------------------------------------------------
create table if not exists public.payment_records (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid        not null references public.players (id) on delete restrict,
  mes_referencia  date        not null,
  status          text        not null default 'pendente'
                              check (status in ('pago', 'pendente', 'isento')),
  valor           numeric(10,2) not null default 0 check (valor >= 0),
  created_at      timestamptz not null default now(),
  constraint payment_records_player_mes_unique unique (player_id, mes_referencia)
);

create index if not exists payment_records_player_id_idx
  on public.payment_records (player_id);

-- ---------------------------------------------------------------------
-- Configurações globais: uma única linha (id = 1).
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id                        integer primary key default 1 check (id = 1),
  valor_mensalidade_padrao  numeric(10,2) not null default 0 check (valor_mensalidade_padrao >= 0),
  updated_at                timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- RLS: somente usuários autenticados (os organizadores) acessam.
-- Não há policy de DELETE: jogadores e pagamentos não podem ser apagados
-- pelo app (soft-delete via players.ativo).
-- Lembrete: desative o cadastro público em Authentication > Providers >
-- Email ("Allow new users to sign up") e crie os usuários pelo painel.
-- ---------------------------------------------------------------------
alter table public.players         enable row level security;
alter table public.payment_records enable row level security;
alter table public.settings        enable row level security;

drop policy if exists "players_select_auth" on public.players;
drop policy if exists "players_insert_auth" on public.players;
drop policy if exists "players_update_auth" on public.players;
create policy "players_select_auth" on public.players
  for select to authenticated using (true);
create policy "players_insert_auth" on public.players
  for insert to authenticated with check (true);
create policy "players_update_auth" on public.players
  for update to authenticated using (true) with check (true);

drop policy if exists "payment_records_select_auth" on public.payment_records;
drop policy if exists "payment_records_insert_auth" on public.payment_records;
drop policy if exists "payment_records_update_auth" on public.payment_records;
create policy "payment_records_select_auth" on public.payment_records
  for select to authenticated using (true);
create policy "payment_records_insert_auth" on public.payment_records
  for insert to authenticated with check (true);
create policy "payment_records_update_auth" on public.payment_records
  for update to authenticated using (true) with check (true);

drop policy if exists "settings_select_auth" on public.settings;
drop policy if exists "settings_insert_auth" on public.settings;
drop policy if exists "settings_update_auth" on public.settings;
create policy "settings_select_auth" on public.settings
  for select to authenticated using (true);
create policy "settings_insert_auth" on public.settings
  for insert to authenticated with check (id = 1);
create policy "settings_update_auth" on public.settings
  for update to authenticated using (true) with check (id = 1);

commit;
