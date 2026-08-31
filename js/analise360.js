/* =========================================================================
   Análise 360° - Vendas.

   Painel de indicadores a partir das planilhas do Univen importadas em
   Configurações → Importação de Dados (Negociações fechadas, Atendimentos
   — Vendas, Imóveis ativos/inativos), mais duas fontes já existentes na
   própria Intranet 2.0 (ver js/providers/analise360-relatorio.js para o
   porquê de cada uma):
   - Comissões vem da cascata de comissão já calculada nos cards do kanban
     de Negociações (não da planilha do Univen).
   - Performance vem do Registro Diário - Vendas (não de um sistema de
     lançamento manual separado, que o sistema anterior tinha e que não foi
     portado para a 2.0).

   Escopo combinado desta etapa: só "Análise 360° - Vendas". A tela irmã
   "Análise 360° - Locação" do sistema anterior fica para uma etapa
   seguinte (depende de uma 5ª planilha, "Atendimentos — Locação", que
   ainda não é importada aqui). A aba "Imóveis Procurados" (cruzamento da
   coluna "Imóveis de interesse" dos atendimentos com as planilhas de
   imóveis) também ficou de fora desta etapa — é uma lógica de parsing
   bem específica que merece uma rodada própria.

   Simplificações conscientes em relação ao sistema anterior (documentadas
   aqui para não se perderem):
   - Gráficos: um conjunto menor e mais simples (ver js/charts-svg.js) no
     lugar dos vários tipos de gráfico SVG à mão do sistema anterior.
   - Clique-para-filtrar: nas listas/rankings por corretor (todas as abas) e
     nas listas de Tipo/Cidade/Bairro/Finalidade da Carteira de Imóveis (só
     essa aba — os imóveis não têm corretor associado nos dados de origem,
     então esse filtro é independente do de corretor). Mídia e Etapa dos
     Atendimentos continuam só informativos — o sistema anterior permitia
     clicar em praticamente qualquer fatia/barra da tela inteira; aqui só as
     interações de mais valor viraram clicáveis.
   - "Corretor" é comparado por nome exato (texto) entre as 4 fontes de
     dado (planilha de Negociações, planilha de Atendimentos, cards do
     kanban, Registro Diário - Vendas) — não existe um ID comum ligando
     todas. Nomes digitados de formas diferentes em cada lugar (com/sem
     acento, apelido...) aparecem como pessoas diferentes no relatório.
   ========================================================================= */

import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { getSlice } from "../sync.js";
import { esc, fmtMoneyBRL, toast } from "../ui-kit.js";
import {
  carregarDadosBrutos, carregarRegistrosVendas, carregarNegociosFechadosKanban, nomesResponsaveisKanban,
  filtrarPorPeriodo, filtrarPorCorretor, filtrarPorCampo, agregarNegociacoes, agregarAtendimentos, agregarImoveis,
  calcularPerformance, periodoAnterior, calcularDelta, hojeISO, inicioMesAtualISO,
} from "../providers/analise360-relatorio.js";
import { topN, svgBarraLista, svgDonut, svgBarrasMes, deltaHtml } from "../charts-svg.js";

function podeVerTodos() {
  const me = getCurrentUser();
  return isAdmin(me) || !!me?.perms?.view_all_users;
}

/** "2026-08-01" -> "01/08/2026", sem passar por Date() (mesmo cuidado já
 *  documentado em registros-diarios.js, pra não sofrer o problema clássico
 *  de fuso horário empurrando a data um dia pra trás/frente). */
function fmtDataBR(iso) {
  const p = String(iso || "").split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (iso || "-");
}
function fmtMesBR(mesIso) {
  const [ano, mes] = String(mesIso || "").split("-");
  const NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const i = Number(mes) - 1;
  return ano && NOMES[i] ? `${NOMES[i]}/${ano.slice(2)}` : (mesIso || "-");
}
function ordenarPorMes(mapa) {
  return Object.entries(mapa || {}).filter(([m]) => m !== "(Não informado)").sort((a, b) => a[0].localeCompare(b[0]));
}

const ABAS = [
  { id: "geral", label: "Visão Geral" },
  { id: "vgv", label: "VGV" },
  { id: "comissoes", label: "Comissões" },
  { id: "ranking", label: "Ranking" },
  { id: "atendimentos", label: "Atendimentos" },
  { id: "carteira", label: "Carteira de Imóveis" },
  { id: "performance", label: "Performance" },
];

