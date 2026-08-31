/* Utilitários de UI reutilizados por todos os módulos: toast e modal. */

export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[m]));
}

let toastWrap = null;
export function toast(message, type = "info") {
  if (!toastWrap) {
    toastWrap = document.createElement("div");
    toastWrap.className = "toast-wrap";
    document.body.appendChild(toastWrap);
  }
  const el = document.createElement("div");
  el.className = "toast" + (type === "warn" ? " warn" : type === "ok" ? " ok" : "");
  el.textContent = message;
  toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

let modalBg = null;
/**
 * @param {{width?: number, headerActionsHtml?: string, footerHtml?: string}} [opts]
 *   headerActionsHtml: botões extras no cabeçalho, antes do "×" de fechar
 *   (ex.: "Editar"/"Excluir" na tela de visualização da negociação).
 *   footerHtml: rodapé fixo fora da área de rolagem — use para os botões de
 *   ação de formulários compridos (ex.: "Salvar"/"Cancelar"), assim eles
 *   ficam sempre visíveis independente do quanto o conteúdo role.
 */
export function openModal(title, bodyHtml, { width, headerActionsHtml, footerHtml } = {}) {
  closeModal();
  modalBg = document.createElement("div");
  modalBg.className = "modal-bg";
  modalBg.innerHTML = `<div class="modal" style="${width ? `max-width:${width}px` : ""}">
    <div class="modal-head">
      <h2>${esc(title)}</h2>
      <div class="modal-head-actions">${headerActionsHtml || ""}<button type="button" class="modal-close" aria-label="Fechar">×</button></div>
    </div>
    <div class="modal-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ""}
  </div>`;
  modalBg.querySelector(".modal-close").addEventListener("click", closeModal);
  modalBg.addEventListener("mousedown", (e) => { if (e.target === modalBg) closeModal(); });
  document.body.appendChild(modalBg);
  return modalBg.querySelector(".modal-body");
}
export function closeModal() {
  if (modalBg) { modalBg.remove(); modalBg = null; }
}

/** Formata um valor em Real. Aceita dois formatos de entrada bem diferentes
 *  (por isso o `typeof` logo de cara):
 *  - Number (ex.: um total já calculado em código, `1234.5`) — usado
 *    direto, sem nenhum tratamento de texto.
 *  - String no formato BR digitado num campo de formulário (ex.:
 *    "1.234.567,89", ponto de milhar + vírgula decimal) — aí sim faz
 *    sentido tirar os pontos e trocar a vírgula por ponto antes de
 *    converter pra número.
 *  BUG CORRIGIDO: antes, o tratamento de texto era aplicado também a
 *  valores que já eram Number — e como `String(1234.5)` vira "1234.5" (com
 *  PONTO decimal, sintaxe do JavaScript, não formatação BR), o
 *  `.replace(".", "")` tratava esse ponto decimal como se fosse separador
 *  de milhar e o REMOVIA, multiplicando o valor por uma potência de 10 (ou
 *  pior ainda, em resultados de divisão com muitas casas decimais — comum
 *  em médias, ex. "Ticket Médio" — o valor virava um número absurdo, na
 *  casa dos trilhões/quatrilhões). Também corrigido de brinde: o
 *  `.replace(".", "")` só removia o PRIMEIRO ponto (sem a flag `g`), então
 *  mesmo no caminho de texto um valor como "5.000.000,00" (dois separadores
 *  de milhar) já vinha quebrado antes desta correção. */
export function fmtMoneyBRL(v) {
  const n = typeof v === "number"
    ? v
    : Number(String(v || "0").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  if (!isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtDate(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleDateString("pt-BR"); } catch (e) { return "-"; }
}

export function fmtDateTime(iso) {
  if (!iso) return "-";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch (e) { return "-"; }
}

export function uid(prefix = "id") {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Máscara de telefone BR, aplicada progressivamente enquanto a pessoa digita:
 *  "11912345678" -> "(11) 91234-5678" (também funciona com 10 dígitos). */
export function maskPhoneBR(raw) {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return "(" + d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Máscara de CEP, aplicada progressivamente: "09726150" -> "09726-150". */
export function maskCEP(raw) {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** Máscara de campo monetário no estilo "digitar da direita pra esquerda"
 *  (cada dígito novo entra como centavo, como em caixas eletrônicos/apps de
 *  banco): "500000" digitado vira "R$ 5.000,00". Use no evento "input". */
export function maskMoneyBRTyping(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  const n = Number(digits) / 100;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
