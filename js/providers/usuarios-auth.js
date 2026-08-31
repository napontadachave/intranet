/* =========================================================================
   Usuários — criação de conta no Firebase Authentication + redefinição
   de senha.

   A pedido seu: a tela de Usuários cadastra e-mail + senha temporária
   direto por aqui, sem precisar abrir o Firebase Console pra criar a
   conta de acesso.

   Por que uma SEGUNDA instância do Firebase: `createUserWithEmailAndPassword`
   do SDK do Firebase Auth loga automaticamente, NAQUELA instância, a
   conta que acabou de criar. Se usássemos a instância principal (a mesma
   que a pessoa administradora está logada), a sessão dela seria trocada
   pela do usuário novo no meio do cadastro — bem inconveniente. A
   instância secundária nasce (uma vez só, reaproveitada depois), cria a
   conta, desloga A SI MESMA em seguida, e nunca encosta na sessão
   principal (ver `js/firebase-config.js` — é o mesmo `firebaseConfig`,
   só que numa segunda "app" nomeada do SDK).

   Combinado com você: além de criar a conta com uma senha temporária, um
   botão de "Enviar redefinição de senha" (recurso pronto do Firebase, não
   precisa de servidor) deixa a própria pessoa escolher uma senha definitiva
   quando quiser — pela instância PRINCIPAL mesmo, já que
   `sendPasswordResetEmail` não loga ninguém, só dispara um e-mail. */

import { firebaseConfig, auth as authPrincipal } from "../firebase-config.js";

const NOME_APP_SECUNDARIO = "npc-usuarios-secundario";

function authSecundario() {
  const existente = (firebase.apps || []).find((a) => a.name === NOME_APP_SECUNDARIO);
  const app = existente || firebase.initializeApp(firebaseConfig, NOME_APP_SECUNDARIO);
  return firebase.auth(app);
}

/** Cria a conta de autenticação (e-mail + senha) sem afetar a sessão de
 *  quem está cadastrando. Devolve o uid gerado — é esse uid que vira o
 *  `id` do novo perfil em `users` (ver js/modules/usuarios.js), pra ficar
 *  casado com o login assim que a pessoa entrar pela primeira vez. */
export async function criarContaAutenticacao(email, senha) {
  const auth = authSecundario();
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, senha);
    return cred.user.uid;
  } finally {
    // Desloga a instância secundária dando certo ou não — ela não deve
    // ficar "logada" pendurada em memória depois de usada.
    try { await auth.signOut(); } catch (e) { /* noop */ }
  }
}

/** Gera uma senha temporária só como ponto de partida — o administrador
 *  pode digitar outra antes de salvar, e a pessoa pode trocá-la depois
 *  com o botão de redefinição de senha. */
export function gerarSenhaTemporaria() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let senha = "";
  for (let i = 0; i < 10; i++) senha += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return senha;
}

/** E-mail de redefinição de senha — não precisa de nenhum backend próprio
 *  e funciona pra qualquer e-mail já cadastrado no projeto, mesmo sem
 *  estar autenticado como essa pessoa. */
export async function enviarRedefinicaoSenha(email) {
  await authPrincipal.sendPasswordResetEmail(email);
}
