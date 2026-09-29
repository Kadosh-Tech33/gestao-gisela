import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDelimiter,
  parseDelimited,
  parseMonthHeader,
  interpretStatus,
  detectNumberKind,
  parseSheet,
  buildImportPlan,
} from '../js/import.js';

// "Hoje" fixo nos testes: setembro de 2026.
const NOW = '2026-09-01';
const parse = (text) => parseSheet(text, { now: NOW });

describe('delimitador', () => {
  test('tabulação (colado da planilha)', () => {
    const text = 'Pessoa\tApelido\tNúmero\tSet/2026\nJoão Silva\tJão\t10\tSim\n';
    assert.equal(detectDelimiter(text), '\t');
    const sheet = parse(text);
    assert.equal(sheet.error, null);
    assert.equal(sheet.rows[0].apelido, 'Jão');
  });

  test('ponto e vírgula (CSV do Excel pt-BR)', () => {
    const text = 'Pessoa;Apelido;Número;Set/2026\r\nJoão Silva;Jão;10;Sim\r\n';
    assert.equal(detectDelimiter(text), ';');
    assert.equal(parse(text).rows[0].values[0], 'Sim');
  });

  test('vírgula', () => {
    const text = 'Pessoa,Apelido,Número,Set/2026\nJoão Silva,Jão,10,Sim\n';
    assert.equal(detectDelimiter(text), ',');
    assert.equal(parse(text).rows[0].pessoa, 'João Silva');
  });

  test('sem delimitador reconhecível vira erro', () => {
    assert.match(parse('só uma coluna\noutra').error, /colunas/);
  });
});

describe('BOM e aspas', () => {
  test('remove o BOM do começo', () => {
    const sheet = parse('﻿Pessoa;Apelido;Número;Set/2026\nAna;Aninha;;Sim\n');
    assert.equal(sheet.error, null);
    assert.equal(sheet.rows[0].pessoa, 'Ana');
  });

  test('aspas com delimitador, aspas escapadas e quebra de linha dentro', () => {
    const rows = parseDelimited('a;"b;c";"diz ""oi""";"linha1\nlinha2"\nx;y;z;w', ';');
    assert.deepEqual(rows[0].cells, ['a', 'b;c', 'diz "oi"', 'linha1\nlinha2']);
    assert.equal(rows[1].line, 3);
  });

  test('nome com vírgula entre aspas num CSV de vírgulas', () => {
    const sheet = parse('Pessoa,Apelido,Número,Set/2026\n"Silva, João",Jão,10,Sim\n');
    assert.equal(sheet.rows[0].pessoa, 'Silva, João');
    assert.equal(sheet.rows[0].values[0], 'Sim');
  });
});

describe('cabeçalhos de mês', () => {
  test('com ano', () => {
    assert.deepEqual(parseMonthHeader('Set/2026', NOW), { month: 9, year: 2026, suggestedYear: 2026 });
    assert.equal(parseMonthHeader('Setembro 2026', NOW).year, 2026);
    assert.equal(parseMonthHeader('setembro de 2025', NOW).year, 2025);
    assert.equal(parseMonthHeader('SET./26', NOW).year, 2026);
    assert.equal(parseMonthHeader('Março/2026', NOW).month, 3);
    assert.equal(parseMonthHeader('09/2026', NOW).month, 9);
    assert.equal(parseMonthHeader('01/09/2026', NOW).month, 9);
  });

  test('sem ano: ano atual, ou o anterior se o mês for depois do atual', () => {
    assert.deepEqual(parseMonthHeader('Agosto', NOW), { month: 8, year: null, suggestedYear: 2026 });
    assert.equal(parseMonthHeader('Set', NOW).suggestedYear, 2026);
    assert.equal(parseMonthHeader('Out', NOW).suggestedYear, 2025);
    assert.equal(parseMonthHeader('dezembro', NOW).suggestedYear, 2025);
  });

  test('não confunde outras colunas com mês', () => {
    assert.equal(parseMonthHeader('Total', NOW), null);
    assert.equal(parseMonthHeader('Observações', NOW), null);
  });

  test('a planilha usa o ano sugerido e o ano escolhido na revisão', () => {
    const sheet = parse('Pessoa;Apelido;Número;Ago;Out\nAna;Aninha;;Sim;Não\n');
    assert.deepEqual(
      sheet.months.map((m) => [m.month, m.year, m.hasYear]),
      [[8, 2026, false], [10, 2025, false]],
    );
    const plan = buildImportPlan(sheet, { years: { [sheet.months[1].index]: 2026 } });
    assert.deepEqual(plan.records.map((r) => r.mes_referencia), ['2026-08-01', '2026-10-01']);
  });

  test('coluna desconhecida vira aviso', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026;Total\nAna;Aninha;;Sim;80\n');
    assert.equal(sheet.warnings.length, 1);
    assert.match(sheet.warnings[0].message, /Total/);
  });

  test('cabeçalho sem Pessoa/Apelido ou sem mês vira erro', () => {
    assert.match(parse('A;B;C\n1;2;3').error, /Pessoa e Apelido/);
    assert.match(parse('Pessoa;Apelido;Número\nAna;Aninha;10').error, /mês/);
  });
});

