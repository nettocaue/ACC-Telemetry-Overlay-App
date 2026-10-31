import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { createElement as h } from 'react';
import './index.css';

// "Phone as a wheel" toggle + vJoy status/setup, inside the phone panel.
function ControllerSection({ controller, onToggle }) {
  const [showHelp, setShowHelp] = useState(false);
  if (!controller) return null;

  let state = null;
  if (controller.enabled && controller.error) {
    state = h('p', { key: 'err', className: 'error' }, controller.error);
  } else if (controller.enabled) {
    state = h(
      'p',
      { key: 'ok', className: 'controller-ok' },
      'vJoy pronto. No celular, abra a aba "Volante".',
    );
  }

  return h('div', { className: 'controller-section' }, [
    h('div', { key: 'row', className: 'widget-list-row' }, [
      h(
        'span',
        { key: 'name', className: 'widget-list-name' },
        'Usar o celular como volante/controle (vJoy)',
      ),
      h('label', { key: 'toggle', className: 'switch' }, [
        h('input', {
          key: 'input',
          type: 'checkbox',
          checked: controller.enabled,
          onChange: (e) => onToggle(e.target.checked),
        }),
        h('span', { key: 'slider', className: 'switch-slider' }),
      ]),
    ]),
    state,
    h(
      'button',
      {
        key: 'help-btn',
        className: 'link-btn',
        onClick: () => setShowHelp(!showHelp),
      },
      showHelp ? 'Esconder instruções' : 'Como configurar (primeira vez)',
    ),
    showHelp &&
      h('ol', { key: 'help', className: 'controller-help' }, [
        h('li', { key: 1 }, [
          'Instale o vJoy (versão para Windows 10/11): ',
          h('code', { key: 'c' }, 'github.com/BrunnerInnovation/vJoy/releases'),
          ' e reinicie o PC.',
        ]),
        h(
          'li',
          { key: 2 },
          'Abra o "Configure vJoy": no dispositivo 1, deixe os eixos X, Y e Z ativados e coloque 11 botões (2 para a troca de marcha e 9 para os atalhos: TC, ABS, pit limiter, ignição, partida, farol e pedir pit). Para o controle completo da aba Controle, ative também os eixos Rx, Ry e Rz e coloque 21 botões.',
        ),
        h(
          'li',
          { key: 3 },
          'Ligue a chave acima e, no celular, abra a aba "Volante".',
        ),
        h(
          'li',
          { key: 4 },
          'No ACC, em Opções → Controles, clique em cada comando (volante, acelerador, freio, marchas e os atalhos) e toque no botão correspondente em Ajustes → "Mapear no ACC" / "Mapear atalhos", no celular.',
        ),
      ]),
  ]);
}

