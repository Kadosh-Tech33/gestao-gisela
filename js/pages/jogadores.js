import * as db from '../db.js';
import {
  html,
  setHTML,
  STATUS,
  currentMonthKey,
  formatMonth,
  formatMoney,
  formatDate,
  formatDateTime,
  formatPhone,
  normalizePhone,
  normalizeText,
  matchesPlayer,
  byApelido,
  byNome,
  effectiveFee,
  moneyToInput,
  parseMoney,
  chargeMessage,
  whatsappUrl,
  getParams,
  setParams,
  plural,
  statusVisual,
  debounce,
} from '../utils.js';
import {
  mountShell,
  icons,
  avatar,
  toast,
  toastError,
  openDialog,
  confirmDialog,
  inactiveBadge,
  statusLegend,
  skeletonList,
  skeletonBlock,
  emptyState,
  errorState,
  withBusy,
} from '../ui.js';

const FILTERS = [
  { id: 'todos', label: 'Todos', test: () => true },
  { id: 'ativos', label: 'Ativos', test: (p) => p.ativo },
  { id: 'inativos', label: 'Inativos', test: (p) => !p.ativo },
  { id: 'pendencia', label: 'Com pendência', test: (p) => pendingOf(p.id).length > 0 },
];

const main = document.getElementById('main');
const initialParams = getParams();

const state = {
  q: initialParams.get('q') ?? '',
  filtro: FILTERS.some((f) => f.id === initialParams.get('filtro')) ? initialParams.get('filtro') : 'todos',
  ordem: initialParams.get('ordem') === 'nome' ? 'nome' : 'apelido',
  players: new Map(),
  pending: new Map(), // player_id -> [{ id, mes_referencia, valor }]
  settings: null,
  loading: true,
  error: null,
};

function pendingOf(playerId) {
  return state.pending.get(playerId) ?? [];
}

// ---------------------------------------------------------------------
// Inicialização e carga
// ---------------------------------------------------------------------

async function init() {
  const session = await db.requireSession();
  if (!session) return;
  mountShell({ page: 'jogadores', title: 'Jogadores' });

  setHTML(
    main,
    html`
      <div class="players-controls">
        <div class="players-controls-row">
          <div class="search-field">
            ${icons.search}
            <label for="pl-search" class="sr-only">Buscar jogador por nome ou apelido</label>
            <input type="search" id="pl-search" placeholder="Buscar por nome ou apelido" autocomplete="off" value="${state.q}" />
          </div>
          <div class="sort-field">
            <label for="pl-sort">Ordenar por</label>
            <select id="pl-sort">
              <option value="apelido">Apelido</option>
              <option value="nome">Nome</option>
            </select>
          </div>
          <button type="button" class="btn fab" data-action="new">${icons.plus} Novo jogador</button>
        </div>
        <div class="filter-chips" role="group" aria-label="Filtrar jogadores" id="pl-filters"></div>
        <p class="result-count" id="pl-count" aria-live="polite"></p>
      </div>
      <div id="pl-list" class="has-fab"></div>
    `,
  );

  const sort = document.getElementById('pl-sort');
  sort.value = state.ordem;
  sort.addEventListener('change', () => {
    state.ordem = sort.value;
    syncUrl();
    renderList();
  });
  document.getElementById('pl-search').addEventListener(
    'input',
    debounce((event) => {
      state.q = event.target.value;
      syncUrl();
      renderList();
    }, 150),
  );
  main.addEventListener('click', onClick);

  await load();

  const openId = getParams().get('jogador');
  if (openId && !state.error) {
    if (state.players.has(openId)) openDetail(openId);
    else setParams({ jogador: null });
  }
}

