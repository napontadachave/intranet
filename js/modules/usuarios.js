/* =========================================================================
   Usuários — cadastro dos colaboradores (perfil + login).

   Antes desta tela, cadastrar alguém novo exigia mexer direto no Firebase
   (Console + banco). Agora dá pra criar o login (e-mail + senha
   temporária) e o cadastro (nome, cargo, aniversário, ativo/inativo) tudo
   por aqui — ver js/providers/usuarios-auth.js pra como a criação da
   conta de autenticação funciona sem derrubar a sua sessão de admin.

   Permissões (Administrador, Ver todos os usuários, e as demais da lista
   extensível) ficam numa tela separada — Permissões (js/modules/
   permissoes.js) — mesma divisão que o sistema antigo já tinha entre os
   dois módulos.

   `users` é gravado no Realtime Database, não no Firestore (diferente de
   filas/notificações) — por isso aqui é `getSlice`/`patchKey` (ver
   js/sync.js), igual a negociacoes.js e outros módulos de RTDB. A
   conversão de formato pro banco do sistema antigo (objeto com campos em
   português) é toda cuidada por js/schema.js — este módulo só lê/escreve
   no formato já normalizado (array, campos em inglês). */

import { getSlice, patchKey, subscribe } from "../sync.js";
import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { toast, esc, fmtDate } from "../ui-kit.js";
import { criarContaAutenticacao, gerarSenhaTemporaria, enviarRedefinicaoSenha } from "../providers/usuarios-auth.js";

