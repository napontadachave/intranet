/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0 — Roteador
   Roteamento simples por hash (#pagina). Cada módulo de página é
   responsável por: (1) desenhar seu HTML dentro do mount recebido, e
   (2) devolver uma função de "cleanup" que cancela suas inscrições em
   sync.js. O roteador SEMPRE chama o cleanup da página anterior antes
   de montar a próxima — isso evita o problema do sistema antigo onde
   listeners de páginas que a pessoa já tinha saído continuavam vivos,
   reagindo a mudanças remotas e brigando com a página atual.
   ========================================================================= */

import { findNavItem } from "./nav-config.js";
import { getMainMount, highlightActive } from "./ui-shell.js";
import { icon } from "./icons.js";
import { getCurrentUser } from "./auth.js";
import { moduloVisivelPara } from "./permissoes-defs.js";

const registry = new Map(); // pageId -> async (mount) => cleanupFn|void

export function registerPage(pageId, renderFn) {
  registry.set(pageId, renderFn);
}

let currentPage = null;
let currentCleanup = null;

export function getCurrentPage() {
  return currentPage;
}

export function navigateTo(pageId) {
  if (location.hash.slice(1) !== pageId) {
    location.hash = pageId;
  } else {
    renderCurrentRoute();
  }
}

async function renderCurrentRoute() {
  const pageId = location.hash.slice(1) || "dashboard";
  currentPage = pageId;
  highlightActive(pageId);

  if (typeof currentCleanup === "function") {
    try { currentCleanup(); } catch (e) { console.error(e); }
  }
  currentCleanup = null;

  const mount = getMainMount();
  if (!mount) return;

  const navItem = findNavItem(pageId);
  const renderFn = registry.get(pageId);

  // A pedido seu: além de esconder do menu (ver js/ui-shell.js), um módulo
  // marcado como oculto pra este usuário (Permissões → Visibilidade de
  // módulos) também não abre digitando o #hash direto na URL — senão a
  // "visibilidade" seria só cosmética.
  if (!moduloVisivelPara(getCurrentUser(), pageId)) {
    renderAcessoRestritoPage(mount, navItem);
    return;
  }

  if (navItem?.status === "wip" || !renderFn) {
    renderWipPage(mount, navItem);
    return;
  }

  try {
    currentCleanup = await renderFn(mount);
  } catch (e) {
    console.error(e);
    mount.innerHTML = `<div class="card pad">Erro ao carregar esta página. Veja o console para detalhes.</div>`;
  }
}

function renderAcessoRestritoPage(mount, navItem) {
  mount.innerHTML = `
    <div class="page-header"><div><h1>${navItem?.label || "Módulo"}</h1></div></div>
    <div class="card pad empty-state">
      <div style="font-size:34px;margin-bottom:10px">${icon("lock", 34)}</div>
      <b>Acesso restrito</b>
      <p style="max-width:420px">
        Este módulo foi escondido do seu usuário em Permissões. Se você
        precisa dele, fale com um administrador.
      </p>
    </div>`;
}

function renderWipPage(mount, navItem) {
  mount.innerHTML = `
    <div class="page-header"><div><h1>${navItem?.label || "Módulo"}</h1>
    <p>Este módulo ainda está na fila de migração para a Intranet 2.0.</p></div></div>
    <div class="card pad empty-state">
      <div style="font-size:34px;margin-bottom:10px">${icon("layers", 34)}</div>
      <b>Em construção</b>
      <p style="max-width:420px">
        Os dados deste módulo continuam intactos no Firebase — a tela dele
        só ainda não foi portada para a nova estrutura. Ele entra nas
        próximas fases da migração, na ordem combinada com você.
      </p>
    </div>`;
}

export function startRouter() {
  window.addEventListener("hashchange", renderCurrentRoute);
  renderCurrentRoute();
}
