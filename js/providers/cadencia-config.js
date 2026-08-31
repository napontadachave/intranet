/* =========================================================================
   Atendimentos — Gestão de Cadências e Templates (configuração).

   Combinado como a próxima etapa depois da tela de Atendimentos: em vez de
   cada cadência ficar fixa no código (como estava até aqui, em
   cadencia-defaults.js), agora é o próprio administrador quem cria/edita as
   cadências de cada programa (Novos Leads / Reativação) e os Templates de
   Mensagens reutilizáveis, pela tela de Configurações → "Gestão de
   Cadências e Templates" (ver js/modules/config-cadencias.js).

   Simplificação combinada nesta etapa: o sistema anterior deixava associar
   uma cadência a uma origem específica (várias cadências "ativas" ao mesmo
   tempo, escolhidas pela origem do lead). Aqui, pra manter simples, cada
   programa tem sempre **uma única cadência ativa por vez** — é ela que todo
   lead novo daquele programa recebe. O administrador pode manter várias
   cadências salvas (rascunhos, versões antigas, testes) e alternar qual
   está ativa a qualquer momento; leads que já estão em andamento continuam
   na cadência que foi atribuída a eles na criação (`lead.cadenciaId`),
   mesmo que o administrador troque a cadência ativa do programa depois —
   assim uma mudança de configuração não some com o prazo/etapa de quem já
   está em atendimento.

   Templates de Mensagens são só uma biblioteca reutilizável: o texto de um
   template é copiado para dentro da mensagem da etapa quando o
   administrador escolhe "carregar de um template" no editor de cadência —
   não é uma referência viva (editar o template depois não muda etapas que
   já usaram aquele texto). Mais simples de entender e evita o problema de
   uma cadência quebrar porque alguém excluiu o template que ela usava.
   ========================================================================= */

import { firestore } from "../firebase-config.js";
import { PROGRAMAS } from "./cadencia-defaults.js";

const COL_CADENCIAS = "atendimentosCadenciasConfig";
const COL_TEMPLATES = "atendimentosTemplates";

function checarFirestore() {
  if (!firestore) throw new Error("Firestore não está disponível.");
}

function semId(obj) {
  const { id, ...resto } = obj;
  return resto;
}

function novoIdEtapa() {
  return "et_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function etapaSeed(nome, tipo, tempoValor, tempoUnidade, mensagem) {
  return { id: novoIdEtapa(), nome, tipo, tempoValor, tempoUnidade, mensagem };
}

/** Cadência sugerida de cada programa — só usada para semear a primeira
 *  cadência (já ativa) na primeira vez que um programa é aberto sem
 *  nenhuma cadência salva ainda. Depois disso, o administrador é quem
 *  manda: pode editar, desativar ou excluir essa cadência à vontade. */
const CADENCIAS_SEED = {
  novos_leads: {
    nome: "Cadência padrão",
    descricao: "Sugestão inicial para Novos Leads — ajuste como quiser.",
    etapas: [
      etapaSeed("Primeiro contato", "whatsapp", 0, "minutos",
        "Olá {{nome}}! Aqui é da Na Ponta da Chave 🙂 Vi seu interesse em {{empreendimento}} e vou te ajudar a encontrar a opção ideal. Podemos conversar?"),
      etapaSeed("Follow-up 1", "whatsapp", 1, "dias",
        "Oi {{nome}}, passando pra saber se ainda tem interesse em {{empreendimento}}. Posso te enviar mais opções, se quiser."),
      etapaSeed("Ligação", "ligacao", 2, "dias", ""),
      etapaSeed("Follow-up 2", "whatsapp", 4, "dias",
        "{{nome}}, ainda estou à disposição pra te ajudar a encontrar o imóvel ideal. Consigo te ligar num horário melhor?"),
      etapaSeed("Última tentativa", "whatsapp", 7, "dias",
        "{{nome}}, este é meu último contato por aqui — se ainda tiver interesse, é só me responder. Fico à disposição!"),
    ],
  },
  reativacao: {
    nome: "Cadência padrão",
    descricao: "Sugestão inicial para Reativação — ajuste como quiser.",
    etapas: [
      etapaSeed("Recontato", "whatsapp", 0, "minutos",
        "Olá {{nome}}, tudo bem? Aqui é da Na Ponta da Chave. Faz um tempo desde nosso último contato — ainda procura imóvel na região?"),
      etapaSeed("Follow-up 1", "whatsapp", 2, "dias",
        "Oi {{nome}}, surgiram novidades que podem te interessar. Posso te enviar?"),
      etapaSeed("Ligação", "ligacao", 4, "dias", ""),
      etapaSeed("Última tentativa", "whatsapp", 8, "dias",
        "{{nome}}, caso ainda tenha interesse é só me chamar por aqui. Um abraço!"),
    ],
  },
};

/* ------------------------------- cadências ------------------------------- */

