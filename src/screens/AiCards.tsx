import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiErrorMessage, getAiStatus, readWithAi, type AiStatus } from '../data/ai';
import { blankTestImage } from '../data/images';
import { collectInbox } from '../data/inboxRepo';
import { getAppKey, ServerError } from '../data/server';
import { Card } from '../ui/controls';

/** What each kind of AI request is for, in the owner's words. */
const KIND_WORDS: Record<string, string> = {
  'piece-photo': 'Tags from a clothing photo',
  'piece-page': 'Tags from a store page',
  look: 'Reading a saved look',
  leads: 'Finding where to buy',
};

function words(error: unknown): string {
  if (error instanceof ServerError) return aiErrorMessage(error);
  return error instanceof Error ? error.message : 'That did not work. Try again.';
}

/** Settings: whether AI tagging is on, how to turn it on, and a way to test it. */
function AiCard() {
  const [status, setStatus] = useState<AiStatus>();
  const [problem, setProblem] = useState<string>();
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string>();

  useEffect(() => {
    let live = true;
    void getAiStatus().then(
      (found) => {
        if (live) setStatus(found);
      },
      (e: unknown) => {
        if (live) setProblem(words(e));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function onTest() {
    setTesting(true);
    setTestNote(undefined);
    setProblem(undefined);
    try {
      // A plain grey square: it shows nothing, and the model should say it is not clothing.
      const answer = await readWithAi<{ subject?: string }>('piece-photo', { images: [await blankTestImage()] });
      setTestNote(`It works. ${answer.model} answered. That used 1 of today's ${answer.today.limit} requests.`);
      setStatus((current) => (current ? { ...current, today: answer.today } : current));
    } catch (e) {
      setProblem(words(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card title="AI tagging">
      {!status && !problem && <p className="hint">Checking.</p>}
      {status && (
        <dl className="facts">
          <div>
            <dt>Status</dt>
            <dd>
              {status.ready
                ? `On. ${status.today.used} of ${status.today.limit} requests used today.`
                : 'Off. Your server has no AI key yet, so you fill in tags by hand. Everything else works as before.'}
            </dd>
          </div>
          {status.ready &&
            status.kinds.map((kind) => (
              <div key={kind.name}>
                <dt>{KIND_WORDS[kind.name] ?? kind.name}</dt>
                <dd>
                  {kind.model}, up to {kind.dailyLimit} a day
                </dd>
              </div>
            ))}
        </dl>
      )}
      {problem && (
        <p className="notice notice-bad" role="alert">
          {problem}
        </p>
      )}
      {status?.ready && (
        <>
          <button type="button" className="btn" disabled={testing} onClick={() => void onTest()}>
            {testing ? 'Testing' : 'Test it'}
          </button>
          {testNote && (
            <p className="notice" role="status">
              {testNote}
            </p>
          )}
        </>
      )}
      <p className="hint">
        When it is on, the app can read a clothing photo or a store page and suggest tags, which you check before saving. It sends only that one
        photo or page, and only when you tap the button. Photos of you are never sent.
      </p>
      <details className="more">
        <summary>{status?.ready ? 'How it is set up' : 'How to turn it on'}</summary>
        <ol className="steps">
          <li>Make an account at platform.claude.com. This is Anthropic, the company that makes the Claude models.</li>
          <li>Under Billing, buy a small amount of credit, and leave auto-reload off. Credit expires a year after you buy it.</li>
          <li>Under API keys, create a key and copy it.</li>
          <li>
            In Cloudflare, open the Worker named wardrobe-builder, then Settings, then Variables and Secrets. Add a secret named ANTHROPIC_API_KEY and
            paste the key as its value. It sits next to APP_KEY.
          </li>
          <li>Come back here. The status above turns to On, with no new version of the app needed.</li>
        </ol>
        <ul className="tips">
          <li>The key stays on your server. It is never in the app or on this phone.</li>
          <li>Each request is paid from that credit. Your server stops at its daily limit, so a mistake cannot run up a bill.</li>
          <li>Anthropic's terms for these accounts say it may not train its models on what you send.</li>
        </ul>
      </details>
    </Card>
  );
}

/** Settings: the share-menu Shortcut and a way to fetch what it sent. */
function ShareMenuCard() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  async function onCheck() {
    setBusy(true);
    setNote(undefined);
    setError(undefined);
    try {
      const added = await collectInbox();
      setNote(added === 0 ? 'Nothing new on your server.' : added === 1 ? '1 new item is waiting to be added.' : `${added} new items are waiting to be added.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Share menu">
      <p className="hint">
        A web app cannot sit in the iPhone's share menu, so a Shortcut does it. Share a photo, a store page or a link to "Save to Wardrobe" and
        it waits on your server until the app next opens.
      </p>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void onCheck()}>
          Check for shared items
        </button>
      </div>
      {note && (
        <p className="notice" role="status">
          {note} {note.includes('waiting') && <Link to="/wardrobe/add">Open the list</Link>}
        </p>
      )}
      {error && (
        <p className="notice notice-bad" role="alert">
          {error}
        </p>
      )}
      <Link className="link-btn" to="/settings/shortcut">
        Set up the Shortcut
      </Link>
    </Card>
  );
}

/** Both cards need the small server, so they show only once this phone is connected to it. */
export function AiCards() {
  const connection = useLiveQuery(async () => ({ connected: Boolean(await getAppKey()) }), []);
  if (!connection) return null;
  if (!connection.connected) {
    return (
      <Card title="AI tagging and the share menu">
        <p className="hint">Both go through your own server. Connect this phone to it above, and they appear here.</p>
      </Card>
    );
  }
  return (
    <>
      <AiCard />
      <ShareMenuCard />
    </>
  );
}