async function load() {
  state.loading = true;
  state.error = null;
  renderAll();

  const [players, settings, pending] = await Promise.all([
    db.listPlayers(),
    db.getSettings(),
    db.listPendingPayments(),
  ]);
  state.loading = false;
  const error = players.error || settings.error || pending.error;
  if (error) {
    state.error = error.message;
    renderAll();
    return;
  }

  state.players = new Map(players.data.map((p) => [p.id, p]));
  state.settings = settings.data;
  state.pending = new Map();
  for (const r of pending.data) addPending(r);
  renderAll();
}

function addPending(record) {
  const list = state.pending.get(record.player_id) ?? [];
  if (!list.some((r) => r.id === record.id)) list.push(record);
  state.pending.set(record.player_id, list);
}

function syncUrl() {
  setParams({
    q: state.q.trim(),
    filtro: state.filtro === 'todos' ? null : state.filtro,
    ordem: state.ordem === 'apelido' ? null : state.ordem,
  });
}

function clearFilters() {
  state.q = '';
  state.filtro = 'todos';
  const input = document.getElementById('pl-search');
  if (input) input.value = '';
  syncUrl();
  renderAll();
}

// ---------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------

function renderAll() {
  renderFilters();
  renderList();
}

function renderFilters() {
  const players = [...state.players.values()];
  setHTML(
    document.getElementById('pl-filters'),
    html`
      ${FILTERS.map(
        (f) => html`
          <button type="button" class="filter-chip" data-action="filter" data-filter="${f.id}" aria-pressed="${state.filtro === f.id ? 'true' : 'false'}">
            ${f.label}${state.loading ? '' : html`<span class="filter-count">${players.filter(f.test).length}</span>`}
          </button>
        `,
      )}
    `,
  );
}

function visiblePlayers() {
  const filter = FILTERS.find((f) => f.id === state.filtro) ?? FILTERS[0];
  return [...state.players.values()]
    .filter((p) => filter.test(p) && matchesPlayer(p, state.q))
    .sort(state.ordem === 'nome' ? byNome : byApelido);
}

function renderList() {
  const list = document.getElementById('pl-list');
  const count = document.getElementById('pl-count');

  if (state.loading) {
    count.textContent = '';
    setHTML(list, skeletonList(6));
    return;
  }
  if (state.error) {
    count.textContent = '';
    setHTML(list, errorState(state.error));
    return;
  }

  const players = visiblePlayers();
  count.textContent = plural(players.length, 'jogador', 'jogadores');

  if (state.players.size === 0) {
    setHTML(
      list,
      emptyState({
        icon: icons.users,
        title: 'Nenhum jogador no elenco',
        text: 'Cadastre os jogadores da Gisela para começar a controlar as mensalidades.',
        action: html`<button type="button" class="btn" data-action="new">${icons.plus} Cadastrar jogador</button>`,
      }),
    );
    return;
  }
  if (players.length === 0) {
    setHTML(
      list,
      emptyState({
        icon: icons.searchX,
        title: 'Nenhum jogador encontrado',
        text: state.q.trim()
          ? `Nada corresponde a "${state.q.trim()}" nos filtros atuais.`
          : 'Nenhum jogador neste filtro.',
        action: html`<button type="button" class="btn btn-secondary" data-action="clear-filters">Limpar filtros</button>`,
      }),
    );
    return;
  }

  setHTML(
    list,
    html`
      <ul class="player-list">
        ${players.map((p) => {
          const open = pendingOf(p.id).length;
          const primary = state.ordem === 'nome' ? p.nome : p.apelido;
          const secondary = state.ordem === 'nome' ? p.apelido : p.nome;
          return html`
            <li>
              <button type="button" class="card player-card" data-action="detail" data-id="${p.id}">
                ${avatar(p)}
                <span class="names">
                  <span class="apelido">${primary}</span>
                  <span class="nome">${secondary}${p.telefone ? ` · ${formatPhone(p.telefone)}` : ''}</span>
                </span>
                <span class="player-card-tags">
                  ${p.ativo ? '' : inactiveBadge()}
                  ${open > 0
                    ? html`<span class="badge badge--pendente"><span class="badge-dot" aria-hidden="true"></span>${plural(open, 'em aberto', 'em aberto')}</span>`
                    : ''}
                </span>
              </button>
            </li>
          `;
        })}
      </ul>
    `,
  );
}

