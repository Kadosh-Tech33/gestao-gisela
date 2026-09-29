// Parser da planilha antiga -> plano de importação.
// Só funções puras: sem DOM e sem Supabase (testado com node --test).
//
// Fluxo:
//   parseSheet(texto)                -> estrutura da planilha (cabeçalho, linhas, meses)
//   buildImportPlan(sheet, opções)   -> jogadores novos/existentes, registros, avisos, totais
// A tela de revisão chama buildImportPlan de novo sempre que o usuário troca
// o ano de uma coluna ou o significado da coluna Número.

import { monthKey, parseMonthKey, currentMonthKey, formatMonth, normalizeText, normalizePhone } from './utils.js';

const MONTH_NAMES = [
  ['janeiro', 'jan'],
  ['fevereiro', 'fev'],
  ['marco', 'mar'],
  ['abril', 'abr'],
  ['maio', 'mai'],
  ['junho', 'jun'],
  ['julho', 'jul'],
  ['agosto', 'ago'],
  ['setembro', 'set'],
  ['outubro', 'out'],
  ['novembro', 'nov'],
  ['dezembro', 'dez'],
];

const PESSOA_HEADERS = ['pessoa', 'nome', 'nome completo', 'jogador'];
const APELIDO_HEADERS = ['apelido'];
const NUMERO_HEADERS = {
  numero: null,
  'n°': null,
  'nº': null,
  no: null,
  telefone: 'telefone',
  celular: 'telefone',
  whatsapp: 'telefone',
  camisa: 'camisa',
};

const STATUS_WORDS = {
  sim: 'pago',
  s: 'pago',
  pago: 'pago',
  nao: 'pendente',
  n: 'pendente',
  pendente: 'pendente',
  off: 'isento',
  isento: 'isento',
  '-': 'isento',
  '–': 'isento',
  '—': 'isento',
};

// ---------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------

/** Sem acento, minúsculo, sem espaços extras. Usado em cabeçalhos e no casamento de jogadores. */
export function normalizeKey(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

export function stripBom(text) {
  return String(text ?? '').replace(/^﻿/, '');
}

/** Tira espaços extras e o apóstrofo que protege fórmulas no Excel ('=...). */
function cleanText(value) {
  return String(value ?? '')
    .replace(/^'(?=[=+\-@])/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------

/** Primeira linha lógica (respeitando aspas), usada para detectar o delimitador. */
function firstLine(text) {
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) return text.slice(0, i);
  }
  return text;
}

/** '\t', ';' ou ',' — o que mais aparece no cabeçalho, fora de aspas. null se nenhum. */
export function detectDelimiter(text) {
  const header = firstLine(stripBom(text));
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let inQuotes = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  let best = null;
  for (const d of ['\t', ';', ',']) {
    if (counts[d] > 0 && (best === null || counts[d] > counts[best])) best = d;
  }
  return best;
}

/**
 * Quebra o texto em linhas e células (RFC 4180): aspas duplas delimitam
 * campos, "" é uma aspa literal, e quebras de linha dentro de aspas são
 * mantidas. Cada linha traz o número da linha física onde começa.
 */
export function parseDelimited(text, delimiter) {
  const rows = [];
  let cells = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else if (ch === '\r' && text[i + 1] === '\n') {
        // \r\n dentro de aspas vira \n
      } else {
        if (ch === '\n' || ch === '\r') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(field);
      rows.push({ line: rowLine, cells });
      cells = [];
      field = '';
      line += 1;
      rowLine = line;
    } else {
      field += ch;
    }
  }

  if (field !== '' || cells.length > 0) {
    cells.push(field);
    rows.push({ line: rowLine, cells });
  }
  return rows;
}

// ---------------------------------------------------------------------
// Cabeçalhos de mês
// ---------------------------------------------------------------------

function monthFromName(word) {
  const index = MONTH_NAMES.findIndex(([full, abbr]) => word === full || word === abbr);
  return index === -1 ? null : index + 1;
}

/**
 * Reconhece 'Set', 'Setembro', 'Set/2026', 'set./26', 'Setembro 2026',
 * 'Setembro de 2026', '09/2026', '2026-09' e '01/09/2026' (data do Excel).
 * Devolve { month, year, suggestedYear } ou null. year é null quando o
 * cabeçalho não tem ano; suggestedYear é o ano atual, ou o anterior se o
 * mês for posterior ao mês atual.
 */
