/**
 * Where a waiting link or screenshot goes to become a saved look. The looks
 * screens own these two routes (see App.tsx) and remove the item from the
 * waiting list once it is part of a look.
 *
 * `ready` is here so the waiting list can hold such items on its own, with a
 * plain message, if the looks screens are ever taken out.
 */
export const LOOK_ROUTES = {
  ready: true as boolean,
  fromLink: (inboxId: string) => `/inspiration/new?inbox=${inboxId}`,
  fromScreenshot: (inboxId: string) => `/inspiration/attach?inbox=${inboxId}`,
};
