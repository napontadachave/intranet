/* =========================================================================
   Configurações → Gestão de Filas.

   A pedido seu: parecida com a "fila de atendimento" do sistema anterior,
   mas agora como uma guia de Configurações (mesmo padrão já usado em
   "Gestão de Cadências e Templates" — ver js/modules/config-cadencias.js).

   Uma fila é só um nome + uma lista ORDENADA de corretores (usuários
   ativos). A ordem é o que importa: posição 0 é sempre "o próximo da vez".
   Pode existir quantas filas fizerem sentido (por empreendimento, por
   equipe etc.) — elas não são amarradas a um programa de Atendimentos; quem
   qualifica um lead escolhe manualmente qual fila usar (ver o modal de
   Qualificar em js/modules/lead-detalhes.js).

   A rotação de fato da fila (mover pra trás quem foi pulado ou escolhido)
   acontece na hora de qualificar um lead, não aqui — esta tela só define a
   composição e a ordem inicial/manual. Reordenar usa ↑/↓, mesmo padrão já
   usado nas etapas de cadência. */

import { getSlice } from "../sync.js";
import { toast, esc } from "../ui-kit.js";
import { listarFilas, salvarFila, excluirFila } from "../providers/filas-distribuicao.js";

function usuariosAtivos() {
  return (getSlice("users") || [])
    .filter((u) => u && u.active !== false)
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function renderGestaoFilas(mount) {
  let vivo = true;
  let vista = "lista"; // "lista" | "editor"
  let draft = null;
  let filas = [];

  async function carregar() {
    try {
      filas = await listarFilas();
    } catch (e) {
      toast("Erro ao carregar filas: " + e.message, "warn");
    }
    if (vivo) pintar();
  }

  function pintar() {
    if (vista === "editor") renderEditor(mount);
    else renderLista(mount);
  }

  /* ------------------------------- lista ------------------------------- */

  function renderLista(body) {
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <p class="kpi-delta" style="margin:0;max-width:640px">Cada fila é uma lista ordenada de corretores. Ao qualificar um lead em Atendimentos, quem está atendendo escolhe qual fila usar — o sistema sugere sempre o primeiro da lista, e quem recebe (ou é pulado) vai para o final.</p>
        <button type="button" class="btn secondary" id="btnNovaFila">+ Nova fila</button>
      </div>
      ${filas.length ? filas.map(renderCardFila).join("") : `<div class="card pad empty-state"><b>Nenhuma fila cadastrada.</b><p>Crie uma fila para poder distribuir leads automaticamente ao qualificá-los em Atendimentos.</p></div>`}
    `;
    body.querySelector("#btnNovaFila").addEventListener("click", () => abrirEditor(null));
    body.querySelectorAll("[data-editar-fila]").forEach((b) => b.addEventListener("click", () => abrirEditor(b.dataset.editarFila)));
    body.querySelectorAll("[data-excluir-fila]").forEach((b) => b.addEventListener("click", () => acaoExcluir(b.dataset.excluirFila)));
  }

  function renderCardFila(f) {
    const membros = f.membros || [];
    const preview = membros.slice(0, 4).map((m) => esc(m.nome)).join(", ") + (membros.length > 4 ? `, +${membros.length - 4}` : "");
    return `<div class="card pad" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <b>${esc(f.nome)}</b>
        <div class="kpi-delta">${membros.length} corretor${membros.length === 1 ? "" : "es"}${membros.length ? " — " + preview : ""}</div>
        ${membros[0] ? `<div class="kpi-delta">Próximo da vez: <b>${esc(membros[0].nome)}</b></div>` : ""}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn secondary" data-editar-fila="${esc(f.id)}">Editar</button>
        <button type="button" class="btn danger" data-excluir-fila="${esc(f.id)}">Excluir</button>
      </div>
    </div>`;
  }

  async function acaoExcluir(id) {
    if (!confirm("Excluir esta fila? Leads já distribuídos por ela mantêm o histórico intacto, mas ela deixa de aparecer como opção ao qualificar.")) return;
    try { await excluirFila(id); toast("Fila excluída.", "ok"); await carregar(); }
    catch (e) { toast("Erro: " + e.message, "warn"); }
  }

  /* ------------------------------- editor ------------------------------- */

  function abrirEditor(id) {
    const original = id ? filas.find((f) => f.id === id) : null;
    draft = original
      ? { ...original, membros: (original.membros || []).map((m) => ({ ...m })) }
      : { nome: "", membros: [] };
    vista = "editor";
    pintar();
  }

  function membrosDisponiveis(d) {
    const jaNaFila = new Set(d.membros.map((m) => m.id));
    return usuariosAtivos().filter((u) => !jaNaFila.has(u.id));
  }

  function renderEditor(body) {
    const d = draft;
    const disponiveis = membrosDisponiveis(d);
    body.innerHTML = `
      <div class="card pad" style="margin-bottom:16px">
        <div class="field"><label>Nome da fila</label><input id="filaNome" value="${esc(d.nome)}"></div>
      </div>

      <h3 style="font-size:15px;margin:0 0 10px">Corretores na fila (ordem = ordem de atendimento)</h3>
      <div id="membrosWrap" style="margin-bottom:14px">
        ${d.membros.length ? d.membros.map((m, i) => renderMembroLinha(m, i, d.membros.length)).join("") : `<p class="kpi-delta">Nenhum corretor ainda — adicione abaixo.</p>`}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:24px;flex-wrap:wrap">
        <select id="selNovoMembro" style="flex:1;min-width:220px" ${disponiveis.length ? "" : "disabled"}>
          ${disponiveis.length
            ? disponiveis.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")
            : `<option value="">Todos os colaboradores ativos já estão na fila</option>`}
        </select>
        <button type="button" class="btn secondary" id="btnAddMembro" ${disponiveis.length ? "" : "disabled"}>+ Adicionar corretor</button>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="btnCancelarFila">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarFila">Salvar fila</button>
      </div>
    `;

    body.querySelector("#filaNome").addEventListener("input", (e) => { d.nome = e.target.value; });
    body.querySelector("#btnAddMembro")?.addEventListener("click", () => {
      const sel = body.querySelector("#selNovoMembro");
      const user = disponiveis.find((u) => u.id === sel.value);
      if (!user) return;
      d.membros.push({ id: user.id, nome: user.name });
      renderEditor(body);
    });
    attachMembroHandlers(body, d);
    body.querySelector("#btnCancelarFila").addEventListener("click", () => { vista = "lista"; draft = null; pintar(); });
    body.querySelector("#btnSalvarFila").addEventListener("click", () => salvarDraft(body, d));
  }

  function renderMembroLinha(m, i, total) {
    return `<div class="card pad" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div><span class="tag gray">${i + 1}º</span> ${esc(m.nome)}</div>
      <div style="display:flex;gap:6px">
        <button type="button" class="btn ghost" data-mb-up="${i}" ${i === 0 ? "disabled" : ""} title="Mover para cima">↑</button>
        <button type="button" class="btn ghost" data-mb-down="${i}" ${i === total - 1 ? "disabled" : ""} title="Mover para baixo">↓</button>
        <button type="button" class="btn danger" data-mb-del="${i}">Remover</button>
      </div>
    </div>`;
  }

  function attachMembroHandlers(body, d) {
    body.querySelectorAll("[data-mb-up]").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mbUp;
      if (i <= 0) return;
      [d.membros[i - 1], d.membros[i]] = [d.membros[i], d.membros[i - 1]];
      renderEditor(body);
    }));
    body.querySelectorAll("[data-mb-down]").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.mbDown;
      if (i >= d.membros.length - 1) return;
      [d.membros[i + 1], d.membros[i]] = [d.membros[i], d.membros[i + 1]];
      renderEditor(body);
    }));
    body.querySelectorAll("[data-mb-del]").forEach((b) => b.addEventListener("click", () => {
      d.membros.splice(+b.dataset.mbDel, 1);
      renderEditor(body);
    }));
  }

  async function salvarDraft(body, d) {
    if (!d.nome.trim()) { toast("Dê um nome para a fila.", "warn"); return; }
    const btn = body.querySelector("#btnSalvarFila");
    btn.disabled = true;
    try {
      await salvarFila(d);
      toast("Fila salva.", "ok");
      vista = "lista";
      draft = null;
      await carregar();
    } catch (e) {
      toast("Erro ao salvar: " + e.message, "warn");
      btn.disabled = false;
    }
  }

  mount.innerHTML = `<div class="card pad">Carregando filas...</div>`;
  carregar();
  return () => { vivo = false; };
}