// Phone dash: toggles the local HTTPS server and shows the QR code / URL
// the phone opens. All the networking lives in the main process.
function PhonePanel() {
  const [status, setStatus] = useState(null);
  const [selectedIp, setSelectedIp] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.remote.getStatus().then(setStatus);
    return window.remote.onStatus(setStatus);
  }, []);

  if (!status) return null;

  const toggle = async (enabled) => {
    setStatus(await window.remote.setEnabled(enabled));
  };

  const addresses = status.addresses ?? [];
  const address =
    addresses.find((a) => a.ip === selectedIp) ?? addresses[0] ?? null;

  const copyUrl = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  let badge;
  if (!status.enabled) badge = ['disconnected', 'Desligado'];
  else if (status.error) badge = ['disconnected', 'Erro'];
  else if (status.clients > 0)
    badge = [
      'connected',
      status.clients === 1
        ? '1 celular conectado'
        : `${status.clients} celulares conectados`,
    ];
  else badge = ['connecting', 'Aguardando celular…'];

  return h('section', { className: 'panel' }, [
    h('div', { key: 'row', className: 'panel-header-row' }, [
      h('h2', { key: 't' }, 'Dash no celular'),
      h('div', { key: 'right', className: 'header-buttons' }, [
        h(
          'span',
          { key: 'status', className: `status status-${badge[0]}` },
          badge[1],
        ),
        h('label', { key: 'toggle', className: 'switch' }, [
          h('input', {
            key: 'input',
            type: 'checkbox',
            checked: status.enabled,
            onChange: (e) => toggle(e.target.checked),
          }),
          h('span', { key: 'slider', className: 'switch-slider' }),
        ]),
      ]),
    ]),
    !status.enabled &&
      h(
        'p',
        { key: 'off' },
        'Mostra marcha, delta, pneus, combustível e pedais no seu celular, pelo Wi-Fi de casa.',
      ),
    status.enabled &&
      status.error &&
      h('p', { key: 'error', className: 'error' }, status.error),
    status.enabled &&
      !status.error &&
      !address &&
      h(
        'p',
        { key: 'noip', className: 'error' },
        'Nenhuma rede encontrada. Conecte o PC ao Wi-Fi ou cabo de rede.',
      ),
    status.enabled &&
      !status.error &&
      address &&
      h('div', { key: 'connect', className: 'phone-connect' }, [
        h('img', {
          key: 'qr',
          className: 'phone-qr',
          alt: 'QR code para abrir a dash no celular',
          src: `data:image/svg+xml;utf8,${encodeURIComponent(address.qrSvg)}`,
        }),
        h('div', { key: 'info', className: 'phone-info' }, [
          h(
            'p',
            { key: 'step1' },
            '1. Celular e PC na mesma rede Wi-Fi. Aponte a câmera do celular para o QR code.',
          ),
          h(
            'p',
            { key: 'step2' },
            '2. Na primeira vez o Chrome avisa que a conexão "não é particular": toque em Avançado → Continuar. É o certificado do próprio app.',
          ),
          h(
            'p',
            { key: 'step3' },
            '3. Se o Windows perguntar sobre o Firewall, permita em redes privadas.',
          ),
          h('div', { key: 'url', className: 'phone-url-row' }, [
            h('code', { key: 'code', className: 'phone-url' }, address.url),
            h(
              'button',
              { key: 'copy', onClick: copyUrl },
              copied ? 'Copiado!' : 'Copiar',
            ),
          ]),
          h(ControllerSection, {
            key: 'controller',
            controller: status.controller,
            onToggle: async (enabled) =>
              setStatus(await window.remote.setController(enabled)),
          }),
          addresses.length > 1 &&
            h('label', { key: 'ip', className: 'phone-ip-select' }, [
              'Rede: ',
              h(
                'select',
                {
                  key: 'sel',
                  className: 'profile-select',
                  value: address.ip,
                  onChange: (e) => setSelectedIp(e.target.value),
                },
                addresses.map((a) =>
                  h('option', { key: a.ip, value: a.ip }, `${a.ip} (${a.name})`),
                ),
              ),
            ]),
        ]),
      ]),
  ]);
}

const GAME_NAMES = {
  acc: 'Assetto Corsa Competizione',
  ams2: 'Automobilista 2',
  lmu: 'Le Mans Ultimate',
};

// Which game is feeding data + the diagnostics recorder.
function GameStatus({ game }) {
  const [diag, setDiag] = useState(null); // null | 'recording' | { ok, message }

  const record = async () => {
    setDiag('recording');
    setDiag(await window.game.recordDiagnostics());
  };

  return h('div', { className: 'game-status' }, [
    h('div', { key: 'row', className: 'game-status-row' }, [
      h('span', { key: 'label', className: 'game-status-label' }, 'Jogo:'),
      h(
        'span',
        {
          key: 'name',
          className: `game-status-name${game ? ' game-status-on' : ''}`,
        },
        game ? GAME_NAMES[game] : 'nenhum em pista',
      ),
      h(
        'button',
        {
          key: 'diag',
          className: 'link-btn',
          disabled: diag === 'recording',
          onClick: record,
          title:
            'Grava 5 segundos dos dados lidos do jogo num arquivo, para conferir se os números estão certos.',
        },
        diag === 'recording' ? 'Gravando 5 s…' : 'Gravar diagnóstico',
      ),
    ]),
    diag &&
      diag !== 'recording' &&
      h(
        'p',
        { key: 'msg', className: diag.ok ? 'game-status-msg' : 'error' },
        diag.message,
      ),
    h(
      'p',
      { key: 'ams2', className: 'game-status-hint' },
      'Automobilista 2: em Opções → Sistema, deixe "Memória compartilhada" (Shared Memory) em "Project CARS 2".',
    ),
    h(
      'p',
      { key: 'lmu', className: 'game-status-hint' },
      'Le Mans Ultimate: em Settings → Gameplay, ligue "Enable Plugins".',
    ),
  ]);
}