async function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target || !main.contains(target)) return;
  const { action } = target.dataset;

  if (action === 'retry') load();
  else if (action === 'new') openForm(null);
  else if (action === 'detail') openDetail(target.dataset.id);
  else if (action === 'clear-filters') clearFilters();
  else if (action === 'filter') {
    state.filtro = target.dataset.filter;
    syncUrl();
    renderAll();
    document.querySelector(`[data-filter="${state.filtro}"]`)?.focus();
  }
}

// ---------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------

function openDetail(id) {
  const player = state.players.get(id);
  if (!player) return;
  setParams({ jogador: id });

  const dialog = openDialog({
    title: player.apelido,
    size: 'lg',
    onClose: () => setParams({ jogador: null }),
  });
  const detail = { dialog, playerId: id, history: null, historyError: null };
  renderDetail(detail);
  loadHistory(detail);

  dialog.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-detail]');
    if (!button) return;
    const current = state.players.get(detail.playerId);
    if (button.dataset.detail === 'edit') {
      const saved = await openForm(current);
      if (saved) renderDetail(detail);
    } else if (button.dataset.detail === 'toggle-active') {
      await toggleActive(current, button);
      loadHistory(detail);
    } else if (button.dataset.detail === 'retry-history') {
      loadHistory(detail);
    }
  });
}

async function loadHistory(detail) {
  detail.history = null;
  detail.historyError = null;
  renderDetail(detail);
  const { data, error } = await db.listPaymentsByPlayer(detail.playerId);
  if (!detail.dialog.el.open) return;
  if (error) detail.historyError = error.message;
  else detail.history = data;
  renderDetail(detail);
}

/** Meses pagos ou isentos consecutivos a partir do mais recente. */
function paidStreak(history) {
  const sorted = [...history].sort((a, b) => b.mes_referencia.localeCompare(a.mes_referencia));
  let count = 0;
  for (const r of sorted) {
    if (r.status === 'pago' || r.status === 'isento') count += 1;
    else break;
  }
  return count;
}

function renderDetail(detail) {
  const player = state.players.get(detail.playerId);
  if (!player || !detail.dialog.el.open) return;
  detail.dialog.setTitle(player.apelido);

  const fee = effectiveFee(player, state.settings);
  const custom = player.valor_mensalidade !== null && player.valor_mensalidade !== undefined;
  const pendingRecords = (detail.history ?? []).filter((r) => r.status === 'pendente');
  const waUrl = whatsappUrl(player.telefone, chargeMessage(player.apelido, pendingRecords));
  const streak = detail.history ? paidStreak(detail.history) : 0;

  setHTML(
    detail.dialog.body,
    html`
      <div class="detail">
        <div class="detail-head">
          ${avatar(player, { size: 'lg' })}
          <div class="names">
            <p class="detail-apelido">${player.apelido}</p>
            <p class="detail-nome">${player.nome}</p>
          </div>
          ${player.ativo ? '' : inactiveBadge()}
          ${streak > 0 ? html`<span class="streak-badge">${icons.trophy} ${plural(streak, 'mês em dia', 'meses em dia')}</span>` : ''}
        </div>

        <dl class="detail-data">
          <div><dt>Telefone</dt><dd>${player.telefone ? formatPhone(player.telefone) : 'Não informado'}</dd></div>
          <div><dt>Camisa</dt><dd>${player.numero_camisa ?? '—'}</dd></div>
          <div><dt>Mensalidade</dt><dd>${formatMoney(fee)} <span class="muted">(${custom ? 'personalizada' : 'padrão'})</span></dd></div>
          <div><dt>Cadastrado em</dt><dd>${formatDate(player.created_at) || '—'}</dd></div>
        </dl>

        <section>
          <h3 class="detail-section-title">Observações</h3>
          <p class="detail-obs ${player.observacoes ? '' : 'muted'}">${player.observacoes || 'Nenhuma observação.'}</p>
        </section>

        <section>
          <h3 class="detail-section-title">Histórico de pagamentos</h3>
          ${historyContent(detail)}
        </section>

        <div class="detail-actions">
          <button type="button" class="btn btn-secondary" data-detail="edit">${icons.edit} Editar</button>
          ${waUrl
            ? html`<a class="btn btn-whatsapp" href="${waUrl}" target="_blank" rel="noopener noreferrer" aria-label="Abrir WhatsApp de ${player.apelido}${pendingRecords.length ? ' com mensagem de cobrança' : ''}">${icons.whatsapp} WhatsApp</a>`
            : html`<button type="button" class="btn btn-secondary" disabled title="Cadastre o telefone para usar o WhatsApp">${icons.whatsapp} Sem telefone</button>`}
          <button type="button" class="btn ${player.ativo ? 'btn-secondary' : ''}" data-detail="toggle-active">
            ${player.ativo ? 'Inativar' : 'Reativar'}
          </button>
        </div>
      </div>
    `,
  );
}

