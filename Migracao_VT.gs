// =============================================================================
// MIGRACAO DE PLANILHAS ANTIGAS DE VT - script INDEPENDENTE do webapp.
//
// Cole este arquivo INTEIRO num projeto de Apps Script (de preferencia um
// projeto novo e vazio em script.google.com). Todos os nomes internos usam o
// prefixo "vtmig"/"VTMIG_" para nao colidir com nenhum outro script.
//
// Funciona em 3 etapas, para nunca arriscar sujar a planilha oficial:
//
//   1) gerarStaging()
//        Acha sozinho, na pasta do Drive com as planilhas antigas, a planilha
//        "<UNIDADE> - VT - <ano>" da unidade configurada no bloco CONFIG
//        abaixo, le ela (uma aba por mes, com secoes "ADMINISTRATIVO" e
//        "PROFESSORES" dentro da mesma aba) e CRIA UMA PLANILHA NOVA de
//        staging, sem tocar na planilha oficial do VT. O ID da staging fica
//        guardado automaticamente.
//
//   2) Revisao manual: voce abre a planilha de staging gerada e confere a
//      coluna "Alerta" (CPF suspeito, Total recalculado diferente do
//      original, mesclagens de nome repetido no mes). Nome repetido no mesmo
//      mes NAO vira linha duplicada: os trechos entram como Ida/Volta 2 e 3
//      da linha ja existente; so vira linha extra se nao couber. Ajusta ou
//      apaga o que nao deve subir.
//
//   3) aplicarStaging()
//        Pega automaticamente a staging gerada na etapa 1 para a unidade/ano
//        do CONFIG e grava na planilha oficial do VT, pulando qualquer linha
//        cuja chave (unidade+mes+ano+matricula) ja exista la, para nunca
//        sobrescrever um lancamento que o diretor ja tenha feito pelo app.
//
// Para cada unidade nova: so trocar VTMIG_UNIDADE no CONFIG e repetir as 3
// etapas. Nao precisa copiar funcao nem colar ID de planilha em lugar nenhum.
// listarPlanilhasDaPasta() mostra no log todas as unidades encontradas na
// pasta, util para conferir a cobertura antes de comecar.
// =============================================================================

// Mesmo ID da planilha central "NEW VT" usada pelo webapp (Code.gs).
var VTMIG_SHEET_ID = '1zDOd3nUIojbDVPgglDfZ5wsEOldwCcOGjLeh_YkU4yU';

// =============================================================================
// CONFIG - unico lugar que voce edita a cada unidade migrada. Troque
// VTMIG_UNIDADE, rode gerarStaging(), revise a planilha gerada e rode
// aplicarStaging(). A planilha antiga e achada sozinha na pasta pelo padrao
// de nome "<UNIDADE> - VT - <ano>".
//
// Para migrar VARIAS unidades de uma vez NA MESMA planilha de staging, use
// gerarStagingVarias() / aplicarStagingVarias() em vez de
// gerarStaging()/aplicarStaging(): eles preenchem VTMIG_UNIDADES abaixo
// (deixe [] para pegar TODAS as unidades achadas na pasta do Drive), leem
// cada planilha antiga e juntam tudo numa UNICA planilha de staging (uma aba
// ADMINISTRATIVO e uma DOCENTE, com todas as unidades misturadas - a coluna
// Unidade de cada linha distingue). Revisa-se so essa planilha, e
// aplicarStagingVarias() aplica tudo de uma vez na planilha oficial.
// VTMIG_UNIDADE (singular) continua servindo so para gerarStaging()/
// aplicarStaging() de uma unidade so, numa planilha de staging separada.
// =============================================================================
var VTMIG_PASTA_ID = '1nn4sbeaDl98uatuhpppYNTkLPQ0A4X8s'; // pasta do Drive com as planilhas antigas de VT
var VTMIG_UNIDADE  = 'BF';
var VTMIG_UNIDADES = []; // ex.: ['BF', 'BG', 'CH'] - [] = todas as unidades achadas na pasta

function gerarStaging() {
  var antiga = vtmigAcharPlanilhaAntiga_(VTMIG_UNIDADE);
  Logger.log('Planilha antiga encontrada: "%s"', antiga.nome);
  var url = migrarPlanilhaAntigaVT(antiga.id, VTMIG_UNIDADE, antiga.ano);
  Logger.log('Staging de %s/%s pronta para revisao: %s', VTMIG_UNIDADE, antiga.ano, url);
  Logger.log('Depois de revisar, rode aplicarStaging() - o ID ja ficou guardado.');
}

function aplicarStaging() {
  var unidade = vtmigCanonUnidade_(VTMIG_UNIDADE);
  var antiga  = vtmigAcharPlanilhaAntiga_(unidade);
  var id = PropertiesService.getScriptProperties().getProperty(vtmigStagingProp_(unidade, antiga.ano));
  if (!id) throw new Error('Nenhuma staging registrada para ' + unidade + '/' + antiga.ano + ' - rode gerarStaging() primeiro (ou, para uma staging avulsa, chame aplicarStagingVT(id) direto no codigo).');
  aplicarStagingVT(id);
}

