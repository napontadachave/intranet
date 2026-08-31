/* =========================================================================
   Atendimentos — Cadências (Novos Leads / Reativação).

   Nova versão da tela "Cadências SDR" do sistema anterior: no lugar de duas
   telas separadas (Cadências - Novos Leads / Cadências - Reativação, que no
   sistema anterior já eram a mesma view, só filtrada por um campo
   `programa`), esta tela única tem duas ABAS. Substitui de vez a antiga
   "fila de atendimento" + "regras de distribuição automática" desta v2 (sem
   dado real de produção, migração combinada como segura) — que agora
   voltou, só que redesenhada: ver "Qualificar Lead" abaixo e
   js/providers/filas-distribuicao.js.

   Dados 100% Cloud Firestore, junto com os Registros Diários (ver
   js/providers/atendimentos-cadencia.js para o porquê e para a lógica de
   cada ação do dia a dia de um lead).

   Escopo desta etapa (combinado): só a lista principal + ações do dia a dia
   de cada lead. Ficam para depois: Gestão de Cadências (editor de etapas
   por origem), Templates de Mensagens reutilizáveis, Dashboard de
   Cadências, e a importação automática a partir da planilha "Atendimentos —
   Vendas" da Análise 360°. Sem cadência configurável ainda, todo lead novo
   usa a cadência padrão do programa (cadencia-defaults.js); sem importação
   automática ainda, o cadastro é sempre manual — por isso esta tela tem um
   botão "+ Novo lead" que o sistema anterior não tinha (leads só chegavam
   por sincronização de CRM ou import de planilha).

   Mesmo padrão visual/funcional das outras telas de lista da Intranet 2.0
   (cabeçalho + botão "Novo", abas, card de filtros, grade de cartões,
   modal de detalhes com sub-modais de ação) e a mesma regra de visibilidade
   já usada em Registros Diários: quem é admin (ou tem `perms.view_all_users`)
   vê e filtra os leads de todo mundo e pode excluir um cadastro; os demais
   só veem os leads em que são o responsável pelo atendimento.

   O modal de detalhes e os sub-modais de ação (registrar contato, concluir
   etapa, adiar, qualificar/distribuir, marcar como perdido, histórico,
   excluir) vivem em js/modules/lead-detalhes.js — extraído pra ser
   reaproveitado também pela tela "Leads Distribuídos"
   (js/modules/leads-distribuidos.js), que mostra os MESMOS leads (uma vez
   com corretor definido), só filtrados por corretor em vez de responsável
   de SDR.
   ========================================================================= */

import { subscribe, getSlice } from "../sync.js";
import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { openModal, closeModal, toast, esc, fmtDateTime } from "../ui-kit.js";
import { listarLeadsCadencia, criarLeadCadencia } from "../providers/atendimentos-cadencia.js";
import { PROGRAMAS, SITUACOES_QUALIFICADAS } from "../providers/cadencia-defaults.js";
import { garantirCadenciasPadrao, listarCadencias } from "../providers/cadencia-config.js";
import { listarFilas } from "../providers/filas-distribuicao.js";
import { abrirDetalhesLead, situacaoTagHtml, diasEntre, fmtDataBR } from "./lead-detalhes.js";

const FILTROS_PRAZO = [
  ["todos", "Todos"],
  ["atrasadas", "Atrasadas"],
  ["hoje", "Hoje"],
  ["amanha", "Amanhã"],
  ["em7", "Em 7 dias"],
  ["qualificados", "Qualificados"],
  ["perdidos", "Perdidos"],
];

/* ------------------------------- utilitários ------------------------------- */

function podeVerTodos() {
  const me = getCurrentUser();
  return isAdmin(me) || !!me?.perms?.view_all_users;
}

