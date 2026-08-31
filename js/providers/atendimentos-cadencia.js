/* =========================================================================
   Atendimentos — Cadências (Novos Leads / Reativação).

   Substitui a antiga "fila de atendimento" + "regras de distribuição
   automática" (bespoke desta v2, sem dado real de produção) por uma versão
   nova da tela "Cadências SDR" do sistema anterior — mesma ideia de lead
   percorrendo uma sequência de etapas com prazo, mas as duas telas antigas
   (Novos Leads / Reativação) viraram duas ABAS de uma tela só, porque no
   sistema anterior elas já eram exatamente a mesma view, só filtrada por um
   campo `programa` (ver `js/modules/leads.js`).

   Gravado 100% no Cloud Firestore — mesma decisão já tomada para os
   Registros Diários (ver js/providers/registros-diarios.js para o porquê).
   Coleção nova e vazia (`atendimentosCadencia`): o sistema anterior está
   desativado, então não há histórico de "sdrLeadsCadencia" (Realtime
   Database) para migrar.

   Escopo combinado para esta etapa: só a lista principal + as ações do
   dia a dia de cada lead (registrar contato, concluir etapa, adiar,
   qualificar, marcar como perdido, histórico). Ficam para uma etapa
   seguinte: Dashboard de Cadências e a importação automática de leads a
   partir da planilha "Atendimentos — Vendas" da Análise 360°. Sem
   importação automática ainda, o cadastro de um lead novo é sempre manual
   (botão "+ Novo lead").

   Cadências e Templates deixaram de ser fixos no código — agora são
   configuráveis pelo administrador (ver js/providers/cadencia-config.js e
   a tela em Configurações → Gestão de Cadências e Templates). Todo lead
   novo é atribuído à cadência ATIVA do seu programa no momento da criação
   (`lead.cadenciaId`) e continua seguindo essa mesma cadência até o fim,
   mesmo que o administrador troque depois qual cadência está ativa —
   assim uma mudança de configuração nunca "puxa o tapete" de quem já está
   em atendimento.

   A pedido seu, "Qualificar Lead" agora também pode DISTRIBUIR o lead para
   um corretor por fila (ver js/providers/filas-distribuicao.js) — por isso
   `qualificarLead` aceita corretor/fila opcionais, que sobrescrevem o
   corretor do lead antes de decidir a situação. */

import { firestore } from "../firebase-config.js";
import { calcularPrevistoPara, SITUACOES_QUALIFICADAS } from "./cadencia-defaults.js";
import { buscarCadenciaPorId } from "./cadencia-config.js";

const COLECAO = "atendimentosCadencia";

function checarFirestore() {
  if (!firestore) throw new Error("Firestore não está disponível.");
}
function col() {
  return firestore.collection(COLECAO);
}

function situacaoTerminal(situacao) {
  return situacao === "Perdido" || SITUACOES_QUALIFICADAS.indexOf(situacao) !== -1;
}

/** Etapas da cadência à qual o lead foi atribuído na criação — busca no
 *  Firestore pelo `cadenciaId` gravado no próprio lead (não pela cadência
 *  "ativa" do programa agora, que pode já ter mudado). */
async function etapasDoLead(lead) {
  if (!lead.cadenciaId) return [];
  const cadencia = await buscarCadenciaPorId(lead.cadenciaId);
  return cadencia?.etapas || [];
}

/** Agenda (ou encerra) a próxima atividade do lead, conforme a lista de
 *  etapas da cadência atribuída a ele e o índice de etapa atual — mesma
 *  lógica de `sdrAgendarProximaAtividade` do sistema anterior. */
function agendarProximaAtividade(lead, baseDate, etapas) {
  const etapaAtual = (etapas || [])[lead.etapaAtualIndex];
  if (!etapaAtual) {
    lead.proximaAtividade = null;
    lead.cadenciaEncerrada = true;
    return;
  }
  lead.proximaAtividade = {
    etapaNome: etapaAtual.nome,
    tipo: etapaAtual.tipo,
    previstoPara: calcularPrevistoPara(etapaAtual, baseDate),
  };
}

