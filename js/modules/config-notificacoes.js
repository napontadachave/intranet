/* =========================================================================
   Configurações → Gestão de Notificações.

   A pedido seu: quando um card de Negociações é movimentado entre etapas,
   o responsável pelo card (e, se a regra determinar, outras pessoas) deve
   ser avisado. Cada regra decide, de forma independente, se dispara em
   QUALQUER movimentação entre colunas ou só quando o card cai numa coluna
   específica — as duas opções foram pedidas, então cada regra escolhe a
   sua na hora de ser criada.

   Mesmo padrão de lista/editor já usado em "Gestão de Filas" (ver
   js/modules/config-filas.js) e "Gestão de Cadências e Templates". As
   notificações disparadas por essas regras aparecem só no sino da topbar
   (ver js/ui-shell.js) — não há uma tela própria de histórico por ora. */

import { getSlice } from "../sync.js";
import { toast, esc } from "../ui-kit.js";
import { listarRegras, salvarRegra, excluirRegra } from "../providers/notificacoes.js";
import { DEFAULT_COLUMNS } from "../providers/kanban-defaults.js";

function usuariosAtivos() {
  return (getSlice("users") || [])
    .filter((u) => u && u.active !== false)
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}
function colunasNegociacoes() {
  const cols = getSlice("kanbanColumns");
  return (Array.isArray(cols) && cols.length ? cols : DEFAULT_COLUMNS)
    .slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
}

