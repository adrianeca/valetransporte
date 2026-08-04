# Vale Transporte — BRASAS BI

Webapp em Google Apps Script para diretores de unidade lançarem o Vale Transporte (VT) mensal dos colaboradores, substituindo as ~20 planilhas por unidade que existiam antes. Roda embutido como card no Hub BRASAS BI (autenticação por token de sessão).

Repositório: `adrianeca/valetransporte`. Irmão do webapp de VR (`adrianeca/valerefeicao`, pasta `VR webapp` no mesmo Desktop/Claude) — os dois compartilham o mesmo padrão de arquitetura e boa parte do código é espelhado entre os dois.

## Arquivos

- `Code.gs` — todo o backend (Apps Script / `google.script.run`)
- `Index.html` — front-end single-page (HTML+CSS+JS inline, sem framework)

## IDs e configuração (topo do Code.gs)

- `VT_SHEET_ID` — planilha central "NEW VT" (abas ADMINISTRATIVO/DOCENTE nascem em branco, criadas por `getOrCreateVTSheet_`)
- `FUNC_SHEET_ID` — planilha de funcionários, aba "RJ - UNIDADES" (compartilhada com VR e Horas)
- `HUB_SS_ID` — planilha do Hub BRASAS BI (aba SESSOES para autenticação)
- `MEU_ACESSO = 'webvt'` — chave de acesso que precisa estar na coluna ACESSOS da aba SESSOES do Hub para o diretor ver este card
- `DP_EMAIL = 'dp@brasas.com'`

## Modelo de dados

Colunas ADMINISTRATIVO/DOCENTE (ordem lógica, reorganizada antes do lançamento 100% do webapp): `Unidade|Mês|Ano|Matrícula|CPF|Nome` (A-F) → trechos de IDA `TipoIda|ValorIda|QtdIda|TipoIda2|ValorIda2|QtdIda2|TipoIda3|ValorIda3|QtdIda3` (G-O) → trechos de VOLTA idem (P-X) → calculados `Total|DiasTrabalhados|ValorDiário|ValorJaé|ValorRioCard` (Y-AC) → auditoria `EditadoEm|EditadoPor|Comentário|ComentadoEm|ComentadoPor` (AD-AH).

- Aba criada no layout antigo (TipoIda2 na coluna R): `getOrCreateVTSheet_` **falha com erro pedindo pra rodar `reorganizarColunasVT()`** (run-once no editor, mapeia pelo nome do cabeçalho antigo, idempotente) — nada lê/grava em aba desalinhada. Antes de reordenar, ela cria uma cópia da aba (`ADMINISTRATIVO (backup dd-MM-yyyy HH:mm)`) na própria planilha; apagar manualmente depois de conferir.
- Até 3 "trechos" por sentido (ida/volta) — ex.: ônibus + metrô no mesmo trajeto. **Cada trecho tem a SUA Qtd**; trecho extra com Qtd em branco/0 **herda a Qtd do 1º trecho do sentido** (no app a Qtd do trecho novo já nasce igual à do 1º, editável; ao salvar grava-se a Qtd efetiva). Dias Trabalhados = maior Qtd entre todos os trechos (os trechos se sobrepõem nos dias — metrô 20 dias + ônibus 19 = 20 dias).
- Campos calculados (Total, Dias Trabalhados, Valor Diário, Valor Jaé, Valor RioCard) são **sempre recalculados no backend** em `calcularVT_()` ao salvar — nunca confia no que o cliente manda nem em fórmula de planilha.
- Rateio Jaé/RioCard: `TIPOS_JAE = ['onibus municipal', 'metro']`, `TIPOS_RIOCARD = ['onibus intermunicipal', 'barca', 'trem']` (comparação normalizada, sem acento).
- `UNIDADES_SEM_RATEIO = ['VO']` — unidade de São Paulo, sem cartão Jaé/RioCard; só o campo Total vale pra ela (`isSemRateio_()`).
- Edição sinalizada: colunas `Editado Em`/`Editado Por` gravadas só quando um valor **já lançado** (≠ 0) muda — preencher campo zerado é lançamento normal, não edição. Linha marcada em âmbar na UI com selo "✎ editado".
- Edição feita durante uma **liberação concedida após o dia 11** (fora do prazo normal) grava adicionalmente, campo a campo, quais trechos mudaram na coluna `Campos Editados (Liberação)` (última coluna, AI — acrescentada no fim das abas de propósito, pois `getOrCreateVTSheet_` só completa cabeçalho novo no final, nunca no meio). No front-end isso vira um `*` vermelho ao lado do input específico alterado (`libStar()`/`campoLegKey()` em Index.html), não no selo âmbar da linha inteira. Uma edição normal subsequente dentro do prazo limpa essa coluna — o `*` reflete só a alteração mais recente feita via liberação, nunca fica marcado pra sempre.
- As 3 colunas finais (`Comentário`/`Comentado Em`/`Comentado Por`) fazem parte de `VT_HEADERS` — `getOrCreateVTSheet_()` já garante esse cabeçalho automaticamente, inclusive em abas criadas antes dessa mudança (mesmo mecanismo que já estende o cabeçalho pros trechos extras).

