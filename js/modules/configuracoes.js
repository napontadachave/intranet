/* =========================================================================
   Configurações — painel administrativo com uma guia por tela de gestão.

   A pedido seu, esta é a nova "casa" das telas de gestão da Intranet 2.0:
   no sistema anterior, cada módulo tinha sua própria tela de gestão solta
   (ex.: "Cadências SDR" tinha a gestão de cadências dentro do próprio
   módulo). Aqui, todas ficam reunidas como guias de Configurações — a
   importação de planilhas da Análise 360° é uma guia, "Gestão de Cadências
   e Templates" (ver js/modules/config-cadencias.js) é outra, e as próximas
   telas de gestão que forem entrando seguem o mesmo padrão (só é preciso
   acrescentar um item em `TABS_CONFIG` abaixo e a função que desenha a
   guia).

   Simplificação consciente (mesmo espírito do que já está documentado em
   negociacoes.js): como o módulo de Permissões ainda não foi portado, o
   acesso a esta tela usa `isAdmin()` (auth.js) em vez de permissões
   dedicadas por guia (a v1.0 tinha, por exemplo, `analise360_upload`).
   Revisitar quando Permissões for portado.
   ========================================================================= */

import { getCurrentUser, isAdmin } from "../auth.js";
import { registerPage } from "../router.js";
import { toast, esc, fmtDateTime } from "../ui-kit.js";
import { ANALISE360_TIPOS, lerStatusAnalise360, importarPlanilhaAnalise360 } from "../providers/analise360-provider.js";
import { renderGestaoCadenciasTemplates } from "./config-cadencias.js";
import { renderGestaoFilas } from "./config-filas.js";
import { renderGestaoNotificacoes } from "./config-notificacoes.js";
import { renderAparenciaLogin } from "./config-aparencia.js";

const TABS_CONFIG = [
  { id: "importacao", label: "Importação de Dados", render: renderTabImportacao },
  { id: "cadencias", label: "Gestão de Cadências e Templates", render: renderGestaoCadenciasTemplates },
  { id: "filas", label: "Gestão de Filas", render: renderGestaoFilas },
  { id: "notificacoes", label: "Gestão de Notificações", render: renderGestaoNotificacoes },
  { id: "aparencia", label: "Aparência da Tela de Login", render: renderAparenciaLogin },
];

export function renderConfiguracoes(mount) {
  mount.innerHTML = `
    <div class="page-header">
      <div><h1>Configurações</h1><p>Ajustes gerais da intranet.</p></div>
    </div>
    <div id="configBody"></div>
  `;
  const body = mount.querySelector("#configBody");

  if (!isAdmin(getCurrentUser())) {
    body.innerHTML = `<div class="card pad empty-state"><b>Sem permissão</b><p>Esta área é restrita a administradores.</p></div>`;
    return;
  }

  let activeTab = TABS_CONFIG[0].id;
  let tabCleanup = null;

  function paintShell() {
    if (typeof tabCleanup === "function") { try { tabCleanup(); } catch (e) { console.error(e); } }
    tabCleanup = null;

    body.innerHTML = `
      <div class="tabs">
        ${TABS_CONFIG.map((t) => `<button data-ctab="${t.id}" class="${activeTab === t.id ? "active" : ""}">${esc(t.label)}</button>`).join("")}
      </div>
      <div id="configTabBody"></div>
    `;
    body.querySelectorAll("[data-ctab]").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.ctab; paintShell(); }));

    const tabBody = body.querySelector("#configTabBody");
    const tab = TABS_CONFIG.find((t) => t.id === activeTab);
    tabCleanup = tab.render(tabBody);
  }

  paintShell();
  return () => { if (typeof tabCleanup === "function") tabCleanup(); };
}

/** Guia "Importação de Dados" — segue o mesmo padrão síncrono das outras
 *  páginas da Intranet 2.0: pinta um estado de carregamento na hora e só
 *  troca pelo conteúdo real quando o status da Análise 360° chega, com uma
 *  guarda (`vivo`) contra escrever num mount que já foi trocado (troca de
 *  guia ou saída da tela) antes do carregamento terminar. */
function renderTabImportacao(mount) {
  let vivo = true;
  mount.innerHTML = `<div class="card pad">Carregando status...</div>`;
  (async () => {
    let status = {};
    try { status = await lerStatusAnalise360(); } catch (e) { console.error(e); }
    if (vivo) paintImportador(mount, status);
  })();
  return () => { vivo = false; };
}

