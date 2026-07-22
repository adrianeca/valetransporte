// =============================================================================
// CONFIGURAÇÕES
// =============================================================================

const VT_SHEET_ID   = '1zDOd3nUIojbDVPgglDfZ5wsEOldwCcOGjLeh_YkU4yU';
const FUNC_SHEET_ID = '1BDiPjv0FqRJp5EwcvLdYXVvEAWesvwdEgbhYdnTlqPY';
const HUB_SS_ID      = '1eZPbzhzjhjHoPwMhAW5YvOZgYiAvlTYc07dRan6Lyoc';
const MEU_ACESSO     = 'webvt';
const HUB_URL        = 'https://script.google.com/a/macros/brasas.com/s/AKfycbyF7BArYMYFtcQY7_4RTGGPw89yNohAjR7eGptItP-EsnWhNfiZR2ISRaHdAkwlLSlr/exec';

// E-mail que recebe as solicitações de liberação feitas pelos diretores
const DP_EMAIL = 'dp@brasas.com';

// Motivos que o diretor pode selecionar ao pedir liberação (AJUSTAR: lista provisória)
const MOTIVOS_LIBERACAO = [
  'Esqueci de lançar dentro do prazo',
  'Correção de lançamento com erro',
  'Funcionário admitido após o fechamento',
  'Outro'
];

// E-mails que nunca sofrem o bloqueio automático do dia 12 (edição sempre liberada
// pra eles, sem precisar de liberação temporária nem solicitação ao DP).
const EMAILS_SEM_BLOQUEIO = [
  'dp.ec@brasas.com',
  'adriane@brasas.com',
  'priscila.soares@brasas.com',
  'bianca_dp@brasas.com',
  'bruno@brasas.com'
];

function isSemBloqueio_(email) {
  if (!email) return false;
  const emailNorm = norm_(email);
  return EMAILS_SEM_BLOQUEIO.some(function(e) { return norm_(e) === emailNorm; });
}

// Unidades de SP (hoje só VO) não têm cartões Jaé/RioCard: usam os mesmos tipos de
// transporte do RJ, mas sem rateio — o valor final a pagar é a coluna Total.
const UNIDADES_SEM_RATEIO = ['VO'];

function isSemRateio_(unidade) {
  return UNIDADES_SEM_RATEIO.some(function(u) { return norm_(u) === norm_(unidade); });
}

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

// Cabeçalhos das abas da planilha VT (criadas automaticamente se não existirem).
// Ordem lógica: identidade (A-F) → trechos de IDA com Tipo/Valor/Qtd de cada um
// (G-O) → trechos de VOLTA (P-X) → calculados (Y-AC) → auditoria (AD-AH) →
// campos alterados via liberação pós-dia-11 (AI). Qtd de trecho extra em branco
// herda a Qtd do 1º trecho do sentido. Coluna nova sempre no FIM: getOrCreateVTSheet_
// só sabe completar cabeçalho que falta no final, nunca no meio.
// Layout reorganizado antes do lançamento 100% do webapp — se a aba ainda estiver
// no layout antigo (Tipo Ida 2 na coluna R), rodar reorganizarColunasVT() uma vez.
const VT_HEADERS = {
  ADMINISTRATIVO: ['Unidade','Mês','Ano','Matrícula','CPF','Administrativo','Tipo Ida','Valor Ida','Qtd Ida','Tipo Ida 2','Valor Ida 2','Qtd Ida 2','Tipo Ida 3','Valor Ida 3','Qtd Ida 3','Tipo Volta','Valor Volta','Qtd Volta','Tipo Volta 2','Valor Volta 2','Qtd Volta 2','Tipo Volta 3','Valor Volta 3','Qtd Volta 3','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Editado Em','Editado Por','Comentário','Comentado Em','Comentado Por','Campos Editados (Liberação)'],
  DOCENTE:        ['Unidade','Mês','Ano','Matrícula','CPF','Docente','Tipo Ida','Valor Ida','Qtd Ida','Tipo Ida 2','Valor Ida 2','Qtd Ida 2','Tipo Ida 3','Valor Ida 3','Qtd Ida 3','Tipo Volta','Valor Volta','Qtd Volta','Tipo Volta 2','Valor Volta 2','Qtd Volta 2','Tipo Volta 3','Valor Volta 3','Qtd Volta 3','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Editado Em','Editado Por','Comentário','Comentado Em','Comentado Por','Campos Editados (Liberação)']
};

// Ordem espelha os 18 primeiros valores retornados por valuesFn() em saveVTData
// (trechos de ida e volta, sem os calculados) — usado para registrar quais campos
// específicos mudaram numa edição feita durante uma liberação concedida após o dia 11.
const VT_CAMPOS_TRECHO_ = [
  'tipoIda','valorIda','qtdIda','tipoIda2','valorIda2','qtdIda2','tipoIda3','valorIda3','qtdIda3',
  'tipoVolta','valorVolta','qtdVolta','tipoVolta2','valorVolta2','qtdVolta2','tipoVolta3','valorVolta3','qtdVolta3'
];

// Normaliza texto para comparação: minúsculo, sem acento, sem espaços nas bordas
function norm_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Algumas fontes (Hub, lançamentos antigos) chamam a mesma unidade de "NS" (na
// verdade CH) ou "MRI" (na verdade MR). Toda unidade crua deve passar por aqui
// assim que é lida, pra não duplicar a unidade em listas/filtros/lembretes.
const UNIDADE_ALIASES_ = { ns: 'CH', mri: 'MR' };
function canonUnidade_(u) {
  u = String(u || '').trim();
  if (!u) return u;
  const alias = UNIDADE_ALIASES_[norm_(u)];
  return alias || u;
}

// Extrai o número do mês mesmo quando a célula guarda texto como "06 Junho" (em vez de 6)
function parseMes_(v) {
  return parseInt(String(v).trim(), 10) || 0;
}

// Padrão de escrita do mês na planilha: "06 Junho", "07 Julho"...
const MESES_LABEL = ['01 Janeiro', '02 Fevereiro', '03 Março', '04 Abril', '05 Maio', '06 Junho',
                     '07 Julho', '08 Agosto', '09 Setembro', '10 Outubro', '11 Novembro', '12 Dezembro'];

function mesLabel_(m) {
  const n = parseMes_(m);
  return MESES_LABEL[n - 1] || String(m);
}

// Formata data+hora para exibição (colunas "Editado Em")
function fmtDataHora_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  return String(v);
}

// Coluna ATIVO (K) guarda o texto "Ativo"/"Inativo" (às vezes true/false, sim/não)
function isInativo_(v) {
  const n = norm_(v);
  return n === 'inativo' || n === 'inactive' || n === 'false' || n === 'nao' || n === 'no' || n === '0';
}

// Strip sufixo como " GRUPO" para que "4584 GRUPO" (planilha VT) bata com "4584" (RJ-UNIDADES)
function normMat_(mat) {
  return norm_(String(mat).trim().replace(/\s+.*$/, ''));
}

function isDpOrAdmin_(user) {
  return user.role === 'admin' || user.role === 'dp';
}

// Funcionários com EC NEW + outra unidade só aparecem para DP/admin, e nunca sob EC NEW.
// Chave composta mat|unidade evita falsos positivos com matrículas duplicadas.
function buildEcLinkedSet_() {
  const set   = {};
  const ss    = SpreadsheetApp.openById(FUNC_SHEET_ID);
  const sheet = ss.getSheetByName('RJ - UNIDADES');
  if (!sheet) return set;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (isInativo_(rows[i][COL.ATIVO])) continue;
    const mat = String(rows[i][COL.MATRICULA]).trim();
    if (!mat || mat === '-') continue;
    const unidades = [canonUnidade_(rows[i][COL.UNIDADE]), canonUnidade_(rows[i][COL.UNIDADE_SEC])]
      .filter(function(u) { return u; });
    const hasEcNew = unidades.some(function(u) { return norm_(u) === 'ec new'; });
    if (!hasEcNew) continue;
    const nonEcUnits = unidades.filter(function(u) { return norm_(u) !== 'ec new'; });
    if (!nonEcUnits.length) continue;
    nonEcUnits.forEach(function(u) {
      set[normMat_(mat) + '|' + norm_(u)] = true;
    });
  }
  return set;
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
      ? unidadeRaw.split('|').map(function(u) { return canonUnidade_(u); }).filter(Boolean)
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
// (com funcionário ativo cadastrado OU já com lançamento na planilha de VT).
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
      if (isInativo_(funcRows[i][COL.ATIVO])) continue;
      const u = canonUnidade_(funcRows[i][COL.UNIDADE]);
      if (u) set[u] = true;
    }

    const vtSs = SpreadsheetApp.openById(VT_SHEET_ID);
    ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(sheetName) {
      const sheet = getOrCreateVTSheet_(vtSs, sheetName);
      const rows  = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        const u = canonUnidade_(rows[i][0]);
        if (u) set[u] = true;
      }
    });
  }

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

  // Aberto até o dia 11; a partir do dia 12 o período bloqueia automaticamente
  let locked = now.getDate() > 11;

  // Liberação temporária (válida até 23:59 do dia da concessão) ignora o bloqueio para esse usuário,
  // assim como os e-mails da lista EMAILS_SEM_BLOQUEIO (nunca bloqueiam)
  if (locked) {
    const user = getSessionUser_(token);
    if (user && (isSemBloqueio_(user.email) || hasActiveLiberacao_(user.email))) locked = false;
  }

  return {
    previsto: { mes: previstoMes, ano: previstoAno },
    locked:   locked
  };
}

