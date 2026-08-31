# Na Ponta da Chave — Intranet 2.0 (fundação)

Esta é a reconstrução da intranet: a fundação da arquitetura nova, com o
visual redesenhado (paleta e logo da NPC + estrutura de layout inspirada no
Univen) e os primeiros módulos funcionando de ponta a ponta, incluindo as
automações combinadas. Já passou por duas rodadas de testes contra o
Firebase real de produção e por um pedido de ajuste no módulo de
Negociações — ver "Histórico de ajustes" abaixo.

## O que já funciona

- **Login** (Firebase Auth) e checagem de cadastro ativo em `db.users`, igual ao sistema atual.
- **Dashboard** com indicadores em tempo real.
- **Atendimentos** — cadências de contato para leads, em duas abas ("Novos Leads" / "Reativação"), nova versão do módulo "Cadências SDR" do sistema anterior (ver seção própria abaixo).
- **Negociações** — kanban de vendas portado fielmente da versão 1.0, incluindo os cards completos (ver detalhes na seção própria abaixo).
- **Respostas rápidas** — modelos de mensagem reutilizáveis.
- **Configurações** (administradores) — guias de gestão: importação das planilhas do Univen usadas pela Análise 360°, e Gestão de Cadências e Templates de Mensagens de Atendimentos (ver seções próprias abaixo).
- **Registros Diários** — três telas de lançamento (Vendas, Captação, Atendimento e Visitas) para as equipes de vendas e locação (ver seção própria abaixo).
- **Análise 360° - Vendas** — VGV, comissões, ranking de corretores, atendimentos, carteira de imóveis e performance individual, a partir das planilhas importadas e de dados que já existem na própria Intranet 2.0 (ver seção própria abaixo).

Os demais módulos do sistema atual (Institucional, Comunicados, Agenda,
Aniversariantes, Avaliação de Desempenho, Análise 360° - Locação,
Reconhecimentos, Chamados, Treinamentos, Playbook, Processos, Biblioteca,
Usuários, Permissões) aparecem no menu como **"em breve"**: os dados deles
continuam intactos no mesmo Firebase, só a tela ainda não foi portada.
Isso é proposital — preferi entregar uma base sólida e alguns módulos
completos a entregar tudo pela metade.

## Por que o sistema antigo tinha problema nos dados

O `Intranet_91.html` tinha **dois mecanismos concorrentes** escutando o
Firebase ao mesmo tempo (um chamado "global-realtime-sync", outro
"-v2", sendo que o primeiro foi desativado manualmente por causar telas
piscando) e, além disso, um listener de clique na página inteira que
recarregava o banco de dados inteiro a cada clique em qualquer lugar da
tela. Múltiplos redesenhos concorrentes disputando a mesma tela é a causa
mais provável dos dados aparecendo incompletos/errados por instantes.

A correção estrutural está em `js/sync.js`: existe **um único** listener
do Firebase no app inteiro. Ele mantém um espelho local dos dados e avisa
**só** os componentes de tela inscritos na fatia de dado que realmente
mudou (por exemplo, a tela de Negociações só re-renderiza quando
`kanbanCards`/`kanbanColumns` mudam — uma alteração em `leads` não a
afeta). Escritas são otimistas: a
tela do próprio usuário atualiza na hora, sem esperar o Firebase ecoar de
volta. Isso elimina a classe de bug que causou o problema relatado.

## Negociações — kanban de vendas (versão 1.0 fielmente portada)

A pedido seu, o card de Negociações não foi simplificado: ele reproduz o
kanban de vendas da versão 1.0, campo a campo — inclusive a divisão em
dois modais, do jeito que era antes:

- **"Editar venda"** é um formulário único e comprido (sem abas de Dados e
  Comissão separadas, igual à v1.0): título/coluna/valor da venda, posse,
  saldo de financiamento e banco, comissão bruta → quinto andar → rateio da
  comissão imobiliária (com a linha fixa "Na Ponta da Chave" recebendo
  automaticamente o que sobrar depois do percentual de cada comissionado),
  vendedor(a)(s) e comprador(a)(s) em múltiplas linhas, condições de
  pagamento (valor em moeda separado da forma de pagamento), observações e
  usuário responsável. A única exceção combinada é **"Itens do imóvel"**,
  que ficou como uma aba à parte (checklist dos 23 itens que costumam
  permanecer, com texto editável e opção de adicionar outros).
- **Visualizar uma negociação** (clicar num card do quadro) abre a tela de
  leitura no modelo da v1.0 — **Detalhes**, **Documentos** e **Chat** —
  com o **Checklist** (as 29 etapas do processo) também como aba própria em
  vez de ficar embutido em Detalhes. De lá dá pra entrar em **Editar** ou
  **Excluir**.
- As mesmas 5 colunas padrão (Prospecção, Pré-Contrato, Contrato, Escritura,
  Finalizado), com gerenciamento de colunas (criar/renomear/reordenar), e
  arrastar-e-soltar entre colunas.
- Visibilidade das negociações controlada por permissão (quem tem
  `admin`/`view_all_users` vê todas; os demais veem só as próprias) e
  filtro por "criado por".

Simplificação consciente que permanece, documentada em comentário no topo
de `js/modules/negociacoes.js`, para revisitar quando o módulo de
Usuários/Permissões for portado: a checagem de "quem pode ver o quê" usa
hoje `admin`/`view_all_users` vs. dono do card; a lógica original tinha
mais campos de identidade cruzada, que dependem desse módulo ainda não
portado. Os campos mortos `comissao`/`parceria`/`comissaoParceria` do
sistema atual também não foram trazidos (substituídos pela cascata de
comissão descrita acima).

## Negociações — formulário "Editar venda" reorganizado em seções

O formulário ficou grande depois de tantos campos novos (dados do imóvel,
qualificação completa de vendedor(a)/comprador(a)...), e a tela estava
parecendo "pesada" — uma lista comprida de campo atrás de campo, sem
nenhuma pausa visual. Sem tirar nenhum campo, agrupei tudo em blocos com
fundo levemente cinza e título próprio: Dados da negociação, Dados do
imóvel, Posse e financiamento, Comissão (com o rateio dentro do mesmo
bloco), Vendedor(a)(s), Comprador(a)(s), Condições de pagamento, e
Observações e responsável. Cada vendedor/comprador continua aparecendo
como um cartão branco dentro do bloco cinza, então fica fácil ver onde
uma seção termina e a próxima começa, mesmo rolando uma tela comprida.

## Negociações — Proposta de Compra em PDF

A pedido seu, agora dá pra gerar a **Proposta de Compra de Imóvel** (modelo
NPC 01) já preenchida, direto da tela de visualização de uma negociação —
botão **"Gerar proposta (PDF)"** ao lado de "Editar"/"Excluir". O PDF gerado
segue exatamente o texto do modelo: mesmo título, mesma ordem de seções, e
o texto de **Intermediação** e as **cláusulas 1, 2 e 3** são sempre os
mesmos (fixos, como combinado), sem depender de nenhum campo do card.

O que é preenchido automaticamente a partir do que já existe no card:
vendedor(a)(s) e comprador(a)(s) (repete o bloco de qualificação para cada
um, quando há mais de um), valor da venda (com o valor por extenso
calculado automaticamente, ex.: "R$ 500.000,00 (quinhentos mil reais)") e
as condições de pagamento cadastradas.

Como você notou, faltavam dois grupos de dado que o modelo pede e o card
ainda não tinha — foram adicionados:

1. **Dados do imóvel**, uma nova seção na aba "Dados" do formulário de
   edição: endereço completo, matrícula e inscrição imobiliária (IPTU).
   Aparecem também na aba "Detalhes" da visualização.
2. **Qualificação completa de vendedor(a)/comprador(a)**: nacionalidade,
   estado civil, RG e CPF — a proposta exige esses dados e eles ainda não
   existiam no cadastro de pessoas do card (só tinha nome/e-mail/profissão/
   telefone/endereço). Foram adicionados ao lado dos campos que já existiam,
   em cada vendedor(a)/comprador(a).