## Comentários por lançamento

Cada linha das tabelas Administrativo/Docente tem um ícone de comentário (💬) que abre um modal para anotar uma observação livre sobre aquele lançamento — não é um campo de VT, não entra em `calcularVT_()` e não sai no CSV/Planilha Google exportados.

- Um comentário por lançamento (sobrescreve o anterior ao salvar); apagar o texto e salvar limpa comentário + autor/data.
- Visível tanto para o diretor quanto para o DP — mesma tela (`tabAdmin`/`tabDocente`).
- Funciona mesmo com o período bloqueado. Só é possível comentar lançamento já salvo (`salvarComentarioVT` busca a linha por unidade+mês+ano+matrícula); linhas recém-adicionadas mostram o ícone desabilitado até serem salvas.

## Abertura em uma chamada — getInitData (08/2026)

O front-end abria com 5 `google.script.run` em sequência (usuário → unidades → período → funcionários → lançamentos), cada um revalidando a sessão e relendo as mesmas planilhas (~10–15s). `getInitData(token)` devolve tudo numa chamada só: valida a sessão uma vez, lê RJ-UNIDADES e as abas ADMINISTRATIVO/DOCENTE uma vez cada (`readFuncRows_`/`readVtRows_`) e monta as respostas com os cores `funcionariosFromRows_`/`vtDataFromRows_`/`getCurrentPeriodForUser_` (o filtro EC-linked reusa as mesmas linhas via `buildEcLinkedSet_(funcRows)`). Os endpoints individuais continuam existindo (`getVTData` é usado pelo `reloadData`). Mesmo padrão do Horas e VR.

## Chave de lançamento por NOME (08/2026 — portada do Horas)

`saveVTData` (via `_upsertRows_`), `salvarComentarioVT` e `deleteVTEntry` localizam a linha por **unidade + mês + ano + NOME completo (coluna F)** — `chaveVT_()`/`chaveVTRow_()`. A **matrícula não entra na chave**: funcionário recém-admitido vem com matrícula placeholder ("-") ou vazia no cadastro, e dois "-" na mesma unidade colidiam na mesma chave, um salvamento sobrescrevendo a linha do outro (mesma decisão da Adriane no Horas, 03/08/2026; portada em 03/08/2026 a pedido dela).

