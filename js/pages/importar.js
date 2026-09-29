// Importação da planilha antiga em 3 passos: colar/arquivo -> revisão -> gravação.
// Nada é gravado antes de o usuário confirmar. A gravação é idempotente:
// jogadores já importados casam pelo apelido e registros usam upsert em
// player_id + mes_referencia, então rodar de novo não duplica nada.

import * as db from '../db.js';
import { parseSheet, buildImportPlan } from '../import.js';
import {
  html,
  setHTML,
  STATUS,
  currentMonthKey,
  parseMonthKey,
  formatMonth,
  formatMoney,
  formatPhone,
  effectiveFee,
  plural,
} from '../utils.js';
import {
  mountShell,
  icons,
  toast,
  confirmDialog,
  statusBadge,
  skeletonBlock,
  errorState,
  progressBar,
} from '../ui.js';

const BATCH_SIZE = 500;
const PREVIEW_LIMIT = 200;
const main = document.getElementById('main');

const state = {
  step: 'input', // input | review | saving | report
  text: '',
  fileName: '',
  inputError: null,
  context: null, // { players, records, settings }
  contextError: null,
  sheet: null,
  plan: null,
  options: { numberKind: 'camisa', years: {}, overwrite: false },
  progress: null, // { phase, done, total }
  report: null,
};

// ---------------------------------------------------------------------
// Inicialização e dados de referência (jogadores, registros e settings)
// ---------------------------------------------------------------------

async function init() {
  const session = await db.requireSession();
  if (!session) return;
  mountShell({ page: 'configuracoes', title: 'Importar planilha' });
  main.addEventListener('click', onClick);
  main.addEventListener('change', onChange);
  main.addEventListener('input', onInput);
  window.addEventListener('beforeunload', (event) => {
    if (state.step === 'saving') event.preventDefault();
  });
  render();
  await loadContext();
}

async function loadContext() {
  state.context = null;
  state.contextError = null;
  render();
  const [players, records, settings] = await Promise.all([
    db.listAllPlayers(),
    db.listAllPayments(),
    db.getSettings(),
  ]);
  const error = players.error || records.error || settings.error;
  if (error) state.contextError = error.message;
  else state.context = { players: players.data, records: records.data, settings: settings.data };
  if (state.step === 'review' && state.context) rebuildPlan();
  render();
}

function rebuildPlan() {
  state.plan = buildImportPlan(state.sheet, {
    players: state.context.players,
    records: state.context.records,
    numberKind: state.options.numberKind,
    years: state.options.years,
  });
}

// ---------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------

function render() {
  const focusedId = document.activeElement?.id;
  setHTML(
    main,
    html`
      <div class="import">
        <a class="back-link" href="configuracoes.html">${icons.chevronLeft} Configurações</a>
        ${stepper()}
        ${state.step === 'input' ? inputStep() : ''}
        ${state.step === 'review' ? reviewStep() : ''}
        ${state.step === 'saving' ? savingStep() : ''}
        ${state.step === 'report' ? reportStep() : ''}
      </div>
    `,
  );
  if (focusedId) document.getElementById(focusedId)?.focus();
}

function stepper() {
  const steps = [
    ['input', 'Colar'],
    ['review', 'Revisar'],
    ['saving', 'Gravar'],
  ];
  const active = state.step === 'report' ? 'saving' : state.step;
  const activeIndex = steps.findIndex(([id]) => id === active);
  return html`
    <ol class="steps" aria-label="Etapas da importação">
      ${steps.map(
        ([id, label], i) => html`
          <li class="step${i < activeIndex ? ' is-done' : ''}${i === activeIndex ? ' is-active' : ''}" ${i === activeIndex ? html`aria-current="step"` : ''}>
            <span class="step-number" aria-hidden="true">${i + 1}</span>${label}
          </li>
        `,
      )}
    </ol>
  `;
}

function contextNotice() {
  if (state.contextError) return errorState(state.contextError);
  if (!state.context) return html`<p class="muted" role="status">Carregando jogadores e pagamentos já cadastrados…</p>`;
  return '';
}

// --- Passo 1 ---------------------------------------------------------

