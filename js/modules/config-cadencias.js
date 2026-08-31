/* =========================================================================
   Configurações → Gestão de Cadências e Templates.

   A pedido seu, as telas de gestão da Intranet 2.0 passaram a viver como
   guias dentro de Configurações, em vez de ficarem soltas dentro de cada
   módulo (como no sistema anterior) — a importação da Análise 360° é uma
   guia (ver js/modules/configuracoes.js) e esta, "Gestão de Cadências e
   Templates", é outra. As próximas telas de gestão que forem entrando
   seguem o mesmo padrão.

   Duas sub-guias aqui dentro:
   - **Cadências**: cria/edita as cadências de cada programa (Novos Leads /
     Reativação) usadas pela tela de Atendimentos (js/modules/leads.js) —
     nome, descrição, se está ativa, e a lista de etapas (nome, tipo, prazo
     e mensagem sugerida). Só uma cadência fica ativa por programa de cada
     vez — é ela que todo lead novo recebe (ver nota em
     js/providers/cadencia-config.js sobre essa simplificação em relação ao
     sistema anterior, que permitia várias cadências ativas por origem).
   - **Templates de Mensagens**: uma biblioteca de textos reutilizáveis
     (nome, categoria, texto com variáveis) — o editor de etapa de cadência
     tem um botão "Usar" que copia o texto de um template escolhido para a
     mensagem da etapa (uma cópia, não uma referência viva: editar o
     template depois não muda etapas que já usaram aquele texto).

   Reordenar etapas usa ↑/↓ (mesmo padrão já usado em Negociações para
   colunas do kanban), não arrastar-e-soltar como no sistema anterior —
   mais simples de manter e o resultado final é o mesmo.
   ========================================================================= */

import { openModal, closeModal, toast, esc } from "../ui-kit.js";
import {
  listarCadencias, garantirCadenciasPadrao, salvarCadencia, ativarCadencia, desativarCadencia,
  duplicarCadencia, excluirCadencia, listarTemplates, salvarTemplate, excluirTemplate,
} from "../providers/cadencia-config.js";
import { PROGRAMAS, TIPOS_ATIVIDADE, UNIDADES_TEMPO, CATEGORIAS_TEMPLATE, VARIAVEIS } from "../providers/cadencia-defaults.js";

function novoIdEtapaLocal() {
  return "et_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Insere um texto na posição do cursor de um textarea (ou no final, se não
 *  houver seleção) — usado tanto pelos botões de variável quanto, de forma
 *  indireta, mantém o valor sincronizado no draft logo em seguida. */
function inserirNoTextarea(textarea, texto) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + texto + textarea.value.slice(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + texto.length;
}

