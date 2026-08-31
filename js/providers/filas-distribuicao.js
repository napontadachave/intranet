/* =========================================================================
   Atendimentos — Distribuição automática de leads por fila.

   A pedido seu: quando um lead é qualificado, em vez de o corretor ficar
   sempre a critério de quem atende (ou nunca ser definido), o atendente
   pode escolher, na hora, uma "fila" cadastrada em Configurações → Gestão
   de Filas e o sistema sugere automaticamente o próximo corretor da vez —
   com opção de pular (com justificativa) até achar quem deve receber.

   Combinado nesta primeira etapa: as filas NÃO são amarradas a um programa
   (Novos Leads / Reativação) — podem existir quantas filas fizerem sentido
   (por empreendimento, por equipe, etc.) e quem está qualificando o lead
   escolhe manualmente qual usar, a cada vez (inclusive nenhuma, se quiser
   deixar sem corretor).

   Mecânica de fila = round-robin simples:
   - `membros` é um array ORDENADO de {id, nome} — o índice 0 é sempre "o
     próximo da vez".
   - Pular um corretor OU escolher ele pra receber o lead têm o mesmo
     efeito sobre a posição dele na fila: ele vai pro FINAL (perde a vez),
     evitando que apareça de novo em seguida. Isso é o que `avancarFila`
     faz de uma vez só (pulados + escolhido, todos pro final, na mesma
     ordem em que foram considerados).
   - Se uma distribuição foi um engano e o lançamento (lead) é excluído, o
     corretor volta para a FRENTE da fila de onde veio — `excluirDistribuicao`
     cuida disso (exclui o lead e devolve o corretor, nessa ordem).

   Gravado no Cloud Firestore (coleção `filasDistribuicao`), mesmo lugar dos
   outros dados novos desta v2 (ver js/providers/atendimentos-cadencia.js). */

import { firestore } from "../firebase-config.js";
import { excluirLeadCadencia } from "./atendimentos-cadencia.js";

const COLECAO = "filasDistribuicao";

function checarFirestore() {
  if (!firestore) throw new Error("Firestore não está disponível.");
}
function col() {
  return firestore.collection(COLECAO);
}
function semId(obj) {
  const { id, ...resto } = obj;
  return resto;
}

export async function listarFilas() {
  checarFirestore();
  const snap = await col().get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function buscarFilaPorId(id) {
  checarFirestore();
  if (!id) return null;
  const doc = await col().doc(id).get();
  return doc.exists ? { ...doc.data(), id } : null;
}

/** Cria ou atualiza uma fila — `membros` já vem na ordem definida pelo
 *  administrador (arrastar não, mas reordenar com ↑/↓, mesmo padrão das
 *  etapas de cadência). */
export async function salvarFila(dados) {
  checarFirestore();
  if (!dados.nome || !dados.nome.trim()) throw new Error("Dê um nome para a fila.");
  const membros = Array.isArray(dados.membros) ? dados.membros.filter((m) => m && m.id) : [];
  const agora = new Date().toISOString();
  if (dados.id) {
    const ref = col().doc(dados.id);
    const atual = await ref.get();
    const doc = {
      ...semId(dados), membros,
      createdAt: atual.exists ? (atual.data().createdAt || agora) : agora,
      updatedAt: agora,
    };
    await ref.set(doc);
    return { id: dados.id, ...doc };
  }
  const doc = { ...semId(dados), membros, createdAt: agora, updatedAt: agora };
  const ref = await col().add(doc);
  return { id: ref.id, ...doc };
}

export async function excluirFila(id) {
  checarFirestore();
  await col().doc(id).delete();
}

/** Depois de uma distribuição (com ou sem pulos), manda pro final da fila,
 *  na ordem em que foram considerados, todo mundo que foi "usado" — quem
 *  foi pulado E quem finalmente recebeu o lead. `quantidadePulos` é quantos
 *  corretores foram pulados antes do escolhido (0 = ninguém pulado, o
 *  primeiro da fila mesmo recebeu). Relê a fila do banco antes de gravar,
 *  pra não sobrescrever uma mudança feita por outra pessoa enquanto o modal
 *  de qualificação estava aberto. */
export async function avancarFila(filaId, quantidadePulos) {
  checarFirestore();
  if (!filaId) return;
  const ref = col().doc(filaId);
  const snap = await ref.get();
  if (!snap.exists) return; // fila pode ter sido excluída nesse meio-tempo — sem problema, só não avança
  const fila = snap.data();
  const membros = Array.isArray(fila.membros) ? fila.membros : [];
  const usados = Math.min(Math.max(quantidadePulos, 0) + 1, membros.length);
  if (usados <= 0) return;
  const novaOrdem = [...membros.slice(usados), ...membros.slice(0, usados)];
  await ref.set({ ...fila, membros: novaOrdem, updatedAt: new Date().toISOString() });
}

/** Devolve um corretor para a FRENTE de uma fila — usado quando uma
 *  distribuição feita por engano é desfeita (exclusão do lead). Remove
 *  qualquer ocorrência anterior dele na fila antes de recolocar na frente,
 *  pra nunca duplicar. Silenciosamente não faz nada se a fila já não
 *  existir mais (não é motivo pra impedir a exclusão do lead). */
export async function devolverCorretorParaFila(filaId, corretorId, corretorNome) {
  checarFirestore();
  if (!filaId || !corretorId) return;
  const ref = col().doc(filaId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const fila = snap.data();
  const membros = (Array.isArray(fila.membros) ? fila.membros : []).filter((m) => m.id !== corretorId);
  membros.unshift({ id: corretorId, nome: corretorNome || "" });
  await ref.set({ ...fila, membros, updatedAt: new Date().toISOString() });
}

/** Exclui um lead distribuído e devolve o corretor à fila de origem, nessa
 *  ordem — usado tanto em Atendimentos quanto em Leads Distribuídos (ver
 *  js/modules/lead-detalhes.js) pra corrigir uma distribuição equivocada.
 *  Se o lead não tiver vindo de uma fila (corretor definido manualmente no
 *  cadastro, sem distribuição), só exclui mesmo. */
export async function excluirDistribuicao(lead) {
  await excluirLeadCadencia(lead.id);
  if (lead.filaId && lead.corretorId) {
    try {
      await devolverCorretorParaFila(lead.filaId, lead.corretorId, lead.corretorNome);
    } catch (e) {
      console.error("Lead excluído, mas não foi possível devolver o corretor à fila:", e);
    }
  }
}
