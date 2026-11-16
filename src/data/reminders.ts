import { getProfile } from './profileRepo';
import { callServer, deleteMeta, getAppKey, getMeta, getServerStatus, setMeta } from './server';
import { isInstalled } from './setup';

/**
 * The evening reminder, on the phone's side. The phone asks its own alert
 * service (Apple's, on an iPhone) for an alert address and hands that to the
 * small server with the office days and the hour. The server does the rest.
 */
const ON = 'reminders.on';
const HOUR = 'reminders.hour';
/** What was last sent to the server, so it is sent again only when it changes. */
const SENT = 'reminders.sent';

export const DEFAULT_REMINDER_HOUR = 20;

export interface ReminderState {
  on: boolean;
  /** 0 to 23, on the phone's own clock. */
  hour: number;
}

export async function getReminderState(): Promise<ReminderState> {
  const [on, hour] = await Promise.all([getMeta(ON), getMeta(HOUR)]);
  return { on: on === '1', hour: hour ? Number(hour) : DEFAULT_REMINDER_HOUR };
}

export type ReminderSupport =
  | 'ok'
  | 'not-installed' // alerts need the app opened from the Home Screen
  | 'unsupported'; // this browser cannot receive alerts at all

/** On an iPhone, a web app can receive alerts only once it is on the Home Screen. */
export function reminderSupport(): ReminderSupport {
  const able = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  if (able) return 'ok';
  return isInstalled() ? 'unsupported' : 'not-installed';
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function sameBytes(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const view = new Uint8Array(a);
  return view.length === b.length && view.every((byte, i) => byte === b[i]);
}

/** The part of the app that receives alerts. It is ready a moment after the app first loads. */
async function alertWorker(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('The app is still setting itself up. Close it, open it again and try once more.')), 8000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** The app's own address, which the alert opens when tapped. */
function appUrl(): string {
  return new URL('./', document.baseURI).href;
}

/** Sends the alert address and the current settings to the server, if they changed. */
async function sendSettings(subscription: PushSubscription, hour: number, force = false): Promise<void> {
  const profile = await getProfile();
  // The forecast point is set in Settings, under Weather. Without one the
  // alert still comes, with no weather in it.
  const point = profile?.home.point;
  const body = {
    subscription: subscription.toJSON(),
    officeDays: profile?.week.officeDays ?? [],
    hour,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    appUrl: appUrl(),
    place: point ? { lat: point.lat, lon: point.lon } : null,
  };
  const serialized = JSON.stringify(body);
  if (!force && serialized === (await getMeta(SENT))) return;
  await callServer('/reminders', { method: 'PUT', body });
  await setMeta(SENT, serialized);
}

/**
 * Turns the reminder on. Must be called from a tap: the iPhone only asks
 * "allow notifications?" in answer to one.
 */
export async function turnOnReminders(hour: number): Promise<void> {
  if (reminderSupport() !== 'ok') throw new Error('This browser cannot receive alerts. Open the app from the Home Screen.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Alerts are turned off for this app. Allow them in the iPhone Settings app, under Notifications, then try again.');
  }
  const worker = await alertWorker();
  const { pushKey } = await getServerStatus();
  const serverKey = fromBase64Url(pushKey);
  let subscription = await worker.pushManager.getSubscription();
  // An address made for another server's key would be refused, so replace it.
  if (subscription && !sameBytes(subscription.options.applicationServerKey, serverKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey });
  await sendSettings(subscription, hour, true);
  await setMeta(ON, '1');
  await setMeta(HOUR, String(hour));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (reminderSupport() !== 'ok') return null;
  const worker = await navigator.serviceWorker.getRegistration();
  return (await worker?.pushManager.getSubscription()) ?? null;
}

export async function setReminderHour(hour: number): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Reminders are not turned on for this phone.');
  await sendSettings(subscription, hour);
  await setMeta(HOUR, String(hour));
}

export async function turnOffReminders(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) {
    if (await getAppKey()) await callServer('/reminders', { method: 'DELETE', body: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  }
  await deleteMeta(ON, SENT);
}

/** Asks the server to send one alert now, to prove that alerts arrive. */
export async function sendTestAlert(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('Reminders are not turned on for this phone.');
  await callServer('/reminders/test', { method: 'POST', body: { endpoint: subscription.endpoint } });
}

/**
 * Keeps the server's copy of the settings current, for example after the
 * office days change in the profile. Called when the app opens. Never throws.
 */
export async function syncReminders(): Promise<void> {
  try {
    const state = await getReminderState();
    if (!state.on || !(await getAppKey())) return;
    const subscription = await currentSubscription();
    // The iPhone can drop the address, for example when alerts are switched
    // off in its Settings app. Then the reminder is off, and Settings says so.
    if (!subscription) {
      if (reminderSupport() === 'ok') await deleteMeta(ON, SENT);
      return;
    }
    await sendSettings(subscription, state.hour);
  } catch {
    // Tried again the next time the app opens.
  }
}
