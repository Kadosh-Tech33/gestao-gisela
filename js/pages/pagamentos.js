import * as db from '../db.js';
import {
  html,
  setHTML,
  STATUS,
  addMonths,
  currentMonthKey,
  formatMonth,
  formatMonthLong,
  formatMoney,
  formatDateTime,
  lastMonths,
  monthFromParam,
  monthToParam,
  getParams,
  setParams,
  matchesPlayer,
  byApelido,
  moneyToInput,
  parseMoney,
  percent,
  plural,
  statusPatch,
  statusVisual,
  summarizeRecords,
  debounce,
} from '../utils.js';
import {
  mountShell,
  icons,
  avatar,
  toast,
  toastError,
  actionSheet,
  confirmDialog,
  promptMoney,
  statusBadgeButton,
  statusSquareButton,
  statusLegend,
  moreButton,
  inactiveBadge,
  skeletonList,
  skeletonTableRows,
  skeletonBlock,
  emptyState,
  errorState,
  progressBar,
  withBusy,
} from '../ui.js';
import { createPaymentUpdater } from '../payment-actions.js';

const MONTHS_IN_TABLE = 6;
const desktopQuery = window.matchMedia('(min-width: 1024px)');
const main = document.getElementById('main');

const state = {
  month: monthFromParam(getParams().get('mes')) ?? currentMonthKey(),
  search: getParams().get('q') ?? '',
  players: new Map(),
  settings: null,
  records: new Map(), // id -> registro (janela de 6 meses até o mês selecionado)
  loading: true,
  error: null,
};

let loadToken = 0;
let scrollTableToEnd = true;
let poppingId = null;

const updater = createPaymentUpdater({
  getRecord: (id) => state.records.get(id),
  onChange: renderContent,
});

// ---------------------------------------------------------------------
// Inicialização e carga
// ---------------------------------------------------------------------

async function init() {
  const session = await db.requireSession();
  if (!session) return;
  mountShell({ page: 'pagamentos', title: 'Pagamentos' });

  setHTML(
    main,
    html`
      <div class="stack">
        <div id="month-nav"></div>
        <div id="pg-summary"></div>
        <div class="toolbar" id="pg-toolbar" hidden>
          <div class="search-field">
            ${icons.search}
            <label for="pg-search" class="sr-only">Buscar jogador por nome ou apelido</label>
            <input type="search" id="pg-search" placeholder="Buscar por nome ou apelido" autocomplete="off" value="${state.search}" />
          </div>
          <div class="row" id="pg-sync"></div>
        </div>
        <div id="pg-body"></div>
      </div>
    `,
  );

  main.addEventListener('click', onClick);
  document.getElementById('pg-search').addEventListener(
    'input',
    debounce((event) => {
      state.search = event.target.value;
      setParams({ q: state.search.trim() });
      renderBody();
    }, 150),
  );
  desktopQuery.addEventListener('change', () => {
    scrollTableToEnd = true;
    renderBody();
  });

  await load();
}

function fetchRecords() {
  return db.listPaymentsInRange(addMonths(state.month, -(MONTHS_IN_TABLE - 1)), state.month);
}

async function load({ recordsOnly = false } = {}) {
  const token = ++loadToken;
  state.loading = true;
  state.error = null;
  renderAll();

  const [players, settings, records] = await Promise.all([
    recordsOnly ? { data: null, error: null } : db.listPlayers(),
    recordsOnly ? { data: null, error: null } : db.getSettings(),
    fetchRecords(),
  ]);
  if (token !== loadToken) return;

  const error = players.error || settings.error || records.error;
  state.loading = false;
  if (error) {
    state.error = error.message;
    renderAll();
    return;
  }

  if (!recordsOnly) {
    state.players = new Map(players.data.map((p) => [p.id, p]));
    state.settings = settings.data;
  }
  state.records = new Map(records.data.map((r) => [r.id, r]));
  scrollTableToEnd = true;
  renderAll();
}

function goToMonth(month) {
  state.month = month;
  setParams({ mes: month === currentMonthKey() ? null : monthToParam(month) });
  load({ recordsOnly: true });
}

// ---------------------------------------------------------------------
// Seletores
// ---------------------------------------------------------------------

function monthRecords(month = state.month) {
  return [...state.records.values()].filter((r) => r.mes_referencia === month);
}

function activePlayers() {
  return [...state.players.values()].filter((p) => p.ativo);
}

function missingActiveCount() {
  const withRecord = new Set(monthRecords().map((r) => r.player_id));
  return activePlayers().filter((p) => !withRecord.has(p.id)).length;
}

