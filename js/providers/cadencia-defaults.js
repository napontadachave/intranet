/* =========================================================================
   Atendimentos — Cadências: parâmetros e utilitários compartilhados.

   As cadências e os templates de mensagem em si agora são configuráveis
   pelo administrador em Configurações → Gestão de Cadências e Templates
   (ver js/providers/cadencia-config.js, que também guarda a cadência
   "semente" usada só na primeira vez que cada programa é aberto, antes de
   existir qualquer cadência salva). Este arquivo ficou só com as listas
   fixas (tipos de atividade, motivos, variáveis) e as funções puras usadas
   tanto pelo editor quanto pelo motor de cadência (`atendimentos-cadencia.js`).
   ========================================================================= */

export const PROGRAMAS = {
  novos_leads: { id: "novos_leads", label: "Novos Leads" },
  reativacao: { id: "reativacao", label: "Reativação" },
};

export const TIPOS_ATIVIDADE = [
  ["whatsapp", "WhatsApp"],
  ["ligacao", "Ligação"],
  ["email", "E-mail"],
  ["sms", "SMS"],
  ["tarefa", "Tarefa"],
];

export function labelTipoAtividade(tipo) {
  return (TIPOS_ATIVIDADE.find((t) => t[0] === tipo) || [, tipo])[1] || tipo || "-";
}

export const UNIDADES_TEMPO = [
  ["minutos", "Minutos"],
  ["horas", "Horas"],
  ["dias", "Dias"],
];

export const MOTIVOS_QUALIFICACAO = [
  "Interesse em compra",
  "Interesse em venda",
  "Agendar visita",
  "Possui financiamento",
  "Cliente pronto para atendimento",
  "Outro",
];

export const MOTIVOS_PERDA = [
  "Não respondeu",
  "Número inválido",
  "Sem interesse",
  "Comprou com concorrente",
  "Não possui crédito",
  "Apenas pesquisando",
  "Duplicado",
  "Contato inexistente",
  "Outro",
];

// Mesma lista do sistema anterior: além de "Qualificado" puro, uma vez
// encaminhado ao corretor o lead também conta como qualificado nos filtros.
export const SITUACOES_QUALIFICADAS = ["Qualificado", "Encaminhado ao Corretor"];

// Categorias de Templates de Mensagens, iguais às do sistema anterior.
export const CATEGORIAS_TEMPLATE = ["Primeiro contato", "Follow-up", "Reagendamento", "Reaquecimento"];

// Variáveis aceitas em qualquer mensagem (etapa de cadência ou template) —
// usadas tanto para montar os botões de "inserir variável" no editor quanto
// por `substituirVariaveis` na hora de mostrar a mensagem pronta pro lead.
export const VARIAVEIS = [
  ["nome", "Nome"],
  ["telefone", "Telefone"],
  ["empreendimento", "Empreendimento"],
  ["origem", "Origem"],
  ["corretor", "Corretor"],
];

function tempoParaMs(valor, unidade) {
  const n = Number(valor) || 0;
  if (unidade === "minutos") return n * 60 * 1000;
  if (unidade === "horas") return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000; // dias
}

/** Calcula quando a próxima etapa deveria acontecer, a partir de uma data-base. */
export function calcularPrevistoPara(etapaObj, baseDate) {
  const base = baseDate instanceof Date ? baseDate.getTime() : new Date(baseDate).getTime();
  return new Date(base + tempoParaMs(etapaObj.tempoValor, etapaObj.tempoUnidade)).toISOString();
}

/** Troca {{variavel}} pelos dados do lead — mesmas variáveis do sistema
 *  anterior (Nome, Telefone, Empreendimento, Origem, Corretor). */
export function substituirVariaveis(texto, lead) {
  if (!texto) return "";
  return texto
    .replace(/\{\{\s*nome\s*\}\}/gi, lead.leadNome || "")
    .replace(/\{\{\s*telefone\s*\}\}/gi, lead.leadTelefone || "")
    .replace(/\{\{\s*empreendimento\s*\}\}/gi, lead.empreendimento || "(o imóvel)")
    .replace(/\{\{\s*origem\s*\}\}/gi, lead.origem || "")
    .replace(/\{\{\s*corretor\s*\}\}/gi, lead.corretorNome || "");
}

/** Mensagem sugerida da etapa em que o lead está agora, com as variáveis já
 *  substituídas — ou null se a etapa não tiver mensagem (ex.: ligação), a
 *  cadência já tiver sido encerrada, ou a lista de etapas não tiver sido
 *  carregada. `etapas` é a lista de etapas da cadência à qual o lead está
 *  vinculado (`lead.cadenciaId`) — quem chama é responsável por buscá-la
 *  (ver `cadenciasPorId` em js/modules/leads.js). */
export function mensagemEtapaAtual(lead, etapas) {
  if (lead.cadenciaEncerrada) return null;
  const atual = (etapas || [])[lead.etapaAtualIndex];
  if (!atual || !atual.mensagem) return null;
  return substituirVariaveis(atual.mensagem, lead);
}
