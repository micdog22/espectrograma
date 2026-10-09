// Buffer circular de amostras com posições absolutas: o áudio chega em blocos pequenos
// (128 a 2048 amostras) e a análise lê janelas de N amostras que avançam de `salto` em
// `salto`, então as duas pontas andam em ritmos diferentes.
export class Anel {
  constructor(capacidade) {
    this.dados = new Float32Array(capacidade);
    this.capacidade = capacidade;
    this.total = 0; // amostras escritas desde o início
  }

  escrever(bloco) {
    let n = bloco.length;
    let origem = 0;
    if (n > this.capacidade) {
      // bloco maior que o anel: só o fim importa
      origem = n - this.capacidade;
      this.total += origem;
      n = this.capacidade;
    }
    const pos = this.total % this.capacidade;
    const primeiro = Math.min(n, this.capacidade - pos);
    this.dados.set(bloco.subarray(origem, origem + primeiro), pos);
    if (primeiro < n) this.dados.set(bloco.subarray(origem + primeiro, origem + n), 0);
    this.total += n;
  }

  // Copia as amostras [inicio, inicio + n) para destino. Devolve false se o trecho
  // ainda não chegou ou já foi sobrescrito.
  ler(inicio, n, destino) {
    if (inicio < 0 || inicio + n > this.total || inicio < this.total - this.capacidade || n > this.capacidade) {
      return false;
    }
    const pos = inicio % this.capacidade;
    const primeiro = Math.min(n, this.capacidade - pos);
    destino.set(this.dados.subarray(pos, pos + primeiro), 0);
    if (primeiro < n) destino.set(this.dados.subarray(0, n - primeiro), primeiro);
    return true;
  }

  limpar() {
    this.total = 0;
    this.dados.fill(0);
  }
}

// Início dos quadros de análise prontos para calcular, a partir de `proximo`.
// Se a análise ficou para trás mais do que o anel guarda, pula para o presente.
export function quadrosProntos(proximo, total, n, salto, capacidade, maximo = 512) {
  let p = proximo;
  if (total - p > capacidade - n) p = Math.max(0, total - n);
  const inicios = [];
  while (p + n <= total && inicios.length < maximo) {
    inicios.push(p);
    p += salto;
  }
  return { inicios, proximo: p };
}