- Mais de uma linha com a mesma chave: a operação daquele funcionário é **recusada com erro explícito**, em vez de gravar em linha imprevisível. `saveVTData` acumula os nomes recusados e avisa o que não foi salvo.
- **Ponte de migração** (`chaveMatVT_`): linha antiga cujo nome na planilha não bate com o do cadastro ainda é reencontrada pela matrícula — quando ela é real (não vazia nem "-") e única na aba — e tem o nome corrigido na hora. Sem isso o salvamento criaria uma segunda linha para a mesma pessoa. Matrícula placeholder nunca serve de ponte.
- `LockService` em `saveVTData` (dois salvamentos simultâneos criariam linhas duplicadas), e linha nova gravada com `setValues`, nunca `appendRow` — o `appendRow` interpreta os valores como digitação e converte "08 Agosto" em DATA, fazendo a linha sumir do app; `parseMes_()` também passou a aceitar `Date` para ler linhas já estragadas.
- No front-end, todo casamento lançamento↔cadastro é por unidade+nome: `copyableEntries`, `populateAddEmpDropdown` e `rowKey_`. `deleteVTEntry`/`salvarComentarioVT` recebem `nome` no payload.

## Autosave e filtros (08/2026 — padrão espelhado do Horas)

- **Autosave**: `onVTRowInput` (que já recalculava o total ao vivo) agora também marca a linha como suja (`markRowDirty`, debounce de 2s); `onVTRowCommitted` (no `change` — sair do campo/Enter/troca de tipo) envia na hora. `addLeg`/`removeLeg` também disparam. `flushAutosave` manda **só as linhas sujas** pro `saveVTData` e não redesenha as tabelas durante a digitação (`refreshTablesIfIdle`). Um envio por vez; falha devolve o `_dirty` e orienta a usar o botão "Salvar dados", que continua como fallback. `beforeunload` avisa se há edição não enviada.
- **Filtros preservam o que foi digitado**: `syncBeforeFilterChange()` (sync das duas tabelas + `clearKeepVisible`) roda antes de qualquer mudança de filtro — antes disso, trocar filtro APAGAVA valores digitados e não salvos (correção que o Horas já tinha e o VT não).
- **Linhas novas furam os filtros**: `passesFilter` deixa passar `_new`/`_keepVisible` — com filtro de mês ativo, a linha do "+ Adicionar"/"Copiar mês anterior" sumia da tela e ficava fora do salvamento. `_keepVisible` sobrevive ao salvar+recarregar (reaplicado por chave unidade+mês+ano+matrícula em `onVTLoaded`) e é limpo ao mexer em qualquer filtro.
- **Salvar manual envia o período aberto INTEIRO** (state, não DOM filtrado) — linha escondida por filtro com edição pendente também é salva.
- **Opções de filtro atualizam ao adicionar/copiar**: `renderFilterBar()` roda de novo após "+ Adicionar"/"Copiar mês anterior" (o ano da linha nova só entrava no filtro depois de recarregar).
- **"+ Adicionar" identifica o funcionário pela POSIÇÃO no cadastro, nunca pela matrícula** (`value` = `indexOf(e)`): com duas matrículas placeholder ("-") iguais na unidade, escolher o segundo funcionário adicionava o primeiro de novo. Mesma correção feita no Horas e no VR.
- **"Copiar mês anterior" e "+ Adicionar" já salvam sozinhos**: as linhas nascem `_dirty` + `flushAutosave()` na sequência — antes o autosave só disparava em edição de campo, então copiar/adicionar sem digitar nada não gravava. Consequência aceita: pessoa adicionada e deixada zerada **vira lançamento na planilha** (e conta como unidade preenchida nos lembretes) — para desfazer, usar a lixeira da linha.
- **Opções de filtro atualizam ao adicionar/copiar**: `renderFilterBar()` roda de novo após "+ Adicionar"/"Copiar mês anterior" (o ano da linha nova — ex.: janeiro lançado em dezembro — só entrava no filtro de ano depois de recarregar).

## Período e bloqueio

