import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPAS, luminancia, tabelaDeCores } from '../src/cores.js';

test('as tabelas começam e terminam nas âncoras', () => {
  const v = tabelaDeCores('viridis', 256);
  assert.equal(v.length, 768);
  assert.deepEqual([...v.slice(0, 3)], [0x44, 0x01, 0x54]);
  assert.deepEqual([...v.slice(765)], [0xfd, 0xe7, 0x25]);
  const m = tabelaDeCores('magma', 64);
  assert.deepEqual([...m.slice(0, 3)], [0, 0, 4]);
  assert.deepEqual([...m.slice(189)], [0xfc, 0xfd, 0xbf]);
  // mapa desconhecido cai no magma
  assert.deepEqual([...tabelaDeCores('xyz', 64)], [...m]);
});

test('a luminância cresce sempre (mais claro = mais forte)', () => {
  for (const nome of Object.keys(MAPAS)) {
    // as âncoras sobem estritamente...
    const lum = MAPAS[nome].ancoras.map((h) => {
      const v = parseInt(h.slice(1), 16);
      return luminancia((v >> 16) & 255, (v >> 8) & 255, v & 255);
    });
    for (let i = 1; i < lum.length; i++) assert.ok(lum[i] > lum[i - 1], `${nome}: âncora ${i}`);
    // ...e a tabela de 8 bits só oscila no arredondamento
    const t = tabelaDeCores(nome, 256);
    let anterior = -1;
    for (let i = 0; i < 256; i++) {
      const l = luminancia(t[3 * i], t[3 * i + 1], t[3 * i + 2]);
      assert.ok(l >= anterior - 0.001, `${nome} em ${i}`);
      anterior = Math.max(anterior, l);
    }
  }
  assert.equal(luminancia(255, 255, 255), 1);
  assert.equal(luminancia(0, 0, 0), 0);
});