Se algum desses campos (ou o valor da venda, ou a forma de pagamento) ainda
não tiver sido preenchido no momento de gerar o PDF, a proposta sai mesmo
assim — com um aviso na tela dizendo o que falta — e o texto usa um
espaço reservado (ex.: "[DESCRIÇÃO DO IMÓVEL]"), do mesmo jeito que o
modelo em Word já fazia, para você preencher à mão se precisar enviar antes
de completar o cadastro.

**Preenchimento automático pelo CEP.** Pra facilitar o preenchimento dos
dados do imóvel, agora basta digitar o CEP: rua, bairro, cidade e estado
são buscados automaticamente (usando a ViaCEP, um serviço público e
gratuito, sem custo nem chave de acesso), sobrando só número e
complemento pra digitar à mão, além de matrícula e inscrição imobiliária.
Se o CEP não existir ou a busca falhar (sem internet no momento, por
exemplo), aparece um aviso e os campos continuam editáveis manualmente —
nada é apagado nem travado.

Detalhe técnico: como quem mora no próprio imóvel negociado não teria um
"endereço de residência" próprio pra citar na proposta, nesse caso o PDF
usa o endereço do imóvel (a partir da nova seção "Dados do imóvel") no
lugar — em vez do texto genérico "mesmo endereço do imóvel negociado", que
não teria valor legal num documento assinado.

A geração usa a biblioteca jsPDF (carregada via CDN em `index.html`, no
mesmo esquema já usado para o SheetJS na importação de planilhas de
imóveis) — não precisa de nenhum serviço de backend.

O PDF sai com o logo no topo, centralizado, do mesmo jeito que já vinha no
cabeçalho do seu modelo em Word — usei a imagem que já estava embutida
naquele arquivo (`assets/logo-documentos.png`, com a tag-line "Seu lar,
nossa missão") em vez do logo usado no menu da intranet
(`assets/logo.png`), porque esse último foi feito para fundo escuro (fica
com o texto invisível em cima do branco do PDF).

## Negociações — ajustes finos de kanban (última rodada)

Depois de comparar com o quadro de vendas real da v1.0, três ajustes de
acabamento no kanban:

- **A tela de visualização não encolhe mais ao trocar de aba.** Antes, ao
  sair de "Detalhes" (mais longa) para "Documentos" ou "Chat" (mais curtas),
  o modal encolhia de tamanho, o que dava a sensação de instabilidade.
  Agora o modal trava a altura da primeira aba mostrada e as abas mais
  curtas só usam parte desse espaço — ele só volta a crescer se uma aba
  (como o Checklist, com 29 itens) realmente precisar de mais espaço.
- **Card do quadro com mais informação, igual ao pedido.** Cada card agora
  mostra: título, Venda, Comissão Bruta, Comissão Prestadores (soma do que
  vai para os comissionados, sem contar a parte fixa da imobiliária),
  Vendedor(a), Comprador(a), Checklist com barra de progresso, e "Cadastrado
  por [nome] em [data e hora]" — além dos botões **Abrir**, **Editar** e
  **×** (excluir) diretamente no card, sem precisar abrir a negociação
  primeiro.
- **Barra de navegação entre colunas fixa acima do quadro.** Em vez de
  depender de onde a barra de rolagem do navegador aparece (que varia
  conforme a altura das colunas), agora tem uma barra própria com setas
  `‹`/`›` sempre no mesmo lugar, acima das colunas. A rolagem por
  arrastar/trackpad/roda do mouse continua funcionando normalmente.

**Adição mais recente:** os cards ganharam um campo `dataFechamento`,
gravado automaticamente quando o card chega na coluna final do kanban —
usado pela Análise 360° - Comissões (ver seção própria) para saber
"quando" uma negociação fechou. Não muda nada visível aqui; é só um dado
novo guardado junto com o card.

## Configurações — guias de gestão

A pedido seu, a tela de **Configurações** virou um painel com **uma guia
por tela de gestão**, em vez de cada módulo ter sua própria tela de gestão
solta (como era no sistema anterior — por exemplo, "Cadências SDR" tinha a
gestão de cadências dentro do próprio módulo). Hoje são duas guias:
**"Importação de Dados"** (a importação das planilhas da Análise 360°,
descrita abaixo) e **"Gestão de Cadências e Templates"** (ver seção
própria mais abaixo). As próximas telas de gestão que forem entrando
seguem o mesmo padrão — foi construído pensando nisso: acrescentar uma
guia nova é só adicionar um item na lista `TABS_CONFIG` de
`js/modules/configuracoes.js` e a função que desenha aquela guia, sem
mexer nas guias já existentes.

### Importação de Dados (planilhas do Univen — Análise 360°)

Esta guia tem o local para importar as planilhas que a Univen exporta para
a Análise 360°: **Negociações fechadas**, **Atendimentos — Vendas**,
**Imóveis ativos** e **Imóveis inativos**. É só escolher o(s) arquivo(s)
(.xlsx/.xls) e clicar em "Processar e salvar" — dá para enviar um só tipo
ou os quatro de uma vez.

Como combinado, **importar uma planilha nova substitui só a versão
anterior daquele mesmo tipo** — os outros três continuam exatamente como
estavam. Por exemplo, reenviar só "Atendimentos — Vendas" não toca em
Negociações fechadas nem nos dois arquivos de Imóveis. Isso foi testado
diretamente: reimportar um tipo confirma que só o `atualizadoEm` daquele
tipo muda, os outros três ficam byte a byte iguais.

Cada tipo mostra embaixo do campo a data da última atualização, quem
importou e quantos itens tem — ou "Nenhuma planilha importada ainda." se
nunca foi enviada. Se algum arquivo falhar ao processar (formato
inesperado, coluna faltando), os tipos anteriores da mesma leva já ficam
salvos — só é preciso reenviar o que faltou.

Os dados são gravados no **Cloud Firestore**, nas mesmas coleções que o
sistema atual já usa (`analise360Negociacoes`,
`analise360AtendimentosVendas`, `analise360ImoveisAtivos`,
`analise360ImoveisInativos`), no mesmo formato "em pedaços" (documentos
`chunk_0`, `chunk_1`... de até 500 itens cada, mais um documento `_meta`
com data/quem importou/quantidade) que a versão 1.0 já usa — por isso os
dados que já estão no seu Firebase continuam compatíveis e não precisam
ser reimportados até que você tenha uma planilha mais nova. Para os dois
tipos de Imóveis, a gravação também guarda alguns totais já calculados
(quantidade por tipo/cidade/bairro/finalidade, ticket médio) para uma
futura tela de relatório não precisar reprocessar tudo toda vez.

Toda a tela de Configurações (as duas guias) é restrita a quem tem
permissão de administrador — mesma simplificação já documentada para
Negociações, até o módulo de Permissões ser portado. Ver "Histórico de
ajustes" abaixo para o detalhe de como essa
checagem de admin reconhece o cadastro de produção.

Esta guia é só a parte de importação. A tela que usa esses dados de
verdade — o painel "Análise 360° - Vendas" — está descrita em seção
própria mais abaixo.

## Registros Diários — Vendas, Captação, Atendimento e Visitas

Três telas novas de lançamento diário, uma pra cada indicador combinado:

- **Registro Diário - Vendas** (menu Comercial) — Vendas, Propostas,
  Visitas, Captações e Contatos do dia. Sem os campos de meta/peso que
  apareciam no seu print (você pediu pra tirar por enquanto) — só os
  números lançados mesmo. Diferente das outras duas telas, aqui **cada
  lançamento é somado**: se a pessoa lançar duas vezes no mesmo dia, ficam
  os dois lançamentos separados no histórico (do jeito que já funcionava
  no sistema anterior para esse indicador).
- **Registro Diário - Captação** e **Registro Diário - Atendimento e
  Visitas** (menu novo "Locação") — os mesmos dois lançamentos diários que
  a equipe de Locação já usava, com os mesmos campos de sempre. Aqui é
  **um registro por pessoa por dia**: lançar de novo no mesmo dia
  atualiza os números (a tela até pré-preenche o formulário com o que já
  foi lançado, pra facilitar corrigir), em vez de criar um registro
  duplicado.

Nas três telas: um card de filtros (colaborador, data de/até) e uma tabela
de histórico abaixo do formulário. Quem é administrador vê e filtra os
lançamentos de toda a equipe e pode excluir qualquer um; os demais veem e
lançam só os próprios. Como combinado, as três telas agora sempre mostram
o campo "Colaborador" (no sistema anterior, Captação e Atendimento não
tinham esse campo no lançamento) — para quem não é administrador ele vem
travado no próprio nome, só pra manter o mesmo layout nas três.

**Mudança de banco de dados, combinada à parte:** essas três telas gravam
no **Cloud Firestore**, não no Realtime Database que o resto do app ainda
usa (o motor único de sincronização em `js/sync.js`). A ideia combinada é
migrar a Intranet 2.0 inteira para o Firestore aos poucos — fazer isso de
uma vez para todos os módulos (usuários, leads, negociações, kanban,
imóveis...) seria uma reescrita grande demais para encaixar no meio desta
entrega, então este recurso novo já nasce em Firestore (do mesmo jeito que
a Análise 360° já era) e o restante do app migra depois, num projeto à
parte. Como o sistema anterior (`Intranet_91.html`) foi combinado como
definitivamente desativado, essas três coleções (`registrosDiariosVendas`,
`registrosDiariosCaptacao`, `registrosDiariosAtendimento`) começam vazias
no Firestore — não havia necessidade de importar histórico do Realtime
Database. Os nomes dos campos, ainda assim, foram mantidos parecidos com
os do sistema anterior, só para facilitar qualquer comparação futura.

## Atendimentos — Cadências (Novos Leads / Reativação)

A pedido seu, a tela de Atendimentos virou uma nova versão do módulo
"Cadências SDR" do sistema anterior — substituindo de vez a antiga "fila de
atendimento" + "regras de distribuição automática" desta v2 (eram um
recurso próprio meu, sem nenhum dado real de produção, então a troca foi
confirmada como segura). No sistema anterior existiam duas telas —
"Cadências - Novos Leads" e "Cadências - Reativação" — que, olhando o
código, já eram exatamente a mesma tela, só filtrada por um campo
`programa`. Por isso, como combinado, aqui viraram **duas abas de uma
tela só**: "Novos Leads" e "Reativação".

