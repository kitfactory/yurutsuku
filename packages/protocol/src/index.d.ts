export type StartSession = {
  type: 'start_session';
  session_id: string;
  cmd: string;
  cwd?: string | null;
  env?: Record<string, string>;
  cols: number;
  rows: number;
};

export type SendInput = {
  type: 'send_input';
  session_id: string;
  text: string;
};

export type Resize = {
  type: 'resize';
  session_id: string;
  cols: number;
  rows: number;
};

export type StopSession = {
  type: 'stop_session';
  session_id: string;
};

export type Output = {
  type: 'output';
  session_id: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
};

export type Exit = {
  type: 'exit';
  session_id: string;
  exit_code: number;
};

export type ErrorMessage = {
  type: 'error';
  session_id: string;
  message: string;
  recoverable: boolean;
};

export type UnknownMessage = {
  type: 'unknown';
  raw: unknown;
};

export type Message =
  | StartSession
  | SendInput
  | Resize
  | StopSession
  | Output
  | Exit
  | ErrorMessage
  | UnknownMessage;

export declare const KNOWN_TYPES: Set<string>;

export declare function parseLine(line: string): Message;

export declare function serializeMessage(message: Message): string;
