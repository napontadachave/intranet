/* =========================================================================
   Registros Diários — Vendas, Captação, Atendimento e Visitas.

   Três telas de lançamento diário, portadas do sistema anterior (Captação e
   Atendimento e Visitas já existiam para a equipe de Locação; Vendas é o
   "Lançamento de performance" do corretor, sem os campos de meta/peso a
   pedido seu). Os dados NÃO ficam no Realtime Database (motor único de
   sync.js, usado pelo resto do app hoje) — ficam no Cloud Firestore, do
   mesmo jeito que a Análise 360° (ver js/providers/registros-diarios.js
   para o porquê da mudança de banco).

   Mesmo padrão visual/funcional das outras telas de lista da Intranet 2.0
   (cabeçalho + botão "Novo", card de filtros, tabela de histórico) e as
   mesmas regras de visibilidade já usadas em Negociações e Configurações:
   quem é admin (ou tem `perms.view_all_users`) vê e filtra os lançamentos
   de todo mundo e pode excluir; os demais só veem e lançam os próprios.

   Diferença combinada com você em relação ao sistema anterior: as 3 telas
   agora têm um campo "Colaborador" (também para quem não é admin — travado
   na própria pessoa, só pra manter o mesmo layout nas 3 telas).
   ========================================================================= */

import { getSlice } from "../sync.js";
import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { openModal, closeModal, toast, esc } from "../ui-kit.js";
import {
  salvarLancamentoVendas, listarLancamentosVendas, excluirLancamentoVendas,
  salvarRegistroDoDia, buscarRegistroDoDia, listarRegistros, excluirRegistro,
} from "../providers/registros-diarios.js";

/* ------------------------------- utilitários comuns ------------------------------- */

function podeVerTodos() {
  const me = getCurrentUser();
  return isAdmin(me) || !!me?.perms?.view_all_users;
}