Cada lead cadastrado percorre uma sequência de etapas (WhatsApp, ligação,
etc.) com prazo entre uma e outra, e tem: situação (Novo, Em Cadência,
Qualificado, Encaminhado ao Corretor ou Perdido), a próxima atividade
prevista (com aviso de "Atrasada" quando passou da data), um histórico
completo de atividades e uma timeline de eventos. Para cada lead é
possível: **Registrar contato** (loga a atividade sem avançar a etapa),
**Concluir etapa** (avança para a próxima e reagenda automaticamente, ou
encerra a cadência se não houver próxima etapa), **Adiar** (só muda a data
da próxima atividade), **Qualificar Lead** (encerra a cadência; vira
"Encaminhado ao Corretor" se já houver um corretor vinculado, ou
"Qualificado" caso contrário) e **Marcar como Perdido**. O **Histórico**
mostra a timeline completa e todas as atividades registradas.

Escopo combinado para esta etapa: só a lista principal + essas ações do dia
a dia. A **Gestão de Cadências** e os **Templates de Mensagens** — que
ficaram combinados para uma etapa seguinte — já foram construídos (ver
seção "Configurações — Gestão de Cadências e Templates" abaixo). Ainda
ficam para uma próxima etapa:

- **Dashboard de Cadências** (funil, tempo médio de qualificação etc.).
- **Importação automática** de leads a partir da planilha "Atendimentos —
  Vendas" da Análise 360° (no sistema anterior, era assim que a maioria dos
  leads chegava nessa tela, filtrando pela coluna "Etapa" da planilha).

Como ainda não existe a importação automática nem a sincronização com um
CRM (que alimentavam essa tela no sistema anterior), esta versão tem um
botão **"+ Novo lead"** para cadastro manual — um adicional além do
combinado, necessário para a tela não começar (e continuar) vazia até que a
importação automática seja construída.

Mesma regra de visibilidade já usada em Registros Diários: quem é
administrador (ou tem `perms.view_all_users`) vê e filtra os leads de toda
a equipe (por responsável) e pode excluir um cadastro feito errado; os
demais veem só os leads em que são o responsável pelo atendimento.

Gravado 100% no **Cloud Firestore** (coleção `atendimentosCadencia`, um
documento por lead), junto com os Registros Diários — ver a seção deles
abaixo para o porquê da migração de banco. Coleção nova e vazia: como o
sistema anterior está desativado, não havia "sdrLeadsCadencia" (Realtime
Database) para migrar. As chaves antigas do Realtime Database usadas só
pela fila de atendimento/regras de distribuição (`leads`,
`leadDistributionRules`, `leadQueueSkips`) foram removidas de
`js/schema.js` — não têm mais nenhum leitor nesta versão — e o arquivo
`js/providers/lead-distribution.js` foi excluído.

## Configurações — Gestão de Cadências e Templates

