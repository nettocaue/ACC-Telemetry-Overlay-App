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

## Como funciona

- **Broadcasting Protocol** (UDP) da própria ACC — velocidade, marcha, posição, classificação.
- **Shared Memory** da ACC — combustível, pneus, dano, pedais e RPM.

Nenhuma configuração manual de host/porta/senha é necessária: o app cria o `broadcasting.json` da ACC sozinho na primeira vez, se ele ainda não existir.

## Requisitos

- Windows 10/11
- Assetto Corsa Competizione

## Desenvolvimento

```bash
npm install
npm start        # modo desenvolvimento
npm run package  # gera o .exe em out/
npm run make      # gera instalador + zip portátil em out/make/
```

Stack: Electron + React + koffi (acesso à memória compartilhada via FFI).