export function renderGestaoNotificacoes(mount) {
  let vivo = true;
  let vista = "lista"; // "lista" | "editor"
  let draft = null;
  let regras = [];

  async function carregar() {
    try {
      regras = await listarRegras();
    } catch (e) {
      toast("Erro ao carregar regras de notificação: " + e.message, "warn");
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
        <p class="kpi-delta" style="margin:0;max-width:640px">Cada regra observa as movimentações de coluna do kanban de Negociações. Quando uma regra combina com o movimento, o responsável do card (se marcado) e/ou os destinatários extras recebem uma notificação no sino, no topo da tela.</p>
        <button type="button" class="btn secondary" id="btnNovaRegra">+ Nova regra</button>
      </div>
      ${regras.length ? regras.map(renderCardRegra).join("") : `<div class="card pad empty-state"><b>Nenhuma regra cadastrada.</b><p>Crie uma regra para que alguém seja avisado quando um card de Negociações mudar de etapa.</p></div>`}
    `;
    body.querySelector("#btnNovaRegra").addEventListener("click", () => abrirEditor(null));
    body.querySelectorAll("[data-editar-regra]").forEach((b) => b.addEventListener("click", () => abrirEditor(b.dataset.editarRegra)));
    body.querySelectorAll("[data-excluir-regra]").forEach((b) => b.addEventListener("click", () => acaoExcluir(b.dataset.excluirRegra)));
  }

  function renderCardRegra(r) {
    const colunas = colunasNegociacoes();
    const gatilhoTxt = r.gatilho === "coluna_especifica"
      ? `Só quando cair em "${esc(colunas.find((c) => c.id === r.colunaId)?.title || "coluna removida")}"`
      : "Qualquer movimentação entre etapas";
    const destinatarios = [
      r.notificarResponsavel ? "Responsável pelo card" : null,
      ...(r.destinatariosExtras || []).map((d) => d.nome),
    ].filter(Boolean);
    return `<div class="card pad" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <b>${esc(r.nome)}</b> ${r.ativa === false ? '<span class="tag gray">inativa</span>' : '<span class="tag green">ativa</span>'}
        <div class="kpi-delta">${gatilhoTxt}</div>
        <div class="kpi-delta">Notifica: ${destinatarios.length ? esc(destinatarios.join(", ")) : "ninguém definido"}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn secondary" data-editar-regra="${esc(r.id)}">Editar</button>
        <button type="button" class="btn danger" data-excluir-regra="${esc(r.id)}">Excluir</button>
      </div>
    </div>`;
  }

  async function acaoExcluir(id) {
    if (!confirm("Excluir esta regra de notificação?")) return;
    try { await excluirRegra(id); toast("Regra excluída.", "ok"); await carregar(); }
    catch (e) { toast("Erro: " + e.message, "warn"); }
  }

  /* ------------------------------- editor ------------------------------- */

  function abrirEditor(id) {
    const original = id ? regras.find((r) => r.id === id) : null;
    draft = original
      ? { ...original, destinatariosExtras: (original.destinatariosExtras || []).map((d) => ({ ...d })) }
      : { nome: "", gatilho: "qualquer", colunaId: "", notificarResponsavel: true, destinatariosExtras: [], ativa: true };
    vista = "editor";
    pintar();
  }

  function destinatariosDisponiveis(d) {
    const jaNaLista = new Set(d.destinatariosExtras.map((x) => x.id));
    return usuariosAtivos().filter((u) => !jaNaLista.has(u.id));
  }

  function renderEditor(body) {
    const d = draft;
    const colunas = colunasNegociacoes();
    const disponiveis = destinatariosDisponiveis(d);
    body.innerHTML = `
      <div class="card pad" style="margin-bottom:16px">
        <div class="grid cols2">
          <div class="field"><label>Nome da regra</label><input id="regraNome" value="${esc(d.nome)}"></div>
          <div class="field"><label>Regra ativa?</label>
            <select id="regraAtiva">
              <option value="sim" ${d.ativa !== false ? "selected" : ""}>Sim</option>
              <option value="nao" ${d.ativa === false ? "selected" : ""}>Não</option>
            </select>
          </div>
        </div>
        <div class="grid cols2" style="margin-top:10px">
          <div class="field"><label>Dispara quando</label>
            <select id="regraGatilho">
              <option value="qualquer" ${d.gatilho !== "coluna_especifica" ? "selected" : ""}>Qualquer movimentação entre etapas</option>
              <option value="coluna_especifica" ${d.gatilho === "coluna_especifica" ? "selected" : ""}>O card cair numa coluna específica</option>
            </select>
          </div>
          <div class="field"><label>Coluna</label>
            <select id="regraColuna" ${d.gatilho === "coluna_especifica" ? "" : "disabled"}>
              <option value="">Selecione uma coluna</option>
              ${colunas.map((c) => `<option value="${esc(c.id)}" ${d.colunaId === c.id ? "selected" : ""}>${esc(c.title)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="card pad" style="margin-bottom:16px">
        <label style="display:flex;align-items:center;gap:10px;font-weight:600">
          <input type="checkbox" id="regraNotifResp" ${d.notificarResponsavel ? "checked" : ""}>
          Notificar o usuário responsável pelo card
        </label>
      </div>

      <h3 style="font-size:15px;margin:0 0 10px">Destinatários extras (opcional)</h3>
      <div id="destWrap" style="margin-bottom:14px">
        ${d.destinatariosExtras.length ? d.destinatariosExtras.map((x, i) => renderDestLinha(x, i)).join("") : `<p class="kpi-delta">Nenhum destinatário extra — só o responsável (se marcado acima) será notificado.</p>`}
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:24px;flex-wrap:wrap">
        <select id="selNovoDest" style="flex:1;min-width:220px" ${disponiveis.length ? "" : "disabled"}>
          ${disponiveis.length
            ? disponiveis.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")
            : `<option value="">Todos os colaboradores ativos já foram adicionados</option>`}
        </select>
        <button type="button" class="btn secondary" id="btnAddDest" ${disponiveis.length ? "" : "disabled"}>+ Adicionar destinatário</button>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="btnCancelarRegra">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarRegra">Salvar regra</button>
      </div>
    `;

    body.querySelector("#regraNome").addEventListener("input", (e) => { d.nome = e.target.value; });
    body.querySelector("#regraAtiva").addEventListener("change", (e) => { d.ativa = e.target.value === "sim"; });
    body.querySelector("#regraGatilho").addEventListener("change", (e) => { d.gatilho = e.target.value; renderEditor(body); });
    body.querySelector("#regraColuna").addEventListener("change", (e) => { d.colunaId = e.target.value; });
    body.querySelector("#regraNotifResp").addEventListener("change", (e) => { d.notificarResponsavel = e.target.checked; });
    body.querySelector("#btnAddDest")?.addEventListener("click", () => {
      const sel = body.querySelector("#selNovoDest");
      const user = disponiveis.find((u) => u.id === sel.value);
      if (!user) return;
      d.destinatariosExtras.push({ id: user.id, nome: user.name });
      renderEditor(body);
    });
    body.querySelectorAll("[data-dest-del]").forEach((b) => b.addEventListener("click", () => {
      d.destinatariosExtras.splice(+b.dataset.destDel, 1);
      renderEditor(body);
    }));
    body.querySelector("#btnCancelarRegra").addEventListener("click", () => { vista = "lista"; draft = null; pintar(); });
    body.querySelector("#btnSalvarRegra").addEventListener("click", () => salvarDraft(body, d));
  }

  function renderDestLinha(x, i) {
    return `<div class="card pad" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div>${esc(x.nome)}</div>
      <button type="button" class="btn danger" data-dest-del="${i}">Remover</button>
    </div>`;
  }

  async function salvarDraft(body, d) {
    if (!d.nome.trim()) { toast("Dê um nome para a regra.", "warn"); return; }
    if (d.gatilho === "coluna_especifica" && !d.colunaId) { toast("Escolha em qual coluna a regra deve disparar.", "warn"); return; }
    const btn = body.querySelector("#btnSalvarRegra");
    btn.disabled = true;
    try {
      await salvarRegra(d);
      toast("Regra salva.", "ok");
      vista = "lista";
      draft = null;
      await carregar();
    } catch (e) {
      toast("Erro ao salvar: " + e.message, "warn");
      btn.disabled = false;
    }
  }

  mount.innerHTML = `<div class="card pad">Carregando regras de notificação...</div>`;
  carregar();
  return () => { vivo = false; };
}