A pedido seu, esta é a guia (dentro de Configurações — ver seção "Guias de
gestão" acima) onde o administrador cria e edita as cadências de cada
programa de Atendimentos e os Templates de Mensagens reutilizáveis, em vez
de ficarem fixas no código como estavam até aqui (`cadencia-defaults.js`).
Tem duas sub-guias: **"Cadências"** e **"Templates de Mensagens"**.

**Cadências.** A lista mostra as cadências salvas de cada programa (Novos
Leads / Reativação), com uma etiqueta indicando qual está **Ativa** — é
essa que todo lead novo daquele programa recebe ao ser cadastrado. Para
cada cadência é possível **Ativar**, **Duplicar** (cria uma cópia inativa,
com nome "... (cópia)", útil para testar uma variação sem mexer na que já
está em uso) e **Excluir**. Na primeira vez que um programa é aberto sem
nenhuma cadência salva, o sistema semeia automaticamente uma "Cadência
padrão" já ativa (a mesma sugestão que antes vinha fixa no código) — a
partir daí, o administrador é quem manda: pode editar, desativar ou
excluir essa cadência à vontade.

O editor de cadência tem nome, descrição, programa e a lista de etapas —
cada etapa com nome, tipo de atividade (WhatsApp, ligação etc.), prazo
(valor + unidade: minutos/horas/dias, contado a partir da etapa anterior)
e a mensagem sugerida (com botões para inserir variáveis como
`{{nome}}`/`{{empreendimento}}`/`{{telefone}}`/`{{origem}}`/`{{corretor}}`
na posição do cursor, e um botão "Usar" para carregar o texto de um
Template de Mensagens já salvo). Etapas podem ser adicionadas, removidas e
reordenadas com as setas ↑/↓.

**Templates de Mensagens.** Uma biblioteca de textos reutilizáveis
(nome, categoria e texto, com as mesmas variáveis de etapa) para agilizar
o preenchimento de mensagens nas cadências. Importante: o texto de um
template é **copiado** para dentro da mensagem da etapa no momento em que
o administrador clica "Usar" — não é uma referência viva. Editar ou
excluir um template depois não muda nenhuma etapa que já tinha copiado
aquele texto. Decisão consciente: mais simples de entender e evita o
problema de uma cadência quebrar porque alguém excluiu ou alterou um
template que ela usava.

**Simplificação combinada nesta etapa**, em relação ao sistema anterior:
lá era possível ter várias cadências "ativas" ao mesmo tempo, escolhidas
pela origem do lead. Aqui, pra manter simples, **cada programa tem sempre
uma única cadência ativa por vez**. O administrador pode manter várias
cadências salvas (rascunhos, versões antigas, testes) e alternar qual está
ativa a qualquer momento — mas leads que já estão em andamento **não são
afetados** por essa troca: cada lead grava a cadência que estava ativa no
momento em que foi cadastrado (`lead.cadenciaId`/`cadenciaNome`, visível no
campo "Cadência" dos detalhes do lead em Atendimentos) e continua seguindo
essa cadência específica até o fim, mesmo que o administrador troque a
cadência ativa do programa depois. Assim, uma mudança de configuração não
altera de repente o prazo ou o texto da etapa de quem já está em
atendimento.

Gravado 100% no **Cloud Firestore**, em duas coleções novas:
`atendimentosCadenciasConfig` (um documento por cadência, com as etapas
embutidas dentro do próprio documento) e `atendimentosTemplates` (um
documento por template).

## Análise 360° - Vendas

A pedido seu, depois que você viu que a importação das planilhas em
Configurações não estava aparecendo em lugar nenhum, construímos a tela
que faltava: um novo item de menu, **"Análise 360° - Vendas"** (guia
Comercial), com os indicadores de VGV, comissões, ranking de corretores,
atendimentos e carteira de imóveis a partir dos dados já importados.

Um filtro de **período** (De/Até) e de **corretor** fica fixo no topo,
valendo para todas as guias da tela — quem não é administrador (e não tem
`perms.view_all_users`) só vê os próprios números, com o filtro de
corretor travado no próprio nome (mesma regra já usada em Registros
Diários/Negociações/Atendimentos). A tela tem 7 guias:

- **Visão Geral** — VGV, Negócios Fechados, Taxa de Conversão, Ticket
  Médio e Atendimentos no período (cada uma com a variação em relação ao
  período anterior de mesma duração), um gráfico de Negociações por Tipo,
  Atendimentos por Mídia, e um painel por corretor (clicável, filtra a
  tela inteira por aquele corretor) quando nenhum corretor está
  selecionado.
- **VGV** — os mesmos KPIs, VGV mês a mês e o ranking de corretores por
  VGV.
- **Comissões** — ver decisão de dado abaixo.
- **Ranking** — corretores por VGV, Comissão, Negócios Fechados e
  Atendimentos, lado a lado.
- **Atendimentos** — total no período, atendimentos por mês, por
  corretor, por mídia e o funil por etapa.
- **Carteira de Imóveis** — quantidade e ticket médio dos imóveis
  ativos à venda, quebrados por tipo/cidade/bairro/finalidade (não é
  filtrada por período nem corretor — a planilha de imóveis não tem essa
  relação).
- **Performance** — ver decisão de dado abaixo.

**De onde vêm os dados de cada guia — e duas decisões importantes:**

VGV, Ranking (parte de VGV/negócios), Atendimentos e Carteira de Imóveis
vêm das planilhas já importadas em Configurações → Importação de Dados
(`analise360Negociacoes`, `analise360AtendimentosVendas`,
`analise360ImoveisAtivos`/`Inativos`). Como a planilha "Negociações
fechadas" traz Venda e Locação misturadas numa coluna só ("Tipo da
Negociação"), esta tela filtra só as de Venda — o mesmo classificador do
sistema anterior (linhas com "loca"/"aluguel" no tipo são Locação). Isso
já deixa o filtro pronto para quando "Análise 360° - Locação" for
construída (ficou combinada para uma etapa seguinte, junto com uma 5ª
planilha que o sistema anterior tinha, "Atendimentos — Locação", ainda não
importada nesta versão).

1. **Comissões não vêm da planilha.** A coluna "Valor Comissão" da
   planilha de Negociações é só um valor solto, sem dizer como ele foi
   dividido. Como pedido, esta guia usa a cascata de comissão que já é
   calculada em cada card do kanban de **Negociações** (imobiliária +
   quinto andar + cada comissionado, ver a seção de Negociações acima) —
   é o dado real de como a comissão foi repartida. Uma negociação entra
   no relatório quando o card dela está na coluna final do kanban (hoje,
   "Finalizado" — mas a regra é "a coluna de maior posição", não um nome
   fixo, já que as colunas são customizáveis) **e** a data em que ela
   chegou lá cai dentro do período escolhido.

   Isso exigiu um campo novo nos cards de Negociações, `dataFechamento`,
   porque o kanban nunca teve um evento de "fechou aqui" — só existia
   `updatedAt`, que muda a cada edição qualquer, não só quando o card
   chega na coluna final. Agora, sempre que um card entra na coluna final
   (arrastando ou pelo campo "Coluna" do formulário), `dataFechamento` é
   gravado (só a primeira vez — editar de novo não muda a data); se o
   card sair da coluna final, a data é apagada, porque ele deixou de estar
   fechado. **Atenção:** negociações que já estavam na coluna final antes
   desta atualização não têm essa data — elas ficam de fora do relatório
   por período (mas contam se você abrir e salvar cada uma de novo, o que
   já preenche a data). A guia de Comissões avisa na tela quantas
   negociações estão nessa situação.

2. **Performance não é o sistema de lançamento manual do sistema
   anterior.** Aquele sistema ("Registros Realizados"/Ranking, com metas
   por cargo) não foi portado para a Intranet 2.0 — construir do zero só
   para alimentar esta aba seria um projeto à parte. Como você sugeriu, a
   pontuação usa os dados que **já existem** no Registro Diário - Vendas
   (Vendas, Propostas, Visitas, Captações, Contatos). As metas e pesos por
   indicador são os mesmos do sistema anterior (Vendas: meta 2/mês, peso
   35 — indicador principal, trava a pontuação em 80 se não bater 80% da
   meta; Propostas: meta 5/mês, peso 20; Visitas: meta 3/semana, peso 20;
   Captações: meta 3/semana, peso 15; Contatos: meta 20/dia, peso 10), com
   uma simplificação: a meta é distribuída pelos dias corridos do período
   escolhido (o sistema anterior distribuía por dias úteis, mas dependia
   de um calendário de dias úteis que também não foi portado). Sem
   corretor selecionado, quem é administrador vê a pontuação média da
   equipe e um ranking de todos os colaboradores ativos (que não sejam
   administradores).

**Simplificações conscientes desta etapa, para não se perderem:**

- **Gráficos mais simples** (`js/charts-svg.js`): uma lista de barras
  ranqueada, uma "rosca" via CSS e um gráfico de barras por mês — no
  lugar do conjunto maior de gráficos SVG à mão do sistema anterior
  (linha, comparativo anual, funil, gráfico diário).
- **Clique-para-filtrar por corretor** (nas listas/rankings e no painel da
  Visão Geral) **e, na Carteira de Imóveis, por Tipo/Cidade/Bairro/
  Finalidade** (adicionado no item 8 do histórico de ajustes, abaixo) — o
  sistema anterior deixava clicar em quase qualquer barra/fatia da tela
  inteira (mídia e etapa dos Atendimentos, por exemplo). Essas outras
  listas continuam só informativas.
- **"Imóveis Procurados por Cidade/Bairro"** (cruzamento da coluna
  "Imóveis de interesse" dos atendimentos com as planilhas de imóveis) não
  entrou nesta etapa — é uma lógica de parsing específica (a célula vem
  como texto livre, tipo "(2) CS00018, 893406586") que merece uma rodada
  própria.
- **Corretor é texto, não ID**: as 4 fontes de dado desta tela (planilha
  de Negociações, planilha de Atendimentos, cards do kanban, Registro
  Diário - Vendas) não compartilham nenhum identificador comum — o nome
  precisa ser digitado igual nos quatro lugares para aparecer como a mesma
  pessoa no relatório. Isso já valia no sistema anterior; não é uma
  regressão desta versão.
- Diferente do sistema anterior, **a guia Comissões foi implementada de
  verdade** (lá era só um aviso "Em Construção").

## Histórico de ajustes (testes contra o Firebase real)

Depois da primeira entrega, dois problemas apareceram ao testar contra o
banco de produção de verdade — os dois já corrigidos e com teste automatizado
próprio guardado em `test/` para não voltarem a acontecer:

1. **"Não sai da tela de login"** — o app tenta sincronizar com o Firebase
   já no boot, antes do login. Se as regras de segurança do Realtime
   Database exigem usuário autenticado para ler a raiz (`/`), essa primeira
   tentativa falha com "permissão negada" e, do jeito que estava, o
   mecanismo de sincronização não tentava de novo depois do login — ficava
   esperando para sempre, sem mensagem de erro. Corrigido em `js/sync.js`
   (permite nova tentativa após uma falha) e em `js/auth.js` (a
   sincronização é reiniciada logo após o login, com um limite de tempo de
   12s que agora mostra um erro claro em vez de travar). Teste:
   `test/index.test-permdenied.html`.

2. **"users.find is not a function"** — o banco de produção guarda a
   coleção `users` como um **objeto** indexado pelo uid do Firebase Auth,
   com nomes de campo em português (`nome`, `ativo`, `perfil`,
   `permissoes`), e não como um array simples. Criado `js/schema.js`, uma
   camada de compatibilidade que converte esse formato (e o de outras
   coleções que também podem vir como objeto: leads, cards do kanban,
   colunas, aniversariantes, agenda, comunicados etc.) para array na leitura
   e de volta para o formato original na escrita — assim o sistema atual,
   caso continue em uso durante a migração, continua enxergando os dados no
   formato que ele espera. Teste: `test/index.test-realshape.html`.

3. **"Sem permissão" para quem já é administrador** — ao testar a nova
   tela de Configurações contra a conta real, o próprio administrador
   ficava bloqueado. Causa: a checagem de admin olhava só o formato novo
   (`permissoes.admin: true`, pensado para o futuro módulo de Permissões),
   mas o cadastro de produção de hoje marca quem é admin pelo texto do
   perfil/cargo (`perfil: "admin"`), sem esse campo separado — então
   ninguém do cadastro atual batia com a checagem. Corrigido com um
   `isAdmin()` central em `js/auth.js`, que aceita os dois formatos
   (`permissoes.admin` **ou** `perfil`/`role` igual a "admin"/
   "administrador"), usado agora tanto em Configurações quanto na
   visibilidade "ver todas as negociações" de Negociações — assim, quem já
   é admin no cadastro de hoje tem acesso imediato, sem precisar de nenhuma
   migração de dado.

4. **Bancada de testes dependia de um CDN externo** — a pasta `test/`
   carregava o SheetJS (biblioteca de planilhas) de `cdnjs.cloudflare.com`,
   igual à página de produção. Em qualquer ambiente sem acesso a esse CDN
   (foi o caso do ambiente usado para testar esta entrega), a importação de
   planilhas simplesmente não funcionava nos testes automatizados — nem
   dava pra notar sem tentar importar um arquivo de verdade, o que só
   aconteceu ao construir a Análise 360°. Corrigido: os três arquivos de
   teste (`test/index.test*.html`) agora carregam uma cópia local do
   SheetJS (`test/xlsx.full.min.local.js`, mesma versão 0.18.5), sem
   depender de rede nenhuma. A página de produção (`index.html`) continua
   carregando do CDN normalmente — a mudança é só na bancada de testes.

5. **Análise 360° travava a tela inteira se UMA coleção do Firebase negasse
   acesso** — reportado com o app já em uso: a tela mostrava só "Erro ao
   carregar os dados da Análise 360°. Veja o console para detalhes.", sem
   dizer qual das 5 leituras (as 4 coleções do Firestore da Análise 360° +
   `registrosDiariosVendas`, usada pela aba Performance) tinha falhado nem
   por quê. A causa mais provável desse tipo de erro é uma regra de
   segurança do Firebase que permite `get` de um documento específico mas
   nega `list`/consulta da coleção inteira para aquele usuário — algo que só
   se confirma e corrige no console do Firebase (Firestore → Regras), não
   neste código. Enquanto isso não é revisado lá, a tela já se comporta
   melhor: `carregarDadosBrutos`/`carregarRegistrosVendas`
   (`js/providers/analise360-relatorio.js`) agora tentam cada fonte
   separadamente — se uma falhar, as outras continuam carregando
   normalmente — e a tela (`js/modules/analise360.js`) mostra um aviso no
   topo dizendo exatamente qual fonte falhou e a mensagem original do
   Firebase, em vez de travar tudo com um erro genérico. Teste:
   `test/firebase-mock.js` ganhou um gancho (`window.__forcarErroFirestore`)
   pra simular esse cenário sem precisar de um projeto Firebase real com
   regra restritiva.

   **Atualização**: o mesmo "Missing or insufficient permissions." apareceu
   depois também na tela de Atendimentos (`atendimentosCadencia`), uma
   coleção sem nenhuma relação com a Análise 360°. Isso confirma que não é
   um problema de uma coleção isolada nem deste código — é a configuração
   de regras de segurança do projeto Firebase (`intranet-npc`) que precisa
   ser revisada no console, coleção por coleção. Lista completa das
   coleções do Firestore usadas por esta versão, pra conferir lá:
   `analise360Negociacoes`, `analise360AtendimentosVendas`,
   `analise360ImoveisAtivos`, `analise360ImoveisInativos`,
   `registrosDiariosVendas`, `registrosDiariosCaptacao`,
   `registrosDiariosAtendimento`, `atendimentosCadencia`,
   `atendimentosCadenciasConfig`, `atendimentosTemplates` — todas
   precisam de permissão de leitura E de "list" (consulta de coleção
   inteira, não só de documento por id) para o usuário autenticado, além do
   Realtime Database continuar permitindo leitura da raiz (`/`) depois do
   login (ver item 1 acima).

   **Confirmado**: as regras reais do projeto (`intranet-npc`) só têm
   `match` pra 6 coleções (as 5 da Análise 360° + `marketingPlanejamento`)
   — qualquer coleção fora dessa lista é negada por padrão pelo Firestore
   (não existe "liberado por padrão"), o que bate exatamente com o
   diagnóstico acima. Faltam regras para `registrosDiariosVendas`,
   `registrosDiariosCaptacao`, `registrosDiariosAtendimento`,
   `atendimentosCadencia`, `atendimentosCadenciasConfig` e
   `atendimentosTemplates`. Blocos de regra pra adicionar (mesmo padrão já
   usado nas coleções existentes, `allow read, write: if request.auth !=
   null`):
   ```
   match /registrosDiariosVendas/{doc} { allow read, write: if request.auth != null; }
   match /registrosDiariosCaptacao/{doc} { allow read, write: if request.auth != null; }
   match /registrosDiariosAtendimento/{doc} { allow read, write: if request.auth != null; }
   match /atendimentosCadencia/{doc} { allow read, write: if request.auth != null; }
   match /atendimentosCadenciasConfig/{doc} { allow read, write: if request.auth != null; }
   match /atendimentosTemplates/{doc} { allow read, write: if request.auth != null; }
   ```

6. **"Ticket Médio de Venda" virava um número absurdo (casa dos
   quatrilhões de reais)** — a causa real (confirmada depois de descartar a
   hipótese inicial de linha ruim na planilha — o maior valor real
   encontrado na planilha foi R$ 9.500.000,00, nada fora do normal) era um
   bug em `fmtMoneyBRL` (`js/ui-kit.js`), usado em todo o app pra formatar
   valores em Real. A função tentava tratar QUALQUER valor recebido como se
   fosse um texto no formato BR digitado num formulário (removendo pontos,
   trocando vírgula por ponto) — mas quando o valor já chegava como Number
   (o caso de praticamente toda conta feita em código, como VGV, comissão e
   principalmente uma MÉDIA, que raramente fecha num número redondo),
   `String(1234.5)` vira `"1234.5"` — com PONTO decimal, sintaxe do
   JavaScript, não separador de milhar — e a função removia esse ponto como
   se fosse separador de milhar, multiplicando o valor por uma potência de
   10. Numa divisão com dízima longa (comum em médias), isso inflava o
   número pra escala de trilhões/quatrilhões. Só não aparecia antes porque
   os números testados até então (VGV, comissão, tickets médios dos testes)
   sempre davam resultados redondos por coincidência. Corrigido: agora só
   passa pelo tratamento de texto quando o valor É de fato uma string;
   Number é usado direto. De brinde, corrigido também um bug antigo e
   independente no MESMO tratamento de texto (usado pelo formulário de
   Imóveis, em `js/modules/imoveis.js`): o `.replace(".", "")` só removia o
   PRIMEIRO ponto, então um imóvel cadastrado com valor de R$ 5.000.000,00
   ou mais (dois ou mais separadores de milhar) já vinha aparecendo como
   "R$ 0,00" há tempos — agora remove todos.

7. **Removida a defesa contra "valor fora da curva" na Carteira de
   Imóveis** — o item anterior tinha, por segurança, deixado no código um
   filtro que tirava do cálculo do "Ticket Médio" qualquer valor muito
   maior que o resto da carteira, avisando na tela quantos valores foram
   ignorados. Com a causa real do bug já corrigida (item 6, `fmtMoneyBRL`),
   esse filtro passou a fazer mais mal que bem: com uma carteira de
   milhares de imóveis, é normal e legítimo ter uma variação grande de
   preço (uma cobertura ou um imóvel comercial custando bem mais que a
   média), e o filtro estava classificando esses casos legítimos como
   "erro" e tirando-os da média sem necessidade. Removido — a média volta a
   considerar todos os imóveis com valor de venda cadastrado.

8. **Carteira de Imóveis ganhou clique-para-filtrar** — as listas de Por
   Tipo, Por Cidade, Por Bairro e Por Finalidade eram só informativas
   (diferença documentada como "simplificação consciente" na primeira
   entrega). Agora, igual às listas por corretor das outras abas, clicar
   numa barra filtra o Ticket Médio e o total de imóveis da carteira só
   por aquele valor (clicar de novo limpa o filtro; hover mostra um botão
   "Limpar filtro" e uma tag indicando o filtro ativo). Esse filtro é
   independente do filtro de corretor — não existe corretor associado a
   imóvel nos dados de origem.

9. **Removida a tela "Imóveis" (catálogo/CRM)** — a pedido seu. Essa tela
   (cadastro manual, importação própria de planilha, filtros de pesquisa —
   ver histórico desta seção nas versões anteriores deste README) guardava
   cada imóvel como um registro no Realtime Database (fatia `imoveis`).
   Motivo do pedido: a Análise 360° já cobre os dados de imóveis pra
   relatório (5904 ativos + 7662 inativos, no caso da NPC), e trazer esse
   volume pra dentro da tela "Imóveis" recriaria exatamente o problema de
   performance que fez a Análise 360° usar Firestore em vez do Realtime
   Database em primeiro lugar (uma árvore JSON única e gigante deixa a
   gravação e o próprio login — que baixa a árvore inteira — lentos e
   instáveis). Removidos `js/modules/imoveis.js` e
   `js/providers/imoveis-provider.js` (o esqueleto de integração com a
   futura API da Univen, que vivia nesse segundo arquivo, foi removido
   junto — ver "Próximos passos sugeridos"), o item "Imóveis" do menu
   (`js/nav-config.js`) e o import em `js/main.js`. O KPI "Imóveis
   disponíveis" do Dashboard também saiu (lia a mesma fatia de dado que
   deixou de ser populada). Se no futuro fizer sentido ter um catálogo de
   imóveis individual de novo, o caminho recomendado é usar Firestore com a
   mesma estratégia de chunks da Análise 360°, não o Realtime Database.

