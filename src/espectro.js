// Do bloco de amostras ao espectro em decibéis, mais as contas de eixo e o pico.
import { fftReal } from './fft.js';
import { ganhoCoerente, janela } from './janelas.js';

export const PISO_DB = -200;

// 20·log10(amplitude), com piso para não devolver -Infinity no silêncio.
export function paraDb(amplitude, piso = PISO_DB) {
  return amplitude > 0 ? Math.max(piso, 20 * Math.log10(amplitude)) : piso;
}

// Espectro de amplitude em dBFS (0 dB = seno de amplitude 1) de um bloco de N amostras.
// Devolve N/2 + 1 valores, do bin 0 (contínuo) até N/2 (Nyquist).
export function espectroDb(amostras, tipoJanela) {
  const n = amostras.length;
  const w = janela(tipoJanela, n);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = amostras[i] * w[i];
  const { re, im } = fftReal(x);
  const escala = 2 / (n * ganhoCoerente(w));
  const db = new Float64Array(re.length);
  for (let k = 0; k < re.length; k++) {
    // contínuo e Nyquist não têm "metade negativa", então valem metade
    const fator = k === 0 || k === re.length - 1 ? escala / 2 : escala;
    db[k] = paraDb(Math.hypot(re[k], im[k]) * fator);
  }
  return db;
}

export function binParaFrequencia(k, taxa, n) {
  return (k * taxa) / n;
}

// Interpolação parabólica do pico: ajusta uma parábola nos três bins em torno do máximo
// (em dB, onde o pico de uma janela suave é quase uma parábola) e devolve o vértice.
//   delta = (a - c) / (2·(a - 2b + c)),  valor = b - (a - c)·delta / 4
export function interpolarPico(db, k) {
  if (k <= 0 || k >= db.length - 1) return { posicao: k, valor: db[k] };
  const a = db[k - 1];
  const b = db[k];
  const c = db[k + 1];
  const den = a - 2 * b + c;
  if (den >= 0) return { posicao: k, valor: b };
  const delta = (0.5 * (a - c)) / den;
  return { posicao: k + delta, valor: b - 0.25 * (a - c) * delta };
}

// Maior pico entre fMin e fMax, com frequência refinada pela parábola.
export function picoEspectral(db, taxa, n, fMin = 20, fMax = taxa / 2) {
  const k0 = Math.max(1, Math.ceil((fMin * n) / taxa));
  const k1 = Math.min(db.length - 2, Math.floor((fMax * n) / taxa));
  let melhor = -1;
  for (let k = k0; k <= k1; k++) if (melhor < 0 || db[k] > db[melhor]) melhor = k;
  if (melhor < 0) return null;
  const p = interpolarPico(db, melhor);
  return { frequencia: (p.posicao * taxa) / n, db: p.valor, bin: melhor };
}

// Frequência no centro da linha y de uma imagem com `altura` linhas (y = 0 no alto).
export function frequenciaDaLinha(y, altura, fMin, fMax, logaritmica) {
  const t = 1 - (y + 0.5) / altura;
  return logaritmica ? fMin * (fMax / fMin) ** t : fMin + (fMax - fMin) * t;
}

// Linha da imagem onde fica uma frequência (inverso da função acima, sem o meio pixel).
export function linhaDaFrequencia(f, altura, fMin, fMax, logaritmica) {
  const t = logaritmica ? Math.log(f / fMin) / Math.log(fMax / fMin) : (f - fMin) / (fMax - fMin);
  return (1 - t) * altura;
}

// Para cada linha da imagem, de que bins ela tira o valor. Onde vários bins caem numa
// linha (agudos na escala log), usa o maior deles; onde uma linha fica entre dois bins
// (graves), interpola.
export function mapaDeLinhas(altura, taxa, n, fMin, fMax, logaritmica) {
  const linhas = [];
  const binsPorHz = n / taxa;
  for (let y = 0; y < altura; y++) {
    const fCima = frequenciaDaLinha(y - 0.5, altura, fMin, fMax, logaritmica);
    const fBaixo = frequenciaDaLinha(y + 0.5, altura, fMin, fMax, logaritmica);
    const centro = frequenciaDaLinha(y, altura, fMin, fMax, logaritmica) * binsPorHz;
    const k0 = Math.ceil(fBaixo * binsPorHz);
    const k1 = Math.floor(fCima * binsPorHz);
    linhas.push(k1 >= k0 ? { tipo: 'max', k0, k1: Math.min(k1, n / 2) } : { tipo: 'interp', pos: Math.min(centro, n / 2) });
  }
  return linhas;
}

export function valorDaLinha(db, linha) {
  if (linha.tipo === 'max') {
    let m = -Infinity;
    for (let k = linha.k0; k <= linha.k1; k++) if (db[k] > m) m = db[k];
    return m;
  }
  const k = Math.floor(linha.pos);
  const f = linha.pos - k;
  return k + 1 < db.length ? db[k] * (1 - f) + db[k + 1] * f : db[k];
}
