// Componentes de interface compartilhados: shell (header + navegação),
// toast, diálogos, avatar de camisa, badges de status, skeletons e
// estados vazios/erro. Os ícones usam o sprite <symbol>/<use> definido
// inline no <body> de cada página (ver bloco #icon-sprite no HTML).

import { html, raw, setHTML, STATUS, statusVisual } from './utils.js';

function useIcon(id) {
  return raw(
    `<svg class="icon" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#icon-${id}"></use></svg>`,
  );
}

export const icons = {
  home: useIcon('home'),
  users: useIcon('users'),
  wallet: useIcon('wallet'),
  gear: useIcon('gear'),
  chevronLeft: useIcon('chevron-left'),
  chevronRight: useIcon('chevron-right'),
  close: useIcon('close'),
  more: useIcon('more'),
  plus: useIcon('plus'),
  search: useIcon('search'),
  searchX: useIcon('search-x'),
  refresh: useIcon('refresh'),
  whatsapp: useIcon('whatsapp'),
  calendar: useIcon('calendar'),
  edit: useIcon('edit'),
  logout: useIcon('logout'),
  alert: useIcon('alert'),
  check: useIcon('check'),
  trophy: useIcon('trophy'),
  // Só existem no sprite de configuracoes.html e importar.html.
  upload: useIcon('upload'),
  download: useIcon('download'),
  database: useIcon('database'),
};

// ---------------------------------------------------------------------
// Avatar de camisa: número, ou iniciais do apelido quando não há número.
// ---------------------------------------------------------------------

function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function avatar(player, { size = 'md' } = {}) {
  const n = player?.numero_camisa;
  const label = n === null || n === undefined ? initials(player?.apelido) : String(n);
  return html`<span class="avatar avatar--${size}" aria-hidden="true">${label}</span>`;
}

// ---------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------

const NAV_ITEMS = [
  { id: 'inicio', href: 'index.html', label: 'Início', icon: icons.home },
  { id: 'jogadores', href: 'jogadores.html', label: 'Jogadores', icon: icons.users },
  { id: 'pagamentos', href: 'pagamentos.html', label: 'Pagamentos', icon: icons.wallet },
];

export function mountShell({ page, title }) {
  document.title = `${title} · Gisela`;
  const current = raw('aria-current="page"');

  setHTML(
    document.getElementById('app-nav'),
    html`
      <a class="nav-brand" href="index.html"><span aria-hidden="true">⚽</span> Gisela</a>
      <ul class="nav-list">
        ${NAV_ITEMS.map(
          (item) => html`
            <li>
              <a class="nav-link" href="${item.href}" ${item.id === page ? current : ''}>
                ${item.icon}<span>${item.label}</span>
              </a>
            </li>
          `,
        )}
      </ul>
    `,
  );

  setHTML(
    document.getElementById('app-topbar'),
    html`
      <h1 class="topbar-title">${title}</h1>
      <a class="icon-btn" href="configuracoes.html" aria-label="Configurações" ${page === 'configuracoes' ? current : ''}>
        ${icons.gear}
      </a>
    `,
  );
}

// ---------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------

let activeToast = null;

/**
 * Mostra um aviso no rodapé. Com actionLabel/onAction vira um toast de
 * "Desfazer", com um fio de progresso sincronizado a `duration` ms.
 */
export function toast(message, { actionLabel, onAction, duration = 5000, variant = 'info' } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return null;
  activeToast?.close();

  const undoable = Boolean(actionLabel && onAction);
  const el = document.createElement('div');
  el.className = `toast${variant === 'error' ? ' toast-error' : ''}`;
  if (variant === 'error') el.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = variant === 'error' ? `⚠ ${message}` : message;
  el.append(text);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.remove();
    if (activeToast === handle) activeToast = null;
  };

  if (undoable) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      close();
      onAction();
    });
    el.append(action);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-close';
  dismiss.setAttribute('aria-label', 'Fechar aviso');
  setHTML(dismiss, html`${icons.close}`);
  dismiss.addEventListener('click', close);
  el.append(dismiss);

  if (undoable) {
    const timerBar = document.createElement('span');
    timerBar.className = 'toast-timer';
    timerBar.style.animationDuration = `${duration}ms`;
    timerBar.setAttribute('aria-hidden', 'true');
    el.append(timerBar);
  }

  region.append(el);
  const timer = setTimeout(close, variant === 'error' ? Math.max(duration, 7000) : duration);
  const handle = { close };
  activeToast = handle;
  return handle;
}

export function toastError(error) {
  return toast(error?.message ?? 'Algo deu errado. Tente novamente.', { variant: 'error' });
}

// ---------------------------------------------------------------------
// Diálogos (dialog nativo: foco preso, Esc fecha)
// ---------------------------------------------------------------------

let dialogCounter = 0;