// =============================================================================
// LIBERAÇÕES TEMPORÁRIAS DE EDIÇÃO (até 23:59 do dia) — restrito a admins
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
  if (user.role !== 'admin' && user.role !== 'dp') throw new Error('Acesso restrito a administradores e ao Departamento Pessoal.');
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

// Concede edição liberada até 23:59 do dia da concessão — só admins podem chamar
function criarLiberacao(token, email) {
  const admin = requireAdmin_(token);

  email = String(email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') === -1) throw new Error('Informe um e-mail válido.');

  const now    = new Date();
  const expira = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  getLiberacoesSheet_().appendRow([email, admin.email, now, expira]);
  enviarEmailLiberacao_(email, now, expira);
  return getLiberacoes(token);
}

// Busca o nome cadastrado no Hub (SESSOES) para personalizar o e-mail. Vazio se não achar.
function findNomeByEmail_(email) {
  try {
    const sheet = SpreadsheetApp.openById(HUB_SS_ID).getSheetByName('SESSOES');
    if (!sheet) return '';
    const rows      = sheet.getDataRange().getValues();
    const emailNorm = norm_(email);
    for (let i = rows.length - 1; i >= 1; i--) {
      if (norm_(rows[i][1]) === emailNorm && rows[i][2]) return String(rows[i][2]).trim();
    }
    return '';
  } catch (e) {
    return '';
  }
}

// Avisa por e-mail quem recebeu a liberação. Falha de envio não deve derrubar a liberação em si.
function enviarEmailLiberacao_(email, criadoEm, expira) {
  try {
    const pad = function(n) { return n < 10 ? '0' + n : n; };
    const fmtDT = function(d) {
      return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
        ' às ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const criadoStr = fmtDT(criadoEm);
    const expiraStr = fmtDT(expira);
    const nome      = findNomeByEmail_(email);

    const assunto = 'Liberação temporária de edição — Vale Transporte';

    const corpoTexto =
      'Olá' + (nome ? ', ' + nome.toUpperCase() : '') + '.\n\n' +
      'Você recebeu uma liberação temporária para editar o Vale Transporte fora do prazo normal, ' +
      'concedida pelo Departamento Pessoal.\n\n' +
      'ATENÇÃO: a liberação vale SOMENTE HOJE, até as 23:59. Amanhã a edição já estará bloqueada novamente.\n\n' +
      'Concedida em: ' + criadoStr + '\n' +
      'Válida até: ' + expiraStr + ' (hoje)\n\n' +
      'Acesse pelo Hub BRASAS BI: ' + HUB_URL + '\n\n' +
      'Após esse horário, a edição volta a ficar bloqueada automaticamente.\n\n' +
      'Equipe BRASAS BI';

    const corpoHtml =
      '<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">' +
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">' +

          '<div style="background:#0a1628;padding:26px 32px">' +
            '<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3">' +
              'Liberação Temporária de Edição — Vale Transporte' +
            '</h1>' +
          '</div>' +

          '<div style="padding:28px 32px">' +

            '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:22px;font-size:13px;color:#475569">' +
              '&#9888;&#65039; Este é um comunicado automático. <strong>Não responda este e-mail</strong> — em caso de dúvidas, entre em contato com o Departamento Pessoal pelo endereço <a href="mailto:dp@brasas.com" style="color:#2a4d76">dp@brasas.com</a>.' +
            '</div>' +

            '<p style="margin:0 0 14px;font-size:15px;color:#0f2035">Olá' +
              (nome ? ', <strong>' + nome.toUpperCase() + '</strong>' : '') + '.</p>' +

            '<p style="margin:0 0 14px;font-size:15px;color:#0f2035;line-height:1.6">' +
              'Você recebeu uma liberação temporária para editar o ' +
              '<strong>Vale Transporte</strong> fora do prazo normal (dia 11).' +
            '</p>' +

            '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:14px 16px;margin-bottom:22px;font-size:14px;color:#92400e;line-height:1.5">' +
              '&#9200; A liberação vale <strong>somente hoje, até as 23:59</strong>. Amanhã a edição já estará bloqueada novamente.' +
            '</div>' +

            '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:24px">' +
              '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:14px">Dados da liberação</div>' +
              '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;width:150px">Liberado por:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">Departamento Pessoal</td>' +
                '</tr>' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b">Concedida em:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + criadoStr + '</td>' +
                '</tr>' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b">Válida até:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + expiraStr + ' (hoje)</td>' +
                '</tr>' +
              '</table>' +
            '</div>' +

            '<div style="text-align:center;margin-bottom:8px">' +
              '<a href="' + HUB_URL + '" style="display:inline-block;background:#0f2035;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">' +
                'Acessar o Vale Transporte' +
              '</a>' +
            '</div>' +

            '<p style="margin:20px 0 0;font-size:12.5px;color:#94a3b8;text-align:center">' +
              'Após as 23:59 de hoje, a edição volta a ficar bloqueada automaticamente.' +
            '</p>' +

          '</div>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail(email, assunto, corpoTexto, { htmlBody: corpoHtml, name: 'Vale Transporte — BRASAS BI' });
  } catch (e) {
    Logger.log('enviarEmailLiberacao_: falha ao enviar e-mail para ' + email + ' — ' + e);
  }
}

// =============================================================================
// SOLICITAÇÕES DE LIBERAÇÃO — diretor pede pelo painel, DP aprova ou reprova
// =============================================================================

// Escapa texto livre antes de inseri-lo no HTML dos e-mails
function escHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Colunas: ID | Email | Nome | Motivo | Observações | Status | Criado Em | Respondido Por | Respondido Em | Observação DP
function getSolicitacoesSheet_() {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  let sheet = ss.getSheetByName('SOLICITACOES');
  if (!sheet) {
    sheet = ss.insertSheet('SOLICITACOES');
    sheet.appendRow(['ID', 'Email', 'Nome', 'Motivo', 'Observações', 'Status',
                     'Criado Em', 'Respondido Por', 'Respondido Em', 'Observação DP']);
  }
  return sheet;
}

function solicitacaoFromRow_(r) {
  return {
    id: String(r[0]),
    email: String(r[1]).trim(),
    nome: String(r[2]).trim(),
    motivo: String(r[3]).trim(),
    obs: String(r[4]).trim(),
    status: String(r[5]).trim(),          // pendente | aprovada | reprovada
    criadoEm: r[6],
    respondidoPor: String(r[7] || '').trim(),
    respondidoEm: r[8] || '',
    obsDP: String(r[9] || '').trim()
  };
}

// Dados que o painel do diretor precisa: motivos disponíveis + solicitação pendente dele (se houver)
function getSolicitacaoInfo(token) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  const rows      = getSolicitacoesSheet_().getDataRange().getValues();
  const emailNorm = norm_(user.email);
  let pendente    = null;

  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i];
    if (norm_(r[1]) === emailNorm && norm_(r[5]) === 'pendente') { pendente = solicitacaoFromRow_(r); break; }
  }

  return { motivos: MOTIVOS_LIBERACAO, pendente: pendente, liberado: hasActiveLiberacao_(user.email) };
}

