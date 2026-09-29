import * as db from '../db.js';
import { html, setHTML, formatMoney, formatMonth, moneyToInput, parseMoney, formatDateTime, todayIso, plural } from '../utils.js';
import { buildSheetCsv, buildBackupJson, exportFileName, monthsWithRecords } from '../export.js';
import { mountShell, toast, toastError, skeletonBlock, errorState, icons, withBusy, downloadFile } from '../ui.js';

const main = document.getElementById('main');
let session = null;
let exportMonths = null; // meses com registros (null = carregando, [] = nenhum)

async function init() {
  session = await db.requireSession();
  if (!session) return;
  mountShell({ page: 'configuracoes', title: 'Configurações' });
  main.addEventListener('click', onClick);
  await load();
}

async function load() {
  setHTML(main, html`<div class="settings">${skeletonBlock(220)}${skeletonBlock(220)}${skeletonBlock(120)}</div>`);
  const { data: settings, error } = await db.getSettings();
  if (error) {
    setHTML(main, errorState(error.message));
    return;
  }
  setHTML(
    main,
    html`
      <div class="settings">
        <div id="fee-section"></div>
        <div id="data-section"></div>
        ${accountSection()}
      </div>
    `,
  );
  renderFee(settings);
  renderData();
  loadExportMonths();
}

function onClick(event) {
  const target = event.target.closest('[data-action], #logout');
  if (!target) return;
  if (target.dataset.action === 'retry') load();
  else if (target.dataset.action === 'export-csv') exportCsv(target);
  else if (target.dataset.action === 'backup') exportBackup(target);
  else if (target.id === 'logout') logout(target);
}

// ---------------------------------------------------------------------
// Mensalidade padrão
// ---------------------------------------------------------------------

function renderFee(settings) {
  const section = document.getElementById('fee-section');
  setHTML(
    section,
    html`
      <section class="card settings-card" aria-labelledby="fee-title">
        <h2 id="fee-title">Mensalidade padrão</h2>
        <form class="form" id="fee-form" novalidate>
          <div class="field">
            <label for="fee">Valor padrão da mensalidade (R$)</label>
            <input id="fee" name="fee" inputmode="decimal" autocomplete="off" value="${moneyToInput(settings.valor_mensalidade_padrao)}" aria-describedby="fee-note fee-error" required />
            <p class="field-error" id="fee-error" hidden></p>
          </div>
          <p class="settings-note" id="fee-note">
            A mudança só vale para os meses abertos <strong>depois</strong> dela. Meses já abertos
            mantêm o valor de cada registro — para ajustar um mês aberto, use "Editar valor" na tela
            Pagamentos. Jogadores com mensalidade personalizada não são afetados.
          </p>
          ${settings.updated_at
            ? html`<p class="field-hint">Valor atual: ${formatMoney(settings.valor_mensalidade_padrao)} · alterado em ${formatDateTime(settings.updated_at)}</p>`
            : ''}
          <div class="form-actions">
            <button type="submit" class="btn">Salvar valor</button>
          </div>
        </form>
      </section>
    `,
  );

  const form = document.getElementById('fee-form');
  const input = form.fee;
  const errorEl = document.getElementById('fee-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = parseMoney(input.value);
    if (value === null || Number.isNaN(value)) {
      errorEl.textContent = 'Informe um valor válido, por exemplo 80 ou 80,50.';
      errorEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    errorEl.hidden = true;
    input.removeAttribute('aria-invalid');

    const submit = form.querySelector('[type="submit"]');
    const { data, error } = await withBusy(submit, () =>
      db.updateSettings({ valor_mensalidade_padrao: value }),
    );
    if (error) {
      toastError(error);
      return;
    }
    toast(`Mensalidade padrão salva: ${formatMoney(data.valor_mensalidade_padrao)}. Vale para os próximos meses abertos.`);
    renderFee(data);
  });
}

// ---------------------------------------------------------------------
// Dados: importar, exportar CSV e backup
// ---------------------------------------------------------------------

async function loadExportMonths() {
  const { data, error } = await db.listAllPayments();
  exportMonths = error ? [] : monthsWithRecords(data);
  renderData();
}

function monthOptions(selectedIndex) {
  return exportMonths.map(
    (m, i) => html`<option value="${m}" ${i === selectedIndex ? html`selected` : ''}>${formatMonth(m)}</option>`,
  );
}

