// =============================================================================
// CONFIGURAÇÕES
// =============================================================================

const VT_SHEET_ID   = '1zDOd3nUIojbDVPgglDfZ5wsEOldwCcOGjLeh_YkU4yU';
const FUNC_SHEET_ID = '1BDiPjv0FqRJp5EwcvLdYXVvEAWesvwdEgbhYdnTlqPY';
const HUB_SS_ID      = '1eZPbzhzjhjHoPwMhAW5YvOZgYiAvlTYc07dRan6Lyoc';
const MEU_ACESSO     = 'webvt';

// v1 ainda não cobre São Paulo (regras de Bilhete Único pendentes) — só a unidade VO é de SP hoje
const UNIDADE_FORA_DE_ESCOPO = 'VO';

// Índices das colunas na planilha de funcionários (base 0)
const COL = {
  NOME:         2,   // C
  FUNCAO:       5,   // F
  ATIVO:        10,  // K
  UNIDADE:      21,  // V
  MATRICULA:    27,  // AB
  UNIDADE_SEC:  30,  // AE
  CPF:          45   // AT
};

// Tipos de transporte e o cartão RJ para o qual o valor é somado
const TIPOS_JAE     = ['onibus municipal', 'metro'];             // normalizados (sem acento)
const TIPOS_RIOCARD = ['onibus intermunicipal', 'barca', 'trem']; // normalizados (sem acento)

// Cabeçalhos das abas da planilha VT (criadas automaticamente se não existirem)
const VT_HEADERS = {
  ADMINISTRATIVO: ['Unidade','Mês','Ano','Matrícula','CPF','Administrativo','Tipo Ida','Valor Ida','Qtd Ida','Tipo Volta','Valor Volta','Qtd Volta','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard'],
  DOCENTE:        ['Unidade','Mês','Ano','Matrícula','CPF','Docente','Tipo Ida','Valor Ida','Qtd Ida','Tipo Volta','Valor Volta','Qtd Volta','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard']
};

// Normaliza texto para comparação: minúsculo, sem acento, sem espaços nas bordas
function norm_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Extrai o número do mês mesmo quando a célula guarda texto como "06 Junho" (em vez de 6)
function parseMes_(v) {
  return parseInt(String(v).trim(), 10) || 0;
}

// =============================================================================
// ENTRY POINT
// =============================================================================