function playerOf(record) {
  return state.players.get(record.player_id);
}

// ---------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------

function renderAll() {
  renderMonthNav();
  renderContent();
}

function renderContent() {
  renderSummary();
  renderToolbar();
  renderBody();
  poppingId = null;
}

function renderMonthNav() {
  const isCurrent = state.month === currentMonthKey();
  const prev = addMonths(state.month, -1);
  const next = addMonths(state.month, 1);
  const records = monthRecords();
  const isOpen = records.length > 0;
  const s = isOpen ? summarizeRecords(records) : null;

  setHTML(
    document.getElementById('month-nav'),
    html`
      <div class="score-nav">
        <button type="button" class="icon-btn" data-action="prev" aria-label="Mês anterior: ${formatMonth(prev)}">${icons.chevronLeft}</button>
        <div class="score-label">
          <span class="score-month" aria-live="polite">${formatMonth(state.month)}</span>
          <span class="score-sub">${isOpen ? `${s.pago}/${s.pago + s.pendente} pagos` : 'Não aberto'}</span>
          ${isCurrent ? '' : html`<button type="button" class="score-today" data-action="today">Voltar ao mês atual</button>`}
        </div>
        <button type="button" class="icon-btn" data-action="next" aria-label="Próximo mês: ${formatMonth(next)}">${icons.chevronRight}</button>
      </div>
    `,
  );
}

function renderSummary() {
  const el = document.getElementById('pg-summary');
  if (state.loading) {
    setHTML(el, skeletonBlock(148));
    return;
  }
  const records = monthRecords();
  if (state.error || records.length === 0) {
    setHTML(el, html``);
    return;
  }
  const s = summarizeRecords(records);
  const pct = percent(s.arrecadado, s.esperado);
  const today = currentMonthKey();
  const visualCounts = { pago: 0, pendente: 0, atrasado: 0, isento: 0 };
  for (const r of records) visualCounts[statusVisual(r, today)] += 1;

  setHTML(
    el,
    html`
      <section class="card summary" aria-label="Resumo de ${formatMonthLong(state.month)}">
        <ul class="counters">
          ${['pago', 'pendente', 'atrasado', 'isento'].map(
            (status) => html`
              <li class="counter counter--${status}">
                <span class="counter-value">${visualCounts[status]}</span>
                <span class="counter-label">${status === 'pago' ? 'Pagos' : status === 'pendente' ? 'Pendentes' : status === 'atrasado' ? 'Atrasados' : 'Isentos'}</span>
              </li>
            `,
          )}
        </ul>
        <div class="collect">
          <div class="collect-values">
            <span><strong>${formatMoney(s.arrecadado)}</strong> arrecadado</span>
            <span class="muted">de ${formatMoney(s.esperado)} esperado</span>
          </div>
          ${progressBar(pct, 'Arrecadado em relação ao esperado')}
          <p class="field-hint">${pct}% arrecadado · faltam ${formatMoney(s.emAberto)}</p>
        </div>
      </section>
    `,
  );
}

function renderToolbar() {
  const toolbar = document.getElementById('pg-toolbar');
  const show = !state.loading && !state.error && monthRecords().length > 0;
  toolbar.hidden = !show;
  if (!show) return;
  const missing = missingActiveCount();
  setHTML(
    document.getElementById('pg-sync'),
    html`
      ${missing > 0
        ? html`<span class="toolbar-hint">${plural(missing, 'ativo fora deste mês', 'ativos fora deste mês')}</span>`
        : ''}
      <button type="button" class="btn btn-secondary" data-action="sync">${icons.refresh} Sincronizar ativos</button>
    `,
  );
}

/** Re-renderiza preservando foco e rolagem horizontal da tabela. */
function renderBody() {
  const body = document.getElementById('pg-body');
  const focused = document.activeElement;
  const focusKey =
    focused && body.contains(focused) && focused.dataset.action
      ? `[data-action="${focused.dataset.action}"][data-id="${focused.dataset.id}"]`
      : null;
  const previousScroll = body.querySelector('.table-wrap')?.scrollLeft ?? 0;

  setHTML(body, bodyContent());

  const wrap = body.querySelector('.table-wrap');
  if (wrap) {
    wrap.scrollLeft = scrollTableToEnd ? wrap.scrollWidth : previousScroll;
    scrollTableToEnd = false;
  }
  if (focusKey) body.querySelector(focusKey)?.focus();
}

function bodyContent() {
  if (state.loading) return desktopQuery.matches ? skeletonTableRows(6) : skeletonList(6);
  if (state.error) return errorState(state.error);

  const records = monthRecords();
  if (records.length === 0) return closedMonthState();

  return desktopQuery.matches ? tableView() : cardsView(records);
}

