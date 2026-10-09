# Espectrograma

Veja o som em tempo real: um espectrograma rolante do microfone ou de um arquivo de áudio, com a FFT escrita do zero (nada de `AnalyserNode`), janelas, escala logarítmica, pico com interpolação parabólica e um afinador que usa o algoritmo YIN. Feito para quem quer entender como a análise de áudio funciona por dentro.

**Acesse online:** https://micdog22.github.io/espectrograma/

## Recursos

- **Entradas**: microfone (com tela de permissão e mensagens claras para permissão negada, microfone ausente ou ocupado), arquivo de áudio (qualquer formato que o navegador decodifique) e um gerador de teste com tom fixo (senoide, quadrada, dente de serra, triangular) ou varredura de 50 Hz a 12 kHz.
- **Amostras cruas** por um AudioWorklet próprio, com `ScriptProcessorNode` como reserva em navegadores sem worklet.
- **FFT iterativa de raiz 2** feita à mão, com o truque da FFT real de N pontos calculada por uma complexa de N/2.
- **Janelas** Hann, Hamming, Blackman e retangular; tamanho da FFT de 256 a 16384; sobreposição de 0%, 50%, 75% ou 87,5%.
- **Espectrograma rolante** em canvas: frequência linear ou logarítmica, escala em dBFS com piso e teto ajustáveis, mapas de cor próprios no estilo viridis e magma (e cinza). Mudar cores ou faixa repinta todo o histórico na hora.
- **Espectro do último quadro**, com retenção de picos que cai devagar.
- **Pico** com frequência e altura refinadas por interpolação parabólica.
- **Afinador**: nota (Dó, Ré, Mi... e a cifra C, D, E...), oitava e desvio em cents pelo YIN, com Lá4 de referência ajustável.
- **Arquivo inteiro**: além de tocar e ver ao vivo, gera o espectrograma completo do arquivo de uma vez.
- **Exportação em PNG** com o eixo de frequências e os parâmetros da análise.
- Painel que mostra, ao vivo, a resolução em frequência e em tempo da configuração escolhida.

## Como usar

1. Clique em **Ativar microfone** e permita o acesso (o navegador pergunta uma vez). Assobie, cante ou toque um instrumento.
2. Sem microfone? Use o **Tom de teste**: com a dente de serra aparecem todos os harmônicos; com a quadrada, só os ímpares.
3. Ou **abra um arquivo** e toque, ou gere o **espectrograma do arquivo inteiro**.

Algumas experiências que mostram a teoria abaixo:

- Toque a varredura com a escala log ligada e desligada: na log ela vira uma reta, porque cada oitava ocupa a mesma altura.
- Com um tom fixo, troque a janela para **retangular**: a linha fica cercada de "saias" (vazamento espectral). Com a **Blackman** elas somem.
- Mude o tamanho da FFT de 256 para 16384 com a fala ou música tocando: as linhas ficam finas, mas o tempo borra. É o compromisso tempo e frequência.

O microfone só funciona em páginas HTTPS ou em `localhost`: é uma regra dos navegadores. A página publicada já é HTTPS.

## Como rodar localmente

```
python3 -m http.server 8000
```

e abra http://localhost:8000 (o AudioWorklet também exige um servidor; abrir o arquivo direto do disco não funciona).

## Testes

```
node --test
```

Node 18 ou mais novo, sem dependências. São 23 testes:

- **FFT contra a DFT direta** para todos os tamanhos de 1 a 4096, complexa e real, com erro abaixo de 1e-9; até 16384, a FFT real contra a complexa, a simetria conjugada e a ida e volta pela inversa.
- **Parseval**: a energia no tempo é a soma de |X[k]|² dividida por N, com erro relativo abaixo de 1e-12.
- **Janelas**: valores nas pontas e no meio, simetria, ganho coerente (0,5 na Hann) e largura de banda equivalente (1,5 bin na Hann, 1,73 na Blackman); a Blackman isola um seno 100 dB melhor que a retangular a 1,8 kHz de distância.
- **dBFS**: um seno de amplitude 1 no centro de um bin mede 0 dB em todas as janelas; amplitude 0,25 mede -12,04 dB.
- **Pico interpolado**: 440 Hz a 44,1 kHz com N = 4096 (bins de 10,77 Hz) sai com erro menor que 0,2 Hz, e a altura com erro menor que 0,1 dB.
- **YIN**: tons com seis harmônicos de 82 Hz a 1,3 kHz com erro menor que 2 cents, fundamental mais fraca que o segundo harmônico, fundamental ausente, ruído, silêncio e ruído puro.
- **Notas e cents**, buffer circular e o cálculo de quadros com sobreposição, e a luminância sempre crescente dos mapas de cor.