// Diretor registra o pedido; o DP é avisado por e-mail
function criarSolicitacaoLiberacao(token, motivo, obs) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  motivo = String(motivo || '').trim();
  obs    = String(obs || '').trim();
  if (MOTIVOS_LIBERACAO.indexOf(motivo) === -1) throw new Error('Selecione um motivo válido.');

  const info = getSolicitacaoInfo(token);
  if (info.pendente) throw new Error('Você já tem uma solicitação pendente aguardando resposta do DP.');
  if (info.liberado) throw new Error('Você já está com a edição liberada hoje.');

  const id = Utilities.getUuid();
  getSolicitacoesSheet_().appendRow([id, user.email, user.nome, motivo, obs, 'pendente',
                                     new Date(), '', '', '']);
  enviarEmailSolicitacaoDP_(user, motivo, obs);
  return getSolicitacaoInfo(token);
}

// Lista todas as solicitações (mais recentes primeiro) — só admins/DP
function getSolicitacoes(token) {
  requireAdmin_(token);
  const rows = getSolicitacoesSheet_().getDataRange().getValues();
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    list.push(solicitacaoFromRow_(rows[i]));
  }
  list.sort(function(a, b) {
    const pa = a.status === 'pendente' ? 0 : 1;
    const pb = b.status === 'pendente' ? 0 : 1;
    return (pa - pb) || (new Date(b.criadoEm) - new Date(a.criadoEm));
  });
  return list;
}

// DP aprova ou reprova; aprovar cria a liberação (até 23:59 de hoje) e avisa o diretor por e-mail
function responderSolicitacao(token, id, aprovar, obsDP) {
  const admin = requireAdmin_(token);
  obsDP = String(obsDP || '').trim();

  const sheet = getSolicitacoesSheet_();
  const rows  = sheet.getDataRange().getValues();
  let rowIdx  = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) { rowIdx = i; break; }
  }
  if (rowIdx === -1) throw new Error('Solicitação não encontrada.');

  const solic = solicitacaoFromRow_(rows[rowIdx]);
  if (solic.status !== 'pendente') throw new Error('Esta solicitação já foi respondida.');

  const now    = new Date();
  const status = aprovar ? 'aprovada' : 'reprovada';
  sheet.getRange(rowIdx + 1, 6).setValue(status);                                    // Status
  sheet.getRange(rowIdx + 1, 8, 1, 3).setValues([[admin.email, now, obsDP]]);       // Respondido Por | Respondido Em | Observação DP

  let expira = null;
  if (aprovar) {
    expira = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    getLiberacoesSheet_().appendRow([solic.email, admin.email, now, expira]);
  }

  enviarEmailRespostaSolicitacao_(solic, aprovar, obsDP, expira);
  return { solicitacoes: getSolicitacoes(token), liberacoes: getLiberacoes(token) };
}

// Aviso ao DP de que existe uma nova solicitação para analisar
function enviarEmailSolicitacaoDP_(user, motivo, obs) {
  try {
    const assunto = 'Nova solicitação de liberação de edição — Vale Transporte';

    const corpoTexto =
      'Olá.\n\n' +
      'Uma nova solicitação de liberação de edição do Vale Transporte foi registrada e aguarda sua análise.\n\n' +
      'Solicitante: ' + (user.nome || user.email) + ' (' + user.email + ')\n' +
      'Motivo: ' + motivo + '\n' +
      (obs ? 'Observações: ' + obs + '\n' : '') +
      '\nPara aprovar ou reprovar, acesse o Vale Transporte pelo Hub BRASAS BI e abra a aba "Liberação":\n' +
      HUB_URL + '\n\n' +
      'Equipe BRASAS BI';

    const corpoHtml =
      '<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">' +
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">' +
          '<div style="background:#0a1628;padding:26px 32px">' +
            '<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3">' +
              'Nova Solicitação de Liberação — Vale Transporte' +
            '</h1>' +
          '</div>' +
          '<div style="padding:28px 32px">' +
            '<p style="margin:0 0 22px;font-size:15px;color:#0f2035;line-height:1.6">' +
              'Uma nova solicitação de liberação de edição foi registrada e <strong>aguarda sua análise</strong>.' +
            '</p>' +
            '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:24px">' +
              '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:14px">Dados da solicitação</div>' +
              '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;width:130px;vertical-align:top">Solicitante:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + escHtml_(user.nome || user.email) + '<br><span style="font-weight:400;color:#64748b">' + escHtml_(user.email) + '</span></td>' +
                '</tr>' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;vertical-align:top">Motivo:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + escHtml_(motivo) + '</td>' +
                '</tr>' +
                (obs ?
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;vertical-align:top">Observações:</td>' +
                  '<td style="padding:6px 0;color:#0f2035">' + escHtml_(obs) + '</td>' +
                '</tr>' : '') +
              '</table>' +
            '</div>' +
            '<div style="text-align:center;margin-bottom:8px">' +
              '<a href="' + HUB_URL + '" style="display:inline-block;background:#0f2035;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">' +
                'Analisar solicitação' +
              '</a>' +
            '</div>' +
            '<p style="margin:20px 0 0;font-size:12.5px;color:#94a3b8;text-align:center">' +
              'Abra a aba "Liberação" do Vale Transporte para aprovar ou reprovar.' +
            '</p>' +
          '</div>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail(DP_EMAIL, assunto, corpoTexto, { htmlBody: corpoHtml, name: 'Vale Transporte — BRASAS BI' });
  } catch (e) {
    Logger.log('enviarEmailSolicitacaoDP_: falha ao enviar e-mail — ' + e);
  }
}