function statusLinha(meta) {
  if (!meta) return `<p class="kpi-delta">Nenhuma planilha importada ainda.</p>`;
  return `<p class="kpi-delta">Última atualização: ${fmtDateTime(meta.atualizadoEm)}${meta.atualizadoPor ? " · " + esc(meta.atualizadoPor) : ""} · ${meta.totalItens ?? 0} ite${meta.totalItens === 1 ? "m" : "ns"}</p>`;
}

function paintImportador(body, status) {
  body.innerHTML = `
    <div class="card pad" style="margin-bottom:18px">
      <h2 style="margin:0 0 4px">Importar dados do Univen (Análise 360°)</h2>
      <p class="sub" style="margin:0">Envie os relatórios exportados do Univen (.xlsx/.xls). Cada arquivo novo
      substitui só a versão anterior do mesmo tipo — os outros três continuam como estavam. Os relatórios já
      trazem o histórico completo até a data da exportação, então cada envio é a versão mais atual e completa.</p>
    </div>
    <div class="card pad">
      <div class="grid cols2" id="a360Grid">
        ${ANALISE360_TIPOS.map((t) => `
          <div class="field" data-a360-campo="${t.id}">
            <label>${esc(t.label)}</label>
            <input type="file" id="a360File_${t.id}" accept=".xlsx,.xls">
            <div data-a360-status="${t.id}">${statusLinha(status[t.id])}</div>
          </div>`).join("")}
      </div>
      <div class="actions" style="margin-top:16px">
        <button type="button" class="btn primary" id="a360BtnProcessar">Processar e salvar</button>
      </div>
      <div id="a360Status" style="margin-top:14px"></div>
    </div>
  `;

  body.querySelector("#a360BtnProcessar").addEventListener("click", () => processarTudo(body));
}

async function processarTudo(body) {
  const btn = body.querySelector("#a360BtnProcessar");
  const statusEl = body.querySelector("#a360Status");
  const me = getCurrentUser();

  const etapas = ANALISE360_TIPOS
    .map((t) => ({ tipo: t, input: body.querySelector(`#a360File_${t.id}`) }))
    .filter((e) => e.input && e.input.files && e.input.files[0]);

  if (!etapas.length) { toast("Selecione pelo menos um arquivo para enviar.", "warn"); return; }

  btn.disabled = true;
  btn.textContent = "Processando...";
  statusEl.innerHTML = "";

  let erroEtapa = null;
  for (let i = 0; i < etapas.length; i++) {
    const { tipo, input } = etapas[i];
    statusEl.innerHTML = `<p class="kpi-delta">Gravando ${esc(tipo.label)} (${i + 1}/${etapas.length})...</p>`;
    try {
      const resultado = await importarPlanilhaAnalise360(tipo.id, input.files[0], { nome: me?.name || "" }, (feito, total) => {
        statusEl.innerHTML = `<p class="kpi-delta">Gravando ${esc(tipo.label)} (${i + 1}/${etapas.length}) — lote ${feito} de ${total}...</p>`;
      });
      const statusDiv = body.querySelector(`[data-a360-status="${tipo.id}"]`);
      if (statusDiv) statusDiv.innerHTML = statusLinha({ atualizadoEm: resultado.atualizadoEm, atualizadoPor: resultado.atualizadoPor, totalItens: resultado.totalItens });
      input.value = "";
    } catch (err) {
      erroEtapa = { tipo, erro: err };
      break;
    }
  }

  if (erroEtapa) {
    statusEl.innerHTML = `<p style="color:var(--vermelho);font-weight:700">Erro ao gravar ${esc(erroEtapa.tipo.label)}: ${esc(erroEtapa.erro.message || String(erroEtapa.erro))}. As planilhas anteriores desta mesma vez já foram salvas — basta reenviar a que faltou.</p>`;
    toast(`Erro ao gravar ${erroEtapa.tipo.label}.`, "warn");
  } else {
    statusEl.innerHTML = `<p style="color:var(--verde);font-weight:700">Dados salvos com sucesso.</p>`;
    toast("Dados salvos.", "ok");
  }

  btn.disabled = false;
  btn.textContent = "Processar e salvar";
}

registerPage("configuracoes", renderConfiguracoes);