export function renderAnalise360(mount) {
  let vivo = true;
  const me = getCurrentUser();
  const admin = podeVerTodos();

  let aba = "geral";
  // `imovel` é um filtro à parte do de corretor (a Carteira de Imóveis não
  // tem relação com corretor nos dados de origem — ver comentário no topo
  // do arquivo) — clique numa barra de Tipo/Cidade/Bairro/Finalidade nessa
  // aba filtra só ela, sem mexer no filtro de corretor das outras abas.
  const filtro = { de: inicioMesAtualISO(), ate: hojeISO(), corretor: admin ? "" : (me?.name || ""), imovel: { campo: "", valor: "" } };
  let dados = null; // { negociacoes, atendimentos, imoveisAtivos, imoveisInativos, meta* }
  let registrosVendas = [];
  let errosCarregamento = []; // [{ label, mensagem }] — fontes que falharam ao carregar (ver analise360-relatorio.js)

  mount.innerHTML = `<div class="card pad">Carregando dados da Análise 360°...</div>`;
  (async () => {
    try {
      const [d, rv] = await Promise.all([carregarDadosBrutos(), carregarRegistrosVendas()]);
      if (!vivo) return;
      dados = d;
      registrosVendas = rv.registros;
      errosCarregamento = [...(d.erros || []), ...(rv.erro ? [rv.erro] : [])];
      pintar();
    } catch (e) {
      // Só chega aqui por um erro inesperado fora das leituras já protegidas
      // acima (carregarDadosBrutos/carregarRegistrosVendas não rejeitam).
      console.error(e);
      if (vivo) mount.innerHTML = `<div class="card pad">Erro ao carregar os dados da Análise 360°. Veja o console para detalhes.</div>`;
    }
  })();

  function nomesCorretores() {
    const usuarios = (getSlice("users") || []).filter((u) => u && u.active !== false).map((u) => u.name);
    const daPlanilhaNeg = (dados?.negociacoes || []).map((r) => r.responsavel);
    const daPlanilhaAt = (dados?.atendimentos || []).map((r) => r.corretor);
    const doKanban = nomesResponsaveisKanban();
    const doRegistro = registrosVendas.map((r) => r.userName);
    const todos = new Set([...usuarios, ...daPlanilhaNeg, ...daPlanilhaAt, ...doKanban, ...doRegistro].map((n) => String(n || "").trim()).filter(Boolean));
    return [...todos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function corretorSelectHtml() {
    if (!admin) {
      return `<select id="a360Corretor" disabled><option selected>${esc(filtro.corretor || "Você")}</option></select>`;
    }
    const nomes = nomesCorretores();
    return `<select id="a360Corretor">
      <option value="">Todos</option>
      ${nomes.map((n) => `<option value="${esc(n)}" ${filtro.corretor === n ? "selected" : ""}>${esc(n)}</option>`).join("")}
    </select>`;
  }

  function selecionarCorretor(nome) {
    if (!admin) return;
    filtro.corretor = filtro.corretor === nome ? "" : nome;
    pintar();
  }

  /** Clique numa barra de Tipo/Cidade/Bairro/Finalidade da Carteira de
   *  Imóveis — clicar de novo na mesma barra ativa limpa o filtro (mesmo
   *  padrão de `selecionarCorretor`). Aberto a todos os usuários (não só
   *  admin): não há corretor nem dado sensível envolvido aqui. */
  function selecionarImovel(campo, valor) {
    filtro.imovel = (filtro.imovel.campo === campo && filtro.imovel.valor === valor) ? { campo: "", valor: "" } : { campo, valor };
    pintar();
  }

  /* -------------------------- dados derivados do período -------------------------- */

  function contexto() {
    const negPeriodo = filtrarPorCorretor(filtrarPorPeriodo(dados.negociacoes, "data", filtro.de, filtro.ate), "responsavel", filtro.corretor);
    const avPeriodo = filtrarPorCorretor(filtrarPorPeriodo(dados.atendimentos, "data", filtro.de, filtro.ate), "corretor", filtro.corretor);
    const negAgg = agregarNegociacoes(negPeriodo);
    const avAgg = agregarAtendimentos(avPeriodo);

    const anterior = periodoAnterior(filtro.de, filtro.ate);
    const negAnt = anterior ? agregarNegociacoes(filtrarPorCorretor(filtrarPorPeriodo(dados.negociacoes, "data", anterior.de, anterior.ate), "responsavel", filtro.corretor)) : null;
    const avAnt = anterior ? agregarAtendimentos(filtrarPorCorretor(filtrarPorPeriodo(dados.atendimentos, "data", anterior.de, anterior.ate), "corretor", filtro.corretor)) : null;

    const conversao = avAgg.total ? (negAgg.total / avAgg.total) * 100 : null;
    const conversaoAnt = avAnt && avAnt.total ? (negAnt.total / avAnt.total) * 100 : null;

    const comissoes = carregarNegociosFechadosKanban({ de: filtro.de, ate: filtro.ate, corretor: filtro.corretor });
    const imoveisFiltrados = filtrarPorCampo(dados.imoveisAtivos, filtro.imovel.campo, filtro.imovel.valor);
    const carteira = agregarImoveis(imoveisFiltrados, "venda");

    return { negAgg, avAgg, negAnt, avAnt, conversao, conversaoAnt, comissoes, carteira };
  }

  /* --------------------------------- KPI cards --------------------------------- */

  function kpiCard(label, valor, deltaPct) {
    return `<div class="card kpi">
      <div class="kpi-label">${esc(label)}</div>
      <div class="kpi-value">${valor}</div>
      ${deltaPct !== undefined ? deltaHtml(deltaPct, { esc }) : ""}
    </div>`;
  }

  /* ------------------------------------ abas ------------------------------------ */

  function renderGeral(ctx) {
    const { negAgg, avAgg, conversao, negAnt, avAnt, conversaoAnt } = ctx;
    const kpis = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px">
      ${kpiCard("VGV Bruto Total", fmtMoneyBRL(negAgg.vgvTotal), calcularDelta(negAgg.vgvTotal, negAnt?.vgvTotal))}
      ${kpiCard("Negócios Fechados", negAgg.total, calcularDelta(negAgg.total, negAnt?.total))}
      ${kpiCard("Taxa de Conversão", conversao == null ? "—" : `${conversao.toFixed(1)}%`, conversao != null && conversaoAnt != null ? calcularDelta(conversao, conversaoAnt) : undefined)}
      ${kpiCard("Ticket Médio", fmtMoneyBRL(negAgg.ticketMedio))}
      ${kpiCard("Atendimentos no Período", avAgg.total, calcularDelta(avAgg.total, avAnt?.total))}
    </div>`;

    const graficos = `<div class="grid cols2" style="margin-bottom:18px">
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Negociações por Tipo</h2>
        ${svgDonut(topN(negAgg.porTipo, 8), { esc })}</div>
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Atendimentos por Mídia</h2>
        ${svgBarraLista(topN(avAgg.porMidia, 8), { esc })}</div>
    </div>`;

    let painel;
    if (filtro.corretor) {
      painel = `<div class="card pad">
        <h2 style="margin:0 0 12px;font-size:15px">Resumo — ${esc(filtro.corretor)}</h2>
        <div class="grid cols3">
          <div><b>VGV:</b> ${fmtMoneyBRL(negAgg.vgvTotal)}</div>
          <div><b>Negócios:</b> ${negAgg.total}</div>
          <div><b>Atendimentos:</b> ${avAgg.total}</div>
        </div>
      </div>`;
    } else {
      const nomes = new Set([...Object.keys(negAgg.porCorretor), ...Object.keys(avAgg.porCorretor)].filter((n) => n !== "(Não informado)"));
      const linhas = [...nomes].map((n) => ({
        nome: n, vgv: negAgg.porCorretor[n] || 0, negocios: negAgg.contagemPorCorretor[n] || 0, atendimentos: avAgg.porCorretor[n] || 0,
      })).sort((a, b) => b.vgv - a.vgv).slice(0, 8);
      painel = `<div class="card pad">
        <h2 style="margin:0 0 12px;font-size:15px">Panorama por Corretor</h2>
        ${!linhas.length ? `<p class="kpi-delta">Sem dados para este período.</p>` : `
        <table class="tbl"><thead><tr><th>Corretor</th><th>VGV</th><th>Negócios</th><th>Atendimentos</th></tr></thead><tbody>
          ${linhas.map((l) => `<tr data-linha-corretor="${esc(l.nome)}" style="cursor:pointer">
            <td>${esc(l.nome)}</td><td>${fmtMoneyBRL(l.vgv)}</td><td>${l.negocios}</td><td>${l.atendimentos}</td>
          </tr>`).join("")}
        </tbody></table>`}
      </div>`;
    }
    return kpis + graficos + painel;
  }

  function renderVgv(ctx) {
    const { negAgg, negAnt, conversao, conversaoAnt } = ctx;
    const kpis = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px">
      ${kpiCard("VGV Bruto Total", fmtMoneyBRL(negAgg.vgvTotal), calcularDelta(negAgg.vgvTotal, negAnt?.vgvTotal))}
      ${kpiCard("Negócios Fechados", negAgg.total, calcularDelta(negAgg.total, negAnt?.total))}
      ${kpiCard("Taxa de Conversão", conversao == null ? "—" : `${conversao.toFixed(1)}%`, conversao != null && conversaoAnt != null ? calcularDelta(conversao, conversaoAnt) : undefined)}
      ${kpiCard("Ticket Médio", fmtMoneyBRL(negAgg.ticketMedio))}
    </div>`;
    return kpis + `<div class="card pad" style="margin-bottom:18px"><h2 style="margin:0 0 12px;font-size:15px">VGV Mês a Mês</h2>
      ${svgBarrasMes(ordenarPorMes(negAgg.porMes), { formatarValor: (v) => fmtMoneyBRL(v).replace("R$", "").trim(), formatarMes: fmtMesBR, esc })}</div>
      <div class="grid cols2">
        <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Ranking de Corretores — VGV</h2>
          ${svgBarraLista(topN(negAgg.porCorretor, 10), { formatarValor: fmtMoneyBRL, dataAttr: "corretor", ativo: filtro.corretor, esc })}</div>
        <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Negociações por Tipo</h2>
          ${svgDonut(topN(negAgg.porTipo, 8), { esc })}</div>
      </div>`;
  }

  function renderComissoes(ctx) {
    const { comissoes } = ctx;
    const aviso = comissoes.semDataCount > 0 ? `<div class="card pad" style="margin-bottom:18px;border-color:#f3caca">
      <b>${comissoes.semDataCount} negociação${comissoes.semDataCount === 1 ? "" : "ões"} finalizada${comissoes.semDataCount === 1 ? "" : "s"} sem data de fechamento registrada.</b>
      <p class="kpi-delta" style="margin:4px 0 0">Isso acontece com negociações que já estavam na coluna final do kanban antes desta função existir. Abra e salve cada uma (em Negociações) para elas passarem a contar no relatório por período.</p>
    </div>` : "";
    const kpis = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px">
      ${kpiCard("Comissão Total", fmtMoneyBRL(comissoes.comissaoTotal))}
      ${kpiCard("Negócios Considerados", comissoes.total)}
      ${kpiCard("Comissão Média por Negócio", fmtMoneyBRL(comissoes.total ? comissoes.comissaoTotal / comissoes.total : 0))}
    </div>`;
    return aviso + kpis + `<div class="card pad" style="margin-bottom:18px"><h2 style="margin:0 0 12px;font-size:15px">Comissão Mês a Mês</h2>
      ${svgBarrasMes(ordenarPorMes(comissoes.porMes), { formatarValor: (v) => fmtMoneyBRL(v).replace("R$", "").trim(), formatarMes: fmtMesBR, esc })}</div>
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Comissão por Pessoa</h2>
        <p class="kpi-delta" style="margin:0 0 10px">Inclui a imobiliária e todos os comissionados de cada negociação (não só corretores) — é como a cascata de comissão do card foi dividida.</p>
        ${svgBarraLista(topN(comissoes.porPessoa, 12), { formatarValor: fmtMoneyBRL, esc })}</div>`;
  }

  function renderRanking(ctx) {
    const { negAgg, avAgg, comissoes } = ctx;
    const bloco = (titulo, itens, formatarValor) => `<div class="card pad">
      <h2 style="margin:0 0 12px;font-size:15px">${esc(titulo)}</h2>
      ${svgBarraLista(itens, { formatarValor, dataAttr: "corretor", ativo: filtro.corretor, esc })}</div>`;
    return `<div class="grid cols2">
      ${bloco("Corretores por VGV", topN(negAgg.porCorretor, 12), fmtMoneyBRL)}
      ${bloco("Corretores por Comissão", topN(comissoes.porPessoa, 12), fmtMoneyBRL)}
      ${bloco("Corretores por Negócios Fechados", topN(negAgg.contagemPorCorretor, 12), (v) => String(v))}
      ${bloco("Corretores por Atendimentos", topN(avAgg.porCorretor, 12), (v) => String(v))}
    </div>`;
  }

  function renderAtendimentos(ctx) {
    const { avAgg, avAnt } = ctx;
    const kpis = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px">
      ${kpiCard("Atendimentos no Período", avAgg.total, calcularDelta(avAgg.total, avAnt?.total))}
    </div>`;
    return kpis + `<div class="card pad" style="margin-bottom:18px"><h2 style="margin:0 0 12px;font-size:15px">Atendimentos por Mês</h2>
      ${svgBarrasMes(ordenarPorMes(avAgg.porMes), { formatarMes: fmtMesBR, esc })}</div>
      <div class="grid cols2">
        <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Atendimentos por Corretor</h2>
          ${svgBarraLista(topN(avAgg.porCorretor, 10), { dataAttr: "corretor", ativo: filtro.corretor, esc })}</div>
        <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Atendimentos por Mídia</h2>
          ${svgBarraLista(topN(avAgg.porMidia, 10), { esc })}</div>
        <div class="card pad" style="grid-column:1/-1"><h2 style="margin:0 0 12px;font-size:15px">Funil — Atendimentos por Etapa</h2>
          ${svgBarraLista(topN(avAgg.porEtapa, 12), { esc })}</div>
      </div>`;
  }

  function renderCarteira(ctx) {
    const { carteira } = ctx;
    const { campo: imCampo, valor: imValor } = filtro.imovel;
    const kpis = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px">
      ${kpiCard("Imóveis na Carteira (Venda)", carteira.total)}
      ${kpiCard("Ticket Médio de Venda", fmtMoneyBRL(carteira.ticketMedioVenda))}
    </div>
    <p class="kpi-delta" style="margin:0 0 14px">A carteira de imóveis não é filtrada por período nem por corretor — não há essa relação nos dados de origem (planilhas "Imóveis ativos"/"Imóveis inativos" da Análise 360°). Clique numa barra abaixo pra filtrar por Tipo, Cidade, Bairro ou Finalidade.</p>
    ${imValor ? `<div style="margin-bottom:14px"><span class="tag gray">Filtrado por ${esc(imCampo)}: ${esc(imValor)}</span> <button type="button" class="btn ghost" id="a360LimparImovel" style="margin-left:8px">Limpar filtro</button></div>` : ""}`;
    return kpis + `<div class="grid cols2">
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Por Tipo</h2>${svgBarraLista(topN(carteira.porTipo, 10), { esc, dataAttr: "imovel-tipo", ativo: imCampo === "tipo" ? imValor : "" })}</div>
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Por Cidade</h2>${svgBarraLista(topN(carteira.porCidade, 10), { esc, dataAttr: "imovel-cidade", ativo: imCampo === "cidade" ? imValor : "" })}</div>
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Por Bairro</h2>${svgBarraLista(topN(carteira.porBairro, 10), { esc, dataAttr: "imovel-bairro", ativo: imCampo === "bairro" ? imValor : "" })}</div>
      <div class="card pad"><h2 style="margin:0 0 12px;font-size:15px">Por Finalidade</h2>${svgDonut(topN(carteira.porFinalidade, 6), { esc, dataAttr: "imovel-finalidade", ativo: imCampo === "finalidade" ? imValor : "" })}</div>
    </div>`;
  }

  function metricaBarraHtml(m) {
    const pct = Math.max(0, Math.min(100, Math.round(m.pct)));
    const cor = m.pct >= 100 ? "var(--verde)" : m.pct >= 80 ? "var(--amarelo2)" : "var(--vermelho)";
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span><b>${esc(m.label)}</b> <span class="kpi-delta">(peso ${m.peso})</span></span>
        <span>${esc(String(m.real))} / ${m.esperado.toFixed(1)} — ${Math.round(m.pct)}%</span>
      </div>
      <div class="barra-lista-trilho"><div class="barra-lista-fill" style="width:${pct}%;background:${cor}"></div></div>
    </div>`;
  }

  function renderPerformance() {
    const registrosPeriodo = filtrarPorPeriodo(registrosVendas, "data", filtro.de, filtro.ate);

    if (filtro.corretor) {
      const doCorretor = registrosPeriodo.filter((r) => r.userName === filtro.corretor);
      const perf = calcularPerformance(doCorretor, filtro.de, filtro.ate);
      const cor = perf.statusCor === "verde" ? "var(--verde)" : perf.statusCor === "amarelo" ? "var(--amarelo2)" : "var(--vermelho)";
      return `<div class="card pad" style="margin-bottom:18px;display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="kpi-label">Pontuação — ${esc(filtro.corretor)}</div>
          <div class="kpi-value" style="color:${cor}">${Math.round(perf.score)}</div>
          <span class="tag ${perf.statusCor === "verde" ? "green" : perf.statusCor === "amarelo" ? "yellow" : "red"}">${esc(perf.statusLabel)}</span>
          ${perf.travado ? `<p class="kpi-delta" style="margin-top:8px;max-width:280px">Pontuação travada em 80 porque o indicador principal (Vendas) não atingiu 80% da meta.</p>` : ""}
        </div>
        <div style="flex:1;min-width:280px">${perf.metricas.map(metricaBarraHtml).join("")}</div>
      </div>
      ${!doCorretor.length ? `<p class="kpi-delta">Nenhum lançamento de Registro Diário - Vendas dessa pessoa neste período.</p>` : ""}`;
    }

    if (!admin) return `<p class="kpi-delta">Selecione um período — sua pontuação aparece acima.</p>`;

    const usuarios = (getSlice("users") || []).filter((u) => u && u.active !== false && !isAdmin(u));
    const linhas = usuarios.map((u) => {
      const perf = calcularPerformance(registrosPeriodo.filter((r) => r.userName === u.name), filtro.de, filtro.ate);
      return { nome: u.name, score: perf.score, statusLabel: perf.statusLabel, statusCor: perf.statusCor };
    }).sort((a, b) => b.score - a.score);
    const media = linhas.length ? linhas.reduce((s, l) => s + l.score, 0) / linhas.length : 0;

    return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:18px">
      ${kpiCard("Pontuação Média da Equipe", Math.round(media))}
      ${kpiCard("Colaboradores Avaliados", linhas.length)}
    </div>
    <div class="card pad">
      <h2 style="margin:0 0 12px;font-size:15px">Ranking de Performance</h2>
      ${!linhas.length ? `<p class="kpi-delta">Nenhum colaborador ativo encontrado.</p>` : `
      <table class="tbl"><thead><tr><th>Colaborador</th><th>Pontuação</th><th>Status</th></tr></thead><tbody>
        ${linhas.map((l) => `<tr data-linha-corretor="${esc(l.nome)}" style="cursor:pointer">
          <td>${esc(l.nome)}</td><td>${Math.round(l.score)}</td>
          <td><span class="tag ${l.statusCor === "verde" ? "green" : l.statusCor === "amarelo" ? "yellow" : "red"}">${esc(l.statusLabel)}</span></td>
        </tr>`).join("")}
      </tbody></table>`}
    </div>`;
  }

  /* --------------------------------- montagem geral --------------------------------- */

  function semDadosImportados() {
    return !dados.negociacoes.length && !dados.atendimentos.length && !dados.imoveisAtivos.length && !dados.imoveisInativos.length;
  }

  /** Aviso (não bloqueia a tela) para quando uma ou mais fontes de dado
   *  falharam ao carregar — ver comentário em analise360-relatorio.js.
   *  Deliberadamente distinto do estado "nada foi importado ainda": aqui
   *  pode haver dados perfeitamente importados, só que uma leitura específica
   *  falhou (o caso mais comum é uma regra de segurança do Firebase negando
   *  acesso a uma coleção — a mensagem original do Firebase vem exposta
   *  para facilitar o diagnóstico sem precisar abrir o console). */
  function avisoErrosHtml() {
    if (!errosCarregamento.length) return "";
    return `<div class="card pad" style="margin-bottom:18px;border-color:#f3caca">
      <b>${errosCarregamento.length === 1 ? "Uma fonte de dados" : `${errosCarregamento.length} fontes de dados`} não carregou${errosCarregamento.length === 1 ? "" : "ram"} — os números abaixo podem estar incompletos:</b>
      <ul style="margin:8px 0 0;padding-left:18px">
        ${errosCarregamento.map((er) => `<li><b>${esc(er.label)}:</b> ${esc(er.mensagem)}</li>`).join("")}
      </ul>
      <p class="kpi-delta" style="margin:8px 0 0">Se a mensagem falar em "permissão negada" ou "insufficient permissions", peça a um administrador para revisar as regras de segurança do Firebase dessa coleção.</p>
    </div>`;
  }

  function pintar() {
    if (semDadosImportados() && !errosCarregamento.length) {
      mount.innerHTML = `
        <div class="page-header"><div><h1>Análise 360° - Vendas</h1><p>Indicadores de VGV, comissões, atendimentos e carteira de imóveis.</p></div></div>
        <div class="card pad empty-state">
          <b>Nenhum dado importado ainda.</b>
          <p>Peça a um administrador para importar as planilhas do Univen em Configurações → Importação de Dados (Negociações fechadas, Atendimentos — Vendas, Imóveis ativos/inativos).</p>
        </div>`;
      return;
    }

    const ctx = contexto();
    const corpoPorAba = {
      geral: () => renderGeral(ctx), vgv: () => renderVgv(ctx), comissoes: () => renderComissoes(ctx),
      ranking: () => renderRanking(ctx), atendimentos: () => renderAtendimentos(ctx),
      carteira: () => renderCarteira(ctx), performance: () => renderPerformance(),
    };

    mount.innerHTML = `
      <div class="page-header"><div><h1>Análise 360° - Vendas</h1><p>Indicadores de VGV, comissões, atendimentos e carteira de imóveis, a partir das planilhas importadas em Configurações.</p></div></div>
      ${avisoErrosHtml()}
      <div class="card pad" style="margin-bottom:18px">
        <div class="grid cols3">
          <div class="field"><label>De</label><input type="date" id="a360De" value="${esc(filtro.de)}"></div>
          <div class="field"><label>Até</label><input type="date" id="a360Ate" value="${esc(filtro.ate)}"></div>
          <div class="field"><label>Corretor</label>${corretorSelectHtml()}</div>
        </div>
        ${admin && filtro.corretor ? `<button type="button" class="btn secondary" style="margin-top:10px" id="a360LimparCorretor">Limpar filtro de corretor</button>` : ""}
      </div>
      <div class="tabs" style="margin-bottom:18px">
        ${ABAS.map((a) => `<button data-aba="${a.id}" class="${aba === a.id ? "active" : ""}">${esc(a.label)}</button>`).join("")}
      </div>
      <div id="a360Corpo">${corpoPorAba[aba]()}</div>
      <p class="kpi-delta" style="margin-top:14px">Período: ${fmtDataBR(filtro.de)} – ${fmtDataBR(filtro.ate)}${filtro.corretor ? " · Corretor: " + esc(filtro.corretor) : ""}</p>
    `;

    mount.querySelector("#a360De")?.addEventListener("change", (e) => { filtro.de = e.target.value; pintar(); });
    mount.querySelector("#a360Ate")?.addEventListener("change", (e) => { filtro.ate = e.target.value; pintar(); });
    mount.querySelector("#a360Corretor")?.addEventListener("change", (e) => { filtro.corretor = e.target.value; pintar(); });
    mount.querySelector("#a360LimparCorretor")?.addEventListener("click", () => { filtro.corretor = ""; pintar(); });
    mount.querySelectorAll("[data-aba]").forEach((b) => b.addEventListener("click", () => { aba = b.dataset.aba; pintar(); }));
    mount.querySelectorAll("[data-barra-corretor]").forEach((b) => b.addEventListener("click", () => selecionarCorretor(b.dataset.barraCorretor)));
    mount.querySelectorAll("[data-linha-corretor]").forEach((tr) => tr.addEventListener("click", () => selecionarCorretor(tr.dataset.linhaCorretor)));
    mount.querySelector("#a360LimparImovel")?.addEventListener("click", () => { filtro.imovel = { campo: "", valor: "" }; pintar(); });
    mount.querySelectorAll("[data-barra-imovel-tipo]").forEach((b) => b.addEventListener("click", () => selecionarImovel("tipo", b.dataset.barraImovelTipo)));
    mount.querySelectorAll("[data-barra-imovel-cidade]").forEach((b) => b.addEventListener("click", () => selecionarImovel("cidade", b.dataset.barraImovelCidade)));
    mount.querySelectorAll("[data-barra-imovel-bairro]").forEach((b) => b.addEventListener("click", () => selecionarImovel("bairro", b.dataset.barraImovelBairro)));
    mount.querySelectorAll("[data-donut-imovel-finalidade]").forEach((b) => b.addEventListener("click", () => selecionarImovel("finalidade", b.dataset.donutImovelFinalidade)));
  }

  return () => { vivo = false; };
}

registerPage("analise360", renderAnalise360);
