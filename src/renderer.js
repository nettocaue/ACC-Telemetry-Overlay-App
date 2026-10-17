import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { createElement as h } from 'react';
import './index.css';

function App() {
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
    names: [],
  });
  const [profileMode, setProfileMode] = useState(null); // null | 'new' | 'rename'
  const [profileInput, setProfileInput] = useState('');

  useEffect(() => {
    window.app.getVersion().then(setVersion);
    window.profiles.list().then(setProfiles);
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

  const allEnabled =
    widgetList.length > 0 && widgetList.every((w) => w.enabled);
  const toggleAllWidgets = () => {
    const next = !allEnabled;
    setWidgetList((list) => list.map((w) => ({ ...w, enabled: next })));
    widgetList.forEach((w) => window.widgets.setEnabled(w.id, next));
  };

  const switchProfile = async (name) => {
    if (name === profiles.active) return;
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

  const statusLabel = {
    connected: 'Conectado',
    connecting: 'Aguardando a ACC…',
    disconnected: 'Desconectado',
  }[status];

  return h('div', { className: 'app' }, [
    h('header', { key: 'header', className: 'app-header' }, [
      h('div', { key: 'title-block' }, [
        h('h1', { key: 'title' }, 'ACC Telemetry App'),
        h(
          'p',
          { key: 'subtitle' },
          'Overlays de telemetria para Assetto Corsa Competizione',
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
          { key: 'status', className: `status status-${status}` },
          statusLabel,
        ),
      ]),
      h(
        'p',
        { key: 'hint' },
        status === 'connected'
          ? 'Recebendo dados da ACC — pode fechar essa janela, os widgets continuam funcionando.'
          : 'Sem configuração necessária: basta abrir a ACC e entrar numa sessão. Conecta sozinho assim que o jogo responder.',
      ),
      error ? h('p', { key: 'error', className: 'error' }, error) : null,
      h('div', { key: 'actions', className: 'actions' }, [
        h(
          'button',
          { key: 'reconnect', onClick: handleReconnect },
          'Reconectar',
        ),
        h(
          'button',
          {
            key: 'editMode',
            className: 'btn-edit-mode',
            onClick: () => window.editMode.toggle(),
          },
          `Modo edição: ${editMode ? 'LIGADO' : 'DESLIGADO'}`,
        ),
      ]),
    ]),

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
                key: 'toggleProfile',
                className: profiles.activeEnabled
                  ? 'btn-profile-on'
                  : 'btn-profile-off',
                onClick: toggleProfileEnabled,
              },
              profiles.activeEnabled ? 'Desativar perfil' : 'Ativar perfil',
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
        h(
          'button',
          { key: 'toggleAll', onClick: toggleAllWidgets },
          allEnabled ? 'Desativar todos' : 'Ativar todos',
        ),
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
          `Marcha: ${car.gear === 0 ? 'R' : car.gear === -1 ? 'N' : car.gear}`,
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
