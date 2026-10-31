# ACC Telemetry Overlay App

Overlays de telemetria para **Assetto Corsa Competizione** — velocidade, marcha, posição, classificação, pneus, combustível, danos e um traço de pedais/RPM em tempo real, direto na tela enquanto você pilota.

> ⚠️ **Beta**. Funciona, mas ainda em desenvolvimento ativo.

## Instalação

1. Baixe o instalador na [página de Releases](../../releases).
2. Rode `ACC Telemetry App Setup.exe`.
3. Abra a ACC, entre numa sessão (treino/corrida) — o app conecta sozinho, sem configuração.

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

## Como funciona

- **Broadcasting Protocol** (UDP) da própria ACC — velocidade, marcha, posição, classificação.
- **Shared Memory** da ACC — combustível, pneus, dano, pedais e RPM.
- **Dash no celular** — servidor HTTPS + WebSocket local (porta 8770) servido pelo próprio app, sem dependências extras.

Nenhuma configuração manual de host/porta/senha é necessária: o app cria o `broadcasting.json` da ACC sozinho na primeira vez, se ele ainda não existir.

## Requisitos

- Windows 10/11
- Assetto Corsa Competizione

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