function doGet(e) {
  const token = (e && e.parameter && e.parameter.s) ? e.parameter.s : '';
  const tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.token = token;
  return tmpl.evaluate()
    .setTitle('Vale Transporte — BRASAS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// =============================================================================
// AUTENTICAÇÃO
// =============================================================================

// Colunas SESSOES: TOKEN(0)|EMAIL(1)|NOME(2)|ROLE(3)|UNIDADE(4)|CRIADO_EM(5)|EXPIRA_EM(6)|ACESSOS(7)
// UNIDADE pode ser pipe-separado (ex: "BG|FG"). Vazio = acesso a todas.

function getUserFromHub(token) {
  if (!token) throw new Error('Token não fornecido.');

  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  return user;
}

function getSessionUser_(token) {
  if (!token) return null;
  try {
    const ss       = SpreadsheetApp.openById(HUB_SS_ID);
    const sesSheet = ss.getSheetByName('SESSOES');
    if (!sesSheet) return null;

    const tok   = String(token).trim();
    const found = sesSheet.getRange(1, 1, sesSheet.getLastRow(), 1)
      .createTextFinder(tok).matchEntireCell(true).findNext();
    if (!found) return null;

    // [TOKEN, EMAIL, NOME, ROLE, UNIDADE, CRIADO_EM, EXPIRA_EM, ACESSOS]
    const row = sesSheet.getRange(found.getRow(), 1, 1, 8).getValues()[0];

    if (row[6] && new Date(row[6]) < new Date()) return null; // expirado

    const email = String(row[1] || '').trim().toLowerCase();
    if (!email) return null;

    // Verifica acesso a este dashboard na coluna ACESSOS
    const acessos = String(row[7] || '').toLowerCase()
      .split(',').map(function(a) { return a.trim(); });
    if (!acessos.includes(MEU_ACESSO)) {
      throw new Error('Você não tem permissão para acessar o Vale Transporte. Contacte o administrador.');
    }

    // UNIDADE: vazio = todas; pipe-separado = restringe a essas
    const unidadeRaw = String(row[4] || '').trim();
    const units = unidadeRaw
      ? unidadeRaw.split('|').map(function(u) { return u.trim(); }).filter(Boolean)
      : [];

    return {
      email:    email,
      nome:     String(row[2] || '').trim(),
      role:     String(row[3] || '').trim().toLowerCase(),
      unidade:  units[0] || '',
      units:    units  // [] = acesso total; preenchido = só essas unidades
    };
  } catch (e) {
    if (e.message && e.message.includes('permissão')) throw e;
    Logger.log('getSessionUser_: ' + e);
    return null;
  }
}

function isUserAllowedUnit_(user, unit) {
  if (!user.units || !user.units.length) return true; // acesso total
  return user.units.some(function(u) {
    return u.toLowerCase().trim() === unit.toLowerCase().trim();
  });
}

// Todas as unidades que o usuário pode ver: as dele (se restrito) ou todas que existem
// (com funcionário ativo cadastrado OU já com lançamento na planilha de VT), exceto a(s)
// unidade(s) ainda fora do escopo (ver UNIDADE_FORA_DE_ESCOPO).
function getAllowedUnidades_(user) {
  const set = {};

  if (user.units && user.units.length > 0) {
    user.units.forEach(function(u) { set[u] = true; });
  } else {
    const funcSheet = SpreadsheetApp.openById(FUNC_SHEET_ID).getSheetByName('RJ - UNIDADES');
    if (!funcSheet) throw new Error('Aba "RJ - UNIDADES" não encontrada.');
    const funcRows = funcSheet.getDataRange().getValues();
    for (let i = 1; i < funcRows.length; i++) {
      const nome = String(funcRows[i][COL.NOME] || '').trim();
      if (!nome) continue;
      const ativoRaw = norm_(funcRows[i][COL.ATIVO]);
      if (ativoRaw === 'false' || ativoRaw === 'nao' || ativoRaw === 'no' || ativoRaw === '0') continue;
      const u = String(funcRows[i][COL.UNIDADE] || '').trim();
      if (u) set[u] = true;
    }

    const vtSs = SpreadsheetApp.openById(VT_SHEET_ID);
    ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(sheetName) {
      const sheet = getOrCreateVTSheet_(vtSs, sheetName);
      const rows  = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        const u = String(rows[i][0] || '').trim();
        if (u) set[u] = true;
      }
    });
  }

  Object.keys(set).forEach(function(u) {
    if (norm_(u) === norm_(UNIDADE_FORA_DE_ESCOPO)) delete set[u];
  });

  const result = Object.keys(set).sort();
  if (!result.length) throw new Error('Vale Transporte ainda não está disponível para sua unidade.');
  return result;
}

// Retorna lista de unidades disponíveis para o usuário
function getUnidades(token) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida.');
  return getAllowedUnidades_(user);
}

// =============================================================================
// PERÍODO VIGENTE — o VT só tem "Previsto" (preenchido um mês antes), sem Efetivo
// =============================================================================

function getCurrentPeriod(token) {
  const now = new Date();
  const mes = now.getMonth() + 1;
  const ano = now.getFullYear();

  let previstoMes = mes + 1;
  let previstoAno = ano;
  if (previstoMes > 12) { previstoMes = 1; previstoAno++; }

  // DEV: bloqueio desativado — restaurar para: let locked = now.getDate() > 11;
  let locked = false;

  // Liberação temporária (24h) concedida por um admin ignora o bloqueio para esse usuário
  if (locked) {
    const user = getSessionUser_(token);
    if (user && hasActiveLiberacao_(user.email)) locked = false;
  }

  return {
    previsto: { mes: previstoMes, ano: previstoAno },
    locked:   locked
  };
}