function clearFilters() {
  state.search = '';
  const input = document.getElementById('pg-search');
  if (input) input.value = '';
  setParams({ q: null });
  renderBody();
}

function closedMonthState() {
  const active = activePlayers().length;
  if (active === 0) {
    return emptyState({
      icon: icons.calendar,
      title: `${formatMonth(state.month)} ainda não foi aberto`,
      text: 'Não há jogadores ativos. Cadastre ou reative jogadores antes de abrir o mês.',
      action: html`<a class="btn" href="jogadores.html">Ir para Jogadores</a>`,
    });
  }
  return emptyState({
    icon: icons.calendar,
    title: `${formatMonth(state.month)} ainda não foi aberto`,
    text: `Ao abrir o mês, cada um dos ${plural(active, 'jogador ativo', 'jogadores ativos')} ganha um registro pendente com o valor da própria mensalidade. Depois é só marcar quem pagou.`,
    action: html`<button type="button" class="btn" data-action="open-month">${icons.calendar} Abrir mês</button>`,
  });
}

function noResults() {
  return emptyState({
    icon: icons.searchX,
    title: 'Nenhum jogador encontrado',
    text: `Nada corresponde a "${state.search.trim()}". Confira a grafia ou busque pelo apelido.`,
    action: html`<button type="button" class="btn btn-secondary" data-action="clear-filters">Limpar filtros</button>`,
  });
}

function cardsView(records) {
  const today = currentMonthKey();
  const rows = records
    .map((record) => ({ record, player: playerOf(record) }))
    .filter(({ player }) => player && matchesPlayer(player, state.search))
    .sort((a, b) => byApelido(a.player, b.player));

  if (rows.length === 0) return noResults();

  return html`
    <ul class="pay-list" aria-label="Pagamentos de ${formatMonthLong(state.month)}">
      ${rows.map(({ record, player }) => {
        const visual = statusVisual(record, today);
        return html`
          <li class="card pay-card pay-card--${visual}">
            ${avatar(player)}
            <div class="names">
              <span class="names-top">
                <span class="apelido">${player.apelido}</span>
                ${player.ativo ? '' : inactiveBadge()}
              </span>
              <span class="nome">${player.nome} · ${formatMoney(record.valor)}</span>
            </div>
            <div class="pay-card-actions">
              ${statusBadgeButton(record, today, player.apelido, { popping: record.id === poppingId })}
              ${moreButton(record, `${player.apelido}, ${formatMonth(record.mes_referencia)}`)}
            </div>
          </li>
        `;
      })}
    </ul>
  `;
}

function tableView() {
  const today = currentMonthKey();
  const months = lastMonths(state.month, MONTHS_IN_TABLE);
  const index = new Map();
  const openMonths = new Set();
  for (const r of state.records.values()) {
    index.set(`${r.player_id}|${r.mes_referencia}`, r);
    openMonths.add(r.mes_referencia);
  }
  const withRecords = new Set([...state.records.values()].map((r) => r.player_id));
  const players = [...state.players.values()]
    .filter((p) => (p.ativo || withRecords.has(p.id)) && matchesPlayer(p, state.search))
    .sort(byApelido);

  if (players.length === 0) return noResults();

  return html`
    ${statusLegend()}
    <div class="table-wrap">
      <table class="pay-table">
        <caption class="sr-only">Pagamentos por jogador de ${formatMonth(months[0])} a ${formatMonth(state.month)}</caption>
        <thead>
          <tr>
            <th scope="col" class="sticky-col">Jogador</th>
            ${months.map(
              (m) => html`
                <th scope="col" class="${m === state.month ? 'is-selected' : ''}">
                  ${formatMonth(m)}${openMonths.has(m) ? '' : html`<br /><span class="muted">não aberto</span>`}
                </th>
              `,
            )}
          </tr>
        </thead>
        <tbody>
          ${players.map(
            (player) => html`
              <tr>
                <th scope="row" class="sticky-col">
                  <div class="player-cell">
                    ${avatar(player)}
                    <div class="names">
                      <span class="names-top">
                        <span class="apelido">${player.apelido}</span>
                        ${player.ativo ? '' : inactiveBadge()}
                      </span>
                      <span class="nome">${player.nome}</span>
                    </div>
                  </div>
                </th>
                ${months.map((m) => {
                  const record = index.get(`${player.id}|${m}`);
                  if (!record) {
                    return html`<td><span class="cell-empty"><span aria-hidden="true">—</span><span class="sr-only">Sem registro</span></span></td>`;
                  }
                  return html`
                    <td>
                      <div class="cell">
                        ${statusSquareButton(record, today, `${player.apelido}, ${formatMonth(m)}`)}
                        ${moreButton(record, `${player.apelido}, ${formatMonth(m)}`)}
                      </div>
                    </td>
                  `;
                })}
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------

async function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target || !main.contains(target)) return;
  const { action, id } = target.dataset;

  if (action === 'prev') goToMonth(addMonths(state.month, -1));
  else if (action === 'next') goToMonth(addMonths(state.month, 1));
  else if (action === 'today') goToMonth(currentMonthKey());
  else if (action === 'retry') load();
  else if (action === 'open-month') openMonth(target);
  else if (action === 'sync') syncActive(target);
  else if (action === 'toggle') toggleStatus(id);
  else if (action === 'menu') showMenu(id);
  else if (action === 'clear-filters') clearFilters();
}

