/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0
   Configuração do Firebase.
   Mantém o MESMO projeto/base de dados do sistema atual, para não perder
   nenhum dado já existente. Só a forma de consumir os dados muda (ver sync.js).
   ========================================================================= */

export const firebaseConfig = {
  apiKey: "AIzaSyB3aeZvXA-u4IfVwbiOOCdPyQjuI-uihYI",
  authDomain: "intranet-npc.firebaseapp.com",
  databaseURL: "https://intranet-npc-default-rtdb.firebaseio.com",
  projectId: "intranet-npc",
  storageBucket: "intranet-npc.firebasestorage.app",
  messagingSenderId: "12695603264",
  appId: "1:12695603264:web:0872fbb7cd8317db6077a5",
  measurementId: "G-MSG3DS25B9"
};

// Inicialização única. Import este módulo uma única vez (em main.js) —
// todo o resto do app deve importar `db`, `auth`, `firestore` a partir
// daqui, nunca chamar firebase.initializeApp() de novo em outro arquivo.
// Essa regra sozinha já evita boa parte dos bugs "fantasma" do sistema
// antigo, onde módulos diferentes reexportavam window.firebaseDb às
// pressas porque um script não enxergava a instância criada por outro.
firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.database();
export const firestore = firebase.firestore();

try {
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
} catch (e) {
  console.error("Falha ao definir persistência de sessão:", e);
}
