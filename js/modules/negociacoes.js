/* =========================================================================
   Negociações — kanban de vendas, portado fielmente da versão 1.0.

   Arquitetura dos modais (ajustada a pedido, após a primeira versão):
   - "Editar venda" é um formulário único e comprido (sem abas de Dados /
     Comissão separadas, como na v1.0), com EXCEÇÃO de "Itens que
     permanecerão no imóvel", que fica em sua própria aba (assim como
     Checklist foi movido para uma aba na tela de visualização) — o pedido
     explícito foi "faça o card dessa forma [v1.0], com exceção dos itens
     que permanecerão no imóvel, que pode ser uma guia à parte".
   - Abrir um card existente mostra a tela de "Visualização" (Detalhes /
     Checklist / Documentos / Chat) — o mesmo modelo da v1.0, só que com o
     Checklist como aba própria em vez de ficar dentro de "Detalhes". A
     partir da visualização dá pra entrar em "Editar" ou "Excluir".
   - Criar uma negociação nova abre direto o formulário de edição.

   Mesma cascata de cálculo de comissão da v1.0 e o mesmo comportamento de
   arrastar-e-soltar (solta na coluna, não há reordenar dentro da coluna).

   Simplificação consciente que permanece (sinalizada para você): como o
   módulo de Permissões ainda não foi portado, o controle de "só vejo meus
   cards" usa o mesmo campo `perms` do usuário (já compatível com o banco
   atual) mais o `isAdmin()` de auth.js (que também aceita o `perfil`/
   `role` = "admin" do cadastro de sempre, não só `permissoes.admin`), de
   forma simplificada: quem é admin ou tem `perms.view_all_users` vê tudo;
   do contrário, só cards em que a pessoa é criadora ou responsável.
   ========================================================================= */

import { subscribe, getSlice, patchKey } from "../sync.js";
import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { openModal, closeModal, toast, esc, uid, fmtDate, fmtDateTime, maskPhoneBR, maskMoneyBRTyping, maskCEP } from "../ui-kit.js";
import {
  DEFAULT_COLUMNS, PROPERTY_ITEMS, BANCOS, ESTADOS_CIVIS,
  parseMoneyLoose, formatMoneyBR, formatEnderecoImovel, recalcComissaoCascata,
  ensureCardDefaults, emptyPessoa,
} from "../providers/kanban-defaults.js";
import { gerarPropostaPDF } from "../providers/proposta-pdf.js";
import { buscarEnderecoPorCEP } from "../providers/cep.js";
import { avaliarRegrasParaMovimentacao } from "../providers/notificacoes.js";

function getColumns() {
  const cols = getSlice("kanbanColumns");
  return (Array.isArray(cols) && cols.length ? cols : DEFAULT_COLUMNS)
    .slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}
function getCards() {
  return (getSlice("kanbanCards") || []).map((c, i) => ensureCardDefaults(c, i));
}
async function saveCards(cards) {
  await patchKey("kanbanCards", cards);
}

/** A coluna de maior "order" é tratada como a etapa final do funil (hoje,
 *  "Finalizado" — mas as colunas são livres para o admin renomear/reordenar,
 *  então usamos a posição, não um id fixo). Usado só para gravar/zerar
 *  `dataFechamento` (ver kanban-defaults.js) — a Análise 360° - Comissões
 *  usa esse campo para saber quando uma negociação fechou, já que o kanban
 *  nunca teve um evento explícito de "fechamento". */
function isColunaFinal(columnId, columns) {
  if (!columns.length) return false;
  return columnId === columns[columns.length - 1].id;
}

/** Aplica a regra acima a um card que acabou de mudar de coluna (ou de ser
 *  salvo com uma coluna escolhida no formulário): grava `dataFechamento` na
 *  primeira vez que ele chega na coluna final (preserva se já tinha), e
 *  limpa se ele estiver em qualquer outra coluna. */
function aplicarDataFechamento(card, columns) {
  if (isColunaFinal(card.columnId, columns)) {
    if (!card.dataFechamento) card.dataFechamento = new Date().toISOString();
  } else {
    card.dataFechamento = "";
  }
  return card;
}

/** Guarda qual campo estava focado (e a posição do cursor nele) antes de um
 *  trecho de HTML ser recriado do zero, para poder devolver o foco depois —
 *  necessário porque vários campos recalculam e redesenham a aba inteira a
 *  cada tecla digitada (ex.: % de comissão). */
function captureFocus(container) {
  const active = document.activeElement;
  if (!active || !container.contains(active)) return null;
  const selStart = "selectionStart" in active ? active.selectionStart : null;
  const selEnd = "selectionEnd" in active ? active.selectionEnd : null;
  if (active.id) return { by: "id", value: active.id, selStart, selEnd };
  const key = Object.keys(active.dataset || {})[0];
  if (key) {
    const attr = key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
    return { by: "data", attr, value: active.dataset[key], selStart, selEnd };
  }
  return null;
}
function restoreFocus(container, info) {
  if (!info) return;
  let el;
  try {
    el = info.by === "id"
      ? container.querySelector(`#${CSS.escape(info.value)}`)
      : container.querySelector(`[data-${info.attr}="${CSS.escape(info.value)}"]`);
  } catch (e) { return; }
  if (!el) return;
  el.focus();
  if (info.selStart != null && typeof el.setSelectionRange === "function") {
    try { el.setSelectionRange(info.selStart, info.selEnd); } catch (e) { /* alguns tipos de input não suportam */ }
  }
}

/** Trava a altura do modal no tamanho da primeira aba pintada (a mais alta,
 *  normalmente "Detalhes"/"Dados"), pra evitar que ele "encolha" visualmente
 *  ao trocar pra uma aba com menos conteúdo (ex.: Documentos, Chat). Só
 *  encolhe de novo se o conteúdo de fato precisar de mais espaço do que a
 *  altura travada (min-height, não max-height). */
function lockModalHeight(modalEl) {
  if (!modalEl) return;
  requestAnimationFrame(() => {
    const h = modalEl.getBoundingClientRect().height;
    if (h > 0) modalEl.style.minHeight = h + "px";
  });
}

function canViewAllUsers() {
  const me = getCurrentUser();
  return !!me?.perms?.view_all_users || isAdmin(me);
}
function canAccessCard(card) {
  if (canViewAllUsers()) return true;
  const me = getCurrentUser();
  if (!me) return false;
  return String(card.createdBy) === String(me.id) || String(card.ownerId) === String(me.id);
}

/* =============================== Board =============================== */

let boardCreatedByFilter = "";

