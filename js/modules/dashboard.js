/* Dashboard inicial — cards de KPI + abas, no espírito do "Início" do Univen
   (Pendências / Visão Geral / Desempenho), usando os dados reais da NPC. */

import { subscribe, getSlice } from "../sync.js";
import { getCurrentUser } from "../auth.js";
import { registerPage } from "../router.js";
import { listarLeadsCadencia } from "../providers/atendimentos-cadencia.js";
import { SITUACOES_QUALIFICADAS } from "../providers/cadencia-defaults.js";

function computeStats(leadsCadenciaAtivos) {
  const cards = getSlice("kanbanCards") || [];
  const users = getSlice("users") || [];

  const negociacoesAbertas = cards.filter((c) => c.columnId !== "fechado" && c.columnId !== "perdido");

  return {
    leadsAtivos: leadsCadenciaAtivos,
    negociacoesAbertas: negociacoesAbertas.length,
    colaboradoresAtivos: users.filter((u) => u.active !== false).length,
  };
}

function renderKpis(stats) {
  return `
    <div class="grid cols3">
      <div class="card kpi">
        <div class="kpi-label">Leads em cadência</div>
        <div class="kpi-value">${stats.leadsAtivos == null ? "…" : stats.leadsAtivos}</div>
        <div class="kpi-delta">em atendimento agora</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Negociações abertas</div>
        <div class="kpi-value">${stats.negociacoesAbertas}</div>
        <div class="kpi-delta">no kanban de vendas/locação</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Colaboradores ativos</div>
        <div class="kpi-value">${stats.colaboradoresAtivos}</div>
        <div class="kpi-delta">com acesso à intranet</div>
      </div>
    </div>`;
}

export function renderDashboard(mount) {
  const user = getCurrentUser();
  let leadsCadenciaAtivos = null; // null = ainda carregando do Firestore
  let vivo = true;

  function paint() {
    const stats = computeStats(leadsCadenciaAtivos);
    mount.innerHTML = `
      <div class="page-header">
        <div><h1>Olá, ${user?.name?.split(" ")[0] || ""}</h1>
        <p>Este é o resumo da operação da Na Ponta da Chave agora.</p></div>
      </div>
      ${renderKpis(stats)}
      <div style="height:22px"></div>
      <div class="grid cols2">
        <div class="card pad">
          <h3 style="margin-top:0">Próximos passos da migração</h3>
          <p class="kpi-delta" style="margin-bottom:14px">
            Módulos já ativos na Intranet 2.0: Dashboard, Atendimentos
            (cadências de Novos Leads / Reativação), Negociações, Respostas
            rápidas, os Registros Diários e a Análise 360° - Vendas. Os
            demais módulos continuam disponíveis pelo sistema atual até
            serem portados.
          </p>
        </div>
        <div class="card pad">
          <h3 style="margin-top:0">Sincronização</h3>
          <p class="kpi-delta">
            Esta tela e todas as outras atualizam sozinhas quando alguém
            altera um dado — sem piscar e sem precisar recarregar a página.
          </p>
        </div>
      </div>
    `;
  }

  async function carregarLeadsCadencia() {
    try {
      const leads = await listarLeadsCadencia();
      leadsCadenciaAtivos = leads.filter((l) => l.situacao !== "Perdido" && SITUACOES_QUALIFICADAS.indexOf(l.situacao) === -1).length;
    } catch (e) {
      leadsCadenciaAtivos = 0;
    }
    if (vivo) paint();
  }

  paint();
  carregarLeadsCadencia();
  const unsub2 = subscribe("kanbanCards", paint);
  const unsub4 = subscribe("users", paint);
  return () => { vivo = false; unsub2(); unsub4(); };
}

registerPage("dashboard", renderDashboard);
