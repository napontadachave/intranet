/* =========================================================================
   Notificações — regras de notificação (Configurações) + notificações
   individuais (sino da topbar).

   A pedido seu: quando um card de Negociações é movimentado entre etapas,
   o usuário responsável pelo card (e, se a regra determinar, outras
   pessoas) deve ser avisado. As regras ficam em Configurações → Gestão de
   Notificações (ver js/modules/config-notificacoes.js) e cada uma escolhe,
   independentemente das outras, se dispara em QUALQUER movimentação ou só
   quando o card cai numa coluna específica.

   Duas coleções no Cloud Firestore, mesmo lugar dos outros dados novos
   desta v2 (filas de distribuição, cadências de Atendimentos):

   - `notificacoesRegras`: a configuração de cada regra —
     { nome, gatilho: "qualquer" | "coluna_especifica", colunaId,
       notificarResponsavel: bool, destinatariosExtras: [{id,nome}],
       ativa: bool, createdAt, updatedAt }

   - `notificacoes`: uma notificação já disparada, por destinatário —
     { usuarioId, titulo, mensagem, lida: bool, criadoEm, rota,
       origemCardId, origemCardTitulo }

   Mesma convenção do resto do projeto: sem `.where()` no Firestore — lê a
   coleção inteira e filtra em JS (evita índice composto em produção e
   funciona igual no mock de teste, que não simula query nenhuma). */

import { firestore } from "../firebase-config.js";

const COL_REGRAS = "notificacoesRegras";
const COL_NOTIFICACOES = "notificacoes";

function checarFirestore() {
  if (!firestore) throw new Error("Firestore não está disponível.");
}
function colRegras() { return firestore.collection(COL_REGRAS); }
function colNotificacoes() { return firestore.collection(COL_NOTIFICACOES); }
function semId(obj) {
  const { id, ...resto } = obj;
  return resto;
}

/* ============================ Regras (CRUD) ============================ */

export async function listarRegras() {
  checarFirestore();
  const snap = await colRegras().get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function salvarRegra(dados) {
  checarFirestore();
  if (!dados.nome || !dados.nome.trim()) throw new Error("Dê um nome para a regra.");
  if (dados.gatilho === "coluna_especifica" && !dados.colunaId) {
    throw new Error("Escolha em qual coluna a regra deve disparar.");
  }
  const destinatariosExtras = Array.isArray(dados.destinatariosExtras)
    ? dados.destinatariosExtras.filter((d) => d && d.id)
    : [];
  const agora = new Date().toISOString();
  const base = {
    ...semId(dados),
    gatilho: dados.gatilho === "coluna_especifica" ? "coluna_especifica" : "qualquer",
    colunaId: dados.gatilho === "coluna_especifica" ? dados.colunaId : "",
    notificarResponsavel: !!dados.notificarResponsavel,
    destinatariosExtras,
    ativa: dados.ativa !== false,
  };
  if (dados.id) {
    const ref = colRegras().doc(dados.id);
    const atual = await ref.get();
    const doc = { ...base, createdAt: atual.exists ? (atual.data().createdAt || agora) : agora, updatedAt: agora };
    await ref.set(doc);
    return { id: dados.id, ...doc };
  }
  const doc = { ...base, createdAt: agora, updatedAt: agora };
  const ref = await colRegras().add(doc);
  return { id: ref.id, ...doc };
}

export async function excluirRegra(id) {
  checarFirestore();
  await colRegras().doc(id).delete();
}

/* ========================= Notificações (por usuário) ========================= */

export async function listarNotificacoes(usuarioId) {
  checarFirestore();
  const snap = await colNotificacoes().get();
  return snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((n) => !usuarioId || n.usuarioId === usuarioId)
    .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
}

export async function criarNotificacao({ usuarioId, titulo, mensagem, rota, origemCardId, origemCardTitulo }) {
  checarFirestore();
  if (!usuarioId) return null;
  const doc = {
    usuarioId, titulo: titulo || "", mensagem: mensagem || "",
    rota: rota || "", origemCardId: origemCardId || "", origemCardTitulo: origemCardTitulo || "",
    lida: false, criadoEm: new Date().toISOString(),
  };
  const ref = await colNotificacoes().add(doc);
  return { id: ref.id, ...doc };
}

export async function marcarNotificacaoLida(id) {
  checarFirestore();
  const ref = colNotificacoes().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set({ ...snap.data(), lida: true });
}

export async function marcarTodasLidas(usuarioId) {
  checarFirestore();
  const naoLidas = (await listarNotificacoes(usuarioId)).filter((n) => !n.lida);
  await Promise.all(naoLidas.map((n) => marcarNotificacaoLida(n.id)));
}

/* ==================== Disparo automático ao mover um card ==================== */

/** Avalia as regras ativas contra uma movimentação de card entre colunas do
 *  kanban de Negociações e cria uma notificação para cada destinatário que
 *  cada regra determinar. Chamada tanto no drag-and-drop quanto no salvar
 *  do formulário de edição (os dois jeitos de "mover um card entre etapas")
 *  — ver js/modules/negociacoes.js.
 *
 *  Decisões assumidas (sinalizadas para você, revisitar se fizer sentido
 *  diferente):
 *  - Só dispara se a coluna realmente mudou (evita notificação ao salvar o
 *    formulário sem mexer na coluna, ou ao soltar o card na mesma coluna).
 *  - Quem moveu o card não notifica a si mesmo, mesmo se for o responsável
 *    ou estiver na lista de destinatários extras da regra.
 *  - Uma pessoa que apareça em mais de uma regra (ou como responsável E
 *    destinatário extra da mesma regra) só recebe UMA notificação por
 *    movimentação. */
export async function avaliarRegrasParaMovimentacao(card, colunaAnteriorId, colunaNovaId, columns, ator) {
  if (!colunaNovaId || colunaAnteriorId === colunaNovaId) return;
  let regras = [];
  try {
    regras = (await listarRegras()).filter((r) => r.ativa !== false);
  } catch (e) {
    console.error("Não foi possível avaliar as regras de notificação:", e);
    return;
  }
  if (!regras.length) return;

  const nomeColunaNova = columns.find((c) => c.id === colunaNovaId)?.title || colunaNovaId;
  const atorId = ator?.id || "";
  const atorNome = ator?.name || "Alguém";

  const destinatarios = new Map(); // id -> nome
  regras.forEach((regra) => {
    const combina = regra.gatilho === "coluna_especifica" ? regra.colunaId === colunaNovaId : true;
    if (!combina) return;
    if (regra.notificarResponsavel && card.ownerId) {
      destinatarios.set(card.ownerId, card.ownerName || "");
    }
    (regra.destinatariosExtras || []).forEach((d) => {
      if (d && d.id) destinatarios.set(d.id, d.nome || "");
    });
  });
  destinatarios.delete(atorId); // quem moveu não precisa ser avisado sobre a própria ação

  if (!destinatarios.size) return;

  const titulo = "Negociação movida de etapa";
  const mensagem = `"${card.title || "Negociação"}" foi movida para "${nomeColunaNova}" por ${atorNome}.`;
  await Promise.all([...destinatarios.keys()].map((usuarioId) => criarNotificacao({
    usuarioId, titulo, mensagem, rota: "negociacoes",
    origemCardId: card.id || "", origemCardTitulo: card.title || "",
  }).catch((e) => console.error("Falha ao criar notificação para", usuarioId, e))));
}
