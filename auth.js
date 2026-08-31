/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0 — Autenticação
   Mesma regra do sistema atual (compatível com os usuários já cadastrados):
     1) Login por e-mail/senha no Firebase Auth.
     2) O perfil "de verdade" (nome, cargo, permissões, ativo/inativo) mora
        em db.users, casado pelo campo `id` = uid do Firebase Auth.
     3) Sem cadastro interno ativo -> acesso negado mesmo com login válido.
   ========================================================================= */

import { auth } from "./firebase-config.js";
import { getSlice, subscribe, whenReady, startSync } from "./sync.js";

/** Resolve `whenReady()` ou rejeita depois de `ms` — evita ficar pendurado
 *  para sempre num login se a sincronização não conseguir carregar os dados
 *  (ex.: regra de acesso do Firebase bloqueando por algum motivo). */
function whenReadyOrTimeout(ms = 12000) {
  return Promise.race([
    whenReady(),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("Não foi possível carregar os dados a tempo. Verifique sua conexão ou as regras de acesso do Firebase e tente novamente.")),
      ms
    )),
  ]);
}

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_EVENTS = ["click", "mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];

let currentUser = null;
let idleTimer = null;
const authChangeCallbacks = new Set();

export function onAuthChange(cb) {
  authChangeCallbacks.add(cb);
  cb(currentUser); // dispara já com o estado atual (null = mostra login)
  return () => authChangeCallbacks.delete(cb);
}

function emitAuthChange() {
  authChangeCallbacks.forEach((cb) => { try { cb(currentUser); } catch (e) { console.error(e); } });
}

export function getCurrentUser() {
  return currentUser;
}

/** Diz se um usuário é administrador, aceitando tanto o formato novo
 *  (`perms.admin`, granular, pensado para o futuro módulo de Permissões)
 *  quanto o formato que o cadastro atual já usa em produção pra marcar
 *  admin — o campo de texto `perfil`/`role` valendo "admin"/"Administrador"
 *  (ver `cloudUsersToArray` em schema.js). Sem isso, alguém que é admin
 *  pelo cadastro de sempre, mas nunca teve um `permissoes.admin: true`
 *  gravado à parte no banco, ficaria bloqueado das telas restritas a
 *  admin (foi o que aconteceu ao testar a tela de Configurações). */
export function isAdmin(user) {
  const u = user || currentUser;
  if (!u) return false;
  if (u.perms?.admin) return true;
  const perfil = String(u.perfil || u.role || "").trim().toLowerCase();
  return perfil === "admin" || perfil === "administrador";
}

function findProfile(uid) {
  const users = getSlice("users") || [];
  return users.find((u) => u.id === uid && u.active !== false) || null;
}

export async function login(email, password) {
  email = String(email || "").trim().toLowerCase();
  if (!email || !password) throw new Error("Informe e-mail e senha.");
  const cred = await auth.signInWithEmailAndPassword(email, password);
  // Reativa a sincronização agora que há um usuário autenticado: se a
  // primeira tentativa (no boot do app, sem ninguém logado) tiver morrido
  // por PERMISSION_DENIED, startSync() está livre para tentar de novo.
  startSync();
  await whenReadyOrTimeout();
  const profile = findProfile(cred.user.uid);
  if (!profile) {
    await auth.signOut();
    throw new Error("Usuário autenticado, mas sem cadastro interno ativo no banco.");
  }
  currentUser = profile;
  startIdleMonitor();
  emitAuthChange();
  return profile;
}

export async function logout(reason) {
  stopIdleMonitor();
  try { await auth.signOut(); } catch (e) { /* noop */ }
  currentUser = null;
  emitAuthChange();
  return reason;
}

function startIdleMonitor() {
  stopIdleMonitor();
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => logout("idle"), IDLE_TIMEOUT_MS);
  };
  IDLE_EVENTS.forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
  reset();
  stopIdleMonitor._cleanup = () => IDLE_EVENTS.forEach((ev) => document.removeEventListener(ev, reset));
}
function stopIdleMonitor() {
  clearTimeout(idleTimer);
  if (stopIdleMonitor._cleanup) { stopIdleMonitor._cleanup(); stopIdleMonitor._cleanup = null; }
}

// Reage a mudanças de sessão do Firebase Auth (ex.: token expirado em outra aba).
auth.onAuthStateChanged(async (user) => {
  if (user && !currentUser) {
    startSync();
    try {
      await whenReadyOrTimeout();
    } catch (e) {
      console.error(e);
      return;
    }
    const profile = findProfile(user.uid);
    if (profile) { currentUser = profile; startIdleMonitor(); emitAuthChange(); }
  } else if (!user && currentUser) {
    currentUser = null;
    emitAuthChange();
  }
});

// Se o cadastro do usuário logado mudar (ex.: um admin desativou a conta
// dele em outra sessão), refletimos isso imediatamente em vez de deixar
// a tela com dados velhos.
subscribe("users", (users) => {
  if (!currentUser) return;
  const updated = (users || []).find((u) => u.id === currentUser.id);
  if (!updated || updated.active === false) {
    logout("revoked");
  } else if (JSON.stringify(updated) !== JSON.stringify(currentUser)) {
    currentUser = updated;
    emitAuthChange();
  }
});
