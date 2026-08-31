/* =========================================================================
   Detalhes de um lead de Atendimentos — modal + sub-modais de ação.

   Extraído de js/modules/leads.js para ser reaproveitado também pela nova
   tela "Leads Distribuídos" (js/modules/leads-distribuidos.js): as duas
   telas mostram o MESMO tipo de registro (um lead da coleção
   `atendimentosCadencia`), só que filtrado de um jeito diferente — Atendimentos
   por responsável de SDR, Leads Distribuídos por corretor — então o modal de
   detalhes e as ações do dia a dia (registrar contato, concluir etapa,
   adiar, qualificar, marcar como perdido, excluir, histórico) são os mesmos
   nas duas.

   Por isso `abrirDetalhesLead` não depende de nenhum estado global de
   página — recebe o `lead` direto e um objeto `apoio` com o que cada tela
   precisa fornecer:
     { cadenciasPorId, filas, admin, onChanged }
   - `cadenciasPorId`: Map id -> cadência (pra achar as etapas do lead).
   - `filas`: lista de filas cadastradas (Configurações → Gestão de Filas),
     usada só pelo modal de Qualificar.
   - `admin`: mostra ou não o botão "Excluir lead".
   - `onChanged`: chamado depois de qualquer ação bem-sucedida, pra quem
     chamou recarregar a própria lista e repintar a tela por trás do modal.

   A pedido seu, "Qualificar Lead" ganhou a distribuição por fila: ao
   escolher uma fila, o modal mostra o próximo corretor da vez (posição 0
   da fila) e permite pular (com justificativa obrigatória) até achar quem
   deve receber o lead — ver js/providers/filas-distribuicao.js para a
   mecânica de fila (round-robin: quem é escolhido ou pulado vai pro final).
   ========================================================================= */

import { openModal, closeModal, toast, esc, fmtDateTime } from "../ui-kit.js";
import { getCurrentUser } from "../auth.js";
import {
  registrarAtividade, concluirEtapa, adiarProximaAtividade, qualificarLead, marcarPerdido,
} from "../providers/atendimentos-cadencia.js";
import { avancarFila, excluirDistribuicao } from "../providers/filas-distribuicao.js";
import { TIPOS_ATIVIDADE, MOTIVOS_QUALIFICACAO, MOTIVOS_PERDA, SITUACOES_QUALIFICADAS, labelTipoAtividade, mensagemEtapaAtual } from "../providers/cadencia-defaults.js";

/* ------------------------------- utilitários compartilhados ------------------------------- */

/** "2026-08-28" -> "28/08/2026", sem passar por Date() (mesmo cuidado com
 *  fuso horário já usado nos Registros Diários). */
export function fmtDataBR(iso) {
  const p = String(iso || "").split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (iso || "-");
}

/** Diferença em dias de calendário (ignora hora) entre uma data ISO e uma
 *  referência — mesma lógica de `sdrDiasEntre` do sistema anterior. */
