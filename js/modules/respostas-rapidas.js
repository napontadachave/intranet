/* Respostas rápidas — modelos de mensagem reutilizáveis (comunicados
   internos ou respostas a leads/clientes), no espírito do Univen. */

import { subscribe, getSlice, patchKey } from "../sync.js";
import { registerPage } from "../router.js";
import { openModal, closeModal, toast, esc, uid } from "../ui-kit.js";

export function renderRespostasRapidas(mount) {
  function paint() {
    const templates = getSlice("quickReplies") || [];
    mount.innerHTML = `
      <div class="page-header">
        <div><h1>Respostas rápidas</h1><p>Modelos de mensagem prontos para agilizar contatos com leads, clientes e colaboradores.</p></div>
        <button class="btn primary" id="btnNovo">+ Novo modelo</button>
      </div>
      <div class="grid cols2">
        ${templates.length ? templates.map((t) => `
          <div class="card pad">
            <div style="display:flex;justify-content:space-between;gap:10px">
              <b>${esc(t.titulo)}</b>
              <div>
                <button class="btn ghost" data-copy="${t.id}" title="Copiar">Copiar</button>
                <button class="btn ghost" data-edit="${t.id}">Editar</button>
                <button class="btn ghost" data-del="${t.id}">Excluir</button>
              </div>
            </div>
            <p class="kpi-delta" style="white-space:pre-wrap">${esc(t.corpo)}</p>
          </div>`).join("") : `<div class="card pad empty-state"><b>Nenhum modelo cadastrado.</b>
            <p>Crie modelos para respostas frequentes — ex.: "Boas-vindas ao lead",
            "Confirmação de visita", "Envio de proposta".</p></div>`}
      </div>
    `;
    mount.querySelector("#btnNovo").addEventListener("click", () => openTemplateModal(null));
    mount.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openTemplateModal(b.dataset.edit)));
    mount.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteTemplate(b.dataset.del)));
    mount.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyTemplate(b.dataset.copy)));
  }
  paint();
  const unsub = subscribe("quickReplies", paint);
  return unsub;
}

function openTemplateModal(id) {
  const templates = getSlice("quickReplies") || [];
  const item = id ? templates.find((t) => t.id === id) : null;
  const body = openModal(item ? "Editar modelo" : "Novo modelo de resposta", `
    <div class="field"><label>Título</label><input id="fTitulo" value="${esc(item?.titulo || "")}" placeholder="Ex.: Boas-vindas ao lead"></div>
    <div class="field"><label>Mensagem</label>
      <textarea id="fCorpo" rows="6" placeholder="Use [[nome]] para o nome do contato, por exemplo.">${esc(item?.corpo || "")}</textarea>
    </div>
    <div class="actions">
      <button class="secondary" id="btnCancel">Cancelar</button>
      <button class="primary" id="btnSalvar">Salvar</button>
    </div>
  `);
  body.querySelector("#btnCancel").addEventListener("click", closeModal);
  body.querySelector("#btnSalvar").addEventListener("click", async () => {
    const titulo = body.querySelector("#fTitulo").value.trim();
    const corpo = body.querySelector("#fCorpo").value.trim();
    if (!titulo || !corpo) { toast("Preencha título e mensagem.", "warn"); return; }
    const payload = { id: item?.id || uid("qr"), titulo, corpo };
    const next = item ? templates.map((t) => (t.id === item.id ? payload : t)) : [...templates, payload];
    await patchKey("quickReplies", next);
    closeModal();
    toast("Modelo salvo.", "ok");
  });
}

async function deleteTemplate(id) {
  if (!confirm("Excluir este modelo?")) return;
  const next = (getSlice("quickReplies") || []).filter((t) => t.id !== id);
  await patchKey("quickReplies", next);
}

function copyTemplate(id) {
  const item = (getSlice("quickReplies") || []).find((t) => t.id === id);
  if (!item) return;
  navigator.clipboard?.writeText(item.corpo).then(
    () => toast("Mensagem copiada para a área de transferência.", "ok"),
    () => toast("Não foi possível copiar automaticamente.", "warn")
  );
}

registerPage("respostas_rapidas", renderRespostasRapidas);