function App() {
  const [game, setGame] = useState(null);
  useEffect(() => {
    window.game.get().then(setGame);
    return window.game.onChanged(setGame);
  }, []);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [car, setCar] = useState(null);
  const [track, setTrack] = useState(null);
  const [cars, setCars] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [widgetList, setWidgetList] = useState([]);
  const [version, setVersion] = useState('');
  const [profiles, setProfiles] = useState({
    active: '',
    activeEnabled: true,
    dirty: false,
    names: [],
  });
  const [profileMode, setProfileMode] = useState(null); // null | 'new' | 'rename'
  const [profileInput, setProfileInput] = useState('');

  useEffect(() => {
    window.app.getVersion().then(setVersion);
    window.profiles.list().then(setProfiles);
    return window.profiles.onDirtyChanged((dirty) =>
      setProfiles((prev) => ({ ...prev, dirty })),
    );
  }, []);

  useEffect(() => {
    window.editMode.get().then(setEditMode);
    window.widgets.list().then(setWidgetList);
    const unsubscribers = [
      window.acc.onConnected(() => {
        setStatus('connected');
        setError(null);
      }),
      window.acc.onRegistrationFailed((msg) => {
        setStatus('disconnected');
        setError(msg);
      }),
      window.acc.onError((msg) => setError(msg)),
      window.acc.onParseError((msg) =>
        console.warn('ACC broadcast parse warning:', msg),
      ),
      window.acc.onReregistering(() => setStatus('connecting')),
      window.acc.onRealtimeUpdate((data) => setSession(data)),
      window.acc.onRealtimeCarUpdate((data) => {
        setCar((prev) =>
          data.carIndex === session?.focusedCarIndex ? data : prev,
        );
      }),
      window.acc.onTrackData((data) => setTrack(data)),
      window.acc.onEntryListCar((data) =>
        setCars((prev) => ({ ...prev, [data.carIndex]: data })),
      ),
      window.editMode.onChanged(setEditMode),
    ];
    return () => unsubscribers.forEach((unsub) => unsub());
  }, [session?.focusedCarIndex]);

  const handleReconnect = () => {
    setError(null);
    setStatus('connecting');
    window.acc.reconnect();
  };

  const toggleWidget = (id, enabled) => {
    setWidgetList((list) =>
      list.map((w) => (w.id === id ? { ...w, enabled } : w)),
    );
    window.widgets.setEnabled(id, enabled);
  };

  // Leaving the active profile drops its unsaved edits, so ask first.
  const confirmDiscardUnsaved = () =>
    !profiles.dirty ||
    window.confirm(
      `O perfil "${profiles.active}" tem alterações não salvas. Descartar?`,
    );

  const saveProfile = async () => {
    await window.profiles.save();
    setProfiles(await window.profiles.list());
  };

  const switchProfile = async (name) => {
    if (name === profiles.active) return;
    if (!confirmDiscardUnsaved()) return;
    await window.profiles.switch(name);
    const updated = await window.profiles.list();
    setProfiles(updated);
    setWidgetList(await window.widgets.list());
  };

  const toggleProfileEnabled = async () => {
    await window.profiles.setEnabled(!profiles.activeEnabled);
    setProfiles(await window.profiles.list());
  };

  const startNewProfile = () => {
    if (!confirmDiscardUnsaved()) return;
    setProfileMode('new');
    setProfileInput('');
  };

  const startRenameProfile = () => {
    setProfileMode('rename');
    setProfileInput(profiles.active);
  };

  const cancelProfileEdit = () => setProfileMode(null);

  const confirmProfileEdit = async () => {
    const name = profileInput.trim();
    if (!name) return;
    if (profileMode === 'new') {
      const ok = await window.profiles.create(name);
      if (ok) {
        setProfiles(await window.profiles.list());
        setWidgetList(await window.widgets.list());
      }
    } else if (profileMode === 'rename') {
      const ok = await window.profiles.rename(profiles.active, name);
      if (ok) setProfiles(await window.profiles.list());
    }
    setProfileMode(null);
  };

  const deleteProfile = async () => {
    if (profiles.names.length <= 1) return;
    const ok = await window.profiles.delete(profiles.active);
    if (ok) {
      const updated = await window.profiles.list();
      setProfiles(updated);
      setWidgetList(await window.widgets.list());
    }
  };

  const focusedEntry = session ? cars[session.focusedCarIndex] : null;
  const activeDriver = focusedEntry?.drivers?.[focusedEntry.currentDriverIndex];

  // AMS2/LMU have no connection handshake: data flowing means connected.
  const shownStatus = game === 'ams2' || game === 'lmu' ? 'connected' : status;
  const statusLabel = {
    connected: 'Conectado',
    connecting: 'Aguardando o jogo…',
    disconnected: 'Desconectado',
  }[shownStatus];

  return h('div', { className: 'app' }, [
    h('header', { key: 'header', className: 'app-header' }, [
      h('div', { key: 'title-block' }, [
        h('h1', { key: 'title' }, 'Interleigos Telemetry'),
        h(
          'p',
          { key: 'subtitle' },
          'Overlays de telemetria para ACC, Automobilista 2 e Le Mans Ultimate',
        ),
      ]),
      h(
        'span',
        { key: 'badge', className: 'version-badge' },
        version ? `v${version}` : '…',
      ),
    ]),

    h('section', { key: 'connection', className: 'panel' }, [
      h('div', { key: 'row', className: 'panel-header-row' }, [
        h('h2', { key: 't' }, 'Conexão'),
        h(
          'span',
          { key: 'status', className: `status status-${shownStatus}` },
          statusLabel,
        ),
      ]),
      h(
        'p',
        { key: 'hint' },
        shownStatus === 'connected'
          ? `Recebendo dados ${{ ams2: 'do AMS2', lmu: 'do LMU' }[game] ?? 'da ACC'} — pode fechar essa janela, os widgets continuam funcionando.`
          : 'Basta abrir a ACC, o AMS2 ou o LMU e entrar numa sessão. Conecta sozinho assim que o jogo responder.',
      ),
      error ? h('p', { key: 'error', className: 'error' }, error) : null,
      h(GameStatus, { key: 'game', game }),
      h('div', { key: 'actions', className: 'actions' }, [
        h(
          'button',
          { key: 'reconnect', onClick: handleReconnect },
          'Reconectar',
        ),
      ]),
    ]),

    h(PhonePanel, { key: 'phone' }),

    h('section', { key: 'profiles', className: 'panel' }, [
      h('div', { key: 'header', className: 'panel-header-row' }, [
        h('h2', { key: 't' }, 'Perfis de Layout'),
      ]),
      profileMode
        ? h('div', { key: 'edit', className: 'profile-edit-row' }, [
            h('input', {
              key: 'input',
              className: 'profile-input',
              value: profileInput,
              placeholder:
                profileMode === 'new' ? 'Nome do novo perfil' : 'Novo nome',
              onChange: (e) => setProfileInput(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Enter') confirmProfileEdit();
                if (e.key === 'Escape') cancelProfileEdit();
              },
              autoFocus: true,
            }),
            h(
              'button',
              { key: 'confirm', onClick: confirmProfileEdit },
              'Salvar',
            ),
            h(
              'button',
              { key: 'cancel', onClick: cancelProfileEdit },
              'Cancelar',
            ),
          ])
        : h('div', { key: 'controls', className: 'profile-row' }, [
            h(
              'select',
              {
                key: 'select',
                className: 'profile-select',
                value: profiles.active,
                onChange: (e) => switchProfile(e.target.value),
              },
              profiles.names.map((n) => h('option', { key: n, value: n }, n)),
            ),
            h(
              'button',
              {
                key: 'save',
                className: profiles.dirty ? 'btn-save-dirty' : undefined,
                disabled: !profiles.dirty,
                onClick: saveProfile,
              },
              profiles.dirty ? 'Salvar •' : 'Salvo',
            ),
            h('button', { key: 'new', onClick: startNewProfile }, 'Novo'),
            h(
              'button',
              { key: 'rename', onClick: startRenameProfile },
              'Renomear',
            ),
            h(
              'button',
              {
                key: 'delete',
                disabled: profiles.names.length <= 1,
                onClick: deleteProfile,
              },
              'Excluir',
            ),
          ]),
    ]),

    h('section', { key: 'widgets', className: 'panel' }, [
      h('div', { key: 'widgetsHeader', className: 'panel-header-row' }, [
        h('h2', { key: 't' }, 'Widgets'),
        h('div', { key: 'buttons', className: 'header-buttons' }, [
          h(
            'button',
            {
              key: 'editMode',
              className: 'btn-edit-mode',
              onClick: () => window.editMode.toggle(),
            },
            `Modo edição: ${editMode ? 'LIGADO' : 'DESLIGADO'}`,
          ),
          h(
            'button',
            {
              key: 'toggleOverlay',
              className: profiles.activeEnabled
                ? 'btn-profile-on'
                : 'btn-profile-off',
              onClick: toggleProfileEnabled,
            },
            profiles.activeEnabled ? 'Desativar overlay' : 'Ativar overlay',
          ),
        ]),
      ]),
      h(
        'div',
        { key: 'list', className: 'widget-list' },
        widgetList.map((w) =>
          h('div', { key: w.id, className: 'widget-list-row' }, [
            h('span', { key: 'name', className: 'widget-list-name' }, w.title),
            h('label', { key: 'toggle', className: 'switch' }, [
              h('input', {
                key: 'input',
                type: 'checkbox',
                checked: w.enabled,
                onChange: (e) => toggleWidget(w.id, e.target.checked),
              }),
              h('span', { key: 'slider', className: 'switch-slider' }),
            ]),
          ]),
        ),
      ),
    ]),

    track &&
      h('section', { key: 'track', className: 'panel' }, [
        h('h2', { key: 't' }, 'Pista'),
        h(
          'p',
          { key: 'name' },
          `${track.trackName} (${(track.trackMeters / 1000).toFixed(2)} km)`,
        ),
      ]),

    car &&
      h('section', { key: 'car', className: 'panel' }, [
        h('h2', { key: 't' }, 'Carro em foco'),
        activeDriver &&
          h(
            'p',
            { key: 'driver' },
            `Piloto: ${activeDriver.firstName} ${activeDriver.lastName}`,
          ),
        focusedEntry &&
          h(
            'p',
            { key: 'team' },
            `Equipe: ${focusedEntry.teamName} (#${focusedEntry.raceNumber})`,
          ),
        h('p', { key: 'speed' }, `Velocidade: ${car.kmh} km/h`),
        h(
          'p',
          { key: 'gear' },
          `Marcha: ${car.gear === -1 ? 'R' : car.gear === 0 ? 'N' : car.gear}`,
        ),
        h(
          'p',
          { key: 'pos' },
          `Posição: ${car.position} (classe: ${car.cupPosition})`,
        ),
        h('p', { key: 'laps' }, `Voltas: ${car.laps}`),
        h(
          'p',
          { key: 'splinePos' },
          `Posição na pista: ${(car.splinePosition * 100).toFixed(1)}%`,
        ),
        h('p', { key: 'delta' }, `Delta: ${(car.delta / 1000).toFixed(3)}s`),
      ]),

    h('footer', { key: 'footer', className: 'app-footer' }, [
      h('span', { key: 'hint' }, 'F12 alterna o modo de edição'),
    ]),
  ]);
}

createRoot(document.getElementById('root')).render(h(App));
