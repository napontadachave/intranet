/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0 — Shell (topbar + sidebar)
   Estrutura visual inspirada no Univen (topbar fixa, sidebar recolhível
   por módulos, avatar/notificações no canto), com a identidade visual
   (cores e logo) da Na Ponta da Chave.
   ========================================================================= */

import { NAV_SECTIONS } from "./nav-config.js";
import { icon } from "./icons.js";
import { getCurrentUser, logout } from "./auth.js";
import { navigateTo, getCurrentPage } from "./router.js";
import { esc, fmtDateTime } from "./ui-kit.js";
import { listarNotificacoes, marcarNotificacaoLida, marcarTodasLidas } from "./providers/notificacoes.js";
import { moduloVisivelPara } from "./permissoes-defs.js";

let sidebarCollapsed = false;

// Guardados fora de renderShell() porque a topbar inteira é recriada do
// zero a cada renderShell() (ex.: novo login) — sem isso, o listener de
// "clicar fora fecha o painel" e o intervalo de atualização do sino
// ficariam duplicados a cada vez.
let notifDocClickHandler = null;
let notifHashChangeHandler = null;
let notifRefreshTimer = null;

export function renderShell(root) {
  const user = getCurrentUser();
  root.innerHTML = `
    <div class="topbar">
      <button class="topbar-icon-btn" id="btnToggleSidebar" title="Recolher menu">${icon("grid")}</button>
      <div class="brand"><img src="assets/logo.png" alt="Na Ponta da Chave"></div>
      <div class="searchbox">
        ${icon("search", 16)}
        <input type="text" placeholder="Buscar leads, negociações, imóveis, colaboradores...">
      </div>
      <div class="topbar-actions">
        <div style="position:relative">
          <button class="topbar-icon-btn" id="btnNotifications" title="Notificações">
            ${icon("bell")}
            <span class="badge" id="notifBadge" style="display:none">0</span>
          </button>
          <div id="notifPanel" class="card pad" style="display:none;position:absolute;top:46px;right:0;width:340px;max-height:420px;overflow:auto;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.18)"></div>
        </div>
        <div class="topbar-user" id="btnUserMenu">
          <div class="avatar">${(user?.name || "U")[0].toUpperCase()}</div>
          <span>${user?.name || "Usuário"}</span>
        </div>
      </div>
    </div>
    <div class="sidebar" id="sidebar">
      ${NAV_SECTIONS.map((s) => renderSection(s, user)).join("")}
    </div>
    <div class="main" id="mainContent"></div>
  `;

  root.querySelector("#btnToggleSidebar").addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    root.querySelector("#sidebar").classList.toggle("collapsed", sidebarCollapsed);
    root.querySelector("#mainContent").classList.toggle("sidebar-collapsed", sidebarCollapsed);
  });

  root.querySelector("#btnUserMenu").addEventListener("click", () => {
    if (confirm("Encerrar sessão?")) logout();
  });

  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(el.getAttribute("data-nav"));
    });
  });

  wireNotifications(root);
  highlightActive(getCurrentPage());
}

/** Sino de notificações: lista suspensa com as notificações do usuário
 *  logado (sem página própria — foi o combinado). Como a Intranet 2.0 não
 *  usa listeners em tempo real do Firestore (mesma convenção do resto do
 *  projeto), o contador do sino é atualizado ao abrir a tela, ao abrir o
 *  painel e por um intervalo periódico enquanto a pessoa estiver logada. */