- Só existe "Previsto" (sem Efetivo como no VR) — o diretor lança o **mês seguinte**, adiantado. Ex.: VT de agosto é lançado em julho.
- Bloqueia automaticamente a partir do dia 12 do mês corrente (`getCurrentPeriod`).
- Liberação temporária (admin/DP libera até 23:59 do dia) e fluxo de solicitação (diretor pede pelo painel → e-mail pro DP → aprova/reprova → e-mail de resposta pro diretor) — abas `LIBERACOES` e `SOLICITACOES`, criadas automaticamente.
- `MOTIVOS_LIBERACAO` no topo do Code.gs é uma **lista provisória** — ajustar quando a Adriane mandar a lista real.

## Associação de códigos de unidade (NS/CH, MRI/MR)

O cadastro de permissões do Hub usa "NS" e "MRI" pra unidades que os lançamentos (e a planilha de funcionários) chamam de "CH" e "MR". Toda unidade crua lida de qualquer fonte (Hub, planilha de funcionários, planilha de VT) passa por `canonUnidade_()`:

```js
const UNIDADE_ALIASES_ = { ns: 'CH', mri: 'MR' };
```

Isso evita que "NS"/"CH" ou "MRI"/"MR" apareçam como unidades duplicadas em listas, filtros e lembretes. CH e MR continuam sendo unidades diferentes entre si. Ao salvar, o código canônico é sempre gravado na planilha (nunca "NS"/"MRI").

## Lembretes automáticos de preenchimento

Gatilhos mensais (dias 1, 5, 9 e 11), instalados manualmente uma vez rodando `instalarGatilhosLembreteVT()` no editor do Apps Script:

- **Dia 1**: e-mail de abertura do período, pra todas as unidades ativas, incondicional.
- **Dias 5, 9 e 11**: lembrete só pra quem ainda não tem nenhum lançamento salvo no mês Previsto (`getUnidadesPreenchidas_`). Dia 11 avisa que é o último dia antes do bloqueio.
- Destinatário por unidade: lista fixa `DIRETORES_UNIDADE` (e-mail do diretor específico de cada unidade, passada manualmente pela Adriane — não deriva da planilha do Hub porque lá tem contas globais/admin misturadas). Unidades sem e-mail cadastrado ali (ex.: EDITORA, EC NEW, MÉTODOS) são puladas.
- `getUnidadesAtivas_()` usa a mesma fonte de "RJ - UNIDADES" — VO entra normalmente na lista de lembretes (só fica de fora do rateio Jaé/RioCard, isso é tratado à parte).
- Antes de instalar os gatilhos de verdade, rodar `diagnosticoLembretesVT()` (ajustando a variável `dia` no topo da função) — só loga no console quem receberia o quê, **não envia e-mail nenhum**.
- Template de e-mail: mesma identidade visual do resto do app (faixa colorida no topo — azul na abertura, âmbar/laranja/vermelho conforme a urgência sobe — aviso "comunicado automático", caixa de destaque, box "Dados do lançamento").

## Convenções do Apps Script — funções ocultas (underscore final)

No Apps Script, função cujo nome termina em `_` é tratada como **privada**: ela não aparece no seletor de funções do editor (menu Executar fica "Nenhuma função" se só existirem funções assim), não pode ser gatilho e não é chamável via `google.script.run`. O código compila e roda normalmente — só fica invisível na UI, o que engana como se fosse arquivo corrompido ou erro de sintaxe.

Regra prática para qualquer script deste projeto:

- Função feita para rodar manualmente no editor (ex.: `recalcularTudo`, `diagnosticoVT`, `instalarGatilhosLembreteVT`, `migrarBF`): nome **sem** `_` final e **sem parâmetros** (o menu Executar não passa argumentos — se precisar de parâmetros, criar um wrapper sem parâmetro com os valores fixos).
- Função auxiliar interna (ex.: `norm_`, `calcularVT_`, `_upsertRows_`): manter o `_` final de propósito, justamente pra não poluir o menu Executar.

## Migração das planilhas antigas (`Migracao_VT.gs`)