// Resposta ao diretor: aprovada (com validade até 23:59 de hoje) ou reprovada, com observação do DP
function enviarEmailRespostaSolicitacao_(solic, aprovada, obsDP, expira) {
  try {
    const pad = function(n) { return n < 10 ? '0' + n : n; };
    const fmtDT = function(d) {
      return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
        ' às ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    };
    const nome = solic.nome || findNomeByEmail_(solic.email);

    const assunto = aprovada
      ? 'Solicitação de liberação APROVADA — Vale Transporte'
      : 'Solicitação de liberação reprovada — Vale Transporte';

    const corpoTexto =
      'Olá' + (nome ? ', ' + nome.toUpperCase() : '') + '.\n\n' +
      (aprovada
        ? 'Sua solicitação de liberação de edição do Vale Transporte foi APROVADA pelo Departamento Pessoal.\n\n' +
          'ATENÇÃO: a liberação vale SOMENTE HOJE, até as 23:59 (' + fmtDT(expira) + '). Amanhã a edição já estará bloqueada novamente.\n\n'
        : 'Sua solicitação de liberação de edição do Vale Transporte foi REPROVADA pelo Departamento Pessoal.\n\n') +
      'Motivo informado por você: ' + solic.motivo + '\n' +
      (obsDP ? 'Observação do DP: ' + obsDP + '\n' : '') +
      (aprovada ? '\nAcesse pelo Hub BRASAS BI: ' + HUB_URL + '\n' : '') +
      '\nEm caso de dúvidas, entre em contato com o Departamento Pessoal (dp@brasas.com).\n\n' +
      'Equipe BRASAS BI';

    const corBarra  = aprovada ? '#15803d' : '#dc2626';
    const titulo    = aprovada ? 'Solicitação Aprovada — Vale Transporte' : 'Solicitação Reprovada — Vale Transporte';

    const corpoHtml =
      '<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">' +
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">' +
          '<div style="background:' + corBarra + ';padding:26px 32px">' +
            '<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3">' + titulo + '</h1>' +
          '</div>' +
          '<div style="padding:28px 32px">' +
            '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:22px;font-size:13px;color:#475569">' +
              '&#9888;&#65039; Este é um comunicado automático. <strong>Não responda este e-mail</strong> — em caso de dúvidas, entre em contato com o Departamento Pessoal pelo endereço <a href="mailto:dp@brasas.com" style="color:#2a4d76">dp@brasas.com</a>.' +
            '</div>' +
            '<p style="margin:0 0 14px;font-size:15px;color:#0f2035">Olá' +
              (nome ? ', <strong>' + escHtml_(nome.toUpperCase()) + '</strong>' : '') + '.</p>' +
            '<p style="margin:0 0 14px;font-size:15px;color:#0f2035;line-height:1.6">' +
              (aprovada
                ? 'Sua solicitação de liberação de edição do <strong>Vale Transporte</strong> foi <strong style="color:#15803d">APROVADA</strong> pelo Departamento Pessoal.'
                : 'Sua solicitação de liberação de edição do <strong>Vale Transporte</strong> foi <strong style="color:#dc2626">REPROVADA</strong> pelo Departamento Pessoal.') +
            '</p>' +
            (aprovada ?
            '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:14px 16px;margin-bottom:22px;font-size:14px;color:#92400e;line-height:1.5">' +
              '&#9200; A liberação vale <strong>somente hoje, até as 23:59</strong>. Amanhã a edição já estará bloqueada novamente.' +
            '</div>' : '') +
            '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:24px">' +
              '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:14px">Resumo</div>' +
              '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;width:160px;vertical-align:top">Motivo informado:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + escHtml_(solic.motivo) + '</td>' +
                '</tr>' +
                (solic.obs ?
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;vertical-align:top">Suas observações:</td>' +
                  '<td style="padding:6px 0;color:#0f2035">' + escHtml_(solic.obs) + '</td>' +
                '</tr>' : '') +
                (obsDP ?
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;vertical-align:top">Observação do DP:</td>' +
                  '<td style="padding:6px 0;color:#0f2035">' + escHtml_(obsDP) + '</td>' +
                '</tr>' : '') +
                (aprovada ?
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b">Válida até:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + fmtDT(expira) + ' (hoje)</td>' +
                '</tr>' : '') +
              '</table>' +
            '</div>' +
            (aprovada ?
            '<div style="text-align:center;margin-bottom:8px">' +
              '<a href="' + HUB_URL + '" style="display:inline-block;background:#0f2035;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">' +
                'Acessar o Vale Transporte' +
              '</a>' +
            '</div>' +
            '<p style="margin:20px 0 0;font-size:12.5px;color:#94a3b8;text-align:center">' +
              'Após as 23:59 de hoje, a edição volta a ficar bloqueada automaticamente.' +
            '</p>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail(solic.email, assunto, corpoTexto, { htmlBody: corpoHtml, name: 'Vale Transporte — BRASAS BI' });
  } catch (e) {
    Logger.log('enviarEmailRespostaSolicitacao_: falha ao enviar e-mail para ' + solic.email + ' — ' + e);
  }
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
  const dpOrAdmin   = isDpOrAdmin_(user);

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

    if (isInativo_(row[COL.ATIVO])) continue;

    const matricula = String(row[COL.MATRICULA]).trim();
    if (!matricula) continue;

    const cpf    = String(row[COL.CPF] || '').trim();
    const funcao = String(row[COL.FUNCAO]).trim().toUpperCase();
    const list   = funcao === 'PROFESSOR' ? docente : administrativo;

    // Unidade principal + secundária, sem repetir se forem iguais
    const unidades = [canonUnidade_(row[COL.UNIDADE]), canonUnidade_(row[COL.UNIDADE_SEC])]
      .filter(function(u, idx, arr) { return u && arr.indexOf(u) === idx; });

    const hasEcNew   = unidades.some(function(u) { return norm_(u) === 'ec new'; });
    const hasOther   = unidades.some(function(u) { return norm_(u) !== 'ec new'; });
    const isEcLinked = hasEcNew && hasOther;

    if (isEcLinked) {
      if (!dpOrAdmin) continue;
      unidades.filter(function(u) { return norm_(u) !== 'ec new'; })
        .forEach(function(u) {
          if (allowedNorm.indexOf(norm_(u)) === -1) return;
          list.push({ nome: nome, matricula: matricula, cpf: cpf, unidade: u });
        });
    } else {
      unidades.forEach(function(u) {
        if (allowedNorm.indexOf(norm_(u)) === -1) return;
        list.push({ nome: nome, matricula: matricula, cpf: cpf, unidade: u });
      });
    }
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
  } else {
    const headers = VT_HEADERS[name];
    // Aba ainda no layout antigo (Tipo Ida 2 ficava na coluna R; no novo é a J):
    // falha na hora, antes que qualquer leitura/gravação embaralhe as colunas.
    if (sheet.getLastRow() > 0 && String(sheet.getRange(1, 10).getValue()).trim() !== headers[9]) {
      throw new Error('A aba "' + name + '" está no layout antigo de colunas — rode reorganizarColunasVT() uma vez no editor do Apps Script antes de usar o app.');
    }
    // Completa cabeçalhos que faltem no fim (colunas adicionadas em versões novas)
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0 && lastCol < headers.length) {
      sheet.getRange(1, lastCol + 1, 1, headers.length - lastCol)
        .setValues([headers.slice(lastCol)]);
    }
  }
  return sheet;
}

// =============================================================================
// MIGRAÇÃO DE LAYOUT — rode UMA vez no editor (Executar > reorganizarColunasVT)
// após publicar a versão com a ordem nova de colunas. Reordena as colunas das
// abas ADMINISTRATIVO/DOCENTE mapeando pelo NOME do cabeçalho antigo, então
// funciona tanto para o layout original quanto para o que tinha as Qtd extras
// penduradas no fim (AE-AH). Idempotente: aba já no layout novo é pulada.
// =============================================================================
function reorganizarColunasVT() {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() === 0) { Logger.log('%s: aba inexistente/vazia — nada a fazer', name); return; }

    const data      = sheet.getDataRange().getValues();
    const oldHeader = data[0].map(function(h) { return String(h).trim(); });
    const novo      = VT_HEADERS[name];

    if (oldHeader[9] === novo[9]) { Logger.log('%s: já está no layout novo', name); return; }

    // Backup da aba dentro da própria planilha antes de qualquer alteração —
    // se algo falhar no meio, os dados originais continuam intactos na cópia.
    const carimbo = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
    sheet.copyTo(ss).setName(name + ' (backup ' + carimbo + ')');
    Logger.log('%s: backup criado na aba "%s (backup %s)"', name, name, carimbo);

    const idx = {};
    oldHeader.forEach(function(h, i) { if (h && idx[h] === undefined) idx[h] = i; });

    const out = [novo];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      out.push(novo.map(function(h) {
        const j = idx[h];
        return j === undefined ? '' : r[j]; // coluna que não existia (ex.: Qtd Ida 2) fica em branco e herda no cálculo
      }));
    }

    sheet.clearContents();
    sheet.getRange(1, 1, out.length, novo.length).setValues(out);
    sheet.setFrozenRows(1);
    Logger.log('%s: %s linha(s) reorganizadas para o layout novo', name, out.length - 1);
  });
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
  const qtdIda   = Number(e.qtdIda)   || 0;
  const qtdVolta = Number(e.qtdVolta) || 0;

  // Até 3 trechos por sentido, cada um com a SUA quantidade. Trecho extra sem
  // Qtd preenchida herda a Qtd do 1º trecho do sentido (retrocompatível com
  // linhas salvas antes das colunas Qtd Ida/Volta 2 e 3 existirem).
  function qtdTrecho(tipo, valor, qtdPropria, qtdBase) {
    if (!tipo && !(Number(valor) || 0)) return 0; // trecho não usado
    return Number(qtdPropria) || qtdBase;
  }

  const legs = [
    { tipo: e.tipoIda,    valor: e.valorIda,    qtd: qtdIda },
    { tipo: e.tipoIda2,   valor: e.valorIda2,   qtd: qtdTrecho(e.tipoIda2,   e.valorIda2,   e.qtdIda2,   qtdIda) },
    { tipo: e.tipoIda3,   valor: e.valorIda3,   qtd: qtdTrecho(e.tipoIda3,   e.valorIda3,   e.qtdIda3,   qtdIda) },
    { tipo: e.tipoVolta,  valor: e.valorVolta,  qtd: qtdVolta },
    { tipo: e.tipoVolta2, valor: e.valorVolta2, qtd: qtdTrecho(e.tipoVolta2, e.valorVolta2, e.qtdVolta2, qtdVolta) },
    { tipo: e.tipoVolta3, valor: e.valorVolta3, qtd: qtdTrecho(e.tipoVolta3, e.valorVolta3, e.qtdVolta3, qtdVolta) }
  ].map(function(l) {
    return { tipo: l.tipo, qtd: l.qtd, total: (Number(l.valor) || 0) * l.qtd };
  });

  // Unidades sem rateio (SP): não há cartão Jaé/RioCard — só o Total vale
  const semRateio = isSemRateio_(e.unidade);

  let total = 0, valorJae = 0, valorRiocard = 0;
  legs.forEach(function(l) {
    total += l.total;
    if (semRateio) return;
    const cartao = classificarCartao_(l.tipo);
    if (cartao === 'jae')     valorJae     += l.total;
    if (cartao === 'riocard') valorRiocard += l.total;
  });

  // Dias trabalhados = maior Qtd entre todos os trechos (os trechos se sobrepõem
  // nos dias — ex.: metrô em 20 dias + ônibus em 19 desses dias = 20 dias);
  // o valor diário é o custo médio do dia completo (ida + volta).
  const dias        = legs.reduce(function(m, l) { return Math.max(m, l.qtd); }, 0);
  const valorDiario = dias > 0 ? total / dias : 0;

  return { total: total, diasTrabalhados: dias, valorDiario: valorDiario, valorJae: valorJae, valorRiocard: valorRiocard };
}