export function parseMonthHeader(header, now = currentMonthKey()) {
  const s = normalizeKey(header).replace(/\.$/, '');
  let month = null;
  let year = null;
  let m;

  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    month = Number(m[2]);
    year = Number(m[3]);
  } else if ((m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s))) {
    year = Number(m[1]);
    month = Number(m[2]);
  } else if ((m = /^(\d{1,2})[/-](\d{2}|\d{4})$/.exec(s))) {
    month = Number(m[1]);
    year = Number(m[2]);
  } else if ((m = /^([a-z]+)\.?(?:\s*(?:[/.-]|de)?\s*(\d{2}|\d{4}))?$/.exec(s))) {
    month = monthFromName(m[1]);
    year = m[2] ? Number(m[2]) : null;
  }

  if (!month || month < 1 || month > 12) return null;
  if (year !== null && year < 100) year += 2000;

  const current = parseMonthKey(now);
  const suggestedYear = year ?? (month > current.month ? current.year - 1 : current.year);
  return { month, year, suggestedYear };
}

// ---------------------------------------------------------------------
// Células
// ---------------------------------------------------------------------

/** 'pago' | 'pendente' | 'isento' | '' (célula vazia) | null (valor inválido). */
export function interpretStatus(value) {
  const v = normalizeKey(value).replace(/\.$/, '');
  if (!v) return '';
  return STATUS_WORDS[v] ?? null;
}

/** 'telefone' se a maioria dos valores preenchidos tiver 8+ dígitos; senão 'camisa'. */
export function detectNumberKind(values) {
  let filled = 0;
  let phones = 0;
  for (const value of values) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) continue;
    filled += 1;
    if (digits.length >= 8) phones += 1;
  }
  return filled > 0 && phones * 2 > filled ? 'telefone' : 'camisa';
}

/** Interpreta a coluna Número conforme a escolha. Devolve { telefone, numero_camisa, warning }. */
export function interpretNumber(value, kind) {
  const text = String(value ?? '').trim();
  const empty = { telefone: null, numero_camisa: null, warning: null };
  if (!text) return empty;

  if (kind === 'telefone') {
    const phone = normalizePhone(text);
    if (phone.valid && phone.value) return { ...empty, telefone: phone.value };
    return { ...empty, warning: `Telefone "${text}" inválido — o jogador será criado sem telefone.` };
  }

  const digits = text.replace(/\D/g, '');
  if (/^\d{1,3}$/.test(text.replace(/\s/g, '')) && Number(digits) <= 999) {
    return { ...empty, numero_camisa: Number(digits) };
  }
  return { ...empty, warning: `Camisa "${text}" inválida (use de 0 a 999) — o jogador será criado sem número.` };
}

// ---------------------------------------------------------------------
// Planilha
// ---------------------------------------------------------------------

/**
 * Lê o texto colado/arquivo. Devolve { error } quando não dá para seguir, ou
 * { delimiter, headerLine, months, rows, numberKind, numberHint, hasNumberColumn, warnings }.
 * months: [{ index, header, month, year, hasYear }] — year já vem com a sugestão.
 * rows:   [{ line, pessoa, apelido, numero, values: [texto por coluna de mês] }]
 */
