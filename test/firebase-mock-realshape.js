/* Mock que imita o FORMATO REAL do banco de produção: `users` como objeto
   chaveado por uid com campos em português, e `kanbanCards` como objeto
   chaveado (não array) — para provar que a normalização em schema.js
   resolve o "users.find is not a function" visto no teste real. */
(function () {
  let dbState = {
    users: {
      "uid-real-123": {
        nome: "Usuária Real", email: "teste@npc.com", ativo: true,
        perfil: "admin", permissoes: { admin: true },
      },
    },
    kanbanCards: {},
    kanbanColumns: [],
    imoveis: [],
    quickReplies: [],
  };
  const dbListeners = [];

  window.firebase = {
    initializeApp() {},
    auth: () => ({
      setPersistence: async () => {},
      onAuthStateChanged(cb) { window.__authCb = cb; },
      signInWithEmailAndPassword: async (email) => ({ user: { uid: "uid-real-123", email } }),
      signOut: async () => { window.__authCb && window.__authCb(null); },
    }),
    database: () => ({
      ref: () => ({
        on(event, cb) { dbListeners.push(cb); cb({ val: () => dbState }); },
        update: async (partial) => {
          Object.assign(dbState, partial);
          dbListeners.forEach((cb) => cb({ val: () => dbState }));
        },
      }),
    }),
    firestore: () => ({}),
  };
  window.firebase.auth.Auth = { Persistence: { SESSION: "session" } };
  window.__dbStateRef = () => dbState;
})();
