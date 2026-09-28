/** Browser-independent access to the current URL of a concrete browser tab. */
export interface TabUrlProvider {
  getUrl(tabId: number): Promise<string | undefined>;
}