function wireNotifications(root) {
  const btn = root.querySelector("#btnNotifications");
  const panel = root.querySelector("#notifPanel");
  const badge = root.querySelector("#notifBadge");
  let aberto = false;
  let ultimaLista = [];

  async function atualizarBadge() {
    const me = getCurrentUser();
    if (!me) return;
    try {
      const notifs = await listarNotificacoes(me.id);
      const naoLidas = notifs.filter((n) => !n.lida).length;
      badge.textContent = String(naoLidas);
      badge.style.display = naoLidas ? "grid" : "none";
    } catch (e) {
      console.error("Não foi possível atualizar o contador de notificações:", e);
    }
  }

  function renderNotifItem(n) {
    return `<div class="card pad" data-notif="${n.id}" style="margin-bottom:8px;cursor:pointer;${n.lida ? "" : "background:#fff7df"}">
      <b style="font-size:13px">${esc(n.titulo)}</b>
      <div style="font-size:12.5px">${esc(n.mensagem)}</div>
      <div class="kpi-delta">${fmtDateTime(n.criadoEm)}</div>
    </div>`;
  }

  async function pintarPainel() {
    const me = getCurrentUser();
    panel.innerHTML = `<p class="kpi-delta">Carregando notificações...</p>`;
    try {
      ultimaLista = await listarNotificacoes(me?.id);
    } catch (e) {
      panel.innerHTML = `<p class="kpi-delta">Erro ao carregar notificações: ${esc(e.message)}</p>`;
      return;
    }
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:10px">
        <b style="font-size:14px">Notificações</b>
        <button type="button" class="btn ghost" id="notifMarcarTodas" style="font-size:12px">Marcar todas como lidas</button>
      </div>
      ${ultimaLista.length ? ultimaLista.slice(0, 30).map(renderNotifItem).join("") : `<p class="kpi-delta">Nenhuma notificação por aqui ainda.</p>`}
    `;
    panel.querySelector("#notifMarcarTodas")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      try { await marcarTodasLidas(me?.id); await pintarPainel(); await atualizarBadge(); }
      catch (err) { console.error(err); }
    });
    panel.querySelectorAll("[data-notif]").forEach((el) => el.addEventListener("click", async () => {
      const n = ultimaLista.find((x) => x.id === el.dataset.notif);
      if (!n) return;
      if (!n.lida) { try { await marcarNotificacaoLida(n.id); } catch (e) { console.error(e); } }
      fecharPainel();
      atualizarBadge();
      if (n.rota) navigateTo(n.rota);
    }));
  }

  function abrirPainel() {
    aberto = true;
    panel.style.display = "block";
    pintarPainel();
    atualizarBadge();
  }
  function fecharPainel() {
    aberto = false;
    panel.style.display = "none";
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (aberto) fecharPainel(); else abrirPainel();
  });

  if (notifDocClickHandler) document.removeEventListener("click", notifDocClickHandler);
  notifDocClickHandler = (e) => {
    if (aberto && !panel.contains(e.target) && !btn.contains(e.target)) fecharPainel();
  };
  document.addEventListener("click", notifDocClickHandler);

  // Defesa extra: se a navegação acontecer sem passar por um clique "fora"
  // do painel (ex.: voltar pelo navegador, digitar outro #hash), fecha o
  // painel de qualquer forma pra ele não ficar flutuando sobre a tela nova.
  if (notifHashChangeHandler) window.removeEventListener("hashchange", notifHashChangeHandler);
  notifHashChangeHandler = () => { if (aberto) fecharPainel(); atualizarBadge(); };
  window.addEventListener("hashchange", notifHashChangeHandler);

  atualizarBadge();
  if (notifRefreshTimer) clearInterval(notifRefreshTimer);
  notifRefreshTimer = setInterval(atualizarBadge, 45000);
}

/** A pedido seu: Permissões pode esconder módulos inteiros do menu de um
 *  usuário específico (ver js/permissoes-defs.js). Uma seção que fica sem
 *  nenhum item visível some inteira (não faz sentido mostrar o rótulo
 *  "Comunicação" vazio, por exemplo). */
function renderSection(section, user) {
  const itensVisiveis = section.items.filter((item) => moduloVisivelPara(user, item.id));
  if (!itensVisiveis.length) return "";
  return `
    <div class="nav-label" style="font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;padding:14px 12px 6px">${section.label}</div>
    ${itensVisiveis.map((item) => `
      <a href="#${item.id}" class="nav-item" data-nav="${item.id}" data-page="${item.id}">
        <span class="ic">${icon(item.icon)}</span>
        <span class="label">${item.label}</span>
        ${item.status === "wip" ? '<span class="tag gray" style="margin-left:auto;font-size:10px">em breve</span>' : ""}
      </a>
    `).join("")}
  `;
}

export function highlightActive(pageId) {
  document.querySelectorAll(".sidebar .nav-item").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-page") === pageId);
  });
}

export function getMainMount() {
  return document.getElementById("mainContent");
}