export async function listarLeadsCadencia() {
  checarFirestore();
  const snap = await col().get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Cadastro manual de um lead novo — o sistema anterior só recebia leads via
 *  sincronização automática do CRM ou importação da Análise 360° (nenhuma
 *  das duas existe nesta etapa), então esta tela precisa de um jeito de
 *  criar um lead — adicionado a pedido, além do escopo original.
 *  `cadencia` é a cadência ATIVA do programa escolhido no momento do
 *  cadastro (buscada por quem chama — ver `js/modules/leads.js`); fica
 *  gravada no lead (`cadenciaId`/`cadenciaNome`) e é ela que define a
 *  primeira etapa e o prazo da primeira atividade. */
export async function criarLeadCadencia({
  programa, cadencia, leadNome, leadTelefone, leadEmail, origem, empreendimento,
  corretorId, corretorNome, sdrResponsavelId, sdrResponsavelNome, criadoPorId,
}) {
  checarFirestore();
  if (!programa) throw new Error("Programa inválido.");
  if (!leadNome || !leadNome.trim()) throw new Error("Informe o nome do lead.");
  if (!sdrResponsavelId) throw new Error("Selecione o responsável pelo atendimento.");
  if (!cadencia || !cadencia.id) {
    throw new Error("Nenhuma cadência ativa configurada para este programa. Configure uma em Configurações → Gestão de Cadências e Templates.");
  }

  const agora = new Date();
  const agoraISO = agora.toISOString();
  const lead = {
    programa,
    cadenciaId: cadencia.id,
    cadenciaNome: cadencia.nome || "",
    leadNome: leadNome.trim(),
    leadTelefone: (leadTelefone || "").trim(),
    leadEmail: (leadEmail || "").trim(),
    origem: (origem || "").trim(),
    empreendimento: (empreendimento || "").trim(),
    corretorId: corretorId || "",
    corretorNome: corretorNome || "",
    sdrResponsavelId,
    sdrResponsavelNome: sdrResponsavelNome || "",
    situacao: "Novo",
    etapaAtualIndex: 0,
    cadenciaEncerrada: false,
    proximaAtividade: null,
    atividades: [],
    timeline: [{ texto: `Lead cadastrado manualmente — cadência "${cadencia.nome || ""}".`, tipo: "situacao", criadoEm: agoraISO }],
    origemImportacao: "manual",
    dataAtendimento: agoraISO.slice(0, 10),
    createdAt: agoraISO,
    createdBy: criadoPorId || "",
    updatedAt: agoraISO,
  };
  agendarProximaAtividade(lead, agora, cadencia.etapas || []);
  const ref = await col().add(lead);
  return { id: ref.id, ...lead };
}

/** Lê o lead, aplica a mutação (síncrona ou assíncrona) e grava de volta —
 *  mesmo padrão "find + mutate + doSave()" do sistema anterior, adaptado a
 *  documento único do Firestore em vez de um array grande num só nó do
 *  RTDB. */
async function salvar(leadId, mutFn) {
  checarFirestore();
  const ref = col().doc(leadId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Lead não encontrado — a lista pode estar desatualizada.");
  const lead = { id: leadId, ...snap.data() };
  lead.atividades = Array.isArray(lead.atividades) ? lead.atividades : [];
  lead.timeline = Array.isArray(lead.timeline) ? lead.timeline : [];
  await mutFn(lead);
  lead.updatedAt = new Date().toISOString();
  const { id, ...dados } = lead;
  await ref.set(dados);
  return lead;
}

/** "Registrar contato" — só loga a atividade, não avança a etapa nem mexe
 *  na próxima atividade agendada (mesmo comportamento de
 *  `sdrAbrirRegistroAtividade`/`sdrSalvarAtividade`). */
export async function registrarAtividade(leadId, { tipo, resultado, observacoes, usuarioId, usuarioNome }) {
  return salvar(leadId, (lead) => {
    const agora = new Date().toISOString();
    lead.atividades.push({
      id: "at_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      data: agora, tipo, resultado: resultado || "", observacoes: observacoes || "",
      usuarioId: usuarioId || "", usuarioNome: usuarioNome || "", criadoEm: agora,
    });
    lead.timeline.push({
      texto: `Contato registrado (${tipo})${resultado ? " — " + resultado : ""}`,
      tipo: "atividade", criadoEm: agora,
    });
  });
}

/** "Concluir etapa" — loga a atividade, sai de "Novo" para "Em Cadência" na
 *  primeira etapa concluída, avança o índice e reagenda (ou encerra, se não
 *  houver próxima etapa) — mesma lógica de `sdrConcluirEtapa`. */
export async function concluirEtapa(leadId, { resultado, observacoes, usuarioId, usuarioNome }) {
  return salvar(leadId, async (lead) => {
    if (lead.cadenciaEncerrada) throw new Error("Esta cadência já foi encerrada.");
    const etapas = await etapasDoLead(lead);
    const agora = new Date();
    const agoraISO = agora.toISOString();
    const etapaAtual = etapas[lead.etapaAtualIndex];
    lead.atividades.push({
      id: "at_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      data: agoraISO, tipo: etapaAtual?.tipo || "tarefa",
      resultado: resultado || "", observacoes: observacoes || "",
      usuarioId: usuarioId || "", usuarioNome: usuarioNome || "", criadoEm: agoraISO,
    });
    lead.timeline.push({
      texto: `Etapa concluída: ${etapaAtual?.nome || "-"}${resultado ? " — " + resultado : ""}`,
      tipo: "etapa", criadoEm: agoraISO,
    });
    if (lead.situacao === "Novo") lead.situacao = "Em Cadência";
    lead.etapaAtualIndex = (lead.etapaAtualIndex || 0) + 1;
    agendarProximaAtividade(lead, agora, etapas);
    if (lead.cadenciaEncerrada) {
      lead.timeline.push({ texto: "Cadência concluída — sem próximas etapas.", tipo: "situacao", criadoEm: agoraISO });
    }
  });
}

/** "Adiar" — só muda a data prevista da próxima atividade, sem mexer na
 *  etapa (mesma lógica de `sdrConfirmarAdiar`). */
export async function adiarProximaAtividade(leadId, { novoPrevistoPara, motivo }) {
  if (!novoPrevistoPara) throw new Error("Informe a nova data/hora.");
  return salvar(leadId, (lead) => {
    if (lead.cadenciaEncerrada) throw new Error("Esta cadência já foi encerrada.");
    const agora = new Date().toISOString();
    lead.proximaAtividade = lead.proximaAtividade
      ? { ...lead.proximaAtividade, previstoPara: novoPrevistoPara }
      : { etapaNome: "-", tipo: "tarefa", previstoPara: novoPrevistoPara };
    const dataFmt = new Date(novoPrevistoPara).toLocaleString("pt-BR");
    lead.timeline.push({
      texto: `Próxima atividade adiada para ${dataFmt}${motivo ? " — " + motivo : ""}`,
      tipo: "situacao", criadoEm: agora,
    });
  });
}

/** "Qualificar Lead" — encerra a cadência e vira "Encaminhado ao Corretor"
 *  (se já houver um corretor vinculado) ou "Qualificado" (mesma lógica de
 *  `sdrConfirmarQualificar`, sem a tentativa de repasse pra um módulo de
 *  cadastro de lead oficial, que não existe nesta versão).
 *
 *  `corretorId`/`corretorNome`/`filaId`/`filaNome`/`pulos` são opcionais e
 *  vêm do fluxo de distribuição por fila (ver js/providers/filas-distribuicao.js
 *  e js/modules/lead-detalhes.js): quando presentes, sobrescrevem o corretor
 *  do lead ANTES de decidir a situação — é o que faz um lead sem corretor
 *  nenhum virar "Encaminhado ao Corretor" ao ser distribuído. `pulos` é só
 *  a lista de {nome, motivo} pulados antes de chegar no escolhido, usada
 *  aqui só para deixar registrado na timeline (a rotação de fato da fila é
 *  responsabilidade de quem chama, via `avancarFila`). Sem nenhum desses
 *  campos, o comportamento é idêntico ao de antes (corretor definido
 *  manualmente no cadastro, ou nenhum). */
export async function qualificarLead(leadId, { motivo, observacoes, usuarioId, usuarioNome, corretorId, corretorNome, filaId, filaNome, pulos }) {
  if (!motivo) throw new Error("Selecione o motivo da qualificação.");
  return salvar(leadId, (lead) => {
    if (situacaoTerminal(lead.situacao)) throw new Error("Este lead já está encerrado.");
    const agora = new Date().toISOString();
    lead.motivoQualificacao = motivo;
    lead.qualificadoEm = agora;
    lead.qualificadoPorId = usuarioId || "";
    lead.qualificadoPorNome = usuarioNome || "";
    lead.cadenciaEncerrada = true;
    lead.proximaAtividade = null;
    lead.timeline.push({
      texto: `Lead qualificado — motivo: ${motivo}${observacoes ? " — " + observacoes : ""}`,
      tipo: "situacao", criadoEm: agora,
    });
    if (corretorId) {
      (pulos || []).forEach((p) => {
        lead.timeline.push({ texto: `Fila "${filaNome || ""}": pulou ${p.nome} — ${p.motivo}`.trim(), tipo: "situacao", criadoEm: agora });
      });
      lead.corretorId = corretorId;
      lead.corretorNome = corretorNome || "";
      lead.filaId = filaId || "";
      lead.filaNome = filaNome || "";
      lead.distribuidoEm = agora;
      lead.timeline.push({
        texto: filaId
          ? `Distribuído para o corretor ${corretorNome || ""} pela fila "${filaNome || ""}".`.trim()
          : `Encaminhado para o corretor ${corretorNome || ""}`.trim(),
        tipo: "situacao", criadoEm: agora,
      });
    } else if (lead.corretorId) {
      lead.timeline.push({ texto: `Encaminhado para o corretor ${lead.corretorNome || ""}`.trim(), tipo: "situacao", criadoEm: agora });
    }
    lead.situacao = lead.corretorId ? "Encaminhado ao Corretor" : "Qualificado";
  });
}

/** "Marcar como Perdido" — mesma lógica de `sdrConfirmarPerdido`. */
export async function marcarPerdido(leadId, { motivo, detalhe, usuarioId, usuarioNome }) {
  if (!motivo) throw new Error("Selecione o motivo da perda.");
  return salvar(leadId, (lead) => {
    if (situacaoTerminal(lead.situacao)) throw new Error("Este lead já está encerrado.");
    const agora = new Date().toISOString();
    lead.situacao = "Perdido";
    lead.motivoPerda = motivo;
    lead.perdidoEm = agora;
    lead.perdidoPorId = usuarioId || "";
    lead.perdidoPorNome = usuarioNome || "";
    lead.cadenciaEncerrada = true;
    lead.proximaAtividade = null;
    lead.timeline.push({
      texto: `Lead perdido — motivo: ${motivo}${detalhe ? " — " + detalhe : ""}`,
      tipo: "situacao", criadoEm: agora,
    });
  });
}

/** Exclusão definitiva — não existia no sistema anterior (lá, um lead só
 *  saía da lista virando "Perdido"), mas é útil aqui para um admin corrigir
 *  um cadastro manual feito errado. Por isso é restrita a quem já pode ver
 *  a lista inteira (ver `podeVerTodos()` em leads.js). */
export async function excluirLeadCadencia(leadId) {
  checarFirestore();
  await col().doc(leadId).delete();
}