10. **Atendimentos podia mostrar "Nenhuma cadência ativa" mesmo com
    cadência cadastrada e ativa** — sintoma reportado depois de já ter
    cadência configurada tanto pra Novos Leads quanto pra Reativação (as
    duas com o selo "Ativa" em Configurações), o que provava que a causa
    não era falta de configuração. A causa real: `recarregar()` (em
    `js/modules/leads.js`) buscava os leads da cadência
    (`listarLeadsCadencia`, coleção `atendimentosCadencia`) e a
    configuração de cadência (`listarCadencias`) dentro do MESMO
    `Promise.all`. Como um `Promise.all` falha por inteiro se qualquer uma
    das promessas falhar, se a leitura dos LEADS falhasse por qualquer
    motivo (ex.: uma regra do Firestore ainda incompleta pra
    `atendimentosCadencia` especificamente), a leitura da CONFIGURAÇÃO de
    cadência — que funcionava normalmente — era descartada junto, e a tela
    concluía (errado) que não havia cadência ativa. Corrigido com o mesmo
    padrão já usado na Análise 360° (item 5): as três leituras
    (`garantirCadenciasPadrao`, `listarLeadsCadencia`, `listarCadencias`)
    agora rodam em tentativas independentes, cada uma com seu próprio
    try/catch. Se uma falhar, as outras continuam funcionando normalmente e
    um aviso específico aparece na tela nomeando exatamente qual fonte de
    dado falhou e a mensagem de erro original do Firebase — em vez do
    "Nenhuma cadência ativa" genérico e enganoso. Se depois dessa correção
    ainda aparecer um aviso mencionando `atendimentosCadencia`, é sinal de
    que a regra do Firestore pra essa coleção específica (ver item 5) ainda
    não está publicada ou não está correta.

