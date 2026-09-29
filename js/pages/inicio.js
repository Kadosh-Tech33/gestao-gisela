import * as db from '../db.js';
import {
  html,
  setHTML,
  addMonths,
  currentMonthKey,
  formatMonth,
  formatMonthLong,
  formatMoney,
  lastMonths,
  monthToParam,
  byApelido,
  chargeMessage,
  whatsappUrl,
  percent,
  plural,
  statusPatch,
  statusVisual,
  summarizeRecords,
} from '../utils.js';
import {
  mountShell,
  icons,
  avatar,
  toast,
  toastError,
  confirmDialog,
  statusBadgeButton,
  fieldBar,
  skeletonHero,
  skeletonKpis,
  skeletonList,
  emptyState,
  errorState,
  progressBar,
  withBusy,
} from '../ui.js';
import { createPaymentUpdater } from '../payment-actions.js';

const HISTORY_MONTHS = 6;
const main = document.getElementById('main');

const state = {
  month: currentMonthKey(),
  players: new Map(),
  records: new Map(),
  loading: true,
  error: null,
};

let poppingId = null;

const updater = createPaymentUpdater({
  getRecord: (id) => state.records.get(id),
  onChange: render,
});

async function init() {
  const session = await db.requireSession();
  if (!session) return;
  mountShell({ page: 'inicio', title: 'Início' });
  main.addEventListener('click', onClick);
  await load();
}

async function load() {
  state.loading = true;
  state.error = null;
  render();

  const [players, records] = await Promise.all([
    db.listPlayers(),
    db.listPaymentsInRange(addMonths(state.month, -(HISTORY_MONTHS - 1)), state.month),
  ]);
  state.loading = false;
  const error = players.error || records.error;
  if (error) {
    state.error = error.message;
    render();
    return;
  }
  state.players = new Map(players.data.map((p) => [p.id, p]));
  state.records = new Map(records.data.map((r) => [r.id, r]));
  render();
}

// ---------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------

function recordsOf(month) {
  return [...state.records.values()].filter((r) => r.mes_referencia === month);
}

function render() {
  if (state.loading) {
    setHTML(
      main,
      html`
        ${skeletonHero()}
        ${skeletonKpis()}
        <div class="dash-grid"><div>${skeletonList(4)}</div><div>${skeletonHero()}</div></div>
      `,
    );
    return;
  }
  if (state.error) {
    setHTML(main, errorState(state.error));
    return;
  }

  const focused = document.activeElement;
  const hadFocusInPending = focused?.dataset?.action === 'pay';
  const focusIndex = hadFocusInPending
    ? [...main.querySelectorAll('[data-action="pay"]')].indexOf(focused)
    : -1;

  const current = recordsOf(state.month);
  const isOpen = current.length > 0;
  const s = summarizeRecords(current);

  setHTML(
    main,
    html`
      ${heroCard(s, isOpen)}
      ${kpiRow(current, isOpen)}
      <div class="dash-grid">
        ${pendingSection(current, isOpen)}
        ${historySection()}
      </div>
    `,
  );

  if (hadFocusInPending) {
    const buttons = main.querySelectorAll('[data-action="pay"]');
    const target = buttons[Math.min(focusIndex, buttons.length - 1)] ?? document.getElementById('pending-title');
    target?.focus();
  }
  poppingId = null;
}

function heroCard(s, isOpen) {
  return html`
    <section class="hero-card" aria-label="Arrecadação de ${formatMonthLong(state.month)}">
      <p class="hero-eyebrow">Arrecadado · ${formatMonth(state.month)}</p>
      ${isOpen
        ? html`
            <p class="hero-value">${formatMoney(s.arrecadado)}</p>
            <p class="hero-sub">de ${formatMoney(s.esperado)}</p>
            ${fieldBar(percent(s.arrecadado, s.esperado), `Arrecadado em relação ao esperado em ${formatMonth(state.month)}`)}
          `
        : html`
            <p class="hero-value">—</p>
            <p class="hero-sub">${formatMonth(state.month)} ainda não foi aberto</p>
          `}
    </section>
  `;
}