Script independente do webapp (não entra no deploy do `Code.gs`/`Index.html`), colado num projeto de Apps Script à parte em script.google.com. Migra as ~30 planilhas antigas por unidade (uma aba por mês, seções ADMINISTRATIVO/PROFESSORES na mesma aba) para a planilha central do VT. As planilhas antigas ficam todas numa pasta do Drive (`VTMIG_PASTA_ID`, pasta `1nn4sbeaDl98uatuhpppYNTkLPQ0A4X8s`), nomeadas no padrão `<UNIDADE> - VT - <ano>` — o script acha a planilha da unidade sozinho por esse nome (o ano sai do nome do arquivo). Por unidade, edita-se só `VTMIG_UNIDADE` no bloco CONFIG e roda-se 3 etapas: `gerarStaging()` gera uma planilha de staging para revisão (e guarda o ID dela em Script Properties, por unidade+ano) → revisão manual da coluna "Alerta" (CPF suspeito, total divergente, mesclagens) → `aplicarStaging()` acha a staging sozinho pela property e grava na planilha oficial pulando chaves que já existam lá. `listarPlanilhasDaPasta()` loga as unidades encontradas na pasta. Não se copia função por unidade nem ID na mão (o menu Executar não passa argumentos — por isso os entry points sem parâmetro leem o CONFIG). Todos os nomes internos usam prefixo `vtmig`/`VTMIG_` para não colidir com outros scripts; recalcula tudo com cópia do `calcularVT_` (nunca confia nos valores prontos das planilhas antigas); OBS antiga vira Comentário; Bilhete Único é descartado; a 3ª coluna Tipo/Valor/Qtd (formato Jan–Abr) vira Ida 2.

Algumas unidades (ex.: BG) não preenchiam a coluna Matrícula na planilha antiga — a migração recupera a matrícula pela planilha de funcionários (`VTMIG_FUNC_SHEET_ID`, aba "RJ - UNIDADES"): por CPF (silencioso) ou por nome (com alerta "conferir"; homônimos não casam). Linha que ficar sem matrícula vai pra staging com alerta "SEM MATRICULA" para preenchimento manual — `aplicarStagingVT` não importa linha sem matrícula (lista em "pulados"). `gerarStaging()` loga um resumo por aba (lidos/recuperados/sem matrícula/fora de seção) e dá erro em vez de criar staging vazia.

Nome repetido no mesmo mês (mesma unidade+mês+ano+matrícula) **não vira linha duplicada**: `vtmigMesclarLinha_` encaixa os trechos do lançamento repetido nos slots livres Ida/Volta 2 e 3 da linha já existente (Total/rateio recalculados, Total Original somado, comentários concatenados, alerta "Mesclado..."; se a Qtd divergir entre os lançamentos, alerta — trechos extras usam a Qtd do 1º trecho do sentido). Só quando não cabe (mais de 3 idas ou 3 voltas no mês) fica uma linha extra, com alerta avisando que o webapp edita/exclui apenas a 1ª linha da matrícula no mês; `vtmigUpsertRows_` dá `appendRow` (em vez de sobrescrever) quando a mesma chave se repete no lote.

## Deploy

1. Copiar `Code.gs` e `Index.html` pro editor do Apps Script do projeto vinculado à planilha `VT_SHEET_ID`.
2. Se as abas ainda estiverem no layout antigo de colunas, rodar `reorganizarColunasVT()` uma vez no editor (o app se recusa a rodar sobre aba desalinhada).
3. Publicar nova versão (Implantar > Nova implantação / Gerenciar implantações).
4. Conferir se `webvt` está nos acessos dos diretores certos na aba SESSOES do Hub.
5. Rodar `diagnosticoLembretesVT()` pra validar, depois `instalarGatilhosLembreteVT()` uma vez.

## Pendências conhecidas

- `MOTIVOS_LIBERACAO` ainda é lista provisória.
- Confirmar se `DP_EMAIL` é o destinatário certo das solicitações.