11. **Distribuição automática de leads por fila, e a nova tela "Leads
    Distribuídos"** — a pedido seu. Até aqui, "Qualificar Lead" só definia
    um corretor se ele já tivesse sido informado no cadastro manual do
    lead. Agora, no momento de qualificar, quem está atendendo pode
    escolher uma **fila** (Configurações → Gestão de Filas, nova aba) e o
    sistema sugere automaticamente o próximo corretor da vez, com um botão
    para **pular** (exigindo justificativa) até achar quem deve receber.

    Como combinado: as filas não são amarradas a um programa (Novos Leads
    / Reativação) — pode existir quantas filas fizerem sentido (por
    empreendimento, por equipe etc.) e a escolha de qual usar é sempre
    manual, a cada qualificação. Pular um corretor tem o mesmo efeito de
    escolhê-lo: ele vai para o **final** da fila, então não aparece de
    novo em seguida. Mecânica de fila = round-robin simples (posição 0 é
    sempre "o próximo da vez"), gravada na coleção `filasDistribuicao`
    (ver `js/providers/filas-distribuicao.js`).

    Um lead distribuído aparece nos **dois lugares**: continua em
    Atendimentos (aba "Qualificados", como já acontecia com "Qualificado"
    e "Encaminhado ao Corretor") e passa a aparecer também na tela nova
    **Leads Distribuídos** (menu Comercial, logo após Atendimentos) — lá a
    visibilidade é por **corretor** (quem vai atender o cliente), não por
    responsável de SDR: administradores veem e filtram todo mundo, os
    demais só veem os leads em que são o corretor. Criar a Negociação em
    si continua manual por enquanto (o corretor cria pelo kanban de
    Negociações quando avançar) — combinado para não fazer as duas coisas
    de uma vez nesta etapa.

    Se uma distribuição foi um engano, excluir o lead (de Atendimentos ou
    de Leads Distribuídos — é a mesma ação) devolve o corretor para a
    **frente** da fila de onde ele veio, como se a vez dele não tivesse
    sido usada.

    O modal de detalhes do lead e as ações do dia a dia (registrar
    contato, concluir etapa, adiar, qualificar, marcar como perdido,
    histórico, excluir) foram extraídos para `js/modules/lead-detalhes.js`
    — antes viviam só dentro de `js/modules/leads.js`, mas agora precisam
    ser reaproveitados também por Leads Distribuídos, já que as duas telas
    mostram o mesmo tipo de registro.

    **Atenção — mais uma coleção nova do Firestore**: assim como aconteceu
    com os outros dados novos desta v2 (ver item 5 acima), a coleção
    `filasDistribuicao` também precisa de uma regra de segurança própria no
    Firestore, senão Gestão de Filas e Leads Distribuídos aparecem com o
    aviso "Missing or insufficient permissions." (o app não trava — só
    avisa exatamente qual coleção falhou, graças ao carregamento resiliente
    do item 5). Mesmo padrão das outras:
    ```
    match /filasDistribuicao/{doc} { allow read, write: if request.auth != null; }
    ```

12. **Filtro por período em Atendimentos e Leads Distribuídos** — a pedido
    seu, as duas telas ganharam campos "de/até" (mesmo padrão de data já
    usado nos Registros Diários): em Atendimentos, filtra pela data de
    atendimento do lead; em Leads Distribuídos, pela data da distribuição
    (ou pela data de atendimento, para quem já tinha corretor vinculado no
    cadastro manual, sem passar por fila). Um botão "Limpar filtros" nas
    duas telas volta tudo ao estado sem filtro nenhum (inclusive corretor/
    responsável, busca e as duas datas).

13. **Comissão recalculada ao arrastar um card pra "Finalizado"** — a
    cascata de comissão (`recalcComissaoCascata`, `js/providers/
    kanban-defaults.js`) só era recalculada ao salvar o formulário de
    edição da negociação. Arrastar um card direto no quadro de Negociações
    pra coluna final não recalculava nada — se o card nunca tivesse sido
    salvo pelo formulário depois da última mudança de valor/percentual, a
    Análise 360° - Comissões (que soma esses campos direto dos cards do
    kanban, ver seção anterior sobre essa tela) podia contar uma negociação
    fechada com comissão desatualizada ou zerada. Agora, toda vez que um
    card é solto na coluna final do funil (a de maior "order" — hoje
    "Finalizado"), a comissão é recalculada e gravada na hora, junto com o
    `dataFechamento` que já era gravado nesse momento.

