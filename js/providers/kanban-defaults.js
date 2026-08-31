/* =========================================================================
   Negociações — dados padrão e cálculos do kanban de vendas, portados
   fielmente da versão 1.0 (extraídos do Intranet_91.html: colunas padrão,
   checklist de processo de 29 itens, lista de itens que costumam
   permanecer no imóvel, e a cascata de cálculo de comissão).
   ========================================================================= */

export const DEFAULT_COLUMNS = [
  { id: "col_prospeccao", title: "Prospecção", order: 1 },
  { id: "col_pre_contrato", title: "Pré-Contrato", order: 2 },
  { id: "col_contrato", title: "Contrato", order: 3 },
  { id: "col_escritura", title: "Escritura", order: 4 },
  { id: "col_finalizado", title: "Finalizado", order: 5 },
];

/** Checklist de processo da negociação — mesma lista e ordem da v1.0. */
export const PROCESS_CHECKLIST = [
  "Solicitar documentos — Compradores", "Solicitar documentos — Vendedores",
  "Salvar documentos na pasta — Compradores", "Salvar documentos na pasta — Vendedores",
  "Solicitar Matrícula atualizada", "Solicitar CND Condomínio",
  "Redigir Pré-Contrato de Compra e Venda", "Enviar para Compradores", "Enviar para Vendedores",
  "De acordo — Compradores", "De acordo — Vendedores", "Enviar para assinatura",
  "Assinatura — Vendedor", "Assinatura — Comprador",
  "Solicitar Certidões dos distribuidores", "Salvar certidões na pasta", "Dossiê das Certidões",
  "Redigir Contrato de Compra e Venda",
  "Enviar para Vendedores — Compra e Venda + Contrato de Intermediação + Certidões",
  "Enviar para Compradores — Compra e Venda + Certidões",
  "De acordo — Compradores", "De acordo — Vendedores", "Enviar para assinatura",
  "Salvar contratos assinados na pasta", "E-mail para Escrevente solicitando Escritura Pública",
  "Pagamento ITEM B — Recursos Próprios", "Agendar Escritura Pública", "E-mail para Condomínio",
  "Posse", "Termo de Entrega das Chaves",
];

/** Itens que costumam permanecer no imóvel — mesma lista da v1.0. */
export const PROPERTY_ITEMS = [
  "Armários planejados da cozinha", "Armários planejados dos dormitórios", "Guarda-roupas embutidos",
  "Móveis planejados da sala", "Painel ou rack da sala", "Cooktop", "Forno embutido",
  "Coifa ou depurador", "Luminárias, lustres, spots e plafons", "Ar-condicionado",
  "Ventiladores de teto", "Box dos banheiros", "Espelhos dos banheiros", "Gabinetes dos banheiros",
  "Cortinas ou persianas", "Aquecedor", "Chuveiros", "Redes de proteção", "Sofá",
  "Mesa e cadeiras", "Geladeira", "Micro-ondas", "Máquina de lavar",
];

const BANCOS = ["Caixa Econômica Federal", "Banco do Brasil", "Itaú", "Bradesco", "Santander", "Inter", "Outro"];
export { BANCOS };

/** Opções de estado civil — usadas nos dados de vendedor(a)/comprador(a),
 *  necessárias para a qualificação das partes na Proposta de Compra. */
export const ESTADOS_CIVIS = ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União estável", "Separado(a) judicialmente"];