export async function listarCadencias() {
  checarFirestore();
  const snap = await firestore.collection(COL_CADENCIAS).get();
  // `id: d.id` vem DEPOIS do spread dos dados de propósito: garante que o id
  // de verdade do documento sempre vence, mesmo que o documento por algum
  // motivo tenha um campo `id` próprio salvo dentro dele.
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function buscarCadenciaPorId(id) {
  checarFirestore();
  if (!id) return null;
  const doc = await firestore.collection(COL_CADENCIAS).doc(id).get();
  return doc.exists ? { ...doc.data(), id } : null;
}

/** Garante que cada programa tenha ao menos uma cadência salva, semeando a
 *  sugestão padrão (já ativa) nos que ainda não têm nenhuma — chamado tanto
 *  ao abrir Atendimentos quanto a Gestão de Cadências, pra nunca haver um
 *  programa sem nenhuma cadência ativa para atribuir a um lead novo. */
export async function garantirCadenciasPadrao() {
  checarFirestore();
  const existentes = await listarCadencias();
  const programasFaltando = Object.keys(PROGRAMAS).filter((p) => !existentes.some((c) => c.programa === p));
  const agora = new Date().toISOString();
  for (const programa of programasFaltando) {
    const seed = CADENCIAS_SEED[programa];
    if (!seed) continue;
    await firestore.collection(COL_CADENCIAS).add({
      programa, nome: seed.nome, descricao: seed.descricao, ativa: true,
      etapas: seed.etapas, createdAt: agora, updatedAt: agora,
    });
  }
}

export async function salvarCadencia(dados) {
  checarFirestore();
  if (!dados.nome || !dados.nome.trim()) throw new Error("Dê um nome para a cadência.");
  if (!PROGRAMAS[dados.programa]) throw new Error("Selecione o programa da cadência.");
  const agora = new Date().toISOString();
  if (dados.id) {
    const ref = firestore.collection(COL_CADENCIAS).doc(dados.id);
    const atual = await ref.get();
    const doc = { ...semId(dados), createdAt: atual.exists ? (atual.data().createdAt || agora) : agora, updatedAt: agora };
    await ref.set(doc);
    return { id: dados.id, ...doc };
  }
  const doc = { ...semId(dados), createdAt: agora, updatedAt: agora };
  const ref = await firestore.collection(COL_CADENCIAS).add(doc);
  return { id: ref.id, ...doc };
}

/** Marca uma cadência como ativa e desativa as outras do mesmo programa —
 *  só uma cadência ativa por programa de cada vez (ver nota no topo do
 *  arquivo sobre a simplificação em relação ao sistema anterior). */
export async function ativarCadencia(cadenciaId) {
  checarFirestore();
  const todas = await listarCadencias();
  const alvo = todas.find((c) => c.id === cadenciaId);
  if (!alvo) throw new Error("Cadência não encontrada.");
  const agora = new Date().toISOString();
  const batch = firestore.batch();
  todas.filter((c) => c.programa === alvo.programa).forEach((c) => {
    batch.set(firestore.collection(COL_CADENCIAS).doc(c.id), { ...semId(c), ativa: c.id === cadenciaId, updatedAt: agora });
  });
  await batch.commit();
}

export async function desativarCadencia(cadenciaId) {
  checarFirestore();
  const ref = firestore.collection(COL_CADENCIAS).doc(cadenciaId);
  const atual = await ref.get();
  if (!atual.exists) throw new Error("Cadência não encontrada.");
  await ref.set({ ...atual.data(), ativa: false, updatedAt: new Date().toISOString() });
}

export async function duplicarCadencia(cadenciaId) {
  checarFirestore();
  const original = await buscarCadenciaPorId(cadenciaId);
  if (!original) throw new Error("Cadência não encontrada.");
  const etapas = (original.etapas || []).map((e) => ({ ...e, id: novoIdEtapa() }));
  return salvarCadencia({
    programa: original.programa, nome: original.nome + " (cópia)",
    descricao: original.descricao || "", ativa: false, etapas,
  });
}

export async function excluirCadencia(cadenciaId) {
  checarFirestore();
  await firestore.collection(COL_CADENCIAS).doc(cadenciaId).delete();
}

/* ------------------------------- templates ------------------------------- */

export async function listarTemplates() {
  checarFirestore();
  const snap = await firestore.collection(COL_TEMPLATES).get();
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
}

export async function salvarTemplate(dados) {
  checarFirestore();
  if (!dados.nome || !dados.nome.trim()) throw new Error("Dê um nome para o template.");
  if (!dados.texto || !dados.texto.trim()) throw new Error("Escreva o texto do template.");
  const agora = new Date().toISOString();
  if (dados.id) {
    const ref = firestore.collection(COL_TEMPLATES).doc(dados.id);
    const atual = await ref.get();
    const doc = { ...semId(dados), createdAt: atual.exists ? (atual.data().createdAt || agora) : agora, updatedAt: agora };
    await ref.set(doc);
    return { id: dados.id, ...doc };
  }
  const doc = { ...semId(dados), createdAt: agora, updatedAt: agora };
  const ref = await firestore.collection(COL_TEMPLATES).add(doc);
  return { id: ref.id, ...doc };
}

export async function excluirTemplate(templateId) {
  checarFirestore();
  await firestore.collection(COL_TEMPLATES).doc(templateId).delete();
}
