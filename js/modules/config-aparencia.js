/* =========================================================================
   Configurações → Aparência da Tela de Login.

   A pedido seu: a tela de login deixou de mostrar só logo + texto/
   estatísticas fixos — agora dá pra trocar por uma imagem de fundo no
   painel esquerdo (substitui o texto/estatísticas, não fica por cima) e
   trocar o logo que aparece acima do campo de e-mail, direto por aqui,
   sempre que quiser.

   Mesmo padrão de "escolher arquivo -> pré-visualizar -> Salvar" (sem
   listas nem editor separado, já que só existem essas duas imagens).
   Gravado no Realtime Database, num nó com leitura pública (ver
   js/providers/aparencia-login.js pro porquê) — ESTA guia continua exigindo
   administrador pra gravar, mesmo a leitura sendo pública. */

import { getCurrentUser } from "../auth.js";
import { toast } from "../ui-kit.js";
import { carregarAparenciaLogin, salvarAparenciaLogin, arquivoParaBase64, MAX_IMAGEM_BYTES } from "../providers/aparencia-login.js";

export function renderAparenciaLogin(mount) {
  let vivo = true;
  let atual = {};
  let pendente = {}; // só os campos trocados nesta sessão de edição, ainda não salvos

  async function carregar() {
    mount.innerHTML = `<div class="card pad">Carregando...</div>`;
    atual = await carregarAparenciaLogin();
    pendente = {};
    if (vivo) pintar();
  }

  function valorAtual(campo) {
    return campo in pendente ? pendente[campo] : atual[campo];
  }

  function pintar() {
    const logo = valorAtual("logoBase64");
    const fundo = valorAtual("backgroundBase64");
    const limiteMB = MAX_IMAGEM_BYTES / 1024 / 1024;

    mount.innerHTML = `
      <p class="kpi-delta" style="margin-bottom:14px;max-width:680px">
        A imagem de fundo substitui o texto/estatísticas do painel esquerdo da tela de login (a imagem ocupa o lugar deles, não fica por cima). O logo aparece acima do campo de e-mail. Tamanho máximo por imagem: ${limiteMB} MB.
      </p>
      <div class="grid cols2">
        <div class="card pad">
          <h3 style="margin-top:0">Logo (acima do e-mail)</h3>
          ${logo
            ? `<img src="${logo}" style="max-width:220px;display:block;margin-bottom:12px;border:1px solid var(--linha);border-radius:8px;background:#0d0e11;padding:10px">`
            : `<p class="kpi-delta">Usando o logo padrão da Na Ponta da Chave.</p>`}
          <input type="file" id="fLogo" accept="image/*">
          ${logo ? `<button type="button" class="btn ghost" id="btnRemoverLogo" style="margin-top:10px">Remover (voltar ao padrão)</button>` : ""}
        </div>
        <div class="card pad">
          <h3 style="margin-top:0">Imagem de fundo (painel esquerdo)</h3>
          ${fundo
            ? `<img src="${fundo}" style="max-width:100%;height:160px;width:100%;object-fit:cover;display:block;margin-bottom:12px;border:1px solid var(--linha);border-radius:8px">`
            : `<p class="kpi-delta">Usando o texto e as estatísticas padrão.</p>`}
          <input type="file" id="fFundo" accept="image/*">
          ${fundo ? `<button type="button" class="btn ghost" id="btnRemoverFundo" style="margin-top:10px">Remover (voltar ao padrão)</button>` : ""}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn primary" id="btnSalvarAparencia">Salvar</button>
      </div>
    `;

    mount.querySelector("#fLogo").addEventListener("change", (e) => onEscolherArquivo(e, "logoBase64"));
    mount.querySelector("#fFundo").addEventListener("change", (e) => onEscolherArquivo(e, "backgroundBase64"));
    mount.querySelector("#btnRemoverLogo")?.addEventListener("click", () => { pendente.logoBase64 = ""; pintar(); });
    mount.querySelector("#btnRemoverFundo")?.addEventListener("click", () => { pendente.backgroundBase64 = ""; pintar(); });
    mount.querySelector("#btnSalvarAparencia").addEventListener("click", salvar);
  }

  async function onEscolherArquivo(e, campo) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendente[campo] = await arquivoParaBase64(file);
      pintar();
    } catch (err) {
      toast(err.message, "warn");
      e.target.value = "";
    }
  }

  async function salvar() {
    const btn = mount.querySelector("#btnSalvarAparencia");
    btn.disabled = true;
    try {
      atual = await salvarAparenciaLogin(pendente, getCurrentUser()?.name);
      pendente = {};
      toast("Aparência da tela de login salva.", "ok");
      pintar();
    } catch (e) {
      toast("Erro ao salvar: " + (e.message || String(e)), "warn");
      btn.disabled = false;
    }
  }

  carregar();
  return () => { vivo = false; };
}