function mergeRecords(records) {
  for (const r of records) state.records.set(r.id, r);
}

async function openMonth(button) {
  const active = activePlayers().length;
  const confirmed = await confirmDialog({
    title: `Abrir ${formatMonth(state.month)}?`,
    message: `Serão criados ${plural(active, 'registro pendente', 'registros pendentes')}, um para cada jogador ativo, com o valor da mensalidade de cada um.`,
    confirmLabel: 'Abrir mês',
  });
  if (!confirmed) return;

  const month = state.month;
  const { data, error } = await withBusy(button, () => db.openMonth(month));
  if (error) {
    toastError(error);
    return;
  }
  if (month !== state.month) return;
  mergeRecords(data.created);
  renderContent();
  toast(`${formatMonth(month)} aberto com ${plural(data.created.length, 'registro', 'registros')}.`);
}

async function syncActive(button) {
  const month = state.month;
  const { data, error } = await withBusy(button, () => db.openMonth(month));
  if (error) {
    toastError(error);
    return;
  }
  if (month !== state.month) return;
  mergeRecords(data.created);
  renderContent();
  toast(
    data.created.length > 0
      ? `${plural(data.created.length, 'jogador incluído', 'jogadores incluídos')} em ${formatMonth(month)}.`
      : `Todos os jogadores ativos já estão em ${formatMonth(month)}.`,
  );
}

function setStatus(record, status) {
  if (record.status === status) return;
  const player = playerOf(record);
  poppingId = record.id;
  updater.apply(record.id, statusPatch(status), {
    message: `${player?.apelido ?? 'Jogador'} · ${formatMonth(record.mes_referencia)}: ${STATUS[status].label.toLowerCase()}.`,
  });
}

function toggleStatus(id) {
  const record = state.records.get(id);
  if (!record) return;
  const today = currentMonthKey();
  const visual = statusVisual(record, today);
  if (visual === 'isento') {
    showMenu(id);
    return;
  }
  setStatus(record, visual === 'pago' ? 'pendente' : 'pago');
}

function showMenu(id) {
  const record = state.records.get(id);
  if (!record) return;
  const player = playerOf(record);
  const today = currentMonthKey();
  const visual = statusVisual(record, today);
  const paidAt = record.status === 'pago' && record.pago_em ? ` · pago em ${formatDateTime(record.pago_em)}` : '';

  actionSheet({
    title: `${player?.apelido ?? 'Jogador'} · ${formatMonth(record.mes_referencia)}`,
    subtitle: `${STATUS[visual].label} · ${formatMoney(record.valor)}${paidAt}`,
    actions: [
      ...['pago', 'pendente', 'isento'].map((status) => ({
        icon: STATUS[status].icon,
        label: `Marcar como ${STATUS[status].label.toLowerCase()}`,
        current: record.status === status,
        onSelect: () => setStatus(record, status),
      })),
      { icon: icons.edit, label: 'Editar valor', onSelect: () => editValue(record) },
    ],
  });
}

async function editValue(record) {
  const player = playerOf(record);
  const value = await promptMoney({
    title: `Editar valor · ${player?.apelido ?? 'Jogador'}`,
    label: `Valor de ${formatMonth(record.mes_referencia)} (R$)`,
    value: moneyToInput(record.valor),
    hint: 'Altera só este mês deste jogador. Para mudar os próximos meses, edite a mensalidade no cadastro dele.',
    parse: parseMoney,
  });
  if (value === null || value === Number(record.valor)) return;
  updater.apply(record.id, { valor: value }, {
    message: `Valor de ${player?.apelido ?? 'jogador'} em ${formatMonth(record.mes_referencia)}: ${formatMoney(value)}.`,
  });
}

init();