function historyContent(detail) {
  if (detail.historyError) {
    return html`
      <div class="error-state" role="alert">
        <p class="error-text">${detail.historyError}</p>
        <button type="button" class="btn btn-secondary" data-detail="retry-history">Tentar de novo</button>
      </div>
    `;
  }
  if (!detail.history) return skeletonBlock(96);
  if (detail.history.length === 0) {
    return html`<p class="muted">Nenhum registro ainda. O histórico aparece quando um mês é aberto com este jogador ativo.</p>`;
  }

  const today = currentMonthKey();
  const records = [...detail.history].sort((a, b) => a.mes_referencia.localeCompare(b.mes_referencia));
  const totalPago = records.filter((r) => r.status === 'pago').reduce((s, r) => s + Number(r.valor || 0), 0);
  const open = records.filter((r) => r.status === 'pendente');
  const openValue = open.reduce((s, r) => s + Number(r.valor || 0), 0);

  return html`
    <div class="detail-stats">
      <div class="detail-stat">
        <p class="detail-stat-value">${formatMoney(totalPago)}</p>
        <p class="detail-stat-label">Total pago</p>
      </div>
      <div class="detail-stat">
        <p class="detail-stat-value">${open.length}</p>
        <p class="detail-stat-label">${open.length === 1 ? 'Mês em aberto' : 'Meses em aberto'}${open.length ? ` (${formatMoney(openValue)})` : ''}</p>
      </div>
    </div>
    <ol class="timeline" aria-label="Linha do tempo de pagamentos">
      ${records.map((r) => {
        const visual = statusVisual(r, today);
        const meta = STATUS[visual];
        const tip = `${formatMonth(r.mes_referencia)}: ${meta.label} · ${formatMoney(r.valor)}${r.pago_em ? ` · pago em ${formatDateTime(r.pago_em)}` : ''}`;
        return html`
          <li class="badge badge--${visual}" title="${tip}">
            <span class="badge-dot" aria-hidden="true"></span>${formatMonth(r.mes_referencia)}
            <span class="sr-only">: ${meta.label}, ${formatMoney(r.valor)}</span>
          </li>
        `;
      })}
    </ol>
    ${statusLegend()}
  `;
}

