// Whether the next search page load was asked for (Search pressed, here or on
// Home) rather than just opened (a link, a refresh, the back button). Only an
// asked-for search may contact MAM; an opened page shows a saved answer.
let asked = false;

export function askToSearch(): void {
  asked = true;
}

/** Read and clear the flag. */
export function takeSearchAsk(): boolean {
  const was = asked;
  asked = false;
  return was;
}
