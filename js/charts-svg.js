/* =========================================================================
   Gráficos simples, sem biblioteca externa — usados pela Análise 360°.

   O sistema anterior desenhava um conjunto bem maior de gráficos (SVG à
   mão: linha, barras por ano, barras diárias, funil, rosca...). Aqui o
   conjunto foi simplificado para três formas reutilizáveis que cobrem
   todos os casos desta tela: uma lista de barras ranqueada (a mais usada,
   de longe), uma "rosca" simples via CSS conic-gradient (mais barata que
   desenhar arcos em SVG à mão) e um gráfico de barras por mês.

   Todas recebem `esc`/`fmtMoneyBRL` de fora (ui-kit.js) para não duplicar
   formatação, e são só strings de HTML — quem chama decide como tratar
   cliques (usando o atributo de dado que cada uma aceita).
   ========================================================================= */

const PALETA = ["#ffc71b", "#2457d6", "#148653", "#c9281c", "#24262d", "#f0b800", "#7a5cff", "#0f9aa8"];

function corDoIndice(i) {
  return PALETA[i % PALETA.length];
}

/** Ordena um mapa {chave: valor} (do jeito que as funções de agregação em
 *  analise360-relatorio.js devolvem) em pares [chave, valor], decrescente
 *  por valor, limitado a `n`. */
export function topN(mapa, n = 10) {
  return Object.entries(mapa || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Lista de barras horizontais ranqueada — o gráfico mais reaproveitado da
 *  tela (rankings de corretor, imóveis por tipo/cidade/bairro, atendimentos
 *  por mídia/etapa...). `itens` é um array de [label, valor] (ex.: saída de
 *  `topN`). `formatarValor` por padrão mostra o número cru; passe
 *  `fmtMoneyBRL` para valores em R$. `dataAttr` (ex.: "corretor") faz cada
 *  barra virar clicável via `data-barra-${dataAttr}="valor"` — quem chama
 *  liga o listener e decide o que filtrar. `ativo` marca a barra cujo
 *  label bate como destacada (filtro já aplicado). */
export function svgBarraLista(itens, { formatarValor = (v) => String(v), dataAttr = "", ativo = "", esc = (s) => s } = {}) {
  if (!itens.length) return `<p class="kpi-delta">Sem dados para este período.</p>`;
  const max = Math.max(...itens.map(([, v]) => v), 1);
  return `<div class="barra-lista">
    ${itens.map(([label, valor], i) => {
      const pct = Math.max(2, Math.round((valor / max) * 100));
      const clic = dataAttr ? `data-barra-${dataAttr}="${esc(label)}" style="cursor:pointer"` : "";
      const destaque = ativo && ativo === label ? " barra-ativa" : "";
      return `<div class="barra-lista-item${destaque}" ${clic}>
        <div class="barra-lista-label">${esc(label)}</div>
        <div class="barra-lista-trilho"><div class="barra-lista-fill" style="width:${pct}%;background:${corDoIndice(i)}"></div></div>
        <div class="barra-lista-valor">${esc(formatarValor(valor))}</div>
      </div>`;
    }).join("")}
  </div>`;
}

/** "Rosca" (donut) via CSS conic-gradient, com legenda ao lado — bem mais
 *  barato que desenhar arcos em SVG e visualmente equivalente para poucas
 *  fatias (o caso de uso aqui: tipo de negociação, finalidade do imóvel).
 *  Mesmas convenções de `dataAttr`/`ativo`/`esc` do `svgBarraLista`. */
export function svgDonut(itens, { formatarValor = (v) => String(v), dataAttr = "", ativo = "", esc = (s) => s } = {}) {
  if (!itens.length) return `<p class="kpi-delta">Sem dados para este período.</p>`;
  const total = itens.reduce((s, [, v]) => s + v, 0) || 1;
  let acumulado = 0;
  const fatias = itens.map(([label, valor], i) => {
    const inicio = (acumulado / total) * 360;
    acumulado += valor;
    const fim = (acumulado / total) * 360;
    return `${corDoIndice(i)} ${inicio}deg ${fim}deg`;
  });
  return `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
    <div style="width:120px;height:120px;border-radius:50%;flex-shrink:0;background:conic-gradient(${fatias.join(",")})"></div>
    <div style="flex:1;min-width:160px">
      ${itens.map(([label, valor], i) => {
        const clic = dataAttr ? `data-donut-${dataAttr}="${esc(label)}" style="cursor:pointer"` : "";
        const destaque = ativo && ativo === label ? "font-weight:700" : "";
        const pct = Math.round((valor / total) * 100);
        return `<div ${clic} style="display:flex;align-items:center;gap:8px;padding:3px 0;${destaque}">
          <span style="width:10px;height:10px;border-radius:50%;background:${corDoIndice(i)};flex-shrink:0"></span>
          <span style="flex:1">${esc(label)}</span>
          <span class="kpi-delta">${esc(formatarValor(valor))} (${pct}%)</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

/** Barras verticais por mês (SVG simples) — usado para VGV/Comissão/
 *  Atendimentos mês a mês. `pontos` é [[mesISO "AAAA-MM", valor], ...] JÁ
 *  ordenado cronologicamente (quem chama ordena, já que a ordem certa
 *  depende do que faz sentido no contexto). */
export function svgBarrasMes(pontos, { formatarValor = (v) => String(v), formatarMes = (m) => m, esc = (s) => s } = {}) {
  if (!pontos.length) return `<p class="kpi-delta">Sem dados para este período.</p>`;
  const max = Math.max(...pontos.map(([, v]) => v), 1);
  const largura = Math.max(pontos.length * 64, 240);
  const alturaBarra = 130;
  const barras = pontos.map(([mes, valor], i) => {
    const h = Math.max(3, Math.round((valor / max) * alturaBarra));
    const x = i * 64 + 12;
    return `
      <text x="${x + 20}" y="${alturaBarra - h + (h > 18 ? 14 : -6)}" font-size="10" fill="${h > 18 ? "#fff" : "#181a1f"}" text-anchor="middle">${esc(formatarValor(valor))}</text>
      <rect x="${x}" y="${alturaBarra - h}" width="40" height="${h}" rx="4" fill="#ffc71b"></rect>
      <text x="${x + 20}" y="${alturaBarra + 16}" font-size="10" fill="#737782" text-anchor="middle">${esc(formatarMes(mes))}</text>
    `;
  }).join("");
  return `<div style="overflow-x:auto"><svg width="${largura}" height="${alturaBarra + 26}" viewBox="0 0 ${largura} ${alturaBarra + 26}">${barras}</svg></div>`;
}

/** Setinha + cor pro delta "vs. período anterior" (KPI cards). `delta` é um
 *  percentual (pode ser null quando não há período anterior pra comparar). */
export function deltaHtml(delta, { esc = (s) => s } = {}) {
  if (delta == null || !isFinite(delta)) return `<span class="kpi-delta">Sem dado anterior</span>`;
  const cor = delta >= 0 ? "var(--verde)" : "var(--vermelho)";
  const seta = delta >= 0 ? "▲" : "▼";
  return `<span class="kpi-delta" style="color:${cor};font-weight:700">${seta} ${esc(Math.abs(Math.round(delta * 10) / 10).toLocaleString("pt-BR"))}% vs. período anterior</span>`;
}