// =============================================================================
// LEITURA DO VT — todas as linhas de todas as unidades permitidas, estilo planilha
// =============================================================================

// Colunas ADMINISTRATIVO/DOCENTE: Unidade|Mês|Ano|Matrícula|CPF|Nome|
//   TipoIda|ValorIda|QtdIda|TipoVolta|ValorVolta|QtdVolta|Total|DiasTrabalhados|ValorDiário|ValorJaé|ValorRioCard|
//   TipoIda2|ValorIda2|TipoVolta2|ValorVolta2|TipoIda3|ValorIda3|TipoVolta3|ValorVolta3
//   (2º e 3º trechos opcionais, no final para compatibilidade)
function getVTData(token) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida.');
  const allowedNorm  = getAllowedUnidades_(user).map(norm_);
  const ecLinkedSet  = buildEcLinkedSet_();
  const dpOrAdmin    = isDpOrAdmin_(user);

  const ss = SpreadsheetApp.openById(VT_SHEET_ID);

  function readSheet(sheetName) {
    const sheet = getOrCreateVTSheet_(ss, sheetName);
    const rows  = sheet.getDataRange().getValues();
    const out   = [];

    for (let i = 1; i < rows.length; i++) {
      const r       = rows[i];
      const unidade = canonUnidade_(r[0]);
      if (allowedNorm.indexOf(norm_(unidade)) === -1) continue;
      const mes = parseMes_(r[1]), ano = Number(r[2]);
      if (!mes || !ano) continue;
      const mat = String(r[3]).trim();
      if (norm_(unidade) !== 'ec new' && ecLinkedSet[normMat_(mat) + '|' + norm_(unidade)]) {
        if (!dpOrAdmin) continue;
      }
      out.push({
        unidade: unidade, mes: mes, ano: ano,
        matricula: mat, cpf: String(r[4]).trim(), nome: String(r[5]).trim(),
        tipoIda: String(r[6]).trim(), valorIda: r[7] || 0, qtdIda: r[8] || 0,
        tipoIda2: String(r[9] || '').trim(), valorIda2: r[10] || 0, qtdIda2: r[11] || 0,
        tipoIda3: String(r[12] || '').trim(), valorIda3: r[13] || 0, qtdIda3: r[14] || 0,
        tipoVolta: String(r[15]).trim(), valorVolta: r[16] || 0, qtdVolta: r[17] || 0,
        tipoVolta2: String(r[18] || '').trim(), valorVolta2: r[19] || 0, qtdVolta2: r[20] || 0,
        tipoVolta3: String(r[21] || '').trim(), valorVolta3: r[22] || 0, qtdVolta3: r[23] || 0,
        total: r[24] || 0, diasTrabalhados: r[25] || 0, valorDiario: r[26] || 0,
        valorJae: r[27] || 0, valorRiocard: r[28] || 0,
        editadoEm: fmtDataHora_(r[29]), editadoPor: String(r[30] || '').trim(),
        comentario: String(r[31] || '').trim(),
        comentadoEm: fmtDataHora_(r[32]), comentadoPor: String(r[33] || '').trim(),
        camposEditadosLiberacao: String(r[34] || '').trim()
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
  // Passa o token para que uma liberação ativa do usuário destrave o salvamento
  const period = getCurrentPeriod(payload.token);
  if (period.locked) throw new Error('O período está bloqueado. Prazo encerrado no dia 11.');

  const user = getSessionUser_(payload.token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  // Salvamento só está acontecendo porque uma liberação temporária destravou o
  // período (já vencido no dia 11) — usado para marcar, campo a campo, o que foi
  // alterado fora do prazo normal.
  const forcedByLiberacao = new Date().getDate() > 11 && hasActiveLiberacao_(user.email);

  const ss           = SpreadsheetApp.openById(VT_SHEET_ID);
  const adminSheet   = getOrCreateVTSheet_(ss, 'ADMINISTRATIVO');
  const docenteSheet = getOrCreateVTSheet_(ss, 'DOCENTE');

  // Nunca confia na unidade vinda do cliente sem checar permissão; normaliza NS→CH, MRI→MR
  // antes de checar/gravar, pra planilha sempre guardar o código canônico.
  const adminEntries   = (payload.administrativo || [])
    .map(function(e) { e.unidade = canonUnidade_(e.unidade); return e; })
    .filter(function(e) { return isUserAllowedUnit_(user, e.unidade); });
  const docenteEntries = (payload.docente || [])
    .map(function(e) { e.unidade = canonUnidade_(e.unidade); return e; })
    .filter(function(e) { return isUserAllowedUnit_(user, e.unidade); });

  // Ordem espelha as colunas G-AC da aba: trechos de ida (G-O), trechos de volta
  // (P-X), calculados (Y-AC). Grava a Qtd EFETIVA de trecho extra: sem Qtd
  // digitada herda a do 1º trecho do sentido; trecho não usado fica 0.
  function qtdEfetiva_(tipo, valor, qtdPropria, qtdBase) {
    if (!tipo && !(Number(valor) || 0)) return 0;
    return Number(qtdPropria) || Number(qtdBase) || 0;
  }

  function valuesFn(e) {
    const calc = calcularVT_(e);
    return [
      e.tipoIda || '', Number(e.valorIda) || 0, Number(e.qtdIda) || 0,
      e.tipoIda2 || '', Number(e.valorIda2) || 0, qtdEfetiva_(e.tipoIda2, e.valorIda2, e.qtdIda2, e.qtdIda),
      e.tipoIda3 || '', Number(e.valorIda3) || 0, qtdEfetiva_(e.tipoIda3, e.valorIda3, e.qtdIda3, e.qtdIda),
      e.tipoVolta || '', Number(e.valorVolta) || 0, Number(e.qtdVolta) || 0,
      e.tipoVolta2 || '', Number(e.valorVolta2) || 0, qtdEfetiva_(e.tipoVolta2, e.valorVolta2, e.qtdVolta2, e.qtdVolta),
      e.tipoVolta3 || '', Number(e.valorVolta3) || 0, qtdEfetiva_(e.tipoVolta3, e.valorVolta3, e.qtdVolta3, e.qtdVolta),
      calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard
    ];
  }

  _upsertRows_(adminSheet, adminEntries, valuesFn, user.email, forcedByLiberacao);
  _upsertRows_(docenteSheet, docenteEntries, valuesFn, user.email, forcedByLiberacao);

  return { success: true };
}

// =============================================================================
// COMENTÁRIOS — uma anotação por lançamento (unidade+mês+ano+matrícula), visível
// tanto pro diretor quanto pro DP (ambos usam a mesma tela). Não é um campo de VT:
// pode ser preenchido mesmo com o período bloqueado, e não altera Total/cálculos.
// =============================================================================

function salvarComentarioVT(payload) {
  const user = getSessionUser_(payload.token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  const unidade = canonUnidade_(payload.unidade);
  if (!isUserAllowedUnit_(user, unidade)) throw new Error('Você não tem permissão para esta unidade.');

  const sheetName = payload.categoria === 'docente' ? 'DOCENTE' : 'ADMINISTRATIVO';
  const mat        = String(payload.matricula || '').trim();
  const mes        = Number(payload.mes), ano = Number(payload.ano);
  const comentario = String(payload.comentario || '').trim();
  const key = norm_(unidade) + '|' + mes + '|' + ano + '|' + mat;

  const ss      = SpreadsheetApp.openById(VT_SHEET_ID);
  const sheet   = getOrCreateVTSheet_(ss, sheetName);
  const allRows = sheet.getDataRange().getValues();

  let rowIdx = 0;
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    const k = norm_(canonUnidade_(r[0])) + '|' + parseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim();
    if (k === key) { rowIdx = i + 1; break; }
  }
  if (!rowIdx) throw new Error('Lançamento não encontrado — salve os dados antes de comentar.');

  const comCol1 = VT_HEADERS[sheetName].indexOf('Comentário') + 1; // 1-based
  const agora = comentario ? new Date() : '';
  const autor = comentario ? (user.email || '') : '';
  sheet.getRange(rowIdx, comCol1, 1, 3).setValues([[comentario, agora, autor]]);

  return { success: true, comentario: comentario, comentadoEm: fmtDataHora_(agora), comentadoPor: autor };
}

// Um valor "já lançado" (número ≠ 0 ou texto não vazio) mudou? Preencher um campo
// vazio/zerado conta como lançamento normal, não como edição.
function _valMudou_(antigo, novo) {
  if (typeof novo === 'number') {
    const a = Number(antigo) || 0;
    return a !== 0 && Math.abs(a - novo) > 0.005; // tolerância para ruído de ponto flutuante
  }
  const a = String(antigo === null || antigo === undefined ? '' : antigo).trim();
  return a !== '' && a !== String(novo === null || novo === undefined ? '' : novo).trim();
}

// Atualiza a linha existente (unidade+mes+ano+matricula) ou cria uma nova, para cada item.
// Identidade (Unidade..CPF..Nome) ocupa as colunas A-F; os valores calculados começam na G.
// Quando um valor já lançado é alterado, grava quem editou e quando nas duas colunas
// após os valores (AD/AE — cabeçalhos garantidos por getOrCreateVTSheet_/VT_HEADERS).
// Se a edição só foi possível por uma liberação concedida após o dia 11, grava também
// quais campos específicos de trecho mudaram (coluna "Campos Editados (Liberação)"),
// pra sinalizar com asterisco no front-end; edição normal dentro do prazo limpa essa coluna.
function _upsertRows_(sheet, entries, valuesFn, editorEmail, forcedByLiberacao) {
  if (!entries || !entries.length) return;

  const camposCol1 = VT_HEADERS[sheet.getName()].indexOf('Campos Editados (Liberação)') + 1;

  const allRows = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    map[norm_(canonUnidade_(r[0])) + '|' + parseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim()] = i + 1;
  }

  entries.forEach(function(e) {
    const mat    = String(e.matricula).trim();
    const key    = norm_(e.unidade) + '|' + Number(e.mes) + '|' + Number(e.ano) + '|' + mat;
    const values = valuesFn(e);
    if (map[key]) {
      const rowIdx = map[key];
      // Compara com o que estava na planilha ANTES deste salvamento (linhas recém-criadas
      // neste mesmo save não entram na comparação)
      if (rowIdx <= allRows.length) {
        const oldVals = allRows[rowIdx - 1].slice(6, 6 + values.length);
        const editou  = values.some(function(v, j) { return _valMudou_(oldVals[j], v); });
        if (editou) {
          sheet.getRange(rowIdx, 7 + values.length, 1, 2).setValues([[new Date(), editorEmail || '']]);
          if (camposCol1) {
            const camposAlterados = forcedByLiberacao
              ? VT_CAMPOS_TRECHO_.filter(function(campo, j) { return _valMudou_(oldVals[j], values[j]); }).join(',')
              : '';
            sheet.getRange(rowIdx, camposCol1).setValue(camposAlterados);
          }
        }
      }
      sheet.getRange(rowIdx, 7, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow([e.unidade, mesLabel_(e.mes), e.ano, mat, e.cpf || '', e.nome].concat(values));
      map[key] = sheet.getLastRow();
    }
  });
}

// =============================================================================
// MANUTENÇÃO — rode manualmente no editor do Apps Script (Executar > recalcularTudo)
// para recalcular Total/Dias/Valor Diário/Jaé/RioCard de TODAS as linhas já salvas
// com a fórmula vigente (ex.: após a correção Dias Trabalhados = max(ida, volta)).
// =============================================================================

function recalcularTudo() {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(name) {
    const sheet = getOrCreateVTSheet_(ss, name);
    const rows  = sheet.getDataRange().getValues();
    if (rows.length < 2) return;

    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const calc = calcularVT_({
        unidade: r[0],
        tipoIda: r[6], valorIda: r[7], qtdIda: r[8],
        tipoIda2: r[9], valorIda2: r[10], qtdIda2: r[11],
        tipoIda3: r[12], valorIda3: r[13], qtdIda3: r[14],
        tipoVolta: r[15], valorVolta: r[16], qtdVolta: r[17],
        tipoVolta2: r[18], valorVolta2: r[19], qtdVolta2: r[20],
        tipoVolta3: r[21], valorVolta3: r[22], qtdVolta3: r[23]
      });
      out.push([calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard]);
    }
    sheet.getRange(2, 25, out.length, 5).setValues(out); // colunas Y-AC (calculadas)
  });
}

// Índices (0-based) das 6 colunas de Qtd — Ida/Ida2/Ida3/Volta/Volta2/Volta3
const QTD_COLS_ = [8, 11, 14, 17, 20, 23];

// Compara os valores calculados (Total/Dias/Valor Diário/Jaé/RioCard) com o que
// está gravado em cada linha, SEM sobrescrever nada — só loga divergências pra
// conferir antes de decidir rodar recalcularTudo(). Rode no editor (Ctrl+Enter).
function diagnosticoRecalculoVT() {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  let divergencias = 0;

  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(name) {
    const sheet = getOrCreateVTSheet_(ss, name);
    const rows  = sheet.getDataRange().getValues();

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const calc = calcularVT_({
        unidade: r[0],
        tipoIda: r[6], valorIda: r[7], qtdIda: r[8],
        tipoIda2: r[9], valorIda2: r[10], qtdIda2: r[11],
        tipoIda3: r[12], valorIda3: r[13], qtdIda3: r[14],
        tipoVolta: r[15], valorVolta: r[16], qtdVolta: r[17],
        tipoVolta2: r[18], valorVolta2: r[19], qtdVolta2: r[20],
        tipoVolta3: r[21], valorVolta3: r[22], qtdVolta3: r[23]
      });

      const campos = [
        ['Total', r[24], calc.total],
        ['Dias Trabalhados', r[25], calc.diasTrabalhados],
        ['Valor Diário', r[26], calc.valorDiario],
        ['Valor Jaé', r[27], calc.valorJae],
        ['Valor RioCard', r[28], calc.valorRiocard]
      ];

      campos.forEach(function(c) {
        const atual = Number(c[1]) || 0, esperado = Number(c[2]) || 0;
        if (Math.abs(atual - esperado) > 0.01) {
          divergencias++;
          Logger.log('%s linha %s (unidade=%s mat=%s mes=%s/%s): %s gravado=%s esperado=%s',
            name, i + 2, r[0], r[3], r[1], r[2], c[0], atual, esperado);
        }
      });
    }
  });

  Logger.log('\n=== TOTAL: %s divergência(s) encontrada(s) ===', divergencias);
  Logger.log(divergencias
    ? 'Confira os casos acima; se estiverem certos, rode recalcularTudo() para gravar os valores corretos.'
    : 'Nenhuma divergência — todos os somatórios batem com a fórmula vigente.');
}

