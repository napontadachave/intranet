/* =========================================================================
   NA PONTA DA CHAVE — Intranet 2.0 — Compatibilidade de esquema com o
   banco de dados de PRODUÇÃO já existente.

   Por que este arquivo existe:
   -----------------------------
   O sistema atual não guarda todas as coleções como array simples no
   Realtime Database. Em especial, `users` é salvo como um OBJETO
   (chave = uid do Firebase Auth, valor = dados em português: `nome`,
   `ativo`, `perfil`, `permissoes`, `dataAniversario`...), não como uma
   lista. Várias outras coleções (leads, kanbanCards, kanbanColumns,
   birthdays, agenda, comunicados, recognitions, auditLogs...) também
   podem chegar como objeto em vez de array, dependendo de como foram
   gravadas ao longo do tempo (o próprio sistema atual já tinha esse
   código defensivo espalhado — `Array.isArray(x) ? x : Object.values(x)`
   — em pelo menos 4 lugares diferentes do arquivo).

   Sem essa camada, `getSlice('users').find(...)` quebra com
   "users.find is not a function" sempre que o Firebase devolve um
   objeto em vez de array — foi exatamente o erro visto ao testar contra
   o banco de produção real.

   Este módulo centraliza essa conversão NUM SÓ LUGAR (em vez de espalhar
   `Array.isArray(...)` por todo módulo que lê dados), e também faz o
   caminho de volta para `users` — porque enquanto o sistema antigo ainda
   estiver em uso em paralelo durante a migração, esta intranet precisa
   continuar gravando usuários no MESMO formato que ele espera.
   ========================================================================= */

// Coleções que devem sempre virar array na leitura, mesmo que o Firebase
// devolva um objeto chaveado (comum quando os dados têm "buracos" ou foram
// gravados via push()). Escrita de volta é sempre como array puro — é
// assim que o sistema atual também grava essas mesmas chaves.
const ARRAY_COLLECTIONS = [
  "kanbanCards", "kanbanColumns", "kanbanComissaoOptions",
  "kanbanPosseOptions", "kanbanDocumentosOptions", "birthdays", "agenda",
  "comunicados", "recognitions", "auditLogs",
  "imoveis", "quickReplies",
  "locacaoPropostasColumns", "locacaoPropostasCards", "locacaoChecklistTemplate",
  "locacaoComissaoRegras", "locacaoKPIs", "locacaoRegistrosDiarios",
  "locacaoRegistrosAtendimento", "locacaoInfoUteis",
];
// "leads", "leadDistributionRules" e "leadQueueSkips" (Realtime Database)
// saíram desta lista: a tela de Atendimentos passou a gravar 100% no Cloud
// Firestore (ver js/providers/atendimentos-cadencia.js) — essas chaves do
// RTDB não têm mais nenhum leitor nesta versão.

function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === "object") return Object.values(v).filter(Boolean);
  return [];
}

/** Espelha `cloudUsersToArray` do sistema atual: users vem como objeto
 *  {uid: {nome, ativo, perfil, permissoes, ...}} e vira array em português->app. */
function cloudUsersToArray(usersObj) {
  if (!usersObj) return [];
  if (Array.isArray(usersObj)) return usersObj.filter(Boolean);
  return Object.entries(usersObj).map(([uid, u]) => {
    u = u || {};
    const perfil = String(u.perfil || u.role || "").toLowerCase();
    const roleText = perfil === "admin"
      ? "Administrador"
      : (u.role && u.role !== "admin" ? u.role : (u.cargo || u.funcao || "Colaborador"));
    const email = u.email || u.user || uid;
    return {
      id: u.id || uid,
      name: u.nome || u.name || email,
      user: email,
      email,
      role: roleText,
      perfil: u.perfil || u.role || "",
      birthday: u.birthday || u.dataAniversario || u.birthdate || "",
      active: u.ativo !== false && u.active !== false,
      mustChangePassword: u.mustChangePassword === true || u.status_senha === "nova",
      perms: u.permissoes || u.perms || {},
    };
  });
}

/** Caminho inverso — usado quando (no futuro) o módulo de Usuários salvar
 *  alterações, para não gravar num formato que o sistema atual não entenda. */
export function usersArrayToCloud(usersArr) {
  const out = {};
  (usersArr || []).forEach((u) => {
    if (!u.id) return;
    const isAdmin = u.role === "Administrador" || u.role === "admin" || u.perms?.admin;
    out[u.id] = {
      nome: u.name,
      email: u.email || u.user,
      perfil: isAdmin ? "admin" : (u.perfil || u.role || "colaborador"),
      role: isAdmin ? "admin" : u.role,
      birthday: u.birthday || "",
      dataAniversario: u.birthday || "",
      ativo: u.active !== false,
      mustChangePassword: u.mustChangePassword === true,
      status_senha: u.mustChangePassword === true ? "nova" : "alterada",
      permissoes: u.perms || {},
    };
  });
  return out;
}

/** Aplica na leitura: transforma o snapshot cru do Firebase no formato
 *  que os módulos desta intranet esperam (arrays de verdade). */
export function normalizeIncoming(raw) {
  const out = { ...raw };
  out.users = cloudUsersToArray(raw.users);
  ARRAY_COLLECTIONS.forEach((key) => {
    if (key in raw) out[key] = toArray(raw[key]);
  });
  return out;
}

/** Aplica na escrita: converte de volta os campos que precisam de um
 *  formato diferente no Firebase (hoje, só `users`). */
export function denormalizeForWrite(partial) {
  if (!("users" in partial)) return partial;
  return { ...partial, users: usersArrayToCloud(partial.users) };
}