// Lista de unidades a percorrer em gerarStagingVarias()/aplicarStagingVarias():
// VTMIG_UNIDADES se preenchida, senao todas as unidades unicas achadas na pasta.
function vtmigListaUnidadesLote_() {
  if (VTMIG_UNIDADES && VTMIG_UNIDADES.length) return VTMIG_UNIDADES;
  var vistos = {}, out = [];
  vtmigPlanilhasDaPasta_().forEach(function(p) {
    if (!vistos[p.unidade]) { vistos[p.unidade] = true; out.push(p.unidade); }
  });
  return out;
}

// Nome da Script Property que guarda o ID da ultima staging EM LOTE gerada -
// e a ponte entre gerarStagingVarias() e aplicarStagingVarias().
var VTMIG_STAGING_LOTE_PROP = 'vtmig_staging_lote';

// Le cada unidade de vtmigListaUnidadesLote_() (mesma leitura/recalculo de
// migrarPlanilhaAntigaVT) e junta tudo numa UNICA planilha de staging - uma
// aba ADMINISTRATIVO e uma DOCENTE com todas as unidades misturadas (a
// coluna Unidade de cada linha distingue quem e quem). Uma unidade com erro
// (planilha nao encontrada, aba vazia etc.) NAO interrompe as demais - fica
// no resumo de falhas no final do log, e as outras entram normalmente na
// staging. Revise essa UNICA planilha e so depois rode aplicarStagingVarias().
function gerarStagingVarias() {
  var unidades = vtmigListaUnidadesLote_();
  Logger.log('Gerando staging em lote para %s unidade(s): %s', unidades.length, unidades.join(', '));

  var funcIdx = vtmigIndiceFuncionarios_(); // le a planilha de funcionarios uma vez so, para todas as unidades
  var combinado = { ADMINISTRATIVO: [], DOCENTE: [] };
  var ok = [], falhas = [];

  unidades.forEach(function(u) {
    try {
      var antiga = vtmigAcharPlanilhaAntiga_(u);
      var lido = vtmigLerPlanilhaAntiga_(antiga.id, u, antiga.ano, funcIdx);
      combinado.ADMINISTRATIVO = combinado.ADMINISTRATIVO.concat(lido.stageRows.ADMINISTRATIVO);
      combinado.DOCENTE        = combinado.DOCENTE.concat(lido.stageRows.DOCENTE);
      Logger.log('OK - %s/%s ("%s"):\n%s', u, antiga.ano, antiga.nome, lido.resumoAbas.join('\n'));
      ok.push(u);
    } catch (e) {
      Logger.log('FALHOU - %s: %s', u, e.message);
      falhas.push(u + ': ' + e.message);
    }
  });

  if (!ok.length) throw new Error('Nenhuma unidade migrada com sucesso - staging NAO criada. Veja os erros no log.');

  var carimbo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
  var staging = vtmigCriarStagingSs_('VT Migracao LOTE - ' + carimbo, combinado);
  PropertiesService.getScriptProperties().setProperty(VTMIG_STAGING_LOTE_PROP, staging.id);

  Logger.log('--- Resumo gerarStagingVarias ---');
  Logger.log('OK (%s): %s', ok.length, ok.join(', '));
  Logger.log('Falhas (%s):%s', falhas.length, falhas.length ? '\n' + falhas.join('\n') : ' -');
  Logger.log('Staging em lote pronta para revisao: %s', staging.url);
  Logger.log('Depois de revisar, rode aplicarStagingVarias() - o ID ja ficou guardado.');
}

// Aplica a staging EM LOTE (gerarStagingVarias()) inteira de uma vez na
// planilha oficial - aplicarStagingVT ja le a Unidade de cada linha, entao
// nao importa quantas unidades diferentes estao misturadas na mesma staging.
function aplicarStagingVarias() {
  var id = PropertiesService.getScriptProperties().getProperty(VTMIG_STAGING_LOTE_PROP);
  if (!id) throw new Error('Nenhuma staging em lote registrada - rode gerarStagingVarias() primeiro.');
  aplicarStagingVT(id);
}

// Loga todas as planilhas "<UNIDADE> - VT - <ano>" achadas na pasta - rode
// antes de comecar, para conferir se todas as unidades estao cobertas.
function listarPlanilhasDaPasta() {
  var planilhas = vtmigPlanilhasDaPasta_();
  planilhas.sort(function(a, b) { return a.unidade.localeCompare(b.unidade); });
  planilhas.forEach(function(p) {
    Logger.log('%s (%s) -> %s', p.unidade, p.ano, p.nome);
  });
  Logger.log('Total: %s planilhas', planilhas.length);
}

// Le a pasta do Drive e devolve [{unidade (ja canonizada), ano, id, nome}]
// de toda planilha cujo nome siga o padrao "<UNIDADE> - VT - <ano>".
function vtmigPlanilhasDaPasta_() {
  if (!VTMIG_PASTA_ID) throw new Error('Preencha VTMIG_PASTA_ID no bloco CONFIG com o ID da pasta das planilhas antigas.');
  var files = DriveApp.getFolderById(VTMIG_PASTA_ID).getFilesByType(MimeType.GOOGLE_SHEETS);
  var out = [];
  while (files.hasNext()) {
    var f = files.next();
    var m = String(f.getName()).match(/^(.+?)\s*-\s*VT\s*-\s*(\d{4})\s*$/i);
    if (!m) continue;
    out.push({ unidade: vtmigCanonUnidade_(m[1].trim()), ano: parseInt(m[2], 10), id: f.getId(), nome: f.getName() });
  }
  return out;
}

