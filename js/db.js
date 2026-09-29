// Camada de dados: ÚNICO arquivo que conversa com o Supabase.
// Toda função pública devolve { data, error }, com error = { message, code } em português.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { effectiveFee } from './utils.js';

const LOGIN_PAGE = 'login.html';

export const isConfigured =
  !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('SUA-ANON-KEY');

const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

const PLAYER_COLUMNS =
  'id, nome, apelido, telefone, numero_camisa, observacoes, ativo, valor_mensalidade, created_at';
const RECORD_COLUMNS =
  'id, player_id, mes_referencia, status, valor, pago_em, created_at, updated_at, updated_by';

// ---------------------------------------------------------------------
// Infra: sessão, redirecionamento e tradução de erros
// ---------------------------------------------------------------------

function isLoginPage() {
  return window.location.pathname.endsWith(`/${LOGIN_PAGE}`);
}

let redirecting = false;

export function redirectToLogin() {
  if (redirecting || isLoginPage()) return;
  redirecting = true;
  const here = window.location.pathname.split('/').pop() || 'index.html';
  const next = encodeURIComponent(`${here}${window.location.search}`);
  window.location.replace(`${LOGIN_PAGE}?next=${next}`);
}

if (supabase) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') redirectToLogin();
  });
}

function isAuthError(error) {
  const status = Number(error?.status);
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  return status === 401 || /PGRST301|PGRST302|jwt|refresh token/i.test(text);
}

const MISSING_MIGRATION =
  'O banco de dados não está atualizado. Rode as migrações em supabase/migrations (001 e 002).';

function translateError(error) {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');

  if (!isConfigured) return 'Configure SUPABASE_URL e SUPABASE_ANON_KEY em js/config.js.';
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Este e-mail ainda não foi confirmado.';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente de novo.';
  }
  if (isAuthError(error)) return 'Sua sessão expirou. Entre novamente.';
  if (code === '23505') return 'Já existe um registro igual a este.';
  if (code === '23514') return 'Algum valor informado não é aceito pelo banco (verifique os campos).';
  if (code === '23502') return 'Preencha todos os campos obrigatórios.';
  if (code === '23503') return 'Este registro está ligado a outro e não pode ser alterado assim.';
  if (code === '42501' || /row-level security/i.test(message)) {
    return 'Você não tem permissão para fazer isso.';
  }
  if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') {
    return MISSING_MIGRATION;
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
}

function fail(error) {
  if (error && isAuthError(error)) redirectToLogin();
  return { data: null, error: { message: translateError(error), code: error?.code ?? null } };
}

/** Executa uma query do supabase-js e padroniza o retorno. */
async function run(query, map = (d) => d) {
  if (!supabase) return fail({ message: 'not configured' });
  try {
    const { data, error, count } = await query;
    if (error) return fail(error);
    return { data: map(data, count), error: null };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------

export async function signIn(email, password) {
  return run(supabase?.auth.signInWithPassword({ email, password }), (d) => d.session);
}

export async function signOut() {
  if (!supabase) return { data: null, error: null };
  const { error } = await supabase.auth.signOut();
  if (error) return fail(error);
  return { data: true, error: null };
}

export async function getSession() {
  if (!supabase) return fail({ message: 'not configured' });
  return run(supabase.auth.getSession(), (d) => d.session);
}

/** Usado no topo de cada tela protegida: devolve a sessão ou redireciona para o login. */
export async function requireSession() {
  const { data: session } = await getSession();
  if (!session) {
    redirectToLogin();
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------
// Jogadores
// ---------------------------------------------------------------------

export async function listPlayers() {
  return run(supabase?.from('players').select(PLAYER_COLUMNS).order('apelido'));
}

/** Todos os jogadores, paginando (importação e exportação). */
export async function listAllPlayers() {
  if (!supabase) return fail({ message: 'not configured' });
  return fetchAll((from, to) =>
    supabase.from('players').select(PLAYER_COLUMNS).order('apelido').order('id').range(from, to),
  );
}

export async function getPlayer(id) {
  return run(supabase?.from('players').select(PLAYER_COLUMNS).eq('id', id).maybeSingle());
}

export async function createPlayer(player) {
  return run(supabase?.from('players').insert(player).select(PLAYER_COLUMNS).single());
}

export async function updatePlayer(id, patch) {
  return run(supabase?.from('players').update(patch).eq('id', id).select(PLAYER_COLUMNS).single());
}

/** Cadastro em lote (importação). Devolve os jogadores criados, na mesma ordem. */
export async function createPlayers(players) {
  if (players.length === 0) return { data: [], error: null };
  return run(supabase?.from('players').insert(players).select(PLAYER_COLUMNS), (d) => d ?? []);
}

/** Soft-delete: nunca apaga o jogador nem seus pagamentos. */
export async function setPlayerActive(id, ativo) {
  return updatePlayer(id, { ativo });
}

// ---------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------

export async function getSettings() {
  return run(
    supabase?.from('settings').select('id, valor_mensalidade_padrao, updated_at').eq('id', 1).maybeSingle(),
    (d) => d ?? { id: 1, valor_mensalidade_padrao: 0 },
  );
}

export async function updateSettings(patch) {
  return run(
    supabase
      ?.from('settings')
      .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() })
      .select('id, valor_mensalidade_padrao, updated_at')
      .single(),
  );
}

// ---------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------

export async function listPaymentsByMonth(mesReferencia) {
  return run(supabase?.from('payment_records').select(RECORD_COLUMNS).eq('mes_referencia', mesReferencia));
}

/** Registros entre dois meses (inclusive), no formato 'YYYY-MM-01'. */
export async function listPaymentsInRange(fromMes, toMes) {
  return run(
    supabase
      ?.from('payment_records')
      .select(RECORD_COLUMNS)
      .gte('mes_referencia', fromMes)
      .lte('mes_referencia', toMes),
  );
}

export async function listPaymentsByPlayer(playerId) {
  return run(
    supabase
      ?.from('payment_records')
      .select(RECORD_COLUMNS)
      .eq('player_id', playerId)
      .order('mes_referencia', { ascending: false }),
  );
}

export async function listPendingPayments() {
  return run(
    supabase?.from('payment_records').select('id, player_id, mes_referencia, valor').eq('status', 'pendente'),
  );
}

export async function countPaymentsInMonth(mesReferencia) {
  return run(
    supabase
      ?.from('payment_records')
      .select('id', { count: 'exact', head: true })
      .eq('mes_referencia', mesReferencia),
    (_d, count) => count ?? 0,
  );
}

const PAGE_SIZE = 1000; // limite padrão de linhas por requisição no Supabase

/** Lê todas as páginas de uma consulta (makeQuery recebe from/to e devolve a query com .range). */
async function fetchAll(makeQuery) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await run(makeQuery(from, from + PAGE_SIZE - 1));
    if (page.error) return page;
    all.push(...page.data);
    if (page.data.length < PAGE_SIZE) return { data: all, error: null };
  }
}