async function toggleActive(player, button) {
  if (player.ativo) {
    const confirmed = await confirmDialog({
      title: `Inativar ${player.apelido}?`,
      message:
        'Ele deixa de entrar nos próximos meses abertos e na sincronização. Todos os pagamentos já registrados continuam salvos e visíveis no histórico.',
      confirmLabel: 'Inativar',
    });
    if (!confirmed) return;
  }

  const { data, error } = await withBusy(button, () => db.setPlayerActive(player.id, !player.ativo));
  if (error) {
    toastError(error);
    return;
  }
  state.players.set(data.id, data);
  renderAll();

  if (!data.ativo) {
    toast(`${data.apelido} foi inativado. O histórico de pagamentos foi mantido.`);
    return;
  }
  const month = currentMonthKey();
  const added = await db.addPlayerToMonthIfOpen(data, month);
  if (added.error) {
    toast(`${data.apelido} foi reativado, mas não entrou em ${formatMonth(month)}: ${added.error.message}`, { variant: 'error' });
    return;
  }
  if (added.data.added) addPending(added.data.record);
  renderAll();
  toast(
    added.data.added
      ? `${data.apelido} foi reativado e incluído em ${formatMonth(month)}.`
      : `${data.apelido} foi reativado.`,
  );
}

// ---------------------------------------------------------------------
// Formulário (cadastro e edição)
// Resolve com o jogador salvo ou null.
// ---------------------------------------------------------------------