## Como funciona

### Amostragem

O microfone entrega números: a pressão do ar medida `fs` vezes por segundo (48 mil vezes num computador típico). O teorema de Nyquist diz que dá para representar frequências até `fs/2` (24 kHz aqui); acima disso, as frequências se dobram e aparecem disfarçadas de graves (aliasing). Por isso o eixo do espectrograma vai até `fs/2`.

### Do tempo para a frequência: a DFT

A Transformada Discreta de Fourier pega N amostras e responde "quanto de cada frequência tem aqui":

```
X[k] = soma de n = 0 até N-1 de  x[n] · e^(-2·pi·i·k·n/N)
```

Cada `X[k]` é um número complexo: o módulo é a amplitude e o ângulo é a fase da componente de frequência `k·fs/N` Hz. Esses k são os **bins**, espaçados de `fs/N`. Calcular assim custa N² multiplicações: com N = 16384, são 268 milhões por quadro.

### A FFT e a borboleta

A FFT (Cooley e Tukey, 1965) nota que a DFT de N pontos é a combinação de duas DFTs de N/2: a das amostras pares (P) e a das ímpares (I). Com `W = e^(-2·pi·i/N)`:

```
X[k]       = P[k] + W^k · I[k]
X[k + N/2] = P[k] - W^k · I[k]
```

Esse par de contas é a **borboleta**: dois números entram, dois saem, com uma multiplicação só.

```
P[k] ------------+------ P[k] + W^k·I[k]  = X[k]
                  \    /
                   \  /
                    \/
                    /\
                   /  \
                  /    \
I[k] ---(x W^k)--+------ P[k] - W^k·I[k]  = X[k + N/2]
```

Aplicando a ideia de novo nas metades, e de novo, chega-se a log2(N) etapas de N/2 borboletas: N·log2(N) em vez de N². Com N = 16384 são 229 mil multiplicações em vez de 268 milhões.

A versão iterativa (a deste projeto, em `src/fft.js`) primeiro reordena as amostras pela **inversão dos bits** do índice, para que cada etapa combine vizinhos. Para N = 8:

| índice | binário | invertido | posição |
|---|---|---|---|
| 1 | 001 | 100 | 4 |
| 3 | 011 | 110 | 6 |
| 4 | 100 | 001 | 1 |
| 6 | 110 | 011 | 3 |

A ordem final fica 0, 4, 2, 6, 1, 5, 3, 7. Depois vêm as etapas com borboletas de tamanho 2, 4 e 8, usando senos e cossenos pré-calculados.

Como o áudio é real (sem parte imaginária), metade do trabalho é desperdício: o espectro de um sinal real é simétrico (`X[N-k]` é o conjugado de `X[k]`). O truque usado aqui coloca as amostras pares na parte real e as ímpares na imaginária de uma FFT complexa de N/2 pontos e depois separa os dois espectros com `E[k] = (Z[k] + conj(Z[N/2-k])) / 2` e `O[k] = (Z[k] - conj(Z[N/2-k])) / 2i`.

### Janelas e vazamento espectral

A DFT supõe que o trecho analisado se repete para sempre. Se o trecho corta um seno no meio de um ciclo, a emenda vira um degrau, e o degrau tem energia em todas as frequências: a linha do seno ganha "saias" que sujam o espectro inteiro. É o **vazamento espectral**.

A solução é multiplicar o trecho por uma **janela** que desce suavemente a zero nas pontas:

| Janela | fórmula | lóbulos laterais | largura equivalente |
|---|---|---|---|
| Retangular | 1 | -13 dB | 1 bin |
| Hann | 0,5 - 0,5·cos(2·pi·n/N) | -31 dB | 1,5 bin |
| Hamming | 0,54 - 0,46·cos(2·pi·n/N) | -43 dB | 1,36 bin |
| Blackman | 0,42 - 0,5·cos(2·pi·n/N) + 0,08·cos(4·pi·n/N) | -58 dB | 1,73 bin |

