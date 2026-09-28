export interface RecorderDocumentContext {
  readonly documentId: string;
  readonly url: string;
}

export interface RecorderDocumentProvider {
  getMainDocument(tabId: number): Promise<RecorderDocumentContext>;
}
