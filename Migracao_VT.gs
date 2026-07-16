// =============================================================================
// MIGRACAO DE PLANILHAS ANTIGAS DE VT - script INDEPENDENTE do webapp.
//
// Cole este arquivo INTEIRO num projeto de Apps Script (de preferencia um
// projeto novo e vazio em script.google.com). Todos os nomes internos usam o
// prefixo "vtmig"/"VTMIG_" para nao colidir com nenhum outro script.
//
// Funciona em 3 etapas, para nunca arriscar sujar a planilha oficial:
//
//   1) migrarBF()  (ou migrarPlanilhaAntigaVT(oldSheetId, unidade, ano))
//        Le a planilha antiga (uma aba por mes, com secoes "ADMINISTRATIVO" e
//        "PROFESSORES" dentro da mesma aba) e CRIA UMA PLANILHA NOVA de
//        staging, sem tocar na planilha oficial do VT.
//
//   2) Revisao manual: voce abre a planilha de staging gerada e confere a
//      coluna "Alerta" (CPF suspeito, Total recalculado diferente do
//      original, lancamentos duplicados no mesmo mes). Ajusta ou apaga o que
//      nao deve subir.
//
//   3) aplicarStagingVT(stagingSheetId)
//        So entao grava na planilha oficial do VT, pulando qualquer linha
//        cuja chave (unidade+mes+ano+matricula) ja exista la, para nunca
//        sobrescrever um lancamento que o diretor ja tenha feito pelo app.
//
// Para cada unidade nova, copie a funcao migrarBF la embaixo, troque o nome
// (ex.: migrarBG - SEM underscore no final, senao ela some do menu Executar)
// e os 3 argumentos - nao precisa duplicar o resto.
// =============================================================================

// Mesmo ID da planilha central "NEW VT" usada pelo webapp (Code.gs).
var VTMIG_SHEET_ID = '1zDOd3nUIojbDVPgglDfZ5wsEOldwCcOGjLeh_YkU4yU';

// Cabecalhos das abas ADMINISTRATIVO/DOCENTE da planilha oficial do VT -
// copia exata de VT_HEADERS no Code.gs do webapp (precisa ficar sincronizado
// se o webapp mudar essas colunas no futuro).
var VTMIG_HEADERS = {
  ADMINISTRATIVO: ['Unidade','Mês','Ano','Matrícula','CPF','Administrativo','Tipo Ida','Valor Ida','Qtd Ida','Tipo Volta','Valor Volta','Qtd Volta','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Tipo Ida 2','Valor Ida 2','Tipo Volta 2','Valor Volta 2','Tipo Ida 3','Valor Ida 3','Tipo Volta 3','Valor Volta 3','Editado Em','Editado Por','Comentário','Comentado Em','Comentado Por'],
  DOCENTE:        ['Unidade','Mês','Ano','Matrícula','CPF','Docente','Tipo Ida','Valor Ida','Qtd Ida','Tipo Volta','Valor Volta','Qtd Volta','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Tipo Ida 2','Valor Ida 2','Tipo Volta 2','Valor Volta 2','Tipo Ida 3','Valor Ida 3','Tipo Volta 3','Valor Volta 3','Editado Em','Editado Por','Comentário','Comentado Em','Comentado Por']
};

var VTMIG_TIPOS_JAE     = ['onibus municipal', 'metro'];
var VTMIG_TIPOS_RIOCARD = ['onibus intermunicipal', 'barca', 'trem'];
var VTMIG_SEM_RATEIO    = ['VO'];
var VTMIG_ALIASES       = { ns: 'CH', mri: 'MR' };

var VTMIG_MESES_LABEL = ['01 Janeiro', '02 Fevereiro', '03 Março', '04 Abril', '05 Maio', '06 Junho',
                         '07 Julho', '08 Agosto', '09 Setembro', '10 Outubro', '11 Novembro', '12 Dezembro'];

var VTMIG_MESES_NOMES = {
  'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6,
  'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
};

// Normaliza texto para comparacao: minusculo, sem acento, sem espacos nas bordas
function vtmigNorm_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function vtmigCanonUnidade_(u) {
  u = String(u || '').trim();
  if (!u) return u;
  var alias = VTMIG_ALIASES[vtmigNorm_(u)];
  return alias || u;
}

