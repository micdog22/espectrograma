// FFT iterativa de raiz 2 (Cooley e Tukey), feita do zero.
//
// A DFT de tamanho N custa N² multiplicações. A FFT divide o problema ao meio a cada
// etapa: a DFT de N pontos vira duas de N/2 (índices pares e ímpares) combinadas por
// "borboletas":
//
//   X[k]       = P[k] + W^k · I[k]
//   X[k + N/2] = P[k] - W^k · I[k]        com W = e^(-2·pi·i/N)
//
// Feito de forma iterativa: primeiro os dados são reordenados pela inversão dos bits do
// índice e depois vêm log2(N) etapas de borboletas, de tamanho 2, 4, 8... até N.

const planos = new Map();

export function ehPotenciaDe2(n) {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

// Tabelas que só dependem de N: inversão de bits e fatores de giro (cos e sen).
function plano(n) {
  let p = planos.get(n);
  if (p) return p;
  if (!ehPotenciaDe2(n)) throw new RangeError('o tamanho da FFT precisa ser uma potência de 2');
  const bits = Math.round(Math.log2(n));
  const inverso = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    inverso[i] = r;
  }
  const meio = n >> 1;
  const cos = new Float64Array(Math.max(1, meio));
  const sen = new Float64Array(Math.max(1, meio));
  for (let k = 0; k < meio; k++) {
    // calculado direto (sem recorrência) para não acumular erro
    const a = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(a);
    sen[k] = Math.sin(a);
  }
  p = { n, inverso, cos, sen };
  planos.set(n, p);
  return p;
}

// FFT complexa no lugar: re e im (mesmo tamanho, potência de 2) viram o espectro.
// Com inversa = true calcula a transformada inversa (já dividida por N).
export function fft(re, im, inversa = false) {
  const n = re.length;
  if (im.length !== n) throw new RangeError('re e im precisam ter o mesmo tamanho');
  const { inverso, cos, sen } = plano(n);
  for (let i = 0; i < n; i++) {
    const j = inverso[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sinal = inversa ? -1 : 1;
  for (let tam = 2; tam <= n; tam <<= 1) {
    const meio = tam >> 1;
    const passo = n / tam;
    for (let inicio = 0; inicio < n; inicio += tam) {
      for (let j = 0, k = 0; j < meio; j++, k += passo) {
        const wr = cos[k];
        const wi = sinal * sen[k];
        const a = inicio + j;
        const b = a + meio;
        // borboleta: t = W^k · x[b]; x[a], x[b] = x[a] + t, x[a] - t
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inversa) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// FFT de um sinal real de N pontos usando uma FFT complexa de N/2: as amostras pares
// viram a parte real e as ímpares a imaginária, e depois o espectro é "desembaralhado".
// Devolve as N/2 + 1 frequências não negativas (as outras são conjugadas destas).
export function fftReal(x) {
  const n = x.length;
  if (n === 1) return { re: Float64Array.of(x[0]), im: Float64Array.of(0) };
  if (!ehPotenciaDe2(n)) throw new RangeError('o tamanho da FFT precisa ser uma potência de 2');
  const m = n >> 1;
  const zr = new Float64Array(m);
  const zi = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    zr[k] = x[2 * k];
    zi[k] = x[2 * k + 1];
  }
  fft(zr, zi);
  const re = new Float64Array(m + 1);
  const im = new Float64Array(m + 1);
  for (let k = 0; k <= m; k++) {
    const a = k % m;
    const b = (m - k) % m;
    // Par E[k] = (Z[k] + conj(Z[m - k])) / 2; ímpar O[k] = (Z[k] - conj(Z[m - k])) / 2i
    const er = (zr[a] + zr[b]) / 2;
    const ei = (zi[a] - zi[b]) / 2;
    const or = (zi[a] + zi[b]) / 2;
    const oi = -(zr[a] - zr[b]) / 2;
    const ang = (-2 * Math.PI * k) / n;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    re[k] = er + (or * wr - oi * wi);
    im[k] = ei + (or * wi + oi * wr);
  }
  return { re, im };
}

// DFT direta, O(N²): só para conferir a FFT nos testes.
export function dftIngenua(re, im) {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      // ângulo reduzido módulo n para manter cos e sen precisos
      const a = (-2 * Math.PI * ((k * t) % n)) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}