export function parseSheet(text, { now = currentMonthKey() } = {}) {
  const clean = stripBom(text);
  if (!clean.trim()) {
    return { error: 'Cole o conteúdo da planilha ou escolha um arquivo .csv.' };
  }

  const delimiter = detectDelimiter(clean);
  if (!delimiter) {
    return {
      error:
        'Não encontrei colunas. Copie as células direto da planilha (com o cabeçalho) ou use um CSV separado por ponto e vírgula, vírgula ou tabulação.',
    };
  }

  const rows = parseDelimited(clean, delimiter).filter((r) => r.cells.some((c) => c.trim() !== ''));
  const [header, ...data] = rows;
  const warnings = [];
  const columns = { pessoa: null, apelido: null, numero: null };
  let numberHint = null;
  const months = [];

  header.cells.forEach((cell, index) => {
    const key = normalizeKey(cell).replace(/[:.]$/, '');
    if (!key) return;
    if (PESSOA_HEADERS.includes(key) && columns.pessoa === null) {
      columns.pessoa = index;
    } else if (APELIDO_HEADERS.includes(key) && columns.apelido === null) {
      columns.apelido = index;
    } else if (key in NUMERO_HEADERS && columns.numero === null) {
      columns.numero = index;
      numberHint = NUMERO_HEADERS[key];
    } else {
      const parsed = parseMonthHeader(cell, now);
      if (parsed) {
        months.push({
          index,
          header: cell.trim(),
          month: parsed.month,
          year: parsed.year ?? parsed.suggestedYear,
          hasYear: parsed.year !== null,
        });
      } else {
        warnings.push({ line: header.line, message: `Coluna "${cell.trim()}" não reconhecida e foi ignorada.` });
      }
    }
  });

  if (columns.pessoa === null && columns.apelido === null) {
    return {
      error: 'Não encontrei as colunas Pessoa e Apelido. A primeira linha precisa ser o cabeçalho: Pessoa, Apelido, Número e os meses.',
    };
  }
  if (months.length === 0) {
    return {
      error: 'Nenhuma coluna de mês foi reconhecida no cabeçalho. Use nomes como "Set", "Setembro" ou "Set/2026".',
    };
  }

  const cellAt = (row, index) => (index === null ? '' : String(row.cells[index] ?? ''));
  const entries = data.map((row) => ({
    line: row.line,
    pessoa: cellAt(row, columns.pessoa),
    apelido: cellAt(row, columns.apelido),
    numero: cellAt(row, columns.numero),
    values: months.map((m) => cellAt(row, m.index).trim()),
  }));

  return {
    error: null,
    delimiter,
    headerLine: header.line,
    months,
    rows: entries,
    hasNumberColumn: columns.numero !== null,
    numberHint,
    numberKind: numberHint ?? detectNumberKind(entries.map((e) => e.numero)),
    warnings,
  };
}

// ---------------------------------------------------------------------
// Plano de importação
// ---------------------------------------------------------------------

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/** Entre vários jogadores com o mesmo apelido, prefere o de mesmo nome, depois um ativo. */
function pickCandidate(candidates, nome) {
  const byName = candidates.find((p) => normalizeKey(p.nome) === normalizeKey(nome));
  return byName ?? candidates.find((p) => p.ativo) ?? candidates[0];
}

function emptyCounts() {
  return { pago: 0, pendente: 0, isento: 0, total: 0 };
}

/**
 * Monta o plano de importação.
 * opções:
 *   players     jogadores já cadastrados
 *   records     registros já gravados (para classificar criar / igual / conflito)
 *   numberKind  'telefone' | 'camisa' (padrão: o detectado)
 *   years       { [índice da coluna]: ano } — ano escolhido na revisão
 *
 * Devolve:
 *   newPlayers     [{ ref, line, nome, apelido, telefone, numero_camisa, ativo }]
 *   matchedPlayers [{ line, id, nome, apelido, ativo, via: 'apelido' | 'nome' }]
 *   records        [{ player: { id } | { ref }, line, mes_referencia, status, action, existingStatus }]
 *                  action: 'create' | 'same' (já existe com o mesmo status) | 'conflict'
 *   months         [{ index, header, month, year, hasYear, key, duplicate }]
 *   warnings       [{ line, message }] ordenados pela linha
 *   totals         { byMonth: { [mes]: contagens }, byStatus, byAction, records }
 */