// =============================================================================
// LIBERAÇÕES TEMPORÁRIAS DE EDIÇÃO (24h) — restrito a admins
// =============================================================================

// Colunas: Email | Liberado Por | Criado Em | Expira Em
function getLiberacoesSheet_() {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  let sheet = ss.getSheetByName('LIBERACOES');
  if (!sheet) {
    sheet = ss.insertSheet('LIBERACOES');
    sheet.appendRow(['Email', 'Liberado Por', 'Criado Em', 'Expira Em']);
  }
  return sheet;
}

function requireAdmin_(token) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');
  if (user.role !== 'admin') throw new Error('Acesso restrito a administradores.');
  return user;
}

function hasActiveLiberacao_(email) {
  if (!email) return false;
  const emailNorm = norm_(email);
  const now  = new Date();
  const rows = getLiberacoesSheet_().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (norm_(r[0]) === emailNorm && r[3] && new Date(r[3]) > now) return true;
  }
  return false;
}

// Lista todas as liberações já concedidas (mais recentes primeiro) — só para admins
function getLiberacoes(token) {
  requireAdmin_(token);
  const rows = getLiberacoesSheet_().getDataRange().getValues();

  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    list.push({ email: String(r[0]).trim(), liberadoPor: String(r[1]).trim(), criadoEm: r[2], expiraEm: r[3] });
  }
  list.sort(function(a, b) { return new Date(b.criadoEm) - new Date(a.criadoEm); });
  return list;
}

// Concede 24h de edição liberada para um e-mail — só admins podem chamar
function criarLiberacao(token, email) {
  const admin = requireAdmin_(token);

  email = String(email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) throw new Error('Informe um e-mail válido.');

  const now    = new Date();
  const expira = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  getLiberacoesSheet_().appendRow([email, admin.email, now, expira]);
  return getLiberacoes(token);
}

// =============================================================================
// FUNCIONÁRIOS
// =============================================================================

// Retorna os funcionários de TODAS as unidades que o usuário pode ver.
// Um funcionário com unidade principal + secundária aparece uma vez para cada uma
// (desde que esteja entre as unidades permitidas), pois cada uma é um contexto de lançamento distinto.
function getFuncionarios(token) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida.');
  const allowedNorm = getAllowedUnidades_(user).map(norm_);

  const ss    = SpreadsheetApp.openById(FUNC_SHEET_ID);
  const sheet = ss.getSheetByName('RJ - UNIDADES');
  if (!sheet) throw new Error('Aba "RJ - UNIDADES" não encontrada na planilha de funcionários.');
  const rows  = sheet.getDataRange().getValues();

  const administrativo = [];
  const docente        = [];

  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    const nome = String(row[COL.NOME]).trim();
    if (!nome) continue;

    const ativoRaw = norm_(row[COL.ATIVO]);
    if (ativoRaw === 'false' || ativoRaw === 'nao' || ativoRaw === 'no' || ativoRaw === '0') continue;

    const matricula = String(row[COL.MATRICULA]).trim();
    if (!matricula) continue;

    const cpf    = String(row[COL.CPF] || '').trim();
    const funcao = String(row[COL.FUNCAO]).trim().toUpperCase();
    const list   = funcao === 'PROFESSOR' ? docente : administrativo;

    // Unidade principal + secundária, sem repetir se forem iguais
    const unidades = [String(row[COL.UNIDADE]).trim(), String(row[COL.UNIDADE_SEC]).trim()]
      .filter(function(u, idx, arr) { return u && arr.indexOf(u) === idx; });

    unidades.forEach(function(u) {
      if (allowedNorm.indexOf(norm_(u)) === -1) return;
      list.push({ nome: nome, matricula: matricula, cpf: cpf, unidade: u });
    });
  }

  administrativo.sort(function(a, b) { return a.nome.localeCompare(b.nome, 'pt-BR') || a.unidade.localeCompare(b.unidade, 'pt-BR'); });
  docente.sort(function(a, b)        { return a.nome.localeCompare(b.nome, 'pt-BR') || a.unidade.localeCompare(b.unidade, 'pt-BR'); });

  return { administrativo: administrativo, docente: docente };
}