function vtmigAcharPlanilhaAntiga_(unidade) {
  var alvo = vtmigNorm_(vtmigCanonUnidade_(unidade));
  var achadas = vtmigPlanilhasDaPasta_().filter(function(p) { return vtmigNorm_(p.unidade) === alvo; });
  if (!achadas.length) {
    throw new Error('Nenhuma planilha "' + unidade + ' - VT - <ano>" encontrada na pasta - confira VTMIG_UNIDADE e o nome do arquivo no Drive (rode listarPlanilhasDaPasta para ver o que foi achado).');
  }
  // Se um dia houver mais de um ano da mesma unidade na pasta, usa o mais
  // recente e avisa no log.
  achadas.sort(function(a, b) { return b.ano - a.ano; });
  if (achadas.length > 1) Logger.log('Atencao: %s planilhas de %s na pasta - usando a de %s.', achadas.length, unidade, achadas[0].ano);
  return achadas[0];
}

// Nome da Script Property que guarda o ID da ultima staging gerada por
// unidade+ano - e a ponte entre gerarStaging() e aplicarStaging().
function vtmigStagingProp_(unidade, ano) {
  return 'vtmig_staging_' + vtmigNorm_(unidade) + '_' + ano;
}

// Cabecalhos das abas ADMINISTRATIVO/DOCENTE da planilha oficial do VT -
// copia exata de VT_HEADERS no Code.gs do webapp (precisa ficar sincronizado
// se o webapp mudar essas colunas no futuro).
var VTMIG_HEADERS = {
  ADMINISTRATIVO: ['Unidade','Mês','Ano','Matrícula','CPF','Administrativo','Tipo Ida','Valor Ida','Qtd Ida','Tipo Ida 2','Valor Ida 2','Qtd Ida 2','Tipo Ida 3','Valor Ida 3','Qtd Ida 3','Tipo Volta','Valor Volta','Qtd Volta','Tipo Volta 2','Valor Volta 2','Qtd Volta 2','Tipo Volta 3','Valor Volta 3','Qtd Volta 3','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Editado Em','Editado Por','Comentário','Comentado Em','Comentado Por'],
  DOCENTE:        ['Unidade','Mês','Ano','Matrícula','CPF','Docente','Tipo Ida','Valor Ida','Qtd Ida','Tipo Ida 2','Valor Ida 2','Qtd Ida 2','Tipo Ida 3','Valor Ida 3','Qtd Ida 3','Tipo Volta','Valor Volta','Qtd Volta','Tipo Volta 2','Valor Volta 2','Qtd Volta 2','Tipo Volta 3','Valor Volta 3','Qtd Volta 3','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Editado Em','Editado Por','Comentário','Comentado Em','Comentado Por']
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

// Normaliza texto para comparacao: minusculo, sem acento, sem espacos nas
// bordas e com espacos internos repetidos reduzidos a um (nomes de pessoa nas
// planilhas antigas as vezes tem espaco duplo).
function vtmigNorm_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
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
  var n = vtmigNorm_(nomeAba);
  if (VTMIG_MESES_NOMES[n]) return VTMIG_MESES_NOMES[n];
  // Tolera variacoes tipo "Janeiro 2026", "JANEIRO/26", " Marco ".
  for (var nome in VTMIG_MESES_NOMES) {
    if (n.indexOf(nome) !== -1) return VTMIG_MESES_NOMES[nome];
  }
  return 0;
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

  // Cada trecho tem a SUA Qtd; trecho extra sem Qtd preenchida herda a do 1o
  // trecho do sentido (mesma regra do webapp).
  function qtdTrecho(tipo, valor, qtdPropria, qtdBase) {
    if (!tipo && !(Number(valor) || 0)) return 0;
    return Number(qtdPropria) || qtdBase;
  }

  var legs = [
    { tipo: e.tipoIda,    valor: e.valorIda,    qtd: qtdIda },
    { tipo: e.tipoIda2,   valor: e.valorIda2,   qtd: qtdTrecho(e.tipoIda2,   e.valorIda2,   e.qtdIda2,   qtdIda) },
    { tipo: e.tipoIda3,   valor: e.valorIda3,   qtd: qtdTrecho(e.tipoIda3,   e.valorIda3,   e.qtdIda3,   qtdIda) },
    { tipo: e.tipoVolta,  valor: e.valorVolta,  qtd: qtdVolta },
    { tipo: e.tipoVolta2, valor: e.valorVolta2, qtd: qtdTrecho(e.tipoVolta2, e.valorVolta2, e.qtdVolta2, qtdVolta) },
    { tipo: e.tipoVolta3, valor: e.valorVolta3, qtd: qtdTrecho(e.tipoVolta3, e.valorVolta3, e.qtdVolta3, qtdVolta) }
  ].map(function(l) {
    return { tipo: l.tipo, qtd: l.qtd, total: (Number(l.valor) || 0) * l.qtd };
  });

  var semRateio = vtmigIsSemRateio_(e.unidade);

  var total = 0, valorJae = 0, valorRiocard = 0, dias = 0;
  legs.forEach(function(l) {
    total += l.total;
    if (l.qtd > dias) dias = l.qtd;
    if (semRateio) return;
    var cartao = vtmigClassificarCartao_(l.tipo);
    if (cartao === 'jae')     valorJae     += l.total;
    if (cartao === 'riocard') valorRiocard += l.total;
  });

  var valorDiario = dias > 0 ? total / dias : 0;

  return { total: total, diasTrabalhados: dias, valorDiario: valorDiario, valorJae: valorJae, valorRiocard: valorRiocard };
}

function vtmigGetOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(VTMIG_HEADERS[name]);
    sheet.setFrozenRows(1);
    // Forca texto puro na coluna Mes (B) - sem isso o Sheets reconhece "01
    // Janeiro" como data de verdade e reformata o mes em minusculo.
    sheet.getRange('B:B').setNumberFormat('@');
  } else if (sheet.getLastRow() > 0 && String(sheet.getRange(1, 10).getValue()).trim() !== VTMIG_HEADERS[name][9]) {
    // Layout antigo (Tipo Ida 2 na coluna R; no novo a J e Tipo Ida 2)
    throw new Error('A aba "' + name + '" da planilha oficial esta no layout antigo de colunas - rode reorganizarColunasVT() no projeto do webapp (Code.gs) antes de aplicar a staging.');
  }
  return sheet;
}

// Copia da logica de upsert do webapp (Code.gs _upsertRows_) - atualiza a
// linha existente (unidade+mes+ano+matricula) ou cria uma nova, para cada
// item. Diferenca da migracao: se a MESMA chave aparecer mais de uma vez no
// lote (linha extra gerada quando a mesclagem nao coube), a repeticao vira
// appendRow em vez de sobrescrever a que acabou de ser gravada. Grava em
// e._row a linha (1-based) usada para cada item.
function vtmigUpsertRows_(sheet, entries, valuesFn) {
  if (!entries || !entries.length) return;

  var allRows = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < allRows.length; i++) {
    var r = allRows[i];
    map[vtmigNorm_(vtmigCanonUnidade_(r[0])) + '|' + vtmigParseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim()] = i + 1;
  }

  var nesteLote = {};
  entries.forEach(function(e) {
    var mat    = String(e.matricula).trim();
    var key    = vtmigNorm_(e.unidade) + '|' + Number(e.mes) + '|' + Number(e.ano) + '|' + mat;
    var values = valuesFn(e);
    if (map[key] && !nesteLote[key]) {
      e._row = map[key];
      sheet.getRange(e._row, 7, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow([e.unidade, vtmigMesLabel_(e.mes), e.ano, mat, e.cpf || '', e.nome].concat(values));
      e._row = sheet.getLastRow();
      map[key] = e._row;
    }
    nesteLote[key] = true;
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

// Planilha de funcionarios (mesma do webapp - FUNC_SHEET_ID no Code.gs),
// aba "RJ - UNIDADES". Usada para recuperar a matricula quando a planilha
// antiga da unidade nao tem a coluna Matricula preenchida (ex.: BG).
var VTMIG_FUNC_SHEET_ID = '1BDiPjv0FqRJp5EwcvLdYXVvEAWesvwdEgbhYdnTlqPY';
var VTMIG_FUNC_COL = { NOME: 2, MATRICULA: 27, CPF: 45 }; // copia de COL no Code.gs

// Monta {porCpf: {cpf -> matricula}, porNome: {nome normalizado -> matricula}}
// com TODOS os funcionarios (ativos ou nao - planilha antiga pode ter gente
// ja desligada). Nome que aparece 2x com matriculas diferentes vira null
// (homonimo, nao da pra confiar).
function vtmigIndiceFuncionarios_() {
  var sheet = SpreadsheetApp.openById(VTMIG_FUNC_SHEET_ID).getSheetByName('RJ - UNIDADES');
  if (!sheet) throw new Error('Aba "RJ - UNIDADES" nao encontrada na planilha de funcionarios.');
  var rows = sheet.getDataRange().getValues();
  var porCpf = {}, porNome = {};
  for (var i = 1; i < rows.length; i++) {
    var mat = String(rows[i][VTMIG_FUNC_COL.MATRICULA] || '').trim();
    if (!mat) continue;
    var cpf = vtmigSanitizarCpf_(rows[i][VTMIG_FUNC_COL.CPF]);
    if (cpf && !porCpf[cpf]) porCpf[cpf] = mat;
    var nomeNorm = vtmigNorm_(rows[i][VTMIG_FUNC_COL.NOME]);
    if (!nomeNorm) continue;
    if (porNome[nomeNorm] === undefined) porNome[nomeNorm] = mat;
    else if (porNome[nomeNorm] !== mat) porNome[nomeNorm] = null;
  }
  return { porCpf: porCpf, porNome: porNome };
}

function vtmigAddAlerta_(linha, msg) {
  if (!msg || linha.alerta.indexOf(msg) !== -1) return;
  linha.alerta += (linha.alerta ? '; ' : '') + msg;
}

// Tenta encaixar um lancamento repetido (mesma unidade+mes+ano+matricula) nos
// trechos extras (Ida/Volta 2 e 3) de uma linha ja gerada, para ficar tudo em
// uma linha so. Retorna false se nao houver slot livre suficiente - nesse
// caso o chamador mantem o lancamento numa linha extra.
function vtmigMesclarLinha_(alvo, novo) {
  // Cada trecho leva a SUA quantidade (Qtd por trecho) - mesclar nao distorce
  // mais o total quando as qtds divergem (ex.: metro 20 dias + onibus 19).
  var idas = [];
  if (novo.tipoIda  || novo.valorIda)  idas.push({ tipo: novo.tipoIda,  valor: novo.valorIda,  qtd: Number(novo.qtdIda) || 0 });
  if (novo.tipoIda2 || novo.valorIda2) idas.push({ tipo: novo.tipoIda2, valor: novo.valorIda2, qtd: Number(novo.qtdIda2) || Number(novo.qtdIda) || 0 });
  var volta = (novo.tipoVolta || novo.valorVolta)
    ? { tipo: novo.tipoVolta, valor: novo.valorVolta, qtd: Number(novo.qtdVolta) || 0 }
    : null;

  var slotsIda = [], slotsVolta = [];
  if (!alvo.tipoIda2  && !alvo.valorIda2)  slotsIda.push('2');
  if (!alvo.tipoIda3  && !alvo.valorIda3)  slotsIda.push('3');
  if (!alvo.tipoVolta2 && !alvo.valorVolta2) slotsVolta.push('2');
  if (!alvo.tipoVolta3 && !alvo.valorVolta3) slotsVolta.push('3');

  if (idas.length > slotsIda.length || (volta ? 1 : 0) > slotsVolta.length) return false;

  idas.forEach(function(leg) {
    var n = slotsIda.shift();
    alvo['tipoIda' + n]  = leg.tipo;
    alvo['valorIda' + n] = leg.valor;
    alvo['qtdIda' + n]   = leg.qtd;
  });
  if (volta) {
    var n2 = slotsVolta.shift();
    alvo['tipoVolta' + n2]  = volta.tipo;
    alvo['valorVolta' + n2] = volta.valor;
    alvo['qtdVolta' + n2]   = volta.qtd;
  }

  if (!alvo.cpf && novo.cpf) alvo.cpf = novo.cpf;
  if (novo.comentario) alvo.comentario = alvo.comentario ? alvo.comentario + ' | ' + novo.comentario : novo.comentario;

  var calc = vtmigCalcularVT_(alvo);
  alvo.total = calc.total; alvo.dias = calc.diasTrabalhados; alvo.valorDiario = calc.valorDiario;
  alvo.valorJae = calc.valorJae; alvo.valorRiocard = calc.valorRiocard;

  alvo.totalOriginal = Math.round((alvo.totalOriginal + novo.totalOriginal) * 100) / 100;
  alvo.diferenca = Math.round((alvo.total - alvo.totalOriginal) * 100) / 100;

  // O alerta de diferenca calculado antes do merge fica obsoleto - refaz.
  alvo.alerta = alvo.alerta.split('; ').filter(function(a) {
    return a && a.indexOf('Total recalculado diferente do original') === -1;
  }).join('; ');
  if (Math.abs(alvo.diferenca) > 0.01)
    vtmigAddAlerta_(alvo, 'Total recalculado diferente do original (dif ' + alvo.diferenca.toFixed(2) + ')');

  // Carrega alertas do lancamento absorvido (ex.: CPF suspeito), menos o de
  // diferenca, que acabou de ser refeito com a soma dos dois.
  novo.alerta.split('; ').forEach(function(a) {
    if (a && a.indexOf('Total recalculado diferente do original') === -1) vtmigAddAlerta_(alvo, a);
  });
  vtmigAddAlerta_(alvo, 'Mesclado: lancamento repetido do mes incorporado como trecho extra');
  return true;
}

// =============================================================================
// ETAPA 1 - le a planilha antiga e cria a planilha de staging para revisao.
// =============================================================================

// Le uma planilha antiga (todas as abas de mes, secoes ADMINISTRATIVO/
// PROFESSORES) e devolve as linhas prontas para staging, SEM criar nenhuma
// planilha - usado tanto por migrarPlanilhaAntigaVT (staging de 1 unidade)
// quanto por gerarStagingVarias (staging em lote, varias unidades juntas).
// funcIdx e opcional - se nao vier, le a planilha de funcionarios na hora
// (fica mais rapido passar um ja pronto quando for ler varias unidades seguidas).
function vtmigLerPlanilhaAntiga_(oldSheetId, unidade, ano, funcIdx) {
  unidade = vtmigCanonUnidade_(unidade);
  var oldSs = SpreadsheetApp.openById(oldSheetId);

  var stageRows = { ADMINISTRATIVO: [], DOCENTE: [] };
  var vistos = {}; // chave unidade|mes|ano|matricula -> linhas de staging ja geradas
  funcIdx = funcIdx || vtmigIndiceFuncionarios_(); // para recuperar matricula por CPF/nome

  var totalLidas = 0, totalIgnoradas = 0, totalMescladas = 0, totalExtras = 0;
  var resumoAbas = []; // uma linha de log por aba, dizendo o que foi lido dela

  oldSs.getSheets().forEach(function(sheet) {
    var mes = vtmigMesPorNomeAba_(sheet.getName());
    if (!mes) { resumoAbas.push('- "' + sheet.getName() + '": ignorada (nome nao e um mes)'); return; }

    var rows = sheet.getDataRange().getValues();
    if (rows.length < 2) { resumoAbas.push('- "' + sheet.getName() + '": vazia'); return; }

    var map = vtmigMapearColunas_(rows[0]);
    var categoriaAtual = null; // 'ADMINISTRATIVO' | 'DOCENTE'
    var lidasAba = 0, semMatriculaAba = 0, semSecaoAba = 0, matRecuperadasAba = 0;

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var col0 = String(row[0] || '').trim();
      var col0Norm = vtmigNorm_(col0);

      // Banners de secao - tolera variacoes ("PROFESSOR", "DOCENTES" etc.).
      if (col0Norm.indexOf('administrativo') === 0) { categoriaAtual = 'ADMINISTRATIVO'; continue; }
      if (col0Norm.indexOf('professor') === 0 || col0Norm.indexOf('docente') === 0) { categoriaAtual = 'DOCENTE'; continue; }

      var nome = col0;
      if (!nome) continue; // linha em branco
      if (!categoriaAtual) { semSecaoAba++; continue; } // linha antes do 1o banner

      totalLidas++;

      var cpfOriginal = vtmigCelula_(row, map, 'cpf');
      var cpf = vtmigSanitizarCpf_(cpfOriginal);
      var cpfAlerta = cpfOriginal && !cpf ? ('CPF suspeito: "' + cpfOriginal + '"') : '';

      // Matricula: usa a da planilha antiga; se estiver em branco (ex.: BG),
      // recupera pela planilha de funcionarios - por CPF (confiavel) ou, em
      // ultimo caso, por nome (vai com alerta para conferencia).
      var matricula = String(vtmigCelula_(row, map, 'matricula')).trim();
      var matAlerta = '';
      if (!matricula && cpf && funcIdx.porCpf[cpf]) {
        matricula = funcIdx.porCpf[cpf];
        matRecuperadasAba++;
      }
      if (!matricula && funcIdx.porNome[vtmigNorm_(nome)]) {
        matricula = funcIdx.porNome[vtmigNorm_(nome)];
        matAlerta = 'Matricula obtida por NOME na planilha de funcionarios - conferir';
        matRecuperadasAba++;
      }
      if (!matricula) {
        matAlerta = 'SEM MATRICULA - preencha na staging antes de aplicar (sem matricula a linha nao sobe)';
        totalIgnoradas++;
        semMatriculaAba++;
      } else {
        lidasAba++;
      }

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

      // Sem matricula nao ha chave confiavel: a linha fica fora da mesclagem
      // e da deteccao de repetido (senao pessoas diferentes se misturariam).
      var chave = matricula ? (vtmigNorm_(unidade) + '|' + mes + '|' + ano + '|' + matricula) : null;

      var linha = {
        unidade: unidade, mes: vtmigMesLabel_(mes), ano: ano,
        matricula: matricula, cpf: cpf, nome: nome,
        tipoIda: tipoIda, valorIda: valorIda, qtdIda: qtdIda,
        tipoVolta: tipoVolta, valorVolta: valorVolta, qtdVolta: qtdVolta,
        total: calc.total, dias: calc.diasTrabalhados, valorDiario: calc.valorDiario,
        valorJae: calc.valorJae, valorRiocard: calc.valorRiocard,
        tipoIda2: tipoIda2, valorIda2: valorIda2,
        qtdIda2: (tipoIda2 || valorIda2) ? qtdIda : 0, // 3a coluna Jan-Abr acompanha a Qtd Ida da linha
        tipoVolta2: '', valorVolta2: 0, qtdVolta2: 0,
        tipoIda3: '', valorIda3: 0, qtdIda3: 0,
        tipoVolta3: '', valorVolta3: 0, qtdVolta3: 0,
        comentario: comentario,
        totalOriginal: totalOriginal, diferenca: diferenca,
        alerta: ''
      };
      vtmigAddAlerta_(linha, matAlerta);
      vtmigAddAlerta_(linha, cpfAlerta);
      if (Math.abs(diferenca) > 0.01) vtmigAddAlerta_(linha, 'Total recalculado diferente do original (dif ' + diferenca.toFixed(2) + ')');

      // Nome repetido no mesmo mes: em vez de criar outra linha, os trechos
      // entram como Ida/Volta 2 e 3 da linha ja existente. So vira linha
      // extra quando nao ha slot livre suficiente.
      var existentes = chave ? vistos[chave] : null;
      if (existentes) {
        var mesclou = false;
        for (var j = 0; j < existentes.length && !mesclou; j++) {
          mesclou = vtmigMesclarLinha_(existentes[j], linha);
        }
        if (mesclou) { totalMescladas++; continue; }
        vtmigAddAlerta_(linha, 'Nao coube nos trechos da linha anterior - mantido em linha extra (o webapp edita/exclui so a 1a linha da matricula no mes)');
        totalExtras++;
      }

      stageRows[categoriaAtual].push(linha);
      if (chave) vistos[chave] = (existentes || []).concat([linha]);
    }

    resumoAbas.push('- "' + sheet.getName() + '" (mes ' + mes + '): ' + lidasAba + ' lancamentos lidos'
      + (matRecuperadasAba ? ', ' + matRecuperadasAba + ' com matricula recuperada da planilha de funcionarios' : '')
      + (semMatriculaAba ? ', ' + semMatriculaAba + ' sem matricula (ficam na staging com alerta)' : '')
      + (semSecaoAba ? ', ' + semSecaoAba + ' fora das secoes ADMINISTRATIVO/PROFESSORES (pulados)' : ''));
  });

  var totalGeradas = stageRows.ADMINISTRATIVO.length + stageRows.DOCENTE.length;
  if (!totalGeradas) {
    throw new Error('Nenhum lancamento aproveitavel em "' + oldSs.getName() + '" - staging NAO criada. Resumo por aba:\n' + resumoAbas.join('\n'));
  }

  return {
    stageRows: stageRows, resumoAbas: resumoAbas, nomeArquivo: oldSs.getName(),
    totalLidas: totalLidas, totalIgnoradas: totalIgnoradas, totalMescladas: totalMescladas, totalExtras: totalExtras
  };
}

// Cria a planilha de staging (headers + valores + locale + coluna Mes em
// texto puro) a partir de {ADMINISTRATIVO, DOCENTE} ja lidos - usado tanto
// para staging de 1 unidade quanto para a staging em lote. Devolve
// {id, url, ss}.
function vtmigCriarStagingSs_(nomeArquivo, stageRows) {
  var stageSs = SpreadsheetApp.create(nomeArquivo);

  // SpreadsheetApp.create() nasce com o locale padrao da conta (geralmente
  // en_US, decimal com "."), diferente da planilha oficial do VT (pt_BR,
  // decimal com ","). Sem isso os valores da staging aparecem com "." mesmo
  // estando corretos, dificultando a revisao.
  try { stageSs.setSpreadsheetLocale(SpreadsheetApp.openById(VTMIG_SHEET_ID).getSpreadsheetLocale()); } catch (e) { Logger.log('vtmigCriarStagingSs_ setSpreadsheetLocale: ' + e); }

  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(categoria, idx) {
    var sheet = idx === 0 ? stageSs.getSheets()[0].setName(categoria) : stageSs.insertSheet(categoria);
    // Unidade..Valor Total RioCard (29 colunas, mesma ordem da planilha oficial)
    // + colunas de conferencia
    var headers = VTMIG_HEADERS[categoria].slice(0, 29)
      .concat(['Comentário', 'Total Original', 'Diferença', 'Alerta']);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);

    // Forca texto puro na coluna Mes (B) - sem isso o Sheets reconhece "01
    // Janeiro" como data de verdade e reformata o mes em minusculo (padrao pt-BR).
    sheet.getRange('B:B').setNumberFormat('@');

    var values = stageRows[categoria].map(function(l) {
      return [l.unidade, l.mes, l.ano, l.matricula, l.cpf, l.nome,
        l.tipoIda, l.valorIda, l.qtdIda,
        l.tipoIda2, l.valorIda2, l.qtdIda2,
        l.tipoIda3, l.valorIda3, l.qtdIda3,
        l.tipoVolta, l.valorVolta, l.qtdVolta,
        l.tipoVolta2, l.valorVolta2, l.qtdVolta2,
        l.tipoVolta3, l.valorVolta3, l.qtdVolta3,
        l.total, l.dias, l.valorDiario, l.valorJae, l.valorRiocard,
        l.comentario, l.totalOriginal, l.diferenca, l.alerta];
    });
    if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
    sheet.autoResizeColumns(1, headers.length);
  });

  try { stageSs.addEditor(Session.getActiveUser().getEmail()); } catch (e) { Logger.log('vtmigCriarStagingSs_ addEditor: ' + e); }

  return { id: stageSs.getId(), url: stageSs.getUrl(), ss: stageSs };
}