// =============================================================================
// LIMPEZA — remove lançamentos com todas as Qtd (Ida/Ida2/Ida3/Volta/Volta2/Volta3)
// zeradas ou em branco: são linhas sem nenhum trecho de fato preenchido. Rode
// manualmente no editor (Ctrl+Enter) e confira o log antes de aceitar o resultado.
// =============================================================================

function apagarLinhasZeradasVT() {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  let totalApagadas = 0;

  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(name) {
    const sheet = getOrCreateVTSheet_(ss, name);
    const rows  = sheet.getDataRange().getValues();

    // De baixo pra cima, pra deleteRow não bagunçar os índices das linhas seguintes
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i];
      const todasZeradas = QTD_COLS_.every(function(c) { return !(Number(r[c]) || 0); });
      if (todasZeradas) {
        Logger.log('%s linha %s apagada: unidade=%s mat=%s nome=%s mes=%s/%s',
          name, i + 2, r[0], r[3], r[5], r[1], r[2]);
        sheet.deleteRow(i + 1);
        totalApagadas++;
      }
    }
  });

  Logger.log('\n=== TOTAL: %s linha(s) apagada(s) ===', totalApagadas);
}

// =============================================================================
// EXCLUSÃO DE LANÇAMENTO — remove a linha (unidade+mes+ano+matricula) da aba.
// Só permite excluir lançamentos do período vigente (Previsto).
// =============================================================================

