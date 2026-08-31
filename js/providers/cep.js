/* =========================================================================
   Busca de endereço por CEP — usada no preenchimento dos "Dados do imóvel"
   da negociação, pra que o usuário só precise digitar o CEP e completar
   número/complemento (rua, bairro, cidade e estado vêm automaticamente).

   Usa a ViaCEP (https://viacep.com.br), API pública e gratuita, sem chave
   de acesso, já bastante usada em sistemas brasileiros para esse fim.
   ========================================================================= */

/** Consulta o CEP e devolve { logradouro, bairro, localidade, uf }.
 *  Devolve `null` quando o CEP é válido (8 dígitos) mas não existe na base
 *  dos Correios. Lança erro em caso de CEP mal formatado ou falha de rede/
 *  serviço fora do ar — quem chamar decide como avisar o usuário. */
export async function buscarEnderecoPorCEP(cepDigits) {
  const cep = String(cepDigits || "").replace(/\D/g, "");
  if (cep.length !== 8) throw new Error("CEP inválido — digite os 8 números.");

  let resp;
  try {
    resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  } catch (e) {
    throw new Error("Não foi possível consultar o CEP agora. Verifique sua conexão.");
  }
  if (!resp.ok) throw new Error("Não foi possível consultar o CEP agora.");

  const dados = await resp.json();
  if (dados.erro) return null;

  return {
    logradouro: dados.logradouro || "",
    bairro: dados.bairro || "",
    localidade: dados.localidade || "",
    uf: dados.uf || "",
  };
}
