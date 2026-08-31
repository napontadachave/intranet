/* =========================================================================
   Registros Diários — Vendas, Captação, Atendimento e Visitas.

   Gravados direto no Cloud Firestore (não no Realtime Database que o resto
   do app usa hoje via sync.js). Decisão combinada: a Intranet 2.0 vai migrar
   de vez para o Firestore, mas fazer isso pra TODO o app de uma vez (usuários,
   leads, negociações, kanban, imóveis...) é uma reescrita grande demais pra
   fazer no meio desta entrega. Este módulo já nasce 100% Firestore — do
   mesmo jeito que a Análise 360° (ver analise360-provider.js) — e o resto do
   app migra depois, num projeto à parte.

   Como o sistema atual (Intranet_91.html) foi combinado como desativado (não
   roda mais em paralelo), estas três telas começam com coleções NOVAS e
   vazias no Firestore — não há necessidade de importar histórico do
   Realtime Database. Os nomes de campo, porém, foram mantidos o mais
   parecido possível dos equivalentes que existiam no sistema anterior
   (ver comentários abaixo), só pra facilitar caso um dia haja necessidade
   de comparar ou migrar dados antigos.

   Modelo de dados (bem mais simples que o das planilhas da Análise 360°,
   porque aqui cada lançamento é pequeno e frequente, não uma importação
   gigante de uma vez só):
   - "Registro Diário - Vendas": um DOCUMENTO por lançamento (várias pessoas
     podem lançar mais de uma vez no mesmo dia — cada lançamento SOMA, não
     substitui — mesmo comportamento que o "Lançamento de performance" do
     sistema anterior).
   - "Captação" e "Atendimento e Visitas": um documento por pessoa por dia,
     com ID previsível (`${userId}_${data}`) — salvar de novo no mesmo dia
     ATUALIZA o registro em vez de duplicar (mesmo comportamento de sempre).
   ========================================================================= */

import { firestore } from "../firebase-config.js";

export const REGISTROS_TIPOS = {
  vendas: { colecao: "registrosDiariosVendas", label: "Registro Diário - Vendas" },
  captacao: { colecao: "registrosDiariosCaptacao", label: "Registro Diário - Captação" },
  atendimento: { colecao: "registrosDiariosAtendimento", label: "Registro Diário - Atendimento e Visitas" },
};

function checarFirestore() {
  if (!firestore) throw new Error("Firestore não está disponível.");
}

/* ------------------------- Vendas (múltiplos lançamentos por dia) ------------------------- */

/** Salva um novo lançamento de Vendas — sempre ADICIONA (não procura nem
 *  substitui um lançamento existente no mesmo dia), igual ao sistema
 *  anterior: quem lança duas vezes no mesmo dia tem os dois somados. */
export async function salvarLancamentoVendas({ userId, userName, data, vendas, propostas, visitas, captacoes, contatos, obs, criadoPorId }) {
  checarFirestore();
  if (!userId || !data) throw new Error("Selecione o colaborador e a data.");
  const doc = {
    userId, userName: userName || "",
    data,
    vendas: Number(vendas) || 0,
    propostas: Number(propostas) || 0,
    visitas: Number(visitas) || 0,
    captacoes: Number(captacoes) || 0,
    contatos: Number(contatos) || 0,
    obs: String(obs || "").trim(),
    createdAt: new Date().toISOString(),
    createdBy: criadoPorId || userId,
  };
  const ref = await firestore.collection(REGISTROS_TIPOS.vendas.colecao).add(doc);
  return { id: ref.id, ...doc };
}

export async function listarLancamentosVendas() {
  checarFirestore();
  const snap = await firestore.collection(REGISTROS_TIPOS.vendas.colecao).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function excluirLancamentoVendas(id) {
  checarFirestore();
  await firestore.collection(REGISTROS_TIPOS.vendas.colecao).doc(id).delete();
}

/* --------------- Captação / Atendimento (1 registro por pessoa por dia) --------------- */

function idRegistroDoDia(userId, data) {
  return `${userId}_${data}`;
}

/** Cria ou atualiza (upsert) o registro de um dia — salvar de novo no mesmo
 *  dia atualiza os números, não duplica, igual ao sistema anterior. */
export async function salvarRegistroDoDia(tipoId, { userId, userName, data, campos }) {
  checarFirestore();
  const tipo = REGISTROS_TIPOS[tipoId];
  if (!tipo) throw new Error(`Tipo de registro desconhecido: ${tipoId}`);
  if (!userId || !data) throw new Error("Selecione o colaborador e a data.");
  const ref = firestore.collection(tipo.colecao).doc(idRegistroDoDia(userId, data));
  const existente = await ref.get();
  const agora = new Date().toISOString();
  const doc = {
    userId, userName: userName || "", data,
    ...campos,
    createdAt: existente.exists ? (existente.data().createdAt || agora) : agora,
    updatedAt: agora,
  };
  await ref.set(doc);
  return { id: ref.id, ...doc };
}

/** Busca o registro já lançado por uma pessoa num dia específico — usado
 *  pra pré-preencher o formulário quando a pessoa escolhe uma data que já
 *  tem lançamento (evita duplicar sem querer). */
export async function buscarRegistroDoDia(tipoId, userId, data) {
  checarFirestore();
  const tipo = REGISTROS_TIPOS[tipoId];
  if (!tipo || !userId || !data) return null;
  const doc = await firestore.collection(tipo.colecao).doc(idRegistroDoDia(userId, data)).get();
  return doc.exists ? doc.data() : null;
}

export async function listarRegistros(tipoId) {
  checarFirestore();
  const tipo = REGISTROS_TIPOS[tipoId];
  if (!tipo) throw new Error(`Tipo de registro desconhecido: ${tipoId}`);
  const snap = await firestore.collection(tipo.colecao).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function excluirRegistro(tipoId, docId) {
  checarFirestore();
  const tipo = REGISTROS_TIPOS[tipoId];
  if (!tipo) throw new Error(`Tipo de registro desconhecido: ${tipoId}`);
  await firestore.collection(tipo.colecao).doc(docId).delete();
}