function deleteVTEntry(payload) {
  const user = getSessionUser_(payload.token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');
  payload.unidade = canonUnidade_(payload.unidade);
  if (!isUserAllowedUnit_(user, payload.unidade)) throw new Error('Você não tem permissão para esta unidade.');

  const period = getCurrentPeriod(payload.token);
  if (period.locked) throw new Error('O período está bloqueado. Prazo encerrado no dia 11.');
  if (Number(payload.mes) !== period.previsto.mes || Number(payload.ano) !== period.previsto.ano) {
    throw new Error('Só é possível excluir lançamentos do período vigente.');
  }

  const sheetName = payload.categoria === 'docente' ? 'DOCENTE' : 'ADMINISTRATIVO';
  const ss    = SpreadsheetApp.openById(VT_SHEET_ID);
  const sheet = getOrCreateVTSheet_(ss, sheetName);

  const key  = norm_(payload.unidade) + '|' + Number(payload.mes) + '|' + Number(payload.ano) + '|' + String(payload.matricula).trim();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const k = norm_(canonUnidade_(r[0])) + '|' + parseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim();
    if (k === key) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  // Linha não encontrada na planilha (provavelmente nunca foi salva) — nada a fazer
  return { success: true };
}

// =============================================================================
// LEMBRETES DE PREENCHIMENTO DO VT — gatilhos mensais (dias 1, 5, 9 e 11)
// =============================================================================
// Dia 1 : aviso de abertura do período, para todas as unidades (incondicional)
// Dia 5, 9 e 11: lembrete só para quem ainda não preencheu o mês Previsto;
//                dia 11 avisa que é o último dia antes do bloqueio automático.
// Unidades em UNIDADES_SEM_RATEIO (hoje só VO) ficam fora — fora do escopo v1.

// Lista fixa de e-mail do diretor por unidade (mesma usada no VR — passada
// manualmente pela Adriane, mais confiável que derivar da planilha do Hub).
// Observação: o cadastro do Hub usa "NS" e "MRI", mas os lançamentos de
// VR/VT usam "CH" e "MR" — por isso o mapeamento já usa os códigos da planilha.
const DIRETORES_UNIDADE = {
  'bf':     ['dirbf@brasas.com'],
  'bg':     ['dirbg@brasas.com'],
  'cg':     ['dircg@brasas.com'],
  'ch':     ['dirch@brasas.com'],  // cadastrado como "NS" no Hub
  'cp':     ['dircp@brasas.com'],
  'cx':     ['dircx@brasas.com'],
  'dt':     ['dirdt@brasas.com'],
  'fg':     ['dirfg@brasas.com'],
  'ig':     ['marcelo.ig@brasas.com'],
  'ip':     ['dirip@brasas.com'],
  'it':     ['dirit@brasas.com'],
  'lj':     ['dirlj@brasas.com'],
  'mr':     ['dirmr@brasas.com'],  // cadastrado como "MRI" no Hub
  'ni':     ['dirni@brasas.com'],
  'nl':     ['dirnl@brasas.com'],
  'nt':     ['dirnt@brasas.com'],
  'pc':     ['dirpc@brasas.com'],
  'po':     ['dirpo@brasas.com'],
  'rc':     ['dirrc@brasas.com'],
  'tj':     ['dirtj@brasas.com'],
  'tq':     ['dirtq@brasas.com'],
  'vp':     ['dirvp@brasas.com'],
  'vq':     ['dirvq@brasas.com'],
  'pn':     ['dirpn@brasas.com'],
  'online': ['natasha@brasas.com'],
  'bod':    ['pat@brasas.com'],
  'gr':     ['dirgr@brasas.com'],
  'vo':     ['dirvo@brasas.com']
};

// Calcula o mês/ano "Previsto" (mês seguinte ao atual) a partir de hoje —
// mesma regra de getCurrentPeriod, mas sem depender de sessão/token.
function getPeriodoPrevistoAtual_() {
  const now = new Date();
  let mes = now.getMonth() + 2; // mês atual (1-based) + 1
  let ano = now.getFullYear();
  if (mes > 12) { mes -= 12; ano++; }
  return { mes: mes, ano: ano };
}

// Retorna o mapa unidade -> [e-mails de diretor]. Unidades fora de
// DIRETORES_UNIDADE (ex.: EDITORA, EC NEW, MÉTODOS) não têm e-mail cadastrado
// e são puladas pelo restante do fluxo de lembretes.
function getMapaDiretoresPorUnidade_() {
  return DIRETORES_UNIDADE;
}

// Unidades que têm ao menos um funcionário ativo cadastrado (mesma fonte
// usada no resto do app: aba "RJ - UNIDADES", coluna Unidade Ajustada).
// VO entra normalmente aqui — ela já preenche VT, só não tem divisão Jaé/RioCard
// (isso é tratado à parte em calcularVT_ via UNIDADES_SEM_RATEIO).
function getUnidadesAtivas_() {
  const sheet = SpreadsheetApp.openById(FUNC_SHEET_ID).getSheetByName('RJ - UNIDADES');
  if (!sheet) throw new Error('Aba "RJ - UNIDADES" não encontrada.');
  const rows = sheet.getDataRange().getValues();

  const set = {};
  for (let i = 1; i < rows.length; i++) {
    const nome = String(rows[i][COL.NOME] || '').trim();
    if (!nome) continue;
    if (isInativo_(rows[i][COL.ATIVO])) continue;
    const u = canonUnidade_(rows[i][COL.UNIDADE]);
    if (u) set[u] = true;
  }
  return Object.keys(set);
}

// Unidades que já têm ao menos um lançamento salvo para o mês/ano informado
// (em ADMINISTRATIVO ou DOCENTE) — usado para saber quem ainda falta preencher.
function getUnidadesPreenchidas_(mes, ano) {
  const ss = SpreadsheetApp.openById(VT_SHEET_ID);
  const preenchidas = {};

  ['ADMINISTRATIVO', 'DOCENTE'].forEach(function(sheetName) {
    const sheet = getOrCreateVTSheet_(ss, sheetName);
    const rows  = sheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (parseMes_(r[1]) === mes && Number(r[2]) === ano) {
        const u = canonUnidade_(r[0]);
        if (u) preenchidas[norm_(u)] = true;
      }
    }
  });

  return preenchidas;
}

// Ponto de entrada dos gatilhos — dia: 1 (abertura), 5, 9 ou 11 (último dia)
function verificarEEnviarLembretesVT_(dia) {
  const periodo      = getPeriodoPrevistoAtual_();
  const mesLabel      = mesLabel_(periodo.mes);
  const diretores     = getMapaDiretoresPorUnidade_();
  const unidades      = getUnidadesAtivas_();
  const preenchidas   = dia === 1 ? {} : getUnidadesPreenchidas_(periodo.mes, periodo.ano);

  unidades.forEach(function(unidade) {
    const key = norm_(unidade);
    if (dia !== 1 && preenchidas[key]) return; // já preencheu — não incomoda mais

    const emails = diretores[key];
    if (!emails || !emails.length) return; // sem e-mail de diretor cadastrado — pula

    enviarEmailLembreteVT_(emails, unidade, mesLabel, dia);
  });
}

