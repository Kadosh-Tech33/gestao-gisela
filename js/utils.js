// Utilidades puras (sem acesso ao Supabase nem ao DOM da página).

export const TIMEZONE = 'America/Sao_Paulo';

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// ---------------------------------------------------------------------
// Meses
// Um mês é representado pela string 'YYYY-MM-01' (mesmo formato que o
// Postgres devolve para mes_referencia). Nunca usar new Date('YYYY-MM-DD'):
// ele interpreta como UTC e, no Brasil, cai no mês anterior.
// ---------------------------------------------------------------------

export function monthKey(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

export function parseMonthKey(key) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(key ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Mês atual pelo calendário de America/Sao_Paulo, independente do fuso do aparelho. */
export function currentMonthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year').value);
  const month = Number(parts.find((p) => p.type === 'month').value);
  return monthKey(year, month);
}

/** Dia atual em America/Sao_Paulo: '2026-09-29' (usado em nomes de arquivo). */
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Date local (ano, mês, dia separados) — só para exibição/cálculo, nunca para gravar. */
export function monthKeyToDate(key) {
  const p = parseMonthKey(key);
  return p ? new Date(p.year, p.month - 1, 1) : null;
}

export function addMonths(key, delta) {
  const p = parseMonthKey(key);
  const index = p.year * 12 + (p.month - 1) + delta;
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** Lista de `count` meses terminando em `endKey`, do mais antigo para o mais recente. */
export function lastMonths(endKey, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(addMonths(endKey, -i));
  return out;
}

/** 'Set/2026' */
export function formatMonth(key) {
  const p = parseMonthKey(key);
  return p ? `${MESES_CURTOS[p.month - 1]}/${p.year}` : '';
}

/** 'setembro de 2026' */
export function formatMonthLong(key) {
  const p = parseMonthKey(key);
  return p ? `${MESES_LONGOS[p.month - 1]} de ${p.year}` : '';
}

/** Formato curto usado na URL: '2026-09'. */
export function monthToParam(key) {
  return String(key).slice(0, 7);
}

export function monthFromParam(value) {
  const p = parseMonthKey(value);
  return p ? monthKey(p.year, p.month) : null;
}

// ---------------------------------------------------------------------
// Datas e horas (timestamps completos, ex.: pago_em)
// ---------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, dateStyle: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TIMEZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});

export function formatDate(iso) {
  return iso ? dateFmt.format(new Date(iso)) : '';
}

export function formatDateTime(iso) {
  return iso ? dateTimeFmt.format(new Date(iso)) : '';
}

// ---------------------------------------------------------------------
// Dinheiro
// ---------------------------------------------------------------------

const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatMoney(value) {
  return moneyFmt.format(Number(value) || 0);
}

/**
 * Converte texto digitado ('80', '80,50', 'R$ 1.234,56', '80.5') em número.
 * Retorna null para vazio e NaN para inválido.
 */
export function parseMoney(input) {
  let s = String(input ?? '').replace(/[R$\s ]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100) / 100;
}

/** Valor para preencher um input de dinheiro: 80 -> '80,00'. */
export function moneyToInput(value) {
  if (value === null || value === undefined || value === '') return '';
  return Number(value).toFixed(2).replace('.', ',');
}

/** Mensalidade efetiva do jogador: a personalizada ou o padrão de settings. */
export function effectiveFee(player, settings) {
  if (player && player.valor_mensalidade !== null && player.valor_mensalidade !== undefined) {
    return Number(player.valor_mensalidade);
  }
  return Number(settings?.valor_mensalidade_padrao) || 0;
}

// ---------------------------------------------------------------------
// Texto e busca
// ---------------------------------------------------------------------

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Busca sem acento e sem diferenciar maiúsculas por nome ou apelido. */
export function matchesPlayer(player, query) {
  const q = normalizeText(query);
  if (!q) return true;
  return normalizeText(player.nome).includes(q) || normalizeText(player.apelido).includes(q);
}

export function compareText(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR', { sensitivity: 'base' });
}

export function byApelido(a, b) {
  return compareText(a.apelido, b.apelido) || compareText(a.nome, b.nome);
}

export function byNome(a, b) {
  return compareText(a.nome, b.nome) || compareText(a.apelido, b.apelido);
}

// ---------------------------------------------------------------------
// Telefone / WhatsApp
// Armazenado só com dígitos e 55 na frente: '5511912345678'.
// ---------------------------------------------------------------------

/** Retorna { value, valid }. value = '55DDDNUMERO' ou null (vazio). */
export function normalizePhone(input) {
  let d = String(input ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return { value: null, valid: true };
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return { value: `55${d}`, valid: true };
  return { value: null, valid: false };
}

/** '5511912345678' -> '(11) 91234-5678' */
export function formatPhone(stored) {
  let d = String(stored ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** https://wa.me/55DDDNUMERO?text=... — null se o telefone for inválido. */
export function whatsappUrl(phone, message) {
  const { value } = normalizePhone(phone);
  if (!value) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${value}${text}`;
}

/** Mensagem de cobrança. items = [{ mes_referencia, valor }]. */
export function chargeMessage(apelido, items) {
  const nome = apelido || 'craque';
  if (!items || items.length === 0) return `Fala, ${nome}! Tudo certo?`;
  if (items.length === 1) {
    const [item] = items;
    return (
      `Fala, ${nome}! Tudo certo? Passando pra lembrar da mensalidade da Gisela de ` +
      `${formatMonth(item.mes_referencia)}, no valor de ${formatMoney(item.valor)}. Valeu!`
    );
  }
  const sorted = [...items].sort((a, b) => a.mes_referencia.localeCompare(b.mes_referencia));
  const lista = sorted.map((i) => `${formatMonth(i.mes_referencia)} (${formatMoney(i.valor)})`).join(', ');
  const total = sorted.reduce((sum, i) => sum + Number(i.valor || 0), 0);
  return (
    `Fala, ${nome}! Tudo certo? Passando pra lembrar das mensalidades da Gisela em aberto: ` +
    `${lista}. Total: ${formatMoney(total)}. Valeu!`
  );
}

// ---------------------------------------------------------------------
// Status de pagamento
// ---------------------------------------------------------------------

export const STATUS = {
  pago: { icon: '✓', label: 'Pago', plural: 'Pagos' },
  pendente: { icon: '!', label: 'Pendente', plural: 'Pendentes' },
  atrasado: { icon: '!', label: 'Atrasado', plural: 'Atrasados' },
  isento: { icon: '–', label: 'Isento', plural: 'Isentos' },
};

/**
 * Status visual de um registro: 'pago' | 'pendente' | 'atrasado' | 'isento'.
 * Puramente de apresentação — não altera o status gravado no banco.
 * 'atrasado' é 'pendente' cujo mes_referencia é anterior a mesAtual
 * (string 'YYYY-MM-01', comparável lexicograficamente).
 */
export function statusVisual(registro, mesAtual) {
  if (!registro) return 'pendente';
  if (registro.status === 'pendente' && registro.mes_referencia < mesAtual) return 'atrasado';
  return registro.status;
}

/** Patch para mudar o status; pago_em é preenchido só quando vira pago. */
export function statusPatch(status) {
  return { status, pago_em: status === 'pago' ? new Date().toISOString() : null };
}

/** Contadores e valores de um conjunto de registros. Esperado = pago + pendente. */
export function summarizeRecords(records) {
  const summary = { pago: 0, pendente: 0, isento: 0, total: 0, arrecadado: 0, esperado: 0, emAberto: 0 };
  for (const r of records) {
    const valor = Number(r.valor) || 0;
    summary.total += 1;
    if (r.status in summary) summary[r.status] += 1;
    if (r.status === 'pago') {
      summary.arrecadado += valor;
      summary.esperado += valor;
    } else if (r.status === 'pendente') {
      summary.emAberto += valor;
      summary.esperado += valor;
    }
  }
  return summary;
}

export function percent(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

// ---------------------------------------------------------------------
// HTML seguro
// Todo innerHTML passa por html`...`, que escapa as interpolações.
// raw() marca um trecho como confiável (ícones SVG fixos, fragmentos
// já produzidos por html`...`).
// ---------------------------------------------------------------------

class SafeHtml {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function raw(value) {
  return new SafeHtml(String(value));
}

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(renderValue).join('');
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += renderValue(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

/** Único ponto que escreve innerHTML; só aceita SafeHtml. */
export function setHTML(element, content) {
  if (!(content instanceof SafeHtml)) {
    throw new TypeError('setHTML aceita apenas conteúdo gerado por html`...`.');
  }
  element.innerHTML = content.value;
}

// ---------------------------------------------------------------------
// URL (query string)
// ---------------------------------------------------------------------

export function getParams() {
  return new URLSearchParams(window.location.search);
}

/** Atualiza a query string sem recarregar; valores vazios/nulos são removidos. */
export function setParams(values) {
  const params = getParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

// ---------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------

export function debounce(fn, wait = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
