import { login } from "./auth.js";
import { toast } from "./ui-kit.js";
import { carregarAparenciaLogin } from "./providers/aparencia-login.js";

export function renderLogin(root) {
  root.innerHTML = `
    <div class="login">
      <div class="login-left" id="loginLeft">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="assets/logo.png" style="height:34px" alt="Na Ponta da Chave">
        </div>
        <div>
          <h1>Intranet 2.0</h1>
          <p>Uma casa só para os dados da nossa operação: atendimentos, negociações,
          imóveis, pessoas e resultados — tudo sincronizado em tempo real, sem
          surpresas.</p>
          <div class="login-kpis">
            <div><b>1</b>fonte de dados</div>
            <div><b>Tempo real</b>sincronização</div>
            <div><b>100%</b>seus dados</div>
          </div>
        </div>
        <p style="color:#8b8f99;font-size:12.5px">Na Ponta da Chave · Lares, memórias e conquistas</p>
      </div>
      <div class="login-panel">
        <div class="login-card">
          <img class="logo" id="loginLogo" src="assets/logo.png" alt="Na Ponta da Chave">
          <div class="field"><label>E-mail</label><input id="loginEmail" type="email" autocomplete="username"></div>
          <div class="field"><label>Senha</label><input id="loginPass" type="password" autocomplete="current-password"></div>
          <button class="btn-login" id="btnDoLogin">Entrar</button>
          <div class="login-error" id="loginError"></div>
        </div>
      </div>
    </div>
  `;

  // Aplica a aparência personalizada (Configurações → Aparência da Tela de
  // Login), se houver alguma configurada — feito DEPOIS de o HTML padrão
  // já estar na tela, pra ela nunca ficar em branco esperando essa leitura.
  // A imagem de fundo substitui o texto/estatísticas (não fica por cima) —
  // foi assim que você pediu ("uma imagem ao invés de dados").
  carregarAparenciaLogin().then((aparencia) => {
    if (aparencia.backgroundBase64) {
      const left = root.querySelector("#loginLeft");
      if (left) {
        left.style.backgroundImage = `url(${aparencia.backgroundBase64})`;
        left.style.backgroundSize = "cover";
        left.style.backgroundPosition = "center";
        left.innerHTML = "";
      }
    }
    if (aparencia.logoBase64) {
      const logoImg = root.querySelector("#loginLogo");
      if (logoImg) logoImg.src = aparencia.logoBase64;
    }
  });

  const doLogin = async () => {
    const email = root.querySelector("#loginEmail").value;
    const pass = root.querySelector("#loginPass").value;
    const errEl = root.querySelector("#loginError");
    errEl.textContent = "";
    try {
      await login(email, pass);
    } catch (e) {
      errEl.textContent = e.message || "Falha no login.";
      toast(errEl.textContent, "warn");
    }
  };

  root.querySelector("#btnDoLogin").addEventListener("click", doLogin);
  root.querySelectorAll("#loginEmail,#loginPass").forEach((el) =>
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); })
  );
}