// Monta e envia o e-mail de abertura/lembrete para uma unidade
function enviarEmailLembreteVT_(emails, unidade, mesLabel, dia) {
  try {
    const destinatarios = emails.join(',');

    let assunto, tituloBarra, corBarra, mensagemPrincipal, avisoDestaque;

    if (dia === 1) {
      assunto = 'Preenchimento do Vale Transporte está aberto — ' + unidade;
      tituloBarra = 'Preenchimento do Vale Transporte — Período Aberto';
      corBarra = '#0a1628';
      mensagemPrincipal = 'O período para preenchimento do <strong>Vale Transporte</strong> de <strong>' + escHtml_(mesLabel) + '</strong> está aberto.';
      avisoDestaque = 'Prazo final para preencher: <strong>dia 11</strong>. Após essa data, a edição é bloqueada automaticamente.';
    } else if (dia === 5) {
      assunto = 'Lembrete: Vale Transporte ainda não preenchido — ' + unidade;
      tituloBarra = 'Lembrete — Vale Transporte Pendente';
      corBarra = '#b45309';
      mensagemPrincipal = 'Identificamos que o <strong>Vale Transporte</strong> de <strong>' + escHtml_(mesLabel) + '</strong> da sua unidade ainda não foi preenchido.';
      avisoDestaque = 'Prazo final para preencher: <strong>dia 11</strong>. Após essa data, a edição é bloqueada automaticamente.';
    } else if (dia === 9) {
      assunto = '2º lembrete: Vale Transporte ainda não preenchido — ' + unidade;
      tituloBarra = '2º Lembrete — Vale Transporte Pendente';
      corBarra = '#c2410c';
      mensagemPrincipal = 'O <strong>Vale Transporte</strong> de <strong>' + escHtml_(mesLabel) + '</strong> da sua unidade ainda não foi preenchido.';
      avisoDestaque = 'Restam poucos dias! Prazo final: <strong>dia 11</strong>. Após essa data, a edição é bloqueada automaticamente.';
    } else { // dia 11
      assunto = 'ÚLTIMO DIA para preencher o Vale Transporte — ' + unidade;
      tituloBarra = 'Último Dia — Vale Transporte Pendente';
      corBarra = '#dc2626';
      mensagemPrincipal = 'Hoje é o <strong>último dia</strong> para preencher o <strong>Vale Transporte</strong> de <strong>' + escHtml_(mesLabel) + '</strong> da sua unidade.';
      avisoDestaque = 'Após hoje (23:59), a edição será bloqueada automaticamente e só poderá ser liberada mediante solicitação ao Departamento Pessoal.';
    }

    const corpoTexto =
      'Olá.\n\n' +
      mensagemPrincipal.replace(/<\/?strong>/g, '') + '\n\n' +
      avisoDestaque.replace(/<\/?strong>/g, '') + '\n\n' +
      'Unidade: ' + unidade + '\n' +
      'Mês de referência: ' + mesLabel + '\n\n' +
      'Acesse pelo Hub BRASAS BI: ' + HUB_URL + '\n\n' +
      'Equipe BRASAS BI';

    const corpoHtml =
      '<div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">' +
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">' +
          '<div style="background:' + corBarra + ';padding:26px 32px">' +
            '<h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3">' + tituloBarra + '</h1>' +
          '</div>' +
          '<div style="padding:28px 32px">' +
            '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:22px;font-size:13px;color:#475569">' +
              '&#9888;&#65039; Este é um comunicado automático. <strong>Não responda este e-mail</strong> — em caso de dúvidas, entre em contato com o Departamento Pessoal pelo endereço <a href="mailto:dp@brasas.com" style="color:#2a4d76">dp@brasas.com</a>.' +
            '</div>' +
            '<p style="margin:0 0 14px;font-size:15px;color:#0f2035;line-height:1.6">' + mensagemPrincipal + '</p>' +
            '<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:14px 16px;margin-bottom:22px;font-size:14px;color:#92400e;line-height:1.5">' +
              '&#9200; ' + avisoDestaque +
            '</div>' +
            '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px;margin-bottom:24px">' +
              '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:14px">Dados do lançamento</div>' +
              '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b;width:150px">Unidade:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + escHtml_(unidade) + '</td>' +
                '</tr>' +
                '<tr>' +
                  '<td style="padding:6px 0;color:#64748b">Mês de referência:</td>' +
                  '<td style="padding:6px 0;color:#0f2035;font-weight:600">' + escHtml_(mesLabel) + '</td>' +
                '</tr>' +
              '</table>' +
            '</div>' +
            '<div style="text-align:center;margin-bottom:8px">' +
              '<a href="' + HUB_URL + '" style="display:inline-block;background:#0f2035;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px">' +
                'Preencher o Vale Transporte' +
              '</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    MailApp.sendEmail(destinatarios, assunto, corpoTexto, { htmlBody: corpoHtml, name: 'Vale Transporte — BRASAS BI' });
  } catch (e) {
    Logger.log('enviarEmailLembreteVT_: falha ao enviar para ' + emails + ' (unidade ' + unidade + ') — ' + e);
  }
}

// Funções chamadas pelos gatilhos instalados (uma para cada dia)
function lembreteVTDia1()  { verificarEEnviarLembretesVT_(1); }
function lembreteVTDia5()  { verificarEEnviarLembretesVT_(5); }
function lembreteVTDia9()  { verificarEEnviarLembretesVT_(9); }
function lembreteVTDia11() { verificarEEnviarLembretesVT_(11); }

// Roda ISSO UMA VEZ no editor do Apps Script (Ctrl+Enter) para instalar os
// 4 gatilhos mensais. Pode rodar de novo com segurança — remove os antigos antes.
function instalarGatilhosLembreteVT() {
  const handlers = ['lembreteVTDia1', 'lembreteVTDia5', 'lembreteVTDia9', 'lembreteVTDia11'];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('lembreteVTDia1').timeBased().onMonthDay(1).atHour(8).create();
  ScriptApp.newTrigger('lembreteVTDia5').timeBased().onMonthDay(5).atHour(8).create();
  ScriptApp.newTrigger('lembreteVTDia9').timeBased().onMonthDay(9).atHour(8).create();
  ScriptApp.newTrigger('lembreteVTDia11').timeBased().onMonthDay(11).atHour(8).create();

  Logger.log('Gatilhos de lembrete do VT instalados com sucesso.');
}

// Simula um lembrete SEM enviar e-mails — só loga quem receberia e por quê.
// Rode no editor (Ctrl+Enter), ajustando "dia" abaixo, para validar antes de
// instalar os gatilhos de verdade.
function diagnosticoLembretesVT() {
  const dia = 5; // ajuste para 1, 5, 9 ou 11 antes de rodar

  const periodo    = getPeriodoPrevistoAtual_();
  const mesLabel    = mesLabel_(periodo.mes);
  const diretores   = getMapaDiretoresPorUnidade_();
  const unidades    = getUnidadesAtivas_();
  const preenchidas = dia === 1 ? {} : getUnidadesPreenchidas_(periodo.mes, periodo.ano);

  Logger.log('=== SIMULAÇÃO — dia %s | mês previsto: %s/%s ===', dia, mesLabel, periodo.ano);
  unidades.forEach(function(unidade) {
    const key = norm_(unidade);
    const emails = diretores[key] || [];
    if (dia !== 1 && preenchidas[key]) {
      Logger.log('%s → já preenchida, não envia', unidade);
    } else if (!emails.length) {
      Logger.log('%s → SEM e-mail de diretor cadastrado, pula', unidade);
    } else {
      Logger.log('%s → enviaria para: %s', unidade, emails.join(', '));
    }
  });
}

// =============================================================================
// EXPORTAÇÃO PARA GOOGLE SHEETS — cria uma planilha nova só com as linhas que o
// diretor já filtrou no navegador (mesmo conjunto de dados do "Exportar CSV";
// o Index.html manda o header + as linhas já filtradas, prontas para gravar).
// =============================================================================

function exportFilteredToSheet(token, payload) {
  const user = getSessionUser_(token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');

  const header = (payload && payload.header) || [];
  const rowsIn = (payload && payload.rows) || [];
  if (!header.length) throw new Error('Nada para exportar.');
  if (rowsIn.length > 5000) throw new Error('Muitos registros para exportar de uma vez.');

  // Garante retângulo perfeito (mesma largura do header) mesmo se alguma linha vier truncada
  const rows = rowsIn.map(function(r) {
    r = r || [];
    const out = new Array(header.length);
    for (let i = 0; i < header.length; i++) out[i] = (r[i] === undefined || r[i] === null) ? '' : r[i];
    return out;
  });

  const titleBase = String((payload && payload.title) || 'Exportação').slice(0, 80);
  const carimbo   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MM-yyyy HH:mm');
  const ss        = SpreadsheetApp.create(titleBase + ' — ' + carimbo);
  const sheet     = ss.getSheets()[0];

  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);

  // A planilha nasce na conta que executa o script; sem isso o diretor não a veria
  try { ss.addEditor(user.email); } catch (e) { Logger.log('exportFilteredToSheet addEditor: ' + e); }

  return ss.getUrl();
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
