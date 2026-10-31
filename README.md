# Interleigos Telemetry

App da comunidade [Interleigos](https://interleigos.vercel.app/telemetry) com overlays de telemetria, dash no celular e celular como volante ou controle para **Assetto Corsa Competizione**, **Automobilista 2** e **Le Mans Ultimate** — velocidade, marcha, posição, classificação, pneus, combustível, danos e um traço de pedais/RPM em tempo real, direto na tela enquanto você pilota.

> ⚠️ **Beta**. Funciona, mas ainda em desenvolvimento ativo.

## Instalação

1. Baixe o instalador na [página de Releases](../../releases).
2. Rode o `Setup.exe` (o arquivo ainda se chama `ACC Telemetry App … Setup.exe`, nome mantido para não quebrar a atualização automática de quem já tem o app).
3. Abra a ACC ou o AMS2 e entre numa sessão (treino/corrida) — o app detecta o jogo e conecta sozinho.

Guia completo, com imagens: https://interleigos.vercel.app/telemetry/guia

Também tem uma versão portátil (`.zip`) nos Releases, se preferir não instalar.

## Uso

- Abra o app: todos os widgets ligados aparecem sobre o jogo.
- **F12** (ou o botão "Modo edição" na janela principal) alterna o modo de edição — nesse modo dá pra arrastar e redimensionar cada widget livremente.
- Saindo do modo de edição, os widgets ficam fixos na posição escolhida.
- Ligue/desligue widgets individualmente (ou todos de uma vez) na janela principal.

## Dash no celular

Mostra marcha, velocidade, shift lights, delta da volta, últimas voltas, pneus, combustível, pedais e força no volante no celular, pelo Wi-Fi.

1. Na janela principal, ligue **Dash no celular**.
2. Com o celular na mesma rede Wi-Fi do PC, escaneie o QR code.
3. Na primeira vez o Chrome avisa que a conexão "não é particular": toque em **Avançado → Continuar**. É o certificado autoassinado do próprio app (necessário para recursos como tela cheia, manter a tela ligada e, no futuro, os sensores de movimento).
4. Se o Windows perguntar sobre o Firewall, permita em **redes privadas**.

Use o celular na horizontal e toque em ⛶ para tela cheia.

### Celular como volante

Na aba **Volante** da página do celular, você pilota inclinando o celular como um volante. O freio e o acelerador são os sliders das laterais. Para trocar de marcha, incline o topo do celular para frente (sobe) ou para trás (reduz), ou use os botões SUBIR/REDUZIR. Ao lado da marcha ficam os atalhos: TC+/−, ABS+/−, pit limiter, ignição, partida, piscar farol e pedir pit.

Prefere jogar com os polegares? A aba **Controle** vira um controle completo na tela, no estilo de um gamepad: analógico esquerdo (movimento/direção), analógico direito (câmera), setas, A/B/X/Y, LB/RB, LT/RT, Select e Start, além dos atalhos de corrida no meio. Serve para os jogos de corrida e para qualquer outro jogo que aceite joystick (DirectInput). LT freia e RT acelera; para dosar acelerador e freio, ligue em Ajustes **"Controle: analógico direito acelera (↑) e freia (↓)"**.

Para o controle completo, no "Configure vJoy" ative também os eixos **Rx, Ry e Rz** e coloque **21 botões**:

| Controle | vJoy |
| --- | --- |
| Analógico esquerdo ↔ / ↕ | Eixo X / Eixo Rx |
| Analógico direito ↔ / ↕ | Eixo Ry / Eixo Rz |
| RT / LT | Eixo Y / Eixo Z |
| RB / LB | Botões 1 / 2 (mesmos de subir/reduzir marcha) |
| Atalhos de corrida | Botões 3 a 11 |
| A, B, X, Y | Botões 12, 13, 14, 15 |
| Select, Start | Botões 16, 17 |
| Setas ↑ ↓ ← → | Botões 18, 19, 20, 21 |


1. Instale o [vJoy](https://github.com/BrunnerInnovation/vJoy/releases) e reinicie o PC. No "Configure vJoy", o dispositivo 1 precisa dos eixos X, Y e Z e de 11 botões (2 de marcha + 9 de atalhos, incluindo pedir pit).
2. No app, ligue **Usar o celular como volante/controle (vJoy)**.
3. No celular, abra a aba **Volante** (ou **Controle**) e toque em **Começar a pilotar**.
4. No ACC, vá em Opções → Controles e mapeie volante, acelerador, freio, marchas e atalhos usando os botões de **Ajustes → Mapear no ACC / Mapear atalhos**. Cada botão mexe só aquele comando.

Por segurança, se o celular parar de mandar comandos (Wi-Fi caiu, tela apagou, app fechado), o PC solta o acelerador e o freio na hora.

## Automobilista 2

O app detecta sozinho qual jogo está em pista. Para o AMS2, ative a memória compartilhada uma vez no jogo: **Opções → Sistema → Memória compartilhada (Shared Memory) → Project CARS 2**.

Todos os widgets e a dash no celular funcionam no AMS2. Diferenças em relação à ACC:
- **Delta da volta** e **consumo por volta** são calculados pelo app (o AMS2 não publica esses valores). O delta usa a melhor volta válida da sessão; o consumo aparece a partir da 2ª volta completa.
- **Pneus** mostram o desgaste real (a ACC só informa as pastilhas de freio).
- **Danos**: aerodinâmica, motor e suspensão de cada lado.
- **Não disponíveis no AMS2**: força no volante, previsão de chuva e aderência da pista.

Se algum número parecer errado, use **Gravar diagnóstico** na janela principal: o app salva 5 segundos dos dados lidos num arquivo em `Documentos/Interleigos Telemetry/diagnostico`.

### Volante pelo celular no AMS2

No AMS2 o celular funciona como **controle (gamepad)**, não como volante:

1. **Opções → Controles → Esq. de controle**: crie um pré-ajuste com **Tipo: Gamepad/Controle** e **Criar: Personalizado**.
2. **Editar associações → Movimento**: em *Virando à esquerda* use o botão **Volante ← esquerda** dos Ajustes do celular; em *Virando à direita*, **Volante → direita**; depois Acelerador, Freio e as marchas.
3. **Configuração**: coloque **Amortecedor do controle** e as zonas mortas em **0**.
4. **Salvar**.

Com o tipo *Volante* o AMS2 reconhece os pedais, mas não gira o volante pelo vJoy.

## Le Mans Ultimate

No LMU, ligue uma vez **Settings → Gameplay → Enable Plugins**. O app lê a memória compartilhada própria do jogo (`LMU_Data`), sem instalar plugin.

- Delta da volta, gap para o líder, TC/ABS/mapa do motor e força no volante vêm direto do jogo.
- Pneus mostram temperatura (média da superfície), pressão e desgaste; Danos mostram as amassadas por região.
- Volante pelo celular: mapeie em **Settings → Controls** usando os botões de **Ajustes → Mapear no jogo** do celular.

## Vibração e pit no celular

- Com **Ajustes → Vibrar com zebra, saída de pista e batidas** ligado, o celular vibra em pulsos curtos na zebra, em pulsos duplos fora da pista e com um tranco mais longo nas batidas (ACC, AMS2 e LMU).
- O atalho **PEDIR PIT** usa o botão 11 do vJoy — configure **11 botões** no Configure vJoy e mapeie o comando de pedir pit do jogo. No AMS2 e no LMU o botão acende quando o pit está pedido.

## Como funciona

- **Broadcasting Protocol** (UDP) da própria ACC — velocidade, marcha, posição, classificação.
- **Shared Memory** da ACC — combustível, pneus, dano, pedais e RPM.
- **Shared Memory do LMU** (`LMU_Data`, estrutura oficial do `SharedMemoryInterface.hpp`) — lida em partes (sessão, classificação e telemetria do jogador).
- **Shared Memory do AMS2** (`$pcars2$`, formato Project CARS 2, versão 14) — convertida para o mesmo formato da ACC, então os widgets são os mesmos.
- **Dash no celular** — servidor HTTPS + WebSocket local (porta 8770) servido pelo próprio app, sem dependências extras.

Nenhuma configuração manual de host/porta/senha é necessária: o app cria o `broadcasting.json` da ACC sozinho na primeira vez, se ele ainda não existir.

## Requisitos

- Windows 10/11
- Assetto Corsa Competizione, Automobilista 2 e/ou Le Mans Ultimate

## Publicar uma versão nova

Mude o `"version"` no `package.json` (ex.: `1.5.0` → `1.5.1`) num PR e faça o merge na `main`. O GitHub Actions gera o instalador num Windows da nuvem e publica a Release sozinho (aba **Actions** mostra o andamento). Quem já tem o app instalado recebe a atualização automaticamente.

## Desenvolvimento

```bash
npm install
npm start        # modo desenvolvimento
npm run package  # gera o .exe em out/
npm run make      # gera instalador + zip portátil em out/make/
```

Stack: Electron + React + koffi (acesso à memória compartilhada via FFI).