// Le 1 planilha antiga e cria 1 planilha de staging so para ela (fluxo
// gerarStaging()/aplicarStaging(), unidade por unidade).
function migrarPlanilhaAntigaVT(oldSheetId, unidade, ano) {
  unidade = vtmigCanonUnidade_(unidade);
  var lido = vtmigLerPlanilhaAntiga_(oldSheetId, unidade, ano);
  Logger.log('Resumo por aba de "%s":\n%s', lido.nomeArquivo, lido.resumoAbas.join('\n'));

  var carimbo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
  var staging = vtmigCriarStagingSs_('VT Migracao - ' + unidade + ' - ' + carimbo, lido.stageRows);

  // Guarda o ID para aplicarStaging() achar sozinho - sem copiar ID na mao.
  PropertiesService.getScriptProperties().setProperty(vtmigStagingProp_(unidade, ano), staging.id);

  Logger.log('Staging criada: %s', staging.url);
  Logger.log('Linhas lidas: %s | sem matricula (com alerta na staging): %s | mescladas como trecho extra: %s | repetidas que viraram linha extra: %s',
    lido.totalLidas, lido.totalIgnoradas, lido.totalMescladas, lido.totalExtras);

  return staging.url;
}

// =============================================================================
// ETAPA 3 - so rode depois de revisar a planilha de staging gerada na Etapa 1.
// Le a staging JA REVISADA e grava na planilha oficial do VT, pulando linhas
// cuja chave (unidade+mes+ano+matricula) ja exista la - protecao principal
// contra colidir com o periodo "Previsto" que ja pode estar sendo preenchido
// pelo app novo.
// =============================================================================
function aplicarStagingVT(stagingSheetId) {
  if (!stagingSheetId) {
    throw new Error('Faltou o ID da planilha de staging. O menu Executar nao passa argumentos: rode aplicarStaging() (sem VT no nome), que usa o CONFIG do topo e acha a staging sozinho.');
  }
  var stageSs = SpreadsheetApp.openById(stagingSheetId);
  var liveSs  = SpreadsheetApp.openById(VTMIG_SHEET_ID);

  var totalImportadas = 0;
  var pulados = [];

  // Qtd EFETIVA de trecho extra: herda a do 1o trecho quando em branco
  var qtdEfetiva = function(tipo, valor, qtdPropria, qtdBase) {
    if (!tipo && !(Number(valor) || 0)) return 0;
    return Number(qtdPropria) || Number(qtdBase) || 0;
  };

  // Ordem espelha as colunas G-AC da planilha oficial: ida (G-O), volta (P-X),
  // calculados (Y-AC)
  var valuesFn = function(e) {
    var calc = vtmigCalcularVT_(e);
    return [
      e.tipoIda || '', Number(e.valorIda) || 0, Number(e.qtdIda) || 0,
      e.tipoIda2 || '', Number(e.valorIda2) || 0, qtdEfetiva(e.tipoIda2, e.valorIda2, e.qtdIda2, e.qtdIda),
      e.tipoIda3 || '', Number(e.valorIda3) || 0, qtdEfetiva(e.tipoIda3, e.valorIda3, e.qtdIda3, e.qtdIda),
      e.tipoVolta || '', Number(e.valorVolta) || 0, Number(e.qtdVolta) || 0,
      e.tipoVolta2 || '', Number(e.valorVolta2) || 0, qtdEfetiva(e.tipoVolta2, e.valorVolta2, e.qtdVolta2, e.qtdVolta),
      e.tipoVolta3 || '', Number(e.valorVolta3) || 0, qtdEfetiva(e.tipoVolta3, e.valorVolta3, e.qtdVolta3, e.qtdVolta),
      calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard
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
      if (!unidade || !mes || !ano) continue;
      if (!matricula) {
        pulados.push(unidade + '/' + mes + '/' + ano + '/' + String(r[5] || '?').trim() + ' (sem matricula - nao importada)');
        continue;
      }

      var chave = vtmigNorm_(unidade) + '|' + mes + '|' + ano + '|' + matricula;
      if (liveKeys[chave]) {
        pulados.push(unidade + '/' + mes + '/' + ano + '/' + matricula + ' (ja existe no VT ao vivo)');
        continue;
      }

      entries.push({
        unidade: unidade, mes: mes, ano: ano,
        matricula: matricula, cpf: String(r[4] || '').trim(), nome: String(r[5] || '').trim(),
        tipoIda: r[6], valorIda: r[7], qtdIda: r[8],
        tipoIda2: r[9] || '', valorIda2: r[10] || 0, qtdIda2: r[11] || 0,
        tipoIda3: r[12] || '', valorIda3: r[13] || 0, qtdIda3: r[14] || 0,
        tipoVolta: r[15], valorVolta: r[16], qtdVolta: r[17],
        tipoVolta2: r[18] || '', valorVolta2: r[19] || 0, qtdVolta2: r[20] || 0,
        tipoVolta3: r[21] || '', valorVolta3: r[22] || 0, qtdVolta3: r[23] || 0,
        comentarioMigrado: String(r[29] || '').trim()
      });
    }

    vtmigUpsertRows_(liveSheet, entries, valuesFn);

    // Comentarios (campo OBS original) - nao fazem parte do upsert acima,
    // entao gravamos a parte nas 3 colunas de comentario da planilha oficial,
    // na linha exata que o upsert usou para aquele item (e._row).
    var comCol1 = VTMIG_HEADERS[categoria].indexOf('Comentário') + 1;
    entries.forEach(function(e) {
      if (!e.comentarioMigrado || !e._row) return;
      liveSheet.getRange(e._row, comCol1, 1, 3).setValues([[e.comentarioMigrado, new Date(), 'Migracao']]);
    });

    totalImportadas += entries.length;
  });

  Logger.log('Importadas: %s | Puladas (ja existiam no VT ao vivo): %s', totalImportadas, pulados.length);
  if (pulados.length) Logger.log('Detalhe dos pulados:\n%s', pulados.join('\n'));

  return { importadas: totalImportadas, puladas: pulados };
}

