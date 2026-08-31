/* Mock mínimo do SDK compat do Firebase, só para testar localmente que
   o resto do app (sync/auth/router/módulos) carrega e roda sem erros,
   sem precisar de rede nem de credenciais reais. NÃO faz parte do
   app entregue — é só uma ferramenta de verificação. */
(function () {
  let dbState = {
    users: [{ id: "u1", name: "Usuária Teste", email: "teste@npc.com", active: true, perms: { admin: true } }],
    kanbanCards: [],
    kanbanColumns: [],
    imoveis: [],
    quickReplies: [],
  };
  const dbListeners = [];
  const firestoreCollections = {}; // fora do factory, como dbState — o SDK real também devolve sempre a mesma instância
  // Nós fora da árvore raiz (ex.: "loginAparencia") — telas que rodam ANTES
  // do login leem/gravam um nó próprio em vez da raiz "/", já que a raiz
  // simula exigir autenticação. Guardado à parte de dbState de propósito.
  const dbNamedNodes = {};

  window.firebase = {
    apps: [],
    // Suporta uma segunda "app" nomeada (ver js/providers/usuarios-auth.js
    // — criação de usuário sem derrubar a sessão de quem está logado). O
    // SDK real lança erro se initializeApp for chamado duas vezes com o
    // mesmo nome; aqui só registramos em `apps` pra o provider poder achar
    // a instância já criada em vez de tentar recriá-la.
    initializeApp(config, name) {
      const app = { name: name || "[DEFAULT]", options: config };
      window.firebase.apps.push(app);
      return app;
    },
    auth(app) {
      const nome = app && app.name ? app.name : "[DEFAULT]";
      if (nome !== "[DEFAULT]") {
        // Instância secundária: totalmente isolada da sessão principal —
        // só existe pra simular "criar conta nova sem logar como ela".
        return {
          createUserWithEmailAndPassword: async (email, senha) => {
            const uid = "auth_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            window.__contasCriadasSecundarias = window.__contasCriadasSecundarias || [];
            window.__contasCriadasSecundarias.push({ uid, email, senha });
            return { user: { uid, email } };
          },
          signOut: async () => {},
        };
      }
      return {
        setPersistence: async () => {},
        onAuthStateChanged(cb) { window.__authCb = cb; },
        signInWithEmailAndPassword: async (email) => ({ user: { uid: "u1", email } }),
        signOut: async () => { window.__authCb && window.__authCb(null); },
        sendPasswordResetEmail: async (email) => {
          window.__passwordResetsSent = window.__passwordResetsSent || [];
          window.__passwordResetsSent.push(email);
        },
      };
    },
    database: () => ({
      // `path` vazio/"/" continua sendo a árvore principal (sync.js). Um
      // path específico (ex.: "loginAparencia") vira um nó isolado, só com
      // once/set — o suficiente pro provider de aparência da tela de login,
      // que roda antes de qualquer autenticação e não usa `on`/`update`.
      ref: (path) => {
        if (!path || path === "/") {
          return {
            on(event, cb) {
              dbListeners.push(cb);
              cb({ val: () => dbState });
            },
            update: async (partial) => {
              Object.assign(dbState, partial);
              dbListeners.forEach((cb) => cb({ val: () => dbState }));
            },
          };
        }
        return {
          once: async () => ({ val: () => (Object.prototype.hasOwnProperty.call(dbNamedNodes, path) ? dbNamedNodes[path] : null) }),
          set: async (value) => { dbNamedNodes[path] = value; },
        };
      },
    }),
    firestore: () => {
      function collection(name) {
        if (!firestoreCollections[name]) firestoreCollections[name] = {};
        const col = firestoreCollections[name];
        // Gancho só de teste: `window.__forcarErroFirestore` (array de nomes
        // de coleção) simula "permissão negada" numa coleção específica,
        // pra testar sem precisar de um projeto Firebase real com regras
        // restritivas — usado por pw_analise360_erro.js.
        const erroForcado = () => (window.__forcarErroFirestore || []).indexOf(name) >= 0;
        return {
          doc(id) {
            return {
              id,
              async get() {
                const exists = Object.prototype.hasOwnProperty.call(col, id);
                return { exists, id, data: () => col[id] };
              },
              async set(data) { col[id] = data; },
              async delete() { delete col[id]; },
              _write(data) { col[id] = data; },
              _erase() { delete col[id]; },
            };
          },
          async get() {
            if (erroForcado()) { const err = new Error("Missing or insufficient permissions."); err.code = "permission-denied"; throw err; }
            return { docs: Object.keys(col).map((id) => ({ id, data: () => col[id] })) };
          },
          async add(data) {
            const id = "auto_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            col[id] = data;
            return { id, _write(d) { col[id] = d; }, _erase() { delete col[id]; } };
          },
        };
      }
      return {
        collection,
        batch() {
          const ops = [];
          return {
            set(ref, data) { ops.push(() => ref._write(data)); },
            delete(ref) { ops.push(() => ref._erase()); },
            async commit() { ops.forEach((fn) => fn()); },
          };
        },
      };
    },
  };
  window.firebase.auth.Auth = { Persistence: { SESSION: "session" } };
})();