export function openDialog({ title, body, size = 'md', onClose } = {}) {
  dialogCounter += 1;
  const titleId = `dialog-title-${dialogCounter}`;
  const opener = document.activeElement;

  const dlg = document.createElement('dialog');
  dlg.className = `dialog dialog-${size}`;
  dlg.setAttribute('aria-labelledby', titleId);
  setHTML(
    dlg,
    html`
      <div class="dialog-inner">
        <div class="dialog-header">
          <h2 class="dialog-title" id="${titleId}">${title}</h2>
          <button type="button" class="icon-btn" data-dialog-close aria-label="Fechar">${icons.close}</button>
        </div>
        <div class="dialog-body"></div>
      </div>
    `,
  );
  const bodyEl = dlg.querySelector('.dialog-body');
  if (body) setHTML(bodyEl, body);

  const close = () => {
    if (dlg.open) dlg.close();
  };

  dlg.addEventListener('click', (event) => {
    if (event.target === dlg || event.target.closest('[data-dialog-close]')) close();
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
    if (opener && document.contains(opener)) opener.focus();
  });

  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, body: bodyEl, close, setTitle: (t) => { dlg.querySelector('.dialog-title').textContent = t; } };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }) {
  return new Promise((resolve) => {
    let result = false;
    const dialog = openDialog({
      title,
      size: 'sm',
      body: html`
        <p class="dialog-text">${message}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-dialog-close>${cancelLabel}</button>
          <button type="button" class="btn" data-confirm>${confirmLabel}</button>
        </div>
      `,
      onClose: () => resolve(result),
    });
    dialog.body.querySelector('[data-confirm]').addEventListener('click', () => {
      result = true;
      dialog.close();
    });
  });
}

/**
 * Menu de ações (bottom sheet no celular).
 * actions = [{ label, icon?, current?, onSelect }]
 */
export function actionSheet({ title, subtitle, actions }) {
  const dialog = openDialog({
    title,
    size: 'sm',
    body: html`
      ${subtitle ? html`<p class="dialog-subtitle">${subtitle}</p>` : ''}
      <ul class="menu-list">
        ${actions.map(
          (action, index) => html`
            <li>
              <button type="button" class="menu-item" data-index="${index}" ${action.current ? raw('aria-current="true"') : ''}>
                ${action.icon ? html`<span class="menu-icon" aria-hidden="true">${action.icon}</span>` : ''}
                <span class="menu-label">${action.label}</span>
                ${action.current ? html`<span class="menu-note">atual</span>` : ''}
              </button>
            </li>
          `,
        )}
      </ul>
    `,
  });
  dialog.body.addEventListener('click', (event) => {
    const button = event.target.closest('.menu-item');
    if (!button) return;
    const action = actions[Number(button.dataset.index)];
    dialog.close();
    action.onSelect();
  });
  return dialog;
}

/** Pede um valor em dinheiro. Resolve com número ou null (cancelado). */
export function promptMoney({ title, label, value, hint, parse }) {
  return new Promise((resolve) => {
    let result = null;
    const dialog = openDialog({
      title,
      size: 'sm',
      body: html`
        <form class="form" novalidate>
          <div class="field">
            <label for="prompt-money">${label}</label>
            <input id="prompt-money" name="valor" inputmode="decimal" autocomplete="off" value="${value}" required aria-describedby="prompt-money-hint prompt-money-error" />
            ${hint ? html`<p class="field-hint" id="prompt-money-hint">${hint}</p>` : ''}
            <p class="field-error" id="prompt-money-error" hidden></p>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" data-dialog-close>Cancelar</button>
            <button type="submit" class="btn">Salvar</button>
          </div>
        </form>
      `,
      onClose: () => resolve(result),
    });
    const form = dialog.body.querySelector('form');
    const input = form.querySelector('input');
    const errorEl = form.querySelector('.field-error');
    input.select();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = parse(input.value);
      if (parsed === null || Number.isNaN(parsed)) {
        errorEl.textContent = 'Informe um valor válido, por exemplo 80 ou 80,50.';
        errorEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      result = parsed;
      dialog.close();
    });
  });
}

// ---------------------------------------------------------------------
// Badges de status: pílula com ponto colorido + texto (nunca só cor).
// pago / pendente / atrasado / isento — ver statusVisual() em utils.js.
// ---------------------------------------------------------------------

export function statusBadge(visual) {
  const meta = STATUS[visual] ?? STATUS.pendente;
  return html`<span class="badge badge--${visual}"><span class="badge-dot" aria-hidden="true"></span>${meta.label}</span>`;
}

export function inactiveBadge() {
  return html`<span class="badge badge--neutro"><span class="badge-dot" aria-hidden="true"></span>Inativo</span>`;
}