export function buildImportPlan(sheet, { players = [], records = [], numberKind, years = {} } = {}) {
  const kind = numberKind ?? sheet.numberKind;
  const warnings = [...sheet.warnings];

  // Meses: aplica o ano escolhido e descarta colunas repetidas.
  const firstByKey = new Map();
  const months = sheet.months.map((m) => {
    const year = Number(years[m.index] ?? m.year);
    const key = monthKey(year, m.month);
    const first = firstByKey.get(key);
    if (first) {
      warnings.push({
        line: sheet.headerLine,
        message: `A coluna "${m.header}" repete ${formatMonth(key)} (coluna "${first.header}"); só a primeira será usada.`,
      });
      return { ...m, year, key, duplicate: true };
    }
    const column = { ...m, year, key, duplicate: false };
    firstByKey.set(key, column);
    return column;
  });

  const byApelido = groupBy(players, (p) => normalizeKey(p.apelido));
  const byNome = groupBy(players, (p) => normalizeKey(p.nome));
  const existing = new Map(records.map((r) => [`${r.player_id}|${r.mes_referencia}`, r]));

  const newPlayers = [];
  const matchedPlayers = [];
  const planRecords = [];
  const seenRows = new Map(); // chave normalizada -> linha
  const matchedIds = new Map(); // id do jogador -> linha

  for (const row of sheet.rows) {
    const nome = cleanText(row.pessoa);
    const apelido = cleanText(row.apelido);
    const label = apelido || nome;

    if (!nome && !apelido) {
      if (row.values.some((v) => v !== '')) {
        warnings.push({ line: row.line, message: 'Linha sem Pessoa e sem Apelido — ignorada.' });
      }
      continue;
    }

    const rowKey = apelido ? `apelido:${normalizeKey(apelido)}` : `nome:${normalizeKey(nome)}`;
    if (seenRows.has(rowKey)) {
      warnings.push({
        line: row.line,
        message: `"${label}" aparece de novo (primeira vez na linha ${seenRows.get(rowKey)}) — só a primeira linha foi usada.`,
      });
      continue;
    }
    seenRows.set(rowKey, row.line);

    // Casamento: apelido normalizado, depois nome completo normalizado.
    let player = null;
    let via = null;
    const byNick = apelido ? byApelido.get(normalizeKey(apelido)) ?? [] : [];
    if (byNick.length > 0) {
      player = pickCandidate(byNick, nome);
      via = 'apelido';
      if (byNick.length > 1) {
        warnings.push({
          line: row.line,
          message: `Há ${byNick.length} jogadores com o apelido "${apelido}"; usado ${player.apelido} (${player.nome}).`,
        });
      }
    } else if (nome) {
      const byName = byNome.get(normalizeKey(nome)) ?? [];
      if (byName.length > 0) {
        player = pickCandidate(byName, nome);
        via = 'nome';
      }
    }

    let ref;
    if (player) {
      if (matchedIds.has(player.id)) {
        warnings.push({
          line: row.line,
          message: `"${label}" corresponde ao mesmo jogador da linha ${matchedIds.get(player.id)} (${player.apelido}) — só a primeira linha foi usada.`,
        });
        continue;
      }
      matchedIds.set(player.id, row.line);
      matchedPlayers.push({ line: row.line, id: player.id, nome: player.nome, apelido: player.apelido, ativo: player.ativo, via });
      ref = { id: player.id };
    } else {
      const number = interpretNumber(row.numero, kind);
      if (number.warning) warnings.push({ line: row.line, message: number.warning });
      const finalApelido = apelido || nome.split(' ')[0];
      if (!apelido) {
        warnings.push({ line: row.line, message: `Sem apelido — o jogador será criado com o apelido "${finalApelido}".` });
      }
      const newPlayer = {
        ref: `new:${newPlayers.length}`,
        line: row.line,
        nome: nome || apelido,
        apelido: finalApelido,
        telefone: number.telefone,
        numero_camisa: number.numero_camisa,
        ativo: true,
      };
      newPlayers.push(newPlayer);
      ref = { ref: newPlayer.ref };
    }

    months.forEach((column, i) => {
      if (column.duplicate) return;
      const raw = row.values[i];
      const status = interpretStatus(raw);
      if (status === '') return;
      if (status === null) {
        warnings.push({
          line: row.line,
          message: `Valor "${raw}" em ${column.header} não reconhecido — célula ignorada. Use Sim, Não ou Off.`,
        });
        return;
      }
      const current = ref.id ? existing.get(`${ref.id}|${column.key}`) : null;
      planRecords.push({
        player: ref,
        line: row.line,
        mes_referencia: column.key,
        status,
        action: !current ? 'create' : current.status === status ? 'same' : 'conflict',
        existingStatus: current?.status ?? null,
      });
    });
  }

  const totals = {
    byMonth: {},
    byStatus: emptyCounts(),
    byAction: { create: 0, same: 0, conflict: 0 },
    records: planRecords.length,
  };
  for (const column of months) {
    if (!column.duplicate) totals.byMonth[column.key] = emptyCounts();
  }
  for (const r of planRecords) {
    totals.byMonth[r.mes_referencia][r.status] += 1;
    totals.byMonth[r.mes_referencia].total += 1;
    totals.byStatus[r.status] += 1;
    totals.byStatus.total += 1;
    totals.byAction[r.action] += 1;
  }

  warnings.sort((a, b) => a.line - b.line);

  return { numberKind: kind, months, newPlayers, matchedPlayers, records: planRecords, warnings, totals };
}
