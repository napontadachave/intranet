/* =========================================================================
   Análise 360° - Vendas — motor de relatório (agregações), separado da
   importação das planilhas (ver analise360-provider.js, que só lê/grava).

   Fontes de dado desta tela, e por que cada uma vem de um lugar diferente:
   - VGV, Negócios Fechados e Ranking de VGV/Negócios: vêm da planilha
     "Negociações fechadas" (Cloud Firestore, `analise360Negociacoes`).
   - Atendimentos: vêm da planilha "Atendimentos — Vendas" (Firestore,
     `analise360AtendimentosVendas`).
   - Carteira de Imóveis: vêm das planilhas "Imóveis ativos"/"Imóveis
     inativos" (Firestore, `analise360ImoveisAtivos/Inativos`).
   - Comissões: a pedido seu, NÃO vêm da coluna "Valor Comissão" da
     planilha de Negociações — vêm da cascata de comissão já calculada nos
     próprios cards do kanban de Negociações (Realtime Database,
     `kanbanCards`/`kanbanColumns`, ver js/providers/kanban-defaults.js).
     Isso é mais fiel ao que a imobiliária realmente rateia (imobiliária +
     corretor + parceiros), já que a planilha do Univen só traz um valor
     de comissão por linha, sem esse detalhe.
   - Performance: a pedido seu, em vez de reconstruir do zero o sistema de
     lançamento diário manual de atividades que o sistema anterior usava
     (parte nenhuma dele foi portada para a 2.0), reaproveita o Registro
     Diário - Vendas que já existe nesta versão (mesmos campos: vendas,
     propostas, visitas, captações, contatos).

   Todas as datas de filtro (`de`/`ate`) são strings "AAAA-MM-DD". As somas
   de dia (dia epoch) usam Date.UTC para não sofrer o problema clássico de
   fuso horário que empurra a data um dia pra trás/frente (mesmo cuidado já
   documentado em registros-diarios.js).

   `carregarDadosBrutos` e `carregarRegistrosVendas` NUNCA rejeitam por causa
   de uma fonte só: cada leitura é tentada individualmente e, se falhar
   (ex.: regra de segurança do Firebase negando aquela coleção específica),
   entra vazia e o erro fica guardado em `erros`/`erro` para a tela mostrar
   qual fonte falhou e por quê — em vez de uma tela inteira quebrada com um
   erro genérico no console.
   ========================================================================= */

import { lerColecaoEmChunks, lerImoveisFirestore } from "./analise360-provider.js";
import { listarLancamentosVendas } from "./registros-diarios.js";
import { getSlice } from "../sync.js";
import { ensureCardDefaults, DEFAULT_COLUMNS } from "./kanban-defaults.js";

/* ------------------------------ datas util ------------------------------ */