// =============================================================================
// PLANILHA VT — criação automática das abas (a planilha central nasce em branco)
// =============================================================================

function getOrCreateVTSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(VT_HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// =============================================================================
// CÁLCULO — Total, Dias Trabalhados, Valor Diário e o rateio Jaé/RioCard
// são sempre calculados aqui, nunca confiados ao que o cliente mandar.
// =============================================================================

function classificarCartao_(tipo) {
  const t = norm_(tipo);
  if (TIPOS_JAE.indexOf(t) !== -1) return 'jae';
  if (TIPOS_RIOCARD.indexOf(t) !== -1) return 'riocard';
  return null;
}

function calcularVT_(e) {
  const valorIda   = Number(e.valorIda)   || 0;
  const qtdIda     = Number(e.qtdIda)     || 0;
  const valorVolta = Number(e.valorVolta) || 0;
  const qtdVolta   = Number(e.qtdVolta)   || 0;

  const totalIda   = valorIda   * qtdIda;
  const totalVolta = valorVolta * qtdVolta;
  const total      = totalIda + totalVolta;
  const dias       = qtdIda + qtdVolta;
  const valorDiario = dias > 0 ? total / dias : 0;

  let valorJae = 0, valorRiocard = 0;
  const cartaoIda   = classificarCartao_(e.tipoIda);
  const cartaoVolta = classificarCartao_(e.tipoVolta);
  if (cartaoIda   === 'jae')     valorJae     += totalIda;
  if (cartaoIda   === 'riocard') valorRiocard += totalIda;
  if (cartaoVolta === 'jae')     valorJae     += totalVolta;
  if (cartaoVolta === 'riocard') valorRiocard += totalVolta;

  return { total: total, diasTrabalhados: dias, valorDiario: valorDiario, valorJae: valorJae, valorRiocard: valorRiocard };
}

// =============================================================================
// LEITURA DO VT — todas as linhas de todas as unidades permitidas, estilo planilha
// =============================================================================

// Colunas ADMINISTRATIVO/DOCENTE: Unidade|Mês|Ano|Matrícula|CPF|Nome|
//   TipoIda|ValorIda|QtdIda|TipoVolta|ValorVolta|QtdVolta|Total|DiasTrabalhados|ValorDiário|ValorJaé|ValorRioCard
function getVTData(token) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida.');
  const allowedNorm = getAllowedUnidades_(user).map(norm_);

  const ss = SpreadsheetApp.openById(VT_SHEET_ID);

  function readSheet(sheetName) {
    const sheet = getOrCreateVTSheet_(ss, sheetName);
    const rows  = sheet.getDataRange().getValues();
    const out   = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (allowedNorm.indexOf(norm_(r[0])) === -1) continue;
      const mes = parseMes_(r[1]), ano = Number(r[2]);
      if (!mes || !ano) continue;
      out.push({
        unidade: String(r[0]).trim(), mes: mes, ano: ano,
        matricula: String(r[3]).trim(), cpf: String(r[4]).trim(), nome: String(r[5]).trim(),
        tipoIda: String(r[6]).trim(), valorIda: r[7] || 0, qtdIda: r[8] || 0,
        tipoVolta: String(r[9]).trim(), valorVolta: r[10] || 0, qtdVolta: r[11] || 0,
        total: r[12] || 0, diasTrabalhados: r[13] || 0, valorDiario: r[14] || 0,
        valorJae: r[15] || 0, valorRiocard: r[16] || 0
      });
    }

    out.sort(function(a, b) {
      return (a.ano - b.ano) || (a.mes - b.mes) || a.unidade.localeCompare(b.unidade, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
    });
    return out;
  }

  return { administrativo: readSheet('ADMINISTRATIVO'), docente: readSheet('DOCENTE') };
}

