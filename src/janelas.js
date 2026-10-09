// Funções de janela. Cortar um trecho do sinal "seco" (janela retangular) cria bordas
// abruptas que espalham energia por todo o espectro (vazamento espectral). As janelas
// abaixo descem suavemente a zero nas pontas e trocam esse vazamento por um pico um
// pouco mais largo.
//
// Todas na forma periódica (DFT-even): w[n] para n = 0..N-1 com período N, a mais
// indicada para análise espectral (a forma simétrica usa N - 1 no denominador).

export const JANELAS = {
  hann: { nome: 'Hann', coef: [0.5, 0.5] },
  hamming: { nome: 'Hamming', coef: [0.54, 0.46] },
  blackman: { nome: 'Blackman', coef: [0.42, 0.5, 0.08] },
  retangular: { nome: 'Retangular', coef: [1] },
};

const cache = new Map();

// w[n] = a0 - a1·cos(2·pi·n/N) + a2·cos(4·pi·n/N)
export function janela(tipo, n) {
  const chave = `${tipo}:${n}`;
  if (cache.has(chave)) return cache.get(chave);
  const j = JANELAS[tipo];
  if (!j) throw new RangeError(`janela desconhecida: ${tipo}`);
  const w = new Float64Array(n);
  const [a0, a1 = 0, a2 = 0] = j.coef;
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / n;
    w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x);
  }
  // cos(2·pi·k) nem sempre dá exatamente 1 em ponto flutuante: zera o resíduo
  if (Math.abs(w[0]) < 1e-12) w[0] = 0;
  cache.set(chave, w);
  return w;
}

// Ganho coerente: a média da janela. Um seno de amplitude A aparece no espectro com
// altura A · N · ganho / 2, então dividir por isso devolve a amplitude real.
export function ganhoCoerente(w) {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return s / w.length;
}

// Largura de banda equivalente de ruído, em bins: N · soma(w²) / soma(w)². Mede quanto
// a janela alarga cada componente (1 na retangular, 1,5 na Hann).
export function larguraEquivalente(w) {
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i];
    s2 += w[i] * w[i];
  }
  return (w.length * s2) / (s * s);
}
