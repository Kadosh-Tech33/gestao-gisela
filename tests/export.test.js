import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetCsv, buildBackupJson, csvField, monthsWithRecords } from '../js/export.js';
import { parseSheet, buildImportPlan } from '../js/import.js';

const NOW = '2026-09-01';

const players = [
  { id: 'p1', nome: 'João da Silva', apelido: 'Jão', telefone: '5511912345678', numero_camisa: 10, ativo: true },
  { id: 'p2', nome: 'Silva; "Bia"', apelido: 'Bia', telefone: null, numero_camisa: 7, ativo: true },
  { id: 'p3', nome: 'Carlos Ândrade', apelido: '=Carlão', telefone: '551132345678', numero_camisa: null, ativo: false },
  { id: 'p4', nome: 'Sem Registro', apelido: 'Novato', telefone: null, numero_camisa: null, ativo: true },
];

const records = [
  { player_id: 'p1', mes_referencia: '2025-12-01', status: 'pago' },
  { player_id: 'p1', mes_referencia: '2026-01-01', status: 'pendente' },
  { player_id: 'p2', mes_referencia: '2026-01-01', status: 'isento' },
  { player_id: 'p3', mes_referencia: '2025-12-01', status: 'pendente' },
  { player_id: 'p2', mes_referencia: '2026-09-01', status: 'pago' },
];

describe('exportação CSV', () => {
  test('formato: BOM, ponto e vírgula, cabeçalho e Sim/Não/Off', () => {
    const csv = buildSheetCsv({ players, records });
    assert.ok(csv.startsWith('﻿'));
    const lines = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(lines[0], 'Pessoa;Apelido;Número;Dez/2025;Jan/2026;Set/2026');
    assert.ok(lines.includes('João da Silva;Jão;(11) 91234-5678;Sim;Não;'));
    assert.ok(lines.includes('"Silva; ""Bia""";Bia;;;Off;Sim'));
  });

  test('intervalo de meses', () => {
    assert.deepEqual(monthsWithRecords(records, '2026-01-01', '2026-01-01'), ['2026-01-01']);
    const csv = buildSheetCsv({ players, records, fromMes: '2026-01-01', toMes: '2026-01-01' });
    const header = csv.slice(1).split('\r\n')[0];
    assert.equal(header, 'Pessoa;Apelido;Número;Jan/2026');
    // p3 é inativo e não tem registro no intervalo: fica de fora.
    assert.ok(!csv.includes('Carlão'));
  });

  test('protege contra fórmula', () => {
    assert.equal(csvField('=SOMA(A1)'), "'=SOMA(A1)");
    assert.equal(csvField('a;b'), '"a;b"');
  });

  test('backup JSON', () => {
    const json = JSON.parse(buildBackupJson({ players, records, settings: { id: 1 }, exportedAt: 'x' }));
    assert.equal(json.players.length, 4);
    assert.equal(json.payment_records.length, 5);
    assert.deepEqual(json.settings, { id: 1 });
  });
});

describe('ida e volta: exportar e reimportar', () => {
  const statusKey = (list) => list.map((r) => `${r.player_id}|${r.mes_referencia}|${r.status}`).sort();

  test('num banco vazio recria todos os jogadores e registros', () => {
    const csv = buildSheetCsv({ players, records, numberKind: 'telefone' });
    const sheet = parseSheet(csv, { now: NOW });
    assert.equal(sheet.error, null);
    assert.equal(sheet.numberKind, 'telefone');

    const plan = buildImportPlan(sheet);
    assert.equal(plan.warnings.length, 0);
    const byApelido = new Map(plan.newPlayers.map((p) => [p.apelido, p]));
    for (const original of players) {
      const created = byApelido.get(original.apelido);
      assert.ok(created, original.apelido);
      assert.equal(created.nome, original.nome);
      assert.equal(created.telefone, original.telefone);
    }

    // Traduz ref -> id original para comparar os registros.
    const idOfRef = new Map(plan.newPlayers.map((p) => [p.ref, players.find((o) => o.apelido === p.apelido).id]));
    const reimported = plan.records.map((r) => ({ ...r, player_id: idOfRef.get(r.player.ref) }));
    assert.deepEqual(statusKey(reimported), statusKey(records));
  });

  test('com camisa na coluna Número', () => {
    const plan = buildImportPlan(parseSheet(buildSheetCsv({ players, records, numberKind: 'camisa' }), { now: NOW }));
    const camisas = Object.fromEntries(plan.newPlayers.map((p) => [p.apelido, p.numero_camisa]));
    assert.deepEqual(camisas, { Bia: 7, Jão: 10, Novato: null, '=Carlão': null });
  });

  test('no mesmo banco nada é criado de novo', () => {
    const plan = buildImportPlan(parseSheet(buildSheetCsv({ players, records }), { now: NOW }), { players, records });
    assert.equal(plan.newPlayers.length, 0);
    assert.equal(plan.matchedPlayers.length, players.length);
    assert.deepEqual(plan.totals.byAction, { create: 0, same: records.length, conflict: 0 });
  });
});