export function renderNegociacoes(mount) {
  function paint() {
    const columns = getColumns();
    const allCards = getCards();
    const visibleCards = allCards.filter(canAccessCard);
    const filterOptions = canViewAllUsers()
      ? [...new Map(visibleCards.map((c) => [c.createdBy, c.createdByName || "—"])).entries()]
        .filter(([id]) => id)
      : [];

    mount.innerHTML = `
      <div class="page-header">
        <div><h1>Negociações</h1><p>Kanban de vendas em andamento.</p></div>
        <div style="display:flex;gap:10px">
          <button class="btn secondary" id="btnGestao">Gerenciar colunas</button>
          <button class="btn primary" id="btnNovoCard">+ Nova negociação</button>
        </div>
      </div>
      ${filterOptions.length ? `
        <div class="field" style="max-width:280px;margin-bottom:14px">
          <label>Filtrar por quem cadastrou</label>
          <select id="createdByFilter">
            <option value="">Todos os usuários</option>
            ${filterOptions.map(([id, name]) => `<option value="${id}" ${boardCreatedByFilter === id ? "selected" : ""}>${esc(name)}</option>`).join("")}
          </select>
        </div>` : ""}
      <div class="kanban-nav">
        <button type="button" class="btn secondary" id="kanbanScrollLeft" aria-label="Rolar colunas para a esquerda">‹</button>
        <button type="button" class="btn secondary" id="kanbanScrollRight" aria-label="Rolar colunas para a direita">›</button>
      </div>
      <div class="kanban" id="kanbanBoard">
        ${columns.map((col) => {
          const colCards = visibleCards
            .filter((c) => c.columnId === col.id)
            .filter((c) => !boardCreatedByFilter || c.createdBy === boardCreatedByFilter)
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
          return `
          <div class="kanban-col" data-col="${col.id}">
            <div class="kanban-col-head"><span>${esc(col.title)}</span><span class="tag gray">${colCards.length}</span></div>
            <div class="kanban-col-body" data-dropzone="${col.id}" style="min-height:60px">
              ${colCards.map(renderCard).join("")}
            </div>
          </div>`;
        }).join("")}
      </div>
    `;

    mount.querySelector("#btnNovoCard").addEventListener("click", () => openCardModal(null));
    mount.querySelector("#btnGestao").addEventListener("click", openGestaoModal);
    mount.querySelector("#createdByFilter")?.addEventListener("change", (e) => { boardCreatedByFilter = e.target.value; paint(); });

    const board = mount.querySelector("#kanbanBoard");
    mount.querySelector("#kanbanScrollLeft").addEventListener("click", () => board.scrollBy({ left: -320, behavior: "smooth" }));
    mount.querySelector("#kanbanScrollRight").addEventListener("click", () => board.scrollBy({ left: 320, behavior: "smooth" }));

    mount.querySelectorAll("[data-card]").forEach((el) => {
      el.addEventListener("click", () => openCardModal(el.dataset.card));
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", el.dataset.card));
    });
    mount.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openViewModal(b.dataset.open); }));
    mount.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openEditModal(b.dataset.edit); }));
    mount.querySelectorAll("[data-del-card]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Excluir esta negociação?")) return;
      const cards = getCards();
      const card = cards.find((c) => c.id === b.dataset.delCard);
      if (!card || !canAccessCard(card)) { toast("Sem permissão para excluir este card.", "warn"); return; }
      await saveCards(cards.filter((c) => c.id !== b.dataset.delCard));
      toast("Negociação excluída.", "ok");
    }));
    mount.querySelectorAll("[data-dropzone]").forEach((zone) => {
      zone.addEventListener("dragover", (e) => e.preventDefault());
      zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        const cardId = e.dataTransfer.getData("text/plain");
        const cards = getCards();
        const card = cards.find((c) => c.id === cardId);
        if (!card || !canAccessCard(card)) { toast("Sem permissão para mover este card.", "warn"); return; }
        const colunaAnterior = card.columnId;
        card.columnId = zone.dataset.dropzone;
        // A pedido seu: a cascata de comissão (ver kanban-defaults.js) até
        // aqui só era recalculada ao salvar pelo modal de edição — arrastar
        // um card direto no quadro pra "Finalizado" não recalculava nada.
        // Agora, toda vez que um card CAI na coluna final por arrastar,
        // recalculamos a comissão na hora com os dados que o card já tem,
        // garantindo que a Análise 360° - Comissões (que soma
        // `comissaoImobiliariaValor`/`comissionamento` direto dos cards)
        // sempre reflita um valor calculado no momento do fechamento, e não
        // dependa de alguém ter aberto o card pra editar antes.
        if (isColunaFinal(card.columnId, getColumns())) Object.assign(card, recalcComissaoCascata(card));
        aplicarDataFechamento(card, getColumns());
        card.order = Date.now();
        card.updatedAt = new Date().toISOString();
        card.updatedBy = getCurrentUser()?.id || "";
        await saveCards(cards);
        // A pedido seu: avisa o responsável do card (e quem mais a regra
        // determinar) sempre que ele mudar de etapa — ver Configurações →
        // Gestão de Notificações. Não bloqueia o arrastar se isso falhar.
        avaliarRegrasParaMovimentacao(card, colunaAnterior, card.columnId, getColumns(), getCurrentUser())
          .catch((err) => console.error("Erro ao avaliar regras de notificação:", err));
      });
    });
  }

  paint();
  const u1 = subscribe("kanbanCards", paint);
  const u2 = subscribe("kanbanColumns", paint);
  return () => { u1(); u2(); };
}

function renderCard(c) {
  const checklistDone = (c.checklist || []).filter((i) => i.done).length;
  const checklistTotal = (c.checklist || []).length;
  const pct = checklistTotal ? Math.round((checklistDone / checklistTotal) * 100) : 0;
  const unread = (c.messages || []).length && getCurrentUser()
    ? c.messages.some((m) => !m.readBy?.[getCurrentUser().id])
    : false;
  const vendedor = c.vendedores?.[0]?.nome || "";
  const comprador = c.compradores?.[0]?.nome || "";
  const comissaoPrestadores = (c.comissionamento || [])
    .filter((r) => !r.fixo)
    .reduce((soma, r) => soma + (Number(r.valor) || 0), 0);

  return `<div class="kanban-card" data-card="${c.id}">
    <b>${esc(c.title)}</b>
    <div class="meta">Venda: ${c.valorVenda ? formatMoneyBR(parseMoneyLoose(c.valorVenda)) : "—"}</div>
    <div class="meta">Comissão Bruta: ${formatMoneyBR(c.comissaoImobiliariaValor)}</div>
    <div class="meta">Comissão Prestadores: ${formatMoneyBR(comissaoPrestadores)}</div>
    <div class="meta">Vendedor(a): ${esc(vendedor) || "—"}</div>
    <div class="meta">Comprador(a): ${esc(comprador) || "—"}</div>
    <div class="meta">Checklist: ${checklistDone}/${checklistTotal}${unread ? " · <b style='color:var(--vermelho)'>nova mensagem</b>" : ""}</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="meta">Cadastrado por ${esc(c.createdByName) || "—"} em ${fmtDateTime(c.createdAt)}</div>
    <div class="card-actions">
      <button type="button" class="btn secondary" data-open="${c.id}">Abrir</button>
      <button type="button" class="btn secondary" data-edit="${c.id}">Editar</button>
      <button type="button" class="btn danger" data-del-card="${c.id}">×</button>
    </div>
  </div>`;
}