function usuarios() {
  return (getSlice("users") || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function renderUsuarios(mount) {
  if (!isAdmin(getCurrentUser())) {
    mount.innerHTML = `<div class="page-header"><div><h1>Usuários</h1></div></div>
      <div class="card pad empty-state"><b>Sem permissão</b><p>Esta área é restrita a administradores.</p></div>`;
    return;
  }

  let vista = "lista"; // "lista" | "editor"
  let draft = null;
  let credenciaisGeradas = null; // { email, senha } — mostrado uma única vez, logo após criar

  function paint() {
    if (vista === "editor") renderEditor(mount);
    else renderLista(mount);
  }

  /* ------------------------------- lista ------------------------------- */

  function renderLista(body) {
    const lista = usuarios();
    body.innerHTML = `
      <div class="page-header">
        <div><h1>Usuários</h1><p>Cadastro e login dos colaboradores.</p></div>
        <button type="button" class="btn primary" id="btnNovoUsuario">+ Novo usuário</button>
      </div>
      ${lista.length ? lista.map(renderCardUsuario).join("") : `<div class="card pad empty-state"><b>Nenhum usuário cadastrado.</b></div>`}
    `;
    body.querySelector("#btnNovoUsuario").addEventListener("click", () => abrirEditor(null));
    body.querySelectorAll("[data-editar-usuario]").forEach((b) => b.addEventListener("click", () => abrirEditor(b.dataset.editarUsuario)));
    body.querySelectorAll("[data-reset-senha]").forEach((b) => b.addEventListener("click", () => acaoResetSenha(b.dataset.resetSenha)));
  }

  function renderCardUsuario(u) {
    const souEu = getCurrentUser()?.id === u.id;
    return `<div class="card pad" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <b>${esc(u.name)}</b> ${souEu ? '<span class="tag gray">você</span>' : ""}
        ${u.active === false ? '<span class="tag gray">inativo</span>' : '<span class="tag green">ativo</span>'}
        ${u.perms?.admin ? '<span class="tag yellow">administrador</span>' : ""}
        <div class="kpi-delta">${esc(u.email) || "—"}${u.perfil ? " · " + esc(u.perfil) : ""}</div>
        ${u.birthday ? `<div class="kpi-delta">Aniversário: ${fmtDate(u.birthday)}</div>` : ""}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn secondary" data-reset-senha="${esc(u.id)}">Enviar redefinição de senha</button>
        <button type="button" class="btn secondary" data-editar-usuario="${esc(u.id)}">Editar</button>
      </div>
    </div>`;
  }

  async function acaoResetSenha(id) {
    const u = usuarios().find((x) => x.id === id);
    if (!u || !u.email) { toast("Este usuário não tem e-mail cadastrado.", "warn"); return; }
    if (!confirm(`Enviar e-mail de redefinição de senha para ${u.email}?`)) return;
    try {
      await enviarRedefinicaoSenha(u.email);
      toast("E-mail de redefinição enviado.", "ok");
    } catch (e) {
      toast("Erro ao enviar: " + (e.message || String(e)), "warn");
    }
  }

  /* ------------------------------- editor ------------------------------- */

  function abrirEditor(id) {
    const original = id ? usuarios().find((u) => u.id === id) : null;
    draft = original
      ? { ...original }
      : { name: "", email: "", perfil: "", birthday: "", active: true, senha: gerarSenhaTemporaria() };
    credenciaisGeradas = null;
    vista = "editor";
    paint();
  }

  function renderEditor(body) {
    const d = draft;
    const novo = !d.id;
    const souEu = !novo && getCurrentUser()?.id === d.id;

    body.innerHTML = `
      <div class="page-header"><div><h1>${novo ? "Novo usuário" : "Editar usuário"}</h1></div></div>

      ${credenciaisGeradas ? `
        <div class="card pad" style="margin-bottom:16px;background:#fff7df">
          <b>Conta criada — anote agora, a senha não aparece de novo:</b>
          <div class="detalhe-linha"><b>E-mail:</b> ${esc(credenciaisGeradas.email)}</div>
          <div class="detalhe-linha"><b>Senha temporária:</b> ${esc(credenciaisGeradas.senha)}</div>
          <p class="kpi-delta">Combine com a pessoa, ou use "Enviar redefinição de senha" na lista de usuários pra ela escolher a própria senha.</p>
        </div>` : ""}

      <div class="card pad" style="margin-bottom:16px">
        <div class="grid cols3">
          <div class="field"><label>Nome</label><input id="uNome" value="${esc(d.name)}"></div>
          <div class="field"><label>E-mail</label><input id="uEmail" type="email" value="${esc(d.email)}" ${novo ? "" : "disabled title='Alterar o e-mail aqui não muda o login no Firebase Authentication — fale com o suporte técnico se precisar trocar o e-mail de acesso.'"}></div>
          <div class="field"><label>Cargo</label><input id="uCargo" placeholder="Ex.: Corretor, Gerente..." value="${esc(d.perfil)}"></div>
        </div>
        <div class="grid cols3">
          <div class="field"><label>Aniversário</label><input id="uAniversario" type="date" value="${esc(d.birthday)}"></div>
          <div class="field"><label>Ativo?</label>
            <select id="uAtivo" ${souEu ? "disabled title='Você não pode desativar seu próprio usuário por aqui.'" : ""}>
              <option value="sim" ${d.active !== false ? "selected" : ""}>Sim</option>
              <option value="nao" ${d.active === false ? "selected" : ""}>Não</option>
            </select>
          </div>
          ${novo ? `
          <div class="field"><label>Senha temporária</label>
            <div class="field-pair">
              <input id="uSenha" value="${esc(d.senha)}">
              <button type="button" class="btn ghost" id="btnGerarSenha" title="Gerar outra">Gerar outra</button>
            </div>
          </div>` : ""}
        </div>
        ${novo ? `<p class="kpi-delta">Cria o login no Firebase Authentication com este e-mail e senha, e o cadastro já ativo. A pessoa pode trocar a senha depois, a qualquer momento, pelo botão de redefinição.</p>` : ""}
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="btnCancelarUsuario">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarUsuario">${novo ? "Criar usuário" : "Salvar"}</button>
      </div>
    `;

    body.querySelector("#uNome").addEventListener("input", (e) => { d.name = e.target.value; });
    body.querySelector("#uEmail").addEventListener("input", (e) => { d.email = e.target.value; });
    body.querySelector("#uCargo").addEventListener("input", (e) => { d.perfil = e.target.value; });
    body.querySelector("#uAniversario").addEventListener("input", (e) => { d.birthday = e.target.value; });
    body.querySelector("#uAtivo").addEventListener("change", (e) => { d.active = e.target.value === "sim"; });
    body.querySelector("#uSenha")?.addEventListener("input", (e) => { d.senha = e.target.value; });
    body.querySelector("#btnGerarSenha")?.addEventListener("click", () => { d.senha = gerarSenhaTemporaria(); renderEditor(body); });
    body.querySelector("#btnCancelarUsuario").addEventListener("click", () => { vista = "lista"; draft = null; paint(); });
    body.querySelector("#btnSalvarUsuario").addEventListener("click", () => salvarDraft(body, d, novo));
  }

  async function salvarDraft(body, d, novo) {
    if (!d.name.trim()) { toast("Dê um nome para o usuário.", "warn"); return; }
    if (!d.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) { toast("Informe um e-mail válido.", "warn"); return; }
    if (novo && (!d.senha || d.senha.length < 6)) { toast("A senha temporária precisa ter pelo menos 6 caracteres.", "warn"); return; }

    const btn = body.querySelector("#btnSalvarUsuario");
    btn.disabled = true;
    try {
      const cargo = d.perfil.trim();
      const todos = usuarios();

      if (novo) {
        const uid = await criarContaAutenticacao(d.email.trim(), d.senha);
        const novoUsuario = {
          id: uid, name: d.name.trim(), email: d.email.trim(), user: d.email.trim(),
          perfil: cargo, role: cargo || "Colaborador", birthday: d.birthday || "",
          active: true, mustChangePassword: true, perms: {},
        };
        await patchKey("users", [...todos, novoUsuario]);
        toast("Usuário criado.", "ok");
        credenciaisGeradas = { email: d.email.trim(), senha: d.senha };
        draft = { ...novoUsuario };
        vista = "editor";
        paint();
      } else {
        const atualizado = {
          ...d, name: d.name.trim(), perfil: cargo, role: cargo || d.role || "Colaborador",
          birthday: d.birthday || "",
        };
        await patchKey("users", todos.map((u) => (u.id === atualizado.id ? atualizado : u)));
        toast("Usuário salvo.", "ok");
        vista = "lista";
        draft = null;
        paint();
      }
    } catch (e) {
      toast("Erro ao salvar: " + (e.message || String(e)), "warn");
      btn.disabled = false;
    }
  }

  paint();
  const unsub = subscribe("users", () => { if (vista === "lista") paint(); });
  return () => { unsub(); };
}

registerPage("usuarios", renderUsuarios);