export function parseMoneyLoose(v) {
  const n = Number(String(v ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}
export function parsePercentLoose(v) {
  const n = Number(String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
}
export function formatMoneyBR(n) {
  return (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Monta o endereço completo do imóvel a partir dos campos separados
 *  (rua/número/complemento/bairro/cidade/estado/CEP), pulando graciosamente
 *  o que ainda não foi preenchido — usado tanto na aba "Detalhes" quanto na
 *  Proposta em PDF. */
export function formatEnderecoImovel(card) {
  let linha1 = card.ruaImovel || "";
  if (card.numeroImovel) linha1 += (linha1 ? ", nº " : "nº ") + card.numeroImovel;
  const partes = [linha1, card.complementoImovel, card.bairroImovel].filter(Boolean);
  if (card.cidadeImovel && card.estadoImovel) partes.push(`${card.cidadeImovel} - ${card.estadoImovel}`);
  else if (card.cidadeImovel) partes.push(card.cidadeImovel);
  else if (card.estadoImovel) partes.push(card.estadoImovel);
  let endereco = partes.join(" - ");
  if (card.cepImovel) endereco += (endereco ? ", " : "") + `CEP ${card.cepImovel}`;
  return endereco;
}

/** Recalcula toda a cascata de comissão a partir do valor da venda:
 *  Valor da venda → (× % Comissão Bruta) → Comissão Bruta
 *  → (− Quinto Andar, só se "venda em parceria") → base do rateio (comissionamento).
 *
 *  A linha fixa "Na Ponta da Chave" representa o que sobra do rateio depois
 *  de descontado o percentual de cada comissionado adicionado — ela não é
 *  um valor solto de 100%, e sim "100% − soma dos demais", recalculada a
 *  cada mudança. Assim, ao dar 30% para um corretor, os 30% saem do que
 *  a imobiliária recebe, em vez de simplesmente se somarem por cima. */
export function recalcComissaoCascata(card) {
  const valorVenda = parseMoneyLoose(card.valorVenda);
  const pctBruta = parsePercentLoose(card.comissaoImobiliariaPercentual);
  const comissaoImobiliariaValor = valorVenda * (pctBruta / 100);

  let quintoAndarValor = 0;
  if (card.vendaEmParceria === "sim") {
    const pctQuinto = parsePercentLoose(card.quintoAndarPercentual);
    quintoAndarValor = comissaoImobiliariaValor * (pctQuinto / 100);
  }

  const baseRateio = comissaoImobiliariaValor - quintoAndarValor;
  const rows = card.comissionamento || [];
  const somaOutros = rows
    .filter((r) => !r.fixo)
    .reduce((soma, r) => soma + parsePercentLoose(r.porcentagem), 0);
  const pctRestante = Math.max(0, Math.round((100 - somaOutros) * 100) / 100);

  const comissionamento = rows.map((row) => {
    const porcentagem = row.fixo ? pctRestante : parsePercentLoose(row.porcentagem);
    return {
      ...row,
      porcentagem: row.fixo ? String(pctRestante) : row.porcentagem,
      valor: baseRateio * (porcentagem / 100),
    };
  });

  return { ...card, comissaoImobiliariaValor, quintoAndarValor, comissionamento, comissaoSomaOutrosPct: somaOutros };
}

/** Migra condições de pagamento antigas (campo único "Valor / forma" em
 *  texto livre) para o formato novo com "Valor" (moeda) e "Forma" (texto)
 *  separados, sem perder o que já tiver sido digitado antes: o texto antigo
 *  vira o conteúdo de "Forma", e "Valor" começa em branco para o usuário
 *  preencher com o novo campo de moeda. */
function normalizePaymentCondition(p) {
  return {
    label: p.label || "",
    valor: p.valor ?? "",
    forma: p.forma ?? (p.value ?? ""),
    observation: p.observation || "",
  };
}

export function novaLinhaComissionamentoFixa() {
  return { nome: "Na Ponta da Chave", tipo: "Imobiliária", porcentagem: "100", valor: 0, fixo: true };
}

/** Migra "itens que permanecerão no imóvel" do formato antigo (lista simples
 *  de textos, onde só entrava o que já estava marcado) para o novo formato
 *  rico (cada item com marcado/não-marcado e texto editável), sem perder
 *  dados: um texto simples vira um item já marcado. */
function normalizeItemPermanencia(item, i) {
  if (typeof item === "string") return { id: "item_" + i, text: item, checked: true };
  return { id: item.id || "item_" + i, text: item.text || "", checked: !!item.checked };
}
export function defaultItensPermanencia() {
  return PROPERTY_ITEMS.map((t, i) => ({ id: "item_" + i, text: t, checked: false }));
}

export function ensureCardDefaults(card, index = 0) {
  const now = new Date().toISOString();
  return {
    id: card.id || `card_${Date.now().toString(36)}_${index}`,
    columnId: card.columnId || DEFAULT_COLUMNS[0].id,
    order: card.order ?? Date.now(),
    title: card.title || "Negociação",
    valorVenda: card.valorVenda || "",
    vendedores: Array.isArray(card.vendedores) && card.vendedores.length ? card.vendedores : [emptyPessoa()],
    compradores: Array.isArray(card.compradores) && card.compradores.length ? card.compradores : [emptyPessoa()],
    posse: card.posse || "",
    // Endereço do imóvel em campos separados, pra permitir preencher rua/
    // bairro/cidade/estado automaticamente a partir do CEP (ver
    // providers/cep.js) — o usuário só digita número e complemento à mão.
    // `ruaImovel` herda o valor do antigo campo único `enderecoImovel`
    // (versão anterior, texto livre) pra não perder o que já tinha sido
    // digitado antes dessa mudança.
    cepImovel: card.cepImovel || "",
    ruaImovel: card.ruaImovel || card.enderecoImovel || "",
    numeroImovel: card.numeroImovel || "",
    complementoImovel: card.complementoImovel || "",
    bairroImovel: card.bairroImovel || "",
    cidadeImovel: card.cidadeImovel || "",
    estadoImovel: card.estadoImovel || "",
    matriculaImovel: card.matriculaImovel || "",
    inscricaoImobiliaria: card.inscricaoImobiliaria || "",
    possuiSaldoFinanciamento: card.possuiSaldoFinanciamento || "nao",
    valorSaldoFinanciamento: card.valorSaldoFinanciamento || "",
    bancoFinanciamento: card.bancoFinanciamento || "",
    comissaoImobiliariaPercentual: card.comissaoImobiliariaPercentual ?? "",
    comissaoImobiliariaValor: card.comissaoImobiliariaValor || 0,
    vendaEmParceria: card.vendaEmParceria || "nao",
    quintoAndarPercentual: card.quintoAndarPercentual ?? "",
    quintoAndarValor: card.quintoAndarValor || 0,
    comissionamento: Array.isArray(card.comissionamento) && card.comissionamento.length
      ? card.comissionamento : [novaLinhaComissionamentoFixa()],
    paymentConditions: Array.isArray(card.paymentConditions) && card.paymentConditions.length
      ? card.paymentConditions.map(normalizePaymentCondition)
      : [{ label: "A", valor: "", forma: "", observation: "" }],
    itensPermanencia: Array.isArray(card.itensPermanencia) && card.itensPermanencia.length
      ? card.itensPermanencia.map(normalizeItemPermanencia)
      : defaultItensPermanencia(),
    checklist: Array.isArray(card.checklist) && card.checklist.length
      ? card.checklist
      : PROCESS_CHECKLIST.map((t, i) => ({ id: "ck_" + i, title: t, done: false, doneBy: "", doneByName: "", doneAt: "" })),
    // Data em que a negociação entrou na coluna de maior "order" (a
    // coluna final do funil — ver isColunaFinal em negociacoes.js), usada
    // pela Análise 360° - Comissões para saber "quando" a negociação
    // fechou. Não existe um evento de "fechamento" explícito no kanban —
    // isso é um proxy: gravado na primeira vez que o card chega na coluna
    // final, preservado enquanto ele ficar lá, e limpo se ele for movido
    // para fora (ver comentário em negociacoes.js).
    dataFechamento: card.dataFechamento || "",
    obs: card.obs || "",
    messages: Array.isArray(card.messages) ? card.messages : [],
    attachments: Array.isArray(card.attachments) ? card.attachments : [],
    createdAt: card.createdAt || now,
    createdBy: card.createdBy || "",
    createdByName: card.createdByName || "",
    ownerId: card.ownerId || card.createdBy || "",
    ownerName: card.ownerName || card.createdByName || "",
    updatedAt: card.updatedAt || now,
    updatedBy: card.updatedBy || "",
  };
}

export function emptyPessoa() {
  return {
    nome: "", email: "", profissao: "", telefone: "", mesmoEndereco: "sim", endereco: "",
    nacionalidade: "", estadoCivil: "", rg: "", cpf: "",
  };
}
