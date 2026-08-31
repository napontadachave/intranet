/* =========================================================================
   Leads Distribuídos.

   A pedido seu: tela nova, separada de Atendimentos, pra acompanhar os
   leads que já foram qualificados e têm um corretor responsável (situação
   "Encaminhado ao Corretor") — seja porque foram distribuídos por uma fila
   (Configurações → Gestão de Filas, ver js/providers/filas-distribuicao.js
   e o modal de Qualificar em js/modules/lead-detalhes.js) ou porque já
   tinham um corretor vinculado desde o cadastro manual em Atendimentos.

   Mesmo registro (coleção `atendimentosCadencia`), mesmo modal de detalhes
   e mesmas ações do dia a dia de js/modules/lead-detalhes.js — só a
   VISIBILIDADE muda: aqui é por CORRETOR (quem vai atender o cliente dali
   pra frente), não por responsável de SDR como em Atendimentos. Um mesmo
   lead pode continuar aparecendo em Atendimentos (aba "Qualificados") E
   aqui ao mesmo tempo — são duas visões do mesmo dado, uma pra quem fez a
   qualificação, outra pra quem recebeu o lead.

   Se uma distribuição foi um engano, excluir o lead aqui (via o modal de
   detalhes) devolve o corretor para a FRENTE da fila de onde veio — ver
   `excluirDistribuicao` em js/providers/filas-distribuicao.js. */

import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { toast, esc, fmtDateTime } from "../ui-kit.js";
import { listarLeadsCadencia } from "../providers/atendimentos-cadencia.js";
import { garantirCadenciasPadrao, listarCadencias } from "../providers/cadencia-config.js";
import { listarFilas } from "../providers/filas-distribuicao.js";
import { abrirDetalhesLead, situacaoTagHtml, fmtDataBR } from "./lead-detalhes.js";

function podeVerTodos() {
  const me = getCurrentUser();
  return isAdmin(me) || !!me?.perms?.view_all_users;
}

function renderCard(lead) {
  return `<div class="kanban-card" style="cursor:default">
    <b>${esc(lead.leadNome)}</b>
    <div class="meta">${esc(lead.leadTelefone || "sem telefone")}</div>
    <div class="meta">Origem: ${esc(lead.origem || "-")}</div>
    <div class="meta">Empreendimento: ${esc(lead.empreendimento || "-")}</div>
    <div class="meta"><b>Corretor: ${esc(lead.corretorNome || "-")}</b></div>
    ${lead.filaNome ? `<div class="meta">Fila: ${esc(lead.filaNome)}</div>` : ""}
    <div class="meta">Distribuído em: ${lead.distribuidoEm ? fmtDateTime(lead.distribuidoEm) : fmtDataBR(lead.dataAtendimento)}</div>
    <div style="margin:8px 0">${situacaoTagHtml(lead.situacao)}</div>
    <div class="card-actions"><button type="button" class="btn secondary" data-abrir="${esc(lead.id)}">Abrir</button></div>
  </div>`;
}

/** Data usada nos filtros de período e na ordenação: o dia da distribuição
 *  em si (`distribuidoEm`), ou o dia do atendimento original pra quem já
 *  tinha corretor vinculado no cadastro manual (sem passar por fila). */
function dataEfetiva(lead) {
  return (lead.distribuidoEm ? String(lead.distribuidoEm).slice(0, 10) : lead.dataAtendimento) || "";
}