function inputStep() {
  return html`
    <section class="card settings-card" aria-labelledby="imp-input-title">
      <h2 id="imp-input-title">Cole a planilha</h2>
      <p class="muted">
        Copie as células da planilha, incluindo o cabeçalho (Pessoa, Apelido, Número e uma coluna por mês),
        e cole abaixo. Também dá para escolher um arquivo .csv.
      </p>
      <div class="field">
        <label for="imp-text">Conteúdo da planilha</label>
        <textarea id="imp-text" class="import-textarea" rows="10" spellcheck="false" autocomplete="off" placeholder="copie as células da planilha e cole aqui" aria-describedby="imp-error">${state.text}</textarea>
      </div>
      <div class="row">
        <button type="button" class="btn btn-secondary" data-action="pick-file">${icons.upload} Escolher arquivo .csv</button>
        <input type="file" id="imp-file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden />
        ${state.fileName ? html`<span class="muted">${state.fileName}</span>` : ''}
      </div>
      <p class="form-error" id="imp-error" role="alert" ${state.inputError ? '' : html`hidden`}>${state.inputError ?? ''}</p>
      ${contextNotice()}
      <div class="form-actions">
        <button type="button" class="btn" data-action="review" ${state.context ? '' : html`disabled`}>Revisar importação</button>
      </div>
    </section>
  `;
}

// --- Passo 2 ---------------------------------------------------------

/** Registros novos usam a mensalidade do jogador ou o padrão; sobrescritos mantêm o valor. */
function needsDefaultFee() {
  const { plan, context } = state;
  if (Number(context.settings.valor_mensalidade_padrao) > 0) return false;
  const byId = new Map(context.players.map((p) => [p.id, p]));
  return plan.records.some((r) => {
    if (r.action !== 'create') return false;
    const player = r.player.id ? byId.get(r.player.id) : null; // jogador novo não tem mensalidade própria
    return !player || effectiveFee(player, context.settings) <= 0;
  });
}

function reviewStep() {
  if (!state.context) return contextNotice();
  const { plan, sheet, options } = state;
  const { byAction } = plan.totals;
  const toWrite = byAction.create + (options.overwrite ? byAction.conflict : 0);
  const blockedByFee = needsDefaultFee();
  const nothingToDo = toWrite === 0 && plan.newPlayers.length === 0;

  return html`
    <section class="import-stats" aria-label="Resumo da importação">
      ${statCard('Jogadores novos', plan.newPlayers.length, 'serão criados como ativos')}
      ${statCard('Jogadores existentes', plan.matchedPlayers.length, 'dados cadastrais não mudam')}
      ${statCard('Registros', plan.totals.records, `${byAction.create} novos · ${byAction.same} iguais · ${byAction.conflict} diferentes`)}
      ${statCard('Avisos', plan.warnings.length, plan.warnings.length ? 'veja a lista abaixo' : 'nenhum problema')}
    </section>

    <section class="card settings-card" aria-labelledby="imp-options-title">
      <h2 id="imp-options-title">Ajustes</h2>

      <div class="field">
        <label for="imp-number">Coluna Número</label>
        <select id="imp-number" ${sheet.hasNumberColumn ? '' : html`disabled`}>
          <option value="telefone" ${options.numberKind === 'telefone' ? html`selected` : ''}>Número = Telefone</option>
          <option value="camisa" ${options.numberKind === 'camisa' ? html`selected` : ''}>Número = Camisa</option>
        </select>
        <p class="field-hint">
          ${sheet.hasNumberColumn
            ? `Detectado: ${sheet.numberKind === 'telefone' ? 'telefone' : 'camisa'}. Só é usado nos jogadores novos.`
            : 'A planilha não tem coluna Número.'}
        </p>
      </div>

      <fieldset class="year-fieldset">
        <legend class="label">Ano de cada coluna de mês</legend>
        <div class="year-grid">
          ${plan.months.map((column) => yearField(column))}
        </div>
      </fieldset>

      <div class="field">
        <label class="checkbox">
          <input type="checkbox" id="imp-overwrite" ${options.overwrite ? html`checked` : ''} aria-describedby="imp-overwrite-hint" />
          Sobrescrever status que já existem no sistema
        </label>
        <p class="field-hint" id="imp-overwrite-hint">
          ${options.overwrite
            ? `${plural(byAction.conflict, 'registro terá', 'registros terão')} o status trocado pelo da planilha. O valor de cada registro é mantido.`
            : `Registros que já existem ficam como estão${byAction.conflict ? ` (${plural(byAction.conflict, 'tem', 'têm')} status diferente na planilha e ${byAction.conflict === 1 ? 'será ignorado' : 'serão ignorados'})` : ''}.`}
        </p>
      </div>
    </section>

    ${warningsList()}

    <section aria-labelledby="imp-preview-title">
      <div class="section-header">
        <h2 class="section-title" id="imp-preview-title">Prévia</h2>
      </div>
      ${previewTable()}
    </section>

    ${blockedByFee
      ? html`
          <div class="notice" role="alert">
            <div>
              <p class="notice-title">Defina a mensalidade padrão antes de importar</p>
              <p class="notice-text">Os registros novos usam a mensalidade do jogador ou o valor padrão, que hoje é ${formatMoney(state.context.settings.valor_mensalidade_padrao)}.</p>
            </div>
            <a class="btn btn-secondary" href="configuracoes.html">Ir para Configurações</a>
          </div>
        `
      : ''}

    <div class="form-actions import-actions">
      <button type="button" class="btn btn-secondary" data-action="back">Voltar</button>
      <button type="button" class="btn" data-action="confirm" ${blockedByFee || nothingToDo ? html`disabled` : ''}>
        ${icons.check} Confirmar importação
      </button>
    </div>
    ${nothingToDo ? html`<p class="field-hint import-nothing" role="status">Nada a gravar: tudo o que está na planilha já existe no sistema.</p>` : ''}
  `;
}

