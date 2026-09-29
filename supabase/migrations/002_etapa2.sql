-- =====================================================================
-- 002_etapa2.sql — mensalidade por jogador, auditoria de pagamentos,
-- normalização de mes_referencia e índice por mês.
-- Idempotente. Rode DEPOIS do 001_etapa1.sql.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. players.valor_mensalidade (nulo = usa settings.valor_mensalidade_padrao)
-- ---------------------------------------------------------------------
alter table public.players
  add column if not exists valor_mensalidade numeric(10,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'players_valor_mensalidade_nao_negativo'
      and conrelid = 'public.players'::regclass
  ) then
    alter table public.players
      add constraint players_valor_mensalidade_nao_negativo
      check (valor_mensalidade is null or valor_mensalidade >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. payment_records: pago_em, updated_at, updated_by
-- ---------------------------------------------------------------------
alter table public.payment_records
  add column if not exists pago_em    timestamptz;
alter table public.payment_records
  add column if not exists updated_at timestamptz default now();
alter table public.payment_records
  add column if not exists updated_by uuid default auth.uid();

-- Trigger: todo UPDATE carimba updated_at e updated_by.
-- Se não houver usuário (ex.: SQL editor), mantém o updated_by anterior.
create or replace function public.payment_records_set_updated()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end;
$$;

drop trigger if exists payment_records_set_updated on public.payment_records;
create trigger payment_records_set_updated
  before update on public.payment_records
  for each row execute function public.payment_records_set_updated();

-- ---------------------------------------------------------------------
-- 3. Normaliza mes_referencia para o dia 1 do mês.
--    Aborta (sem alterar nada) se a normalização gerar duplicidade
--    jogador + mês — nesse caso resolva manualmente e rode de novo.
-- ---------------------------------------------------------------------
do $$
declare
  duplicados integer;
begin
  select count(*) into duplicados
  from (
    select player_id, date_trunc('month', mes_referencia::timestamp)::date
    from public.payment_records
    group by 1, 2
    having count(*) > 1
  ) d;

  if duplicados > 0 then
    raise exception
      'Normalização abortada: % combinação(ões) jogador+mês ficariam duplicadas. Resolva os registros duplicados antes de rodar esta migração.',
      duplicados;
  end if;

  update public.payment_records
     set mes_referencia = date_trunc('month', mes_referencia::timestamp)::date
   where mes_referencia <> date_trunc('month', mes_referencia::timestamp)::date;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_records_mes_referencia_dia_1'
      and conrelid = 'public.payment_records'::regclass
  ) then
    alter table public.payment_records
      add constraint payment_records_mes_referencia_dia_1
      check (extract(day from mes_referencia) = 1);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Garante a chave única (player_id, mes_referencia), usada pelo
--    upsert com ignoreDuplicates de "Abrir mês" / "Sincronizar ativos".
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_index ix
    where ix.indrelid = 'public.payment_records'::regclass
      and ix.indisunique
      and ix.indpred is null
      and ix.indnkeyatts = 2
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from pg_attribute a
        where a.attrelid = ix.indrelid
          and a.attnum = any (ix.indkey)
      ) = array['mes_referencia', 'player_id']::text[]
  ) then
    alter table public.payment_records
      add constraint payment_records_player_mes_unique
      unique (player_id, mes_referencia);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Índice por mês
-- ---------------------------------------------------------------------
create index if not exists payment_records_mes_referencia_idx
  on public.payment_records (mes_referencia);

commit;