export function renderLeadsDistribuidos(mount) {
  let vivo = true;
  const filtro = { corretorId: "", busca: "", dataDe: "", dataAte: "" };
  const ctx = { leads: [], cadenciasPorId: new Map(), filas: [], erros: [] };

  /** Mesmo padrão resiliente já usado em Atendimentos e na Análise 360°:
   *  cada leitura independente, pra uma falha de permissão numa coleção
   *  não derrubar as outras (ver nota em js/modules/leads.js). */
  async function carregar() {
    const erros = [];
    try { await garantirCadenciasPadrao(); } catch (e) { erros.push({ label: "Cadências (verificação inicial)", mensagem: e.message }); }
    try {
      const todos = await listarLeadsCadencia();
      ctx.leads = todos.filter((l) => l.situacao === "Encaminhado ao Corretor");
    } catch (e) { erros.push({ label: "Leads", mensagem: e.message }); ctx.leads = []; }
    try { ctx.cadenciasPorId = new Map((await listarCadencias()).map((c) => [c.id, c])); } catch (e) { erros.push({ label: "Cadências", mensagem: e.message }); ctx.cadenciasPorId = new Map(); }
    try { ctx.filas = await listarFilas(); } catch (e) { erros.push({ label: "Filas de distribuição", mensagem: e.message }); ctx.filas = []; }
    ctx.erros = erros;
    if (erros.length) toast("Erro ao carregar: " + erros.map((er) => er.label).join(", "), "warn");
    if (vivo) pintar();
  }

  function corretoresComLead() {
    const vistos = new Map();
    ctx.leads.forEach((l) => { if (l.corretorId && !vistos.has(l.corretorId)) vistos.set(l.corretorId, l.corretorNome || l.corretorId); });
    return [...vistos.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }

  function pintar() {
    const me = getCurrentUser();
    const admin = podeVerTodos();
    const visiveis = admin ? ctx.leads : ctx.leads.filter((l) => l.corretorId === me?.id);
    const busca = filtro.busca.trim().toLowerCase();
    const filtrados = visiveis
      .filter((l) => !(admin && filtro.corretorId) || l.corretorId === filtro.corretorId)
      .filter((l) => !busca || (l.leadNome || "").toLowerCase().indexOf(busca) !== -1 || (l.leadTelefone || "").toLowerCase().indexOf(busca) !== -1)
      .filter((l) => !filtro.dataDe || dataEfetiva(l) >= filtro.dataDe)
      .filter((l) => !filtro.dataAte || dataEfetiva(l) <= filtro.dataAte)
      .sort((a, b) => String(b.distribuidoEm || b.qualificadoEm || "").localeCompare(String(a.distribuidoEm || a.qualificadoEm || "")));

    const avisoErros = ctx.erros.length
      ? `<div class="card pad" style="margin-bottom:18px;border-color:#f3caca">
          <b style="color:var(--vermelho)">Não foi possível carregar tudo desta tela:</b>
          <ul style="margin:6px 0 0;padding-left:18px">
            ${ctx.erros.map((er) => `<li><b>${esc(er.label)}:</b> ${esc(er.mensagem)}</li>`).join("")}
          </ul>
          <p class="kpi-delta" style="margin:8px 0 0">Se a mensagem falar em "permissão negada" ou "insufficient permissions", peça a um administrador para revisar as regras de segurança do Firebase dessa coleção.</p>
        </div>`
      : "";

    const respField = admin ? `<div class="field"><label>Corretor</label><select id="distFiltroCorretor">
        <option value="">Todos</option>
        ${corretoresComLead().map(([id, nome]) => `<option value="${esc(id)}" ${id === filtro.corretorId ? "selected" : ""}>${esc(nome)}</option>`).join("")}
      </select></div>` : "";
    const buscaField = `<div class="field"><label>Buscar por nome ou telefone</label><input id="distFiltroBusca" value="${esc(filtro.busca)}" placeholder="Digite para filtrar..."></div>`;
    const dataDeField = `<div class="field"><label>Distribuído de</label><input type="date" id="distFiltroDe" value="${esc(filtro.dataDe)}"></div>`;
    const dataAteField = `<div class="field"><label>Distribuído até</label><input type="date" id="distFiltroAte" value="${esc(filtro.dataAte)}"></div>`;

    mount.innerHTML = `
      <div class="page-header">
        <div><h1>Leads Distribuídos</h1><p>Leads já qualificados e encaminhados para um corretor.</p></div>
      </div>
      ${avisoErros}
      <div class="card pad" style="margin:18px 0">
        <div class="grid ${admin ? "cols4" : "cols3"}">${respField}${buscaField}${dataDeField}${dataAteField}</div>
        <button type="button" class="btn secondary" style="margin-top:10px" id="distBtnLimparFiltro">Limpar filtros</button>
      </div>
      ${filtrados.length
        ? `<div class="grid cols3">${filtrados.map(renderCard).join("")}</div>`
        : `<div class="card pad empty-state"><b>Nenhum lead distribuído${admin ? "" : " para você"} ainda.</b><p>Leads aparecem aqui quando são qualificados com um corretor vinculado (direto ou por fila) em Atendimentos.</p></div>`}
    `;

    mount.querySelector("#distFiltroCorretor")?.addEventListener("change", (e) => { filtro.corretorId = e.target.value; pintar(); });
    mount.querySelector("#distFiltroBusca")?.addEventListener("input", (e) => { filtro.busca = e.target.value; pintar(); });
    mount.querySelector("#distFiltroDe")?.addEventListener("change", (e) => { filtro.dataDe = e.target.value; pintar(); });
    mount.querySelector("#distFiltroAte")?.addEventListener("change", (e) => { filtro.dataAte = e.target.value; pintar(); });
    mount.querySelector("#distBtnLimparFiltro")?.addEventListener("click", () => {
      filtro.corretorId = ""; filtro.busca = ""; filtro.dataDe = ""; filtro.dataAte = "";
      pintar();
    });
    mount.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => {
      const lead = ctx.leads.find((l) => l.id === b.dataset.abrir);
      if (!lead) { toast("Lead não encontrado — a lista pode estar desatualizada.", "warn"); return; }
      abrirDetalhesLead(lead, { cadenciasPorId: ctx.cadenciasPorId, filas: ctx.filas, admin, onChanged: carregar });
    }));
  }

  mount.innerHTML = `<div class="card pad">Carregando leads distribuídos...</div>`;
  carregar();
  return () => { vivo = false; };
}

registerPage("leads_distribuidos", renderLeadsDistribuidos);