function usuariosAtivos() {
  return (getSlice("users") || [])
    .filter((u) => u && u.active !== false)
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

/** "2026-08-28" -> "28/08/2026", sem passar por Date() (evita o problema
 *  clássico de fuso horário que empurra a data um dia pra trás/frente). */
function fmtDataBR(iso) {
  const p = String(iso || "").split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (iso || "-");
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Select de colaborador do formulário de lançamento: quem vê tudo escolhe
 *  qualquer pessoa ativa da equipe; os demais lançam sempre em nome de si
 *  mesmos (select travado, só pra manter o mesmo layout nas 3 telas). */
function colaboradorSelectHtml(id, admin, meId, meNome) {
  if (admin) {
    const users = usuariosAtivos();
    return `<select id="${id}">${users.map((u) => `<option value="${esc(u.id)}" ${u.id === meId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`;
  }
  return `<select id="${id}" disabled><option value="${esc(meId || "")}" selected>${esc(meNome || "Você")}</option></select>`;
}

function renderFiltrosHtml(admin, filtro, prefix) {
  return `
    <div class="card pad" style="margin-bottom:18px">
      <h2 style="margin:0 0 12px;font-size:15px">Filtros</h2>
      <div class="grid ${admin ? "cols3" : "cols2"}">
        ${admin ? `<div class="field"><label>Colaborador</label><select id="${prefix}FiltroUsuario">
          <option value="">Todos</option>
          ${usuariosAtivos().map((u) => `<option value="${esc(u.id)}" ${u.id === filtro.userId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}
        </select></div>` : ""}
        <div class="field"><label>Data de</label><input type="date" id="${prefix}FiltroDe" value="${esc(filtro.dataDe)}"></div>
        <div class="field"><label>Data até</label><input type="date" id="${prefix}FiltroAte" value="${esc(filtro.dataAte)}"></div>
      </div>
      <button type="button" class="btn secondary" style="margin-top:10px" id="${prefix}BtnLimparFiltro">Limpar filtros</button>
    </div>`;
}

function attachFiltros(mount, admin, filtro, prefix, onChange) {
  if (admin) {
    mount.querySelector(`#${prefix}FiltroUsuario`)?.addEventListener("change", (e) => { filtro.userId = e.target.value; onChange(); });
  }
  mount.querySelector(`#${prefix}FiltroDe`)?.addEventListener("change", (e) => { filtro.dataDe = e.target.value; onChange(); });
  mount.querySelector(`#${prefix}FiltroAte`)?.addEventListener("change", (e) => { filtro.dataAte = e.target.value; onChange(); });
  mount.querySelector(`#${prefix}BtnLimparFiltro`)?.addEventListener("click", () => { filtro.userId = ""; filtro.dataDe = ""; filtro.dataAte = ""; onChange(); });
}

function filtrarRegistros(lista, admin, meuId, filtro) {
  return lista
    .filter((r) => (admin ? true : r.userId === meuId))
    .filter((r) => !(admin && filtro.userId) || r.userId === filtro.userId)
    .filter((r) => !filtro.dataDe || (r.data || "") >= filtro.dataDe)
    .filter((r) => !filtro.dataAte || (r.data || "") <= filtro.dataAte)
    .sort((a, b) => (b.data || "").localeCompare(a.data || "") || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

/* --------------------------- Registro Diário - Vendas --------------------------- */

function renderRegistroVendas(mount) {
  const filtro = { userId: "", dataDe: "", dataAte: "" };
  let lancamentos = [];
  let vivo = true;

  async function carregar() {
    try { lancamentos = await listarLancamentosVendas(); }
    catch (e) { toast("Erro ao carregar os lançamentos: " + e.message, "warn"); lancamentos = []; }
    if (vivo) pintar();
  }

  function pintar() {
    const me = getCurrentUser();
    const admin = podeVerTodos();
    const filtrados = filtrarRegistros(lancamentos, admin, me?.id || "", filtro);

    mount.innerHTML = `
      <div class="page-header">
        <div><h1>Registro Diário - Vendas</h1><p>Lançamentos diários de vendas, propostas, visitas, captações e contatos.</p></div>
        <button type="button" class="btn primary" id="btnNovoLanc">+ Novo lançamento</button>
      </div>
      ${renderFiltrosHtml(admin, filtro, "vendas")}
      <div class="card pad">
        <h2 style="margin:0 0 12px;font-size:15px">Histórico${admin ? " (toda a equipe)" : " (meus lançamentos)"}</h2>
        ${filtrados.length ? renderTabelaVendas(filtrados, admin) : `<div class="empty-state"><b>Nenhum lançamento encontrado.</b><p>Ajuste os filtros ou registre o primeiro lançamento do dia.</p></div>`}
      </div>
    `;

    mount.querySelector("#btnNovoLanc").addEventListener("click", () => abrirModalVendas(carregar));
    attachFiltros(mount, admin, filtro, "vendas", pintar);
    if (admin) {
      mount.querySelectorAll("[data-del-lanc]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Excluir este lançamento?")) return;
        try { await excluirLancamentoVendas(b.dataset.delLanc); toast("Lançamento excluído.", "ok"); carregar(); }
        catch (e) { toast("Erro ao excluir: " + e.message, "warn"); }
      }));
    }
  }

  mount.innerHTML = `<div class="card pad">Carregando lançamentos...</div>`;
  carregar();
  return () => { vivo = false; };
}

function renderTabelaVendas(rows, admin) {
  return `<div style="overflow:auto"><table class="tbl"><thead><tr>
      <th>Data</th>${admin ? "<th>Colaborador</th>" : ""}
      <th>Vendas</th><th>Propostas</th><th>Visitas</th><th>Captações</th><th>Contatos</th><th>Observação</th>${admin ? "<th></th>" : ""}
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td>${fmtDataBR(r.data)}</td>
      ${admin ? `<td>${esc(r.userName || "-")}</td>` : ""}
      <td>${esc(r.vendas || 0)}</td><td>${esc(r.propostas || 0)}</td><td>${esc(r.visitas || 0)}</td>
      <td>${esc(r.captacoes || 0)}</td><td>${esc(r.contatos || 0)}</td>
      <td>${esc(r.obs || "-")}</td>
      ${admin ? `<td><button type="button" class="btn ghost" data-del-lanc="${esc(r.id)}">Excluir</button></td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

function abrirModalVendas(onSaved) {
  const me = getCurrentUser();
  const admin = podeVerTodos();
  const hoje = hojeISO();

  const body = openModal("Novo lançamento — Vendas", `
    <div class="grid cols2">
      <div class="field"><label>Colaborador</label>${colaboradorSelectHtml("fLancColaborador", admin, me?.id, me?.name)}</div>
      <div class="field"><label>Data</label><input type="date" id="fLancData" value="${hoje}" max="${hoje}"></div>
    </div>
    <div class="grid cols3">
      <div class="field"><label>Vendas</label><input type="number" min="0" step="1" id="fLancVendas" value="0"></div>
      <div class="field"><label>Propostas</label><input type="number" min="0" step="1" id="fLancPropostas" value="0"></div>
      <div class="field"><label>Visitas</label><input type="number" min="0" step="1" id="fLancVisitas" value="0"></div>
      <div class="field"><label>Captações</label><input type="number" min="0" step="1" id="fLancCaptacoes" value="0"></div>
      <div class="field"><label>Contatos</label><input type="number" min="0" step="1" id="fLancContatos" value="0"></div>
    </div>
    <div class="field"><label>Observação do lançamento</label><input id="fLancObs" placeholder="Ex.: reunião, treinamento, ausência justificada, observação do atendimento..."></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnCancelarLanc">Cancelar</button>
      <button type="button" class="btn primary" id="btnSalvarLanc">Salvar lançamento</button>
    </div>
  `, { width: 640 });

  body.querySelector("#btnCancelarLanc").addEventListener("click", closeModal);
  body.querySelector("#btnSalvarLanc").addEventListener("click", async () => {
    const colaboradorId = admin ? body.querySelector("#fLancColaborador").value : me?.id;
    const colaborador = usuariosAtivos().find((u) => u.id === colaboradorId) || me;
    const data = body.querySelector("#fLancData").value || hoje;
    const btn = body.querySelector("#btnSalvarLanc");
    btn.disabled = true;
    try {
      await salvarLancamentoVendas({
        userId: colaboradorId, userName: colaborador?.name || "", data,
        vendas: body.querySelector("#fLancVendas").value,
        propostas: body.querySelector("#fLancPropostas").value,
        visitas: body.querySelector("#fLancVisitas").value,
        captacoes: body.querySelector("#fLancCaptacoes").value,
        contatos: body.querySelector("#fLancContatos").value,
        obs: body.querySelector("#fLancObs").value,
        criadoPorId: me?.id,
      });
      closeModal();
      toast("Lançamento salvo.", "ok");
      onSaved();
    } catch (e) {
      toast("Erro ao salvar: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

/* ----------------- Registro Diário - Captação / Atendimento e Visitas ----------------- */
/* Estrutura idêntica nas duas telas (só mudam os campos numéricos) — um
   único registro por pessoa por dia: salvar de novo no mesmo dia atualiza
   os números em vez de duplicar. */

const CFG_CAPTACAO = {
  titulo: "Registro Diário - Captação",
  subtitulo: "Preencha os números do dia. Salvar de novo no mesmo dia atualiza o registro (não duplica).",
  tituloModal: "Novo registro diário — Captação",
  textoBotaoSalvar: "Salvar registro",
  colsModal: "cols3",
  campos: [
    { key: "contatos", label: "Contatos Realizados" },
    { key: "conversasQualificadas", label: "Conversas Qualificadas" },
    { key: "avaliacoesAgendadas", label: "Avaliações/Fotos Agendadas" },
    { key: "avaliacoesRealizadas", label: "Avaliações/Fotos Realizadas" },
    { key: "captacoesFinalizadas", label: "Captações Finalizadas" },
  ],
};

const CFG_ATENDIMENTO = {
  titulo: "Registro Diário - Atendimento e Visitas",
  subtitulo: "Preencha os números do dia. Salvar de novo no mesmo dia atualiza o registro (não duplica).",
  tituloModal: "Novo registro diário — Atendimento e Visitas",
  textoBotaoSalvar: "Salvar registro",
  colsModal: "cols4",
  campos: [
    { key: "leadsRecebidos", label: "Leads Recebidos" },
    { key: "leadsAtendidos", label: "Leads Atendidos" },
    { key: "leadsQualificados", label: "Leads Qualificados" },
    { key: "visitasAgendadas", label: "Visitas Agendadas" },
    { key: "visitasRealizadas", label: "Visitas Realizadas" },
    { key: "propostasEnviadas", label: "Propostas Enviadas" },
    { key: "propostasAprovadas", label: "Propostas Aprovadas" },
    { key: "locacoesConcluidas", label: "Locações Concluídas" },
  ],
};

function criarPaginaRegistroDiaSimples(tipoId, cfg) {
  return function render(mount) {
    const filtro = { userId: "", dataDe: "", dataAte: "" };
    let registros = [];
    let vivo = true;

    async function carregar() {
      try { registros = await listarRegistros(tipoId); }
      catch (e) { toast("Erro ao carregar os registros: " + e.message, "warn"); registros = []; }
      if (vivo) pintar();
    }

    function pintar() {
      const me = getCurrentUser();
      const admin = podeVerTodos();
      const filtrados = filtrarRegistros(registros, admin, me?.id || "", filtro);

      mount.innerHTML = `
        <div class="page-header">
          <div><h1>${esc(cfg.titulo)}</h1><p>${esc(cfg.subtitulo)}</p></div>
          <button type="button" class="btn primary" id="btnNovoRegistro">+ Novo registro</button>
        </div>
        ${renderFiltrosHtml(admin, filtro, tipoId)}
        <div class="card pad">
          <h2 style="margin:0 0 12px;font-size:15px">Histórico${admin ? " (toda a equipe)" : " (meus registros)"}</h2>
          ${filtrados.length ? renderTabelaSimples(filtrados, admin, cfg) : `<div class="empty-state"><b>Nenhum registro encontrado.</b><p>Ajuste os filtros ou registre o primeiro lançamento do dia.</p></div>`}
        </div>
      `;

      mount.querySelector("#btnNovoRegistro").addEventListener("click", () => abrirModalRegistroSimples(tipoId, cfg, carregar));
      attachFiltros(mount, admin, filtro, tipoId, pintar);
      if (admin) {
        mount.querySelectorAll("[data-del-reg]").forEach((b) => b.addEventListener("click", async () => {
          if (!confirm("Excluir este registro?")) return;
          try { await excluirRegistro(tipoId, b.dataset.delReg); toast("Registro excluído.", "ok"); carregar(); }
          catch (e) { toast("Erro ao excluir: " + e.message, "warn"); }
        }));
      }
    }

    mount.innerHTML = `<div class="card pad">Carregando registros...</div>`;
    carregar();
    return () => { vivo = false; };
  };
}

function renderTabelaSimples(rows, admin, cfg) {
  return `<div style="overflow:auto"><table class="tbl"><thead><tr>
      <th>Data</th>${admin ? "<th>Colaborador</th>" : ""}
      ${cfg.campos.map((c) => `<th>${esc(c.label)}</th>`).join("")}
      <th>Dificuldades</th>${admin ? "<th></th>" : ""}
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td>${fmtDataBR(r.data)}</td>
      ${admin ? `<td>${esc(r.userName || "-")}</td>` : ""}
      ${cfg.campos.map((c) => `<td>${esc(r[c.key] || 0)}</td>`).join("")}
      <td>${esc(r.dificuldades || "-")}</td>
      ${admin ? `<td><button type="button" class="btn ghost" data-del-reg="${esc(r.id)}">Excluir</button></td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

function abrirModalRegistroSimples(tipoId, cfg, onSaved) {
  const me = getCurrentUser();
  const admin = podeVerTodos();
  const hoje = hojeISO();

  const body = openModal(cfg.tituloModal, `
    <div class="grid cols2">
      <div class="field"><label>Colaborador</label>${colaboradorSelectHtml("fRegColaborador", admin, me?.id, me?.name)}</div>
      <div class="field"><label>Data</label><input type="date" id="fRegData" value="${hoje}" max="${hoje}"></div>
    </div>
    <div class="grid ${cfg.colsModal || "cols3"}">
      ${cfg.campos.map((c) => `<div class="field"><label>${esc(c.label)}</label><input type="number" min="0" step="1" id="fReg_${c.key}" value=""></div>`).join("")}
    </div>
    <div class="field"><label>Quais dificuldades encontrou?</label><textarea id="fRegDificuldades" rows="3"></textarea></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnCancelarReg">Cancelar</button>
      <button type="button" class="btn primary" id="btnSalvarReg">${esc(cfg.textoBotaoSalvar)}</button>
    </div>
  `, { width: 680 });

  async function preencherComExistente() {
    const colaboradorId = admin ? body.querySelector("#fRegColaborador").value : me?.id;
    const data = body.querySelector("#fRegData").value;
    if (!colaboradorId || !data) return;
    let existente = null;
    try { existente = await buscarRegistroDoDia(tipoId, colaboradorId, data); } catch (e) { /* segue sem pré-preencher */ }
    cfg.campos.forEach((c) => {
      const el = body.querySelector(`#fReg_${c.key}`);
      if (el) el.value = existente ? (existente[c.key] ?? "") : "";
    });
    const dif = body.querySelector("#fRegDificuldades");
    if (dif) dif.value = existente ? (existente.dificuldades || "") : "";
  }

  body.querySelector("#fRegData").addEventListener("change", preencherComExistente);
  if (admin) body.querySelector("#fRegColaborador").addEventListener("change", preencherComExistente);
  preencherComExistente();

  body.querySelector("#btnCancelarReg").addEventListener("click", closeModal);
  body.querySelector("#btnSalvarReg").addEventListener("click", async () => {
    const colaboradorId = admin ? body.querySelector("#fRegColaborador").value : me?.id;
    const colaborador = usuariosAtivos().find((u) => u.id === colaboradorId) || me;
    const data = body.querySelector("#fRegData").value || hoje;
    const campos = {};
    cfg.campos.forEach((c) => { campos[c.key] = Number(body.querySelector(`#fReg_${c.key}`).value || 0) || 0; });
    campos.dificuldades = body.querySelector("#fRegDificuldades").value.trim();
    const btn = body.querySelector("#btnSalvarReg");
    btn.disabled = true;
    try {
      await salvarRegistroDoDia(tipoId, { userId: colaboradorId, userName: colaborador?.name || "", data, campos });
      closeModal();
      toast("Registro salvo.", "ok");
      onSaved();
    } catch (e) {
      toast("Erro ao salvar: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

registerPage("registro_vendas", renderRegistroVendas);
registerPage("registro_captacao", criarPaginaRegistroDiaSimples("captacao", CFG_CAPTACAO));
registerPage("registro_atendimento", criarPaginaRegistroDiaSimples("atendimento", CFG_ATENDIMENTO));
