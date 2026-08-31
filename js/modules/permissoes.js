/* =========================================================================
   Permissões — o que cada usuário pode ver/fazer.

   Separado da tela Usuários (cadastro/login) de propósito — mesma divisão
   que o sistema antigo já tinha entre os dois módulos.

   Construída como pediu: uma lista EXTENSÍVEL por módulo (ver
   js/permissoes-defs.js), não só os dois interruptores que o código já
   usava antes desta tela existir (`admin` e `view_all_users`). A maioria
   das permissões novas ainda não tem nenhuma verificação real por trás —
   ficam marcadas "ainda sem efeito" na tela, guardadas no cadastro pra
   quando as telas relacionadas passarem a checar.

   `perms` é gravado dentro de cada usuário em `users` (Realtime Database)
   — mesmo caminho de leitura/escrita de js/modules/usuarios.js. */

import { getSlice, patchKey, subscribe } from "../sync.js";
import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { toast, esc } from "../ui-kit.js";
import { NAV_SECTIONS } from "../nav-config.js";
import { PERMISSOES_DEFINICOES, TODAS_PERMISSOES, MODULOS_TRAVADOS_PARA_SI_MESMO } from "../permissoes-defs.js";

function usuarios() {
  return (getSlice("users") || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function renderPermissoes(mount) {
  if (!isAdmin(getCurrentUser())) {
    mount.innerHTML = `<div class="page-header"><div><h1>Permissões</h1></div></div>
      <div class="card pad empty-state"><b>Sem permissão</b><p>Esta área é restrita a administradores.</p></div>`;
    return;
  }

  let vista = "lista"; // "lista" | "editor"
  let draft = null; // { usuarioId, perms: {...} }

  function paint() {
    if (vista === "editor") renderEditor(mount);
    else renderLista(mount);
  }

  /* ------------------------------- lista ------------------------------- */

  function renderLista(body) {
    const lista = usuarios();
    body.innerHTML = `
      <div class="page-header">
        <div><h1>Permissões</h1><p>O que cada usuário pode ver e fazer no sistema.</p></div>
      </div>
      <p class="kpi-delta" style="margin-bottom:14px;max-width:680px">As permissões marcadas "ainda sem efeito" ficam guardadas no cadastro do usuário, preparadas pra quando a tela correspondente passar a checar — hoje só <b>Administrador</b> e <b>Ver todos os usuários</b> mudam alguma coisa de verdade.</p>
      ${lista.length ? lista.map(renderCardUsuario).join("") : `<div class="card pad empty-state"><b>Nenhum usuário cadastrado.</b><p>Cadastre em Usuários primeiro.</p></div>`}
    `;
    body.querySelectorAll("[data-editar-perms]").forEach((b) => b.addEventListener("click", () => abrirEditor(b.dataset.editarPerms)));
  }

  function renderCardUsuario(u) {
    const concedidas = TODAS_PERMISSOES.filter((p) => u.perms?.[p.key]).map((p) => p.label);
    const ocultos = Object.keys(u.perms?.modulosOcultos || {}).filter((id) => u.perms.modulosOcultos[id]);
    return `<div class="card pad" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <b>${esc(u.name)}</b> ${u.active === false ? '<span class="tag gray">inativo</span>' : ""}
        <div class="kpi-delta">${concedidas.length ? esc(concedidas.join(", ")) : "Nenhuma permissão extra — só o acesso básico."}</div>
        ${ocultos.length ? `<div class="kpi-delta">${ocultos.length} módulo${ocultos.length === 1 ? "" : "s"} escondido${ocultos.length === 1 ? "" : "s"} do menu</div>` : ""}
      </div>
      <button type="button" class="btn secondary" data-editar-perms="${esc(u.id)}">Editar permissões</button>
    </div>`;
  }

  /* ------------------------------- editor ------------------------------- */

  function abrirEditor(usuarioId) {
    const u = usuarios().find((x) => x.id === usuarioId);
    if (!u) return;
    draft = {
      usuarioId,
      perms: { ...(u.perms || {}) },
      modulosOcultos: { ...(u.perms?.modulosOcultos || {}) },
    };
    vista = "editor";
    paint();
  }

  function renderEditor(body) {
    const u = usuarios().find((x) => x.id === draft.usuarioId);
    if (!u) { vista = "lista"; draft = null; paint(); return; }
    const souEu = getCurrentUser()?.id === u.id;

    body.innerHTML = `
      <div class="page-header"><div><h1>Permissões de ${esc(u.name)}</h1></div></div>
      ${PERMISSOES_DEFINICOES.map((grupo) => `
        <div class="card pad" style="margin-bottom:14px">
          <div class="form-secao-titulo"><b>${esc(grupo.modulo)}</b></div>
          ${grupo.itens.map((item) => {
            const travarAdminDeSiMesmo = souEu && item.key === "admin";
            return `<label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid var(--linha)">
              <input type="checkbox" data-perm="${esc(item.key)}" ${draft.perms[item.key] ? "checked" : ""} ${travarAdminDeSiMesmo ? "disabled" : ""} style="margin-top:3px">
              <span>
                <div>${esc(item.label)} ${item.emUso ? "" : '<span class="tag gray" style="font-size:10px">ainda sem efeito</span>'}</div>
                ${item.descricao ? `<div class="kpi-delta">${esc(item.descricao)}</div>` : ""}
                ${travarAdminDeSiMesmo ? `<div class="kpi-delta" style="color:var(--vermelho)">Você não pode remover sua própria permissão de administrador por aqui.</div>` : ""}
              </span>
            </label>`;
          }).join("")}
        </div>
      `).join("")}

      <div class="card pad" style="margin-bottom:14px">
        <div class="form-secao-titulo">
          <b>Visibilidade de módulos no menu</b>
          <span>O que aparece no menu lateral desta pessoa — desmarcar não tira nenhuma permissão, só esconde o item</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button type="button" class="btn ghost" id="btnMostrarTudo" style="font-size:12px">Mostrar tudo</button>
          <button type="button" class="btn ghost" id="btnEsconderTudo" style="font-size:12px">Esconder tudo (exceto o essencial)</button>
        </div>
        ${NAV_SECTIONS.map((secao) => `
          <div style="margin-bottom:12px">
            <div class="kpi-delta" style="font-weight:700;text-transform:uppercase;font-size:11px;margin-bottom:4px">${esc(secao.label)}</div>
            ${secao.items.map((item) => {
              const travado = souEu && MODULOS_TRAVADOS_PARA_SI_MESMO.includes(item.id);
              const visivel = travado || !draft.modulosOcultos[item.id];
              return `<label style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--linha)">
                <input type="checkbox" data-modulo="${esc(item.id)}" ${visivel ? "checked" : ""} ${travado ? "disabled" : ""}>
                <span>${esc(item.label)}${travado ? ' <span class="kpi-delta">(você não pode esconder este de si mesmo)</span>' : ""}</span>
              </label>`;
            }).join("")}
          </div>
        `).join("")}
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="btnCancelarPerms">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarPerms">Salvar</button>
      </div>
    `;

    body.querySelectorAll("[data-perm]").forEach((cb) => cb.addEventListener("change", (e) => {
      draft.perms[e.target.dataset.perm] = e.target.checked;
    }));
    body.querySelectorAll("[data-modulo]").forEach((cb) => cb.addEventListener("change", (e) => {
      draft.modulosOcultos[e.target.dataset.modulo] = !e.target.checked;
    }));
    body.querySelector("#btnMostrarTudo").addEventListener("click", () => {
      draft.modulosOcultos = {};
      renderEditor(body);
    });
    body.querySelector("#btnEsconderTudo").addEventListener("click", () => {
      const todosIds = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
      draft.modulosOcultos = Object.fromEntries(
        todosIds.filter((id) => !(souEu && MODULOS_TRAVADOS_PARA_SI_MESMO.includes(id))).map((id) => [id, true])
      );
      renderEditor(body);
    });
    body.querySelector("#btnCancelarPerms").addEventListener("click", () => { vista = "lista"; draft = null; paint(); });
    body.querySelector("#btnSalvarPerms").addEventListener("click", () => salvarDraft(body));
  }

  async function salvarDraft(body) {
    const btn = body.querySelector("#btnSalvarPerms");
    btn.disabled = true;
    try {
      const todos = usuarios();
      const atual = todos.find((u) => u.id === draft.usuarioId);
      if (!atual) throw new Error("Usuário não encontrado — pode ter sido removido enquanto você editava.");
      // Preserva o `admin` de quem está editando a própria tela, mesmo que
      // o checkbox tenha vindo travado no HTML — dupla garantia contra
      // autoexclusão do próprio acesso de administrador. Mesma lógica pros
      // três módulos que ninguém pode esconder da própria conta (ver
      // js/permissoes-defs.js) — mesmo que alguém force o checkbox pelo
      // DevTools, o salvar corrige antes de gravar.
      const permsFinal = { ...draft.perms };
      const modulosOcultosFinal = { ...draft.modulosOcultos };
      if (getCurrentUser()?.id === atual.id) {
        permsFinal.admin = atual.perms?.admin || false;
        MODULOS_TRAVADOS_PARA_SI_MESMO.forEach((id) => { delete modulosOcultosFinal[id]; });
      }
      // Não guarda entradas "false" à toa — só o que está de fato escondido.
      Object.keys(modulosOcultosFinal).forEach((id) => { if (!modulosOcultosFinal[id]) delete modulosOcultosFinal[id]; });
      permsFinal.modulosOcultos = modulosOcultosFinal;
      const atualizado = { ...atual, perms: permsFinal };
      await patchKey("users", todos.map((u) => (u.id === atualizado.id ? atualizado : u)));
      toast("Permissões salvas.", "ok");
      vista = "lista";
      draft = null;
      paint();
    } catch (e) {
      toast("Erro ao salvar: " + (e.message || String(e)), "warn");
      btn.disabled = false;
    }
  }

  paint();
  const unsub = subscribe("users", () => { if (vista === "lista") paint(); });
  return () => { unsub(); };
}

registerPage("permissoes", renderPermissoes);