Menos vazamento custa um pico mais largo. A janela também reduz a amplitude (a Hann tem média 0,5), então o espectro é dividido pelo **ganho coerente** para que um seno de amplitude 1 meça 0 dBFS.

### O compromisso entre tempo e frequência

A resolução em frequência é `fs/N`: com 48 kHz e N = 4096, cada bin tem 11,7 Hz. Para separar notas graves, que ficam a poucos Hz umas das outras, é preciso N grande. Mas o quadro dura `N/fs`: 85 ms com N = 4096 e 341 ms com N = 16384, e tudo que acontece dentro desse tempo se mistura. Não dá para ter as duas coisas: é a mesma desigualdade da incerteza de Heisenberg, `Δt · Δf >= constante`. O painel "Análise" mostra os dois números ao vivo.

A **sobreposição** não melhora a resolução, mas faz as colunas andarem mais rápido que o tamanho do quadro: com 75%, cada coluna nova reaproveita três quartos das amostras da anterior.

### Do espectro ao pixel

Cada amplitude vira decibéis, `20·log10(A)`: 0 dBFS é o máximo digital e cada -6 dB é metade da amplitude. Na escala **logarítmica** de frequência, cada oitava ocupa a mesma altura, como o ouvido percebe. Nos agudos várias dezenas de bins caem num pixel (o programa usa o maior deles); nos graves, um bin se espalha por vários pixels (o programa interpola).

As cores vêm de mapas perceptuais no estilo viridis e magma, interpolados em RGB linear: a luminância cresce sempre, então mais claro significa mais forte mesmo em cinza ou para quem não distingue cores. Os valores em dB das colunas ficam guardados, por isso trocar o mapa, o piso ou o teto repinta tudo sem recalcular.

### Achando o pico entre dois bins

O máximo da FFT só cai em múltiplos de `fs/N`. Perto do topo, o pico de uma janela suave, medido em dB, parece uma parábola; ajustando uma parábola nos três bins `a`, `b`, `c` em volta do maior, o vértice está a

```
delta = (a - c) / (2·(a - 2b + c))   bins do maior, com altura  b - (a - c)·delta/4
```

Com a Hann e N = 4096 isso leva o erro de até 5 Hz (meio bin) para menos de 0,2 Hz e corrige até 1,4 dB de altura.

### Detectando a nota: YIN

O pico do espectro nem sempre é a nota: num violão ou na voz, o segundo harmônico costuma ser mais forte que a fundamental, e alguns sons nem têm fundamental (o cérebro a "ouve" pelos harmônicos). O **YIN** (de Cheveigné e Kawahara, 2002) olha a periodicidade no tempo:

1. **Função diferença**: `d(tau) = soma (x[j] - x[j + tau])²`. Se o som se repete a cada T amostras, `d(T)` é quase zero.
2. **Normalização pela média acumulada**: `d'(tau) = d(tau) / ((1/tau) · soma de d(1) até d(tau))`. Sem isso, deslocamentos muito pequenos sempre parecem os melhores.
3. **Limiar absoluto**: em vez do menor valor de todos, pega o primeiro vale abaixo de 0,15. Os múltiplos do período (2T, 3T) também são vales, e pegar o primeiro evita errar a oitava.
4. **Interpolação parabólica** do vale, para medir frações de amostra.

A frequência é `fs / T` e a nota sai de `69 + 12·log2(f / 440)`, o número MIDI: a parte inteira é a nota (com 12 notas por oitava) e o resto, vezes 100, são os cents. A confiança `1 - d'(T)` filtra respostas duvidosas.

### Por dentro do navegador

O AudioWorklet roda na thread de áudio e recebe blocos de 128 amostras; o coletor junta 1024, mistura os canais em mono e manda para a página transferindo o buffer (sem cópia). A página guarda tudo num buffer circular e, a cada quadro de animação, calcula quantas FFTs já cabem (uma a cada `N·(1 - sobreposição)` amostras), desenha as colunas novas e desloca a imagem. Se a aba ficou escondida e a análise atrasou além do que o buffer guarda, ela pula para o presente.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
