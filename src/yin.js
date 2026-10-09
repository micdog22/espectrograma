// Detecção de altura (frequência fundamental) pelo algoritmo YIN, de Alain de
// Cheveigné e Hideki Kawahara (2002).
//
// A ideia: um som periódico se repete depois de um período T. Então, comparando o
// sinal com ele mesmo deslocado de tau amostras, a diferença
//
//   d(tau) = soma (x[j] - x[j + tau])²
//
// cai perto de zero quando tau = T (e em 2T, 3T...). O pico do espectro nem sempre é
// a fundamental (num violão, o segundo harmônico costuma ser mais forte), mas a
// periodicidade é: por isso o YIN trabalha no tempo.
//
// Passos do artigo implementados aqui:
//   1. função diferença d(tau);
//   2. diferença normalizada pela média acumulada: d'(tau) = d(tau) / ((1/tau)·soma d(1..tau)),
//      com d'(0) = 1. Ela tira a vantagem artificial dos tau pequenos;
//   3. limiar absoluto: o primeiro mínimo com d' abaixo do limiar (e não o mínimo
//      global), o que evita os erros de oitava para baixo;
//   4. interpolação parabólica de tau, para ter frações de amostra.

export function yin(x, taxa, { limiar = 0.15, fMin = 40, fMax = 2000 } = {}) {
  const n = x.length;
  const tauMax = Math.min(Math.floor(taxa / fMin), Math.floor(n / 2));
  const tauMin = Math.max(2, Math.floor(taxa / fMax));
  if (tauMax <= tauMin + 2) return null;
  const w = n - tauMax; // janela de integração
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const dif = x[j] - x[j + tau];
      s += dif * dif;
    }
    d[tau] = s;
  }
  // Silêncio: não há altura para medir.
  let energia = 0;
  for (let j = 0; j < w; j++) energia += x[j] * x[j];
  if (energia < 1e-10 * w) return null;

  const dn = new Float64Array(tauMax + 1);
  dn[0] = 1;
  let acumulado = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    acumulado += d[tau];
    dn[tau] = acumulado > 0 ? (d[tau] * tau) / acumulado : 1;
  }

  let tau = -1;
  for (let t = tauMin; t < tauMax; t++) {
    if (dn[t] < limiar) {
      while (t + 1 < tauMax && dn[t + 1] < dn[t]) t++; // desce até o fundo do vale
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;

  let refinado = tau;
  if (tau > 1 && tau < tauMax) {
    const a = dn[tau - 1];
    const b = dn[tau];
    const c = dn[tau + 1];
    const den = a - 2 * b + c;
    if (den > 0) refinado = tau + (0.5 * (a - c)) / den;
  }
  return { frequencia: taxa / refinado, periodo: refinado, confianca: 1 - dn[tau], dn };
}