function vtmigIsSemRateio_(unidade) {
  return VTMIG_SEM_RATEIO.some(function(u) { return vtmigNorm_(u) === vtmigNorm_(unidade); });
}

function vtmigParseMes_(v) {
  return parseInt(String(v).trim(), 10) || 0;
}

function vtmigMesLabel_(m) {
  var n = vtmigParseMes_(m);
  return VTMIG_MESES_LABEL[n - 1] || String(m);
}

function vtmigMesPorNomeAba_(nomeAba) {
  return VTMIG_MESES_NOMES[vtmigNorm_(nomeAba)] || 0;
}

function vtmigClassificarCartao_(tipo) {
  var t = vtmigNorm_(tipo);
  if (VTMIG_TIPOS_JAE.indexOf(t) !== -1) return 'jae';
  if (VTMIG_TIPOS_RIOCARD.indexOf(t) !== -1) return 'riocard';
  return null;
}

// Copia exata da regra de calculo do webapp (Code.gs calcularVT_) - Total,
// Dias Trabalhados, Valor Diario e o rateio Jae/RioCard nunca sao confiados
// ao que ja vinha pronto na planilha antiga, sempre recalculados aqui.
function vtmigCalcularVT_(e) {
  var qtdIda   = Number(e.qtdIda)   || 0;
  var qtdVolta = Number(e.qtdVolta) || 0;

  var legs = [
    { tipo: e.tipoIda,    total: (Number(e.valorIda)    || 0) * qtdIda },
    { tipo: e.tipoIda2,   total: (Number(e.valorIda2)   || 0) * qtdIda },
    { tipo: e.tipoIda3,   total: (Number(e.valorIda3)   || 0) * qtdIda },
    { tipo: e.tipoVolta,  total: (Number(e.valorVolta)  || 0) * qtdVolta },
    { tipo: e.tipoVolta2, total: (Number(e.valorVolta2) || 0) * qtdVolta },
    { tipo: e.tipoVolta3, total: (Number(e.valorVolta3) || 0) * qtdVolta }
  ];

  var semRateio = vtmigIsSemRateio_(e.unidade);

  var total = 0, valorJae = 0, valorRiocard = 0;
  legs.forEach(function(l) {
    total += l.total;
    if (semRateio) return;
    var cartao = vtmigClassificarCartao_(l.tipo);
    if (cartao === 'jae')     valorJae     += l.total;
    if (cartao === 'riocard') valorRiocard += l.total;
  });

  var dias        = Math.max(qtdIda, qtdVolta);
  var valorDiario = dias > 0 ? total / dias : 0;

  return { total: total, diasTrabalhados: dias, valorDiario: valorDiario, valorJae: valorJae, valorRiocard: valorRiocard };
}

function vtmigGetOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(VTMIG_HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Copia da logica de upsert do webapp (Code.gs _upsertRows_) - atualiza a
// linha existente (unidade+mes+ano+matricula) ou cria uma nova, para cada item.
function vtmigUpsertRows_(sheet, entries, valuesFn) {
  if (!entries || !entries.length) return;

  var allRows = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < allRows.length; i++) {
    var r = allRows[i];
    map[vtmigNorm_(vtmigCanonUnidade_(r[0])) + '|' + vtmigParseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim()] = i + 1;
  }

  entries.forEach(function(e) {
    var mat    = String(e.matricula).trim();
    var key    = vtmigNorm_(e.unidade) + '|' + Number(e.mes) + '|' + Number(e.ano) + '|' + mat;
    var values = valuesFn(e);
    if (map[key]) {
      var rowIdx = map[key];
      sheet.getRange(rowIdx, 7, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow([e.unidade, vtmigMesLabel_(e.mes), e.ano, mat, e.cpf || '', e.nome].concat(values));
      map[key] = sheet.getLastRow();
    }
  });
}

// Mapa {header normalizado -> [indices 0-based, na ordem em que aparecem]}.
// Necessario porque "Tipo"/"Valor"/"Quantidade" se repetem 2 ou 3 vezes por
// linha, e a ORDEM de CPF/Matricula muda entre os formatos Jan-Abr e Mai-Ago
// das planilhas antigas - mapear por indice fixo quebraria silenciosamente.
function vtmigMapearColunas_(headerRow) {
  var map = {};
  headerRow.forEach(function(h, idx) {
    var key = vtmigNorm_(h);
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(idx);
  });
  return map;
}

function vtmigCelula_(row, map, header, ocorrencia) {
  var idxs = map[vtmigNorm_(header)];
  if (!idxs || idxs.length <= (ocorrencia || 0)) return '';
  return row[idxs[ocorrencia || 0]];
}

// So aceita como CPF de verdade uma sequencia de 11 digitos (depois de tirar
// pontuacao). Cobre valores encontrados nas planilhas antigas que nao sao CPF
// (ex.: "NAO ENCONTRADO", "CADASTRAR ENDOMKT").
function vtmigSanitizarCpf_(v) {
  var digits = String(v || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : '';
}

// =============================================================================
// ETAPA 1 - le a planilha antiga e cria a planilha de staging para revisao.
// =============================================================================
function migrarPlanilhaAntigaVT(oldSheetId, unidade, ano) {
  unidade = vtmigCanonUnidade_(unidade);
  var oldSs = SpreadsheetApp.openById(oldSheetId);

  var stageRows = { ADMINISTRATIVO: [], DOCENTE: [] };
  var vistos = {}; // chave unidade|mes|ano|matricula -> linhas de staging ja geradas

  var totalLidas = 0, totalIgnoradas = 0, totalDuplicadas = 0;

  oldSs.getSheets().forEach(function(sheet) {
    var mes = vtmigMesPorNomeAba_(sheet.getName());
    if (!mes) return; // aba que nao e mes (ex.: instrucoes) - pula

    var rows = sheet.getDataRange().getValues();
    if (rows.length < 2) return;

    var map = vtmigMapearColunas_(rows[0]);
    var categoriaAtual = null; // 'ADMINISTRATIVO' | 'DOCENTE'

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var col0 = String(row[0] || '').trim();
      var col0Norm = vtmigNorm_(col0);

      if (col0Norm === 'administrativo') { categoriaAtual = 'ADMINISTRATIVO'; continue; }
      if (col0Norm === 'professores')    { categoriaAtual = 'DOCENTE'; continue; }

      var nome = col0;
      if (!nome || !categoriaAtual) continue; // linha em branco ou antes do 1o banner

      totalLidas++;

      var matricula = String(vtmigCelula_(row, map, 'matricula')).trim();
      if (!matricula) { totalIgnoradas++; continue; }

      var cpfOriginal = vtmigCelula_(row, map, 'cpf');
      var cpf = vtmigSanitizarCpf_(cpfOriginal);
      var cpfAlerta = cpfOriginal && !cpf ? ('CPF suspeito: "' + cpfOriginal + '"') : '';

      var tipoIda    = String(vtmigCelula_(row, map, 'tipo', 0) || '').trim();
      var valorIda   = Number(vtmigCelula_(row, map, 'valor', 0)) || 0;
      var qtdIda     = Number(vtmigCelula_(row, map, 'quantidade', 0)) || 0;
      var tipoVolta  = String(vtmigCelula_(row, map, 'tipo', 1) || '').trim();
      var valorVolta = Number(vtmigCelula_(row, map, 'valor', 1)) || 0;
      var qtdVolta   = Number(vtmigCelula_(row, map, 'quantidade', 1)) || 0;

      // 3a coluna Tipo/Valor/Quantidade (so existia em Jan-Abr) = sempre
      // Ida 2, usa a mesma Qtd Ida do 1o trecho (regra confirmada com a Adriane).
      var tipoIda2  = String(vtmigCelula_(row, map, 'tipo', 2) || '').trim();
      var valorIda2 = Number(vtmigCelula_(row, map, 'valor', 2)) || 0;

      var comentario = String(vtmigCelula_(row, map, 'obs:') || '').trim();

      var calc = vtmigCalcularVT_({
        unidade: unidade, tipoIda: tipoIda, valorIda: valorIda, qtdIda: qtdIda,
        tipoVolta: tipoVolta, valorVolta: valorVolta, qtdVolta: qtdVolta,
        tipoIda2: tipoIda2, valorIda2: valorIda2
      });
      var totalOriginal = Number(vtmigCelula_(row, map, 'total')) || 0;
      var diferenca = Math.round((calc.total - totalOriginal) * 100) / 100;

      var chave = vtmigNorm_(unidade) + '|' + mes + '|' + ano + '|' + matricula;
      var alertas = [];
      if (cpfAlerta) alertas.push(cpfAlerta);
      if (Math.abs(diferenca) > 0.01) alertas.push('Total recalculado diferente do original (dif ' + diferenca.toFixed(2) + ')');
      if (vistos[chave]) {
        alertas.push('Duplicado no mes - revisar');
        vistos[chave].forEach(function(linhaAnterior) {
          linhaAnterior.alerta += (linhaAnterior.alerta ? '; ' : '') + 'Duplicado no mes - revisar';
        });
        totalDuplicadas++;
      }

      var linha = {
        unidade: unidade, mes: vtmigMesLabel_(mes), ano: ano,
        matricula: matricula, cpf: cpf, nome: nome,
        tipoIda: tipoIda, valorIda: valorIda, qtdIda: qtdIda,
        tipoVolta: tipoVolta, valorVolta: valorVolta, qtdVolta: qtdVolta,
        total: calc.total, dias: calc.diasTrabalhados, valorDiario: calc.valorDiario,
        valorJae: calc.valorJae, valorRiocard: calc.valorRiocard,
        tipoIda2: tipoIda2, valorIda2: valorIda2,
        comentario: comentario,
        totalOriginal: totalOriginal, diferenca: diferenca,
        alerta: alertas.join('; ')
      };

      stageRows[categoriaAtual].push(linha);
      vistos[chave] = (vistos[chave] || []).concat([linha]);
    }
  });

  var carimbo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
  var stageSs = SpreadsheetApp.create('VT Migracao - ' + unidade + ' - ' + carimbo);

  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(categoria, idx) {
    var sheet = idx === 0 ? stageSs.getSheets()[0].setName(categoria) : stageSs.insertSheet(categoria);
    // Unidade..Valor Total RioCard (17 colunas) + colunas de conferencia
    var headers = VTMIG_HEADERS[categoria].slice(0, 17)
      .concat(['Tipo Ida 2', 'Valor Ida 2', 'Comentário', 'Total Original', 'Diferença', 'Alerta']);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);

    var values = stageRows[categoria].map(function(l) {
      return [l.unidade, l.mes, l.ano, l.matricula, l.cpf, l.nome,
        l.tipoIda, l.valorIda, l.qtdIda, l.tipoVolta, l.valorVolta, l.qtdVolta,
        l.total, l.dias, l.valorDiario, l.valorJae, l.valorRiocard,
        l.tipoIda2, l.valorIda2, l.comentario, l.totalOriginal, l.diferenca, l.alerta];
    });
    if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    sheet.autoResizeColumns(1, headers.length);
  });

  try { stageSs.addEditor(Session.getActiveUser().getEmail()); } catch (e) { Logger.log('migrarPlanilhaAntigaVT addEditor: ' + e); }

  Logger.log('Staging criada: %s', stageSs.getUrl());
  Logger.log('Linhas lidas: %s | ignoradas (sem matricula): %s | duplicadas sinalizadas: %s',
    totalLidas, totalIgnoradas, totalDuplicadas);

  return stageSs.getUrl();
}