function statCard(label, value, sub) {
  return html`
    <div class="kpi-card import-stat">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value}</span>
      <span class="field-hint">${sub}</span>
    </div>
  `;
}

function yearOptions(selected) {
  const current = parseMonthKey(currentMonthKey()).year;
  const years = new Set([selected]);
  for (let y = current - 6; y <= current + 1; y += 1) years.add(y);
  return [...years].sort((a, b) => b - a);
}

function yearField(column) {
  const id = `imp-year-${column.index}`;
  const counts = state.plan.totals.byMonth[column.key];
  return html`
    <div class="field year-field">
      <label for="${id}">${column.header}</label>
      <select id="${id}" data-year-column="${column.index}">
        ${yearOptions(column.year).map((y) => html`<option value="${y}" ${y === column.year ? html`selected` : ''}>${y}</option>`)}
      </select>
      <span class="field-hint">
        ${column.duplicate
          ? `Repete ${formatMonth(column.key)} — ignorada`
          : `${formatMonth(column.key)}${column.hasYear ? '' : ' (ano sugerido)'} · ${counts?.total ?? 0} registros`}
      </span>
    </div>
  `;
}

function warningsList() {
  const { warnings } = state.plan;
  if (warnings.length === 0) return '';
  return html`
    <details class="card import-warnings" ${warnings.length <= 3 ? html`open` : ''}>
      <summary>${icons.alert} ${plural(warnings.length, 'aviso', 'avisos')} — linhas ou células que serão ignoradas ou ajustadas</summary>
      <ul class="warning-list">
        ${warnings.map((w) => html`<li><strong>Linha ${w.line}:</strong> ${w.message}</li>`)}
      </ul>
    </details>
  `;
}

