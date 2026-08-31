/* Mock que reproduz o cenário real: leitura da raiz falha com
   PERMISSION_DENIED enquanto ninguém está autenticado (regra comum do
   Realtime Database: `".read": "auth != null"`), e só funciona depois do
   login — exatamente para provar que o app se recupera desse caso. */
(function () {
  let authenticated = false;
  let dbState = {
    users: [{ id: "u1", name: "Usuária Teste", email: "teste@npc.com", active: true }],
    kanbanCards: [], kanbanColumns: [], imoveis: [], quickReplies: [],
  };
  const dbListeners = [];

  window.firebase = {
    initializeApp() {},
    auth: () => ({
      setPersistence: async () => {},
      onAuthStateChanged(cb) { window.__authCb = cb; },
      signInWithEmailAndPassword: async (email) => {
        authenticated = true;
        return { user: { uid: "u1", email } };
      },
      signOut: async () => { authenticated = false; window.__authCb && window.__authCb(null); },
    }),
    database: () => ({
      ref: () => ({
        on(event, successCb, errorCb) {
          dbListeners.push(successCb);
          if (!authenticated) {
            errorCb && errorCb(new Error("PERMISSION_DENIED: Permission denied"));
          } else {
            successCb({ val: () => dbState });
          }
        },
        update: async (partial) => {
          Object.assign(dbState, partial);
          dbListeners.forEach((cb) => cb({ val: () => dbState }));
        },
      }),
    }),
    firestore: () => ({}),
  };
  window.firebase.auth.Auth = { Persistence: { SESSION: "session" } };
})();
