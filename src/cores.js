// Mapas de cor para o espectrograma. Os dois principais imitam o viridis e o magma:
// a luminância cresce sem parar do começo ao fim, então "mais claro" sempre quer dizer
// "mais forte", inclusive para quem não distingue bem as cores ou imprime em cinza.
// Cada mapa é uma lista de cores-âncora interpoladas em RGB linear.

export const MAPAS = {
  viridis: {
    nome: 'Viridis',
    ancoras: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#fde725'],
  },
  magma: {
    nome: 'Magma',
    ancoras: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'],
  },
  cinza: { nome: 'Cinza', ancoras: ['#000000', '#ffffff'] },
};

const paraLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const paraSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexLinear(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => paraLinear(c / 255));
}

// Tabela de n cores RGB (Uint8ClampedArray de 3n): a posição 0 é o mais fraco.
export function tabelaDeCores(nomeMapa, n = 256) {
  const mapa = MAPAS[nomeMapa] || MAPAS.magma;
  const ancoras = mapa.ancoras.map(hexLinear);
  const t = new Uint8ClampedArray(n * 3);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * (ancoras.length - 1);
    const k = Math.min(Math.floor(x), ancoras.length - 2);
    const f = x - k;
    for (let c = 0; c < 3; c++) {
      const v = ancoras[k][c] * (1 - f) + ancoras[k + 1][c] * f;
      t[3 * i + c] = Math.round(paraSrgb(v) * 255);
    }
  }
  return t;
}

// Luminância relativa (WCAG) de uma cor sRGB de 8 bits.
export function luminancia(r, g, b) {
  const [R, G, B] = [r, g, b].map((c) => paraLinear(c / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