function previewTable() {
  const { plan } = state;
  const months = plan.months.filter((m) => !m.duplicate);
  const rows = [
    ...plan.matchedPlayers.map((p) => ({ ...p, key: p.id, isNew: false })),
    ...plan.newPlayers.map((p) => ({ ...p, key: p.ref, isNew: true })),
  ].sort((a, b) => a.line - b.line);

  if (rows.length === 0) {
    return html`<p class="muted">Nenhuma linha válida para importar.</p>`;
  }

  const cells = new Map();
  for (const r of plan.records) cells.set(`${r.player.id ?? r.player.ref}|${r.mes_referencia}`, r);
  const visible = rows.slice(0, PREVIEW_LIMIT);

  return html`
    <div class="table-wrap">
      <table class="pay-table import-table">
        <caption class="sr-only">Prévia dos jogadores e status que serão importados</caption>
        <thead>
          <tr>
            <th scope="col" class="sticky-col">Jogador</th>
            <th scope="col">Número</th>
            ${months.map((m) => html`<th scope="col">${formatMonth(m.key)}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${visible.map(
            (row) => html`
              <tr>
                <th scope="row" class="sticky-col">
                  <span class="names">
                    <span class="names-top">
                      <span class="apelido">${row.apelido}</span>
                      <span class="import-tag${row.isNew ? ' import-tag--new' : ''}">${row.isNew ? 'Novo' : 'Existente'}</span>
                    </span>
                    <span class="nome">${row.nome} · linha ${row.line}</span>
                  </span>
                </th>
                <td>${numberCell(row)}</td>
                ${months.map((m) => {
                  const record = cells.get(`${row.key}|${m.key}`);
                  if (!record) return html`<td><span class="cell-empty"><span aria-hidden="true">—</span><span class="sr-only">Vazio</span></span></td>`;
                  return html`
                    <td>
                      <span class="import-cell${record.action === 'same' ? ' is-same' : ''}">
                        ${statusBadge(record.status)}
                        ${record.action === 'conflict'
                          ? html`<span class="import-cell-note">no sistema: ${STATUS[record.existingStatus].label}</span>`
                          : ''}
                        ${record.action === 'same' ? html`<span class="import-cell-note">já existe</span>` : ''}
                      </span>
                    </td>
                  `;
                })}
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
    ${rows.length > PREVIEW_LIMIT
      ? html`<p class="field-hint">Mostrando ${PREVIEW_LIMIT} de ${rows.length} linhas. Todas serão importadas.</p>`
      : ''}
  `;
}

function numberCell(row) {
  if (!row.isNew) return html`<span class="muted">—</span>`;
  if (row.telefone) return formatPhone(row.telefone);
  if (row.numero_camisa !== null && row.numero_camisa !== undefined) return `Camisa ${row.numero_camisa}`;
  return html`<span class="muted">—</span>`;
}

// --- Passo 3 ---------------------------------------------------------

function savingStep() {
  const { phase, done, total } = state.progress;
  const pct = total ? (done / total) * 100 : 0;
  return html`
    <section class="card settings-card" aria-labelledby="imp-saving-title" aria-busy="true">
      <h2 id="imp-saving-title">Gravando…</h2>
      <p role="status">
        ${phase === 'players'
          ? 'Criando os jogadores novos…'
          : `Gravando registros: ${done.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`}
      </p>
      ${progressBar(phase === 'players' ? 0 : pct, 'Progresso da gravação')}
      <p class="field-hint">Não feche esta página até terminar.</p>
    </section>
  `;
}

function reportStep() {
  const r = state.report;
  const failed = r.errors.length > 0;
  return html`
    <section class="card settings-card" aria-labelledby="imp-report-title">
      <h2 id="imp-report-title" tabindex="-1">${failed ? 'Importação interrompida' : 'Importação concluída'}</h2>
      ${failed
        ? html`
            <div class="error-state" role="alert">
              <span class="error-icon">${icons.alert}</span>
              <div>
                <p class="error-title">${r.errors.join(' ')}</p>
                <p class="error-text">
                  O que está listado abaixo já foi gravado. Como a importação nunca duplica jogadores nem registros,
                  basta rodar de novo com o mesmo conteúdo para completar.
                </p>
              </div>
              <button type="button" class="btn" data-action="retry-import">Rodar de novo</button>
            </div>
          `
        : ''}

      <h3 class="detail-section-title">${failed ? 'Já gravado' : 'Criado'}</h3>
      <ul class="report-list">
        <li><span class="report-value">${r.playersCreated.length}</span> ${r.playersCreated.length === 1 ? 'jogador criado' : 'jogadores criados'}</li>
        <li><span class="report-value">${r.recordsCreated}</span> ${r.recordsCreated === 1 ? 'registro criado' : 'registros criados'}</li>
        ${r.overwrite ? html`<li><span class="report-value">${r.recordsUpdated}</span> ${r.recordsUpdated === 1 ? 'registro atualizado' : 'registros atualizados'}</li>` : ''}
      </ul>
      ${r.playersCreated.length
        ? html`
            <details class="report-details">
              <summary>Ver jogadores criados</summary>
              <p class="muted">${r.playersCreated.map((p) => p.apelido).join(', ')}</p>
            </details>
          `
        : ''}

      <h3 class="detail-section-title">Ignorado</h3>
      <ul class="report-list">
        <li><span class="report-value">${r.skippedSame}</span> já existiam com o mesmo status</li>
        ${r.overwrite ? '' : html`<li><span class="report-value">${r.skippedConflict}</span> já existiam com outro status (sobrescrever desmarcado)</li>`}
        ${r.skippedRace ? html`<li><span class="report-value">${r.skippedRace}</span> foram criados por outra pessoa durante a importação</li>` : ''}
        <li><span class="report-value">${r.warnings}</span> ${r.warnings === 1 ? 'aviso da revisão' : 'avisos da revisão'} (linhas ou células não importadas)</li>
        ${failed ? html`<li><span class="report-value">${r.notSent}</span> registros não chegaram a ser gravados</li>` : ''}
      </ul>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-action="restart">Importar outra planilha</button>
        <a class="btn" href="pagamentos.html">Ver pagamentos</a>
      </div>
    </section>
  `;
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------

function onInput(event) {
  if (event.target.id === 'imp-text') state.text = event.target.value;
}

async function onChange(event) {
  const { target } = event;
  if (target.id === 'imp-file') {
    await readFile(target.files?.[0]);
  } else if (target.id === 'imp-number') {
    state.options.numberKind = target.value;
    rebuildPlan();
    render();
  } else if (target.dataset.yearColumn) {
    state.options.years[target.dataset.yearColumn] = Number(target.value);
    rebuildPlan();
    render();
  } else if (target.id === 'imp-overwrite') {
    state.options.overwrite = target.checked;
    render();
  }
}

function onClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target || !main.contains(target)) return;
  const { action } = target.dataset;

  if (action === 'pick-file') document.getElementById('imp-file').click();
  else if (action === 'review') review();
  else if (action === 'back') goTo('input');
  else if (action === 'confirm') confirmImport();
  else if (action === 'retry') loadContext();
  else if (action === 'retry-import') retryImport();
  else if (action === 'restart') restart();
}

function goTo(step) {
  state.step = step;
  render();
  main.focus();
  window.scrollTo({ top: 0 });
}

/** Lê o arquivo como UTF-8; se não for UTF-8 válido, usa Windows-1252 (CSV antigo do Excel). */
async function readFile(file) {
  if (!file) return;
  const buffer = await file.arrayBuffer();
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  state.text = text;
  state.fileName = file.name;
  state.inputError = null;
  render();
}

function review() {
  if (!state.context) return;
  const sheet = parseSheet(state.text);
  if (sheet.error) {
    state.inputError = sheet.error;
    render();
    document.getElementById('imp-text')?.focus();
    return;
  }
  state.inputError = null;
  state.sheet = sheet;
  state.options = { numberKind: sheet.numberKind, years: {}, overwrite: false };
  rebuildPlan();
  goTo('review');
}

async function restart() {
  state.text = '';
  state.fileName = '';
  state.sheet = null;
  state.plan = null;
  state.report = null;
  goTo('input');
  await loadContext();
}

/** Depois de um erro: recarrega os dados do banco e volta para a revisão com o mesmo conteúdo. */
async function retryImport() {
  state.report = null;
  state.step = 'review';
  await loadContext();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------

async function confirmImport() {
  const { plan, options } = state;
  const { byAction } = plan.totals;
  const toWrite = byAction.create + (options.overwrite ? byAction.conflict : 0);
  const confirmed = await confirmDialog({
    title: 'Confirmar importação?',
    message:
      `Serão criados ${plural(plan.newPlayers.length, 'jogador', 'jogadores')} e gravados ` +
      `${plural(toWrite, 'registro', 'registros')}` +
      `${options.overwrite && byAction.conflict ? ` (${byAction.conflict} com status sobrescrito)` : ''}. ` +
      'Registros importados ficam sem data de pagamento.',
    confirmLabel: 'Importar',
  });
  if (!confirmed) return;
  await save();
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function save() {
  const { plan, options, context } = state;
  const report = {
    overwrite: options.overwrite,
    playersCreated: [],
    recordsCreated: 0,
    recordsUpdated: 0,
    skippedSame: plan.totals.byAction.same,
    skippedConflict: options.overwrite ? 0 : plan.totals.byAction.conflict,
    skippedRace: 0,
    notSent: 0,
    warnings: plan.warnings.length,
    errors: [],
  };
  const finish = () => {
    state.report = report;
    state.step = 'report';
    render();
    document.getElementById('imp-report-title')?.focus();
    window.scrollTo({ top: 0 });
  };

  state.step = 'saving';
  state.progress = { phase: 'players', done: 0, total: 0 };
  render();

  // 1. Jogadores novos
  const playerOfRef = new Map();
  for (const chunk of chunks(plan.newPlayers, BATCH_SIZE)) {
    const { data, error } = await db.createPlayers(
      chunk.map((p) => ({
        nome: p.nome,
        apelido: p.apelido,
        telefone: p.telefone,
        numero_camisa: p.numero_camisa,
        ativo: true,
      })),
    );
    if (error) {
      report.errors.push(`Erro ao criar jogadores: ${error.message}`);
      report.notSent = plan.totals.byAction.create + (options.overwrite ? plan.totals.byAction.conflict : 0);
      finish();
      return;
    }
    // O Postgres devolve na ordem inserida; conferimos pelo apelido por segurança.
    const pool = [...data];
    for (const planned of chunk) {
      const index = pool.findIndex((row) => row.apelido === planned.apelido && row.nome === planned.nome);
      const created = pool.splice(index === -1 ? 0 : index, 1)[0];
      playerOfRef.set(planned.ref, created);
      report.playersCreated.push(created);
    }
  }

  // 2. Registros
  const playersById = new Map(context.players.map((p) => [p.id, p]));
  const existing = new Map(context.records.map((r) => [`${r.player_id}|${r.mes_referencia}`, r]));
  const rows = [];
  const updateKeys = new Set();
  for (const r of plan.records) {
    if (r.action === 'same') continue;
    if (r.action === 'conflict' && !options.overwrite) continue;
    const player = r.player.id ? playersById.get(r.player.id) : playerOfRef.get(r.player.ref);
    const key = `${player.id}|${r.mes_referencia}`;
    const current = existing.get(key);
    if (r.action === 'conflict') updateKeys.add(key);
    rows.push({
      player_id: player.id,
      mes_referencia: r.mes_referencia,
      status: r.status,
      // Sobrescrever troca só o status: o valor já gravado é mantido.
      valor: current ? current.valor : effectiveFee(player, context.settings),
      pago_em: null,
    });
  }

  state.progress = { phase: 'records', done: 0, total: rows.length };
  render();

  for (const [index, batch] of chunks(rows, BATCH_SIZE).entries()) {
    const { data, error } = await db.upsertPaymentRecords(batch, { overwrite: options.overwrite });
    if (error) {
      const first = index * BATCH_SIZE + 1;
      report.errors.push(`Erro ao gravar os registros ${first} a ${first + batch.length - 1}: ${error.message}`);
      report.notSent = rows.length - index * BATCH_SIZE;
      finish();
      return;
    }
    for (const saved of data) {
      if (updateKeys.has(`${saved.player_id}|${saved.mes_referencia}`)) report.recordsUpdated += 1;
      else report.recordsCreated += 1;
    }
    report.skippedRace += batch.length - data.length;
    state.progress.done += batch.length;
    render();
  }

  finish();
  toast(`Importação concluída: ${plural(report.recordsCreated + report.recordsUpdated, 'registro gravado', 'registros gravados')}.`);
}

init();
