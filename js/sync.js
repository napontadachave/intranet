/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0
   MOTOR DE SINCRONIZAÇÃO ÚNICO COM O FIREBASE.

   Por que este arquivo existe e por que ele é o coração do conserto:
   -----------------------------------------------------------------
   No sistema antigo (Intranet_91.html) havia DOIS mecanismos separados
   escutando firebaseDb.ref('/').on('value', ...) ao mesmo tempo — um
   chamado "global-realtime-sync" e outro "global-realtime-sync-v2" — cada
   um recarregando e redesenhando a tela por conta própria, sem
   coordenação entre si. Havia também um listener de "click" no
   documento inteiro que, a cada clique em QUALQUER lugar da tela,
   recarregava o banco inteiro de novo "só por garantia". O resultado:
   corridas de renderização, telas piscando e, ocasionalmente, dados
   incompletos aparecendo por uma fração de segundo — exatamente o
   "problema nos dados" relatado.

   A correção não é "escutar melhor" — é ter *uma única* fonte de verdade
   e um único caminho de atualização:

     1) Um único listener no Firebase.
     2) Mudanças remotas chegam e atualizam um objeto de estado local.
     3) Avisamos só quem realmente se inscreveu em cada "fatia" do estado
        que mudou (pub/sub por chave), em vez de redesenhar a aplicação
        inteira a cada evento.
     4) Escritas otimistas: quando o próprio usuário salva algo, a tela já
        atualiza local e imediatamente — não esperamos o Firebase "ecoar"
        de volta para o usuário ver o resultado do que ele acabou de fazer.
   ========================================================================= */

import { db } from "./firebase-config.js";
import { normalizeIncoming, denormalizeForWrite } from "./schema.js";

const state = Object.create(null); // espelho local da árvore inteira do RTDB
const listeners = new Map();       // chave (ex.: "leads") -> Set(callbacks)
const wildcardListeners = new Set(); // callbacks chamados em qualquer mudança
let ready = false;
let firstSnapshotResolvers = [];

function notify(changedKeys) {
  changedKeys.forEach((key) => {
    const subs = listeners.get(key);
    if (subs) subs.forEach((cb) => { try { cb(state[key]); } catch (e) { console.error(e); } });
  });
  wildcardListeners.forEach((cb) => { try { cb(state, changedKeys); } catch (e) { console.error(e); } });
}

function shallowEqual(a, b) {
  // Comparação rasa por JSON é suficiente aqui: os "documentos" trocados
  // (arrays de leads, cards, etc.) não são enormes o bastante para pesar,
  // e o ganho de só re-renderizar o que mudou é o que resolve o "piscar".
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; }
}

let installed = false;
const syncErrorCallbacks = new Set();

/** Avisa a UI (ex.: tela de login) quando a sincronização falha por permissão. */
export function onSyncError(cb) {
  syncErrorCallbacks.add(cb);
  return () => syncErrorCallbacks.delete(cb);
}

export function startSync() {
  if (installed) return; // evita instalar duas vezes enquanto já está de pé
  installed = true;

  db.ref("/").on("value", (snap) => {
    // normaliza o formato cru do Firebase (ver schema.js) antes de qualquer
    // outra coisa — é isso que evita "users.find is not a function" quando
    // o banco de produção guarda `users` (e outras coleções) como objeto
    // chaveado em vez de array.
    const incoming = normalizeIncoming(snap.val() || {});
    const changedKeys = new Set();

    // chaves novas ou alteradas
    Object.keys(incoming).forEach((key) => {
      if (!shallowEqual(state[key], incoming[key])) changedKeys.add(key);
    });
    // chaves removidas
    Object.keys(state).forEach((key) => {
      if (!(key in incoming)) changedKeys.add(key);
    });

    // substitui o espelho local por completo (é a árvore inteira do RTDB,
    // então não há merge parcial a fazer aqui — só nas escritas, ver `patch`)
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, incoming);

    if (!ready) {
      ready = true;
      firstSnapshotResolvers.forEach((r) => r());
      firstSnapshotResolvers = [];
    }
    if (changedKeys.size) notify(changedKeys);
  }, (err) => {
    // Motivo mais comum: as regras do Realtime Database exigem usuário
    // autenticado para ler a raiz ("/"), e esta chamada aconteceu antes do
    // login (ex.: no boot do app, com ninguém autenticado ainda). Nesse
    // caso o listener morre com PERMISSION_DENIED e NÃO se reconecta
    // sozinho quando o login acontece depois — por isso liberamos
    // `installed` aqui, para que auth.js possa chamar startSync() de novo
    // assim que tivermos um usuário autenticado.
    console.error("Falha na sincronização com o Firebase:", err);
    installed = false;
    syncErrorCallbacks.forEach((cb) => { try { cb(err); } catch (e) { /* noop */ } });
  });
}

/** Resolve assim que o primeiro snapshot já tiver chegado (útil no boot). */
export function whenReady() {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => firstSnapshotResolvers.push(resolve));
}

/** Leitura síncrona da fatia atual (ex.: getSlice('leads') -> array). */
export function getSlice(key) {
  return state[key];
}

/** Leitura da árvore inteira (uso pontual — prefira getSlice/subscribe). */
export function getAll() {
  return state;
}

/**
 * Inscreve um callback para ser chamado sempre que `key` mudar
 * (localmente ou vindo de outro usuário). Retorna a função de unsubscribe.
 * Um módulo de UI deve chamar isso uma vez ao montar a página e desinscrever
 * ao trocar de página — assim só quem está na tela relevante re-renderiza.
 */
export function subscribe(key, cb) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(cb);
  return () => listeners.get(key)?.delete(cb);
}

/** Inscrição "ouve tudo" — use com moderação (ex.: indicador global de sync). */
export function subscribeAll(cb) {
  wildcardListeners.add(cb);
  return () => wildcardListeners.delete(cb);
}

/**
 * Grava uma fatia no Firebase de forma otimista: atualiza o espelho local
 * e notifica antes de a escrita remota confirmar, então envia o update real.
 * Isso é o que faz a tela responder na hora quando o próprio usuário salva
 * algo, sem esperar o round-trip do servidor.
 */
export async function patch(partial) {
  const changedKeys = new Set(Object.keys(partial));
  Object.assign(state, partial); // espelho local fica no formato "normalizado" (arrays)
  notify(changedKeys);
  try {
    // ...mas a gravação no Firebase usa o formato que o banco de produção
    // (e o sistema atual, enquanto ainda estiver em uso) espera — hoje
    // isso só afeta `users` (ver schema.js).
    await db.ref("/").update(denormalizeForWrite(partial));
  } catch (e) {
    console.error("Erro ao salvar no Firebase:", e);
    throw e;
  }
}

/** Atalho para dar patch em uma única chave (o caso mais comum). */
export function patchKey(key, value) {
  return patch({ [key]: value });
}