// =============================================================================
// SALVAMENTO DO VT — cada item do payload já traz sua própria unidade/mês/ano;
// os campos calculados são recalculados aqui a partir de Tipo/Valor/Qtd de ida e volta.
// =============================================================================

function saveVTData(payload) {
  // DEV: validação de bloqueio desativada — restaurar após testes:
  // const period = getCurrentPeriod();
  // if (period.locked) throw new Error('O período está bloqueado. Prazo encerrado no dia 11.');

  const user = getSessionUser_(payload.token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  const ss           = SpreadsheetApp.openById(VT_SHEET_ID);
  const adminSheet   = getOrCreateVTSheet_(ss, 'ADMINISTRATIVO');
  const docenteSheet = getOrCreateVTSheet_(ss, 'DOCENTE');

  // Nunca confia na unidade vinda do cliente sem checar permissão
  const adminEntries   = (payload.administrativo || []).filter(function(e) { return isUserAllowedUnit_(user, e.unidade); });
  const docenteEntries = (payload.docente        || []).filter(function(e) { return isUserAllowedUnit_(user, e.unidade); });

  function valuesFn(e) {
    const calc = calcularVT_(e);
    return [
      e.tipoIda || '', Number(e.valorIda) || 0, Number(e.qtdIda) || 0,
      e.tipoVolta || '', Number(e.valorVolta) || 0, Number(e.qtdVolta) || 0,
      calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard
    ];
  }

  _upsertRows_(adminSheet, adminEntries, valuesFn);
  _upsertRows_(docenteSheet, docenteEntries, valuesFn);

  return { success: true };
}

// Atualiza a linha existente (unidade+mes+ano+matricula) ou cria uma nova, para cada item.
// Identidade (Unidade..CPF..Nome) ocupa as colunas A-F; os valores calculados começam na G.
function _upsertRows_(sheet, entries, valuesFn) {
  if (!entries || !entries.length) return;

  const allRows = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    map[norm_(r[0]) + '|' + parseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim()] = i + 1;
  }

  entries.forEach(function(e) {
    const mat    = String(e.matricula).trim();
    const key    = norm_(e.unidade) + '|' + Number(e.mes) + '|' + Number(e.ano) + '|' + mat;
    const values = valuesFn(e);
    if (map[key]) {
      sheet.getRange(map[key], 7, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow([e.unidade, e.mes, e.ano, mat, e.cpf || '', e.nome].concat(values));
      map[key] = sheet.getLastRow();
    }
  });
}

// =============================================================================
// DIAGNÓSTICO — rode no editor do Apps Script e veja os logs (Ctrl+Enter)
// =============================================================================

function diagnosticoVT() {
  const period = getCurrentPeriod();
  const ss     = SpreadsheetApp.openById(VT_SHEET_ID);
  const admin  = getOrCreateVTSheet_(ss, 'ADMINISTRATIVO');
  const doc    = getOrCreateVTSheet_(ss, 'DOCENTE');

  Logger.log('=== PERÍODO ATUAL (só Previsto) ===');
  Logger.log('Previsto: mês %s / ano %s — bloqueado: %s', period.previsto.mes, period.previsto.ano, period.locked);

  Logger.log('\n=== LINHAS EM ADMINISTRATIVO ===');
  admin.getDataRange().getValues().slice(1).forEach(function(r, i) {
    Logger.log('Linha %s → unidade="%s" mes=%s ano=%s mat="%s" vals=%s',
      i + 2, r[0], r[1], r[2], r[3], JSON.stringify(r.slice(6)));
  });

  Logger.log('\n=== LINHAS EM DOCENTE ===');
  doc.getDataRange().getValues().slice(1).forEach(function(r, i) {
    Logger.log('Linha %s → unidade="%s" mes=%s ano=%s mat="%s" vals=%s',
      i + 2, r[0], r[1], r[2], r[3], JSON.stringify(r.slice(6)));
  });
}