/** Badge clicável (pílula) que alterna pago/pendente; isento abre o menu. */
export function statusBadgeButton(record, mesAtual, label, { popping = false } = {}) {
  const visual = statusVisual(record, mesAtual);
  const meta = STATUS[visual] ?? STATUS.pendente;
  const hint =
    visual === 'pago'
      ? 'toque para marcar como pendente'
      : visual === 'pendente' || visual === 'atrasado'
        ? 'toque para marcar como pago'
        : 'toque para ver opções';
  return html`
    <button type="button" class="badge badge--${visual} badge-btn${popping ? ' is-popping' : ''}" data-action="toggle" data-id="${record.id}" aria-label="${label ? `${label} — ` : ''}${meta.label} — ${hint}">
      <span class="badge-dot" aria-hidden="true"></span>${meta.label}
    </button>
  `;
}

/** Célula quadrada de status para a tabela do desktop. */
export function statusSquareButton(record, mesAtual, label) {
  const visual = statusVisual(record, mesAtual);
  const meta = STATUS[visual] ?? STATUS.pendente;
  return html`
    <button type="button" class="status-square status-square--${visual}" data-action="toggle" data-id="${record.id}" aria-label="${label}: ${meta.label}">
      <span aria-hidden="true">${meta.icon}</span>
    </button>
  `;
}

export function statusLegend() {
  return html`
    <ul class="status-legend">
      ${['pago', 'pendente', 'atrasado', 'isento'].map(
        (s) => html`<li><span class="legend-dot legend-dot--${s}" aria-hidden="true"></span>${STATUS[s].label}</li>`,
      )}
    </ul>
  `;
}

export function moreButton(record, label) {
  return html`
    <button type="button" class="icon-btn icon-btn-sm" data-action="menu" data-id="${record.id}" aria-label="Mais opções: ${label}">
      ${icons.more}
    </button>
  `;
}

// ---------------------------------------------------------------------
// Barra de campo (hero do Início): trilho + meio-campo + bola em --p (%)
// Só usada sobre fundo escuro — é a única barra que usa a cor accent.
// ---------------------------------------------------------------------

export function fieldBar(value, label) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return html`
    <div class="field-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${label}" style="--p:${pct}">
      <span class="field-bar-mid" aria-hidden="true"></span>
      <span class="field-bar-fill" aria-hidden="true"></span>
      <span class="field-bar-ball" aria-hidden="true"></span>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Estados: skeleton, vazio, erro, barra de progresso, aviso
// ---------------------------------------------------------------------

export function skeletonList(count = 5) {
  return html`
    <div class="skeleton-list" aria-busy="true" aria-label="Carregando">
      ${Array.from({ length: count }, () => html`
        <div class="card skeleton-card">
          <span class="skeleton skeleton-circle"></span>
          <span class="skeleton-lines"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line short"></span></span>
          <span class="skeleton skeleton-pill"></span>
        </div>
      `)}
    </div>
  `;
}

export function skeletonHero() {
  return html`<div class="skeleton skeleton-hero" aria-hidden="true"></div>`;
}

export function skeletonKpis() {
  return html`
    <div class="kpi-row" aria-hidden="true">
      ${[1, 2, 3].map(() => html`<span class="skeleton skeleton-kpi"></span>`)}
    </div>
  `;
}

export function skeletonTableRows(count = 6) {
  return html`
    <div class="skeleton-table" aria-hidden="true">
      ${Array.from({ length: count }, () => html`
        <div class="skeleton-table-row">
          <span class="skeleton skeleton-circle"></span>
          <span class="skeleton skeleton-line" style="flex:1"></span>
          ${[1, 2, 3, 4].map(() => html`<span class="skeleton skeleton-square"></span>`)}
        </div>
      `)}
    </div>
  `;
}

export function skeletonBlock(height = 96) {
  return html`<div class="skeleton skeleton-block" style="height:${Number(height)}px" aria-hidden="true"></div>`;
}

export function emptyState({ icon, title, text, action }) {
  return html`
    <div class="empty-state">
      ${icon ? html`<span class="empty-icon" aria-hidden="true">${icon}</span>` : ''}
      <p class="empty-title">${title}</p>
      ${text ? html`<p class="empty-text">${text}</p>` : ''}
      ${action ?? ''}
    </div>
  `;
}

export function errorState(message) {
  return html`
    <div class="error-state" role="alert">
      <span class="error-icon">${icons.alert}</span>
      <div>
        <p class="error-title">Não foi possível carregar.</p>
        <p class="error-text">${message}</p>
      </div>
      <button type="button" class="btn btn-secondary" data-action="retry">Tentar de novo</button>
    </div>
  `;
}

export function progressBar(value, label, { small = false } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return html`
    <div class="progress${small ? ' progress-sm' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${label}">
      <span class="progress-fill" style="width:${pct}%"></span>
    </div>
  `;
}

/** Baixa um arquivo gerado no navegador (Blob), sem servidor. */
export function downloadFile(fileName, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Marca um botão como ocupado enquanto uma promessa roda. */
export async function withBusy(button, task) {
  if (!button) return task();
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    button.disabled = wasDisabled;
    button.removeAttribute('aria-busy');
  }
}