describe('coluna Número', () => {
  test('detecta telefone', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026\nAna;Aninha;(11) 91234-5678;Sim\nBia;Bia;11 98765-4321;Não\n');
    assert.equal(sheet.numberKind, 'telefone');
    const plan = buildImportPlan(sheet);
    assert.equal(plan.newPlayers[0].telefone, '5511912345678');
    assert.equal(plan.newPlayers[0].numero_camisa, null);
  });

  test('detecta camisa', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026\nAna;Aninha;10;Sim\nBia;Bia;7;Não\nCaio;Caio;;Sim\n');
    assert.equal(sheet.numberKind, 'camisa');
    const plan = buildImportPlan(sheet);
    assert.deepEqual(plan.newPlayers.map((p) => p.numero_camisa), [10, 7, null]);
  });

  test('usuário troca a escolha na revisão', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026\nAna;Aninha;10;Sim\n');
    const plan = buildImportPlan(sheet, { numberKind: 'telefone' });
    assert.equal(plan.newPlayers[0].telefone, null);
    assert.match(plan.warnings[0].message, /Telefone "10" inválido/);
  });

  test('maioria decide', () => {
    assert.equal(detectNumberKind(['11912345678', '10', '11987654321']), 'telefone');
    assert.equal(detectNumberKind(['11912345678', '10', '7']), 'camisa');
    assert.equal(detectNumberKind(['', '']), 'camisa');
  });

  test('cabeçalho "Telefone" ou "Camisa" define o tipo', () => {
    assert.equal(parse('Pessoa;Apelido;Camisa;Set/2026\nAna;A;11912345678;Sim').numberKind, 'camisa');
    assert.equal(parse('Pessoa;Apelido;Telefone;Set/2026\nAna;A;10;Sim').numberKind, 'telefone');
  });
});

describe('valores das colunas de mês', () => {
  test('mapeamento de status', () => {
    for (const v of ['Sim', 'S', 'pago', ' SIM ']) assert.equal(interpretStatus(v), 'pago', v);
    for (const v of ['Não', 'Nao', 'N', 'Pendente']) assert.equal(interpretStatus(v), 'pendente', v);
    for (const v of ['Off', 'Isento', '-']) assert.equal(interpretStatus(v), 'isento', v);
    assert.equal(interpretStatus(''), '');
    assert.equal(interpretStatus('talvez'), null);
  });

  test('célula vazia não cria registro e valor inválido vira aviso na linha', () => {
    const sheet = parse('Pessoa;Apelido;Número;Ago/2026;Set/2026\nAna;Aninha;;;Sim\nBia;Bia;;80,00;Não\n');
    const plan = buildImportPlan(sheet);
    assert.deepEqual(
      plan.records.map((r) => [r.line, r.mes_referencia, r.status]),
      [[2, '2026-09-01', 'pago'], [3, '2026-09-01', 'pendente']],
    );
    assert.equal(plan.warnings.length, 1);
    assert.equal(plan.warnings[0].line, 3);
    assert.match(plan.warnings[0].message, /"80,00"/);
  });
});