// =============================================================================
// ETAPA 3 - so rode depois de revisar a planilha de staging gerada na Etapa 1.
// Le a staging JA REVISADA e grava na planilha oficial do VT, pulando linhas
// cuja chave (unidade+mes+ano+matricula) ja exista la - protecao principal
// contra colidir com o periodo "Previsto" que ja pode estar sendo preenchido
// pelo app novo.
// =============================================================================
function aplicarStagingVT(stagingSheetId) {
  var stageSs = SpreadsheetApp.openById(stagingSheetId);
  var liveSs  = SpreadsheetApp.openById(VTMIG_SHEET_ID);

  var totalImportadas = 0;
  var pulados = [];

  var valuesFn = function(e) {
    var calc = vtmigCalcularVT_(e);
    return [
      e.tipoIda || '', Number(e.valorIda) || 0, Number(e.qtdIda) || 0,
      e.tipoVolta || '', Number(e.valorVolta) || 0, Number(e.qtdVolta) || 0,
      calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard,
      e.tipoIda2 || '', Number(e.valorIda2) || 0,
      '', 0, // Tipo Volta 2, Valor Volta 2 (nao usados na migracao)
      '', 0, // Tipo Ida 3, Valor Ida 3
      '', 0  // Tipo Volta 3, Valor Volta 3
    ];
  };

  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(categoria) {
    var stageSheet = stageSs.getSheetByName(categoria);
    if (!stageSheet) return;
    var rows = stageSheet.getDataRange().getValues();
    if (rows.length < 2) return;

    var liveSheet = vtmigGetOrCreateSheet_(liveSs, categoria);
    var liveKeys  = {};
    liveSheet.getDataRange().getValues().slice(1).forEach(function(r) {
      liveKeys[vtmigNorm_(vtmigCanonUnidade_(r[0])) + '|' + vtmigParseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim()] = true;
    });

    var entries = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var unidade = vtmigCanonUnidade_(String(r[0]).trim());
      var mes = vtmigParseMes_(r[1]);
      var ano = Number(r[2]);
      var matricula = String(r[3]).trim();
      if (!unidade || !mes || !ano || !matricula) continue;

      var chave = vtmigNorm_(unidade) + '|' + mes + '|' + ano + '|' + matricula;
      if (liveKeys[chave]) {
        pulados.push(unidade + '/' + mes + '/' + ano + '/' + matricula + ' (ja existe no VT ao vivo)');
        continue;
      }

      entries.push({
        unidade: unidade, mes: mes, ano: ano,
        matricula: matricula, cpf: String(r[4] || '').trim(), nome: String(r[5] || '').trim(),
        tipoIda: r[6], valorIda: r[7], qtdIda: r[8],
        tipoVolta: r[9], valorVolta: r[10], qtdVolta: r[11],
        tipoIda2: r[17] || '', valorIda2: r[18] || 0,
        comentarioMigrado: String(r[19] || '').trim()
      });
    }

    vtmigUpsertRows_(liveSheet, entries, valuesFn);

    // Comentarios (campo OBS original) - nao fazem parte do upsert acima,
    // entao gravamos a parte nas 3 colunas de comentario da planilha oficial.
    var comCol1 = VTMIG_HEADERS[categoria].indexOf('Comentário') + 1;
    var liveRowsPosImport = liveSheet.getDataRange().getValues();
    entries.forEach(function(e) {
      if (!e.comentarioMigrado) return;
      for (var i2 = 1; i2 < liveRowsPosImport.length; i2++) {
        var r2 = liveRowsPosImport[i2];
        var k = vtmigNorm_(vtmigCanonUnidade_(r2[0])) + '|' + vtmigParseMes_(r2[1]) + '|' + Number(r2[2]) + '|' + String(r2[3]).trim();
        if (k === vtmigNorm_(e.unidade) + '|' + e.mes + '|' + e.ano + '|' + e.matricula) {
          liveSheet.getRange(i2 + 1, comCol1, 1, 3).setValues([[e.comentarioMigrado, new Date(), 'Migracao']]);
          break;
        }
      }
    });

    totalImportadas += entries.length;
  });

  Logger.log('Importadas: %s | Puladas (ja existiam no VT ao vivo): %s', totalImportadas, pulados.length);
  if (pulados.length) Logger.log('Detalhe dos pulados:\n%s', pulados.join('\n'));

  return { importadas: totalImportadas, puladas: pulados };
}

// Wrapper SEM parametro - o unico jeito de rodar pelo menu "Executar" do
// editor, que nao permite passar argumento nenhum. Roda a migracao piloto da
// BF. Para outra unidade, copie esta funcao, troque o nome (ex.: migrarBG,
// SEM underscore no final, senao ela some do menu Executar) e os 3 argumentos.
function migrarBF() {
  var url = migrarPlanilhaAntigaVT('1lWjnV-EsBagXemXByvSkchqOO4UkbjSMcRVfdJMnYvg', 'BF', 2026);
  Logger.log('Planilha de staging da BF: %s', url);
}
