// AudioWorklet que entrega as amostras cruas para a página. Roda na thread de áudio e
// recebe blocos de 128 amostras; junta 1024 (mistura os canais em mono) e manda pela
// porta de mensagens, transferindo o buffer em vez de copiar.
class ColetorDeAmostras extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tamanho = 1024;
    this.buffer = new Float32Array(this.tamanho);
    this.pos = 0;
  }

  process(inputs) {
    const entrada = inputs[0];
    if (entrada && entrada.length > 0) {
      const canais = entrada.length;
      const n = entrada[0].length;
      for (let i = 0; i < n; i++) {
        let soma = 0;
        for (let c = 0; c < canais; c++) soma += entrada[c][i];
        this.buffer[this.pos++] = soma / canais;
        if (this.pos === this.tamanho) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.tamanho);
          this.pos = 0;
        }
      }
    }
    return true; // continua vivo mesmo sem entrada
  }
}

registerProcessor('coletor-de-amostras', ColetorDeAmostras);
