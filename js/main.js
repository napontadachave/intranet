/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0 — Ponto de entrada
   ========================================================================= */

import { startSync } from "./sync.js";
import { onAuthChange } from "./auth.js";
import { renderLogin } from "./login.js";
import { renderShell } from "./ui-shell.js";
import { startRouter } from "./router.js";

// Registro dos módulos de página (cada import roda registerPage(...)).
import "./modules/dashboard.js";
import "./modules/leads.js";
import "./modules/leads-distribuidos.js";
import "./modules/negociacoes.js";
import "./modules/respostas-rapidas.js";
import "./modules/configuracoes.js";
import "./modules/registros-diarios.js";
import "./modules/analise360.js";
import "./modules/usuarios.js";
import "./modules/permissoes.js";

const root = document.getElementById("app");
let routerStarted = false;

startSync();

onAuthChange((user) => {
  if (user) {
    renderShell(root);
    if (!routerStarted) {
      routerStarted = true;
      // A pedido seu: a primeira tela depois de logar é sempre a
      // Institucional — mesmo que o navegador ainda tenha um #hash de uma
      // página diferente guardado de antes de sair (o navegador não limpa
      // isso sozinho no logout). Força aqui, antes de o roteador ler o hash
      // pela primeira vez.
      location.hash = "institucional";
      startRouter();
    } else {
      location.hash && window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  } else {
    routerStarted = false;
    renderLogin(root);
  }
});
