# Interleigos Telemetry

App da comunidade [Interleigos](https://interleigos.vercel.app/telemetry) com overlays de telemetria, dash no celular e celular como volante para **Assetto Corsa Competizione** e **Automobilista 2** — velocidade, marcha, posição, classificação, pneus, combustível, danos e um traço de pedais/RPM em tempo real, direto na tela enquanto você pilota.

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

Na aba **Volante** da página do celular, você pilota inclinando o celular como um volante. O freio e o acelerador são os sliders das laterais. Para trocar de marcha, incline o topo do celular para frente (sobe) ou para trás (reduz), ou use os botões SUBIR/REDUZIR. Ao lado da marcha ficam os atalhos: TC+/−, ABS+/−, pit limiter, ignição, partida e piscar farol.

1. Instale o [vJoy](https://github.com/BrunnerInnovation/vJoy/releases) e reinicie o PC. No "Configure vJoy", o dispositivo 1 precisa dos eixos X, Y e Z e de 10 botões (2 de marcha + 8 de atalhos).
2. No app, ligue **Usar o celular como volante (vJoy)**.
3. No celular, abra a aba **Volante** e toque em **Começar a pilotar**.
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

## Como funciona

- **Broadcasting Protocol** (UDP) da própria ACC — velocidade, marcha, posição, classificação.
- **Shared Memory** da ACC — combustível, pneus, dano, pedais e RPM.
- **Shared Memory do AMS2** (`$pcars2$`, formato Project CARS 2, versão 14) — convertida para o mesmo formato da ACC, então os widgets são os mesmos.
- **Dash no celular** — servidor HTTPS + WebSocket local (porta 8770) servido pelo próprio app, sem dependências extras.

Nenhuma configuração manual de host/porta/senha é necessária: o app cria o `broadcasting.json` da ACC sozinho na primeira vez, se ele ainda não existir.

## Requisitos

- Windows 10/11
- Assetto Corsa Competizione e/ou Automobilista 2

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