export function isoParaDiaEpoch(iso) {
  const p = String(iso || "").split("-").map(Number);
  if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
  return Math.floor(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}
export function diaEpochParaIso(dias) {
  const d = new Date(dias * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function inicioMesAtualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Mesma duração do período selecionado, imediatamente anterior a "De"
 *  (não é "o mês anterior") — usado para o delta "▲/▼ vs. período anterior". */
export function periodoAnterior(de, ate) {
  const deDia = isoParaDiaEpoch(de), ateDia = isoParaDiaEpoch(ate);
  if (deDia == null || ateDia == null) return null;
  const duracao = Math.max(ateDia - deDia, 0) + 1;
  return { de: diaEpochParaIso(deDia - duracao), ate: diaEpochParaIso(deDia - 1) };
}

/** Delta percentual entre dois totais — null quando não há dado do período
 *  anterior para comparar (em vez de mostrar uma queda de -100% enganosa). */
export function calcularDelta(atual, anterior) {
  if (!anterior) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function segmentosPorMes(deIso, ateIso) {
  const segmentos = [];
  let cursor = deIso;
  let guarda = 0;
  while (cursor <= ateIso && guarda < 600) {
    guarda++;
    const [y, m] = cursor.split("-").map(Number);
    const diasNoMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const fimMesIso = `${y}-${String(m).padStart(2, "0")}-${String(diasNoMes).padStart(2, "0")}`;
    const fimSegmentoIso = fimMesIso < ateIso ? fimMesIso : ateIso;
    const diasNoSegmento = isoParaDiaEpoch(fimSegmentoIso) - isoParaDiaEpoch(cursor) + 1;
    segmentos.push({ ano: y, mes: m, diasNoMes, diasNoSegmento });
    cursor = diaEpochParaIso(isoParaDiaEpoch(fimSegmentoIso) + 1);
  }
  return segmentos;
}

/* ------------------------------ filtros ------------------------------ */

function chave(v) {
  const s = String(v || "").trim();
  return s || "(Não informado)";
}

export function filtrarPorPeriodo(rows, campoData, de, ate) {
  return rows.filter((r) => {
    const d = r[campoData];
    if (!d) return false;
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  });
}

export function filtrarPorCorretor(rows, campo, corretor) {
  if (!corretor) return rows;
  return rows.filter((r) => chave(r[campo]) === corretor);
}

/** "Tipo da Negociação" contendo "loca"/"aluguel" é Locação; o resto
 *  (Venda, Permuta...) é Vendas — mesmo classificador do sistema anterior,
 *  necessário porque a planilha de Negociações fechadas traz os dois tipos
 *  juntos numa linha só. Esta etapa só entrega a aba Vendas, mas o filtro
 *  já fica pronto pra quando Locação for construída. */
export function tipoEhLocacao(tipoBruto) {
  const t = String(tipoBruto || "").toLowerCase();
  return /loca|aluguel/.test(t);
}

function contarPor(rows, campo) {
  const out = {};
  rows.forEach((r) => { const k = chave(r[campo]); out[k] = (out[k] || 0) + 1; });
  return out;
}

/* --------------------------- carregar planilhas --------------------------- */

/** Tenta uma leitura e, se falhar, devolve um valor padrão em vez de
 *  derrubar a tela inteira — cada fonte de dado desta tela vem de uma
 *  coleção/coleção diferente (às vezes com regra de segurança diferente no
 *  Firebase), então uma falha isolada (ex.: permissão negada numa coleção
 *  específica) não deveria impedir de ver as outras. O erro é guardado em
 *  `erros` (com o nome amigável da fonte) para aparecer na tela em vez de
 *  só no console — é a diferença entre "não achamos permissão pra ler
 *  Registro Diário - Vendas" e uma tela genérica de "erro, veja o console". */
async function tentar(label, fn, valorPadrao, erros) {
  try { return await fn(); }
  catch (e) { erros.push({ label, mensagem: e?.message || String(e) }); return valorPadrao; }
}

/** Carrega as 3 fontes de planilha usadas por esta tela (Negociações,
 *  Atendimentos-Vendas, Imóveis ativos+inativos) de uma vez. Chamado uma
 *  vez por sessão de tela — os filtros de período/corretor são aplicados
 *  depois, em memória, sem baixar de novo do Firestore a cada mudança. */
export async function carregarDadosBrutos() {
  const erros = [];
  const [negRes, avRes, iaRes, iiRes] = await Promise.all([
    tentar("Negociações fechadas", () => lerColecaoEmChunks("analise360Negociacoes"), { itens: [], meta: null }, erros),
    tentar("Atendimentos — Vendas", () => lerColecaoEmChunks("analise360AtendimentosVendas"), { itens: [], meta: null }, erros),
    tentar("Imóveis ativos", () => lerImoveisFirestore("analise360ImoveisAtivos"), { linhas: [], meta: null }, erros),
    tentar("Imóveis inativos", () => lerImoveisFirestore("analise360ImoveisInativos"), { linhas: [], meta: null }, erros),
  ]);
  const negociacoesVenda = (negRes.itens || []).filter((r) => !tipoEhLocacao(r.tipo));
  return {
    negociacoes: negociacoesVenda,
    atendimentos: avRes.itens || [],
    imoveisAtivos: iaRes.linhas || [],
    imoveisInativos: iiRes.linhas || [],
    metaNegociacoes: negRes.meta,
    metaAtendimentos: avRes.meta,
    metaImoveisAtivos: iaRes.meta,
    metaImoveisInativos: iiRes.meta,
    erros,
  };
}

/* ------------------------------ agregações ------------------------------ */

export function agregarNegociacoes(rows) {
  const vgvTotal = rows.reduce((s, r) => s + (Number(r.valorNegociado) || 0), 0);
  return {
    total: rows.length,
    vgvTotal,
    ticketMedio: rows.length ? vgvTotal / rows.length : 0,
    porMes: somarPor(rows, (r) => (r.data || "").slice(0, 7), "valorNegociado"),
    porCorretor: somarPor(rows, "responsavel", "valorNegociado"),
    contagemPorCorretor: contarPor(rows, "responsavel"),
    porTipo: contarPor(rows, "tipo"),
  };
}

/** Soma `campoValor` agrupado por `campoOuFn` — que pode ser o nome de um
 *  campo ("responsavel") ou uma função que deriva a chave a partir da
 *  linha (usado para agrupar por mês, ex.: `(r) => r.data.slice(0,7)`). */
function somarPor(rows, campoOuFn, campoValor) {
  const out = {};
  rows.forEach((r) => {
    const k = typeof campoOuFn === "function" ? chave(campoOuFn(r)) : chave(r[campoOuFn]);
    out[k] = (out[k] || 0) + (Number(r[campoValor]) || 0);
  });
  return out;
}

export function agregarAtendimentos(rows) {
  return {
    total: rows.length,
    porCorretor: contarPor(rows, "corretor"),
    porMidia: contarPor(rows, "midia"),
    porEtapa: contarPor(rows, "etapa"),
    porMes: contarPor(rows.map((r) => ({ mes: (r.data || "").slice(0, 7) })), "mes"),
  };
}

export function agregarImoveis(rows, modo) {
  const base = modo === "venda" ? rows.filter((r) => r.valorVenda > 0)
    : modo === "locacao" ? rows.filter((r) => r.valorLocacao > 0)
    : rows;
  const valoresVenda = rows.filter((r) => r.valorVenda > 0).map((r) => r.valorVenda);
  const valoresLocacao = rows.filter((r) => r.valorLocacao > 0).map((r) => r.valorLocacao);
  const media = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    total: base.length,
    porTipo: contarPor(base, "tipo"),
    porCidade: contarPor(base, "cidade"),
    porBairro: contarPor(base, "bairro"),
    porFinalidade: contarPor(base, "finalidade"),
    ticketMedioVenda: media(valoresVenda),
    ticketMedioLocacao: media(valoresLocacao),
  };
}

/** Mesma filtragem de `filtrarPorCorretor`, mas genérica pra qualquer campo
 *  — usada pelo clique-para-filtrar da Carteira de Imóveis (tipo, cidade,
 *  bairro, finalidade), que não tem corretor associado. */
export function filtrarPorCampo(rows, campo, valor) {
  if (!valor) return rows;
  return rows.filter((r) => chave(r[campo]) === valor);
}

/* --------------------- Comissões (a partir do kanban) --------------------- */

/** Considera "fechada" a negociação que está HOJE na coluna de maior
 *  "order" (mesma regra de negociacoes.js) e cuja `dataFechamento` cai no
 *  período pedido. Cards antigos que já estavam finalizados antes desta
 *  funcionalidade existir não têm `dataFechamento` — ficam de fora do
 *  relatório por período até serem tocados de novo (reabrir e salvar já
 *  preenche a data), mas continuam contando no total geral sem filtro de
 *  período (ver `semData` no retorno). */
export function carregarNegociosFechadosKanban({ de, ate, corretor } = {}) {
  // Mesmo fallback de negociacoes.js: sem nenhuma coluna customizada salva
  // ainda no Realtime Database, o kanban usa as colunas padrão em memória
  // (nunca chega a gravar DEFAULT_COLUMNS na coleção) — sem repetir esse
  // fallback aqui, `colunas` viria vazio e nenhuma negociação seria
  // considerada "fechada".
  const brutas = getSlice("kanbanColumns");
  const colunas = (Array.isArray(brutas) && brutas.length ? brutas : DEFAULT_COLUMNS)
    .slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const colunaFinalId = colunas.length ? colunas[colunas.length - 1].id : null;
  const cards = (getSlice("kanbanCards") || []).map((c, i) => ensureCardDefaults(c, i));
  const fechados = cards.filter((c) => colunaFinalId && c.columnId === colunaFinalId);

  const comData = fechados.filter((c) => c.dataFechamento);
  const semData = fechados.filter((c) => !c.dataFechamento);
  const dataISO = (iso) => String(iso || "").slice(0, 10);
  const noPeriodo = comData.filter((c) => {
    const d = dataISO(c.dataFechamento);
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    return true;
  });
  const doCorretor = corretor ? noPeriodo.filter((c) => chave(c.ownerName) === corretor) : noPeriodo;

  const comissaoTotal = doCorretor.reduce((s, c) => s + (Number(c.comissaoImobiliariaValor) || 0), 0);
  const vgvTotal = doCorretor.reduce((s, c) => s + (Number(c.valorVenda) || 0), 0);
  const porPessoa = {};
  doCorretor.forEach((c) => {
    (c.comissionamento || []).forEach((linha) => {
      const nome = chave(linha.nome);
      porPessoa[nome] = (porPessoa[nome] || 0) + (Number(linha.valor) || 0);
    });
  });
  const porMes = somarComissaoPorMes(doCorretor);

  return { total: doCorretor.length, comissaoTotal, vgvTotal, porPessoa, porMes, semDataCount: semData.length };
}
function somarComissaoPorMes(cards) {
  const out = {};
  cards.forEach((c) => {
    const mes = String(c.dataFechamento || "").slice(0, 7);
    out[mes] = (out[mes] || 0) + (Number(c.comissaoImobiliariaValor) || 0);
  });
  return out;
}

/** Nomes de corretores conhecidos pelo kanban (responsável de cada card),
 *  usados para popular o filtro de corretor mesmo quando a pessoa só
 *  aparece em comissionamento, não como "responsável" de nenhum card. */
export function nomesResponsaveisKanban() {
  const cards = (getSlice("kanbanCards") || []).map((c, i) => ensureCardDefaults(c, i));
  return [...new Set(cards.map((c) => chave(c.ownerName)).filter((n) => n !== "(Não informado)"))];
}

/* ------------------- Performance (a partir do Registro Diário) ------------------- */

const METAS_PERFORMANCE = [
  { campo: "vendas", label: "Vendas", tipo: "mensal", meta: 2, peso: 35, principal: true },
  { campo: "propostas", label: "Propostas", tipo: "mensal", meta: 5, peso: 20 },
  { campo: "visitas", label: "Visitas", tipo: "semanal", meta: 3, peso: 20 },
  { campo: "captacoes", label: "Captações", tipo: "semanal", meta: 3, peso: 15 },
  { campo: "contatos", label: "Contatos", tipo: "diaria", meta: 20, peso: 10 },
];

function metaEsperada(m, de, ate) {
  const deDia = isoParaDiaEpoch(de), ateDia = isoParaDiaEpoch(ate);
  if (deDia == null || ateDia == null) return 0;
  const diasNoPeriodo = ateDia - deDia + 1;
  if (m.tipo === "diaria") return m.meta * diasNoPeriodo;
  if (m.tipo === "semanal") return (m.meta / 7) * diasNoPeriodo;
  return segmentosPorMes(de, ate).reduce((soma, seg) => soma + (m.meta / seg.diasNoMes) * seg.diasNoSegmento, 0);
}

/** Status por faixa de pontuação, mesmas faixas do sistema anterior. */
export function statusPerformance(score) {
  if (score >= 90) return { label: "Alta performance", cor: "verde" };
  if (score >= 80) return { label: "Meta atingida", cor: "verde" };
  if (score >= 70) return { label: "Zona de alerta", cor: "amarelo" };
  return { label: "Baixa performance", cor: "vermelho" };
}

/** Calcula a pontuação de performance de UM colaborador a partir dos
 *  lançamentos de Registro Diário - Vendas dele no período. As metas/pesos
 *  reaproveitam os valores do sistema anterior (papel "corretor"); o
 *  pro-rateio, porém, é por dias corridos, não dias úteis — simplificação
 *  combinada, já que a fonte do dado mudou (era um lançamento manual à
 *  parte; agora é o Registro Diário - Vendas que já existe nesta versão). */
export function calcularPerformance(registrosDoCorretor, de, ate) {
  const real = { vendas: 0, propostas: 0, visitas: 0, captacoes: 0, contatos: 0 };
  registrosDoCorretor.forEach((r) => { for (const k in real) real[k] += Number(r[k]) || 0; });

  let score = 0;
  const metricas = METAS_PERFORMANCE.map((m) => {
    const esperado = metaEsperada(m, de, ate);
    const pct = esperado > 0 ? (real[m.campo] / esperado) * 100 : (real[m.campo] > 0 ? 120 : 0);
    const parte = (Math.min(pct, 120) / 100) * m.peso;
    score += parte;
    return { ...m, real: real[m.campo], esperado, pct, parte };
  });
  score = Math.min(120, score);

  const principal = metricas.find((m) => m.principal);
  const travado = !!(principal && principal.pct < 80);
  if (travado) score = Math.min(score, 80);

  return { metricas, score, travado, ...statusPerformanceComScore(score) };
}
function statusPerformanceComScore(score) {
  const s = statusPerformance(score);
  return { statusLabel: s.label, statusCor: s.cor };
}

/** Mesmo cuidado de `carregarDadosBrutos`: se a leitura falhar (ex.:
 *  permissão negada na coleção `registrosDiariosVendas`), devolve lista
 *  vazia + o erro em vez de derrubar a tela inteira. */
export async function carregarRegistrosVendas() {
  const erros = [];
  const registros = await tentar("Registro Diário - Vendas", () => listarLancamentosVendas(), [], erros);
  return { registros, erro: erros[0] || null };
}