/** Todos os registros de pagamento (exportação, importação e backup). */
export async function listAllPayments() {
  if (!supabase) return fail({ message: 'not configured' });
  return fetchAll((from, to) =>
    supabase.from('payment_records').select(RECORD_COLUMNS).order('mes_referencia').order('id').range(from, to),
  );
}

/**
 * Grava registros importados (player_id, mes_referencia, status, valor, pago_em).
 * overwrite = false: upsert com ignoreDuplicates — registros existentes ficam intactos.
 * overwrite = true:  upsert em player_id + mes_referencia — atualiza os existentes.
 * Devolve só as linhas efetivamente inseridas/atualizadas.
 */
export async function upsertPaymentRecords(rows, { overwrite = false } = {}) {
  if (rows.length === 0) return { data: [], error: null };
  return run(
    supabase
      ?.from('payment_records')
      .upsert(rows, { onConflict: 'player_id,mes_referencia', ignoreDuplicates: !overwrite })
      .select('id, player_id, mes_referencia, status'),
    (d) => d ?? [],
  );
}

/** Backup completo: todas as colunas de players, payment_records e settings. */
export async function getBackupData() {
  if (!supabase) return fail({ message: 'not configured' });
  const [players, records, settings] = await Promise.all([
    fetchAll((from, to) => supabase.from('players').select('*').order('created_at').order('id').range(from, to)),
    fetchAll((from, to) =>
      supabase.from('payment_records').select('*').order('mes_referencia').order('id').range(from, to),
    ),
    run(supabase.from('settings').select('*')),
  ]);
  const error = players.error || records.error || settings.error;
  if (error) return { data: null, error };
  return { data: { players: players.data, records: records.data, settings: settings.data }, error: null };
}

/** patch pode conter status, pago_em e valor. updated_at/updated_by vêm do trigger. */
export async function updatePayment(id, patch) {
  return run(supabase?.from('payment_records').update(patch).eq('id', id).select(RECORD_COLUMNS).single());
}

function pendingRowFor(player, mesReferencia, settings) {
  return {
    player_id: player.id,
    mes_referencia: mesReferencia,
    status: 'pendente',
    valor: effectiveFee(player, settings),
    pago_em: null,
  };
}

/** Insere registros ignorando os que já existem (player_id + mes_referencia). Nunca altera existentes. */
async function insertIgnoringExisting(rows) {
  if (rows.length === 0) return { data: [], error: null };
  return run(
    supabase
      ?.from('payment_records')
      .upsert(rows, { onConflict: 'player_id,mes_referencia', ignoreDuplicates: true })
      .select(RECORD_COLUMNS),
    (d) => d ?? [],
  );
}

/**
 * "Abrir mês" e "Sincronizar ativos": cria um registro pendente para cada
 * jogador ativo que ainda não tem registro no mês.
 * Devolve { created: registros criados, activeCount }.
 */
export async function openMonth(mesReferencia) {
  const [players, settings] = await Promise.all([
    run(supabase?.from('players').select(PLAYER_COLUMNS).eq('ativo', true)),
    getSettings(),
  ]);
  if (players.error) return players;
  if (settings.error) return settings;

  const active = players.data;
  const semValor = active.filter((p) => effectiveFee(p, settings.data) <= 0);
  if (semValor.length > 0 && Number(settings.data.valor_mensalidade_padrao) <= 0) {
    return {
      data: null,
      error: {
        message: 'Defina o valor padrão da mensalidade em Configurações antes de abrir o mês.',
        code: 'NO_DEFAULT_FEE',
      },
    };
  }

  const rows = active.map((p) => pendingRowFor(p, mesReferencia, settings.data));
  const result = await insertIgnoringExisting(rows);
  if (result.error) return result;
  return { data: { created: result.data, activeCount: active.length }, error: null };
}

/**
 * Se o mês já estiver aberto, cria o registro pendente deste jogador.
 * Devolve { added: boolean, record }.
 */
export async function addPlayerToMonthIfOpen(player, mesReferencia) {
  if (!player?.ativo) return { data: { added: false, record: null }, error: null };
  const count = await countPaymentsInMonth(mesReferencia);
  if (count.error) return count;
  if (count.data === 0) return { data: { added: false, record: null }, error: null };

  const settings = await getSettings();
  if (settings.error) return settings;
  const result = await insertIgnoringExisting([pendingRowFor(player, mesReferencia, settings.data)]);
  if (result.error) return result;
  return { data: { added: result.data.length > 0, record: result.data[0] ?? null }, error: null };
}
