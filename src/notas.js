// Frequência para nota musical (temperamento igual, Lá4 = 440 Hz por padrão).
// Cada semitom multiplica a frequência por 2^(1/12); um cent é 1/100 de semitom.

const NOMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
const CIFRAS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function nota(frequencia, la4 = 440) {
  if (!(frequencia > 0) || !(la4 > 0)) return null;
  // número MIDI contínuo: 69 é o Lá4, 60 é o Dó central
  const midi = 69 + 12 * Math.log2(frequencia / la4);
  const inteiro = Math.round(midi);
  const indice = ((inteiro % 12) + 12) % 12;
  const oitava = Math.floor(inteiro / 12) - 1;
  return {
    nome: NOMES[indice],
    cifra: CIFRAS[indice],
    oitava,
    midi: inteiro,
    cents: (midi - inteiro) * 100,
    alvo: la4 * 2 ** ((inteiro - 69) / 12),
  };
}

export function centsEntre(f, referencia) {
  return 1200 * Math.log2(f / referencia);
}