/* =========================== Gestão de colunas =========================== */

function openGestaoModal() {
  const columns = getColumns();
  const body = openModal("Gerenciar colunas do kanban", `
    <div class="field"><label>Nova coluna</label>
      <div style="display:flex;gap:8px"><input id="newColName" placeholder="Ex.: Em análise" style="flex:1"><button class="btn primary" id="btnAddCol">Criar</button></div>
    </div>
    <div id="colList" style="margin-top:14px"></div>
    <div class="actions"><button class="secondary" id="btnClose">Fechar</button></div>
  `, { width: 560 });

  function paintList() {
    const cols = getColumns();
    const cardsByCol = getCards().reduce((acc, c) => { acc[c.columnId] = (acc[c.columnId] || 0) + 1; return acc; }, {});
    body.querySelector("#colList").innerHTML = cols.map((c, i) => `
      <div class="rule-row">
        <input class="grow" data-rename="${c.id}" value="${esc(c.title)}">
        <button class="btn ghost" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn ghost" data-down="${i}" ${i === cols.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn danger" data-del="${c.id}" ${cardsByCol[c.id] ? "disabled title='Só é possível excluir colunas sem cards'" : ""}>Excluir</button>
      </div>`).join("");

    body.querySelectorAll("[data-rename]").forEach((inp) => inp.addEventListener("change", () => renameColumn(inp.dataset.rename, inp.value)));
    body.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => moveColumn(Number(b.dataset.up), -1)));
    body.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () => moveColumn(Number(b.dataset.down), 1)));
    body.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteColumn(b.dataset.del)));
  }

  async function renameColumn(id, title) {
    const next = getColumns().map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c));
    await patchKey("kanbanColumns", next);
    toast("Coluna renomeada.", "ok");
  }
  async function moveColumn(index, dir) {
    const cols = getColumns();
    const j = index + dir;
    if (j < 0 || j >= cols.length) return;
    [cols[index], cols[j]] = [cols[j], cols[index]];
    cols.forEach((c, i) => { c.order = i + 1; });
    await patchKey("kanbanColumns", cols);
    paintList();
  }
  async function deleteColumn(id) {
    const inUse = getCards().some((c) => c.columnId === id);
    if (inUse) { toast("Essa coluna ainda tem negociações — mova-as antes de excluir.", "warn"); return; }
    if (!confirm("Excluir esta coluna?")) return;
    await patchKey("kanbanColumns", getColumns().filter((c) => c.id !== id));
    paintList();
  }

  body.querySelector("#btnAddCol").addEventListener("click", async () => {
    const name = body.querySelector("#newColName").value.trim();
    if (!name) return;
    const cols = getColumns();
    await patchKey("kanbanColumns", [...cols, { id: uid("col"), title: name, order: cols.length + 1 }]);
    body.querySelector("#newColName").value = "";
    paintList();
  });
  body.querySelector("#btnClose").addEventListener("click", closeModal);
  paintList();
}

/* ======================= Abrir card: view ou edição ======================= */

function openCardModal(cardId) {
  if (cardId) openViewModal(cardId);
  else openEditModal(null);
}

/* ============================ Visualização ============================ */

const VIEW_TABS = [
  { id: "detalhes", label: "Detalhes" },
  { id: "checklist", label: "Checklist" },
  { id: "documentos", label: "Documentos" },
  { id: "chat", label: "Chat" },
];