function usuariosAtivos() {
  return (getSlice("users") || [])
    .filter((u) => u && u.active !== false)
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

/** Select de responsável do formulário de novo lead: quem vê tudo escolhe
 *  qualquer pessoa ativa da equipe; os demais cadastram sempre em nome de
 *  si mesmos (select travado — mesmo padrão dos Registros Diários). */
function responsavelSelectHtml(id, admin, meId, meNome) {
  if (admin) {
    const users = usuariosAtivos();
    return `<select id="${id}">${users.map((u) => `<option value="${esc(u.id)}" ${u.id === meId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`;
  }
  return `<select id="${id}" disabled><option value="${esc(meId || "")}" selected>${esc(meNome || "Você")}</option></select>`;
}

/* --------------------------- filtros da listagem --------------------------- */

function filtroPrazoAceita(lead, prazo, agora) {
  if (prazo === "todos") return true;
  if (prazo === "qualificados") return SITUACOES_QUALIFICADAS.indexOf(lead.situacao) !== -1;
  if (prazo === "perdidos") return lead.situacao === "Perdido";
  if (lead.cadenciaEncerrada || !lead.proximaAtividade) return false;
  const dias = diasEntre(lead.proximaAtividade.previstoPara, agora);
  if (dias == null) return false;
  if (prazo === "atrasadas") return dias < 0;
  if (prazo === "hoje") return dias === 0;
  if (prazo === "amanha") return dias === 1;
  if (prazo === "em7") return dias >= 0 && dias <= 7;
  return true;
}

function compararPorProximaAtividade(a, b) {
  const pa = a.proximaAtividade?.previstoPara, pb = b.proximaAtividade?.previstoPara;
  if (!pa && !pb) return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  if (!pa) return 1;
  if (!pb) return -1;
  return pa.localeCompare(pb);
}

function aplicarFiltros(lista, admin, filtro) {
  const agora = new Date();
  const busca = filtro.busca.trim().toLowerCase();
  return lista
    .filter((l) => !(admin && filtro.responsavelId) || l.sdrResponsavelId === filtro.responsavelId)
    .filter((l) => !busca || (l.leadNome || "").toLowerCase().indexOf(busca) !== -1 || (l.leadTelefone || "").toLowerCase().indexOf(busca) !== -1)
    .filter((l) => !filtro.dataDe || (l.dataAtendimento || "") >= filtro.dataDe)
    .filter((l) => !filtro.dataAte || (l.dataAtendimento || "") <= filtro.dataAte)
    .filter((l) => filtroPrazoAceita(l, filtro.prazo, agora))
    .sort(compararPorProximaAtividade);
}

function renderFiltrosHtml(admin, filtro) {
  const buscaField = `<div class="field"><label>Buscar por nome ou telefone</label><input id="leadsFiltroBusca" value="${esc(filtro.busca)}" placeholder="Digite para filtrar..."></div>`;
  const respField = `<div class="field"><label>Responsável</label><select id="leadsFiltroResp">
      <option value="">Todos</option>
      ${usuariosAtivos().map((u) => `<option value="${esc(u.id)}" ${u.id === filtro.responsavelId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}
    </select></div>`;
  const dataDeField = `<div class="field"><label>Atendimento de</label><input type="date" id="leadsFiltroDe" value="${esc(filtro.dataDe)}"></div>`;
  const dataAteField = `<div class="field"><label>Atendimento até</label><input type="date" id="leadsFiltroAte" value="${esc(filtro.dataAte)}"></div>`;
  return `
    <div class="card pad" style="margin:18px 0">
      <div class="grid ${admin ? "cols4" : "cols3"}">
        ${admin ? respField : ""}
        ${buscaField}
        ${dataDeField}
        ${dataAteField}
      </div>
      <button type="button" class="btn secondary" style="margin-top:10px" id="leadsBtnLimparFiltro">Limpar filtros</button>
      <div class="tabs" style="margin-top:14px;margin-bottom:0;border-bottom:none;flex-wrap:wrap">
        ${FILTROS_PRAZO.map(([v, l]) => `<button type="button" data-prazo="${v}" class="${filtro.prazo === v ? "active" : ""}">${esc(l)}</button>`).join("")}
      </div>
    </div>`;
}

function attachFiltros(mount, admin, filtro, onChange) {
  if (admin) mount.querySelector("#leadsFiltroResp")?.addEventListener("change", (e) => { filtro.responsavelId = e.target.value; onChange(); });
  mount.querySelector("#leadsFiltroBusca")?.addEventListener("input", (e) => { filtro.busca = e.target.value; onChange(); });
  mount.querySelector("#leadsFiltroDe")?.addEventListener("change", (e) => { filtro.dataDe = e.target.value; onChange(); });
  mount.querySelector("#leadsFiltroAte")?.addEventListener("change", (e) => { filtro.dataAte = e.target.value; onChange(); });
  mount.querySelector("#leadsBtnLimparFiltro")?.addEventListener("click", () => {
    filtro.responsavelId = ""; filtro.busca = ""; filtro.dataDe = ""; filtro.dataAte = ""; filtro.prazo = "todos";
    onChange();
  });
  mount.querySelectorAll("[data-prazo]").forEach((b) => b.addEventListener("click", () => { filtro.prazo = b.dataset.prazo; onChange(); }));
}

/* ------------------------------- cartão de lead ------------------------------- */

function renderCardLead(lead, ctx) {
  const totalEtapas = (ctx.cadenciasPorId.get(lead.cadenciaId)?.etapas || []).length;
  const etapaTexto = lead.cadenciaEncerrada
    ? `Concluída (${totalEtapas}/${totalEtapas})`
    : `${Math.min((lead.etapaAtualIndex || 0) + 1, totalEtapas)}/${totalEtapas}`;
  const prox = lead.proximaAtividade;
  const atrasada = !!prox && !lead.cadenciaEncerrada && (diasEntre(prox.previstoPara, new Date()) ?? 0) < 0;

  return `<div class="kanban-card" style="cursor:default">
    <b>${esc(lead.leadNome)}</b>
    <div class="meta">${esc(lead.leadTelefone || "sem telefone")}</div>
    <div class="meta">Origem: ${esc(lead.origem || "-")}</div>
    ${lead.corretorNome ? `<div class="meta">Corretor: ${esc(lead.corretorNome)}</div>` : ""}
    <div class="meta">Atendimento: ${fmtDataBR(lead.dataAtendimento)}</div>
    <div class="meta">Etapa: ${esc(etapaTexto)}</div>
    <div class="meta">${prox ? `Próx.: ${esc(prox.etapaNome)} — ${fmtDateTime(prox.previstoPara)}` : "Sem próxima atividade"}${atrasada ? ' <span class="tag red">Atrasada</span>' : ""}</div>
    <div style="margin:8px 0">${situacaoTagHtml(lead.situacao)}</div>
    <div class="card-actions"><button type="button" class="btn secondary" data-abrir="${esc(lead.id)}">Abrir</button></div>
  </div>`;
}

/* --------------------------------- estado global --------------------------------- */

// Estado compartilhado entre a tela principal e os sub-modais de ação (que
// precisam recarregar a lista e reabrir os detalhes do mesmo lead depois de
// cada ação) — só existe uma instância desta página montada por vez, o
// roteador garante isso (ver router.js). `cadenciasPorId` é um cache local
// das cadências configuradas em Configurações → Gestão de Cadências e
// Templates, recarregado junto com os leads — usado pra mostrar etapa
// atual/mensagem sugerida sem precisar buscar no Firestore a cada card.
// `filas` é a mesma ideia, pra Configurações → Gestão de Filas, usado só
// pelo modal de Qualificar (ver js/modules/lead-detalhes.js).
const ctx = { leads: [], cadenciasPorId: new Map(), filas: [], erros: [], recarregar: async () => {} };

function findLead(id) {
  return ctx.leads.find((l) => l.id === id);
}

/* --------------------------------- tela principal --------------------------------- */

export function renderLeads(mount) {
  let activeTab = "novos_leads";
  const filtros = {
    novos_leads: { responsavelId: "", prazo: "todos", busca: "", dataDe: "", dataAte: "" },
    reativacao: { responsavelId: "", prazo: "todos", busca: "", dataDe: "", dataAte: "" },
  };
  let vivo = true;

  /** Carrega leads, cadências e filas como leituras INDEPENDENTES do
   *  Firestore (coleções diferentes). Antes, um `Promise.all` único fazia
   *  uma falhar (ex.: permissão negada só numa das coleções) derrubar as
   *  outras junto — e como cadências ficavam vazias nesse caso, a tela
   *  mostrava "Nenhuma cadência ativa" mesmo com cadências configuradas e
   *  ativas em Configurações, escondendo o problema real (a leitura de
   *  leads que falhou). Agora cada uma guarda seu próprio erro em
   *  `ctx.erros`, pra tela poder avisar exatamente qual leitura falhou. */
  async function recarregar() {
    const erros = [];
    try { await garantirCadenciasPadrao(); } catch (e) { erros.push({ label: "Cadências (verificação inicial)", mensagem: e.message }); }
    try { ctx.leads = await listarLeadsCadencia(); } catch (e) { erros.push({ label: "Leads", mensagem: e.message }); ctx.leads = []; }
    try { ctx.cadenciasPorId = new Map((await listarCadencias()).map((c) => [c.id, c])); } catch (e) { erros.push({ label: "Cadências", mensagem: e.message }); ctx.cadenciasPorId = new Map(); }
    try { ctx.filas = await listarFilas(); } catch (e) { erros.push({ label: "Filas de distribuição", mensagem: e.message }); ctx.filas = []; }
    ctx.erros = erros;
    if (erros.length) toast("Erro ao carregar: " + erros.map((er) => er.label).join(", "), "warn");
    if (vivo) pintar();
  }
  ctx.recarregar = recarregar;

  function pintar() {
    const me = getCurrentUser();
    const admin = podeVerTodos();
    const filtro = filtros[activeTab];
    const doPrograma = ctx.leads.filter((l) => l.programa === activeTab);
    const visiveis = admin ? doPrograma : doPrograma.filter((l) => l.sdrResponsavelId === me?.id);
    const filtrados = aplicarFiltros(visiveis, admin, filtro);
    const cadenciaAtiva = [...ctx.cadenciasPorId.values()].find((c) => c.programa === activeTab && c.ativa) || null;
    // Distingue "não consegui nem carregar" de "carreguei e não tem nenhuma
    // ativa" — antes as duas apareciam com a MESMA mensagem ("Nenhuma
    // cadência ativa"), o que escondia um erro real de leitura atrás do que
    // parecia só falta de configuração (ver comentário em `recarregar`).
    const avisoErros = ctx.erros.length
      ? `<div class="card pad" style="margin-bottom:18px;border-color:#f3caca">
          <b style="color:var(--vermelho)">Não foi possível carregar tudo desta tela:</b>
          <ul style="margin:6px 0 0;padding-left:18px">
            ${ctx.erros.map((er) => `<li><b>${esc(er.label)}:</b> ${esc(er.mensagem)}</li>`).join("")}
          </ul>
          <p class="kpi-delta" style="margin:8px 0 0">Se a mensagem falar em "permissão negada" ou "insufficient permissions", peça a um administrador para revisar as regras de segurança do Firebase dessa coleção.</p>
        </div>`
      : "";
    const avisoSemCadencia = (!cadenciaAtiva && !ctx.erros.some((er) => er.label.startsWith("Cadências")))
      ? `<div class="card pad" style="margin-bottom:18px;border-color:#f3caca">
          <b style="color:var(--vermelho)">Nenhuma cadência ativa para ${esc(PROGRAMAS[activeTab].label)}.</b>
          <p class="kpi-delta" style="margin:4px 0 0">${admin
            ? "Configure e ative uma em Configurações → Gestão de Cadências e Templates antes de cadastrar um lead novo nesta aba."
            : "Fale com um administrador para configurar uma cadência antes de cadastrar um lead novo nesta aba."}</p>
        </div>`
      : "";

    mount.innerHTML = `
      <div class="page-header">
        <div><h1>Atendimentos</h1><p>Leads em cadência de contato, organizados por programa.</p></div>
        <button type="button" class="btn primary" id="btnNovoLead" ${cadenciaAtiva ? "" : "disabled"}>+ Novo lead</button>
      </div>
      <div class="tabs">
        <button data-tab="novos_leads" class="${activeTab === "novos_leads" ? "active" : ""}">${esc(PROGRAMAS.novos_leads.label)}</button>
        <button data-tab="reativacao" class="${activeTab === "reativacao" ? "active" : ""}">${esc(PROGRAMAS.reativacao.label)}</button>
      </div>
      ${avisoErros}
      ${avisoSemCadencia}
      ${renderFiltrosHtml(admin, filtro)}
      ${filtrados.length
        ? `<div class="grid cols3">${filtrados.map((l) => renderCardLead(l, ctx)).join("")}</div>`
        : `<div class="card pad empty-state"><b>Nenhum lead encontrado.</b><p>Ajuste os filtros ou cadastre um novo lead nesta aba.</p></div>`}
    `;

    mount.querySelectorAll(".tabs button[data-tab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.tab; pintar(); }));
    if (cadenciaAtiva) mount.querySelector("#btnNovoLead").addEventListener("click", () => abrirNovoLeadModal(activeTab, cadenciaAtiva));
    attachFiltros(mount, admin, filtro, pintar);
    mount.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => {
      const lead = findLead(b.dataset.abrir);
      if (!lead) { toast("Lead não encontrado — a lista pode estar desatualizada.", "warn"); return; }
      abrirDetalhesLead(lead, { cadenciasPorId: ctx.cadenciasPorId, filas: ctx.filas, admin: podeVerTodos(), onChanged: recarregar });
    }));
  }

  mount.innerHTML = `<div class="card pad">Carregando leads...</div>`;
  recarregar();
  const u1 = subscribe("users", pintar);
  return () => { vivo = false; u1(); };
}

/* ------------------------------- "+ Novo lead" ------------------------------- */

function abrirNovoLeadModal(programa, cadenciaAtiva) {
  const me = getCurrentUser();
  const admin = podeVerTodos();
  const ativos = usuariosAtivos();
  const label = PROGRAMAS[programa]?.label || programa;

  const body = openModal(`Novo lead — ${label}`, `
    <div class="grid cols2">
      <div class="field"><label>Nome do lead</label><input id="fNovoNome"></div>
      <div class="field"><label>Telefone</label><input id="fNovoTelefone"></div>
    </div>
    <div class="grid cols2">
      <div class="field"><label>E-mail</label><input id="fNovoEmail"></div>
      <div class="field"><label>Origem</label><input id="fNovoOrigem" placeholder="Instagram, WhatsApp, indicação..."></div>
    </div>
    <div class="field"><label>Empreendimento / interesse</label><input id="fNovoEmpreendimento"></div>
    <div class="grid cols2">
      <div class="field"><label>Corretor (opcional)</label><select id="fNovoCorretor">
        <option value="">— nenhum —</option>
        ${ativos.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}
      </select></div>
      <div class="field"><label>Responsável pelo atendimento</label>${responsavelSelectHtml("fNovoResponsavel", admin, me?.id, me?.name)}</div>
    </div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnCancelarNovo">Cancelar</button>
      <button type="button" class="btn primary" id="btnSalvarNovo">Cadastrar lead</button>
    </div>
  `, { width: 640 });

  body.querySelector("#btnCancelarNovo").addEventListener("click", closeModal);
  body.querySelector("#btnSalvarNovo").addEventListener("click", async () => {
    const nome = body.querySelector("#fNovoNome").value.trim();
    if (!nome) { toast("Informe o nome do lead.", "warn"); return; }
    const responsavelId = admin ? body.querySelector("#fNovoResponsavel").value : me?.id;
    const responsavel = ativos.find((u) => u.id === responsavelId) || me;
    const corretorId = body.querySelector("#fNovoCorretor").value;
    const corretor = ativos.find((u) => u.id === corretorId);
    const btn = body.querySelector("#btnSalvarNovo");
    btn.disabled = true;
    try {
      await criarLeadCadencia({
        programa, cadencia: cadenciaAtiva, leadNome: nome,
        leadTelefone: body.querySelector("#fNovoTelefone").value,
        leadEmail: body.querySelector("#fNovoEmail").value,
        origem: body.querySelector("#fNovoOrigem").value,
        empreendimento: body.querySelector("#fNovoEmpreendimento").value,
        corretorId, corretorNome: corretor?.name || "",
        sdrResponsavelId: responsavelId, sdrResponsavelNome: responsavel?.name || "",
        criadoPorId: me?.id,
      });
      closeModal();
      toast("Lead cadastrado.", "ok");
      await ctx.recarregar();
    } catch (e) {
      toast("Erro ao cadastrar: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

registerPage("leads", renderLeads);
