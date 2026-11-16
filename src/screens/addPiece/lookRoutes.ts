/**
 * Where a waiting link or screenshot goes to become a saved look.
 *
 * The looks screens are built separately. Until they are in the app, `ready`
 * stays false and the waiting list simply holds those items. The change that
 * adds the two routes below also sets `ready` to true.
 */
export const LOOK_ROUTES = {
  ready: false as boolean,
  fromLink: (inboxId: string) => `/inspiration/new?inbox=${inboxId}`,
  fromScreenshot: (inboxId: string) => `/inspiration/attach?inbox=${inboxId}`,
};