function renderData() {
  const section = document.getElementById('data-section');
  if (!section) return;
  const loading = exportMonths === null;
  const empty = !loading && exportMonths.length === 0;

  setHTML(
    section,
    html`
      <section class="card settings-card" aria-labelledby="data-title">
        <h2 id="data-title">Dados</h2>

        <div class="data-item">
          <div>
            <p class="data-item-title">Importar planilha</p>
            <p class="field-hint">Traga a planilha antiga colando as células ou escolhendo um .csv. Você revisa tudo antes de gravar.</p>
          </div>
          <a class="btn btn-secondary" href="importar.html">${icons.upload} Importar planilha</a>
        </div>

        <div class="data-item data-item--form">
          <div>
            <p class="data-item-title">Exportar planilha (CSV)</p>
            <p class="field-hint">Mesmo formato da planilha antiga (Pessoa;Apelido;Número;meses com Sim/Não/Off). Abre no Excel e pode ser importada de volta.</p>
          </div>
          ${loading
            ? html`<p class="muted" role="status">Carregando meses…</p>`
            : empty
              ? html`<p class="muted">Ainda não há registros de pagamento para exportar.</p>`
              : html`
                  <div class="export-fields">
                    <div class="field">
                      <label for="export-from">De</label>
                      <select id="export-from">${monthOptions(0)}</select>
                    </div>
                    <div class="field">
                      <label for="export-to">Até</label>
                      <select id="export-to">${monthOptions(exportMonths.length - 1)}</select>
                    </div>
                    <div class="field">
                      <label for="export-number">Coluna Número</label>
                      <select id="export-number">
                        <option value="telefone">Telefone</option>
                        <option value="camisa">Camisa</option>
                      </select>
                    </div>
                  </div>
                  <p class="field-hint">Padrão: todos os meses (${formatMonth(exportMonths[0])} a ${formatMonth(exportMonths.at(-1))}).</p>
                `}
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" data-action="export-csv" ${loading || empty ? html`disabled` : ''}>${icons.download} Exportar planilha (CSV)</button>
          </div>
        </div>

        <div class="data-item">
          <div>
            <p class="data-item-title">Backup completo (JSON)</p>
            <p class="field-hint">Jogadores, pagamentos e configurações, com todos os campos. Guarde em um lugar seguro.</p>
          </div>
          <button type="button" class="btn btn-secondary" data-action="backup">${icons.database} Baixar backup</button>
        </div>
      </section>
    `,
  );
}

async function exportCsv(button) {
  let fromMes = document.getElementById('export-from').value;
  let toMes = document.getElementById('export-to').value;
  if (fromMes > toMes) [fromMes, toMes] = [toMes, fromMes];
  const numberKind = document.getElementById('export-number').value;

  const result = await withBusy(button, async () => {
    const [players, records] = await Promise.all([db.listAllPlayers(), db.listAllPayments()]);
    return players.error ? players : records.error ? records : { data: { players: players.data, records: records.data } };
  });
  if (result.error) {
    toastError(result.error);
    return;
  }

  const { players, records } = result.data;
  const months = monthsWithRecords(records, fromMes, toMes);
  if (months.length === 0) {
    toast('Não há registros nesse intervalo de meses.');
    return;
  }
  const csv = buildSheetCsv({ players, records, fromMes, toMes, numberKind });
  downloadFile(exportFileName('csv', todayIso()), csv, 'text/csv;charset=utf-8');
  toast(`Planilha exportada com ${plural(months.length, 'mês', 'meses')} (${formatMonth(months[0])} a ${formatMonth(months.at(-1))}).`);
}

async function exportBackup(button) {
  const { data, error } = await withBusy(button, () => db.getBackupData());
  if (error) {
    toastError(error);
    return;
  }
  const json = buildBackupJson({
    players: data.players,
    records: data.records,
    settings: data.settings[0] ?? null,
    exportedAt: new Date().toISOString(),
  });
  downloadFile(exportFileName('backup', todayIso()), json, 'application/json');
  toast(
    `Backup baixado: ${plural(data.players.length, 'jogador', 'jogadores')} e ${plural(data.records.length, 'registro', 'registros')}.`,
  );
}

// ---------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------

function accountSection() {
  return html`
    <section class="card settings-card" aria-labelledby="account-title">
      <h2 id="account-title">Conta</h2>
      <p class="muted">Conectado como <strong>${session.user?.email ?? ''}</strong></p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="logout">${icons.logout} Sair</button>
      </div>
    </section>
  `;
}

async function logout(button) {
  const { error } = await withBusy(button, () => db.signOut());
  if (error) {
    toastError(error);
    return;
  }
  window.location.replace('login.html');
}

init();