describe('casamento e duplicados', () => {
  const players = [
    { id: 'p1', nome: 'João da Silva', apelido: 'Jão', ativo: true },
    { id: 'p2', nome: 'Pedro Álvares', apelido: 'Pedrão', ativo: false },
  ];

  test('casa por apelido e depois por nome, sem acento e sem espaços extras', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026\nJoao  da Silva; JAO ;;Sim\nPEDRO ALVARES;Pedrinho;;Não\nNovo Cara;Novato;;Off\n');
    const plan = buildImportPlan(sheet, { players });
    assert.deepEqual(plan.matchedPlayers.map((p) => [p.id, p.via]), [['p1', 'apelido'], ['p2', 'nome']]);
    assert.equal(plan.newPlayers.length, 1);
    assert.equal(plan.newPlayers[0].ativo, true);
    assert.deepEqual(plan.records.map((r) => r.player), [{ id: 'p1' }, { id: 'p2' }, { ref: 'new:0' }]);
  });

  test('apelido duplicado no arquivo: aviso e só a primeira linha vale', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026\nAna Souza;Aninha;;Sim\nAna S.;ANINHA;;Não\n');
    const plan = buildImportPlan(sheet);
    assert.equal(plan.newPlayers.length, 1);
    assert.equal(plan.newPlayers[0].nome, 'Ana Souza');
    assert.deepEqual(plan.records.map((r) => r.status), ['pago']);
    assert.equal(plan.warnings[0].line, 3);
    assert.match(plan.warnings[0].message, /linha 2/);
  });

  test('duas linhas que casam com o mesmo jogador existente', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set/2026\nJoão da Silva;Jão;;Sim\nJoão da Silva;Joãozinho;;Não\n');
    const plan = buildImportPlan(sheet, { players });
    assert.equal(plan.matchedPlayers.length, 1);
    assert.equal(plan.records.length, 1);
    assert.match(plan.warnings[0].message, /mesmo jogador/);
  });

  test('classifica registros como criar, igual ou conflito', () => {
    const records = [
      { player_id: 'p1', mes_referencia: '2026-08-01', status: 'pago' },
      { player_id: 'p1', mes_referencia: '2026-09-01', status: 'pago' },
    ];
    const sheet = parse('Pessoa;Apelido;Número;Ago/2026;Set/2026;Out/2026\nJoão;Jão;;Sim;Não;Sim\n');
    const plan = buildImportPlan(sheet, { players, records });
    assert.deepEqual(plan.records.map((r) => r.action), ['same', 'conflict', 'create']);
    assert.deepEqual(plan.totals.byAction, { create: 1, same: 1, conflict: 1 });
  });

  test('mes_referencia sempre no dia 1 e totais por mês e status', () => {
    const sheet = parse('Pessoa;Apelido;Número;Ago/2026;Set/2026\nAna;A;;Sim;Não\nBia;B;;Off;Sim\n');
    const plan = buildImportPlan(sheet);
    assert.ok(plan.records.every((r) => /^\d{4}-\d{2}-01$/.test(r.mes_referencia)));
    assert.deepEqual(plan.totals.byMonth['2026-08-01'], { pago: 1, pendente: 0, isento: 1, total: 2 });
    assert.deepEqual(plan.totals.byStatus, { pago: 2, pendente: 1, isento: 1, total: 4 });
  });

  test('coluna de mês repetida após escolher o ano vira aviso', () => {
    const sheet = parse('Pessoa;Apelido;Número;Set;Set/2026\nAna;A;;Sim;Não\n');
    const plan = buildImportPlan(sheet);
    assert.equal(plan.records.length, 1);
    assert.equal(plan.records[0].status, 'pago');
    assert.match(plan.warnings[0].message, /repete/);
  });

  test('linha sem apelido usa o primeiro nome', () => {
    const plan = buildImportPlan(parse('Pessoa;Apelido;Número;Set/2026\nCarlos Souza;;;Sim\n'));
    assert.equal(plan.newPlayers[0].apelido, 'Carlos');
    assert.match(plan.warnings[0].message, /Sem apelido/);
  });
});