function openViewModal(cardId) {
  function getCard() { return getCards().find((c) => c.id === cardId); }

  const initial = getCard();
  if (!initial || !canAccessCard(initial)) { toast("Sem permissão para abrir este card.", "warn"); return; }

  let activeTab = "detalhes";
  const body = openModal(initial.title, `
    <div class="tabs" id="viewTabs" style="margin-bottom:16px">
      ${VIEW_TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === activeTab ? "active" : ""}">${t.label}</button>`).join("")}
    </div>
    <div id="viewTabBody"></div>
  `, {
    width: 760,
    headerActionsHtml: `<button type="button" class="btn secondary" id="btnViewEditar">Editar</button><button type="button" class="btn secondary" id="btnGerarProposta">Gerar proposta (PDF)</button><button type="button" class="btn danger" id="btnViewExcluir">Excluir</button>`,
  });
  const modalEl = body.closest(".modal");

  function paint() {
    const card = getCard();
    if (!card) { closeModal(); return; }
    body.querySelectorAll("#viewTabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
      b.onclick = () => { activeTab = b.dataset.tab; paint(); };
    });
    const tabBody = body.querySelector("#viewTabBody");
    const restore = captureFocus(tabBody);
    if (activeTab === "detalhes") renderViewDetalhes(tabBody, card);
    else if (activeTab === "checklist") renderViewChecklist(tabBody, card, paint);
    else if (activeTab === "documentos") renderViewDocs(tabBody, card, paint);
    else if (activeTab === "chat") renderViewChat(tabBody, card, paint);
    restoreFocus(tabBody, restore);
  }
  paint();
  lockModalHeight(modalEl);

  modalEl.querySelector("#btnViewEditar").addEventListener("click", () => openEditModal(cardId));
  modalEl.querySelector("#btnGerarProposta").addEventListener("click", async () => {
    const card = getCard();
    if (!card) return;
    try {
      const faltando = await gerarPropostaPDF(card);
      if (faltando.length) toast(`Proposta gerada, mas falta preencher: ${faltando.join(", ")}.`, "warn");
      else toast("Proposta gerada.", "ok");
    } catch (err) {
      toast(err.message || "Não foi possível gerar a proposta.", "warn");
    }
  });
  modalEl.querySelector("#btnViewExcluir").addEventListener("click", async () => {
    if (!confirm("Excluir esta negociação?")) return;
    await saveCards(getCards().filter((c) => c.id !== cardId));
    closeModal();
    toast("Negociação excluída.", "ok");
  });
}

function renderViewDetalhes(el, card) {
  const base = card.comissaoImobiliariaValor - card.quintoAndarValor;
  const pessoaLinhas = (p) => `
    <div class="detalhe-linha"><b>Nome:</b> ${esc(p.nome) || "—"}</div>
    <div class="detalhe-linha"><b>E-mail:</b> ${esc(p.email) || "—"}</div>
    <div class="detalhe-linha"><b>Profissão:</b> ${esc(p.profissao) || "—"}</div>
    <div class="detalhe-linha"><b>Telefone:</b> ${esc(p.telefone) || "—"}</div>
    <div class="detalhe-linha"><b>Nacionalidade:</b> ${esc(p.nacionalidade) || "—"}</div>
    <div class="detalhe-linha"><b>Estado civil:</b> ${esc(p.estadoCivil) || "—"}</div>
    <div class="detalhe-linha"><b>RG nº:</b> ${esc(p.rg) || "—"}</div>
    <div class="detalhe-linha"><b>CPF nº:</b> ${esc(p.cpf) || "—"}</div>
    <div class="detalhe-linha"><b>Residência:</b> ${p.mesmoEndereco !== "nao" ? "Mesmo endereço do imóvel negociado" : (esc(p.endereco) || "—")}</div>
  `;
  const itensMarcados = (card.itensPermanencia || []).filter((it) => it.checked);

  el.innerHTML = `
    <div class="detalhe-secao">
      <h4>Dados da negociação</h4>
      <div class="detalhe-linha"><b>Valor da venda:</b> ${card.valorVenda ? formatMoneyBR(parseMoneyLoose(card.valorVenda)) : "—"}</div>
      <div class="detalhe-linha"><b>Coluna:</b> ${esc(getColumns().find((c) => c.id === card.columnId)?.title || "—")}</div>
      <div class="detalhe-linha"><b>Endereço do imóvel:</b> ${esc(formatEnderecoImovel(card)) || "—"}</div>
      <div class="detalhe-linha"><b>Matrícula:</b> ${esc(card.matriculaImovel) || "—"}</div>
      <div class="detalhe-linha"><b>Inscrição imobiliária (IPTU):</b> ${esc(card.inscricaoImobiliaria) || "—"}</div>
      <div class="detalhe-linha"><b>Posse:</b> ${esc(card.posse) || "—"}</div>
      <div class="detalhe-linha"><b>Comprador possui saldo para financiamento?</b> ${card.possuiSaldoFinanciamento === "sim" ? `Sim — ${formatMoneyBR(parseMoneyLoose(card.valorSaldoFinanciamento))}${card.bancoFinanciamento ? " · " + esc(card.bancoFinanciamento) : ""}` : "Não"}</div>
      <div class="detalhe-linha"><b>Usuário responsável:</b> ${esc(card.ownerName) || "—"}</div>
    </div>

    ${card.vendedores.map((p, i) => `
      <div class="detalhe-secao">
        <h4>Vendedor(a)${card.vendedores.length > 1 ? " " + (i + 1) : ""}</h4>
        ${pessoaLinhas(p)}
      </div>`).join("")}

    ${card.compradores.map((p, i) => `
      <div class="detalhe-secao">
        <h4>Comprador(a)${card.compradores.length > 1 ? " " + (i + 1) : ""}</h4>
        ${pessoaLinhas(p)}
      </div>`).join("")}

    <div class="detalhe-secao">
      <h4>Comissão</h4>
      <div class="detalhe-linha"><b>Comissão bruta:</b> ${esc(card.comissaoImobiliariaPercentual) || "0"}% — ${formatMoneyBR(card.comissaoImobiliariaValor)}</div>
      <div class="detalhe-linha"><b>Venda em parceria?</b> ${card.vendaEmParceria === "sim" ? "Sim" : "Não"}</div>
      <div class="detalhe-linha"><b>Quinto Andar:</b> ${card.vendaEmParceria === "sim" ? `${esc(card.quintoAndarPercentual) || "0"}% — ${formatMoneyBR(card.quintoAndarValor)}` : "—"}</div>
      <div class="detalhe-linha"><b>Fica para a imobiliária:</b> ${formatMoneyBR(base)}</div>
      ${(card.comissionamento || []).map((r) => `<div class="detalhe-linha"><b>${esc(r.nome) || "—"} (${esc(r.tipo) || "—"}):</b> ${esc(r.porcentagem) || "0"}% — ${formatMoneyBR(r.valor)}</div>`).join("")}
    </div>

    <div class="detalhe-secao">
      <h4>Condições de pagamento</h4>
      ${(card.paymentConditions || []).map((p) => `<div class="detalhe-linha"><b>${esc(p.label)}:</b> ${p.valor ? formatMoneyBR(parseMoneyLoose(p.valor)) : "—"}${p.forma ? " · " + esc(p.forma) : ""}${p.observation ? " · " + esc(p.observation) : ""}</div>`).join("")}
    </div>

    <div class="detalhe-secao">
      <h4>Itens que permanecerão no imóvel</h4>
      ${itensMarcados.length
        ? itensMarcados.map((it) => `<div class="detalhe-linha">• ${esc(it.text)}</div>`).join("")
        : `<p class="kpi-delta">Nenhum item marcado.</p>`}
    </div>

    ${card.obs ? `<div class="detalhe-secao"><h4>Observações</h4><div class="detalhe-linha">${esc(card.obs)}</div></div>` : ""}
  `;
}

function renderViewChecklist(el, card, rerender) {
  el.innerHTML = `<div>
    ${card.checklist.map((item, i) => `
      <label style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--linha)">
        <input type="checkbox" data-ck="${i}" ${item.done ? "checked" : ""}>
        <span style="flex:1">${esc(item.title)}</span>
        <span class="tag ${item.done ? "green" : "gray"}">${item.done ? "concluído" : "pendente"}</span>
        ${item.done ? `<span class="kpi-delta">${esc(item.doneByName || "")} · ${fmtDate(item.doneAt)}</span>` : ""}
      </label>`).join("")}
  </div>`;
  el.querySelectorAll("[data-ck]").forEach((cb) => cb.addEventListener("change", async (e) => {
    const idx = +e.target.dataset.ck;
    const cards = getCards();
    const c = cards.find((x) => x.id === card.id);
    if (!c) return;
    const item = c.checklist[idx];
    const me = getCurrentUser();
    item.done = e.target.checked;
    if (item.done) { item.doneBy = me?.id || ""; item.doneByName = me?.name || ""; item.doneAt = new Date().toISOString(); }
    else { item.doneBy = ""; item.doneByName = ""; item.doneAt = ""; }
    c.updatedAt = new Date().toISOString();
    c.updatedBy = me?.id || "";
    await saveCards(cards);
    rerender();
  }));
}

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
function renderViewDocs(el, card, rerender) {
  const me = getCurrentUser();
  el.innerHTML = `
    <div style="margin-bottom:12px">
      ${card.attachments.length ? card.attachments.map((a, i) => `
        <div class="rule-row">
          <span class="grow">${esc(a.name)}</span>
          <span class="kpi-delta">${fmtDate(a.uploadedAt)} · ${esc(a.uploadedByName || "")}</span>
          <a class="btn ghost" href="${a.data}" download="${esc(a.name)}">Baixar</a>
          <button type="button" class="btn danger" data-doc-del="${i}">Excluir</button>
        </div>`).join("") : `<p class="kpi-delta">Nenhum documento anexado ainda.</p>`}
    </div>
    <input type="file" id="fileInput">
    <p class="kpi-delta">Tamanho máximo: 4 MB por arquivo.</p>
  `;
  el.querySelectorAll("[data-doc-del]").forEach((b) => b.addEventListener("click", async (e) => {
    const cards = getCards();
    const c = cards.find((x) => x.id === card.id);
    if (!c) return;
    c.attachments.splice(+e.currentTarget.dataset.docDel, 1);
    await saveCards(cards);
    rerender();
  }));
  el.querySelector("#fileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) { toast("Arquivo maior que 4 MB.", "warn"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const cards = getCards();
      const c = cards.find((x) => x.id === card.id);
      if (!c) return;
      c.attachments.push({
        name: file.name, data: reader.result, uploadedAt: new Date().toISOString(),
        uploadedBy: me?.id || "", uploadedByName: me?.name || "",
      });
      await saveCards(cards);
      rerender();
    };
    reader.readAsDataURL(file);
  });
}

function renderViewChat(el, card, rerender) {
  const me = getCurrentUser();
  el.innerHTML = `
    <div style="max-height:360px;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
      ${card.messages.length ? card.messages.map((m) => `
        <div class="card pad" style="max-width:80%;${m.uid === me?.id ? "align-self:flex-end;background:#fff7df" : ""}">
          <b style="font-size:12.5px">${esc(m.name)}</b>
          <div>${esc(m.text)}</div>
          <div class="kpi-delta">${fmtDate(m.createdAt)}</div>
        </div>`).join("") : `<p class="kpi-delta">Nenhuma mensagem ainda.</p>`}
    </div>
    <div style="display:flex;gap:8px">
      <input id="chatInput" placeholder="Escreva uma mensagem..." style="flex:1">
      <button type="button" class="btn primary" id="btnSendChat">Enviar</button>
    </div>
  `;
  el.querySelector("#btnSendChat").addEventListener("click", async () => {
    const input = el.querySelector("#chatInput");
    const text = input.value.trim();
    if (!text) return;
    const cards = getCards();
    const c = cards.find((x) => x.id === card.id);
    if (!c) return;
    c.messages.push({
      id: uid("msg"), uid: me?.id || "", name: me?.name || "Usuário", text,
      createdAt: new Date().toISOString(), readBy: { [me?.id]: true },
    });
    await saveCards(cards);
    rerender();
  });
}

/* =============================== Edição =============================== */

const EDIT_TABS = [
  { id: "dados", label: "Dados" },
  { id: "itens", label: "Itens do imóvel" },
];

function openEditModal(cardId) {
  const cards = getCards();
  const existing = cardId ? cards.find((c) => c.id === cardId) : null;
  if (cardId && (!existing || !canAccessCard(existing))) { toast("Sem permissão para abrir este card.", "warn"); return; }

  const me = getCurrentUser();
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : ensureCardDefaults({
    createdBy: me?.id, createdByName: me?.name, ownerId: me?.id, ownerName: me?.name,
  });
  let activeTab = "dados";

  const body = openModal(existing ? "Editar venda" : "Nova negociação", `
    <div class="tabs" id="editTabs" style="margin-bottom:16px">
      ${EDIT_TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === activeTab ? "active" : ""}">${t.label}</button>`).join("")}
    </div>
    <div id="editTabBody"></div>
  `, {
    width: 900,
    footerHtml: `
      <button class="btn secondary" id="btnCancel">Cancelar</button>
      ${existing ? '<button class="btn danger" id="btnExcluir">Excluir</button>' : ""}
      <button class="btn primary" id="btnSalvar">Salvar venda</button>
    `,
  });
  const modalEl = body.closest(".modal");

  function paintTabs() {
    body.querySelectorAll("#editTabs button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
      b.onclick = () => { activeTab = b.dataset.tab; paintTabs(); };
    });
    const tabBody = body.querySelector("#editTabBody");
    const restore = captureFocus(tabBody);
    if (activeTab === "dados") renderEditDados(tabBody, draft, paintTabs);
    else if (activeTab === "itens") renderEditItens(tabBody, draft, paintTabs);
    restoreFocus(tabBody, restore);
  }
  paintTabs();
  lockModalHeight(modalEl);

  modalEl.querySelector("#btnCancel").addEventListener("click", closeModal);
  modalEl.querySelector("#btnExcluir")?.addEventListener("click", async () => {
    if (!confirm("Excluir esta negociação?")) return;
    await saveCards(getCards().filter((c) => c.id !== existing.id));
    closeModal();
    toast("Negociação excluída.", "ok");
  });
  modalEl.querySelector("#btnSalvar").addEventListener("click", async () => {
    if (!draft.title.trim()) { toast("Dê um título para a negociação.", "warn"); return; }
    const colunaAnterior = existing?.columnId;
    const recalculated = recalcComissaoCascata(draft);
    aplicarDataFechamento(recalculated, getColumns());
    recalculated.updatedAt = new Date().toISOString();
    recalculated.updatedBy = me?.id || "";
    const all = getCards();
    const next = existing ? all.map((c) => (c.id === existing.id ? recalculated : c)) : [...all, recalculated];
    await saveCards(next);
    closeModal();
    toast("Negociação salva.", "ok");
    // Movimentação entre etapas também pode acontecer editando e trocando a
    // coluna pelo formulário (não só arrastando no quadro) — mesma regra de
    // notificação nos dois casos. Só se aplica a card já existente: um card
    // novo não "se moveu" de lugar nenhum.
    if (existing && colunaAnterior !== recalculated.columnId) {
      avaliarRegrasParaMovimentacao(recalculated, colunaAnterior, recalculated.columnId, getColumns(), me)
        .catch((err) => console.error("Erro ao avaliar regras de notificação:", err));
    }
  });
}

/* --- Aba Dados (formulário único, no estilo da v1.0) --- */
function renderEditDados(el, draft, rerender) {
  const calc = recalcComissaoCascata(draft);
  draft.comissaoImobiliariaValor = calc.comissaoImobiliariaValor;
  draft.quintoAndarValor = calc.quintoAndarValor;
  draft.comissionamento = calc.comissionamento;

  const columns = getColumns();
  const users = (getSlice("users") || []).filter((u) => u.active !== false);

  el.innerHTML = `
    <div class="form-secao">
      <div class="form-secao-titulo"><b>Dados da negociação</b></div>
      <div class="grid cols3">
        <div class="field"><label>Título</label><input id="fTitle" value="${esc(draft.title)}"></div>
        <div class="field"><label>Coluna</label><select id="fColumn">${columns.map((c) => `<option value="${c.id}" ${draft.columnId === c.id ? "selected" : ""}>${esc(c.title)}</option>`).join("")}</select></div>
        <div class="field"><label>Valor da venda</label><input id="fValor" inputmode="numeric" placeholder="R$ 0,00" value="${draft.valorVenda ? esc(formatMoneyBR(parseMoneyLoose(draft.valorVenda))) : ""}"></div>
      </div>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Dados do imóvel (para a proposta de compra)</b><span>Digite o CEP para preencher rua, bairro, cidade e estado</span></div>
      <div class="grid cols3">
        <div class="field"><label>CEP</label><input id="fCepImovel" inputmode="numeric" placeholder="00000-000" value="${esc(draft.cepImovel)}"></div>
        <div class="field"><label>Rua / Logradouro</label><input id="fRuaImovel" value="${esc(draft.ruaImovel)}"></div>
        <div class="field"><label>Número</label><input id="fNumeroImovel" value="${esc(draft.numeroImovel)}"></div>
      </div>
      <div class="grid cols3">
        <div class="field"><label>Complemento</label><input id="fComplementoImovel" placeholder="Ex.: Apto 45, bloco B" value="${esc(draft.complementoImovel)}"></div>
        <div class="field"><label>Bairro</label><input id="fBairroImovel" value="${esc(draft.bairroImovel)}"></div>
        <div class="field"><label>Cidade</label><input id="fCidadeImovel" value="${esc(draft.cidadeImovel)}"></div>
      </div>
      <div class="grid cols3">
        <div class="field"><label>Estado (UF)</label><input id="fEstadoImovel" maxlength="2" style="text-transform:uppercase" value="${esc(draft.estadoImovel)}"></div>
        <div class="field"><label>Matrícula</label><input id="fMatriculaImovel" placeholder="Nº da matrícula no cartório de registro de imóveis" value="${esc(draft.matriculaImovel)}"></div>
        <div class="field"><label>Inscrição imobiliária (IPTU)</label><input id="fInscricaoImobiliaria" value="${esc(draft.inscricaoImobiliaria)}"></div>
      </div>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Posse e financiamento</b></div>
      <div class="grid cols3">
        <div class="field"><label>Posse</label><input id="fPosse" placeholder="Ex.: Na entrega das chaves" value="${esc(draft.posse)}"></div>
        <div class="field"><label>Comprador possui saldo para financiamento?</label>
          <div class="field-pair">
            <select id="fSaldo">
              <option value="nao" ${draft.possuiSaldoFinanciamento !== "sim" ? "selected" : ""}>Não</option>
              <option value="sim" ${draft.possuiSaldoFinanciamento === "sim" ? "selected" : ""}>Sim</option>
            </select>
            <input id="fSaldoValor" inputmode="numeric" placeholder="R$ 0,00" value="${draft.valorSaldoFinanciamento ? esc(formatMoneyBR(parseMoneyLoose(draft.valorSaldoFinanciamento))) : ""}" ${draft.possuiSaldoFinanciamento === "sim" ? "" : "disabled"}>
          </div>
        </div>
        <div class="field"><label>Banco do financiamento</label>
          <select id="fBanco" ${draft.possuiSaldoFinanciamento === "sim" ? "" : "disabled"}>
            <option value="">Selecione uma opção</option>
            ${BANCOS.map((b) => `<option value="${b}" ${draft.bancoFinanciamento === b ? "selected" : ""}>${b}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Comissão</b></div>
      <div class="grid cols3">
        <div class="field"><label>Comissão bruta</label>
          <div class="field-pair">
            <input id="fPctBruta" placeholder="%" value="${esc(draft.comissaoImobiliariaPercentual)}">
            <input value="${formatMoneyBR(draft.comissaoImobiliariaValor)}" disabled>
          </div>
        </div>
        <div class="field"><label>Venda em parceria?</label>
          <select id="fParceria"><option value="nao" ${draft.vendaEmParceria !== "sim" ? "selected" : ""}>Não</option><option value="sim" ${draft.vendaEmParceria === "sim" ? "selected" : ""}>Sim</option></select>
        </div>
        <div class="field"><label>Quinto Andar (% da comissão bruta)</label>
          <div class="field-pair">
            <input id="fPctQuinto" placeholder="Ex.: 50%" value="${esc(draft.quintoAndarPercentual)}" ${draft.vendaEmParceria === "sim" ? "" : "disabled"}>
            <input value="${formatMoneyBR(draft.quintoAndarValor)}" disabled>
          </div>
        </div>
      </div>

      <div class="form-secao-titulo" style="margin-top:18px"><b>Rateio da comissão imobiliária</b></div>
      ${calc.comissaoSomaOutrosPct > 100 ? `<p class="kpi-delta" style="color:var(--vermelho);margin:-8px 0 12px">A soma dos percentuais dos comissionados (${calc.comissaoSomaOutrosPct}%) passa de 100% — a imobiliária ficaria com 0%.</p>` : ""}
      <div id="comissaoRows">${draft.comissionamento.map((r, i) => renderComissaoRow(r, i, users)).join("")}</div>
      <button type="button" class="btn add" id="btnAddComissao">+ Adicionar comissão</button>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Vendedor(a)(s)</b><span>Nome · E-mail · Telefone</span></div>
      <div id="vendedoresList">${draft.vendedores.map((p, i) => renderPessoaRow(p, i, "vendedores")).join("")}</div>
      <button type="button" class="btn add" id="btnAddVendedor">+ Adicionar vendedor(a)</button>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Comprador(a)(s)</b><span>Nome · E-mail · Telefone</span></div>
      <div id="compradoresList">${draft.compradores.map((p, i) => renderPessoaRow(p, i, "compradores")).join("")}</div>
      <button type="button" class="btn add" id="btnAddComprador">+ Adicionar comprador(a)</button>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Condições de pagamento</b></div>
      <div id="pcList">${draft.paymentConditions.map((p, i) => renderPagamentoRow(p, i)).join("")}</div>
      <button type="button" class="btn add" id="btnAddPagamento">+ Adicionar condição</button>
    </div>

    <div class="form-secao">
      <div class="form-secao-titulo"><b>Observações e responsável</b></div>
      <div class="field"><label>Observações</label><textarea id="fObs" rows="3">${esc(draft.obs)}</textarea></div>
      <div class="field" style="margin-top:14px;max-width:340px"><label>Usuário responsável</label>
        <select id="fResponsavel">${users.map((u) => `<option value="${u.id}" ${draft.ownerId === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>
      </div>
    </div>
  `;

  el.querySelector("#fTitle").addEventListener("input", (e) => { draft.title = e.target.value; });
  el.querySelector("#fColumn").addEventListener("change", (e) => { draft.columnId = e.target.value; });
  el.querySelector("#fValor").addEventListener("input", (e) => {
    e.target.value = maskMoneyBRTyping(e.target.value);
    draft.valorVenda = e.target.value;
  });
  el.querySelector("#fCepImovel").addEventListener("input", (e) => {
    e.target.value = maskCEP(e.target.value);
    draft.cepImovel = e.target.value;
    const digits = e.target.value.replace(/\D/g, "");
    if (digits.length === 8) buscarCepEPreencher(digits);
  });
  el.querySelector("#fRuaImovel").addEventListener("input", (e) => { draft.ruaImovel = e.target.value; });
  el.querySelector("#fNumeroImovel").addEventListener("input", (e) => { draft.numeroImovel = e.target.value; });
  el.querySelector("#fComplementoImovel").addEventListener("input", (e) => { draft.complementoImovel = e.target.value; });
  el.querySelector("#fBairroImovel").addEventListener("input", (e) => { draft.bairroImovel = e.target.value; });
  el.querySelector("#fCidadeImovel").addEventListener("input", (e) => { draft.cidadeImovel = e.target.value; });
  el.querySelector("#fEstadoImovel").addEventListener("input", (e) => { draft.estadoImovel = e.target.value.toUpperCase(); });
  el.querySelector("#fMatriculaImovel").addEventListener("input", (e) => { draft.matriculaImovel = e.target.value; });
  el.querySelector("#fInscricaoImobiliaria").addEventListener("input", (e) => { draft.inscricaoImobiliaria = e.target.value; });

  async function buscarCepEPreencher(cep) {
    try {
      const dados = await buscarEnderecoPorCEP(cep);
      if (!dados) { toast("CEP não encontrado.", "warn"); return; }
      draft.ruaImovel = dados.logradouro || draft.ruaImovel;
      draft.bairroImovel = dados.bairro || draft.bairroImovel;
      draft.cidadeImovel = dados.localidade || draft.cidadeImovel;
      draft.estadoImovel = dados.uf || draft.estadoImovel;
      rerender();
      toast("Endereço preenchido a partir do CEP — falta só número e complemento.", "ok");
    } catch (err) {
      toast(err.message || "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.", "warn");
    }
  }
  el.querySelector("#fPosse").addEventListener("input", (e) => { draft.posse = e.target.value; });
  el.querySelector("#fObs").addEventListener("input", (e) => { draft.obs = e.target.value; });
  el.querySelector("#fSaldo").addEventListener("change", (e) => { draft.possuiSaldoFinanciamento = e.target.value; rerender(); });
  el.querySelector("#fSaldoValor").addEventListener("input", (e) => {
    e.target.value = maskMoneyBRTyping(e.target.value);
    draft.valorSaldoFinanciamento = e.target.value;
  });
  el.querySelector("#fBanco").addEventListener("change", (e) => { draft.bancoFinanciamento = e.target.value; });
  el.querySelector("#fResponsavel")?.addEventListener("change", (e) => {
    draft.ownerId = e.target.value;
    draft.ownerName = users.find((u) => u.id === e.target.value)?.name || "";
  });

  el.querySelector("#fPctBruta").addEventListener("input", (e) => { draft.comissaoImobiliariaPercentual = e.target.value; rerender(); });
  el.querySelector("#fParceria").addEventListener("change", (e) => { draft.vendaEmParceria = e.target.value; rerender(); });
  el.querySelector("#fPctQuinto").addEventListener("input", (e) => { draft.quintoAndarPercentual = e.target.value; rerender(); });
  el.querySelectorAll("[data-com-nome]").forEach((inp) => inp.addEventListener("input", (e) => { draft.comissionamento[+e.target.dataset.comNome].nome = e.target.value; }));
  el.querySelectorAll("[data-com-tipo]").forEach((inp) => inp.addEventListener("input", (e) => { draft.comissionamento[+e.target.dataset.comTipo].tipo = e.target.value; }));
  el.querySelectorAll("[data-com-pct]").forEach((inp) => inp.addEventListener("input", (e) => { draft.comissionamento[+e.target.dataset.comPct].porcentagem = e.target.value; rerender(); }));
  el.querySelectorAll("[data-com-del]").forEach((b) => b.addEventListener("click", (e) => { draft.comissionamento.splice(+e.currentTarget.dataset.comDel, 1); rerender(); }));
  el.querySelector("#btnAddComissao").addEventListener("click", () => {
    draft.comissionamento.push({ nome: "", tipo: "", porcentagem: "", valor: 0, fixo: false });
    rerender();
  });

  bindPessoaList(el, draft, "vendedores", rerender);
  bindPessoaList(el, draft, "compradores", rerender);
  el.querySelector("#btnAddVendedor").addEventListener("click", () => { draft.vendedores.push(emptyPessoa()); rerender(); });
  el.querySelector("#btnAddComprador").addEventListener("click", () => { draft.compradores.push(emptyPessoa()); rerender(); });

  el.querySelectorAll("[data-pc-valor]").forEach((inp) => inp.addEventListener("input", (e) => {
    e.target.value = maskMoneyBRTyping(e.target.value);
    draft.paymentConditions[+e.target.dataset.pcValor].valor = e.target.value;
  }));
  el.querySelectorAll("[data-pc-forma]").forEach((inp) => inp.addEventListener("input", (e) => { draft.paymentConditions[+e.target.dataset.pcForma].forma = e.target.value; }));
  el.querySelectorAll("[data-pc-obs]").forEach((inp) => inp.addEventListener("input", (e) => { draft.paymentConditions[+e.target.dataset.pcObs].observation = e.target.value; }));
  el.querySelectorAll("[data-pc-del]").forEach((b) => b.addEventListener("click", (e) => { draft.paymentConditions.splice(+e.currentTarget.dataset.pcDel, 1); relabelPagamentos(draft); rerender(); }));
  el.querySelector("#btnAddPagamento").addEventListener("click", () => {
    draft.paymentConditions.push({ label: "", valor: "", forma: "", observation: "" });
    relabelPagamentos(draft);
    rerender();
  });
}

function relabelPagamentos(draft) {
  draft.paymentConditions.forEach((p, i) => { p.label = String.fromCharCode(65 + i); });
}
function renderPagamentoRow(p, i) {
  return `<div class="payment-row">
    <div class="field"><label></label><span class="pay-badge">${esc(p.label || String.fromCharCode(65 + i))}</span></div>
    <div class="field"><label>${i === 0 ? "Valor" : ""}</label><input inputmode="numeric" placeholder="R$ 0,00" data-pc-valor="${i}" value="${p.valor ? esc(formatMoneyBR(parseMoneyLoose(p.valor))) : ""}"></div>
    <div class="field"><label>${i === 0 ? "Forma de pagamento" : ""}</label><input placeholder="Ex.: À vista, financiamento, FGTS..." data-pc-forma="${i}" value="${esc(p.forma)}"></div>
    <div class="field"><label>${i === 0 ? "Observação" : ""}</label><input data-pc-obs="${i}" value="${esc(p.observation)}"></div>
    ${i > 0 ? `<button type="button" class="btn danger" data-pc-del="${i}">×</button>` : "<span></span>"}
  </div>`;
}

function renderPessoaRow(p, i, group) {
  return `<div class="card pad" style="margin-bottom:8px" data-pessoa-row="${group}-${i}">
    <div class="grid cols2">
      <div class="field"><label>Nome</label><input data-p="${group}.${i}.nome" value="${esc(p.nome)}"></div>
      <div class="field"><label>E-mail</label><input data-p="${group}.${i}.email" value="${esc(p.email)}"></div>
      <div class="field"><label>Profissão</label><input data-p="${group}.${i}.profissao" value="${esc(p.profissao)}"></div>
      <div class="field"><label>Telefone</label><input data-p="${group}.${i}.telefone" inputmode="tel" placeholder="(00) 00000-0000" value="${esc(maskPhoneBR(p.telefone))}"></div>
    </div>
    <div class="grid cols2">
      <div class="field"><label>Nacionalidade</label><input data-p="${group}.${i}.nacionalidade" placeholder="Ex.: brasileiro(a)" value="${esc(p.nacionalidade)}"></div>
      <div class="field"><label>Estado civil</label>
        <select data-p="${group}.${i}.estadoCivil">
          <option value="">Selecione uma opção</option>
          ${ESTADOS_CIVIS.map((ec) => `<option value="${ec}" ${p.estadoCivil === ec ? "selected" : ""}>${ec}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>RG nº</label><input data-p="${group}.${i}.rg" value="${esc(p.rg)}"></div>
      <div class="field"><label>CPF nº</label><input data-p="${group}.${i}.cpf" value="${esc(p.cpf)}"></div>
    </div>
    <div class="grid cols2">
      <div class="field"><label>Reside no endereço do imóvel negociado?</label>
        <select data-p="${group}.${i}.mesmoEndereco">
          <option value="sim" ${p.mesmoEndereco !== "nao" ? "selected" : ""}>Sim</option>
          <option value="nao" ${p.mesmoEndereco === "nao" ? "selected" : ""}>Não</option>
        </select>
      </div>
      <div class="field">
        <label>Endereço de residência</label>
        <input data-p="${group}.${i}.endereco" placeholder="Endereço de residência" value="${esc(p.endereco)}" ${p.mesmoEndereco !== "nao" ? "disabled" : ""}>
      </div>
    </div>
    ${i > 0 ? `<button type="button" class="btn danger" data-del-pessoa="${group}-${i}">Remover</button>` : ""}
  </div>`;
}

function bindPessoaList(el, draft, group, rerender) {
  el.querySelectorAll(`[data-p^="${group}."]`).forEach((input) => {
    const [, idx, field] = input.dataset.p.split(".");
    input.addEventListener(input.tagName === "SELECT" ? "change" : "input", (e) => {
      if (field === "telefone") e.target.value = maskPhoneBR(e.target.value);
      draft[group][+idx][field] = e.target.value;
      if (field === "mesmoEndereco") rerender();
    });
  });
  el.querySelectorAll(`[data-del-pessoa^="${group}-"]`).forEach((b) => {
    b.addEventListener("click", () => {
      const idx = Number(b.dataset.delPessoa.split("-")[1]);
      draft[group].splice(idx, 1);
      rerender();
    });
  });
}

function renderComissaoRow(r, i, users) {
  const locked = !!r.fixo;
  return `<div class="comissao-row" style="margin-bottom:10px">
    <div class="field"><label>${i === 0 ? "Comissionado" : ""}</label><input list="npcUsersDatalist" placeholder="Comissionado" data-com-nome="${i}" value="${esc(r.nome)}" ${locked ? "disabled title='A imobiliária recebe o que sobrar do rateio'" : ""}></div>
    <div class="field"><label>${i === 0 ? "Tipo" : ""}</label><input placeholder="Tipo" data-com-tipo="${i}" value="${esc(r.tipo)}" ${locked ? "disabled" : ""}></div>
    <div class="field"><label>${i === 0 ? "%" : ""}</label><input placeholder="%" data-com-pct="${i}" value="${esc(r.porcentagem)}" ${locked ? "disabled title='Calculado automaticamente: 100% − soma dos demais'" : ""}></div>
    <div class="field"><label>${i === 0 ? "Valor" : ""}</label><input value="${formatMoneyBR(r.valor)}" disabled></div>
    ${!locked ? `<button type="button" class="btn danger" data-com-del="${i}">×</button>` : "<span></span>"}
    <datalist id="npcUsersDatalist">${users.map((u) => `<option value="${esc(u.name)}">`).join("")}</datalist>
  </div>`;
}

/* --- Aba Itens do imóvel --- */
function renderEditItens(el, draft, rerender) {
  el.innerHTML = `
    <p class="kpi-delta">Marque apenas os itens que permanecerão no imóvel. Você também pode editar o texto ou adicionar outro item.</p>
    <div class="itens-grid">
      ${draft.itensPermanencia.map((it, i) => `
        <div class="item-row">
          <input type="checkbox" data-item-check="${i}" ${it.checked ? "checked" : ""}>
          <input type="text" data-item-text="${i}" value="${esc(it.text)}">
          <button type="button" class="item-del" data-item-del="${i}" title="Remover">×</button>
        </div>`).join("")}
    </div>
    <button type="button" class="btn secondary" id="btnAddItem" style="margin-top:14px">+ Adicionar item</button>
  `;
  el.querySelectorAll("[data-item-check]").forEach((cb) => cb.addEventListener("change", (e) => {
    draft.itensPermanencia[+e.target.dataset.itemCheck].checked = e.target.checked;
  }));
  el.querySelectorAll("[data-item-text]").forEach((inp) => inp.addEventListener("input", (e) => {
    draft.itensPermanencia[+e.target.dataset.itemText].text = e.target.value;
  }));
  el.querySelectorAll("[data-item-del]").forEach((b) => b.addEventListener("click", (e) => {
    draft.itensPermanencia.splice(+e.currentTarget.dataset.itemDel, 1);
    rerender();
  }));
  el.querySelector("#btnAddItem").addEventListener("click", () => {
    draft.itensPermanencia.push({ id: uid("item"), text: "", checked: false });
    rerender();
  });
}

registerPage("negociacoes", renderNegociacoes);