export function renderGestaoCadenciasTemplates(mount) {
  let vivo = true;
  let subTab = "cadencias"; // "cadencias" | "templates"
  let vista = "lista"; // "lista" | "editor" (só usado dentro da sub-guia Cadências)
  let draftCadencia = null;
  let cadencias = [];
  let templates = [];

  async function carregar() {
    try {
      await garantirCadenciasPadrao();
      const [c, t] = await Promise.all([listarCadencias(), listarTemplates()]);
      cadencias = c;
      templates = t;
    } catch (e) {
      toast("Erro ao carregar: " + e.message, "warn");
    }
    if (vivo) pintar();
  }

  function pintar() {
    mount.innerHTML = `
      <div class="tabs" style="margin-bottom:18px">
        <button data-sub="cadencias" class="${subTab === "cadencias" ? "active" : ""}">Cadências</button>
        <button data-sub="templates" class="${subTab === "templates" ? "active" : ""}">Templates de Mensagens</button>
      </div>
      <div id="subBody"></div>
    `;
    mount.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => {
      subTab = b.dataset.sub; vista = "lista"; draftCadencia = null; pintar();
    }));
    const subBody = mount.querySelector("#subBody");
    if (subTab === "cadencias") {
      if (vista === "editor") renderEditorCadencia(subBody);
      else renderListaCadencias(subBody);
    } else {
      renderListaTemplates(subBody);
    }
  }

  /* ------------------------------- Cadências: lista ------------------------------- */

  function renderListaCadencias(subBody) {
    subBody.innerHTML = Object.values(PROGRAMAS).map((p) => {
      const doPrograma = cadencias.filter((c) => c.programa === p.id);
      return `
        <div style="margin-bottom:28px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:10px">
            <h2 style="margin:0;font-size:16px">${esc(p.label)}</h2>
            <button type="button" class="btn secondary" data-nova-cadencia="${p.id}">+ Nova cadência</button>
          </div>
          ${doPrograma.length ? doPrograma.map(renderCardCadencia).join("") : `<div class="card pad empty-state"><b>Nenhuma cadência cadastrada.</b></div>`}
        </div>`;
    }).join("");

    subBody.querySelectorAll("[data-nova-cadencia]").forEach((b) => b.addEventListener("click", () => abrirEditor(null, b.dataset.novaCadencia)));
    subBody.querySelectorAll("[data-editar-cad]").forEach((b) => b.addEventListener("click", () => abrirEditor(b.dataset.editarCad)));
    subBody.querySelectorAll("[data-ativar-cad]").forEach((b) => b.addEventListener("click", () => acaoAtivar(b.dataset.ativarCad)));
    subBody.querySelectorAll("[data-desativar-cad]").forEach((b) => b.addEventListener("click", () => acaoDesativar(b.dataset.desativarCad)));
    subBody.querySelectorAll("[data-duplicar-cad]").forEach((b) => b.addEventListener("click", () => acaoDuplicar(b.dataset.duplicarCad)));
    subBody.querySelectorAll("[data-excluir-cad]").forEach((b) => b.addEventListener("click", () => acaoExcluirCadencia(b.dataset.excluirCad)));
  }

  function renderCardCadencia(c) {
    const totalEtapas = (c.etapas || []).length;
    return `<div class="card pad" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
      <div>
        <b>${esc(c.nome)}</b> ${c.ativa ? '<span class="tag green">Ativa</span>' : '<span class="tag gray">Inativa</span>'}
        <div class="kpi-delta">${esc(c.descricao || "sem descrição")}</div>
        <div class="kpi-delta">${totalEtapas} etapa${totalEtapas === 1 ? "" : "s"}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${c.ativa
          ? `<button type="button" class="btn secondary" data-desativar-cad="${esc(c.id)}">Desativar</button>`
          : `<button type="button" class="btn primary" data-ativar-cad="${esc(c.id)}">Ativar</button>`}
        <button type="button" class="btn secondary" data-editar-cad="${esc(c.id)}">Editar</button>
        <button type="button" class="btn ghost" data-duplicar-cad="${esc(c.id)}">Duplicar</button>
        <button type="button" class="btn danger" data-excluir-cad="${esc(c.id)}">Excluir</button>
      </div>
    </div>`;
  }

  async function acaoAtivar(id) {
    try { await ativarCadencia(id); toast("Cadência ativada.", "ok"); await carregar(); }
    catch (e) { toast("Erro: " + e.message, "warn"); }
  }
  async function acaoDesativar(id) {
    try {
      await desativarCadencia(id);
      toast("Cadência desativada.", "ok");
      await carregar();
    } catch (e) { toast("Erro: " + e.message, "warn"); }
  }
  async function acaoDuplicar(id) {
    try { await duplicarCadencia(id); toast("Cadência duplicada (como inativa).", "ok"); await carregar(); }
    catch (e) { toast("Erro: " + e.message, "warn"); }
  }
  async function acaoExcluirCadencia(id) {
    if (!confirm("Excluir esta cadência? Leads que já foram atribuídos a ela mantêm o histórico intacto, mas ela deixa de aparecer aqui.")) return;
    try { await excluirCadencia(id); toast("Cadência excluída.", "ok"); await carregar(); }
    catch (e) { toast("Erro: " + e.message, "warn"); }
  }

  /* ------------------------------ Cadências: editor ------------------------------ */

  function abrirEditor(id, programaNovo) {
    const original = id ? cadencias.find((c) => c.id === id) : null;
    draftCadencia = original
      ? { ...original, etapas: (original.etapas || []).map((e) => ({ ...e })) }
      : { programa: programaNovo || Object.keys(PROGRAMAS)[0], nome: "", descricao: "", ativa: false, etapas: [] };
    vista = "editor";
    pintar();
  }

  function renderEtapaCard(etapa, i, total) {
    return `<div class="card pad" style="margin-bottom:12px">
      <div class="grid cols3">
        <div class="field"><label>Nome da etapa</label><input data-et="${i}.nome" value="${esc(etapa.nome || "")}"></div>
        <div class="field"><label>Tipo</label><select data-et="${i}.tipo">
          ${TIPOS_ATIVIDADE.map(([v, l]) => `<option value="${v}" ${etapa.tipo === v ? "selected" : ""}>${esc(l)}</option>`).join("")}
        </select></div>
        <div class="field"><label>Prazo</label>
          <div style="display:flex;gap:8px">
            <input type="number" min="0" step="1" data-et="${i}.tempoValor" value="${esc(etapa.tempoValor ?? 0)}" style="flex:1;min-width:0">
            <select data-et="${i}.tempoUnidade" style="flex:1;min-width:0">
              ${UNIDADES_TEMPO.map(([v, l]) => `<option value="${v}" ${etapa.tempoUnidade === v ? "selected" : ""}>${esc(l)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
      <div class="field">
        <label>Mensagem sugerida (opcional)</label>
        <textarea data-et="${i}.mensagem" rows="3">${esc(etapa.mensagem || "")}</textarea>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
          ${VARIAVEIS.map(([v, l]) => `<button type="button" class="btn ghost" data-var-etapa="${i}:${v}">+ ${esc(l)}</button>`).join("")}
        </div>
        ${templates.length ? `<div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">
          <select data-et-template="${i}" style="flex:1;min-width:180px">
            <option value="">Carregar de um template...</option>
            ${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join("")}
          </select>
          <button type="button" class="btn secondary" data-et-usar-template="${i}">Usar</button>
        </div>` : ""}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <div style="display:flex;gap:6px">
          <button type="button" class="btn ghost" data-et-up="${i}" ${i === 0 ? "disabled" : ""} title="Mover para cima">↑</button>
          <button type="button" class="btn ghost" data-et-down="${i}" ${i === total - 1 ? "disabled" : ""} title="Mover para baixo">↓</button>
        </div>
        <button type="button" class="btn danger" data-et-del="${i}">Excluir etapa</button>
      </div>
    </div>`;
  }

  function renderEditorCadencia(subBody) {
    const d = draftCadencia;
    subBody.innerHTML = `
      <div class="card pad" style="margin-bottom:16px">
        <div class="grid cols2">
          <div class="field"><label>Nome da cadência</label><input id="cadNome" value="${esc(d.nome)}"></div>
          <div class="field"><label>Programa</label><select id="cadPrograma">
            ${Object.values(PROGRAMAS).map((p) => `<option value="${p.id}" ${d.programa === p.id ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
          </select></div>
        </div>
        <div class="field"><label>Descrição (opcional)</label><input id="cadDescricao" value="${esc(d.descricao || "")}"></div>
        <label style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;margin-top:4px;cursor:pointer">
          <input type="checkbox" id="cadAtiva" ${d.ativa ? "checked" : ""}>
          Deixar esta cadência ativa para o programa (desativa qualquer outra cadência do mesmo programa)
        </label>
      </div>

      <h3 style="font-size:15px;margin:0 0 10px">Etapas</h3>
      <div id="etapasWrap">
        ${d.etapas.length ? d.etapas.map((e, i) => renderEtapaCard(e, i, d.etapas.length)).join("") : `<p class="kpi-delta">Nenhuma etapa ainda — adicione a primeira abaixo.</p>`}
      </div>
      <button type="button" class="btn secondary" id="btnAddEtapa" style="margin-bottom:24px">+ Adicionar etapa</button>

      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn secondary" id="btnCancelarCad">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarCad">Salvar cadência</button>
      </div>
    `;

    subBody.querySelector("#cadNome").addEventListener("input", (e) => { d.nome = e.target.value; });
    subBody.querySelector("#cadPrograma").addEventListener("change", (e) => { d.programa = e.target.value; });
    subBody.querySelector("#cadDescricao").addEventListener("input", (e) => { d.descricao = e.target.value; });
    subBody.querySelector("#cadAtiva").addEventListener("change", (e) => { d.ativa = e.target.checked; });

    attachEtapaHandlers(subBody, d);

    subBody.querySelector("#btnAddEtapa").addEventListener("click", () => {
      d.etapas.push({ id: novoIdEtapaLocal(), nome: "", tipo: "whatsapp", tempoValor: 1, tempoUnidade: "dias", mensagem: "" });
      renderEditorCadencia(subBody);
    });
    subBody.querySelector("#btnCancelarCad").addEventListener("click", () => { vista = "lista"; draftCadencia = null; pintar(); });
    subBody.querySelector("#btnSalvarCad").addEventListener("click", () => salvarDraftCadencia(subBody, d));
  }

  function attachEtapaHandlers(subBody, d) {
    subBody.querySelectorAll("[data-et]").forEach((el) => {
      const [idxStr, campo] = el.dataset.et.split(".");
      const evento = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evento, (e) => { d.etapas[+idxStr][campo] = e.target.value; });
    });
    subBody.querySelectorAll("[data-var-etapa]").forEach((b) => b.addEventListener("click", () => {
      const [idxStr, varKey] = b.dataset.varEtapa.split(":");
      const ta = subBody.querySelector(`[data-et="${idxStr}.mensagem"]`);
      inserirNoTextarea(ta, `{{${varKey}}}`);
      d.etapas[+idxStr].mensagem = ta.value;
    }));
    subBody.querySelectorAll("[data-et-usar-template]").forEach((b) => b.addEventListener("click", () => {
      const idxStr = b.dataset.etUsarTemplate;
      const select = subBody.querySelector(`[data-et-template="${idxStr}"]`);
      const tpl = templates.find((t) => t.id === select.value);
      if (!tpl) { toast("Selecione um template.", "warn"); return; }
      const ta = subBody.querySelector(`[data-et="${idxStr}.mensagem"]`);
      ta.value = tpl.texto;
      d.etapas[+idxStr].mensagem = tpl.texto;
    }));
    subBody.querySelectorAll("[data-et-up]").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.etUp;
      if (i <= 0) return;
      [d.etapas[i - 1], d.etapas[i]] = [d.etapas[i], d.etapas[i - 1]];
      renderEditorCadencia(subBody);
    }));
    subBody.querySelectorAll("[data-et-down]").forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.etDown;
      if (i >= d.etapas.length - 1) return;
      [d.etapas[i + 1], d.etapas[i]] = [d.etapas[i], d.etapas[i + 1]];
      renderEditorCadencia(subBody);
    }));
    subBody.querySelectorAll("[data-et-del]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm("Excluir esta etapa?")) return;
      d.etapas.splice(+b.dataset.etDel, 1);
      renderEditorCadencia(subBody);
    }));
  }

  async function salvarDraftCadencia(subBody, d) {
    if (!d.nome.trim()) { toast("Dê um nome para a cadência.", "warn"); return; }
    if (d.etapas.some((e) => !e.nome || !e.nome.trim())) { toast("Dê um nome a todas as etapas.", "warn"); return; }
    const btn = subBody.querySelector("#btnSalvarCad");
    btn.disabled = true;
    try {
      const payload = { ...d, etapas: d.etapas.map((e) => ({ ...e, tempoValor: Number(e.tempoValor) || 0 })) };
      const salvo = await salvarCadencia(payload);
      if (payload.ativa) await ativarCadencia(salvo.id);
      toast("Cadência salva.", "ok");
      vista = "lista";
      draftCadencia = null;
      await carregar();
    } catch (e) {
      toast("Erro ao salvar: " + e.message, "warn");
      btn.disabled = false;
    }
  }

  /* ------------------------------- Templates ------------------------------- */

  function renderListaTemplates(subBody) {
    subBody.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
        <button type="button" class="btn secondary" id="btnNovoTemplate">+ Novo template</button>
      </div>
      ${templates.length ? templates.map(renderCardTemplate).join("") : `<div class="card pad empty-state"><b>Nenhum template cadastrado.</b><p>Um template é um texto pronto que pode ser carregado na mensagem de qualquer etapa de cadência.</p></div>`}
    `;
    subBody.querySelector("#btnNovoTemplate").addEventListener("click", () => abrirModalTemplate(null));
    subBody.querySelectorAll("[data-editar-tpl]").forEach((b) => b.addEventListener("click", () => abrirModalTemplate(b.dataset.editarTpl)));
    subBody.querySelectorAll("[data-excluir-tpl]").forEach((b) => b.addEventListener("click", () => acaoExcluirTemplate(b.dataset.excluirTpl)));
  }

  function renderCardTemplate(t) {
    const preview = (t.texto || "").length > 140 ? t.texto.slice(0, 140) + "…" : (t.texto || "");
    return `<div class="card pad" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <b>${esc(t.nome)}</b> ${t.categoria ? `<span class="tag blue">${esc(t.categoria)}</span>` : ""}
          <p class="kpi-delta" style="margin:6px 0 0;max-width:640px">${esc(preview)}</p>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn secondary" data-editar-tpl="${esc(t.id)}">Editar</button>
          <button type="button" class="btn danger" data-excluir-tpl="${esc(t.id)}">Excluir</button>
        </div>
      </div>
    </div>`;
  }

  async function acaoExcluirTemplate(id) {
    if (!confirm("Excluir este template?")) return;
    try { await excluirTemplate(id); toast("Template excluído.", "ok"); await carregar(); }
    catch (e) { toast("Erro: " + e.message, "warn"); }
  }

  function abrirModalTemplate(id) {
    const original = id ? templates.find((t) => t.id === id) : null;
    const body = openModal(original ? "Editar template" : "Novo template", `
      <div class="grid cols2">
        <div class="field"><label>Nome</label><input id="tplNome" value="${esc(original?.nome || "")}"></div>
        <div class="field"><label>Categoria</label><select id="tplCategoria">
          <option value="">Sem categoria</option>
          ${CATEGORIAS_TEMPLATE.map((c) => `<option value="${esc(c)}" ${original?.categoria === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select></div>
      </div>
      <div class="field">
        <label>Texto</label>
        <textarea id="tplTexto" rows="5">${esc(original?.texto || "")}</textarea>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
          ${VARIAVEIS.map(([v, l]) => `<button type="button" class="btn ghost" data-var-tpl="${v}">+ ${esc(l)}</button>`).join("")}
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" id="btnCancelarTpl">Cancelar</button>
        <button type="button" class="btn primary" id="btnSalvarTpl">Salvar template</button>
      </div>
    `, { width: 560 });

    body.querySelectorAll("[data-var-tpl]").forEach((b) => b.addEventListener("click", () => {
      inserirNoTextarea(body.querySelector("#tplTexto"), `{{${b.dataset.varTpl}}}`);
    }));
    body.querySelector("#btnCancelarTpl").addEventListener("click", closeModal);
    body.querySelector("#btnSalvarTpl").addEventListener("click", async () => {
      const btn = body.querySelector("#btnSalvarTpl");
      btn.disabled = true;
      try {
        await salvarTemplate({
          id: original?.id,
          nome: body.querySelector("#tplNome").value.trim(),
          categoria: body.querySelector("#tplCategoria").value,
          texto: body.querySelector("#tplTexto").value,
        });
        closeModal();
        toast("Template salvo.", "ok");
        await carregar();
      } catch (e) {
        toast("Erro ao salvar: " + e.message, "warn");
        btn.disabled = false;
      }
    });
  }

  mount.innerHTML = `<div class="card pad">Carregando...</div>`;
  carregar();
  return () => { vivo = false; };
}
