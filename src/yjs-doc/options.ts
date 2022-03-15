export type ErrorType = 'WebSocket' | 'Load';

export type YjsDocOptions = {
  server: string;
  documentId: string;
  onDocError: (type: ErrorType, error: unknown) => void;
};
