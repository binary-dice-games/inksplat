// MIT License © 2026 Binary Dice Games
/**
 * @file Every text of the app, in English and Spanish (spec/08_remote_support/DESIGN.md section
 * 3.2: short, plain, large). `{name}` and `{code}` are filled in by {@link fill}.
 */

const en = {
  title: 'inksplat Support',
  connecting: 'Connecting to the person helping you…',
  yourName: 'Your name',
  saveName: 'Save',
  explainTitle: '{name} wants to see your screen',
  explainBody:
    'In a moment your computer will ask you. {name} will see everything on this screen, but cannot click or type. You can stop at any time.',
  codeLabel: '{name} should read you this code:',
  scamWarning:
    'Only allow someone you contacted yourself or know well. Banks, Microsoft, Apple and the police never ask for this.',
  asking: 'Answer the question on your screen.',
  sharingBar: '{name} can see your screen',
  stop: 'Stop',
  otherDisplay: 'Show my other screen',
  reconnecting: 'Connection lost. Reconnecting…',
  stoppedTitle: 'Sharing stopped',
  shareAgain: 'Share again',
  close: 'Close',
  endedTitle: 'The session has ended',
  deniedTitle: 'You did not allow it',
  deniedBody: 'Nothing was shared. You can close this window.',
  badLinkTitle: 'This link does not work',
  badLinkBody: 'Ask the person helping you to send the link again.',
  blockedTitle: 'Links are paused',
  blockedBody:
    'You said no several times, so links are ignored for 10 minutes. If you did not open these links yourself, close this window.',
  updateTitle: 'Please update inksplat Support',
  updateBody: 'This version is too old to connect. Download the new one and install it.',
  download: 'Download',
  macTitle: 'Allow screen recording',
  macBody:
    'Your Mac needs your permission once. Open System Settings, go to Privacy & Security, Screen & System Audio Recording, and turn on inksplat Support. Then press "I turned it on".',
  openSettings: 'Open System Settings',
  turnedOn: 'I turned it on',
  idle: 'Open the link the person helping you sent.',
  busy: 'Another request is already open. Answer it first.',
  // Native dialogs
  dialogTitle: 'Share your screen?',
  dialogMessage: 'Someone who says they are {name} wants to see your screen.',
  dialogDetail:
    '{name} will see everything on this screen, but cannot click or type.\n\n{name} should read you this code: {code}\nDo not allow if it is different.\n\nOnly allow someone you contacted yourself or know well. Banks, Microsoft, Apple and the police never ask for this.',
  dontAllow: "Don't allow",
  allow: 'Allow',
  keepTitle: 'Keep sharing?',
  keepMessage: 'Keep sharing your screen with {name}?',
  keepDetail: 'If you do not answer within a minute, sharing stops.',
  keep: 'Keep sharing',
  newLinkMessage: 'End the current session and connect to the new link?',
  endAndConnect: 'End and connect',
  cancel: 'Cancel',
  nextDisplayMessage: 'Show your other screen to {name} instead of this one?',
  showIt: 'Show it',
  // Reasons
  'reason-stopped': 'You stopped sharing.',
  'reason-locked': 'Sharing stopped because the screen was locked or the computer went to sleep.',
  'reason-timeout': 'Sharing stopped because nobody answered.',
  'reason-lost': 'The connection was lost.',
  'reason-other-host': 'Sharing stopped: the connection came back from someone else.',
  'reason-window': 'Sharing stopped because a window of the app was closed.',
  'reason-capture-failed': 'Your screen could not be shared.',
  'reason-host-ended': 'The person helping you ended the session.',
  'reason-host-gone': 'The person helping you left.',
  'reason-removed': 'The person helping you ended the session.',
  'reason-no-answer': 'The person helping you could not be reached. The link may be old.',
  'reason-locked-room': 'Someone else is already connected to this session.',
  'reason-protocol': 'This version of inksplat Support does not match. Please update it.',
  'reason-unknown': 'The session has ended.',
};

export type StringKey = keyof typeof en;

