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

Colunas ADMINISTRATIVO/DOCENTE: `Unidade|Mês|Ano|Matrícula|CPF|Nome|TipoIda|ValorIda|QtdIda|TipoVolta|ValorVolta|QtdVolta|Total|DiasTrabalhados|ValorDiário|ValorJaé|ValorRioCard|TipoIda2|ValorIda2|TipoVolta2|ValorVolta2|TipoIda3|ValorIda3|TipoVolta3|ValorVolta3|EditadoEm|EditadoPor|Comentário|ComentadoEm|ComentadoPor`

- Até 3 "trechos" por sentido (ida/volta) — ex.: ônibus + metrô no mesmo trajeto. Trechos extras (2º/3º) usam a MESMA Qtd do 1º trecho daquele sentido.
- Campos calculados (Total, Dias Trabalhados, Valor Diário, Valor Jaé, Valor RioCard) são **sempre recalculados no backend** em `calcularVT_()` ao salvar — nunca confia no que o cliente manda nem em fórmula de planilha.
- Rateio Jaé/RioCard: `TIPOS_JAE = ['onibus municipal', 'metro']`, `TIPOS_RIOCARD = ['onibus intermunicipal', 'barca', 'trem']` (comparação normalizada, sem acento).
- `UNIDADES_SEM_RATEIO = ['VO']` — unidade de São Paulo, sem cartão Jaé/RioCard; só o campo Total vale pra ela (`isSemRateio_()`).
- Edição sinalizada: colunas `Editado Em`/`Editado Por` gravadas só quando um valor **já lançado** (≠ 0) muda — preencher campo zerado é lançamento normal, não edição. Linha marcada em âmbar na UI com selo "✎ editado".
- As 3 colunas finais (`Comentário`/`Comentado Em`/`Comentado Por`) fazem parte de `VT_HEADERS` — `getOrCreateVTSheet_()` já garante esse cabeçalho automaticamente, inclusive em abas criadas antes dessa mudança (mesmo mecanismo que já estende o cabeçalho pros trechos extras).

## Comentários por lançamento

Cada linha das tabelas Administrativo/Docente tem um ícone de comentário (💬) que abre um modal para anotar uma observação livre sobre aquele lançamento — não é um campo de VT, não entra em `calcularVT_()` e não sai no CSV/Planilha Google exportados.

- Um comentário por lançamento (sobrescreve o anterior ao salvar); apagar o texto e salvar limpa comentário + autor/data.
- Visível tanto para o diretor quanto para o DP — mesma tela (`tabAdmin`/`tabDocente`).
- Funciona mesmo com o período bloqueado. Só é possível comentar lançamento já salvo (`salvarComentarioVT` busca a linha por unidade+mês+ano+matrícula); linhas recém-adicionadas mostram o ícone desabilitado até serem salvas.

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

## Deploy

1. Copiar `Code.gs` e `Index.html` pro editor do Apps Script do projeto vinculado à planilha `VT_SHEET_ID`.
2. Publicar nova versão (Implantar > Nova implantação / Gerenciar implantações).
3. Conferir se `webvt` está nos acessos dos diretores certos na aba SESSOES do Hub.
4. Rodar `diagnosticoLembretesVT()` pra validar, depois `instalarGatilhosLembreteVT()` uma vez.

## Pendências conhecidas

- `MOTIVOS_LIBERACAO` ainda é lista provisória.
- Confirmar se `DP_EMAIL` é o destinatário certo das solicitações.
