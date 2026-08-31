
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