14. **Notificações — regras de movimentação de card + sino na topbar** — a
    pedido seu: quando um card de Negociações é movimentado entre etapas, o
    usuário responsável pelo card pode ser avisado (e, se a regra
    determinar, outras pessoas também). As regras ficam em uma aba nova de
    Configurações, **Gestão de Notificações** (`js/modules/
    config-notificacoes.js`), no mesmo padrão de lista/editor já usado em
    Gestão de Filas e Gestão de Cadências.

    Cada regra escolhe, de forma independente das outras (as duas opções
    foram pedidas), quando dispara:
    - **Qualquer movimentação** entre etapas do kanban, ou
    - Só quando o card **cair numa coluna específica** (ex.: só ao chegar
      em "Finalizado").

    E escolhe quem é avisado: o **usuário responsável** pelo card (campo
    "Usuário responsável" do formulário de edição) e/ou uma lista de
    **destinatários extras** (qualquer colaborador ativo, não precisa ser
    o responsável). As notificações dessa avaliação aparecem só no **sino**
    da topbar (não existe uma tela própria de histórico, como combinado) —
    clicar no sino abre uma lista suspensa com as notificações do usuário
    logado, mais recentes primeiro, com contador de não lidas no ícone;
    clicar numa notificação marca ela como lida e leva para a tela
    relacionada (hoje, sempre Negociações); tem também um botão "Marcar
    todas como lidas". Como o app não usa listeners em tempo real do
    Firestore (mesma convenção do resto do projeto), o contador do sino é
    atualizado ao entrar no sistema, ao abrir o próprio sino, ao trocar de
    tela, e por um intervalo periódico (a cada 45s) enquanto a pessoa
    estiver logada — então pode levar alguns segundos pra refletir uma
    notificação disparada em outra sessão/computador.

    A avaliação das regras acontece nos dois jeitos de mover um card entre
    colunas: arrastar no quadro e trocar a coluna pelo formulário de
    edição (`js/modules/negociacoes.js`). Duas decisões que tomei sozinho
    ao implementar (sinalizando para você, revisitar se fizer sentido
    diferente):
    - Só dispara se a coluna realmente **mudou** — salvar o formulário sem
      mexer na coluna, ou soltar o card na mesma coluna onde já estava, não
      conta como movimentação.
    - Quem **moveu** o card nunca notifica a si mesmo, mesmo sendo o
      responsável pelo card ou estando na lista de destinatários extras da
      regra — evita a pessoa receber um aviso sobre a própria ação.

    Gravado em duas coleções novas do Cloud Firestore, mesma convenção dos
    outros dados novos desta v2 (sem `.where()`, lê tudo e filtra em JS —
    ver `js/providers/notificacoes.js`): `notificacoesRegras` (a
    configuração de cada regra) e `notificacoes` (uma notificação já
    disparada, por destinatário).

    **Atenção — mais duas coleções novas do Firestore**: mesma observação
    dos itens 5 e 11 acima — sem uma regra de segurança própria, Gestão de
    Notificações e o sino aparecem com "Missing or insufficient
    permissions." (o app não trava, só avisa). Adicione:
    ```
    match /notificacoesRegras/{doc} { allow read, write: if request.auth != null; }
    match /notificacoes/{doc} { allow read, write: if request.auth != null; }
    ```

15. **Usuários e Permissões** — as duas últimas telas do menu Administração
    que ainda estavam "em construção" (o README já recomendava priorizar
    elas — ver "Próximos passos sugeridos" — por serem pré-requisito de
    outras simplificações sinalizadas ao longo deste documento). Duas
    telas separadas, mesma divisão que o sistema anterior já tinha:

    **Usuários** (`js/modules/usuarios.js`) — cadastro e login. Antes desta
    tela, criar alguém novo exigia mexer direto no Firebase (Console pra
    criar o login + banco pra criar o cadastro). Agora dá pra fazer os dois
    passos por aqui: a tela cria a conta no Firebase Authentication
    (e-mail + senha temporária) e o cadastro (nome, cargo, aniversário) de
    uma vez. Como você escolheu: sem precisar de nenhum servidor novo —
    uso uma **segunda instância do Firebase** só na hora de criar a conta
    (ver `js/providers/usuarios-auth.js`), que nasce, cria o login, desloga
    a si mesma e morre, sem nunca trocar a sua própria sessão de admin no
    meio do cadastro. A senha temporária aparece só uma vez, na hora da
    criação (o Firebase não deixa recuperar depois) — cada usuário também
    tem um botão **"Enviar redefinição de senha"** (recurso pronto do
    Firebase, não precisa de backend) pra poder escolher a própria senha
    quando quiser.

    Duas travas de segurança que apliquei sozinho, sinalizando para você:
    o e-mail de um usuário já existente fica travado no formulário de
    edição (mudar o texto ali não muda o login de verdade no Firebase
    Authentication — só o Console ou a própria pessoa trocando a senha
    resolveriam isso, então preferi deixar claro em vez de deixar parecer
    que funciona); e ninguém pode desativar a própria conta por essa tela
    (evita se trancar pra fora sem querer). Não existe exclusão definitiva
    de usuário — só ativo/inativo (mesmo padrão "soft delete" que o resto
    do sistema já usa pra outras coisas), porque a conta de login no
    Firebase Authentication não pode ser apagada só pelo front-end de
    qualquer forma (excluir só o cadastro deixaria um login "orfão").

    **Permissões** (`js/modules/permissoes.js`) — o que cada usuário pode
    ver/fazer, separado do cadastro. Como você escolheu, construída como
    uma **lista extensível por módulo** (`js/permissoes-defs.js`), não só
    os dois interruptores que o código já verificava antes desta tela
    existir. Hoje só duas realmente mudam alguma coisa: **Administrador**
    (libera Configurações, Usuários, Permissões, e o efeito de "ver
    todos" nas telas abaixo) e **Ver todos os usuários e registros** (usada
    em Atendimentos, Leads Distribuídos, Negociações, Registros Diários e
    Análise 360° - Vendas). As demais (excluir negociação, gerenciar filas,
    importar planilhas etc.) aparecem marcadas **"ainda sem efeito"** — ficam
    guardadas no cadastro do usuário, prontas pra quando a tela
    correspondente passar a checar (é só trocar `emUso` pra `true` em
    `js/permissoes-defs.js` e acrescentar a verificação no código daquela
    tela).

    Mesma trava de autoexclusão da tela de Usuários, aplicada aqui pro
    Administrador: ninguém pode tirar a própria permissão de administrador
    por essa tela (o checkbox vem travado, e o salvar tem uma segunda
    checagem por trás, caso alguém tente forçar pelo DevTools) — evita
    ficar sem acesso a Configurações/Usuários/Permissões sem querer.

    Ambas as telas ficam restritas a administradores (mesmo padrão de
    Configurações), lêem e gravam em `users` no **Realtime Database**
    (não no Firestore — diferente de filas/notificações), e a conversão
    pro formato do sistema anterior continua toda cuidada por
    `js/schema.js`, sem mudança nenhuma nele.

