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
// As colunas do 2º trecho (R-U) e do 3º trecho (V-Y) ficam no FINAL para não deslocar
// as colunas das linhas já salvas; os trechos extras usam a mesma Qtd do 1º (quantidade é por sentido).
const VT_HEADERS = {
  ADMINISTRATIVO: ['Unidade','Mês','Ano','Matrícula','CPF','Administrativo','Tipo Ida','Valor Ida','Qtd Ida','Tipo Volta','Valor Volta','Qtd Volta','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Tipo Ida 2','Valor Ida 2','Tipo Volta 2','Valor Volta 2','Tipo Ida 3','Valor Ida 3','Tipo Volta 3','Valor Volta 3'],
  DOCENTE:        ['Unidade','Mês','Ano','Matrícula','CPF','Docente','Tipo Ida','Valor Ida','Qtd Ida','Tipo Volta','Valor Volta','Qtd Volta','Total','Dias Trabalhados','Valor Diário','Valor Total Jaé','Valor Total RioCard','Tipo Ida 2','Valor Ida 2','Tipo Volta 2','Valor Volta 2','Tipo Ida 3','Valor Ida 3','Tipo Volta 3','Valor Volta 3']
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

// Padrão de escrita do mês na planilha: "06 Junho", "07 Julho"...
const MESES_LABEL = ['01 Janeiro', '02 Fevereiro', '03 Março', '04 Abril', '05 Maio', '06 Junho',
                     '07 Julho', '08 Agosto', '09 Setembro', '10 Outubro', '11 Novembro', '12 Dezembro'];

function mesLabel_(m) {
  const n = parseMes_(m);
  return MESES_LABEL[n - 1] || String(m);
}

// Coluna ATIVO (K) guarda o texto "Ativo"/"Inativo" (às vezes true/false, sim/não)
function isInativo_(v) {
  const n = norm_(v);
  return n === 'inativo' || n === 'inactive' || n === 'false' || n === 'nao' || n === 'no' || n === '0';
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

  // Liberação temporária (válida até 23:59 do dia da concessão) ignora o bloqueio para esse usuário
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
  } else {
    // Abas criadas antes dos trechos extras não têm as colunas R-Y — completa os cabeçalhos que faltam
    const headers = VT_HEADERS[name];
    const lastCol = sheet.getLastColumn();
    if (lastCol > 0 && lastCol < headers.length) {
      sheet.getRange(1, lastCol + 1, 1, headers.length - lastCol)
        .setValues([headers.slice(lastCol)]);
    }
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
  const qtdIda   = Number(e.qtdIda)   || 0;
  const qtdVolta = Number(e.qtdVolta) || 0;

  // Até 3 trechos por sentido; os trechos extras usam a MESMA quantidade do 1º
  // (a Qtd é por sentido), então eles somam no total mas não nos dias.
  const legs = [
    { tipo: e.tipoIda,    total: (Number(e.valorIda)    || 0) * qtdIda },
    { tipo: e.tipoIda2,   total: (Number(e.valorIda2)   || 0) * qtdIda },
    { tipo: e.tipoIda3,   total: (Number(e.valorIda3)   || 0) * qtdIda },
    { tipo: e.tipoVolta,  total: (Number(e.valorVolta)  || 0) * qtdVolta },
    { tipo: e.tipoVolta2, total: (Number(e.valorVolta2) || 0) * qtdVolta },
    { tipo: e.tipoVolta3, total: (Number(e.valorVolta3) || 0) * qtdVolta }
  ];

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

  // Dias trabalhados = dias do mês (ida e volta acontecem no mesmo dia),
  // então usa a maior Qtd; o valor diário é o custo do dia completo (ida + volta).
  const dias        = Math.max(qtdIda, qtdVolta);
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
        valorJae: r[15] || 0, valorRiocard: r[16] || 0,
        tipoIda2: String(r[17] || '').trim(), valorIda2: r[18] || 0,
        tipoVolta2: String(r[19] || '').trim(), valorVolta2: r[20] || 0,
        tipoIda3: String(r[21] || '').trim(), valorIda3: r[22] || 0,
        tipoVolta3: String(r[23] || '').trim(), valorVolta3: r[24] || 0
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

  const ss           = SpreadsheetApp.openById(VT_SHEET_ID);
  const adminSheet   = getOrCreateVTSheet_(ss, 'ADMINISTRATIVO');
  const docenteSheet = getOrCreateVTSheet_(ss, 'DOCENTE');

  // Nunca confia na unidade vinda do cliente sem checar permissão
  const adminEntries   = (payload.administrativo || []).filter(function(e) { return isUserAllowedUnit_(user, e.unidade); });
  const docenteEntries = (payload.docente        || []).filter(function(e) { return isUserAllowedUnit_(user, e.unidade); });

  // Ordem espelha as colunas G-Y da aba: trecho 1 (G-L), calculados (M-Q), trecho 2 (R-U), trecho 3 (V-Y)
  function valuesFn(e) {
    const calc = calcularVT_(e);
    return [
      e.tipoIda || '', Number(e.valorIda) || 0, Number(e.qtdIda) || 0,
      e.tipoVolta || '', Number(e.valorVolta) || 0, Number(e.qtdVolta) || 0,
      calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard,
      e.tipoIda2 || '', Number(e.valorIda2) || 0,
      e.tipoVolta2 || '', Number(e.valorVolta2) || 0,
      e.tipoIda3 || '', Number(e.valorIda3) || 0,
      e.tipoVolta3 || '', Number(e.valorVolta3) || 0
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
        tipoVolta: r[9], valorVolta: r[10], qtdVolta: r[11],
        tipoIda2: r[17], valorIda2: r[18], tipoVolta2: r[19], valorVolta2: r[20],
        tipoIda3: r[21], valorIda3: r[22], tipoVolta3: r[23], valorVolta3: r[24]
      });
      out.push([calc.total, calc.diasTrabalhados, calc.valorDiario, calc.valorJae, calc.valorRiocard]);
    }
    sheet.getRange(2, 13, out.length, 5).setValues(out); // colunas M-Q (calculadas)
  });
}

// =============================================================================
// EXCLUSÃO DE LANÇAMENTO — remove a linha (unidade+mes+ano+matricula) da aba.
// Só permite excluir lançamentos do período vigente (Previsto).
// =============================================================================

function deleteVTEntry(payload) {
  const user = getSessionUser_(payload.token);
  if (!user) throw new Error('Sessão inválida ou expirada. Acesse novamente pelo Hub.');
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
    const k = norm_(r[0]) + '|' + parseMes_(r[1]) + '|' + Number(r[2]) + '|' + String(r[3]).trim();
    if (k === key) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }

  // Linha não encontrada na planilha (provavelmente nunca foi salva) — nada a fazer
  return { success: true };
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