export function diasEntre(iso, ref) {
  if (!iso) return null;
  const a = new Date(iso), b = ref || new Date();
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

export function situacaoTagHtml(situacao) {
  if (situacao === "Perdido") return `<span class="tag red">${esc(situacao)}</span>`;
  if (SITUACOES_QUALIFICADAS.indexOf(situacao) !== -1) return `<span class="tag green">${esc(situacao)}</span>`;
  return `<span class="tag yellow">${esc(situacao || "Novo")}</span>`;
}

export function situacaoTerminal(situacao) {
  return situacao === "Perdido" || SITUACOES_QUALIFICADAS.indexOf(situacao) !== -1;
}

function isoParaDatetimeLocal(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function copiarParaClipboardFallback(texto) {
  try {
    const ta = document.createElement("textarea");
    ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    toast("Mensagem copiada.", "ok");
  } catch (e) {
    toast("Não foi possível copiar automaticamente. Selecione o texto manualmente.", "warn");
  }
}
function copiarParaClipboard(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(() => toast("Mensagem copiada.", "ok")).catch(() => copiarParaClipboardFallback(texto));
  } else {
    copiarParaClipboardFallback(texto);
  }
}

/** Etapas da cadência à qual o lead foi atribuído (via cache local) — [] se
 *  a cadência não estiver mais carregada (ex.: foi excluída depois). */
function etapasDoLeadCache(lead, cadenciasPorId) {
  return cadenciasPorId?.get(lead.cadenciaId)?.etapas || [];
}

/* --------------------------------- detalhes do lead --------------------------------- */

export function abrirDetalhesLead(lead, apoio) {
  const admin = !!apoio.admin;
  const terminal = situacaoTerminal(lead.situacao);
  const etapas = etapasDoLeadCache(lead, apoio.cadenciasPorId);
  const prox = lead.proximaAtividade;
  const atrasada = !!prox && !lead.cadenciaEncerrada && (diasEntre(prox.previstoPara, new Date()) ?? 0) < 0;
  const mensagem = mensagemEtapaAtual(lead, etapas);

  const body = openModal(`Lead — ${lead.leadNome}`, `
    <div class="grid cols2">
      <div class="field"><label>Telefone</label><div>${esc(lead.leadTelefone || "-")}</div></div>
      <div class="field"><label>E-mail</label><div>${esc(lead.leadEmail || "-")}</div></div>
      <div class="field"><label>Origem</label><div>${esc(lead.origem || "-")}</div></div>
      <div class="field"><label>Empreendimento</label><div>${esc(lead.empreendimento || "-")}</div></div>
      <div class="field"><label>Corretor</label><div>${esc(lead.corretorNome || "-")}</div></div>
      <div class="field"><label>Responsável</label><div>${esc(lead.sdrResponsavelNome || "-")}</div></div>
      <div class="field"><label>Cadência</label><div>${esc(lead.cadenciaNome || "-")}</div></div>
      ${lead.filaNome ? `<div class="field"><label>Distribuído pela fila</label><div>${esc(lead.filaNome)}${lead.distribuidoEm ? " — " + esc(fmtDateTime(lead.distribuidoEm)) : ""}</div></div>` : ""}
    </div>
    <div class="card pad" style="margin:14px 0">
      <div class="grid cols2">
        <div class="field"><label>Situação</label><div>${situacaoTagHtml(lead.situacao)}</div></div>
        <div class="field"><label>Etapa atual</label><div>${lead.cadenciaEncerrada ? "Cadência concluída" : esc(etapas[lead.etapaAtualIndex]?.nome || "-")}</div></div>
      </div>
      <div class="field" style="margin-bottom:0"><label>Próxima atividade</label><div>
        ${prox ? `${esc(prox.etapaNome)} (${esc(labelTipoAtividade(prox.tipo))}) — ${fmtDateTime(prox.previstoPara)}${atrasada ? ' <span class="tag red">Atrasada</span>' : ""}` : "Nenhuma"}
      </div></div>
    </div>
    ${mensagem ? `<div class="field">
      <label>Mensagem sugerida da etapa atual</label>
      <textarea id="fMensagemEtapa" rows="3" readonly>${esc(mensagem)}</textarea>
      <button type="button" class="btn secondary" id="btnCopiarMensagem" style="margin-top:6px;align-self:flex-start">Copiar mensagem</button>
    </div>` : ""}
    <div class="actions" style="flex-wrap:wrap;justify-content:flex-start">
      <button type="button" class="btn secondary" id="btnRegistrarContato">Registrar contato</button>
      ${!lead.cadenciaEncerrada ? `<button type="button" class="btn secondary" id="btnConcluirEtapa">Concluir etapa</button>` : ""}
      ${!lead.cadenciaEncerrada ? `<button type="button" class="btn secondary" id="btnAdiar">Adiar</button>` : ""}
      ${!terminal ? `<button type="button" class="btn primary" id="btnQualificar">Qualificar Lead</button>` : ""}
      ${!terminal ? `<button type="button" class="btn danger" id="btnPerdido">Marcar como Perdido</button>` : ""}
      <button type="button" class="btn ghost" id="btnHistorico">Histórico</button>
      ${admin ? `<button type="button" class="btn ghost" id="btnExcluirLead">Excluir lead</button>` : ""}
    </div>
  `, { width: 640 });

  if (mensagem) body.querySelector("#btnCopiarMensagem").addEventListener("click", () => copiarParaClipboard(mensagem));
  body.querySelector("#btnRegistrarContato").addEventListener("click", () => abrirModalRegistrarAtividade(lead, apoio));
  body.querySelector("#btnConcluirEtapa")?.addEventListener("click", () => abrirModalConcluirEtapa(lead, apoio));
  body.querySelector("#btnAdiar")?.addEventListener("click", () => abrirModalAdiar(lead, apoio));
  body.querySelector("#btnQualificar")?.addEventListener("click", () => abrirModalQualificar(lead, apoio));
  body.querySelector("#btnPerdido")?.addEventListener("click", () => abrirModalPerdido(lead, apoio));
  body.querySelector("#btnHistorico").addEventListener("click", () => abrirModalHistorico(lead, apoio));
  body.querySelector("#btnExcluirLead")?.addEventListener("click", async () => {
    if (!confirm("Excluir este lead? Esta ação não pode ser desfeita." + (lead.filaId ? " O corretor volta para a frente da fila de onde veio." : ""))) return;
    try {
      await excluirDistribuicao(lead);
      closeModal();
      toast("Lead excluído.", "ok");
      await apoio.onChanged();
    } catch (e) {
      toast("Erro ao excluir: " + e.message, "warn");
    }
  });
}

/* ----------------------------- sub-modais de ação ----------------------------- */

function abrirModalRegistrarAtividade(lead, apoio) {
  const body = openModal("Registrar contato", `
    <div class="field"><label>Tipo</label><select id="fTipoAtiv">${TIPOS_ATIVIDADE.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></div>
    <div class="field"><label>Resultado</label><input id="fResultadoAtiv" placeholder="Ex.: respondeu, sem resposta, reagendou..."></div>
    <div class="field"><label>Observações</label><textarea id="fObsAtiv" rows="3"></textarea></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnVoltarAtiv">Voltar</button>
      <button type="button" class="btn primary" id="btnSalvarAtiv">Salvar</button>
    </div>
  `, { width: 480 });

  body.querySelector("#btnVoltarAtiv").addEventListener("click", () => abrirDetalhesLead(lead, apoio));
  body.querySelector("#btnSalvarAtiv").addEventListener("click", async () => {
    const me = getCurrentUser();
    const btn = body.querySelector("#btnSalvarAtiv");
    btn.disabled = true;
    try {
      const atualizado = await registrarAtividade(lead.id, {
        tipo: body.querySelector("#fTipoAtiv").value,
        resultado: body.querySelector("#fResultadoAtiv").value.trim(),
        observacoes: body.querySelector("#fObsAtiv").value.trim(),
        usuarioId: me?.id, usuarioNome: me?.name,
      });
      await apoio.onChanged();
      toast("Contato registrado.", "ok");
      abrirDetalhesLead(atualizado, apoio);
    } catch (e) {
      toast("Erro ao registrar: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

function abrirModalConcluirEtapa(lead, apoio) {
  const body = openModal("Concluir etapa", `
    <div class="field"><label>Resultado</label><input id="fResultadoConcl" placeholder="Ex.: confirmou interesse, agendou visita..."></div>
    <div class="field"><label>Observações</label><textarea id="fObsConcl" rows="3"></textarea></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnVoltarConcl">Voltar</button>
      <button type="button" class="btn primary" id="btnConfirmarConcl">Concluir etapa</button>
    </div>
  `, { width: 480 });

  body.querySelector("#btnVoltarConcl").addEventListener("click", () => abrirDetalhesLead(lead, apoio));
  body.querySelector("#btnConfirmarConcl").addEventListener("click", async () => {
    const me = getCurrentUser();
    const btn = body.querySelector("#btnConfirmarConcl");
    btn.disabled = true;
    try {
      const atualizado = await concluirEtapa(lead.id, {
        resultado: body.querySelector("#fResultadoConcl").value.trim(),
        observacoes: body.querySelector("#fObsConcl").value.trim(),
        usuarioId: me?.id, usuarioNome: me?.name,
      });
      await apoio.onChanged();
      toast("Etapa concluída.", "ok");
      abrirDetalhesLead(atualizado, apoio);
    } catch (e) {
      toast("Erro: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

function abrirModalAdiar(lead, apoio) {
  const valorAtual = isoParaDatetimeLocal(lead.proximaAtividade?.previstoPara);
  const body = openModal("Adiar próxima atividade", `
    <div class="field"><label>Nova data/hora</label><input type="datetime-local" id="fNovaData" value="${valorAtual}"></div>
    <div class="field"><label>Motivo (opcional)</label><input id="fMotivoAdiar" placeholder="Ex.: cliente pediu pra retornar semana que vem"></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnVoltarAdiar">Voltar</button>
      <button type="button" class="btn primary" id="btnConfirmarAdiar">Confirmar</button>
    </div>
  `, { width: 460 });

  body.querySelector("#btnVoltarAdiar").addEventListener("click", () => abrirDetalhesLead(lead, apoio));
  body.querySelector("#btnConfirmarAdiar").addEventListener("click", async () => {
    const valor = body.querySelector("#fNovaData").value;
    if (!valor) { toast("Informe a nova data/hora.", "warn"); return; }
    const btn = body.querySelector("#btnConfirmarAdiar");
    btn.disabled = true;
    try {
      const atualizado = await adiarProximaAtividade(lead.id, {
        novoPrevistoPara: new Date(valor).toISOString(),
        motivo: body.querySelector("#fMotivoAdiar").value.trim(),
      });
      await apoio.onChanged();
      toast("Atividade adiada.", "ok");
      abrirDetalhesLead(atualizado, apoio);
    } catch (e) {
      toast("Erro: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

/** "Qualificar Lead" — a pedido seu, ganhou a distribuição por fila: quem
 *  qualifica pode escolher, na hora, uma fila cadastrada (nenhuma fila é
 *  amarrada a um programa — a escolha é sempre manual) e o modal mostra o
 *  próximo corretor da vez (posição 0 da fila), com um botão pra pular
 *  (exige justificativa) até achar quem deve receber. Só ao confirmar
 *  "Qualificar" é que a fila de fato avança (`avancarFila`) — cancelar ou
 *  fechar o modal no meio de uns pulos não muda nada de verdade. */
function abrirModalQualificar(lead, apoio) {
  const filas = apoio.filas || [];
  let filaId = "";
  let pulos = []; // [{id, nome, motivo}]

  const body = openModal("Qualificar lead", `
    <div class="field"><label>Motivo</label><select id="fMotivoQualif">
      <option value="">Selecione...</option>
      ${MOTIVOS_QUALIFICACAO.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}
    </select></div>
    <div class="field"><label>Observações</label><textarea id="fObsQualif" rows="3"></textarea></div>
    <div class="field"><label>Distribuir para um corretor pela fila (opcional)</label>
      <select id="fFilaQualif">
        <option value="">— nenhuma / não distribuir agora —</option>
        ${filas.map((f) => `<option value="${esc(f.id)}">${esc(f.nome)} (${(f.membros || []).length} corretor${(f.membros || []).length === 1 ? "" : "es"})</option>`).join("")}
      </select>
    </div>
    <div id="filaSecao"></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnVoltarQualif">Voltar</button>
      <button type="button" class="btn primary" id="btnConfirmarQualif">Qualificar</button>
    </div>
  `, { width: 520 });

  function filaEscolhida() { return filas.find((f) => f.id === filaId) || null; }

  /** Quem seria escolhido agora: o membro que sobra depois de descartar
   *  quem já foi pulado nesta passada pelo modal (mesma ordem da fila). */
  function corretorAtual() {
    const membros = filaEscolhida()?.membros || [];
    return membros.length ? membros[pulos.length % membros.length] : null;
  }

  function renderFilaSecao() {
    const secao = body.querySelector("#filaSecao");
    const fila = filaEscolhida();
    if (!fila) { secao.innerHTML = ""; return; }
    const membros = fila.membros || [];
    if (!membros.length) {
      secao.innerHTML = `<p class="kpi-delta" style="color:var(--vermelho)">Esta fila ainda não tem corretores cadastrados — configure em Configurações → Gestão de Filas.</p>`;
      return;
    }
    const atual = corretorAtual();
    secao.innerHTML = `
      <div class="card pad" style="margin:8px 0 18px">
        ${pulos.length ? `<ul style="margin:0 0 8px;padding-left:18px">${pulos.map((p) => `<li class="kpi-delta">Pulou <b>${esc(p.nome)}</b> — ${esc(p.motivo)}</li>`).join("")}</ul>` : ""}
        <p style="margin:0"><b>Próximo da fila:</b> ${esc(atual?.nome || "-")}</p>
        ${membros.length > 1 ? `<button type="button" class="btn ghost" id="btnPularCorretor" style="margin-top:8px">Pular ${esc(atual?.nome || "esse corretor")}</button>` : ""}
        <div id="pularForm" hidden style="margin-top:10px">
          <div class="field"><label>Motivo do pulo (obrigatório)</label><input id="fMotivoPular" placeholder="Ex.: de férias, sem resposta em outro lead..."></div>
          <div style="display:flex;gap:8px">
            <button type="button" class="btn secondary" id="btnCancelarPular">Cancelar</button>
            <button type="button" class="btn primary" id="btnConfirmarPular">Confirmar pulo</button>
          </div>
        </div>
      </div>`;

    secao.querySelector("#btnPularCorretor")?.addEventListener("click", () => {
      secao.querySelector("#pularForm").hidden = false;
      secao.querySelector("#btnPularCorretor").hidden = true;
      secao.querySelector("#fMotivoPular").focus();
    });
    secao.querySelector("#btnCancelarPular")?.addEventListener("click", () => renderFilaSecao());
    secao.querySelector("#btnConfirmarPular")?.addEventListener("click", () => {
      const motivo = secao.querySelector("#fMotivoPular").value.trim();
      if (!motivo) { toast("Informe o motivo do pulo.", "warn"); return; }
      pulos.push({ id: atual.id, nome: atual.nome, motivo });
      renderFilaSecao();
    });
  }

  body.querySelector("#fFilaQualif").addEventListener("change", (e) => { filaId = e.target.value; pulos = []; renderFilaSecao(); });
  body.querySelector("#btnVoltarQualif").addEventListener("click", () => abrirDetalhesLead(lead, apoio));
  body.querySelector("#btnConfirmarQualif").addEventListener("click", async () => {
    const motivo = body.querySelector("#fMotivoQualif").value;
    if (!motivo) { toast("Selecione o motivo.", "warn"); return; }
    const fila = filaEscolhida();
    const corretor = corretorAtual();
    if (fila && !corretor) { toast("Esta fila não tem corretores — escolha outra ou remova a distribuição.", "warn"); return; }
    const me = getCurrentUser();
    const btn = body.querySelector("#btnConfirmarQualif");
    btn.disabled = true;
    try {
      const atualizado = await qualificarLead(lead.id, {
        motivo, observacoes: body.querySelector("#fObsQualif").value.trim(),
        usuarioId: me?.id, usuarioNome: me?.name,
        corretorId: corretor?.id, corretorNome: corretor?.nome,
        filaId: fila?.id, filaNome: fila?.nome, pulos,
      });
      if (fila) await avancarFila(fila.id, pulos.length);
      await apoio.onChanged();
      toast(fila ? "Lead qualificado e distribuído." : "Lead qualificado.", "ok");
      abrirDetalhesLead(atualizado, apoio);
    } catch (e) {
      toast("Erro: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

function abrirModalPerdido(lead, apoio) {
  const body = openModal("Marcar como perdido", `
    <div class="field"><label>Motivo</label><select id="fMotivoPerda">
      <option value="">Selecione...</option>
      ${MOTIVOS_PERDA.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}
    </select></div>
    <div class="field"><label>Detalhe (opcional)</label><textarea id="fDetalhePerda" rows="3"></textarea></div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnVoltarPerda">Voltar</button>
      <button type="button" class="btn danger" id="btnConfirmarPerda">Marcar como perdido</button>
    </div>
  `, { width: 480 });

  body.querySelector("#btnVoltarPerda").addEventListener("click", () => abrirDetalhesLead(lead, apoio));
  body.querySelector("#btnConfirmarPerda").addEventListener("click", async () => {
    const motivo = body.querySelector("#fMotivoPerda").value;
    if (!motivo) { toast("Selecione o motivo.", "warn"); return; }
    const me = getCurrentUser();
    const btn = body.querySelector("#btnConfirmarPerda");
    btn.disabled = true;
    try {
      const atualizado = await marcarPerdido(lead.id, {
        motivo, detalhe: body.querySelector("#fDetalhePerda").value.trim(),
        usuarioId: me?.id, usuarioNome: me?.name,
      });
      await apoio.onChanged();
      toast("Lead marcado como perdido.", "ok");
      abrirDetalhesLead(atualizado, apoio);
    } catch (e) {
      toast("Erro: " + e.message, "warn");
      btn.disabled = false;
    }
  });
}

function abrirModalHistorico(lead, apoio) {
  const timeline = [...(lead.timeline || [])].sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));
  const atividades = [...(lead.atividades || [])].sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")));

  const body = openModal(`Histórico — ${lead.leadNome}`, `
    <div class="grid cols2">
      <div>
        <h3 style="margin-top:0;font-size:14px">Timeline</h3>
        ${timeline.length ? timeline.map((t) => `<div class="card pad" style="margin-bottom:8px">
          <div class="kpi-delta">${fmtDateTime(t.criadoEm)}</div><div>${esc(t.texto)}</div>
        </div>`).join("") : `<p class="kpi-delta">Sem eventos.</p>`}
      </div>
      <div>
        <h3 style="margin-top:0;font-size:14px">Atividades registradas</h3>
        ${atividades.length ? atividades.map((a) => `<div class="card pad" style="margin-bottom:8px">
          <div class="kpi-delta">${esc(labelTipoAtividade(a.tipo))} — ${fmtDateTime(a.criadoEm)}</div>
          <div class="kpi-delta">${esc(a.usuarioNome || "-")}</div>
          ${a.resultado ? `<div><b>Resultado:</b> ${esc(a.resultado)}</div>` : ""}
          ${a.observacoes ? `<div>${esc(a.observacoes)}</div>` : ""}
        </div>`).join("") : `<p class="kpi-delta">Nenhuma atividade registrada.</p>`}
      </div>
    </div>
    <div class="actions">
      <button type="button" class="btn secondary" id="btnVoltarHist">Voltar</button>
      <button type="button" class="btn primary" id="btnFecharHist">Fechar</button>
    </div>
  `, { width: 760 });

  body.querySelector("#btnVoltarHist").addEventListener("click", () => abrirDetalhesLead(lead, apoio));
  body.querySelector("#btnFecharHist").addEventListener("click", closeModal);
}
