import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getAppKey } from '../data/server';
import { copyText } from '../ui/clipboard';
import { Card } from '../ui/controls';

/**
 * What the Shortcut runs on a store's page, in Safari, on the phone. It
 * copies the page's own text and the product details stores publish for
 * search engines. The server and the AI provider never load the store's site.
 */
export const PAGE_SCRIPT = `var meta = function (name) {
  var el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
  return el ? el.content : '';
};
var data = Array.prototype.map.call(
  document.querySelectorAll('script[type="application/ld+json"]'),
  function (s) { return s.textContent; }
).join('\\n').slice(0, 8000);
completion(JSON.stringify({
  url: location.href,
  title: document.title,
  description: meta('description') || meta('og:description'),
  data: data,
  text: document.body.innerText.slice(0, 18000)
}));`;

function Copy({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={async () => {
        setState((await copyText(text)) ? 'copied' : 'failed');
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Could not copy' : label}
    </button>
  );
}

/** Step-by-step instructions for building the "Save to Wardrobe" Shortcut. */
export function ShortcutGuideScreen() {
  const connection = useLiveQuery(async () => ({ key: await getAppKey() }), []);
  const address = `${location.origin}/api/inbox`;
  if (!connection) return <div aria-busy="true" />;
  const header = connection.key ? `Bearer ${connection.key}` : undefined;

  return (
    <>
      <div className="detail-top">
        <Link className="back" to="/settings">
          ‹ Settings
        </Link>
      </div>
      <header className="page-head">
        <div>
          <h1>Set up the Shortcut</h1>
          <p className="sub">About ten minutes, once. After that, "Save to Wardrobe" is in the share menu of Photos, Safari and every other app.</p>
        </div>
      </header>

      <p className="notice">
        These steps have not been tried on a real iPhone yet. The names of the actions are Apple's, and one or two may read a little differently on
        your phone. If a step does not match, stop there and say which one.
      </p>

      {!header && (
        <p className="notice notice-bad">
          This phone is not connected to your server yet, so there is no app key to copy. <Link to="/settings">Connect it in Settings</Link>, then
          come back.
        </p>
      )}

      <Card title="Two things to copy">
        <div className="guide-step">
          <p>
            <strong>The address</strong> the Shortcut sends to:
          </p>
          <p className="code-block">{address}</p>
          <div className="row">
            <Copy text={address} label="Copy the address" />
          </div>
        </div>
        <div className="guide-step">
          <p>
            <strong>The Authorization value</strong>: the word Bearer, a space, then your app key. It is not shown here, so it cannot be read over
            your shoulder.
          </p>
          <div className="row">{header ? <Copy text={header} label="Copy the Authorization value" /> : <span className="muted">Connect first.</span>}</div>
        </div>
      </Card>

      <Card title="1. Make the Shortcut">
        <ol className="steps">
          <li>Open the Shortcuts app and tap + for a new shortcut. Name it Save to Wardrobe.</li>
          <li>Tap the (i) at the bottom and turn on "Show in Share Sheet".</li>
          <li>At the top it now says it receives input from the share sheet. Tap that and keep Images, Safari web pages and URLs.</li>
          <li>
            Add the action "Choose from Menu" with four choices: Clothing photo, Store page, Link, Screenshot of a look. Each choice gets its own
            steps below.
          </li>
        </ol>
      </Card>

      <Card title="2. Clothing photo">
        <ol className="steps">
          <li>Add "Remove Background from Image", working on Shortcut Input. This is the same cut-out Photos makes.</li>
          <li>Add "Resize Image" and set the longest edge to 1600.</li>
          <li>
            Add "Get Contents of URL". Paste the address. Under Show More, set Method to POST. Add a header named Authorization and paste the
            Authorization value.
          </li>
          <li>
            Set Request Body to Form. Add a text field named kind with the value photo. Add a file field named file and pick Resized Image.
          </li>
          <li>Add "Show Notification" showing Contents of URL. The server answers in plain words, such as "Photo saved".</li>
        </ol>
      </Card>

      <Card title="3. Store page">
        <ol className="steps">
          <li>Add "Run JavaScript on Web Page", working on Shortcut Input, and paste the script below into it.</li>
          <li>
            Add "Get Contents of URL" exactly as before (address, POST, Authorization header, Form). Add a text field named kind with the value page,
            and a text field named text set to JavaScript Result.
          </li>
          <li>Add "Show Notification" showing Contents of URL.</li>
        </ol>
        <pre className="code-block code-scroll" aria-label="The script for the store page step">
          {PAGE_SCRIPT}
        </pre>
        <div className="row">
          <Copy text={PAGE_SCRIPT} label="Copy the script" />
        </div>
        <p className="hint">
          The script runs on your phone, on the page you are looking at. It copies the page's text and nothing else. The first time, Shortcuts asks
          whether to allow it. This choice only works when you share from Safari.
        </p>
      </Card>

      <Card title="4. Link">
        <ol className="steps">
          <li>
            Add "Get Contents of URL" as before. Add a text field named kind with the value look, and a text field named url set to Shortcut Input.
          </li>
          <li>Add "Show Notification" showing Contents of URL.</li>
        </ol>
        <p className="hint">Use this for an Instagram post or any page you want to keep as a look.</p>
      </Card>

      <Card title="5. Screenshot of a look">
        <ol className="steps">
          <li>
            Add "Get Contents of URL" as before. Add a text field named kind with the value look, and a file field named file set to Shortcut Input.
          </li>
          <li>Add "Show Notification" showing Contents of URL.</li>
        </ol>
      </Card>

      <Card title="Try it">
        <ol className="steps">
          <li>In Photos, open a photo of a piece of clothing, tap Share, then Save to Wardrobe, then Clothing photo.</li>
          <li>A notice should say "Photo saved". If it says "Not saved", it also says why.</li>
          <li>
            Open this app. The piece is under <Link to="/wardrobe/add">Add a piece</Link>, in the waiting list.
          </li>
        </ol>
        <ul className="tips">
          <li>Shared items are not encrypted on your server the way backups are. They are deleted from it as soon as the app collects them.</li>
          <li>Only share clothing, store pages and looks. Photos of you belong in the app's own color test, which never leaves the phone.</li>
          <li>If you ever change your app key, change the Authorization value in the Shortcut too.</li>
        </ul>
      </Card>
    </>
  );
}
