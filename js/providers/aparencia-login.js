/* =========================================================================
   Aparência da tela de login — imagem de fundo do painel esquerdo (no
   lugar do texto/estatísticas) e logo acima do campo de e-mail,
   personalizáveis pela Configurações.

   Por que este provider lê direto do Realtime Database (`db`), sem passar
   pelo motor de sincronização de js/sync.js: a tela de login é a ÚNICA
   tela do sistema que roda ANTES de qualquer login. Nesse momento não há
   usuário autenticado ainda, e a regra da raiz "/" do banco exige
   autenticação pra leitura (é o mesmo PERMISSION_DENIED que você já viu
   antes em outra tela). Por isso as duas imagens ficam num nó PRÓPRIO
   (`loginAparencia`), fora da árvore que o resto do app sincroniza — e
   esse nó específico precisa de uma regra de LEITURA PÚBLICA (ver o bloco
   no README), diferente de todo o resto do banco que continua exigindo
   login. A escrita continua exigindo autenticação normalmente.

   Guardadas como base64 (texto), direto no Realtime Database — não usa
   Cloud Storage nem Cloud Firestore. Motivo: o Firestore tem limite de
   1 MB por documento (uma imagem em base64 sozinha já ocupa boa parte
   disso), e o Cloud Storage exigiria configurar mais um sistema de regras
   separado (diferente do RTDB/Firestore que você já usa). O Realtime
   Database aguenta numa boa os poucos MB que duas imagens comprimidas
   ocupam, e mantém tudo no MESMO banco e MESMO tipo de regra que o resto
   do app já usa. */

import { db } from "../firebase-config.js";

const CAMINHO = "loginAparencia";

/** Limite por imagem, no arquivo ORIGINAL (antes de virar base64 — que
 *  infla o tamanho em ~33%). Existe pra não deixar a tela de login lenta
 *  pra carregar (ela baixa isso ANTES do login, sem cache do motor de
 *  sincronização) nem pesar demais no Realtime Database. */
export const MAX_IMAGEM_BYTES = 2 * 1024 * 1024; // 2 MB

/** Lê as imagens configuradas — chamado pela tela de login, sem
 *  autenticação nenhuma. Se a leitura falhar (ex.: a regra de leitura
 *  pública ainda não foi adicionada) ou não houver nada configurado,
 *  devolve objeto vazio — a tela de login cai no visual padrão (logo +
 *  texto/estatísticas) sem quebrar nada. */
export async function carregarAparenciaLogin() {
  try {
    const snap = await db.ref(CAMINHO).once("value");
    return snap.val() || {};
  } catch (e) {
    console.error("Não foi possível carregar a aparência da tela de login:", e);
    return {};
  }
}

/** Grava — chamado só pela guia de Configurações (usuário já autenticado
 *  como administrador). Faz merge com o que já existia, pra trocar só uma
 *  das duas imagens sem apagar a outra; passar uma string vazia num campo
 *  remove aquela imagem (volta pro visual padrão). */
export async function salvarAparenciaLogin(parcial, autorNome) {
  const atual = await carregarAparenciaLogin();
  const novo = {
    ...atual,
    ...parcial,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: autorNome || "",
  };
  await db.ref(CAMINHO).set(novo);
  return novo;
}

/** Converte um arquivo escolhido num `<input type="file">` pra base64
 *  (mesmo padrão já usado nos anexos de Negociações) — rejeita antes de
 *  ler se o arquivo passar do limite. */
export function arquivoParaBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGEM_BYTES) {
      reject(new Error(`Imagem muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB) — o limite é ${MAX_IMAGEM_BYTES / 1024 / 1024} MB. Comprima ou redimensione antes de enviar.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