function kpiRow(current, isOpen) {
  const players = [...state.players.values()];
  const active = players.filter((p) => p.ativo).length;
  const pagos = current.filter((r) => statusVisual(r, state.month) === 'pago').length;
  const pendAtrasados = current.filter((r) => {
    const visual = statusVisual(r, state.month);
    return visual === 'pendente' || visual === 'atrasado';
  }).length;

  const kpis = [
    { label: 'Ativos', value: String(active), color: 'var(--brand-500)', icon: icons.users },
    { label: 'Pagos', value: isOpen ? String(pagos) : '—', color: 'var(--status-pago-dot)', icon: icons.check },
    { label: 'Pendentes + atrasados', value: isOpen ? String(pendAtrasados) : '—', color: 'var(--status-pendente-dot)', icon: icons.alert },
  ];

  return html`
    <div class="kpi-row" aria-label="Indicadores de ${formatMonthLong(state.month)}">
      ${kpis.map(
        (k) => html`
          <div class="kpi-card" style="--kpi-accent:${k.color}">
            <span class="kpi-icon" aria-hidden="true">${k.icon}</span>
            <span class="kpi-label">${k.label}</span>
            <span class="kpi-value">${k.value}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function pendingSection(current, isOpen) {
  if (!isOpen) {
    return html`
      <section aria-labelledby="pending-title">
        <div class="section-header">
          <h2 class="section-title" id="pending-title" tabindex="-1">Pendentes</h2>
        </div>
        ${emptyState({
          icon: icons.calendar,
          title: `${formatMonth(state.month)} ainda não foi aberto`,
          text: 'Abra o mês para gerar os registros pendentes dos jogadores ativos e começar a marcar os pagamentos.',
          action: html`<button type="button" class="btn" data-action="open-month">${icons.calendar} Abrir mês</button>`,
        })}
      </section>
    `;
  }

  const pending = current
    .filter((r) => r.status === 'pendente')
    .map((record) => ({ record, player: state.players.get(record.player_id), visual: statusVisual(record, state.month) }))
    .filter(({ player }) => player)
    .sort((a, b) => {
      const aLate = a.visual === 'atrasado' ? 0 : 1;
      const bLate = b.visual === 'atrasado' ? 0 : 1;
      return aLate - bLate || byApelido(a.player, b.player);
    });

  let content;
  if (pending.length === 0) {
    content = html`
      <div class="celebrate-card">
        ${icons.trophy}
        <p class="celebrate-title">Time todo em dia. Mês fechado.</p>
        <p class="celebrate-text">Todos os pagamentos de ${formatMonth(state.month)} estão em dia.</p>
      </div>
    `;
  } else {
    content = html`
      <ul class="pending-list">
        ${pending.map(({ record, player }) => {
          const url = whatsappUrl(player.telefone, chargeMessage(player.apelido, [record]));
          return html`
            <li class="card pending-item">
              ${avatar(player)}
              <div class="names">
                <span class="apelido">${player.apelido}</span>
                <span class="nome">${player.nome}</span>
              </div>
              <div class="pending-meta">
                ${statusBadgeButton(record, state.month, player.apelido, { popping: record.id === poppingId })}
                <span class="pending-value">${formatMoney(record.valor)}</span>
              </div>
              <div class="pending-actions">
                ${url
                  ? html`<a class="btn btn-whatsapp" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Cobrar ${player.apelido} no WhatsApp">${icons.whatsapp} WhatsApp</a>`
                  : html`<button type="button" class="btn btn-secondary" disabled title="Cadastre o telefone para cobrar pelo WhatsApp">Sem telefone</button>`}
                <button type="button" class="btn btn-secondary" data-action="pay" data-id="${record.id}" aria-label="Marcar ${player.apelido} como pago">${icons.check} Pago</button>
              </div>
            </li>
          `;
        })}
      </ul>
    `;
  }

  return html`
    <section aria-labelledby="pending-title">
      <div class="section-header">
        <h2 class="section-title" id="pending-title" tabindex="-1">
          Pendentes${pending.length ? ` (${pending.length})` : ''}
        </h2>
        <a class="section-link" href="pagamentos.html">Ver todos</a>
      </div>
      ${content}
    </section>
  `;
}

function historySection() {
  const months = lastMonths(state.month, HISTORY_MONTHS).reverse();
  return html`
    <section aria-labelledby="history-title">
      <div class="section-header">
        <h2 class="section-title" id="history-title">Últimos ${HISTORY_MONTHS} meses</h2>
      </div>
      <div class="card history-list">
        ${months.map((month) => {
          const records = recordsOf(month);
          const href = `pagamentos.html?mes=${monthToParam(month)}`;
          if (records.length === 0) {
            return html`
              <a class="history-row" href="${href}" aria-label="${formatMonthLong(month)}: não aberto">
                <span class="history-month">${formatMonth(month)}</span>
                <span class="history-count">Não aberto</span>
                <span class="history-value muted">—</span>
              </a>
            `;
          }
          const s = summarizeRecords(records);
          const cobrados = s.pago + s.pendente;
          const pct = percent(s.arrecadado, s.esperado);
          return html`
            <a class="history-row" href="${href}" aria-label="${formatMonthLong(month)}: ${s.pago} de ${cobrados} pagos, ${formatMoney(s.arrecadado)} arrecadado">
              <span class="history-month">${formatMonth(month)}</span>
              <span class="history-bar">
                ${progressBar(pct, `Arrecadado em ${formatMonth(month)}`, { small: true })}
                <span class="history-count">${s.pago}/${cobrados} pagos${s.isento ? ` · ${plural(s.isento, 'isento', 'isentos')}` : ''}</span>
              </span>
              <span class="history-value">${formatMoney(s.arrecadado)}</span>
            </a>
          `;
        })}
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------

async function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;

  if (action === 'retry') load();
  else if (action === 'open-month') openMonth(target);
  else if (action === 'pay') markPaid(id);
}

function markPaid(id) {
  const record = state.records.get(id);
  if (!record || record.status === 'pago') return;
  const player = state.players.get(record.player_id);
  poppingId = id;
  updater.apply(id, statusPatch('pago'), {
    message: `${player?.apelido ?? 'Jogador'} · ${formatMonth(record.mes_referencia)}: pago.`,
  });
}

async function openMonth(button) {
  const active = [...state.players.values()].filter((p) => p.ativo).length;
  if (active === 0) {
    toast('Não há jogadores ativos. Cadastre jogadores antes de abrir o mês.');
    return;
  }
  const confirmed = await confirmDialog({
    title: `Abrir ${formatMonth(state.month)}?`,
    message: `Serão criados ${plural(active, 'registro pendente', 'registros pendentes')}, um para cada jogador ativo, com o valor da mensalidade de cada um.`,
    confirmLabel: 'Abrir mês',
  });
  if (!confirmed) return;

  const { data, error } = await withBusy(button, () => db.openMonth(state.month));
  if (error) {
    toastError(error);
    return;
  }
  for (const r of data.created) state.records.set(r.id, r);
  render();
  toast(`${formatMonth(state.month)} aberto com ${plural(data.created.length, 'registro', 'registros')}.`);
}

init();