16. **Visibilidade de módulos por usuário (Permissões) + Institucional como
    tela inicial** — dois ajustes pedidos depois de testar a entrega
    anterior:

    Em Permissões, cada usuário agora tem uma seção **"Visibilidade de
    módulos no menu"**, com um checkbox pra cada item do menu lateral
    (agrupados por seção, igual ao próprio menu). Desmarcar um módulo
    esconde ele do menu **daquela pessoa** — não mexe em nenhuma
    permissão, só em aparecer ou não. Tem botões de atalho "Mostrar tudo" /
    "Esconder tudo (exceto o essencial)" pra não precisar clicar item por
    item. Guardado em `perms.modulosOcultos` (`js/permissoes-defs.js`) — só
    grava o que está de fato escondido; um módulo sem essa chave configurada
    continua **visível por padrão**, então ninguém perde acesso a nada só
    por essa função ter sido criada, e um módulo novo que entrar no futuro
    já nasce visível pra todo mundo.

    A restrição não é só visual: digitar o `#hash` do módulo direto na URL
    também é bloqueado (mostra uma tela de "Acesso restrito"), senão
    "esconder" seria só estética — ver a checagem em `js/router.js`, além
    do filtro do menu em `js/ui-shell.js`.

    Mesma trava de autoproteção já usada pro checkbox de Administrador:
    ninguém pode esconder **Usuários**, **Permissões** ou **Configurações**
    da própria conta (nem clicando individualmente, nem pelo botão
    "Esconder tudo") — evita um administrador se trancar pra fora dessas
    telas sem ter como reverter sozinho.

    Separado: a primeira tela depois do login agora é **sempre a
    Institucional** (`js/main.js`), mesmo que o navegador ainda tenha um
    `#hash` de outra página guardado de antes de sair (o navegador não
    limpa isso sozinho ao encerrar sessão). Como só foi pedido que ela seja
    a tela de entrada, o conteúdo dela continua exatamente como estava —
    ainda "em construção" (o módulo em si não entrou no escopo desta
    rodada). Se alguém tiver a Institucional escondida em Permissões,
    fica sujeito à mesma tela de "Acesso restrito" logo ao entrar; vale
    ter isso em mente antes de escondê-la de alguém.

17. **Aparência da Tela de Login personalizável** — a pedido seu: a parte
    escura da esquerda da tela de login, que antes mostrava só texto e
    estatísticas fixas, agora pode virar uma **imagem sua**, e o logo
    acima do campo de e-mail também pode ser trocado — os dois, sempre que
    quiser, sem precisar de mim pra isso.

    Nova aba em Configurações: **"Aparência da Tela de Login"**
    (`js/modules/config-aparencia.js`). Escolhe o arquivo, vê uma
    pré-visualização na hora, e só grava de verdade ao clicar em
    "Salvar" — cada imagem tem seu próprio botão "Remover (voltar ao
    padrão)", pra usar só o logo personalizado sem mexer no fundo (ou
    vice-versa). Limite de 2 MB por imagem (aviso claro se passar disso,
    nada é salvo até caber no limite) — o suficiente pra uma foto bem
    comprimida, sem deixar a tela de login lenta pra carregar.

    Quando você define uma imagem de fundo, ela **substitui** o texto e as
    estatísticas (não fica por cima) — exatamente como você pediu ("uma
    imagem ao invés de dados"). Sem nenhuma imagem configurada, a tela
    volta sozinha ao visual padrão de sempre.

    Detalhe técnico que expõe uma regra de segurança nova que **você
    precisa adicionar**: a tela de login é a única tela do sistema que
    roda **antes** do login — nesse momento não existe usuário autenticado
    ainda, então ela não pode ler a árvore normal do banco (a raiz `/`
    exige login, é a mesma trava do item 1 acima). Por isso as duas
    imagens ficam guardadas num nó próprio e separado do Realtime
    Database, `loginAparencia` (`js/providers/aparencia-login.js`), com
    uma regra de **leitura pública só para esse nó específico** — o resto
    do banco continua exigindo login normalmente. Sem essa regra, a tela
    de login simplesmente não encontra as imagens salvas e volta ao
    padrão (não trava nem dá erro visível, mas a personalização não
    aparece). Bloco a adicionar às regras do Realtime Database do projeto
    (`intranet-npc`), ao lado da regra que já existe na raiz:
    ```json
    "loginAparencia": {
      ".read": true,
      ".write": "auth != null"
    }
    ```
    Guardado como texto em base64 direto no Realtime Database (mesmo banco
    e mesmo tipo de regra que o resto do app já usa) — não Cloud Storage
    nem Cloud Firestore: o Firestore tem limite de 1 MB por documento
    (apertado para uma imagem em base64) e o Cloud Storage exigiria
    configurar um sistema de regras totalmente separado, sem necessidade
    aqui.

## Como rodar localmente

O app usa módulos ES (`<script type="module">`), então precisa ser servido
por HTTP (não abre direto como arquivo local). Qualquer servidor estático
resolve, por exemplo:

```bash
cd npc-intranet-v2
python3 -m http.server 8080
# depois abra http://localhost:8080
```

Para publicar de verdade, o mesmo projeto Firebase já usado hoje funciona
com **Firebase Hosting** (`firebase deploy`) ou qualquer hospedagem
estática (a pasta inteira é o deploy).

A pasta `test/` é uma bancada de testes local (com um Firebase falso, sem
precisar de rede) usada para validar as telas antes da entrega — não faz
parte do app publicado, mas fica aí caso seja útil para continuar
testando durante o desenvolvimento dos próximos módulos.

## Estrutura de pastas

```
index.html
css/theme.css              paleta NPC + layout estilo Univen
js/firebase-config.js      config do Firebase (mesmo projeto de produção)
js/sync.js                 motor de sincronização único (o conserto)
js/schema.js               compatibilidade de formato com o banco de produção (users como objeto, coleções como array)
js/auth.js                 login / sessão / timeout de inatividade
js/router.js               roteamento por página
js/ui-shell.js             topbar + sidebar
js/nav-config.js           estrutura do menu (inclui os módulos "em breve")
js/icons.js, js/ui-kit.js  utilitários de UI
js/modules/                um arquivo por módulo de página
js/modules/negociacoes.js  kanban de vendas (versão 1.0 fielmente portada)
js/providers/              importador de planilha, dados de cadência/registros diários
js/providers/kanban-defaults.js  colunas padrão, checklists e cascata de comissão do kanban de vendas
js/providers/proposta-pdf.js     geração da Proposta de Compra de Imóvel (PDF) a partir do card
js/providers/cep.js              busca de endereço por CEP (ViaCEP) para os dados do imóvel
js/providers/analise360-provider.js  leitura das planilhas do Univen e gravação em chunks no Firestore
js/modules/configuracoes.js      tela de Configurações (guias de gestão: importação de dados, cadências/templates...)
js/providers/registros-diarios.js  leitura/gravação no Firestore dos 3 Registros Diários (Vendas, Captação, Atendimento)
js/modules/registros-diarios.js    as 3 telas de Registro Diário (Vendas, Captação, Atendimento e Visitas)
js/providers/cadencia-defaults.js     constantes de Atendimentos (programas, tipos de atividade, variáveis) + cálculo de prazo/substituição de variáveis
js/providers/cadencia-config.js       CRUD no Firestore das cadências (por programa) e dos Templates de Mensagens, configuráveis pelo administrador
js/providers/atendimentos-cadencia.js leitura/gravação no Firestore dos leads em cadência de Atendimentos
js/modules/leads.js                   tela de Atendimentos (abas Novos Leads / Reativação)
js/modules/lead-detalhes.js           modal de detalhes do lead + ações do dia a dia, compartilhado entre Atendimentos e Leads Distribuídos
js/modules/config-cadencias.js        guia "Gestão de Cadências e Templates" de Configurações (editor de cadências + CRUD de templates)
js/providers/filas-distribuicao.js    CRUD das filas de distribuição, rotação round-robin e devolução de corretor à fila
js/modules/config-filas.js            guia "Gestão de Filas" de Configurações (CRUD de filas + reordenar corretores)
js/modules/leads-distribuidos.js      tela de Leads Distribuídos (leads qualificados com corretor, filtrados por corretor)
js/charts-svg.js                      gráficos simples sem biblioteca externa (barra-lista, rosca, barras por mês) usados pela Análise 360°
js/providers/analise360-relatorio.js  agregações da Análise 360° - Vendas (VGV, comissões, atendimentos, carteira, performance)
js/modules/analise360.js              tela de Análise 360° - Vendas
assets/logo.png            logo extraído do sistema atual (menu/topbar, fundo escuro)
assets/logo-documentos.png logo para documentos com fundo claro (usado na Proposta em PDF)
```

## Próximos passos sugeridos

1. Validar esta fundação e os módulos entregues com o time.
2. Priorizar a ordem de migração dos módulos restantes (sugestão: Usuários/Permissões primeiro, por serem pré-requisito dos demais; Avaliação de Desempenho e Análise 360° - Locação são os mais complexos).
3. Configurar a integração com a Univen assim que a API estiver disponível — hoje a única porta de entrada de dados da Univen é a importação de planilha da Análise 360° (Configurações → Importação de Dados), já que a tela "Imóveis" (que tinha um esqueleto pronto pra uma futura API) foi removida.
