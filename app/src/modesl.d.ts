declare module 'modesl' {
  interface ESLEvent {
    getHeader(name: string): string | undefined;
    getBody(): string;
  }

  interface ESLResult {
    getBody(): string;
    getHeader(name: string): string | undefined;
  }

  export class Connection {
    constructor(host: string, port: number, password: string, readyCallback: () => void);
    events(format: string, ...events: string[]): void;
    on(event: string, cb: (evt: ESLEvent) => void): void;
    api(cmd: string, cb: (res: ESLResult) => void): void;
    bgapi(cmd: string, cb: (res: ESLResult) => void): void;
    execute(app: string, arg: string, uuid: string, cb: (res: ESLResult) => void): void;
    disconnect(): void;
  }

  const _default: { Connection: typeof Connection };
  export default _default;
}