const es: Record<StringKey, string> = {
  title: 'inksplat Support',
  connecting: 'Conectando con la persona que te ayuda…',
  yourName: 'Tu nombre',
  saveName: 'Guardar',
  explainTitle: '{name} quiere ver tu pantalla',
  explainBody:
    'En un momento tu ordenador te preguntará. {name} verá todo lo que hay en esta pantalla, pero no puede hacer clic ni escribir. Puedes parar cuando quieras.',
  codeLabel: '{name} debería leerte este código:',
  scamWarning:
    'Permítelo solo a alguien a quien hayas contactado tú o que conozcas bien. Los bancos, Microsoft, Apple y la policía nunca piden esto.',
  asking: 'Responde a la pregunta de tu pantalla.',
  sharingBar: '{name} puede ver tu pantalla',
  stop: 'Parar',
  otherDisplay: 'Mostrar mi otra pantalla',
  reconnecting: 'Se perdió la conexión. Reconectando…',
  stoppedTitle: 'Has dejado de compartir',
  shareAgain: 'Compartir otra vez',
  close: 'Cerrar',
  endedTitle: 'La sesión ha terminado',
  deniedTitle: 'No lo has permitido',
  deniedBody: 'No se ha compartido nada. Puedes cerrar esta ventana.',
  badLinkTitle: 'Este enlace no funciona',
  badLinkBody: 'Pide a la persona que te ayuda que te envíe el enlace otra vez.',
  blockedTitle: 'Enlaces en pausa',
  blockedBody:
    'Has dicho que no varias veces, así que los enlaces se ignoran durante 10 minutos. Si no abriste tú estos enlaces, cierra esta ventana.',
  updateTitle: 'Actualiza inksplat Support',
  updateBody: 'Esta versión es demasiado antigua para conectarse. Descarga la nueva e instálala.',
  download: 'Descargar',
  macTitle: 'Permite la grabación de pantalla',
  macBody:
    'Tu Mac necesita tu permiso una vez. Abre Ajustes del Sistema, ve a Privacidad y seguridad, Grabación de pantalla y audio del sistema, y activa inksplat Support. Después pulsa "Ya lo he activado".',
  openSettings: 'Abrir Ajustes del Sistema',
  turnedOn: 'Ya lo he activado',
  idle: 'Abre el enlace que te envió la persona que te ayuda.',
  busy: 'Ya hay una petición abierta. Respóndela primero.',
  dialogTitle: '¿Compartir tu pantalla?',
  dialogMessage: 'Alguien que dice ser {name} quiere ver tu pantalla.',
  dialogDetail:
    '{name} verá todo lo que hay en esta pantalla, pero no puede hacer clic ni escribir.\n\n{name} debería leerte este código: {code}\nNo lo permitas si es distinto.\n\nPermítelo solo a alguien a quien hayas contactado tú o que conozcas bien. Los bancos, Microsoft, Apple y la policía nunca piden esto.',
  dontAllow: 'No permitir',
  allow: 'Permitir',
  keepTitle: '¿Seguir compartiendo?',
  keepMessage: '¿Seguir compartiendo tu pantalla con {name}?',
  keepDetail: 'Si no respondes en un minuto, se deja de compartir.',
  keep: 'Seguir compartiendo',
  newLinkMessage: '¿Terminar la sesión actual y conectar con el nuevo enlace?',
  endAndConnect: 'Terminar y conectar',
  cancel: 'Cancelar',
  nextDisplayMessage: '¿Mostrar tu otra pantalla a {name} en lugar de esta?',
  showIt: 'Mostrarla',
  'reason-stopped': 'Has dejado de compartir.',
  'reason-locked':
    'Se dejó de compartir porque la pantalla se bloqueó o el ordenador entró en reposo.',
  'reason-timeout': 'Se dejó de compartir porque nadie respondió.',
  'reason-lost': 'Se perdió la conexión.',
  'reason-other-host': 'Se dejó de compartir: la conexión volvió desde otra persona.',
  'reason-window': 'Se dejó de compartir porque se cerró una ventana de la aplicación.',
  'reason-capture-failed': 'No se pudo compartir tu pantalla.',
  'reason-host-ended': 'La persona que te ayuda terminó la sesión.',
  'reason-host-gone': 'La persona que te ayuda se fue.',
  'reason-removed': 'La persona que te ayuda terminó la sesión.',
  'reason-no-answer':
    'No se pudo contactar con la persona que te ayuda. Quizá el enlace es antiguo.',
  'reason-locked-room': 'Ya hay otra persona conectada a esta sesión.',
  'reason-protocol': 'Esta versión de inksplat Support no coincide. Actualízala.',
  'reason-unknown': 'La sesión ha terminado.',
};

const TABLES = { en, es };

/** The language for a locale (`es-ES` gives `es`); English for anything else. */
export function language(locale: string): 'en' | 'es' {
  return /^es\b/i.test(locale) ? 'es' : 'en';
}

/** The text `key` in `lang`. */
export function t(lang: 'en' | 'es', key: StringKey): string {
  return TABLES[lang][key] ?? en[key];
}

/** `text` with `{name}` and `{code}` filled in. */
export function fill(text: string, values: { name?: string; code?: string }): string {
  return text.replaceAll('{name}', values.name ?? '').replaceAll('{code}', values.code ?? '');
}

/** The key of the text that says why a session stopped or ended. */
export function reasonKey(reason: string | null): StringKey {
  const key = `reason-${reason === 'locked' ? 'locked' : (reason ?? 'unknown')}`;
  return key in en ? (key as StringKey) : 'reason-unknown';
}