function openForm(player) {
  const isNew = !player;
  const defaultFee = formatMoney(state.settings?.valor_mensalidade_padrao ?? 0);

  return new Promise((resolve) => {
    let saved = null;
    const dialog = openDialog({
      title: isNew ? 'Novo jogador' : `Editar ${player.apelido}`,
      size: 'md',
      onClose: () => resolve(saved),
      body: html`
        <form class="form" novalidate>
          <div class="field">
            <label for="f-nome">Nome completo</label>
            <input id="f-nome" name="nome" autocomplete="off" maxlength="120" required value="${player?.nome ?? ''}" aria-describedby="f-nome-error" />
            <p class="field-error" id="f-nome-error" hidden></p>
          </div>
          <div class="field">
            <label for="f-apelido">Apelido</label>
            <input id="f-apelido" name="apelido" autocomplete="off" maxlength="40" required value="${player?.apelido ?? ''}" aria-describedby="f-apelido-error f-apelido-warning" />
            <p class="field-error" id="f-apelido-error" hidden></p>
            <p class="field-warning" id="f-apelido-warning" role="status" hidden></p>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="f-telefone">Telefone (WhatsApp) <span class="optional">(opcional)</span></label>
              <input id="f-telefone" name="telefone" type="tel" inputmode="tel" autocomplete="off" placeholder="(11) 91234-5678" value="${player?.telefone ? formatPhone(player.telefone) : ''}" aria-describedby="f-telefone-error" />
              <p class="field-error" id="f-telefone-error" hidden></p>
            </div>
            <div class="field">
              <label for="f-camisa">Camisa <span class="optional">(opcional)</span></label>
              <input id="f-camisa" name="camisa" inputmode="numeric" autocomplete="off" maxlength="3" value="${player?.numero_camisa ?? ''}" aria-describedby="f-camisa-error" />
              <p class="field-error" id="f-camisa-error" hidden></p>
            </div>
          </div>
          <div class="field">
            <label for="f-valor">Mensalidade personalizada <span class="optional">(opcional)</span></label>
            <input id="f-valor" name="valor" inputmode="decimal" autocomplete="off" placeholder="Padrão: ${defaultFee}" value="${moneyToInput(player?.valor_mensalidade)}" aria-describedby="f-valor-hint f-valor-error" />
            <p class="field-hint" id="f-valor-hint">Deixe vazio para usar o valor padrão (${defaultFee}). Vale para os meses abertos a partir de agora.</p>
            <p class="field-error" id="f-valor-error" hidden></p>
          </div>
          <div class="field">
            <label for="f-obs">Observações <span class="optional">(opcional)</span></label>
            <textarea id="f-obs" name="observacoes" maxlength="1000">${player?.observacoes ?? ''}</textarea>
          </div>
          <p class="form-error" role="alert" hidden></p>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" data-dialog-close>Cancelar</button>
            <button type="submit" class="btn">${isNew ? 'Cadastrar' : 'Salvar'}</button>
          </div>
        </form>
      `,
    });

    const form = dialog.body.querySelector('form');
    const warning = form.querySelector('#f-apelido-warning');
    const formError = form.querySelector('.form-error');

    const checkDuplicate = () => {
      const value = normalizeText(form.apelido.value);
      const other = value
        ? [...state.players.values()].find((p) => p.id !== player?.id && normalizeText(p.apelido) === value)
        : null;
      warning.hidden = !other;
      warning.textContent = other
        ? `Já existe um jogador com o apelido "${other.apelido}" (${other.nome}${other.ativo ? '' : ', inativo'}). Você pode salvar mesmo assim.`
        : '';
    };
    form.apelido.addEventListener('input', debounce(checkDuplicate, 200));
    form.telefone.addEventListener('blur', () => {
      const { value, valid } = normalizePhone(form.telefone.value);
      if (valid && value) form.telefone.value = formatPhone(value);
    });
    checkDuplicate();
    form.nome.focus();

    const setFieldError = (name, message) => {
      const input = form.querySelector(`#f-${name}`);
      const el = form.querySelector(`#f-${name}-error`);
      el.textContent = message ?? '';
      el.hidden = !message;
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      return !message;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formError.hidden = true;

      const nome = form.nome.value.trim();
      const apelido = form.apelido.value.trim();
      const phone = normalizePhone(form.telefone.value);
      const camisaText = form.camisa.value.trim();
      const camisa = camisaText === '' ? null : Number(camisaText);
      const valor = parseMoney(form.valor.value);

      const checks = [
        setFieldError('nome', nome ? null : 'Informe o nome do jogador.'),
        setFieldError('apelido', apelido ? null : 'Informe o apelido.'),
        setFieldError('telefone', phone.valid ? null : 'Telefone inválido. Use DDD + número, ex.: (11) 91234-5678.'),
        setFieldError(
          'camisa',
          camisa === null || (Number.isInteger(camisa) && camisa >= 0 && camisa <= 999)
            ? null
            : 'Número da camisa deve ser de 0 a 999.',
        ),
        setFieldError('valor', Number.isNaN(valor) ? 'Valor inválido. Ex.: 80 ou 80,50 — ou deixe vazio.' : null),
      ];
      const firstInvalid = checks.indexOf(false);
      if (firstInvalid !== -1) {
        form.querySelector(['#f-nome', '#f-apelido', '#f-telefone', '#f-camisa', '#f-valor'][firstInvalid]).focus();
        return;
      }

      const payload = {
        nome,
        apelido,
        telefone: phone.value,
        numero_camisa: camisa,
        valor_mensalidade: valor,
        observacoes: form.observacoes.value.trim() || null,
      };

      const submit = form.querySelector('[type="submit"]');
      const { data, error } = await withBusy(submit, () =>
        isNew ? db.createPlayer({ ...payload, ativo: true }) : db.updatePlayer(player.id, payload),
      );
      if (error) {
        formError.textContent = error.message;
        formError.hidden = false;
        return;
      }

      state.players.set(data.id, data);
      saved = data;
      renderAll();
      dialog.close();

      if (!isNew) {
        toast(`${data.apelido} atualizado.`);
        return;
      }
      const month = currentMonthKey();
      const added = await db.addPlayerToMonthIfOpen(data, month);
      if (added.error) {
        toast(`${data.apelido} cadastrado, mas não entrou em ${formatMonth(month)}: ${added.error.message}`, { variant: 'error' });
        return;
      }
      if (added.data.added) {
        addPending(added.data.record);
        renderAll();
      }
      toast(
        added.data.added
          ? `${data.apelido} cadastrado e incluído em ${formatMonth(month)} como pendente.`
          : `${data.apelido} cadastrado.`,
      );
    });
  });
}

init();
