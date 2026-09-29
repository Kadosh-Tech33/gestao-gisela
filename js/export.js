// Exportação no formato da planilha antiga e backup em JSON.
// Só funções puras (o download com Blob fica em ui.js).

import { formatMonth, formatPhone, byApelido } from './utils.js';

export const CSV_DELIMITER = ';';
const BOM = '﻿';
const STATUS_TO_CELL = { pago: 'Sim', pendente: 'Não', isento: 'Off' };

/**
 * Escapa um campo para CSV com ';'. Protege contra fórmulas do Excel
 * prefixando ' em valores que começam com = + - @ (o parser de importação
 * remove esse prefixo).
 */
export function csvField(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Meses que têm registros, em ordem, opcionalmente limitados a um intervalo. */
export function monthsWithRecords(records, fromMes = null, toMes = null) {
  const months = new Set();
  for (const r of records) {
    if ((fromMes && r.mes_referencia < fromMes) || (toMes && r.mes_referencia > toMes)) continue;
    months.add(r.mes_referencia);
  }
  return [...months].sort();
}

/**
 * Gera o CSV no formato da planilha antiga:
 *   Pessoa;Apelido;Número;Set/2026;...   com Sim / Não / Off
 * Inclui os jogadores com registro no intervalo e todos os ativos.
 * numberKind decide o que vai na coluna Número: 'telefone' ou 'camisa'.
 */
export function buildSheetCsv({ players, records, fromMes = null, toMes = null, numberKind = 'telefone' }) {
  const months = monthsWithRecords(records, fromMes, toMes);
  const monthSet = new Set(months);
  const statusOf = new Map();
  const withRecords = new Set();
  for (const r of records) {
    if (!monthSet.has(r.mes_referencia)) continue;
    statusOf.set(`${r.player_id}|${r.mes_referencia}`, r.status);
    withRecords.add(r.player_id);
  }

  const rows = players
    .filter((p) => p.ativo || withRecords.has(p.id))
    .sort(byApelido)
    .map((p) => [
      p.nome,
      p.apelido,
      numberKind === 'camisa' ? (p.numero_camisa ?? '') : p.telefone ? formatPhone(p.telefone) : '',
      ...months.map((m) => STATUS_TO_CELL[statusOf.get(`${p.id}|${m}`)] ?? ''),
    ]);

  const header = ['Pessoa', 'Apelido', 'Número', ...months.map(formatMonth)];
  const lines = [header, ...rows].map((cells) => cells.map(csvField).join(CSV_DELIMITER));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Backup completo: players, payment_records e settings, como vieram do banco. */
export function buildBackupJson({ players, records, settings, exportedAt }) {
  return JSON.stringify(
    {
      app: 'gisela',
      formato: 1,
      exportado_em: exportedAt,
      settings,
      players,
      payment_records: records,
    },
    null,
    2,
  );
}

/** 'gisela-planilha-2026-09-29.csv' */
export function exportFileName(kind, dayIso) {
  return kind === 'backup' ? `gisela-backup-${dayIso}.json` : `gisela-planilha-${dayIso}.csv`;
}
